import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { unifiedSearchYield, unifiedNamespaceProjection } from '../lib/ruflo-memory-owner/patcher.mjs';

// Exact native 3.71.4 handler, evaluated only with inert storage functions. Never
// import an installed memory/learning module: CWD/HOME do not isolate its stores.
const source = fs.readFileSync(new URL('./fixtures/ruflo-memory-owner/unified-search-3.71.4.js', import.meta.url), 'utf8');
assert.equal(source.split(unifiedSearchYield[0]).length, 2);
const patched = source.replace(...unifiedSearchYield).replace(...unifiedNamespaceProjection);
assert.equal(patched.replace(unifiedSearchYield[1], unifiedSearchYield[0])
  .replace(unifiedNamespaceProjection[1], unifiedNamespaceProjection[0]), source);
const namespaces = Array.from({ length: 79 }, (_, i) => 'namespace-' + i);
const plain = value => JSON.parse(JSON.stringify(value));

async function exercise(text, input, options = {}) {
  const calls = [], pages = []; let listed = 0, active = 0, peak = 0, servedAfter, listedAtYield;
  const memory = {
    async listEntries(args) {
      listed++; pages.push(plain(args));
      if (options.listFailure) throw Error('native namespace enumeration failure');
      const entries = options.entries ?? namespaces.map(namespace => ({ namespace }));
      return { success: true, entries: entries.slice(args.offset ?? 0, (args.offset ?? 0) + args.limit), total: entries.length };
    },
    async searchEntries(args) {
      active++; peak = Math.max(peak, active); calls.push(plain(args));
      // An immediately resolved promise models the native synchronous bridge:
      // await alone yields to microtasks but cannot serve pending owner I/O.
      await Promise.resolve(); active--;
      if (args.namespace === 'throws') throw Error('native namespace search failure');
      return { results: [
        { key: 'shared-key', content: 'content:' + args.namespace, score: 0.5 },
        { key: 'shared-key', content: 'duplicate', score: 0.1 },
        { key: 'high', content: 'x'.repeat(300), score: 0.9 },
      ] };
    },
  };
  const context = vm.createContext({ Promise, Set, Date: { now: () => 1234 }, setImmediate, setTimeout,
    process: { env: options.env ?? {} }, ensureInitialized: async () => {},
    getMemoryFunctions: async () => memory, validateMemoryInput: () => {},
    validateIdentifier: value => ({ valid: value !== 'invalid', error: 'invalid namespace' }),
    missingRequiredString: value => typeof value.query === 'string' && value.query ? null : { error: 'query required' },
  });
  const handler = vm.runInContext('(' + text + ').handler', context);
  const ready = new Promise(resolve => setImmediate(() => { servedAfter = calls.length; listedAtYield = listed; resolve(); }));
  const result = plain(await handler(input)); await ready;
  return { result, calls, listed, peak, servedAfter, pages, listedAtYield };
}

const input = { query: 'R7 learning adaptation retained context', limit: 6 };
const before = await exercise(source, input), after = await exercise(patched, input);
assert.equal(before.servedAfter, 79, 'reproduce owner I/O starvation until all native searches finish');
assert(after.servedAfter < 79, 'regression: owner I/O must run before the namespace fan-out finishes');
assert.deepEqual(after.result, before.result, 'ranking, full namespace coverage, deduplication and content stay native');
assert.deepEqual(after.calls, before.calls, 'same exact queries, limits and namespace order');
assert.equal(after.peak, 1, 'native sequential search concurrency remains bounded');
assert.equal(after.listed, 1, 'no second enumeration or alternative store');

const entries = Array.from({ length: 100000 }, (_, i) => ({ namespace: namespaces[i % 79] }));
entries.push({ namespace: 'outside-native-selection-cap' });
const largeBefore = await exercise(source, input, { entries });
const largeAfter = await exercise(patched, input, { entries });
assert.deepEqual(largeAfter.result, largeBefore.result, 'same namespace coverage within the native 100k selected rows');
assert.deepEqual(largeAfter.calls, largeBefore.calls);
assert.equal(largeBefore.pages[0].limit, 100000, 'reproduce unbounded native payload materialization');
assert.deepEqual(largeAfter.pages, [{ limit: 100000, namespaceOnly: true }], 'native selection remains one snapshot, with namespace-only columns');
assert(!largeAfter.result.searchedNamespaces.includes('outside-native-selection-cap'));

for (const [args, options] of [
  [{ query: 'q', namespace: 'single' }, {}],
  [{ query: 'q', namespaces: ['default', 'throws', 'claude-memories', 'auto-memory', 'default'], limit: 20 }, {}],
  [{ query: 'q' }, { env: { CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES: 'first,second' } }],
  [{ query: 'q' }, { listFailure: true }],
  [{ query: 'q', namespace: 'invalid' }, {}],
  [{ query: 'q', namespaces: ['valid', 'invalid'] }, {}],
  [{ query: '' }, {}],
]) {
  const a = await exercise(source, args, options), b = await exercise(patched, args, options);
  assert.deepEqual(b.result, a.result, 'preserve native validation and namespace-failure behavior');
  assert.deepEqual(b.calls, a.calls);
  assert.equal(b.listed, a.listed);
}
console.log('PASS owner search fairness: native 79-namespace starvation reproduced; I/O served between unchanged sequential searches');
