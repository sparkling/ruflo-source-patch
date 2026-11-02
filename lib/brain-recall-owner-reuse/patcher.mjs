// Brain #429: extend the existing public-memory reader; preserve native initialization and deadlines.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
import { descriptor as withdrawnRecall } from '../brain-recall-runtime/patcher.mjs';
export const NAME = 'brain-recall-owner-reuse';
export const PATCH_MARKER = 'ruflo-source-patch brain#429 owner-reuse';
export const SPECS = [
  {
    "relative": "scripts/agentdb-recall-reader.mjs",
    "edits": [
      [
        "search-capability",
        "  reply({ ready: true });",
        "  // ruflo-source-patch brain#429 owner-reuse: use the same published search as the native CLI.\n  reply({ ready: true, search: typeof mod.searchEntries === 'function' });"
      ],
      [
        "search-query",
        "  const run = async ({ op, namespace, key, limit }) => {",
        "  const run = async ({ op, namespace, key, limit, query }) => {"
      ],
      [
        "native-search",
        "    if (op === 'list') {",
        "    if (op === 'search') {\n      if (typeof mod.searchEntries !== 'function') return { state: 'fallback' };\n      if (typeof query !== 'string' || !query || limit !== 12) return { state: 'unavailable' };\n      const r = await mod.searchEntries({ query, namespace, limit, dbPath });\n      if (r?.success !== true || !Array.isArray(r.results) || r.results.length > 12\n        || !r.results.every(row => row && typeof row.key === 'string' && row.key && typeof row.namespace === 'string' && Number.isFinite(row.score) && typeof row.content === 'string')) return { state: 'unavailable' };\n      const response = { state: 'ok', rows: r.results.map(row => ({ key: row.key, score: row.score, namespace: row.namespace, preview: row.content, provenanceType: row.provenanceType })) };\n      return Buffer.byteLength(JSON.stringify(response)) > 1 << 20 ? { state: 'unavailable' } : response;\n    }\n    if (op === 'list') {"
      ]
    ]
  },
  {
    "relative": "scripts/agentdb-recall-process.mjs",
    "edits": [
      [
        "retirement-state",
        "  let child = null, cwd = null, ready = null, resolveReady = null, seq = 0, closed = false, timer;",
        "  // ruflo-source-patch brain#429 owner-reuse: shared ranking retains one bounded native owner.\n  let child = null, cwd = null, ready = null, resolveReady = null, seq = 0, closed = false, timer, searchCapable = false, childClosed = false, retirement;"
      ],
      [
        "cleanup-after-close",
        "    cwd?.cleanup?.();\n  };",
        "    if (!child || childClosed) cwd?.cleanup?.();\n  };"
      ],
      [
        "start-authority",
        "    if (child || closed) return;",
        "    if (child || closed || signal?.aborted || Date.now() >= deadline) return;"
      ],
      [
        "child-close",
        "      child.once('close', () => { resolve(false); if (!closed) settleAll('unavailable'); });",
        "      child.once('close', () => { childClosed = true; resolve(false); if (!closed) settleAll('unavailable'); cwd?.cleanup?.(); });"
      ],
      [
        "ready-capability",
        "        if (typeof row.ready === 'boolean') resolveReady(row.ready);",
        "        if (typeof row.ready === 'boolean') { searchCapable = row.ready && row.search === true; resolveReady(row.ready); }"
      ],
      [
        "stop-native-query",
        "    const opTimer = opDeadline < deadline ? setTimeout(() => finish({ state: 'timed out' }), Math.max(1, opDeadline - Date.now())) : null;",
        "    const opTimer = opDeadline < deadline ? setTimeout(() => request.op === 'search' ? close('timed out') : finish({ state: 'timed out' }), Math.max(1, opDeadline - Date.now())) : null;"
      ],
      [
        "verified-search-owner",
        "  return { storePath, close,",
        "  const retire = () => retirement ??= new Promise(resolve => {\n    close();\n    const settle = () => {\n      if (!child) return resolve('confirmed');\n      let alive = false;\n      try { process.kill(-child.pid, 0); alive = true; } catch (error) { alive = error.code !== 'ESRCH'; }\n      if (childClosed && !alive) return resolve('confirmed');\n      if (Date.now() >= deadline) return resolve('unconfirmed');\n      setTimeout(settle, Math.min(5, Math.max(1, deadline - Date.now())));\n    };\n    settle();\n  });\n  return { storePath, close, retire,\n    searchAvailable: async () => { start(); return !!child && await ready && searchCapable; },\n    search: async (query, namespace, opDeadline) => {\n      const result = await ask({ op: 'search', query, namespace, limit: 12 }, Math.max(1, opDeadline - 100));\n      return { ...result, state: result.state === 'ok' && !Array.isArray(result.rows) ? 'unavailable' : result.state,\n        rows: result.state === 'ok' && Array.isArray(result.rows) ? result.rows : [] };\n    },"
      ]
    ]
  },
  {
    "relative": "scripts/agentdb-recall.mjs",
    "edits": [
      [
        "owner-result",
        "  let session = null;",
        "  // ruflo-source-patch brain#429 owner-reuse: curated evidence survives a failed supplementary search.\n  let session = null, resultForRetirement = null, batchSearch = false;"
      ],
      [
        "qualify-shared-search",
        "    const specNamespace = path.basename(root);",
        "    batchSearch = session ? await session.searchAvailable() : false;\n    const specNamespace = path.basename(root);"
      ],
      [
        "single-search-owner",
        "    const spec = session && store ? searchOnce(",
        "    const spec = !batchSearch && session && store ? searchOnce("
      ],
      [
        "same-store-native-search",
        "...await (useSpec ? spec : searchOnce({ ruflo: bin, store: jobStore, deadline: searchDeadline, env, scratch: scratchFor, args, signal }))",
        "...await (batchSearch && session.storePath === jobStore.path ? session.search(query, namespace, searchDeadline) : useSpec ? spec : searchOnce({ ruflo: bin, store: jobStore, deadline: searchDeadline, env, scratch: scratchFor, args, signal }))"
      ],
      [
        "returned-receipt",
        "    return { block: formatBlock({ picks, status, withheld: curated?.withheld || 0 }), picks, stores, status: { 'memory.db': status }, outcome, receipt };",
        "    return resultForRetirement = { block: formatBlock({ picks, status, withheld: curated?.withheld || 0 }), picks, stores, status: { 'memory.db': status }, outcome, receipt };"
      ],
      [
        "confirmed-owner-retirement",
        "  finally { specAbort?.abort(); session?.close(); }",
        "  finally {\n    specAbort?.abort();\n    if (batchSearch && await session.retire() !== 'confirmed' && resultForRetirement) {\n      resultForRetirement.outcome = 'unavailable';\n      resultForRetirement.status = { 'memory.db': 'unavailable child retirement' };\n      resultForRetirement.block = formatBlock({ picks: resultForRetirement.picks, status: 'unavailable child retirement' });\n      if (resultForRetirement.receipt) resultForRetirement.receipt.outcome = 'unavailable';\n    }\n    if (!batchSearch) session?.close();\n  }"
      ]
    ]
  }
];

