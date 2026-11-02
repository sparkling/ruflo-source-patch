import assert from 'node:assert/strict';
import vm from 'node:vm';
import { getEventListeners } from 'node:events';
import { SPECS, patchSource, reverseSource, isPatched, descriptor } from '../lib/brain-recall-runtime/patcher.mjs';
for (const spec of SPECS) {
  const source = spec.edits.map(([, from]) => from).join('\n');
  const patched = patchSource(source);
  assert.deepEqual(patched.missing, []);
  assert(isPatched(patched.next));
  assert.equal(reverseSource(patched.next), source);
  assert.equal(patchSource(patched.next).next, patched.next);
  assert(patchSource(source.replace(spec.edits[0][1], 'changed upstream')).missing.length);
  assert(descriptor.isPatched(source));
  assert.equal(descriptor.patchSource(source).next, source);
  assert.equal(descriptor.patchSource(patched.next).next, source);
}
const body = SPECS[0].edits[1][2].split("    if (op === 'list') {")[0];
// A sibling's old-looking mode must not misidentify this target's revision.
const bridgeSource = SPECS.at(-1).edits.map(([, from]) => from).join('\n');
const bridgeCurrent = patchSource(bridgeSource).next + '\n        memoryEntriesOnly: memoryEntriesOnlyRequested(options, true),\n';
assert.equal(descriptor.historicalPatchSource(bridgeSource, bridgeCurrent).next,
  patchSource(bridgeSource).next);
const bridgeLegacy = patchSource(bridgeSource).next.replaceAll("typeof memoryEntriesOnlyRequested === 'function' && ", '');
assert.equal(descriptor.historicalPatchSource(bridgeSource, bridgeLegacy).next, bridgeLegacy);
const args = { op: 'search', namespace: 'project', query: 'repair evidence', limit: 12 };
async function reader(mod, request = args) {
  const context = vm.createContext({ mod, dbPath: '/owned/memory.db', request });
  return vm.runInContext(`(async ({op, namespace, query, limit}) => {${body}})(request)`, context);
}
let passed;
const native = { success: true, results: [{ key: 'known', namespace: 'project', score: 0.8, content: 'native preview', provenanceType: 'tool_result' }] };
const row = await reader({ searchEntries: async options => { passed = options; return native; } });
assert.equal(row.state, 'ok');
assert.deepEqual(JSON.parse(JSON.stringify(passed)), { query: args.query, namespace: args.namespace, limit: 12, dbPath: '/owned/memory.db' });
assert.equal(row.rows[0].preview, native.results[0].content);
assert.equal(row.rows[0].score, 0.8);
assert.equal((await reader({})).state, 'fallback');
assert.equal((await reader({ searchEntries: async () => ({ success: false }) })).state, 'unavailable');
assert.equal((await reader({ searchEntries: async () => ({ success: true, results: [{}] }) })).state, 'fallback');
assert.equal((await reader({ searchEntries: async () => native }, { ...args, limit: 100 })).state, 'fallback');
const processBody = SPECS[1].edits.find(([id]) => id === 'reuse-session')[2].replace('export ', '') + "resolve({state:'cli-fallback'}); }); }";
const context = vm.createContext({});
vm.runInContext(processBody, context);
const request = { store: { path: '/owned/memory.db' }, args: ['--format', 'json', '-q', 'query', '-n', 'project', '--limit', '12'], deadline: 12345 };
let searchArgs;
const session = { storePath: request.store.path, search: async (...args) => { searchArgs = args; return { state: 'ok', rows: [] }; } };
assert.equal((await context.searchOnce({ ...request, session })).state, 'ok');
assert.deepEqual(searchArgs, ['project', 'query', 12, 12345]);
assert.equal((await context.searchOnce({ ...request, session: { ...session, search: async () => ({ state: 'fallback' }) } })).state, 'cli-fallback');
assert.equal((await context.searchOnce({ ...request, session: { ...session, search: async () => ({ state: 'timed out' }) } })).state, 'timed out');
assert.equal((await context.searchOnce({ ...request, session: { ...session, storePath: '/another.db' } })).state, 'cli-fallback');
assert.equal((await context.searchOnce({ ...request, session, signal: { aborted: true } })).state, 'unavailable');
// A per-request abort settles promptly without closing the shared owner or leaking listeners.
const abort = new AbortController();
let finishSearch;
const pending = context.searchOnce({ ...request, signal: abort.signal,
  session: { ...session, search: () => new Promise(resolve => { finishSearch = resolve; }) } });
await Promise.resolve();
abort.abort();
assert.equal((await pending).state, 'unavailable');
assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
finishSearch({ state: 'ok', rows: [{ key: 'late-result' }] });
await Promise.resolve();
assert.equal((await pending).rows.length, 0);
const rejected = new AbortController();
assert.equal((await context.searchOnce({ ...request, signal: rejected.signal,
  session: { ...session, search: async () => { throw Error('reader failed'); } } })).state, 'unavailable');
assert.equal(getEventListeners(rejected.signal, 'abort').length, 0);
assert(SPECS[1].edits.find(([id]) => id === 'reader-owner')[2].includes("RUFLO_BRIDGE_MEMORY_ENTRIES_ONLY: '1'"));
for (const [, , replacement] of SPECS.at(-1).edits) {
  let mode;
  const prefix = replacement.slice(0, replacement.indexOf('    if (!registry)'));
  await vm.runInNewContext(`(async()=>{${prefix}})()`, { options: { dbPath: '/owned/memory.db' },
    memoryEntriesOnlyRequested: (options, eligible) => eligible,
    getRegistry: async (db, value) => { assert.equal(db, '/owned/memory.db'); mode = value; } });
  assert.equal(mode.memoryEntriesOnly, true);
  await vm.runInNewContext(`(async()=>{${prefix}})()`, { options: { dbPath: '/owned/memory.db' },
    getRegistry: async (db, value) => { mode = value; } });
  assert.equal(mode.memoryEntriesOnly, false, 'absent optional adapter preserves the native registry route');
}
console.log('brain-recall-runtime: passed');
