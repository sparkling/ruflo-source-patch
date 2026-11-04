import assert from 'node:assert/strict';
import fs from 'node:fs';
import { patchSource, reverse, isPatched, legacyPatchSource, HOOK_GUARD } from '../lib/ruflo-selective-learning/patcher.mjs';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/ruflo-native-learning.json', import.meta.url), 'utf8'));
const native = fixture.tool, patched = patchSource(native);
assert.deepEqual(patched.missing, []);
assert.ok(isPatched(patched.next));
assert.equal(reverse(patched.next), native);
assert.equal(patchSource(patched.next).next, patched.next);
const legacy = legacyPatchSource(native).next;
assert.match(legacy, /bridgeLearnSelectedTrajectories/);
assert.equal(patchSource(legacy).next, patched.next, 'released retention upgrades directly to narrow refusal');
assert.equal(reverse(legacy), native);
const anchor = '// ===== Phase 3: ReasoningBank pattern operations =====';
const bridge = 'export const unrelated = 1;\n' + anchor;
const legacyBridge = legacyPatchSource(bridge).next;
assert.match(legacyBridge, /storePattern/);
assert.equal(patchSource(legacyBridge).next, bridge, 'remove all custom retention runtime');
assert.equal(patchSource(bridge).next, bridge, 'never re-add the removed bridge algorithm');
for (const source of [native.replace('distillLearning()', 'differentNativeLearning()'),
  legacy.replace('return await bridge.bridgeLearnSelectedTrajectories(params);', 'return {};'),
  patched.next.replace('trajectory-selection-unsupported', 'unknown-guard')]) {
  assert.ok(patchSource(source).missing.length);
  assert.equal(patchSource(source).next, source, 'unknown native/legacy/guard source is unchanged');
}
// Dependency injection executes the complete captured native tool. No database,
// provider or intelligence runtime is imported, and global effects are counters.
function tool(source, counts) {
  const intelligence = { async distillLearning() { counts.distill++; return { patternsDistilled: 2 }; },
    async runBackgroundLearning() { counts.background++; } };
  const rewritten = source.replace("import('../memory/intelligence.js')", 'Promise.resolve(injected)');
  return new Function('injected', 'getSONAOptimizer', 'getEWCConsolidator',
    rewritten.replace('export const ', 'const ') + '\nreturn hooksIntelligenceLearn;')(
    intelligence, async () => { counts.sona++; return null; }, async () => { counts.ewc++; return null; });
}
const counts = () => ({ distill: 0, background: 0, sona: 0, ewc: 0 });
const oldCounts = counts();
await tool(native, oldCounts).handler({ trajectoryIds: ['selected'], consolidate: false });
assert.deepEqual(oldCounts, { distill: 1, background: 1, sona: 1, ewc: 0 }, 'native reproduces #4693');
for (const selection of [['selected'], [], null, undefined, 'invalid', 42]) {
  const effects = counts();
  const result = await tool(patched.next, effects).handler({ trajectoryIds: selection });
  assert.equal(result.success, false); assert.equal(result.status, 'unsupported');
  assert.equal(result.reason, 'trajectory-selection-unsupported');
  assert.equal(result.cycleTriggered, false); assert.equal(result.mutationAttempted, false);
  assert.deepEqual(effects, counts(), 'refuse before all imports, stats, learning and mutation');
}
for (const params of [{}, { consolidate: false }, { consolidate: true }]) {
  const before = counts(), after = counts();
  const a = await tool(native, before).handler(params), b = await tool(patched.next, after).handler(params);
  delete a.duration; delete b.duration;
  assert.deepEqual(b, a); assert.deepEqual(after, before);
}
assert.equal(patched.next.slice(patched.next.indexOf('        const consolidate =')),
  native.slice(native.indexOf('        const consolidate =')), 'omitted-selection native body remains byte-identical');
assert.ok(HOOK_GUARD.includes('Object.prototype.hasOwnProperty.call'));
console.log('PASS selected learning: native ignored-filter reproduction, early refusal, exact default path, released removal, idempotence and unknown-source refusal');
