import assert from 'node:assert/strict';
import fs from 'node:fs';
import { patchSource, reverseSource, isPatched, nativeSatisfied, ANCHOR, INSERT } from '../lib/brain-continuity-summary/patcher.mjs';
import { exerciseSummary } from '../lib/brain-continuity-summary/probe.mjs';
import { patchSource as collision, reverseSource as reverseCollision } from '../lib/brain-progression-collision/patcher.mjs';
const source = fs.readFileSync(new URL('./fixtures/brain-continuity-summary/native-summary.mjs', import.meta.url), 'utf8');
assert.throws(() => exerciseSummary(source), /must fit/);
const patched = patchSource(source);
assert.deepEqual(patched.missing, []);
assert(isPatched(patched.next));
assert.equal(reverseSource(patched.next), source);
assert.equal(patchSource(patched.next).next, patched.next);
for (const drift of [source + source, source.replace(ANCHOR, '// native drift'), patched.next + patched.next]) {
  assert(patchSource(drift).missing.length);
  assert.equal(patchSource(drift).next, drift);
}
const proof = exerciseSummary(patched.next);
const store = fs.readFileSync(new URL('./fixtures/brain-progression-collision/project-progression-store.mjs', import.meta.url), 'utf8') + source;
const composed = patchSource(collision(store).next);
assert.deepEqual(composed.missing, []);
assert.equal(composed.next, collision(patchSource(store).next).next);
assert.equal(reverseSource(composed.next), collision(store).next);
assert.equal(reverseCollision(composed.next), patchSource(store).next);
for (const mutation of [
  INSERT.replace("recordOmission(summary.state, 'observations', 'state.observations')", 'undefined'),
  INSERT.replace('for (const conflict of summary.state.resumeConflicts)', 'for (const conflict of [])'),
  INSERT.replace('summariesDigest: digestCanonical(rows)', "summariesDigest: 'invented'"),
]) assert.throws(() => exerciseSummary(patched.next.replace(INSERT, mutation)), 'mutation must fail');
console.log('Brain continuity summary: native failure, bounded projection, immutable evidence, exact digests, mandatory refusal, reverse/drift/mutation proof', proof);

// Exact v4.5.7 function slice from stuinfla/ruvnet-brain tag; no installed files read.
const native457 = fs.readFileSync(new URL('./fixtures/brain-continuity-summary/native-4.5.7.mjs', import.meta.url), 'utf8');
assert(nativeSatisfied(native457));
assert.deepEqual(patchSource(native457), { next: native457, applied: [], missing: [] });
exerciseSummary(native457);
const broken457 = native457.replace('conflictsDigest: digestCanonical(conflicts)', "conflictsDigest: 'invented'");
assert.equal(nativeSatisfied(broken457), false);
assert(patchSource(broken457).missing.length, 'unknown native grouping must refuse instead of layering the legacy edit');
assert.throws(() => exerciseSummary(broken457), undefined, 'native conflict evidence cannot be invented');
assert.equal(nativeSatisfied(native457 + native457), false);
