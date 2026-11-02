import assert from 'node:assert/strict';
import vm from 'node:vm';
import { patchSource, reverseSource, isPatched, descriptor } from '../lib/brain-capture-budget/patcher.mjs';
const command = event => `node -e "spawn({env:process.env,timeout:Number(process.argv[1])})" ${event === 'SessionEnd' ? 2500 : 9000} session-snapshot ${event}`;
const hooks = Object.fromEntries(['Stop', 'PreCompact', 'SessionEnd'].map(event => [event,
  [{ hooks: [{ type: 'command', command: command(event), timeout: event === 'SessionEnd' ? 3 : 10 }] }]]));
hooks.Stop[0].hooks.push({ type: 'command', command: 'other hook', timeout: 10 });
const source = JSON.stringify({ hooks }, null, 2);
const result = patchSource(source);
assert.deepEqual(result.missing, []);
assert(isPatched(result.next));
assert.equal(reverseSource(result.next), source);
assert.equal(patchSource(result.next).next, result.next);
const patched = JSON.parse(result.next).hooks;
assert.deepEqual(patched.SessionEnd, hooks.SessionEnd);
assert.deepEqual(patched.Stop[0].hooks[1], hooks.Stop[0].hooks[1]);
for (const event of ['Stop', 'PreCompact']) {
  let observed;
  const js = patched[event][0].hooks[0].command.split('"')[1];
  vm.runInNewContext(js, { process: { env: { EXISTING: 'kept' }, argv: ['node', '9000'] }, spawn: options => { observed = options; } });
  assert.equal(observed.env.EXISTING, 'kept');
  assert.equal(observed.env.RUVNET_CODEX_HOOK_TIMEOUT_MS, '8500');
  assert.equal(observed.timeout, 9000);
  vm.runInNewContext(js, { process: { env: { RUVNET_CODEX_HOOK_TIMEOUT_MS: '2400' }, argv: ['node', '9000'] }, spawn: options => { observed = options; } });
  assert.equal(observed.env.RUVNET_CODEX_HOOK_TIMEOUT_MS, '2400');
}
const previous = descriptor.historicalPatchSource(source).next;
assert.equal(reverseSource(previous), source);
assert(!isPatched(previous));
assert.notEqual(previous, result.next);
assert(patchSource(source.replace('9000 session-snapshot Stop', '5000 session-snapshot Stop')).missing.length);
assert(patchSource(source.replace('env:process.env', 'env:changed')).missing.length);
console.log('brain-capture-budget: passed');
