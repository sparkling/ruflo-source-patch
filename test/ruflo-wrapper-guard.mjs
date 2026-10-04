import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

if (!process.argv[2] || !path.isAbsolute(process.argv[2])) throw new Error('absolute isolated fixture root required');
const root = fs.realpathSync(process.argv[2]);
process.env.RUFLO_SOURCE_PATCH_HOME = root;
process.env.RUFLO_NPX_ROOT = path.join(root, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(root, 'global', 'node_modules');
const p = await import('../lib/ruflo-wrapper-guard/patcher.mjs');
const c = await import('../lib/plugin-compose.mjs');
const h = await import('../lib/ruflo-wrapper-guard/hooks.mjs');
const { PLUGIN_TARGETS } = await import('../lib/plugin-registry.mjs');
assert(PLUGIN_TARGETS.includes('ruflo-wrapper-guard'));
assert(c.COMPOSE_TARGETS.includes('ruflo-wrapper-guard'));

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
const roots = [
  path.join(process.env.RUFLO_NPX_ROOT, 'cached', 'node_modules', 'ruflo'),
  path.join(process.env.RUFLO_GLOBAL_ROOT, 'ruflo'),
  path.join(process.env.RUFLO_GLOBAL_ROOT, '.ruflo-hidden'),
];
for (const pkg of roots) {
  write(path.join(pkg, 'package.json'), JSON.stringify({
    name: 'ruflo', version: '3.41.2', type: 'module', bin: { ruflo: 'bin/ruflo.js' },
  }));
  write(path.join(pkg, 'bin/ruflo.js'), p.WRAPPER_SOURCE);
}
const direct = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/bin/cli.js');
write(path.join(path.dirname(path.dirname(direct)), 'package.json'), JSON.stringify({
  name: '@claude-flow/cli', version: '100.41.2', type: 'module', bin: { 'claude-flow': 'bin/cli.js' },
}));
write(direct, `import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.length === 1 && ['--version', '-V'].includes(args[0])) {
  process.stdout.write('claude-flow v100.41.2\\n');
} else {
  process.stdout.write(JSON.stringify({ args, entry: process.argv[1], stdin: fs.readFileSync(0, 'utf8') }));
  process.stderr.write('native stderr');
  process.exitCode = args.includes('--fail') ? 23 : 0;
}
`);
const pristineDirect = fs.readFileSync(direct, 'utf8');
// Public wrapper reproducer: the branding version is not the implementation version.
const oldVersion = spawnSync(process.execPath, [path.join(roots[0], 'bin/ruflo.js'), '--version'], { encoding: 'utf8' });
assert.equal(oldVersion.stdout, 'ruflo v3.41.2\n');
assert.notEqual(oldVersion.stdout, 'claude-flow v100.41.2\n');
assert.equal(p.discover().length, 3);
assert.deepEqual(p.patchSource(p.WRAPPER_SOURCE).missing, []);
assert.equal(p.reverseSource(p.REFUSAL_SOURCE), p.WRAPPER_SOURCE);
assert.equal(p.patchSource(p.REFUSAL_SOURCE).next, p.RUNTIME_SOURCE);
assert.equal(p.reverseSource(p.RUNTIME_SOURCE), p.WRAPPER_SOURCE);
assert.equal(p.patchSource(p.RUNTIME_SOURCE).next, p.RUNTIME_SOURCE);
assert(!p.isPatched(p.REFUSAL_SOURCE), 'old refusal is not the new working contract');
assert(!p.RUNTIME_SOURCE.includes('npm install --global'));
for (const format of [text => text, text => text.replaceAll('\n', '\r\n')]) {
  const old = format(p.PRIOR_RUNTIME_SOURCE);
  assert(!p.isPatched(old));
  assert.equal(p.patchSource(old).next, format(p.RUNTIME_SOURCE));
  assert.equal(p.reverseSource(old), format(p.WRAPPER_SOURCE));
}
for (const original of [p.WRAPPER_SOURCE.replaceAll('\n', '\r\n'),
  p.WRAPPER_SOURCE.replaceAll('\n', '\r\n').replace('\r\n', '\n')]) {
  const result = p.patchSource(original);
  assert.deepEqual(result.missing, []);
  assert(p.isPatched(result.next));
  assert.equal(p.reverseSource(result.next), original);
}
for (const changed of [p.WRAPPER_SOURCE + '// upstream drift', '', p.WRAPPER_SOURCE.repeat(2)]) {
  const result = p.patchSource(changed);
  assert(result.missing.length);
  assert.equal(result.next, changed);
}

// Upgrade a deployed refusal from its real pristine backup through the composition engine.
write(path.join(roots[0], 'bin/ruflo.js'), p.REFUSAL_SOURCE);
write(path.join(roots[0], 'bin/ruflo.js.rsp-backup'), p.WRAPPER_SOURCE);
const applied = c.applyComposed(['ruflo-wrapper-guard']);
assert.equal(applied.errors, 0, applied.log.join('\n'));
assert.equal(applied.incomplete, 0);
assert.equal(applied.patched, 3);
assert.equal(c.applyComposed(['ruflo-wrapper-guard']).unchanged, 3);
assert.deepEqual(c.statusComposed()['ruflo-wrapper-guard'], { files: 3, patched: 3 });
assert.equal(fs.readFileSync(direct, 'utf8'), pristineDirect);
assert.equal(spawnSync(process.execPath, [direct, '--version'], { encoding: 'utf8' }).stdout, 'claude-flow v100.41.2\n');

for (const pkg of roots) {
  const file = path.join(pkg, 'bin/ruflo.js');
  // The wrapper's older nested dependency must not hide the newer global CLI.
  const nested = path.join(pkg, 'node_modules/@claude-flow/cli');
  write(path.join(nested, 'package.json'), JSON.stringify({
    name: '@claude-flow/cli', version: '100.33.0', type: 'module', bin: { 'claude-flow': 'bin/cli.js' },
  }));
  write(path.join(nested, 'bin/cli.js'), 'throw new Error("OLD_DRIVER_SELECTED");');
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), p.WRAPPER_SOURCE);
  for (const args of [[], ['--version'], ['-V'], ['--help'], ['mcp', 'start'], ['--fail'],
    ['memory', 'store', '--value', '$(touch NEVER); `touch NEVER`']]) {
    const input = '{"jsonrpc":"2.0","method":"initialize","id":1}\n';
    const result = spawnSync(process.execPath, [file, ...args], {
      encoding: 'utf8', timeout: 2000, input, cwd: root,
      env: { ...process.env, PATH: path.join(path.dirname(process.env.RUFLO_GLOBAL_ROOT), 'bin'),
        NPM_CONFIG_PREFIX: path.dirname(process.env.RUFLO_GLOBAL_ROOT) },
    });
    assert.equal(result.status, args.includes('--fail') ? 23 : 0, result.stderr);
    assert.equal(result.signal, null);
    if (args.length === 1 && ['--version', '-V'].includes(args[0])) {
      assert.equal(result.stdout, 'claude-flow v100.41.2\n');
      assert.equal(result.stderr, '');
    } else {
      assert.deepEqual(JSON.parse(result.stdout), { args, entry: direct, stdin: input });
      assert.equal(result.stderr, 'native stderr');
    }
    assert(!fs.existsSync(path.join(root, 'NEVER')));
  }
}
// Drift is refused by composition without rewriting the new upstream bytes.
const driftFile = path.join(roots[0], 'bin/ruflo.js');
write(driftFile, p.WRAPPER_SOURCE + '// unknown vendor change\n');
const drift = c.applyComposed(['ruflo-wrapper-guard']);
assert(drift.incomplete > 0);
assert.equal(fs.readFileSync(driftFile, 'utf8'), p.WRAPPER_SOURCE + '// unknown vendor change\n');
write(driftFile, p.WRAPPER_SOURCE);
c.applyComposed(['ruflo-wrapper-guard']);
const restored = c.reconcile([], ['ruflo-wrapper-guard']);
assert.equal(restored.errors, 0);
for (const pkg of roots) assert.equal(fs.readFileSync(path.join(pkg, 'bin/ruflo.js'), 'utf8'), p.WRAPPER_SOURCE);

