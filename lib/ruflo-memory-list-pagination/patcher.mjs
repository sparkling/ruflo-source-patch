// Ruflo #4686: let SQLite page row identities before materializing large values.
// No DDL, second driver, changed metadata projection or cross-call cache.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { makeSurface, makeDescriptor } from '../ruflo-memory-entries-only/transform.mjs';

export const NAME = 'ruflo-memory-list-pagination';
export const MARKER = 'ruflo-source-patch (ruflo#4686): page row identities before payloads';
const columns = 'id, key, namespace, content, embedding, access_count, created_at, updated_at, provenance_type, expires_at, tags';
const bridgeQuery = `\n        SELECT ${columns}
        FROM memory_entries
        WHERE \${statusFilter} \${extraFilter}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?\n      `;
const legacyQuery = `SELECT ${columns}
       FROM memory_entries WHERE \${whereSql}
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
const pageQuery = where => `SELECT ${columns} FROM memory_entries
        WHERE _rowid_ IN (SELECT _rowid_ FROM memory_entries WHERE ${where}
            ORDER BY updated_at DESC LIMIT ? OFFSET ?)
        ORDER BY updated_at DESC`;
// Keep the original query for legacy or unproved schema capabilities. Every
// other prepare error follows the existing native failure path. Both queries execute
// through the same native connection with identical parameters and row mapping.
export function prepareMemoryListPage(db, original, paged) {
  const rows = sql => {
    const statement = db.prepare(sql);
    try {
      if (typeof statement.all === 'function') return statement.all();
      const result = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    } finally { statement.free?.(); }
  };
  // A user column can shadow _rowid_; a view can yield NULL instead of throwing.
  // Unknown/older SQLite schema metadata keeps the exact native query.
  const tables = rows("PRAGMA table_list('memory_entries')");
  if (tables.length !== 1 || tables[0].type !== 'table' || tables[0].wr !== 0
      || tables[0].name?.toLowerCase() !== 'memory_entries') return db.prepare(original);
  const columns = rows('PRAGMA table_xinfo(memory_entries)');
  if (!columns.length || columns.some(row => typeof row.name !== 'string' || row.name.toLowerCase() === '_rowid_'))
    return db.prepare(original);
  try { return db.prepare(paged); }
  catch (error) {
    if (!/no such column: (?:memory_entries\.)?_rowid_\b/i.test(String(error?.message))) throw error;
    return db.prepare(original);
  }
}
const surface = (id, identity, target, query, where) => makeSurface({ id, identity, edits: [{
  id: NAME + '/' + id,
  old: `const ${target} = ${id === 'bridge' ? 'ctx.db' : 'db'}.prepare(\`${query}\`);`,
  new: `// ${MARKER}\n            ${prepareMemoryListPage.toString().replaceAll('\n', '\n            ')}
            const ${target} = prepareMemoryListPage(${id === 'bridge' ? 'ctx.db' : 'db'}, \`${query}\`, \`${pageQuery(where)}\`);`,
}] });
const surfaces = [
  surface('bridge', 'export async function bridgeListEntries(options) {', 'stmt', bridgeQuery, '${statusFilter} ${extraFilter}'),
  surface('sqljs', 'export async function listEntries(options) {', 'listStmt', legacyQuery, '${whereSql}'),
];
// 3.71.2 owns row-identity pagination natively. Retain only the established
// schema/error guard: shadowed _rowid_ and views can silently mispage, and its
// catch-all fallback masks unrelated native execution failures. SQL, bind values,
// embedding caps and row mapping remain upstream's exact implementation.
const nativeColumns = `const columns = '${columns}';`;
const nativeBridge = `${nativeColumns}
            const listLimit = options.includeEmbedding ? Math.min(safeLimit, MAX_LIST_EMBEDDINGS) : safeLimit;
            // #4686: sort only row identities first, then fetch the payload for the
            // page. The old query sorted full \`content\`/\`embedding\` payloads for
            // every row and discarded all but the requested page.
            const pagedSql = \`
        SELECT \${columns}
        FROM memory_entries
        WHERE _rowid_ IN (
          SELECT _rowid_
          FROM memory_entries
          WHERE \${statusFilter} \${extraFilter}
          ORDER BY updated_at DESC
          LIMIT ? OFFSET ?
        )
        ORDER BY updated_at DESC
      \`;
            const originalSql = \`
        SELECT \${columns}
        FROM memory_entries
        WHERE \${statusFilter} \${extraFilter}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      \`;`;
const nativeLegacy = `${nativeColumns}
        // #4686: page row identities first so the temporary sort B-tree does not
        // carry full content/embedding payloads for rows outside the page.
        const pagedSql = \`SELECT \${columns} FROM memory_entries
       WHERE _rowid_ IN (
         SELECT _rowid_ FROM memory_entries WHERE \${whereSql}
         ORDER BY updated_at DESC LIMIT ? OFFSET ?
       )
       ORDER BY updated_at DESC\`;
        const originalSql = \`SELECT \${columns} FROM memory_entries WHERE \${whereSql}
       ORDER BY updated_at DESC LIMIT ? OFFSET ?\`;`;
