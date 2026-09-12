import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('absolute isolated fixture root required');
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
write(direct, 'process.stdout.write("DIRECT_IMPLEMENTATION_OK");\n');
const pristineDirect = fs.readFileSync(direct, 'utf8');
assert.equal(p.discover().length, 3);
assert.deepEqual(p.patchSource(p.WRAPPER_SOURCE).missing, []);
assert.equal(p.reverseSource(p.REFUSAL_SOURCE), p.WRAPPER_SOURCE);
assert.equal(p.patchSource(p.REFUSAL_SOURCE).next, p.REFUSAL_SOURCE);
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

const applied = c.applyComposed(['ruflo-wrapper-guard']);
assert.equal(applied.errors, 0, applied.log.join('\n'));
assert.equal(applied.incomplete, 0);
assert.equal(applied.patched, 3);
assert.equal(c.applyComposed(['ruflo-wrapper-guard']).unchanged, 3);
assert.deepEqual(c.statusComposed()['ruflo-wrapper-guard'], { files: 3, patched: 3 });
assert.equal(fs.readFileSync(direct, 'utf8'), pristineDirect);
assert.equal(spawnSync(process.execPath, [direct], { encoding: 'utf8' }).stdout, 'DIRECT_IMPLEMENTATION_OK');

for (const pkg of roots) {
  const file = path.join(pkg, 'bin/ruflo.js');
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), p.WRAPPER_SOURCE);
  for (const args of [[], ['--version'], ['-V'], ['--help'], ['mcp', 'start'],
    ['memory', 'store', '--value', '$(touch NEVER); `touch NEVER`']]) {
    const result = spawnSync(process.execPath, [file, ...args], {
      encoding: 'utf8', timeout: 2000, input: '{"jsonrpc":"2.0","method":"initialize","id":1}\n', cwd: root,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, '', 'MCP stdout must remain empty');
    assert.match(result.stderr, /REFUSING.*wrapper/);
    assert.match(result.stderr, /--package=@claude-flow\/cli@latest -- claude-flow/);
    assert.match(result.stderr, /issues\/3306/);
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
for (const [anchor, replacement, legacy] of [
  [h.HOOK_ANCHOR, h.HOOK_REPLACEMENT, false],
  [h.LEGACY_ANCHOR, h.LEGACY_REPLACEMENT, true],
]) {
  const fixture = legacy
    ? `function invokeHook() {}\nfunction main() {\n${anchor}\n}`
    : `function invokeHook() {}\nfunction invokeCli(hookSubcommand, hookArgs, stdinData) {\n${anchor}`;
  const result = p.patchSource(fixture);
  assert.deepEqual(result.missing, []);
  assert(p.isPatched(result.next));
  assert.equal(p.reverseSource(result.next), fixture);
  assert.deepEqual(p.patchSource(fixture + anchor).missing, ['unique-hook-wrapper-selection']);
  for (const available of [true, false]) {
    const calls = [];
    let stderr = '';
    let exit = null;
    const context = {
      hookSubcommand: 'post-command', hookArgs: ['-c', 'echo hello; $(not-a-command)'], stdinData: 'payload',
      commandExists: name => { calls.push(['probe', name]); return available; },
      invokeHook: (...args) => calls.push(['invoke', ...args]),
      done: () => { throw new Error('exit:0'); },
      fs: { writeSync: (fd, message) => { assert.equal(fd, 2); stderr += message; } },
      process: { exit: code => { exit = code; throw new Error(`exit:${code}`); } },
    };
    const body = legacy ? replacement : replacement.slice(0, -1);
    try { vm.runInNewContext(`(function(){${body}})()`, context); }
    catch (error) { assert.match(error.message, /^exit:[01]$/); }
    assert.deepEqual(calls[0], ['probe', 'claude-flow']);
    if (available) {
      assert.equal(calls[1][1], 'claude-flow');
      assert.equal(stderr, '');
    } else {
      assert.equal(calls.length, 1);
      assert.equal(exit, 1);
      assert.match(stderr, /No wrapper or npx fallback/);
    }
  }
}
console.log('✓ wrapper guard: nonzero CLI/version/MCP refusal, no delegation, exact source drift, discovery, idempotence, pristine restore');