// An impostor package is not patched; a real wrapper with an unsafe bin is refused.
write(path.join(roots[0], 'package.json'), JSON.stringify({ name: 'not-ruflo' }));
assert.equal(p.discover().length, 2);
write(path.join(roots[0], 'package.json'), JSON.stringify({ name: 'ruflo', bin: { ruflo: '../other.js' } }));
assert.throws(() => p.discover(), /unknown ruflo bin contract/);
write(path.join(roots[0], 'package.json'), JSON.stringify({ name: 'ruflo', bin: { ruflo: 'bin/ruflo.js' } }));
fs.unlinkSync(driftFile);
fs.symlinkSync(direct, driftFile);
assert.throws(() => p.discover(), /missing or traverses a symlink/);
assert.equal(fs.readFileSync(direct, 'utf8'), pristineDirect);
// Lifecycle shims share the wrapper's verified native package selector. Only
// genuine absence permits npx, with upstream's skip flag and telemetry exits.
const NPX_ARGS = ['--prefer-offline', '--yes', '@claude-flow/cli@latest'];
const hookArgs = ['-c', 'echo hello; $(not-a-command)'];
for (const [anchor, replacement, priors, legacy] of [
  [h.HOOK_ANCHOR, h.HOOK_REPLACEMENT, [h.PRIOR_HOOK_REPLACEMENT, h.NPX_HOOK_REPLACEMENT], false],
  [h.HOOK_ANCHOR_026, h.HOOK_REPLACEMENT_026, [h.NPX_HOOK_REPLACEMENT_026], false],
  [h.LEGACY_ANCHOR, h.LEGACY_REPLACEMENT, [h.PRIOR_LEGACY_REPLACEMENT, h.NPX_LEGACY_REPLACEMENT], true],
]) {
  const fixture = legacy
    ? `function invokeHook() {}\nfunction main() {\n${anchor}\n}`
    : `function invokeHook() {}\nfunction invokeCli(hookSubcommand, hookArgs, stdinData) {\n${anchor}`;
  const result = p.patchSource(fixture);
  assert.deepEqual(result.missing, []);
  assert(p.isPatched(result.next));
  assert(result.next.includes(replacement));
  assert.equal(p.reverseSource(result.next), fixture);
  assert(!p.isPatched(result.next + replacement), 'duplicate selector is never reported healthy');
  assert.deepEqual(p.patchSource(result.next + replacement).missing, ['unique-hook-wrapper-selection']);
  const falseSelection = result.next.replace('.sort(compare)[0]', '.sort(compare).at(-1)');
  assert(!p.isPatched(falseSelection), 'mutated version selection must not pass the owned-source status');
  assert.equal(p.patchSource(falseSelection).next, falseSelection);
  assert(p.patchSource(falseSelection).missing.length);
  assert.deepEqual(p.patchSource(fixture + anchor).missing, ['unique-hook-wrapper-selection']);
  // The earlier PATH-only refusal (claude-flow or exit 1) is ours, not current, migrates in place, and reverses.
  for (const prior of priors) {
    const stale = fixture.replace(anchor, prior);
    assert(p.hasPatch(stale) && !p.isPatched(stale));
    const migrated = p.patchSource(stale);
    assert.deepEqual(migrated.missing, []);
    assert.equal(migrated.next, result.next);
    assert.equal(p.reverseSource(stale), fixture);
  }
  const hookFile = path.join(root, 'plugin', 'scripts', legacy ? 'legacy-hook.cjs' : 'ruflo-hook.cjs');
  write(hookFile, fixture);
  for (const available of [false, true]) for (const skip of [false, true]) {
    const calls = [];
    let exit = null;
    const context = {
      hookSubcommand: 'post-command', hookArgs, stdinData: 'payload',
      commandExists: name => { throw new Error(`PATH probe for ${name}`); },
      invokeHook: (...args) => calls.push(args),
      done: () => { exit = 0; throw new Error('exit:0'); },
      __filename: hookFile,
      require: name => ({ 'node:fs': fs, 'node:path': path,
        'node:os': { userInfo: () => ({ homedir: path.join(root, 'empty-home') }) } })[name],
      process: { execPath: path.join(root, 'empty-node/bin/node'), platform: process.platform,
        env: { NPM_CONFIG_PREFIX: available ? path.dirname(process.env.RUFLO_GLOBAL_ROOT) : path.join(root, 'empty-prefix'),
          ...(skip ? { RUFLO_HOOK_SKIP_NPX: '1' } : {}) },
        exit: code => { exit = code; throw new Error(`exit:${code}`); } },
    };
    const body = legacy ? replacement : replacement.slice(0, -1);
    try { vm.runInNewContext(`(function(){${body}})()`, context); }
    catch (error) { assert.equal(error.message, 'exit:0'); }
    // Arrays built inside the vm realm carry that realm's prototype; compare structure.
    const executable = available ? context.process.execPath : 'npx';
    const executableArgs = available ? [direct] : NPX_ARGS;
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), !available && skip ? [] : [legacy
      ? [executable, executableArgs, hookArgs, 'payload']
      : [executable, executableArgs, 'post-command', hookArgs, 'payload']]);
    assert.equal(exit, legacy ? 0 : null);
  }
}
// Real Node bootstrap, absolute native entry and literal argv/stdin, with a
// trap npx/PATH launcher: any network-installer or branded fallback is a failure.
const coreRoot = path.join(root, '.codex/plugins/cache/ruflo/ruflo-core/0.2.6');
const coreHook = path.join(coreRoot, 'scripts/ruflo-hook.cjs');
write(path.join(coreRoot, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruflo-core', version: '0.2.6' }));
const receipt = path.join(root, 'native-hook-receipt.json');
const npxTrap = path.join(root, 'trap-bin/npx');
const trapReceipt = path.join(root, 'unexpected-path-launcher');
for (const name of ['npx', 'ruflo', 'claude-flow']) {
  const file = path.join(path.dirname(npxTrap), name);
  write(file, `#!/bin/sh\nprintf unexpected > '${trapReceipt}'\nexit 91\n`); fs.chmodSync(file, 0o755);
}
const fullShim = `const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
function invokeHook(bin, before, subcommand, args, stdin) {
  const result = spawnSync(bin, [...before, 'hooks', subcommand, ...args], {input:stdin,encoding:'utf8',env:process.env});
  fs.writeFileSync(process.env.TEST_HOOK_RECEIPT, JSON.stringify({status:result.status,stdout:result.stdout,stderr:result.stderr}));
  return result.status === 0;
}
function invokeCli(hookSubcommand, hookArgs, stdinData) {
${h.HOOK_ANCHOR_026}
invokeCli('session-end', process.argv.slice(2), fs.readFileSync(0,'utf8'));
`;
write(coreHook, fullShim.replace(h.HOOK_ANCHOR_026, h.NPX_HOOK_REPLACEMENT_026));
write(coreHook + '.rsp-backup', fullShim);
// Restore the intentional unsafe-wrapper test before shared discovery runs.
fs.unlinkSync(driftFile); write(driftFile, p.WRAPPER_SOURCE);
const hookApply = c.applyComposed(['ruflo-wrapper-guard']);
assert.equal(hookApply.errors, 0, hookApply.log.join('\n'));
assert.equal(hookApply.incomplete, 0, hookApply.log.join('\n'));
assert.equal(fs.readFileSync(coreHook + '.rsp-backup', 'utf8'), fullShim);
const bootstrap = "process.argv=[process.argv[0],'x',...JSON.parse(process.env.TEST_LITERAL_ARGS)];require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'scripts','ruflo-hook.cjs'))";
for (const args of [[], ['--fail'], ['--value', '$(touch NEVER); `touch NEVER`']]) {
  const input = JSON.stringify({ hook_event_name: 'Stop', session_id: 'isolated-hook-fixture', cwd: root });
  const result = spawnSync(process.execPath, ['-e', bootstrap], { input, encoding: 'utf8', timeout: 2000,
    env: { ...process.env, HOME: path.join(root, 'empty-home'), CLAUDE_PLUGIN_ROOT: coreRoot,
      NPM_CONFIG_PREFIX: path.dirname(process.env.RUFLO_GLOBAL_ROOT), PATH: path.dirname(npxTrap),
      TEST_HOOK_RECEIPT: receipt, TEST_LITERAL_ARGS: JSON.stringify(args), RUFLO_HOOK_SKIP_NPX: '1' } });
  assert.equal(result.status, 0, result.stderr, 'hook telemetry remains fail-open even when native CLI fails');
  assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  const recorded = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  assert.equal(recorded.status, args.includes('--fail') ? 23 : 0);
  assert.deepEqual(JSON.parse(recorded.stdout), { args: ['hooks', 'session-end', ...args], entry: direct, stdin: input });
  assert.equal(recorded.stderr, 'native stderr');
  assert(!fs.existsSync(trapReceipt)); assert(!fs.existsSync(path.join(root, 'NEVER')));
}
// A malformed/broken newest native install is refusal, never a download or
// fallback to an older package. Only an actual absence was tested above.
const directManifest = path.join(path.dirname(path.dirname(direct)), 'package.json');
const manifestBytes = fs.readFileSync(directManifest, 'utf8');
write(directManifest, JSON.stringify({ name: 'impostor', version: '100.41.2', type: 'module', bin: { 'claude-flow': 'bin/cli.js' } }));
fs.unlinkSync(receipt);
const refusal = spawnSync(process.execPath, ['-e', bootstrap], { input: '{}', encoding: 'utf8', timeout: 2000,
  env: { ...process.env, CLAUDE_PLUGIN_ROOT: coreRoot, NPM_CONFIG_PREFIX: path.dirname(process.env.RUFLO_GLOBAL_ROOT),
    PATH: path.dirname(npxTrap), TEST_HOOK_RECEIPT: receipt, TEST_LITERAL_ARGS: '[]' } });
assert.equal(refusal.status, 0); assert.match(refusal.stderr, /Native hook implementation refused.*unrecognized/);
assert(!fs.existsSync(receipt)); assert(!fs.existsSync(trapReceipt));
write(directManifest, manifestBytes);
const hookRestore = c.reconcile([], ['ruflo-wrapper-guard']); assert.equal(hookRestore.errors, 0);
assert.equal(fs.readFileSync(coreHook, 'utf8'), fullShim);
console.log('✓ wrapper guard: newest native CLI/version/MCP delegation, literal argv/stdin/exit, exact source drift, idempotence, pristine restore');
