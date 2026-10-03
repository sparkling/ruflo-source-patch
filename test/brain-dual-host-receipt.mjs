import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const input = process.argv[2];
if (!input) throw new Error('fixture root required');
process.env.RUFLO_SOURCE_PATCH_HOME = input;
process.env.RSP_RUVNET_BRAIN_HOME = path.join(input, '.cache', 'ruvnet-brain');

const patcher = await import('../lib/brain-dual-host-receipt/patcher.mjs');
const compose = await import('../lib/plugin-compose.mjs');
const { readState } = await import('../lib/cwd/state.mjs');

const fixture = `${patcher.IMPORT_ANCHOR}
import { createHash } from 'node:crypto';
const subscriptionOnlyEnv = () => ({});

${patcher.PERSIST_ANCHOR}

export async function fixtureDeliberate(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const persist = options.persist ?? ((receipt) => persistDeliberationReceipt(receipt, { cwd }));
  const accepted = true;
  const receipt = {
    protocol: 'dual-host-deliberation-v1',
    taskHash: createHash('sha256').update('fixture').digest('hex'),
    hosts: ['claude-code', 'codex'],
    roles: { scribe: 'codex', verifier: 'claude-code' },
    accepted,
  };
  const roles = receipt.roles;
  const artifact = { ok: true };
  const verification = { ok: true, value: { verdict: 'accept' } };
${patcher.RESULT_ANCHOR}
}
`;

const transformed = patcher.patchSource(fixture);
assert.deepEqual(transformed.missing, []);
assert.deepEqual(transformed.applied, [
  'remove-cli-import',
  'emit-mcp-request',
  'caller-owned-persist',
  'truthful-persistence-result',
]);
assert.equal(patcher.isPatched(transformed.next), true);
assert.equal(transformed.next.includes("run('ruflo'"), false);
assert.equal(transformed.next.includes('spawnSync'), false);
assert.equal(patcher.reverseSource(transformed.next), fixture);

const runtime = path.join(input, 'runtime-proof.mjs');
fs.writeFileSync(runtime, transformed.next);
const mod = await import(`${pathToFileURL(runtime).href}?proof=1`);
const receipt = {
  protocol: 'dual-host-deliberation-v1',
  taskHash: '1234567890abcdef',
  hosts: ['claude-code', 'codex'],
  roles: { scribe: 'codex', verifier: 'claude-code' },
  accepted: true,
};
const pending = await mod.persistDeliberationReceipt(receipt, { now: () => 42 });
assert.equal(pending.persisted, false);
assert.deepEqual(pending.request, {
  tool: 'memory_store',
  arguments: {
    namespace: 'ruvnet-brain',
    key: 'dual-deliberation-42-1234567890ab',
    value: JSON.stringify({
      protocol: 'dual-host-deliberation-v1',
      taskHash: '1234567890abcdef',
      hosts: ['claude-code', 'codex'],
      roles: { scribe: 'codex', verifier: 'claude-code' },
      accepted: true,
      verifiedOutcome: true,
      recordedAt: '1970-01-01T00:00:00.042Z',
    }),
  },
});

let received;
const proved = await mod.persistDeliberationReceipt(receipt, {
  now: () => 42,
  persist: async (request) => {
    received = request;
    return { stored: true, verified: true, key: request.arguments.key };
  },
});
assert.deepEqual(received, pending.request);
assert.equal(proved.persisted, true);
const falseProof = await mod.persistDeliberationReceipt(receipt, {
  now: () => 42,
  persist: async () => ({ stored: true, verified: true, key: 'wrong-key' }),
});
assert.equal(falseProof.persisted, false);

// Recorded native Console runtime delivered with Brain 4.5.2. No real host or
// memory driver is called: the two subscriptions and every stage are injected.
const nativeDir = path.join(input, 'native-runtime');
fs.mkdirSync(nativeDir);
const nativeFixtures = new URL('./fixtures/brain-dual-host-native/', import.meta.url);
for (const name of ['subscription-hosts.mjs', 'review-model-defaults.mjs']) {
  fs.copyFileSync(new URL(name, nativeFixtures), path.join(nativeDir, name));
}
const nativeSource = fs.readFileSync(new URL('dual-host-deliberation.mjs', nativeFixtures), 'utf8');
const nativeFile = path.join(nativeDir, 'dual-host-deliberation.mjs');
fs.writeFileSync(nativeFile, nativeSource);
const native = await import(`${pathToFileURL(nativeFile).href}?red=1`);
const options = { now: () => 42, probes: { claude: { eligible: true }, codex: { eligible: true } },
  runHost: async (_host, stage) => ({ ok: true, value: stage === 'verify' ? { verdict: 'accept' } : { draft: true } }) };
