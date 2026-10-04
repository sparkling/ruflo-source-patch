import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-progression-collision-')));
process.env.RUFLO_SOURCE_PATCH_HOME = sandbox;
process.env.RSP_RUVNET_BRAIN_HOME = path.join(sandbox, '.cache/ruvnet-brain');
process.env.RSP_CODEX_HOME = path.join(sandbox, '.codex');
const patch = await import('../lib/brain-progression-collision/patcher.mjs');
const { exerciseSources, probeProgressionCollisionReplacement } = await import('../lib/brain-progression-collision/probe.mjs');
const { VENDOR_SPECS } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
const fixture = new URL('./fixtures/brain-progression-collision/', import.meta.url);
const sharedFixture = new URL('./fixtures/brain-managed-cli-capture/scripts/', import.meta.url);
const sources = Object.fromEntries(['store', 'hook', 'producer', 'contract'].map(name => [name,
  fs.readFileSync(new URL(`project-progression-${name}.mjs`, name === 'store' ? fixture : sharedFixture), 'utf8')]));
sources.queue = fs.readFileSync(new URL('project-capture-queue.mjs', fixture), 'utf8');
await assert.rejects(exerciseSources(sources, path.join(sandbox, 'vendor')), /progression readback digest mismatch/);
const patched = { ...sources };
for (const name of ['store', 'hook', 'producer']) {
  const result = patch.patchSource(sources[name]);
  assert.deepEqual(result.missing, [], name);
  patched[name] = result.next;
  assert(patch.isPatched(result.next));
  assert.equal(patch.reverseSource(result.next), sources[name], 'pristine byte round trip');
  assert.equal(patch.patchSource(result.next).next, result.next, 'idempotent');
  assert(patch.patchSource(sources[name] + sources[name]).missing.length, 'duplicate anchors fail closed');
}
assert.deepEqual(await exerciseSources(patched, path.join(sandbox, 'patched')), {
  immutableExistingPreserved: true, exactRecoveryVerified: true, failedRecoveryRetained: true, laterJobsAdvance: true });
for (const [id, mutate] of [
  ['original-key-reuse', source => ({ ...source, hook: source.hook.replace("snapshot.dedupId + ':collision:' + snapshot.payloadDigest + ':' + existing.payloadDigest", 'snapshot.dedupId') })],
  ['false-receipt', source => ({ ...source, hook: source.hook.replace('verifyReceipt(captured, receipt);', 'receipt.readbackDigest = "fake"; verifyReceipt(captured, receipt);') })],
  ['wrong-source', source => ({ ...source, hook: source.hook.replace('      ...snapshot,\n      dedupId:', '      ...snapshot,\n      sourceIdentity: existing.sourceIdentity,\n      dedupId:') })],
  ['missing-content-binding', source => ({ ...source, producer: source.producer.replace(patch.PRODUCER_REPLACEMENT, patch.PRODUCER_ANCHOR) })],
]) await assert.rejects(exerciseSources(mutate(patched), path.join(sandbox, id)), undefined, id);
const producerSibling = await import('../lib/brain-managed-cli-capture/patcher.mjs');
const jointlyPatched = { ...patched, producer: producerSibling.patchSource(patched.producer).next,
  hook: producerSibling.patchSource(patched.hook).next };
await exerciseSources(jointlyPatched, path.join(sandbox, 'sibling-composition'));

