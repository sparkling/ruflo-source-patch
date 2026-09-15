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
// Known lifecycle shims call the implementation package through npx: never the
// `ruflo` wrapper (#3306's stale nested runtime), never a PATH binary (a global
// install the documented npx path does not create), never a stderr refusal.
const NPX_ARGS = ['--prefer-offline', '--yes', '@claude-flow/cli@latest'];
const hookArgs = ['-c', 'echo hello; $(not-a-command)'];
for (const [anchor, replacement, prior, legacy] of [
  [h.HOOK_ANCHOR, h.HOOK_REPLACEMENT, h.PRIOR_HOOK_REPLACEMENT, false],
  [h.LEGACY_ANCHOR, h.LEGACY_REPLACEMENT, h.PRIOR_LEGACY_REPLACEMENT, true],
]) {
  const fixture = legacy
    ? `function invokeHook() {}\nfunction main() {\n${anchor}\n}`
    : `function invokeHook() {}\nfunction invokeCli(hookSubcommand, hookArgs, stdinData) {\n${anchor}`;
  const result = p.patchSource(fixture);
  assert.deepEqual(result.missing, []);
  assert(p.isPatched(result.next));
  assert(result.next.includes(replacement));
  assert.equal(p.reverseSource(result.next), fixture);
  assert.deepEqual(p.patchSource(fixture + anchor).missing, ['unique-hook-wrapper-selection']);
  // The earlier PATH-only refusal (claude-flow or exit 1) is ours, not current, migrates in place, and reverses.
  const stale = fixture.replace(anchor, prior);
  assert(p.hasPatch(stale) && !p.isPatched(stale));
  const migrated = p.patchSource(stale);
  assert.deepEqual(migrated.missing, []);
  assert.equal(migrated.next, result.next);
  assert.equal(p.reverseSource(stale), fixture);
  for (const skip of [false, true]) {
    const calls = [];
    let exit = null;
    const context = {
      hookSubcommand: 'post-command', hookArgs, stdinData: 'payload',
      commandExists: name => { throw new Error(`PATH probe for ${name}`); },
      invokeHook: (...args) => calls.push(args),
      done: () => { exit = 0; throw new Error('exit:0'); },
      fs: { writeSync: () => { throw new Error('stderr refusal'); } },
      process: { env: skip ? { RUFLO_HOOK_SKIP_NPX: '1' } : {}, exit: code => { exit = code; throw new Error(`exit:${code}`); } },
    };
    const body = legacy ? replacement : replacement.slice(0, -1);
    try { vm.runInNewContext(`(function(){${body}})()`, context); }
    catch (error) { assert.equal(error.message, 'exit:0'); }
    // Arrays built inside the vm realm carry that realm's prototype; compare structure.
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), skip ? [] : [legacy
      ? ['npx', NPX_ARGS, hookArgs, 'payload']
      : ['npx', NPX_ARGS, 'post-command', hookArgs, 'payload']]);
    assert.equal(exit, legacy ? 0 : null);
  }
}
console.log('✓ wrapper guard: newest native CLI/version/MCP delegation, literal argv/stdin/exit, exact source drift, idempotence, pristine restore');