const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
const matching = (source, patched) => SPECS.filter(spec => spec.edits.every(([, from, next]) => count(source, patched ? next : from) === 1));
export const isPatched = source => hasPatch(source) && count(source, PATCH_MARKER) === 1 && matching(source, true).length === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const specs = matching(source, false);
  if (hasPatch(source) || specs.length !== 1) return { next: source, applied: [], missing: ['unique-native-recall-owner-bundle'] };
  return { next: specs[0].edits.reduce((body, [, from, next]) => body.replace(from, () => next), source),
    applied: specs[0].edits.map(([id]) => id), missing: [] };
}
export const reverseSource = source => SPECS.flatMap(spec => spec.edits).reduceRight((body, [, from, next]) => body.replace(next, () => from), source);
const surfaces = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: SPECS.map(spec => spec.relative) })
  .filter(surface => surface.kind === 'full');
export const discover = () => surfaces().flatMap(surface => SPECS.map(spec => path.join(surface.root, spec.relative)));
export function preflight() {
  const errors = [];
  for (const surface of surfaces()) for (const spec of SPECS) {
    const file = path.join(surface.root, spec.relative);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(surface.root, file) !== spec.relative)
        throw Error('absent, empty or unsafe recall owner member');
      let source = fs.readFileSync(file, 'utf8');
      // The shared composer withdraws #514 before this target. Qualify that exact
      // historical transform without writing or borrowing an unrelated backup.
      if (withdrawnRecall.hasPatch(source)) {
        const restored = withdrawnRecall.patchSource(source);
        if (restored.missing.length || withdrawnRecall.hasPatch(restored.next)) throw Error('unproved historical recall composition');
        source = restored.next;
      }
      const result = patchSource(source);
      if (result.missing.length || !spec.edits.every(([, , next]) => count(result.next, next) === 1))
        throw Error('required recall owner anchors do not match');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
// Retire only after native same-owner semantic parity, curated preservation and bounded group retirement are proved.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, transactionOwner: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource, preflight };
