// Explicit operator migration. Plans every supported source row before staging writes.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { nativeDriver, inspectSnapshot, quoteIdentifier as q, rowFingerprint } from './two-store-recovery.mjs';

const ORDER = ['memory_entries', 'episodes', 'reasoning_patterns', 'skills', 'tiered_memory',
  'episode_embeddings', 'pattern_embeddings', 'skill_embeddings', 'skill_links', 'causal_edges'];
const SPECIAL = ['distill_state', 'sqlite_sequence'];
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v);
const identity = row => json([row.namespace, row.key]);
const fingerprint = (row, names) => rowFingerprint(names.map(n => row[n]));

export function planUnion(a, b, before, custody) {
  if (typeof custody !== 'string' || !custody.trim()) throw Error('Explain primary record custody before planning');
  const plan = { tables: [], blockers: [], records: [], cursors: [], custody,
    qualification: 'Primary identities are current. Conflicting secondary ordinary versions receive runtime-migration-alternates identities; all other fields remain exact. Source originals are retained.' };
  const maps = new Map(), tablePlans = new Map();
  const meta = (store, name) => before[store].tables.find(t => t.name === name);
  const read = (db, name) => db.prepare('SELECT * FROM ' + q(name) + ' NOT INDEXED').all();
  const cursors = db => db.prepare("SELECT 1 FROM sqlite_schema WHERE name='distill_state'").get()
    ? db.prepare('SELECT * FROM distill_state').all() : [];
  const ac = cursors(a), bc = cursors(b);
  if ([...ac, ...bc].some(r => typeof r.last_rowid !== 'bigint' || r.last_rowid < 0n))
    plan.blockers.push('Unsupported negative or noninteger distillation cursor');
  const cursor = (rows, ns) => rows.find(r => r.namespace === (ns ?? 'default'))?.last_rowid ?? 0n;
  plan.cursors = bc.map(row => ({ ...row, disposition: 'translated-to-imported-rowids; primary cursor retained' }));
  for (const table of before.secondary.tables.filter(t => t.rows && !ORDER.includes(t.name) && !SPECIAL.includes(t.name)))
    plan.blockers.push('Unsupported populated secondary table: ' + table.name);
  for (const name of ORDER) {
    const am = meta('primary', name), bm = meta('secondary', name);
    if (!bm?.rows) continue;
    const names = [...new Set([...(am?.columns ?? []), ...bm.columns].map(c => c.name))].sort();
    if ([...(am?.columns ?? []), ...bm.columns].some(c => c.hidden)) plan.blockers.push('Generated/hidden columns: ' + name);
    if (am) for (const c of names) if ((!am.columns.some(v => v.name === c) || !bm.columns.some(v => v.name === c))
      && !(name === 'memory_entries' && c === 'provenance_type')) plan.blockers.push('Unsupported column difference: ' + name + '.' + c);
    const normalize = rows => rows.map(row => Object.fromEntries(names.map(n => [n, n in row ? row[n] : 'unknown'])));
    const ar = am ? normalize(read(a, name)) : [], br = normalize(read(b, name));
    const keys = bm.columns.filter(c => c.pk).sort((x, y) => x.pk - y.pk).map(c => c.name);
    if (keys.length !== 1) plan.blockers.push('Expected one native primary key: ' + name);
    const key = keys[0], used = new Set(ar.map(r => r[key]));
    const mapping = new Map(); maps.set(name, mapping);
    const t = { name, names, key, ar, br, rows: [], am, bm, mapping };
    tablePlans.set(name, t);
    if (name !== 'memory_entries') {
      const numeric = bm.columns.find(c => c.name === key)?.type === 'INTEGER';
      let next = [...ar, ...br].reduce((max, r) => typeof r[key] === 'bigint' && r[key] > max ? r[key] : max, 0n);
      for (const db of [a, b]) if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").get()) {
        const seq = db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(name)?.seq;
        if (typeof seq === 'bigint' && seq > next) next = seq;
      }
      // Embedding keys are mapped through their parent below, never allocated independently.
      for (const row of br) {
        let id = row[key];
        if (used.has(id) && !name.endsWith('_embeddings')) id = numeric ? ++next : 'rsp-' + hash(name + json(row));
        mapping.set(row[key], id); used.add(id);
      }
    }
    plan.tables.push({ name, primaryRows: ar.length, secondaryRows: br.length });
  }
  if (plan.blockers.length) return { plan, tablePlans };
  const memory = tablePlans.get('memory_entries');
  if (memory) {
    const { ar, br, names, mapping } = memory;
    const rowsWithIds = db => db.prepare('SELECT rowid AS __rowid,id FROM memory_entries NOT INDEXED').all();
    const ai = new Map(rowsWithIds(a).map(r => [r.id, r.__rowid]));
    const bi = new Map(rowsWithIds(b).map(r => [r.id, r.__rowid]));
    const byId = new Map(ar.map(r => [r.id, r])), byKey = new Map(ar.map(r => [identity(r), r]));
    for (const rows of [ar, br]) if (rows.some(r => typeof r.id !== 'string' || !r.id || typeof r.key !== 'string')
      || new Set(rows.map(r => r.id)).size !== rows.length || new Set(rows.map(identity)).size !== rows.length)
      plan.blockers.push('Ambiguous ordinary identities');
    let negative = [...ai.values()].reduce((min, r) => r < min ? r : min, 0n);
    for (const original of br) {
      const sameId = byId.get(original.id), sameKey = byKey.get(identity(original));
      const processed = bi.get(original.id) <= cursor(bc, original.namespace);
      if (sameId && sameKey === sameId && fingerprint(sameId, names) === fingerprint(original, names)) {
        mapping.set(original.id, original.id);
        if (processed && ai.get(original.id) > cursor(ac, original.namespace)) plan.blockers.push('Conflicting distillation status for identical ordinary record');
        plan.records.push({ table: memory.name, sourceId: original.id, disposition: 'already-exact', sha256: fingerprint(original, names) });
        continue;
      }
      const row = { ...original }, alternate = Boolean(sameId || sameKey);
      if (alternate) {
        const digest = hash(json([original.id, original.namespace, original.key, fingerprint(original, names)]));
        row.id = 'rsp-alternate-' + digest; row.namespace = 'runtime-migration-alternates'; row.key = digest;
        if (byId.has(row.id) || byKey.has(identity(row))) plan.blockers.push('Alternate identity already exists');
      }
      mapping.set(original.id, row.id);
      memory.rows.push({ original, row, rowid: processed ? --negative : undefined });
      plan.records.push({ table: memory.name, sourceId: original.id, sourceNamespace: original.namespace, sourceKey: original.key,
        targetId: row.id, targetNamespace: row.namespace, targetKey: row.key, sourceSha256: fingerprint(original, names),
        targetSha256: fingerprint(row, names), disposition: alternate ? 'preserve-qualified-alternate' : 'insert-exact',
        distillation: processed ? 'already-processed; negative imported rowid below native cursor' : 'unprocessed; new native rowid' });
    }
  }
  const ref = (table, id) => id == null ? id : maps.get(table)?.get(id) ?? id;
  const softTypes = { episode: 'episodes', skill: 'skills', note: 'notes', fact: 'facts', pattern: 'reasoning_patterns' };
  for (const [name, t] of tablePlans) {
    if (name === 'memory_entries') continue;
    for (const original of t.br) {
      const row = { ...original }; row[t.key] = ref(name, row[t.key]);
      for (const fk of t.bm.foreignKeys) row[fk.from] = ref(fk.table, original[fk.from]);
      if (name === 'tiered_memory') row.superseded_by = ref(name, original.superseded_by);
      if (name === 'causal_edges') {
        for (const side of ['from', 'to']) {
          const type = original[side + '_memory_type'], id = original[side + '_memory_id'];
          if (id !== 0n && !softTypes[type]) plan.blockers.push('Unknown causal reference type: ' + type);
          if (id !== 0n && softTypes[type]) {
            const table = softTypes[type];
            if (!meta('secondary', table) || !b.prepare(`SELECT 1 FROM ${q(table)} WHERE id IS ?`).get(id))
              plan.blockers.push('Unresolved secondary causal reference: ' + type + ':' + id);
          }
          row[side + '_memory_id'] = ref(softTypes[type], id);
        }
        for (const field of ['evidence_ids', 'experiment_ids']) if (original[field] && original[field] !== '[]')
          plan.blockers.push('Causal evidence references require an additional mapping proof');
      }
      if ((name === 'episodes' || name === 'reasoning_patterns') && typeof row.metadata === 'string') {
        let value; try { value = JSON.parse(row.metadata); } catch { value = null; }
        if (Array.isArray(value?.sourceIds)) {
          const ids = value.sourceIds.map(id => ref('memory_entries', id));
          if (json(ids) !== json(value.sourceIds)) row.metadata = JSON.stringify({ ...value, sourceIds: ids });
        }
      }
      t.rows.push({ original, row });
      plan.records.push({ table: name, sourceId: original[t.key], targetId: row[t.key],
        sourceSha256: fingerprint(original, t.names), targetSha256: fingerprint(row, t.names),
        changedFields: t.names.filter(n => fingerprint({ v: original[n] }, ['v']) !== fingerprint({ v: row[n] }, ['v'])), disposition: 'insert-with-explicit-reference-map' });
    }
  }
  return { plan, tablePlans };
}

