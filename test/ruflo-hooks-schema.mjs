// Current native hook retirement: exact additive manifest and detached telemetry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
fs.mkdirSync(root, { recursive: true });
process.env.RUFLO_SOURCE_PATCH_HOME = path.join(root, 'home');
process.env.RSP_CODEX_HOME = path.join(root, 'home', '.codex');
const { isNativeSchema, probeNativeShim, descriptor } = await import('../lib/ruflo-hooks-schema/patcher.mjs');
const { patchSource: addLogger } = await import('../lib/hook-failure-log/patcher.mjs');

const command = subcommand => `node -e "process.argv=[process.argv[0],'x',${subcommand}];require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'scripts','ruflo-hook.cjs'))"`;
const group = (matcher, subcommand) => ({ matcher, hooks: [{ type: 'command', command: command(`'${subcommand}'`) }] });
const manifest = {
  description: 'Native Ruflo lifecycle',
  hooks: {
    PreToolUse: [group('Bash', 'modify-bash'), group('Write|Edit|MultiEdit', 'modify-file')],
    PostToolUse: [group('Bash', 'post-command'), group('Write|Edit|MultiEdit', 'post-edit')],
    PostToolUseFailure: [group('Bash', 'post-command'), group('Write|Edit|MultiEdit', 'post-edit')],
    PreCompact: [group('manual', 'precompact-manual'), group('auto', 'precompact-auto')],
    Stop: [{ hooks: [{ type: 'command', command: command("'session-end','--generate-summary','true','--persist-state','true','--export-metrics','true'") }] }],
  },
};
const source = JSON.stringify(manifest);
assert.equal(isNativeSchema(source), true, 'recognizes the exact native nine-handler manifest');
assert.equal(isNativeSchema(addLogger(source).next), true, 'preserves the separately owned failure logger');
assert.equal(descriptor.patchSource(source).next, source, 'native manifest is not rewritten');

for (const [name, change] of [
  ['unknown top-level key', value => { value.extra = true; }],
  ['same count with missing required event', value => { value.hooks.Unknown = value.hooks.PreToolUse; delete value.hooks.PreToolUse; }],
  ['wrong matcher', value => { value.hooks.PreToolUse[0].matcher = '*'; }],
  ['unknown handler option', value => { value.hooks.PreToolUse[0].hooks[0].extra = true; }],
  ['wrong command', value => { value.hooks.PreToolUse[0].hooks[0].command = 'node unrelated.cjs'; }],
  ['foreign preload', value => { value.hooks.PreToolUse[0].hooks[0].command = value.hooks.PreToolUse[0].hooks[0].command.replace('node ', 'node --require /foreign/runtime.cjs '); }],
  ['extra handler', value => { value.hooks.Stop[0].hooks.push({ type: 'command', command: 'node extra.cjs' }); }],
]) {
  const changed = structuredClone(manifest);
  change(changed);
  assert.equal(isNativeSchema(JSON.stringify(changed)), false, name);
}
const legacy = structuredClone(manifest);
delete legacy.hooks.PostToolUseFailure;
assert.equal(isNativeSchema(JSON.stringify(legacy)), true, 'retains the seven-handler native predecessor');
const invalidHeader = JSON.stringify({ _note: 'legacy', _platform_note: 'legacy', hooks: manifest.hooks }, null, 2);
assert.ok(descriptor.patchSource(invalidHeader).missing.includes('known-invalid-header-with-seven-handlers'),
  'new native shape never broadens the legacy invalid-header rewrite');

const shim = path.join(root, 'ruflo-hook.cjs');
const detachedChild = `setTimeout(() => {
  const args = [...process.env.RUFLO_HOOK_CLI_OVERRIDE.matchAll(/"([^"]*)"|(\\S+)/g)].map(m => m[1] ?? m[2]);
  require('node:child_process').spawnSync(args[0], [...args.slice(1), 'hooks', process.argv[1]], { env: process.env });
}, 120);`;
fs.writeFileSync(shim, `const child = require('node:child_process').spawn(process.execPath,
  ['-e', ${JSON.stringify(detachedChild)}, process.argv[2]],
  { env: process.env, stdio: 'ignore', detached: true });
child.unref();
`);
assert.equal(probeNativeShim(shim).valid, true, 'waits for both owned detached CLI receipts');

fs.writeFileSync(shim, "process.exit(0);\n");
const before = Date.now();
assert.equal(probeNativeShim(shim).valid, false, 'empty success cannot substitute for telemetry');
assert.ok(Date.now() - before < 5000, 'missing telemetry remains bounded');
fs.writeFileSync(shim, `require('node:fs').appendFileSync(process.env.RSP_HOOK_PROBE_LOG, 'hooks ' + process.argv[2] + '\\n');
process.stdout.write('{"permission":"allow"}');
`);
assert.equal(probeNativeShim(shim).valid, false, 'telemetry cannot excuse an invalid Codex verdict');
fs.writeFileSync(shim, `require('node:fs').appendFileSync(process.env.RSP_HOOK_PROBE_LOG, 'hooks ' + process.argv[2] + '\\n');
process.exit(1);
`);
assert.equal(probeNativeShim(shim).valid, false, 'telemetry cannot excuse a failed shim');
console.log('Current Ruflo hook retirement proof passed');
