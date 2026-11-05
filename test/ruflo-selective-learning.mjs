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

// Package-scoped preflight: an unknown cache never partially mutates its pair,
// while an independently proven package keeps its native selection guard.
const os = await import('node:os'), path = await import('node:path');
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-selective-packages-')));
const { spawnSync } = await import('node:child_process');
try {
  const env = { ...process.env, RUFLO_SOURCE_PATCH_HOME: scratch,
    RUFLO_GLOBAL_ROOT: path.join(scratch, 'global'), RUFLO_NPX_ROOT: path.join(scratch, 'npx') };
  const body = `import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import {preflight,NAME,patchSource} from ${JSON.stringify(new URL('../lib/ruflo-selective-learning/patcher.mjs', import.meta.url).href)};
import {applyComposed,reconcile} from ${JSON.stringify(new URL('../lib/plugin-compose.mjs', import.meta.url).href)};
const native=${JSON.stringify(native)},bridge=${JSON.stringify(bridge)},unknown=native.replace('distillLearning()', 'differentNativeLearning()');
const root=process.env.RUFLO_GLOBAL_ROOT,cache=path.join(process.env.RUFLO_NPX_ROOT,'unknown/node_modules');
const put=(base,name,value)=>{const f=path.join(base,'@claude-flow/cli/dist/src',name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,value);return f;};
const goodBridge=put(root,'memory/memory-bridge.js',bridge), good=put(root,'mcp-tools/hooks-tools.js',native);
const badBridge=put(cache,'memory/memory-bridge.js',bridge),bad=put(cache,'mcp-tools/hooks-tools.js',unknown);
assert.deepEqual(new Set(preflight().blockedFiles),new Set([badBridge,bad]));
const result=applyComposed([NAME]);assert(result.incomplete>0);assert.equal(fs.readFileSync(good,'utf8'),patchSource(native).next);
assert.equal(fs.readFileSync(bad,'utf8'),unknown);assert.equal(fs.readFileSync(badBridge,'utf8'),bridge);
assert(!fs.existsSync(bad+'.rsp-backup'));assert(!fs.existsSync(badBridge+'.rsp-backup'));
fs.rmSync(path.join(process.env.RUFLO_NPX_ROOT,'unknown'),{recursive:true});
assert.equal(reconcile([],[NAME]).errors,0);assert.equal(fs.readFileSync(good,'utf8'),native);
fs.unlinkSync(goodBridge);assert.deepEqual(preflight().blockedFiles,[good]);
`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', body], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
console.log('PASS selected-learning package preflight: unknown pair untouched, missing member refused, verified package composes');
