import assert from 'node:assert/strict';
import crypto, { createHash } from 'node:crypto';
import { learnSelectedTrajectories, BRIDGE_RUNTIME } from '../lib/ruflo-selective-learning/runtime.mjs';
import { patchSource, reverse, isPatched, EDITS, discover } from '../lib/ruflo-selective-learning/patcher.mjs';
import fs from 'node:fs';
const hash = raw => createHash('sha256').update(raw).digest('hex');
const body = (id, success = true) => JSON.stringify({ id, task: 'Verify research review provenance and consumer retrieval',
  agent: 'researcher', success, startedAt: '2026-10-19T16:00:00Z', endedAt: '2026-10-19T16:02:00Z',
  steps: [{ action: 'Read source and compare', result: 'Exact readback matched', quality: .8, timestamp: '2026-10-19T16:01:00Z' }],
  feedback: 'Documentary checks only, no measured business uplift' });
function fixture() {
  const sources = new Map([['a', body('a')], ['b', body('b', false)], ['excluded', body('excluded')]]);
  const patterns = new Map(); let stores = 0;
  const rb = { async searchPatterns(q) { return [...patterns.values()].filter(p => p.taskType === q.filters.taskType); },
    async storePattern(p) { stores++; const id = patterns.size + 1; patterns.set(id, { ...p, id }); return id; },
    getPattern(id) { return patterns.get(id); } };
  return { rb, dbPath: '/fixture/.swarm/agentdb-memory.db', hash, guard: async () => {}, sources, patterns,
    getEntry: async q => ({ success: true, found: sources.has(q.key.slice(11)),
      entry: { content: sources.get(q.key.slice(11)) } }), get stores() { return stores; } };
}
const f = fixture();
const first = await learnSelectedTrajectories({ trajectoryIds: ['a', 'b'], consolidate: true }, f);
assert.equal(first.patternsLearned, 2); assert.equal(first.ewc.ran, false); assert.equal(first.ewc.requested, true);
assert.equal(first.backgroundLearningRun, false); assert.equal(first.sourceTrajectoryReplay, false);
assert.equal(f.patterns.size, 2); assert.ok(![...f.patterns.values()].some(p => p.metadata.sourceTrajectoryId === 'excluded'));
assert.equal(f.patterns.get(1).approach, body('a')); assert.equal(f.patterns.get(2).successRate, 0);
assert.equal(f.patterns.get(1).successRate, 1); assert.equal(f.patterns.get(1).metadata.sourceSha256, hash(body('a')));
assert.equal(f.patterns.get(1).metadata.metrics.sourceRewardStatus, 'unavailable');
const repeat = await learnSelectedTrajectories({ trajectoryIds: ['a', 'b'], consolidate: false }, f);
assert.equal(repeat.patternsLearned, 0); assert.equal(repeat.alreadyLearned, 2); assert.equal(f.stores, 2);
assert.equal(repeat.ewc.requested, false);
f.sources.set('a', body('a').replace('Exact readback matched', 'Corrected source context'));
await assert.rejects(learnSelectedTrajectories({ trajectoryIds: ['a'] }, f), /Changed source/);
assert.equal(f.stores, 2);
for (const ids of [[], ['missing'], ['a', 'a'], ['../bad'], ['excluded', 'missing']]) {
  const g = fixture(); await assert.rejects(learnSelectedTrajectories({ trajectoryIds: ids }, g)); assert.equal(g.stores, 0);
}
const pending = fixture(); pending.sources.set('a', JSON.stringify({ ...JSON.parse(body('a')), endedAt: undefined }));
await assert.rejects(learnSelectedTrajectories({ trajectoryIds: ['a'] }, pending), /unfinished/);
const invalid = fixture(); invalid.sources.set('a', JSON.stringify({ ...JSON.parse(body('a')), success: undefined }));
await assert.rejects(learnSelectedTrajectories({ trajectoryIds: ['a'] }, invalid), /unfinished/);
const reward = fixture(); reward.sources.set('a', JSON.stringify({ ...JSON.parse(body('a')), reward: .62 }));
await learnSelectedTrajectories({ trajectoryIds: ['a'] }, reward);
assert.equal(reward.patterns.get(1).metadata.metrics.sourceReward, .62);
assert.equal(reward.patterns.get(1).avgReward, .62);
const denied = fixture(); denied.guard = async () => { throw Error('guard refused'); };
await assert.rejects(learnSelectedTrajectories({ trajectoryIds: ['a'] }, denied), /guard refused/); assert.equal(denied.stores, 0);
const corrupt = fixture(); corrupt.rb.getPattern = () => null;
await assert.rejects(learnSelectedTrajectories({ trajectoryIds: ['a'] }, corrupt), /exact readback/);
// Exercise the actual generated bridge catch, including an acknowledged first
// write followed by a second-source refusal, and a stored but unproved row.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const bridge = new AsyncFunction('getRegistry', 'operationContext', 'bridgeGetEntry', 'guardValidate', 'crypto', 'params',
  BRIDGE_RUNTIME.replace('export async function bridgeLearnSelectedTrajectories', 'async function bridgeLearnSelectedTrajectories')
  + '\nreturn bridgeLearnSelectedTrajectories(params);');
async function callBridge(g, guard, ids) {
  return bridge(async () => ({ get: () => g.rb, dbPath: g.dbPath }), { getStore: () => ({ active: true }) },
    g.getEntry, guard, crypto, { trajectoryIds: ids, consolidate: true });
}
const partial = fixture(); let guards = 0;
const partialResult = await callBridge(partial, async () => ({ allowed: ++guards === 1 }), ['a', 'b']);
assert.equal(partialResult.success, false); assert.equal(partialResult.learned, null);
assert.equal(partialResult.status, 'partial-or-unconfirmed'); assert.equal(partialResult.verifiedEntries.length, 1);
assert.equal(partialResult.verifiedEntries[0].trajectoryId, 'a'); assert.equal(partial.stores, 1);
const unproved = fixture(); unproved.rb.getPattern = () => null;
const unprovedResult = await callBridge(unproved, async () => ({ allowed: true }), ['a']);
assert.equal(unprovedResult.mutationAttempted, true); assert.equal(unprovedResult.learned, null);
assert.equal(unprovedResult.verifiedEntries.length, 0); assert.equal(unproved.stores, 1);
const noWrite = await callBridge(fixture(), async () => ({ allowed: true }), ['missing']);
assert.equal(noWrite.learned, false); assert.equal(noWrite.status, 'refused-before-write');
// Exact patch application/roundtrip on real installed bytes, never invoking tools.
for (const file of discover()) {
  const live = fs.readFileSync(file, 'utf8'); const original = reverse(live);
  const patched = patchSource(original);
  assert.deepEqual(patched.missing, [], file); assert.ok(isPatched(patched.next), file);
  assert.equal(reverse(patched.next), original); assert.equal(patchSource(patched.next).next, patched.next);
}
assert.ok(EDITS.length === 2);
console.log('PASS selected learning: selection, failures, full provenance, idempotence, changed/missing/pending refusal, reward, guard, readback, exact patch roundtrip');
