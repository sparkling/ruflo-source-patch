import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import os from 'node:os';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { codexHookIdentities, codexHookHash } from './fixtures/brain-host-recovery/trust-native-4.5.8.mjs';
import { patchSource, reverseSource, isPatched, historicalPatchSource, preflight, applicability } from '../lib/brain-host-recovery/patcher.mjs';
import { pluginStatusHealthy } from '../lib/plugin-registry.mjs';
import { modernInstallerEdits } from '../lib/brain-console-lifecycle/modern.mjs';
const read = name => fs.readFileSync(new URL('./fixtures/brain-host-recovery/' + name, import.meta.url), 'utf8');
const installer = read('installer.mjs'), scheduler = read('scheduler.mjs');
const nativeScheduler = read('scheduler-native-4.5.7.mjs').trimEnd() + '\n\nfunction sameExecutable() {}';
assert.deepEqual(patchSource(nativeScheduler), { next: nativeScheduler, applied: [], missing: [] });
assert(!nativeScheduler.includes('ruflo-source-patch'));
assert(patchSource(nativeScheduler.replace("entry?.required !== false", 'true')).missing.length);
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
  codex: { sessionSafetyReason: 'boot-level declarations changed: hooks/codex-hooks.json', state: 'ready', version: '4.5.5', restartRequired: true, restartScope: 'unproven' },
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
assert.equal(describe(nativeScheduler, refresh), 'failed at host-convergence: pending trust');
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

// Public v4.5.8 installer projection keeps executable and MCP readiness unproven.
const nativeInstaller = read('installer-native-4.5.8.mjs');
assert.deepEqual(patchSource(nativeInstaller), { next: nativeInstaller, applied: [], missing: [] });
assert.equal(reverseSource(nativeInstaller), nativeInstaller);
for (const drift of [nativeInstaller + nativeInstaller,
  nativeInstaller.replace("proof.state !== 'fresh-declarations-ready'", 'false'),
  nativeInstaller.replace("['hooks/codex-hooks.json', 'hooks/hooks.json']", "['mcp/server.mjs']"),
  nativeInstaller.replace('hostConvergence = reconcileFreshCodexDeclarations(recorded, fresh);', 'hostConvergence = { healthy: true };')]) {
  assert(patchSource(drift).missing.length); assert.equal(patchSource(drift).next, drift);
}
const oldOverlay = historicalPatchSource(installer).next;
assert.equal(reverseSource(oldOverlay), installer);
assert.equal(patchSource(oldOverlay).next, patchSource(installer).next);
assert.equal(patchSource(historicalPatchSource(sibling).next).next, patchSource(sibling).next);
assert.equal(reverseSource(historicalPatchSource(sibling).next), sibling);
assert(patchSource(oldOverlay.replace('const plugin = codexPluginStatus();', 'const plugin = {};')).missing.length);
const stripImports = source => source.replace(/^import .*;$/gm, '').replace(/^export (?=(?:async )?function)/gm, '');
const nativeBody = stripImports(nativeInstaller);
const goodProof = { ok: true, state: 'fresh-declarations-ready', expectedVersion: '4.5.5' };
const reconcile = (recorded = receipt, proof = goodProof) => vm.runInNewContext(nativeBody
  + '\nreconcileFreshCodexDeclarations(recorded, proof)', { ...context(), recorded, proof }, { timeout: 1000 });
assert.equal(reconcile().state, 'fresh-declarations-ready');
const doctorContext = context({ proof: goodProof, process: { env: {}, cwd: () => '/project' },
  convergencePath: '/receipt/host-convergence.json', REPO_ROOT: '/release', codexHomeDir: () => '/codex',
  probeFreshCodexDeclarations: async () => goodProof, reconcileFreshCodexDeclarations: undefined,
  info: () => {}, warn: () => {} });
await vm.runInNewContext(nativeBody + '\ndoctorFixture()', doctorContext, { timeout: 1000 });
assert.equal(doctorContext.hostConvergence.state, 'fresh-declarations-ready');

