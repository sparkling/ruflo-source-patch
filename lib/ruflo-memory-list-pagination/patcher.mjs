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
export const discover = () => ['memory-bridge.js', 'memory-initializer.js'].flatMap(file =>
  discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'memory', file]).filter(location => {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.resolve(location, '../../../../package.json'), 'utf8')); }
    catch { return false; } // Unidentified package bytes are not this target's source authority.
    const [major, minor] = String(manifest.version).split('.').map(Number);
    return manifest.name === '@claude-flow/cli' && (major > 3 || major === 3 && minor >= 71);
  }));
// Retirement requires an upstream bounded-page implementation with behavioral
// proof for native/legacy filters, exact fields and complete offset enumeration.
// An unrecognized future query refuses its anchor; it is not assumed repaired.
export const descriptor = makeDescriptor({ name: NAME, surfaces, discover });
export const { patchSource, reverse, hasPatch, isPatched } = descriptor;
