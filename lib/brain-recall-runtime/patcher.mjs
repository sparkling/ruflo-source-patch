// Brain #514: share the existing bounded native reader, not another Ruflo runtime.
import path from 'node:path';
import fs from 'node:fs';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { discover as discoverCapture } from '../ruflo-memory-entries-only/patcher.mjs';
export const NAME = 'brain-recall-runtime';
export const PATCH_MARKER = 'ruflo-source-patch brain#514';
const currentSearch = `    return new Promise(resolve => {
      let settled = false;
      const finish = row => { if (settled) return; settled = true;
        signal?.removeEventListener('abort', cancel); resolve(row); };
      const cancel = () => finish({ rows: [], state: 'unavailable' });
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) return cancel();
      Promise.resolve().then(() => settled ? null : session.search(args[5], args[3], Number(args[7]), deadline)).then(row => {
        if (settled) return;
        if (signal?.aborted) return cancel();
        if (row.state === 'fallback') {
          finish(searchOnce({ ruflo, store, args, deadline, env, scratch, operation, signal, invocation }));
        } else finish({ rows: [], ...row });
      }, () => finish({ rows: [], state: 'unavailable' }));
    });`;
export const SPECS = [
  { relative: 'scripts/agentdb-recall-reader.mjs', edits: [
    ['search-request', '  const run = async ({ op, namespace, key, limit }) => {',
      '  const run = async ({ op, namespace, key, limit, query }) => {'],
    ['native-search', "    if (op === 'list') {", `    // ${PATCH_MARKER}: same public function and projection as memory search --format json.
    if (op === 'search') {
      if (typeof mod.searchEntries !== 'function' || typeof query !== 'string' || !query
          || !Number.isInteger(limit) || limit < 1 || limit > 12) return { state: 'fallback' };
      const r = await mod.searchEntries({ query, namespace, limit, dbPath });
      if (r?.success === false) return { state: 'unavailable', rows: [] };
      if (r?.success !== true || !Array.isArray(r.results)
          || r.results.some(row => typeof row?.key !== 'string' || !row.key
            || typeof row.namespace !== 'string' || !Number.isFinite(row.score))) return { state: 'fallback' };
      return { state: 'ok', rows: r.results.map(row => ({ key: row.key, score: row.score,
        namespace: row.namespace, preview: row.content, provenanceType: row.provenanceType })) };
    }
    if (op === 'list') {`],
  ] },
  { relative: 'scripts/agentdb-recall-process.mjs', edits: [
    ['reader-owner', "{ cwd: cwd.cwd, env: { ...env, RUFLO_DAEMON_AUTOSTART: '0', CLAUDE_FLOW_AUTO_UPDATE: 'false', CLAUDE_FLOW_MEMORY_PATH: undefined },",
      "{ cwd: cwd.cwd, env: { ...env, RUFLO_BRIDGE_MEMORY_ENTRIES_ONLY: '1', RUFLO_DAEMON_AUTOSTART: '0', CLAUDE_FLOW_AUTO_UPDATE: 'false', CLAUDE_FLOW_MEMORY_PATH: undefined },"],
    ['session-search', '  return { storePath, close,', `  // ${PATCH_MARKER}: parent deadline and existing owned-child retirement remain authoritative.
  return { storePath, close,
    search: (namespace, query, limit, opDeadline) => ask({ op: 'search', namespace, query, limit }, opDeadline),`],
    ['reuse-session', "export function searchOnce({ ruflo, store, args, deadline, env, scratch, operation = 'search', signal, invocation }) {\n  return new Promise((resolve) => {",
      `export function searchOnce({ ruflo, store, args, deadline, env, scratch, operation = 'search', signal, invocation, session }) {
  if (signal?.aborted) return Promise.resolve({ rows: [], state: 'unavailable' });
  if (session?.storePath === store.path && typeof session.search === 'function' && !invocation
      && operation === 'search' && args.length === 8 && args[0] === '--format' && args[1] === 'json'
      && args[2] === '-q' && args[4] === '-n' && args[6] === '--limit') {
${currentSearch}
  }
  return new Promise((resolve) => {`],
  ] },
  { relative: 'scripts/agentdb-recall.mjs', edits: [
    ['ranked-session', "searchOnce({ ruflo: bin, store, deadline: searchDeadline, env, scratch, signal, args:",
      "searchOnce({ ruflo: bin, store, deadline: searchDeadline, env, scratch, signal, session, args:"],
    ['speculative-session', 'const spec = session && store ? searchOnce({ ruflo: bin, store,',
      `// ${PATCH_MARKER}: ranking shares the same native registry as list/get.
    const spec = session && store ? searchOnce({ ruflo: bin, store, session,`],
    ['selected-session', 'searchOnce({ ruflo: bin, store: jobStore, deadline: searchDeadline, env, scratch: scratchFor, args, signal })',
      'searchOnce({ ruflo: bin, store: jobStore, deadline: searchDeadline, env, scratch: scratchFor, args, signal, session })'],
  ] },
  { relative: 'native-memory-bridge', edits: ['query: queryStr, namespace, limit = 10, threshold = DEFAULT_SEARCH_THRESHOLD, provenanceFilter',
    'namespace, limit = 20, offset = 0, provenanceFilter, tags: requiredTags'].map(fields => {
    const from = `    const registry = await getRegistry(options.dbPath);
    if (!registry)
        return null;
    const ctx = getDb(registry);
    if (!ctx)
        return null;
    try {
        const { ${fields} } = options;`;
    return ['read-owner-' + fields.split(',')[0], from,
      from.replace('const registry = await getRegistry(options.dbPath);',
        `// ${PATCH_MARKER}: ordinary reads share the same scoped native adapter as capture.
    const registry = await getRegistry(options.dbPath, { memoryEntriesOnly: typeof memoryEntriesOnlyRequested === 'function' && memoryEntriesOnlyRequested(options, true) });`)];
  }) },
];
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => hasPatch(source) && SPECS.some(spec => spec.edits.every(([, , to]) => count(source, to) === 1));
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const candidates = SPECS.filter(spec => spec.edits.every(([, from]) => count(source, from) === 1));
  if (hasPatch(source) || candidates.length !== 1) return { next: source, applied: [], missing: ['native-recall-session-anchors'] };
  const edits = candidates[0].edits;
  return { next: edits.reduce((s, [, from, to]) => s.replace(from, () => to), source), applied: edits.map(([id]) => id), missing: [] };
}
const legacySearch = `    return session.search(args[5], args[3], Number(args[7]), deadline).then(row =>
      row.state === 'fallback'
        ? searchOnce({ ruflo, store, args, deadline, env, scratch, operation, signal, invocation })
        : { rows: [], ...row });`;
