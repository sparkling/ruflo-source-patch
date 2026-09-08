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