function write(file, body) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); }
const home = process.env.RSP_RUVNET_BRAIN_HOME, active = path.join(home, 'versions/4.5.4');
const cache = path.join(sandbox, '.codex/plugins/cache/ruvnet-brain/ruvnet-brain/4.5.4');
const old = path.join(home, 'versions/4.5.3');
const runtime = path.join(sandbox, '.claude/ruvnet-brain');
for (const root of [active, cache, old, runtime]) {
  write(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruvnet-brain', version: root === old ? '4.5.3' : '4.5.4' }));
  for (const spec of VENDOR_SPECS) write(path.join(root, spec.relative), '// native discovery fixture');
  write(path.join(root, 'scripts/hook-input.mjs'), '// native discovery fixture');
  for (const [name, source] of Object.entries(sources)) write(path.join(root, 'scripts', name === 'queue' ? 'project-capture-queue.mjs' : `project-progression-${name}.mjs`), source);
}
write(path.join(runtime, 'mcp/server.mjs'), "// ruvnet-brain MCP server\nimport { fixture } from './managed-cli-interface.mjs';\n");
write(path.join(runtime, 'mcp/managed-cli-interface.mjs'), '// native persistent MCP shell fixture');
write(path.join(home, 'active.json'), JSON.stringify({ version: '4.5.4', codeRoot: active }));
const files = patch.discover();
assert.equal(files.length, 9, 'active, matching host and native persistent MCP copies');
write(path.join(old, 'scripts/project-progression-hook.mjs'), patched.hook);
assert.equal(patch.discover().length, 12, 'retained owned generation remains a composition claimant after native activation');
write(path.join(old, 'scripts/project-progression-hook.mjs'), sources.hook);
assert.equal(patch.discover().length, 9, 'unowned old generations stay outside scope');
assert.equal(patch.preflight().ok, true);
assert.equal(probeProgressionCollisionReplacement({ files }).state, 'live', 'native collision behavior remains defective');
const compose = await import('../lib/plugin-compose.mjs');
write(path.join(cache, patch.SPECS[1].relative), 'foreign changed implementation');
const blocked = compose.applyComposed([patch.NAME]);
assert.equal(blocked.patched, 0, 'one unsafe member refuses every member of the atomic bundle');
assert(blocked.incomplete > 0 || blocked.errors > 0);
write(path.join(cache, patch.SPECS[1].relative), sources.hook);
const applied = compose.applyComposed([patch.NAME]);
assert.equal(applied.errors, 0, applied.log.join('\n')); assert.equal(applied.incomplete, 0, applied.log.join('\n'));
assert.equal(applied.patched, 9);
assert.equal(probeProgressionCollisionReplacement({ files, installed: [patch.NAME] }).state, 'live', 'local recovery bytes never constitute native retirement');
const backup = files[0] + '.rsp-backup', originalBackup = fs.readFileSync(backup, 'utf8');
write(backup, originalBackup + '\nforeign stale baseline');
assert.match(probeProgressionCollisionReplacement({ files, installed: [patch.NAME] }).evidence, /composition/);
write(backup, originalBackup);
assert.match(probeProgressionCollisionReplacement({ files, installed: [] }).evidence, /untracked/);
fs.rmSync(backup);
assert.match(probeProgressionCollisionReplacement({ files, installed: [patch.NAME] }).evidence, /ENOENT/);
write(backup, originalBackup);
fs.renameSync(backup, backup + '.real'); fs.symlinkSync(backup + '.real', backup);
assert.match(probeProgressionCollisionReplacement({ files, installed: [patch.NAME] }).evidence, /unsafe/);
fs.rmSync(backup); fs.renameSync(backup + '.real', backup);
const restored = compose.reconcile([], [patch.NAME]); assert.equal(restored.errors, 0, restored.log.join('\n'));
for (const root of [active, cache, runtime]) for (const name of ['store', 'hook', 'producer']) {
  const file = path.join(root, `scripts/project-progression-${name}.mjs`);
  assert.equal(fs.readFileSync(file, 'utf8'), sources[name]);
  write(file, patched[name].replaceAll(patch.PATCH_MARKER, 'native future behavior'));
}
assert.equal(probeProgressionCollisionReplacement({ files }).state, 'superseded', 'native executable behavior is required for retirement');
write(path.join(cache, 'scripts/project-progression-producer.mjs'), sources.producer);
assert.equal(probeProgressionCollisionReplacement({ files }).state, 'live', 'native recovery alone cannot retire missing future content identity');
assert.equal(fs.readFileSync(path.join(old, patch.SPECS[0].relative), 'utf8'), sources.store, 'inactive generation unchanged');
assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'active.json'), 'utf8')).version, '4.5.4', 'updater authority unchanged');
console.log('✓ progression collision: validated native read, immutable history, deterministic recovery, exact receipts, queue advancement, future identity, pristine retirement');
fs.rmSync(sandbox, { recursive: true, force: true });
