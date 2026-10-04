import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { patchSource, reverseSource, isPatched } from '../lib/brain-host-recovery/patcher.mjs';
import { modernInstallerEdits } from '../lib/brain-console-lifecycle/modern.mjs';
const read = name => fs.readFileSync(new URL('./fixtures/brain-host-recovery/' + name, import.meta.url), 'utf8');
const installer = read('installer.mjs'), scheduler = read('scheduler.mjs');
for (const source of [installer, scheduler]) {
  const result = patchSource(source);
  assert.deepEqual(result.missing, []);
  assert(isPatched(result.next));
  assert.equal(reverseSource(result.next), source);
  assert.equal(patchSource(result.next).next, result.next);
  for (const drift of [source + source, result.next + result.next, source.replace('export function', 'function')]) {
    // Removing export only changes installer anchors; scheduler's internal anchors still apply.
    if (drift === source.replace('export function', 'function') && source === scheduler) continue;
    assert(patchSource(drift).missing.length);
    assert.equal(patchSource(drift).next, drift);
  }
}
const receipt = { desiredVersion: '4.5.5', hosts: {
  claude: { state: 'ready', version: '4.5.5', restartRequired: true, restartScope: 'open-sessions' },
  codex: { state: 'ready', version: '4.5.5', restartRequired: true, restartScope: 'unproven' },
}, consoleRuntime: { state: 'ready' } };
const plugin = { available: true, installed: true, enabled: true, version: '4.5.5' };
const manifest = { hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'node current-hook.mjs', timeout: 10 }] }] } };
const hook = { key: 'one', pluginId: 'ruvnet-brain@ruvnet-brain', eventName: 'stop',
  handlerType: 'command', enabled: true, trustStatus: 'trusted', currentHash: 'sha256:' + 'a'.repeat(64),
  sourcePath: '/cache/4.5.5/hooks/codex-hooks.json', command: 'node current-hook.mjs', timeoutSec: 10 };
const listed = { ok: true, value: { data: [{ hooks: [hook], warnings: [], errors: [] }] } };
function context(overrides = {}) {
  let reads = 0;
  return { PACKAGE_VERSION: '4.5.5', CODEX_PLUGIN_ID: hook.pluginId, path,
    fs: { realpathSync: file => file, readFileSync: () => { reads++; return JSON.stringify(manifest); } },
    codexPluginStatus: () => structuredClone(plugin), codexInstalledPluginRoot: () => '/cache/4.5.5',
    codexHooksList: async () => structuredClone(listed), versionSatisfies: (a, b) => a === b,
    openSessionsNotice: () => 'Existing windows may need restart', check: () => {}, hostConvergence: {},
    recorded: structuredClone(receipt), ...overrides };
}
const body = patchSource(installer).next.replaceAll('export function', 'function');
async function prove(overrides = {}) {
  return await vm.runInNewContext(body + '\nrspProveFreshCodexHost(recorded)', context(overrides), { timeout: 1000 });
}
const pristineResult = vm.runInNewContext(installer.replaceAll('export function', 'function')
  + '\nclassifyHostConvergence(recorded)', context(), { timeout: 1000 });
assert.equal(pristineResult.state, 'host-restart-required');
const original = JSON.stringify(receipt);
const result = await prove();
assert.equal(result.healthy, true);
assert.equal(result.state, 'fresh-host-ready');
assert.match(result.notice, /Already-open windows/);
assert.equal(JSON.stringify(receipt), original);
for (const changes of [
  { enabled: false }, { trustStatus: 'modified' }, { trustStatus: 'untrusted' }, { trustStatus: undefined },
  { command: 'node old-hook.mjs' }, { sourcePath: '/cache/4.5.4/hooks/codex-hooks.json' },
  { timeoutSec: 9 }, { eventName: 'sessionEnd' }, { currentHash: '' }, { matcher: 'extra' },
]) assert.equal(await prove({ codexHooksList: async () => ({ ok: true, value: { data: [
  { hooks: [{ ...hook, ...changes }], errors: [], warnings: [] },
] } }) }), null);
for (const broken of [
  { ok: false }, { ok: true, value: { data: [] } },
  { ok: true, value: { data: [{ hooks: [], errors: [] }] } },
  { ok: true, value: { data: [{ hooks: [hook, hook], errors: [] }] } },
  { ok: true, value: { data: [{ hooks: [hook], errors: ['runtime error'] }] } },
]) assert.equal(await prove({ codexHooksList: async () => broken }), null);
assert.equal(await prove({ codexPluginStatus: () => ({ ...plugin, version: '4.5.4' }) }), null);
assert.equal(await prove({ recorded: { ...receipt, consoleRuntime: { state: 'stale' } } }), null);
assert.equal(await prove({ fs: { realpathSync() { throw Error('missing'); } } }), null);
let calls = 0;
assert.equal(await prove({ codexPluginStatus: () => ({ ...plugin, version: ++calls > 1 ? '4.5.6' : '4.5.5' }) }), null);
// Failure attribution: optional cleanup must not replace the first required failed phase.
const refresh = { status: 'FAILED', requiredPhaseOrder: ['update', 'host-convergence', 'cleanup'], phases: [
  { phase: 'update', status: 'PASS', required: true },
  { phase: 'host-convergence', status: 'FAIL', required: true, evidence: { error: 'pending trust' } },
  { phase: 'cleanup', status: 'SKIP', required: false, evidence: { reason: 'upstream required phase failed' } },
] };
const describe = (source, value) => vm.runInNewContext(source.replace('export function', 'function')
  + '\ndescribeFailedRefreshRun(receipt)', { receipt: value }, { timeout: 1000 });
assert.match(describe(scheduler, refresh), /failed at cleanup/);
assert.equal(describe(patchSource(scheduler).next, refresh), 'failed at host-convergence: pending trust');
assert.equal(describe(patchSource(scheduler).next, { ...refresh, status: 'PASS' }), null);
assert.equal(describe(patchSource(scheduler).next, { ...refresh, requiredPhaseOrder: ['different'] }), null);
// Sibling doctor insertion remains composable and removal preserves unrelated bytes.
const [, anchor, replacement] = modernInstallerEdits('fixture', 'unused', 'unused2', 'unused3')
  .find(([name]) => name === 'doctor-structured-gate');
assert(installer.includes(anchor));
const sibling = installer.replace(anchor, replacement);
assert.equal(patchSource(sibling).next, patchSource(installer).next.replace(anchor, replacement));
assert.equal(reverseSource(patchSource(sibling).next), sibling);
console.log('Brain host recovery: native failure, fresh-host proof, negative trust/version/declaration cases, immutable history, causal failure attribution, exact reverse and drift guards PASS');
