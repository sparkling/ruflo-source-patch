import assert from 'node:assert/strict';
import fs from 'node:fs';
import { patchSource, reverse, isPatched, TOOL_EDITS, BRIDGE_EDITS } from '../lib/ruflo-pattern-search-result/patcher.mjs';
const fixture = fs.readFileSync(new URL('./fixtures/pattern-search/native-3.71.1.mjs', import.meta.url), 'utf8');
const boundary = fixture.indexOf('/**\n * Case-insensitive substring');
const toolSource = fixture.slice(0, boundary), bridgeSource = fixture.slice(boundary);
const tool = patchSource(toolSource), bridge = patchSource(bridgeSource);
for (const [old, next] of [[toolSource, tool], [bridgeSource, bridge]]) {
  assert.deepEqual(next.missing, []); assert(isPatched(next.next));
  assert.equal(reverse(next.next), old); assert.equal(patchSource(next.next).next, next.next);
  assert(patchSource(old + old).missing.length);
  assert(patchSource(next.next.replace('#4714', '#4714 altered')).missing.length);
}
const empty = () => ({ results: [], controller: 'reasoningBank' });
let result = empty(), semantic = { success: true, results: [] }, listing = { success: true, entries: [] }, exact;
let throws, consulted;
const readers = {
  searchEntries: async () => { consulted.push('semantic'); if (throws === 'semantic') throw Error('semantic refused'); return semantic; },
  listEntries: async () => { consulted.push('list'); if (throws === 'list') throw Error('list refused'); return listing; },
  getEntry: async () => { consulted.push('exact'); return exact; },
};
function loadTool(source) {
  source = source.replace("await import('../memory/memory-initializer.js')", 'readers');
  return new Function('getBridge', 'readers', 'validateText', 'validateString', 'validatePositiveInt', 'validateScore', 'sanitizeError', 'MAX_TOP_K',
    source.replace('export const agentdbPatternSearch =', 'const agentdbPatternSearch =') + '\nreturn agentdbPatternSearch;')(
    async () => ({ bridgeSearchPatterns: async () => result }), readers,
    () => ({ valid: true }), x => x, (x, d) => x ?? d, (x, d) => x ?? d, e => String(e.message ?? e), 100);
}
const current = loadTool(tool.next), original = loadTool(toolSource);
async function run(target = current) { consulted = []; return target.handler({ query: 'no-match', topK: 30, minConfidence: 0 }); }
assert.equal((await run(original)).degraded, true, 'native defect reproduced');
let answer = await run(); assert.deepEqual(answer.results, []); assert.equal(answer.degraded, false); assert.equal(answer.controller, 'reasoningBank');
assert.equal(answer.status, 'no-match'); assert.deepEqual(consulted, ['semantic', 'list']);
assert.match(answer.legacyLookup.qualification, /not a complete/);
result = { results: [{ id: 'native', content: 'original', score: 0.4 }], controller: 'reasoningBank' };
assert.deepEqual(await run(), result); assert.deepEqual(consulted, []);
result = empty();
semantic = { success: true, results: [{ key: 'legacy', content: JSON.stringify({ pattern: 'old original', confidence: 1 }) }] };
answer = await run(); assert.equal(answer.results[0].pattern, 'old original'); assert.equal(answer.controller, 'memory-store-fallback'); assert.equal(answer.degraded, true);
semantic = { success: true, results: [{ key: 'legacy', content: '{"pattern":"native truncated...' }] };
exact = { success: true, found: true, entry: { key: 'legacy', namespace: 'pattern', content: JSON.stringify({ pattern: 'complete original '.repeat(50) }) } };
answer = await run(); assert.equal(answer.results[0].pattern, 'complete original '.repeat(50)); assert.equal(answer.semanticError, undefined);
semantic.results.unshift({ key: 'first', content: '{"pattern":"first valid hit"}' });
exact = { success: false, error: 'later hydration refused' }; listing = { success: true, entries: [] };
answer = await run(); assert.equal(answer.results.length, 0); assert.match(answer.semanticError, /later hydration refused/);
semantic = { success: true, results: [] }; listing = { success: true, entries: [{ key: 'legacy' }] };
exact = { success: true, found: true, entry: { key: 'legacy', content: '{"pattern":"no-match original"}' } };
assert.equal((await run()).results[0].pattern, 'no-match original');
for (const invalid of [undefined, { success: false, error: 'read refused' }, { found: false }, { found: true }]) {
  exact = invalid; answer = await run(); assert(answer.error); assert.equal(answer.degraded, true);
}
for (const invalid of [{}, { key: 'other', content: '{"pattern":"no-match"}' }, { key: 'legacy', content: 'malformed json' }, { key: 'legacy', content: '{"unrelated":"body"}' }]) {
  exact = { success: true, found: true, entry: invalid }; assert((await run()).error);
}
listing = { success: true, entries: [{}] }; assert((await run()).error);
listing = { success: true, entries: [] };
for (const row of [{}, { content: '{}' }, { content: 'malformed' }]) {
  semantic = { success: true, results: [row] }; answer = await run(); assert.equal(answer.degraded, true); assert(answer.semanticError || answer.error);
}
for (const invalid of [undefined, {}, { success: false, results: [], error: 'semantic denied' }]) {
  semantic = invalid; answer = await run(); assert.equal(answer.degraded, true); assert(answer.semanticError || answer.error);
}
semantic = { success: true, results: [] };
for (const invalid of [undefined, {}, { success: false, entries: [], error: 'list denied' }]) {
  listing = invalid; answer = await run(); assert.equal(answer.degraded, true); assert(answer.error);
}
listing = { success: true, entries: [] };
for (const phase of ['semantic', 'list']) { throws = phase; assert.equal((await run()).degraded, true); }
throws = undefined;
for (const failed of [null, { results: [], controller: 'bridge-fallback' }, { results: [], controller: 'reasoningBank', error: 'controller denied', success: false }]) {
  result = failed; assert.equal((await run()).degraded, true);
}
result = empty();
// Actual source-extracted bridge: no managed database access. The native driver
// interface below is a fault-injection fixture, not a replacement runtime.
let nativeResults = [], fail, threshold;
const failures = new Map();
const registry = {
  get: () => ({ searchPatterns: async opts => { threshold = opts.threshold; if (fail === 'controller') throw Error('controller failed'); return nativeResults; } }),
  getAgentDB: () => fail === 'handle' ? null : ({ database: { prepare: () => { if (fail === 'substring') throw Error('substring failed'); return { all: () => [] }; } } }),
};
const bridgeFunction = new Function('getRegistry', 'operationContext', 'withBridgeOperation', 'bridgeFailureReasons', 'canonicalDbPath',
  bridge.next.replace('export async function bridgeSearchPatterns', 'async function bridgeSearchPatterns') + '\nreturn bridgeSearchPatterns;')(
  async () => registry, { getStore: () => ({ active: true }) }, fn => fn(), failures, x => x);
const args = { query: 'no-match', topK: 30, minConfidence: 0, dbPath: '/fixture/native.db' };
assert.deepEqual(await bridgeFunction(args), empty());
for (const failure of ['controller', 'substring', 'handle']) {
  fail = failure; const refused = await bridgeFunction(args); assert.equal(refused.success, false); assert(refused.error); assert(failures.has(args.dbPath));
}
fail = undefined; nativeResults = undefined;
assert.match((await bridgeFunction(args)).error, /Invalid native/);
// A partial anchor match must never patch one side of the feature silently.
for (const [source, edits] of [[toolSource, TOOL_EDITS], [bridgeSource, BRIDGE_EDITS]])
  for (const [anchor] of edits) assert(patchSource(source.replace(anchor, 'changed upstream')).missing.length);
console.log('PASS pattern search: reproduced healthy-empty degradation; legacy coverage retained; native/semantic/list/exact failures remain failures; exact restoration and changed-source refusal');