const legacyMode = 'memoryEntriesOnly: memoryEntriesOnlyRequested(options, true)';
const currentMode = "memoryEntriesOnly: typeof memoryEntriesOnlyRequested === 'function' && memoryEntriesOnlyRequested(options, true)";
const normalizeLegacy = source => source.replace(legacySearch, () => currentSearch).replaceAll(legacyMode, currentMode);
export const reverseSource = source => SPECS.flatMap(spec => spec.edits).reduceRight((s, [, from, to]) => s.replace(to, () => from), normalizeLegacy(source));
const brainSpecs = SPECS.filter(spec => spec.relative !== 'native-memory-bridge');
export const discover = () => [...discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: brainSpecs.map(spec => spec.relative),
}).filter(surface => surface.kind === 'full' && brainSpecs.every(spec => fs.existsSync(path.join(surface.root, spec.relative))))
  .flatMap(surface => brainSpecs.map(spec => path.join(surface.root, spec.relative))),
  ...discoverCapture().filter(file => file.endsWith('/memory-bridge.js'))];
const historicalPatchSource = (source, current = '') => {
  const result = patchSource(source);
  // Recognise the immediately preceding measured reader revision without changing
  // the pristine source or treating a failed read as a healthy empty namespace.
  const [, from, to] = SPECS[1].edits[0];
  let next = result.next;
  if (current.includes(legacySearch)) next = next.replace(currentSearch, () => legacySearch);
  if (current.includes(legacyMode)) next = next.replaceAll(currentMode, legacyMode);
  if (!current.includes(to)) next = next.replace(to, from);
  return { ...result, next };
};
// Retire on native shared-runtime search with identical results and deadline retirement.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource, historicalPatchSource };