for (const reason of [undefined, '', 'unknown', 'boot-level declarations changed: mcp/server.mjs',
  'boot-level declarations changed: .mcp.json', 'boot-level declarations changed: hooks/codex-hooks.json, hooks/body.mjs']) {
  const recorded = { ...receipt, hosts: { ...receipt.hosts, codex: { ...receipt.hosts.codex, sessionSafetyReason: reason } } };
  assert.equal(await prove({ recorded }), null);
  assert.equal(reconcile(recorded).healthy, false);
}
for (const recorded of [
  { ...receipt, desiredVersion: '4.5.4' },
  { ...receipt, consoleRuntime: { state: 'stale' } },
  ...[{ state: 'pending' }, { version: '4.5.4' }, { restartRequired: true, restartScope: 'unproven' }]
    .map(change => ({ ...receipt, hosts: { ...receipt.hosts, claude: { ...receipt.hosts.claude, ...change } } })),
]) assert.equal(reconcile(recorded).healthy, false);
for (const proof of [{}, { ...goodProof, ok: false }, { ...goodProof, expectedVersion: '4.5.4' },
  { ...goodProof, state: 'unproven' }]) assert.equal(reconcile(receipt, proof).healthy, false);
assert.equal(JSON.stringify(receipt), original);
// Execute the public native declaration classifier with immutable synthetic filesystem metadata.
const nativeManifest = { name: 'ruvnet-brain', version: '4.5.5' };
const surface = [Buffer.from(JSON.stringify(nativeManifest)), Buffer.from(JSON.stringify(manifest))];
const hashes = Object.fromEntries(['.codex-plugin/plugin.json', 'hooks/codex-hooks.json']
  .map((file, index) => [file, crypto.createHash('sha256').update(surface[index]).digest('hex')]));
const [key, currentHash] = [...codexHookIdentities(manifest)][0];
const cacheRoot = '/codex/plugins/cache/ruvnet-brain/ruvnet-brain/4.5.5';
const nativeHook = { ...hook, key, currentHash, source: 'plugin', sourcePath: cacheRoot + '/hooks/codex-hooks.json' };
function classifyNative(changes = {}, options = {}) {
  const args = { plugin, expectedVersion: '4.5.5', codexHome: '/codex', cwd: '/project',
    target: { manifest: nativeManifest, hooks: manifest, hashes },
    listed: { data: [{ cwd: '/project', hooks: [{ ...nativeHook, ...changes }], errors: [], warnings: [] }] }, ...options };
  return vm.runInNewContext(stripImports(read('fresh-proof-native-4.5.8.mjs'))
    + '\nclassifyFreshCodexDeclarations(args)', { args, path, crypto, codexHookIdentities, codexHookHash,
    fs: { realpathSync: value => value, lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false, size: 100 }),
      readFileSync: file => surface[file.endsWith('plugin.json') ? 0 : 1] } }, { timeout: 1000 });
}
assert.equal(classifyNative().ok, true);
assert.equal(classifyNative().mcpReadiness, 'unknown');
for (const change of [{ trustStatus: 'untrusted' }, { trustStatus: 'modified' }, { enabled: false },
  { command: 'node changed-body.mjs' }, { currentHash: 'sha256:bad' }, { source: 'project' }]) assert.equal(classifyNative(change).ok, false);