export async function stageUnion({ primary, secondary, destination, cliRoot, custody }) {
  if (![primary, secondary, destination, cliRoot].every(v => typeof v === 'string' && path.isAbsolute(v))) throw Error('Absolute paths required');
  for (const f of [primary, secondary]) if (!fs.statSync(f).isFile() || (fs.statSync(f).mode & 0o222)) throw Error('Use immutable recovery snapshots');
  if (fs.existsSync(destination)) throw Error('Staging destination already exists');
  const { Database, version } = await nativeDriver(cliRoot);
  const before = { primary: inspectSnapshot(Database, primary), secondary: inspectSnapshot(Database, secondary) };
  if (Object.values(before).some(s => !s.complete || s.foreignKeyViolations.length)) throw Error('Incomplete input integrity/FK proof');
  const a = new Database(primary, { readonly: true }), b = new Database(secondary, { readonly: true });
  a.defaultSafeIntegers(true); b.defaultSafeIntegers(true);
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const receipt = { schema: 'ruflo-two-store-reference-union/v1', primary, secondary, cliVersion: version, before,
    status: 'planning', startedAt: new Date().toISOString(), snapshot: path.join(destination, 'agentdb-memory.db') };
  const save = () => fs.writeFileSync(path.join(destination, 'receipt.json'), json(receipt) + '\n', { mode: 0o600 });
  try {
    const { plan, tablePlans } = planUnion(a, b, before, custody); receipt.plan = plan;
    receipt.status = plan.blockers.length ? 'blocked' : 'planned'; save();
    if (plan.blockers.length) return receipt;
    await a.backup(receipt.snapshot); fs.chmodSync(receipt.snapshot, 0o600);
    const db = new Database(receipt.snapshot); db.defaultSafeIntegers(true);
    try {
      db.pragma('foreign_keys = ON');
      db.transaction(() => {
        for (const [name, t] of tablePlans) {
          if (!t.am) {
            db.exec(t.bm.sql);
            for (const item of b.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL").all(name)) db.exec(item.sql);
          } else if (name === 'memory_entries' && !t.am.columns.some(c => c.name === 'provenance_type') && t.names.includes('provenance_type'))
            db.exec("ALTER TABLE memory_entries ADD COLUMN provenance_type TEXT DEFAULT 'unknown'");
          const insert = db.prepare(`INSERT INTO ${q(name)} (${t.names.map(q).join(',')}) VALUES (${t.names.map(() => '?').join(',')})`);
          const withRowid = name === 'memory_entries' ? db.prepare(`INSERT INTO ${q(name)} (rowid,${t.names.map(q).join(',')}) VALUES (?,${t.names.map(() => '?').join(',')})`) : null;
          for (const { row, rowid } of t.rows) rowid === undefined ? insert.run(...t.names.map(n => row[n])) : withRowid.run(rowid, ...t.names.map(n => row[n]));
        }
        // Preserve AUTOINCREMENT high-water marks, including IDs whose source rows were deleted.
        if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").get()) for (const source of [a, b]) {
          if (!source.prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").get()) continue;
          for (const row of source.prepare('SELECT * FROM sqlite_sequence').all()) {
            if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(row.name)) throw Error('Sequence table absent');
            const prior = db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(row.name);
            if (!prior) db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run(row.name, row.seq);
            else if (row.seq > prior.seq) db.prepare('UPDATE sqlite_sequence SET seq=? WHERE name=?').run(row.seq, row.name);
          }
        }
      })();
      for (const [name, t] of tablePlans) {
        const get = db.prepare(`SELECT ${t.names.map(q).join(',')} FROM ${q(name)} WHERE ${q(t.key)} IS ?`);
        for (const row of [...t.ar, ...t.rows.map(r => r.row)]) if (fingerprint(get.get(row[t.key]) ?? {}, t.names) !== fingerprint(row, t.names))
          throw Error('Exact native row/reference readback failed: ' + name);
        const count = db.prepare('SELECT count(*) AS n FROM ' + q(name)).get().n;
        if (count !== BigInt(t.ar.length + t.rows.length)) throw Error('Unexpected target row count: ' + name);
      }
      for (const row of a.prepare('SELECT rowid AS r,id FROM memory_entries NOT INDEXED').iterate())
        if (db.prepare('SELECT rowid AS r FROM memory_entries WHERE id IS ?').get(row.id)?.r !== row.r) throw Error('Primary rowid changed');
    } finally { db.close(); }
    receipt.after = inspectSnapshot(Database, receipt.snapshot);
    for (const table of before.primary.tables.filter(t => !tablePlans.has(t.name) && t.name !== 'sqlite_sequence'))
      if (json(table) !== json(receipt.after.tables.find(t => t.name === table.name))) throw Error('Unrelated primary state changed: ' + table.name);
    if (!receipt.after.complete || receipt.after.foreignKeyViolations.length) throw Error('Target integrity/FK proof incomplete');
    fs.chmodSync(receipt.snapshot, 0o400); receipt.status = 'verified'; receipt.completedAt = new Date().toISOString(); save(); return receipt;
  } catch (error) { receipt.status = 'failed'; receipt.error = error.message; save(); throw error; }
  finally { a.close(); b.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [primary, secondary, destination, cliRoot, custody] = process.argv.slice(2);
  if (process.argv.length !== 7) throw Error('Usage: two-store-union.mjs <primary-snapshot> <secondary-snapshot> <new-directory> <cli-root> <primary-custody-explanation>');
  const r = await stageUnion({ primary, secondary, destination, cliRoot, custody });
  console.log(json({ status: r.status, snapshot: r.snapshot, blockers: r.plan?.blockers, tables: r.plan?.tables }));
  if (r.status !== 'verified') process.exitCode = 1;
}