const unsafe = await native.deliberate('architecture receipt proof', { ...options, persist: async () => true });
assert.equal(unsafe.learningPersisted, true, 'native red: boolean shortcut falsely proves persistence');
const fixed = patcher.patchSource(nativeSource);
assert.deepEqual(fixed.applied, ['native-exact-key-proof']);
assert.deepEqual(fixed.missing, []);
assert.equal(patcher.isPatched(fixed.next), true);
assert.equal(patcher.reverseSource(fixed.next), nativeSource);
assert.deepEqual(patcher.patchSource(fixed.next), { next: fixed.next, applied: [], missing: [] });
fs.writeFileSync(nativeFile, fixed.next);
const repaired = await import(`${pathToFileURL(nativeFile).href}?green=1`);
for (const proof of [true, false, { stored: true, verified: true, key: 'wrong-key' },
  { stored: true, verified: false, key: unsafe.learningPersistenceRequest.arguments.key }]) {
  const result = await repaired.deliberate('architecture receipt proof', { ...options, persist: async () => proof });
  assert.equal(result.learningPersisted, false);
  assert.equal(result.status, 'accepted');
  assert.equal(result.learningPersistenceRequest.tool, 'memory_store');
}
const pendingNative = await repaired.deliberate('architecture receipt proof', options);
assert.equal(pendingNative.learningPersisted, false);
const exactNative = await repaired.deliberate('architecture receipt proof', { ...options,
  persist: async (request) => ({ stored: true, verified: true, key: request.arguments.key }) });
assert.equal(exactNative.learningPersisted, true);
const thrownNative = await repaired.deliberate('architecture receipt proof', { ...options,
  persist: async () => { throw new Error('no connection'); } });
assert.equal(thrownNative.learningPersisted, false);
for (const drift of [nativeSource.replace('proof === true ||', 'proof === false ||'), nativeSource + nativeSource]) {
  const rejected = patcher.patchSource(drift);
  assert.equal(rejected.next, drift);
  assert.equal(rejected.missing.length, 1);
}

const result = await mod.fixtureDeliberate();
assert.equal(result.status, 'accepted');
assert.equal(result.learningPersisted, false);
assert.equal(result.learningPersistenceRequest.tool, 'memory_store');

const source = path.join(input, '.cache', 'ruvnet-brain', 'kb', '.console-runtime', 'scripts');
const deployed = path.join(input, '.claude', 'model-router', 'bin');
fs.mkdirSync(source, { recursive: true });
fs.mkdirSync(deployed, { recursive: true });
for (const dir of [source, deployed]) {
  fs.writeFileSync(path.join(dir, 'dual-host-deliberation.mjs'), fixture);
}

const applied = compose.applyComposed(['brain-dual-host-receipt']);
assert.equal(applied.errors, 0);
assert.equal(applied.incomplete, 0);
assert.equal(applied.patched, 2);
assert.deepEqual(compose.statusComposed()['brain-dual-host-receipt'], { files: 2, patched: 2 });

const cli = path.resolve('bin/cli.mjs');
const env = { ...process.env, RSP_NO_HOST_AUTO_UPDATE: '1', RSP_NO_LAUNCHCTL: '1' };
const status = spawnSync(process.execPath, [cli, 'brain-dual-host-receipt', 'status'], {
  env, encoding: 'utf8',
});
assert.equal(status.status, 0, status.stdout + status.stderr);
assert.match(status.stdout, /brain-dual-host-receipt.*2\/2/);
const state = readState();
assert.equal(Array.isArray(state.pluginTargets), true);

const restored = compose.reconcile([], ['brain-dual-host-receipt']);
assert.equal(restored.errors, 0);
for (const dir of [source, deployed]) {
  assert.equal(fs.readFileSync(path.join(dir, 'dual-host-deliberation.mjs'), 'utf8'), fixture);
}

console.log('✓ brain-dual-host-receipt: no second driver, schema-ready request, exact-key proof, composition, CLI, and restoration');
