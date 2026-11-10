import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { patchSource, reverse, isPatched, TOOL_EDITS, BRIDGE_EDITS, NATIVE375_BRIDGE_EDITS } from '../lib/ruflo-pattern-search-result/patcher.mjs';
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
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-pattern-cli-')));
try {
  const home = path.join(scratch, 'home'), globalRoot = path.join(scratch, 'global');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/settings.json'), '{}');
  const fixtures = [['mcp-tools/agentdb-tools.js', toolSource], ['memory/memory-bridge.js', bridgeSource]];
  for (const [name, source] of fixtures) {
    const file = path.join(globalRoot, '@claude-flow/cli/dist/src', name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
  }
  const env = { ...process.env, HOME: home, RUFLO_SOURCE_PATCH_HOME: home,
    RUFLO_GLOBAL_ROOT: globalRoot, RUFLO_NPX_ROOT: path.join(scratch, 'npx'),
    RSP_CODEX_HOME: path.join(home, '.codex'), RSP_NO_SELF_UPDATE: '1',
    RSP_NO_LAUNCHCTL: '1', RSP_NO_MONITOR_RECOVER: '1', RSP_NO_STALE_WRITER_KILL: '1' };
  for (const action of ['install', 'status', 'uninstall']) {
    const run = spawnSync(process.execPath, [new URL('../bin/cli.mjs', import.meta.url).pathname, 'ruflo-pattern-search-result', action],
      { cwd: scratch, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(run.status, 0, action + ': ' + run.stdout + run.stderr);
    assert.doesNotMatch(run.stderr, /unknown target/);
    for (const [name, source] of fixtures) {
      const live = fs.readFileSync(path.join(globalRoot, '@claude-flow/cli/dist/src', name), 'utf8');
      assert.equal(live, action === 'uninstall' ? source : patchSource(source).next);
    }
  }
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
console.log('PASS public CLI pattern-result install/status/uninstall: exact fixture application and restoration');

// Exact 3.75 published bridge: native errors stay native, only residual gaps change.
const native375 = fs.readFileSync(new URL('./fixtures/pattern-search/native-bridge-3.75.0.mjs', import.meta.url), 'utf8');
assert.equal(createHash('sha256').update(native375).digest('hex'), '2c3e699d24dad07af4dfa8733fac6390aa33908efe4f0afa143d18f9f1f97ae3');
const fixed375 = patchSource(native375);
assert.deepEqual(fixed375.missing, []); assert(isPatched(fixed375.next));
assert.equal(reverse(fixed375.next), native375);
assert.equal(patchSource(fixed375.next).next, fixed375.next);
for (const [anchor] of NATIVE375_BRIDGE_EDITS)
  assert(patchSource(native375.replace(anchor, 'changed upstream')).missing.length);
let mode, bank = { searchPatterns: async () => { if (mode === 'controller') throw Error('controller failed'); return mode === 'nonarray' ? null : mode === 'hit' ? [{ id: 1, approach: 'original', similarity: 0.9 }] : []; } };
const nativeRegistry = { get: () => bank, getAgentDB: () => mode === 'handle' ? null : ({ database: {
  prepare: () => { if (mode === 'sql') throw Error('SQL refused'); return { all: () => [] }; },
} }) };
function nativeSearch(source) {
  return new Function('getRegistry', 'operationContext', 'withBridgeOperation', 'bridgeFailureReasons', 'canonicalDbPath', 'bridgeSearchEntries', 'embedding',
    source.replace('export async function bridgeSearchPatterns', 'async function bridgeSearchPatterns')
      .replace("await import('./memory-initializer.js')", 'embedding') + '\nreturn bridgeSearchPatterns;')(
      async () => nativeRegistry, { getStore: () => ({ active: true }) }, fn => fn(), new Map(), x => x,
      async () => { throw Error('fallback refused'); }, { generateEmbedding: async () => ({ embedding: [] }) });
}
const before375 = nativeSearch(native375), search375 = nativeSearch(fixed375.next);
mode = 'handle'; assert.equal((await before375(args)).error, undefined);
assert.match((await search375(args)).error, /reader unavailable/);
mode = undefined; assert.deepEqual(await search375(args), empty());
mode = 'hit'; assert.equal((await search375(args)).results[0].content, 'original');
for (mode of ['controller', 'nonarray', 'sql']) assert((await search375(args)).error);
bank = { findSimilar() {}, getAll() { throw Error('local bank refused'); } };
assert.equal(await before375(args), null);
assert.match((await search375(args)).error, /local bank refused/);
bank = null;
assert.equal(await before375(args), null);
assert.match((await search375(args)).error, /fallback refused/);
console.log('PASS published 3.75 native pattern search: residual missing-reader/outer-catch failures, native errors, healthy reads and exact reversal');