assert.equal(classifyNative({}, { plugin: { ...plugin, version: '4.5.4' } }).ok, false);
assert.equal(classifyNative({}, { listed: { data: [] } }).ok, false);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-host-proof-'));
try {
  fs.mkdirSync(path.join(temp, 'bin')); const file = path.join(temp, 'bin/install.mjs');
  fs.writeFileSync(file, nativeInstaller);
  assert.equal(preflight([file]).ok, false); // Native no-op cannot green-light a missing helper.
  assert.equal(applicability([file]).state, 'error');
  assert.equal(pluginStatusHealthy({ files: 1, patched: 1, applicability: applicability([file]) }), false);
  // Old #391 may already overlay the newly native installer. Reversal must not skip dependency proof.
  const withChecks = nativeInstaller.replace('      if (hostConvergence.healthy) {}',
    '      if (hostConvergence.healthy) {}\n  const checks = [ ];');
  const previousNativeOverlay = historicalPatchSource(withChecks).next;
  assert(previousNativeOverlay.includes('rspProveFreshCodexHost'));
  assert.equal(reverseSource(previousNativeOverlay), withChecks);
  fs.writeFileSync(file, previousNativeOverlay);
  assert.equal(preflight([file]).ok, false);
  assert.equal(applicability([file]).state, 'error');
  assert.equal(pluginStatusHealthy({ files: 1, patched: 1, applicability: applicability([file]) }), false);

  fs.mkdirSync(path.join(temp, 'scripts'));
  fs.writeFileSync(path.join(temp, 'scripts/codex-fresh-host-proof.mjs'), 'unreviewed');
  assert.equal(preflight([file]).ok, false);
  assert.equal(applicability([file]).state, 'error');
  fs.writeFileSync(file, nativeInstaller);
  assert.equal(applicability([file]).state, 'error');
  fs.writeFileSync(file, installer);
  assert.equal(applicability([file]).state, 'applicable');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log('Brain 4.5.8 native scope refusal, exact declaration trust, missing/drifted dependency refusal and legacy overlay migration PASS');

// Both content-aware native renditions must pass the same complete approval contract.
for (const [version, prefix] of [['4.7.19', 'native-4.7.19/'], ['4.7.21', 'native-4.7.21/scripts/']]) {
const modernTrust = await import(new URL('./fixtures/brain-host-recovery/' + prefix + 'codex-hook-trust.mjs', import.meta.url));
const modernReconcile = await import(new URL('./fixtures/brain-host-recovery/' + prefix + 'codex-hook-trust-reconcile.mjs', import.meta.url));
const modernRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-host-' + version + '-'));
try {
  fs.mkdirSync(path.join(modernRoot, 'bin')); fs.mkdirSync(path.join(modernRoot, 'scripts'));
  const file = path.join(modernRoot, 'bin/install.mjs'); fs.writeFileSync(file, nativeInstaller);
  const helpers = {
    'codex-fresh-host-proof.mjs': 'fresh-proof-native-4.5.8.mjs',
    'codex-hook-trust.mjs': 'trust-native-4.5.8.mjs',
    'codex-hook-trust-reconcile.mjs': 'trust-reconcile-native-4.5.8.mjs',
  };
  for (const [name, fixture] of Object.entries(helpers)) fs.writeFileSync(path.join(modernRoot, 'scripts', name), read(fixture));
  assert.equal(preflight([file]).ok, true, 'previous native helper set remains supported');
  if (version === '4.7.21') {
    const entrypoint = path.join(modernRoot, 'plugin/scripts/entrypoint.mjs');
    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.writeFileSync(entrypoint, read('native-4.7.21/plugin/scripts/entrypoint.mjs'));
  }
  for (const name of ['codex-hook-trust.mjs', 'codex-hook-trust-reconcile.mjs']) {
    fs.writeFileSync(path.join(modernRoot, 'scripts', name), read(prefix + name));
    assert.equal(preflight([file]).ok, name === 'codex-hook-trust-reconcile.mjs', 'mixed helper sets must fail');
  }
  if (version === '4.7.21') {
    const entrypoint = path.join(modernRoot, 'plugin/scripts/entrypoint.mjs');
    const pristine = fs.readFileSync(entrypoint, 'utf8');
    fs.appendFileSync(entrypoint, '\n// unreviewed dependency');
    assert.equal(preflight([file]).ok, false, 'new transitive entrypoint dependency must be reviewed too');
    fs.writeFileSync(entrypoint, pristine);
    fs.renameSync(entrypoint, entrypoint + '.outside'); fs.symlinkSync(entrypoint + '.outside', entrypoint);
    assert.equal(preflight([file]).ok, false, 'linked native dependency must fail closed');
    fs.unlinkSync(entrypoint); fs.renameSync(entrypoint + '.outside', entrypoint);
  }
  fs.appendFileSync(path.join(modernRoot, 'scripts/codex-hook-trust.mjs'), '\n// unreviewed');
  assert.equal(preflight([file]).ok, false, 'a changed helper is not blessed by its version');

  const pluginRoot = path.join(modernRoot, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
  const hooksPath = path.join(pluginRoot, 'hooks/codex-hooks.json');
  fs.writeFileSync(hooksPath, JSON.stringify(manifest));
  const executable = path.join(pluginRoot, 'body.mjs'); fs.writeFileSync(executable, 'export const approved = true;\n');
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const pluginFiles = new Map(['hooks/codex-hooks.json', 'body.mjs',
    ...(version === '4.7.21' ? ['scripts/entrypoint.mjs'] : [])].map(name =>
    [name, sha(fs.readFileSync(path.join(pluginRoot, name)))]));
  const contentHash = modernTrust.codexPluginContentHash(pluginRoot);
  assert.equal(modernReconcile.verifiedPluginContentHash(pluginRoot, pluginFiles), contentHash);
  fs.appendFileSync(executable, '// changed executable');
  assert.throws(() => modernReconcile.verifiedPluginContentHash(pluginRoot, pluginFiles), /differs from the verified release/);
  fs.writeFileSync(executable, 'export const approved = true;\n');
  fs.writeFileSync(path.join(pluginRoot, 'extra.mjs'), 'extra');
  assert.throws(() => modernReconcile.verifiedPluginContentHash(pluginRoot, pluginFiles), /differs from the verified release/);
  fs.unlinkSync(path.join(pluginRoot, 'extra.mjs'));
  fs.symlinkSync(executable, path.join(pluginRoot, 'link.mjs'));
  assert.throws(() => modernTrust.codexPluginContentHash(pluginRoot), /unsupported plugin entry/);
  fs.unlinkSync(path.join(pluginRoot, 'link.mjs'));

  const configPath = path.join(modernRoot, 'config.toml'); fs.writeFileSync(configPath, '# synthetic config\n');
  const identities = modernTrust.codexHookIdentities(manifest);
  const state = { model: 'unchanged', hooks: { state: {} } }; const edits = [];
  let observedContent = contentHash;
  const rpc = async (method, params) => {
    if (method === 'hooks/list') return { data: [{ hooks: [...identities].map(([key, declaration]) => ({
      key, pluginId: 'ruvnet-brain@ruvnet-brain', enabled: true,
      currentHash: declaration + '/' + observedContent,
      trustStatus: state.hooks.state[key]?.trusted_hash === declaration
        && state.hooks.state[key]?.trusted_content_hash === observedContent ? 'trusted' : 'modified',
    })) }] };
    if (method === 'config/read') return { layers: [{ name: { type: 'user', file: configPath },
      version: 'fixture', config: structuredClone(state) }] };
    assert.equal(method, 'config/batchWrite'); assert.equal(params.expectedVersion, 'fixture');
    assert.equal(params.reloadUserConfig, true);
    for (const edit of params.edits) {
      const match = /^hooks\.state\.(".*")\.(trusted_hash|trusted_content_hash)$/.exec(edit.keyPath);
      assert(match); const key = JSON.parse(match[1]);
      (state.hooks.state[key] ||= {})[match[2]] = edit.value; edits.push(edit);
    }
    return { status: 'ok' };
  };
  const args = { releaseIdentity: { version, integrity: 'sha512-' + Buffer.alloc(64).toString('base64'),
    hooksSha256: sha(fs.readFileSync(hooksPath)), pluginFiles }, installedVersion: version, hooksPath,
    configPath, cwd: modernRoot, backupDir: path.join(modernRoot, 'backups'), rpc };
  assert.equal((await modernReconcile.reconcileVerifiedCodexHookTrust(args)).state, 'registry-verified');
  assert.equal(edits.length, identities.size * 2);
  for (const [key, declaration] of identities) assert.deepEqual(state.hooks.state[key],
    { trusted_hash: declaration, trusted_content_hash: contentHash });
  assert.equal(state.model, 'unchanged');
  assert.equal((await modernReconcile.reconcileVerifiedCodexHookTrust(args)).state, 'unchanged');
  assert.equal(edits.length, identities.size * 2, 'repeat review must not rewrite approvals');
  observedContent = 'sha256:' + '0'.repeat(64);
  assert.equal((await modernReconcile.reconcileVerifiedCodexHookTrust(args)).state, 'blocked');
  assert.equal(edits.length, identities.size * 2, 'different host content must not be approved');
  observedContent = contentHash; fs.appendFileSync(executable, '// drift');
  assert.equal((await modernReconcile.reconcileVerifiedCodexHookTrust(args)).state, 'blocked');
  assert.equal(edits.length, identities.size * 2, 'modified executable must not be approved');

  if (version === '4.7.21') {
    assert.deepEqual(modernTrust.codexTrustChanges(manifest, manifest), []);
    const changed = modernTrust.codexTrustChanges(manifest, manifest, undefined, { contentChanged: true });
    assert.equal(changed.length, identities.size);
    assert(changed.every(row => row.status === 'modified' && row.reason === 'plugin-content'));
    for (const [text, expected] of [['codex-cli 0.163.0', false], ['codex-cli 0.164.0', true],
      ['codex-cli 1.0.0', true], ['unknown', null]]) assert.equal(modernTrust.codexUsesContentTrust(text), expected);

    const control = path.join(modernRoot, 'app-server-control'); fs.mkdirSync(control);
    const socket = path.join(control, 'app-server-control.sock'); const server = net.createServer();
    // Darwin's UNIX socket name bound is shorter than its default TMPDIR. Match
    // Codex's rendezvous symlink to a short physical socket rather than truncating.
    const socketRoot = fs.mkdtempSync('/tmp/rsp-host-socket-');
    const physicalSocket = path.join(socketRoot, 'socket');
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(physicalSocket, resolve); });
    fs.symlinkSync(physicalSocket, socket);
    const requests = [];
    class MockSocket extends EventEmitter {
      closed = false;
      constructor(mode = 'good') { super(); this.mode = mode; }
      send(text) {
        const request = JSON.parse(text); if (!request.id) return;
        requests.push(request);
        if (this.mode === 'silent') return;
        const reply = this.mode === 'refuse' && request.method === 'config/batchWrite'
          ? { id: request.id, error: { message: 'private-config-canary' } }
          : { id: request.id, result: request.method === 'config/read'
            ? { layers: [{ name: { type: 'user', file: configPath }, version: 'fixture' }] } : {} };
        queueMicrotask(() => this.emit('message', JSON.stringify(reply)));
      }
      close() { this.closed = true; }
      terminate() { this.closed = true; }
    }
    try {
      const client = new MockSocket();
      assert.deepEqual(await modernReconcile.refreshSharedCodexAppServer({ codexHome: modernRoot, connect: async () => client }),
        { state: 'refreshed', changed: false, approvalsGranted: 0 });
      assert(client.closed);
      assert.deepEqual(requests.map(row => row.method), ['initialize', 'config/read', 'config/batchWrite']);
      assert.deepEqual(requests[2].params, { filePath: configPath, expectedVersion: 'fixture', reloadUserConfig: true, edits: [] });
      assert.equal(fs.readFileSync(configPath, 'utf8'), '# synthetic config\n');
      const refused = await modernReconcile.refreshSharedCodexAppServer({ codexHome: modernRoot, connect: async () => new MockSocket('refuse') });
      assert.equal(refused.state, 'failed'); assert(!refused.reason.includes('private-config-canary'));
      const silent = new MockSocket('silent');
      const timedOut = await modernReconcile.refreshSharedCodexAppServer({ codexHome: modernRoot, timeoutMs: 20, connect: async () => silent });
      assert.equal(timedOut.state, 'failed'); assert.match(timedOut.reason, /timed out/); assert(silent.closed);
    } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(socketRoot, { recursive: true, force: true }); }
    assert.deepEqual(await modernReconcile.refreshSharedCodexAppServer({ codexHome: modernRoot }),
      { state: 'no-shared-server', changed: false });
  }
} finally { fs.rmSync(modernRoot, { recursive: true, force: true }); }
console.log('Brain ' + version + ': exact helper sets, native composite approvals, idempotence, content drift refusal and supported refresh contract PASS');
}