const bridgeExecution = `            let rows;
            try {
                rows = ctx.db.prepare(pagedSql).all(...filterParams, listLimit, safeOffset);
            }
            catch {
                // WITHOUT ROWID/legacy tables have no _rowid_: preserve the original
                // query rather than failing the page.
                rows = ctx.db.prepare(originalSql).all(...filterParams, listLimit, safeOffset);
            }`;
const legacyExecution = `        try {
            listRows = runList(pagedSql);
        }
        catch {
            // Legacy WITHOUT ROWID tables have no _rowid_: keep the original query.
            listRows = runList(originalSql);
        }`;
const guarded = (anchor, indent) => anchor + `\n${indent}// ${MARKER}: native query schema guard\n`
  + indent + prepareMemoryListPage.toString().replaceAll('\n', '\n' + indent);
const namespaceColumns = `const columns = options.namespaceOnly === true ? 'namespace' : '${columns}';`;
const namespaceBridgeRows = `            for (const row of rows) {\n                let tags = [];`;
const namespaceLegacyRows = `        for (const row of listRows) {\n            const [id, key, ns, content, embedding, accessCount, createdAt, updatedAt, provenanceTypeVal, expiresAtVal, tagsJson] = row;`;
const nativeSurfaces = (projectNamespaces) => [
  makeSurface({ id: 'native-bridge', identity: surfaces[0].identity, edits: [
    { id: 'native-bridge-query', old: nativeBridge, new: guarded(projectNamespaces
      ? nativeBridge.replace(nativeColumns, namespaceColumns) : nativeBridge, '            ') },
    { id: 'native-bridge-execute', old: bridgeExecution,
      new: '            const rows = prepareMemoryListPage(ctx.db, originalSql, pagedSql).all(...filterParams, listLimit, safeOffset);' },
    ...(projectNamespaces ? [{ id: 'native-namespace-rows', old: namespaceBridgeRows,
      new: `            for (const row of rows) {
                // ${MARKER}: internal namespace discovery need not materialize payloads.
                if (options.namespaceOnly === true) { entries.push({ namespace: row.namespace || 'default' }); continue; }
                let tags = [];` }] : []),
  ] }),
  makeSurface({ id: 'native-sqljs', identity: surfaces[1].identity, edits: [
    { id: 'native-sqljs-query', old: nativeLegacy, new: guarded(projectNamespaces
      ? nativeLegacy.replace(nativeColumns, namespaceColumns) : nativeLegacy, '        ') },
    { id: 'native-sqljs-prepare', old: 'const runList = (sql) => {\n            const stmt = db.prepare(sql);',
      new: 'const runList = () => {\n            const stmt = prepareMemoryListPage(db, originalSql, pagedSql);' },
    { id: 'native-sqljs-execute', old: legacyExecution, new: '        listRows = runList();' },
    ...(projectNamespaces ? [{ id: 'native-namespace-rows', old: namespaceLegacyRows,
      new: `        for (const row of listRows) {
            // ${MARKER}: retain native row selection and default namespace normalization.
            if (options.namespaceOnly === true) { entries.push({ namespace: row[0] || 'default' }); continue; }
            const [id, key, ns, content, embedding, accessCount, createdAt, updatedAt, provenanceTypeVal, expiresAtVal, tagsJson] = row;` }] : []),
  ] }),
];
export const discover = () => ['memory-bridge.js', 'memory-initializer.js'].flatMap(file =>
  discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'memory', file]).filter(location => {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.resolve(location, '../../../../package.json'), 'utf8')); }
    catch { return false; } // Unidentified package bytes are not this target's source authority.
    const [major, minor] = String(manifest?.version).split('.').map(Number);
    return manifest?.name === '@claude-flow/cli' && (major > 3 || major === 3 && minor >= 71);
  }));
// Retirement requires an upstream bounded-page implementation with behavioral
// proof for native/legacy filters, exact fields and complete offset enumeration.
// An unrecognized future query refuses its anchor; it is not assumed repaired.
const legacy = makeDescriptor({ name: NAME, surfaces, discover });
const priorNative = makeDescriptor({ name: NAME, surfaces: nativeSurfaces(false), discover });
const native = makeDescriptor({ name: NAME, surfaces: nativeSurfaces(true), discover });
const select = source => source.includes('const pagedSql =') ? native : legacy;
export const descriptor = { ...legacy,
  historicalPatchSource: source => source.includes('const pagedSql =') ? priorNative.patchSource(source) : legacy.patchSource(source),
  patchSource: source => select(source).patchSource(priorNative.isPatched(source) ? priorNative.reverse(source) : source),
  reverse: source => priorNative.isPatched(source) ? priorNative.reverse(source) : select(source).reverse(source),
  hasPatch: source => priorNative.hasPatch(source) || select(source).hasPatch(source),
  isPatched: source => select(source).isPatched(source),
};
export const { patchSource, reverse, hasPatch, isPatched } = descriptor;
