// Bounded staging union: secondary has only ordinary records and no controller history.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeDriver, inspectSnapshot, quoteIdentifier as q, rowFingerprint } from './two-store-recovery.mjs';

export async function stageSimpleUnion({ primary, secondary, destination, cliRoot }) {
  if (![primary, secondary, destination, cliRoot].every(v => typeof v === 'string' && path.isAbsolute(v)))
    throw Error('Snapshot paths, new destination and CLI root must be absolute');
  for (const file of [primary, secondary]) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || (stat.mode & 0o222)) throw Error('Inputs must be immutable native recovery snapshots');
  }
  if (fs.existsSync(destination)) throw Error('Staging destination already exists');
  const { Database, version } = await nativeDriver(cliRoot);
  const before = { primary: inspectSnapshot(Database, primary), secondary: inspectSnapshot(Database, secondary) };
  if (Object.values(before).some(s => !s.complete || s.foreignKeyViolations.length))
    throw Error('Inputs require complete integrity and foreign-key proof');
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const snapshot = path.join(destination, 'agentdb-memory.db');
  const receipt = { schema: 'ruflo-two-store-simple-union/v1', primary, secondary, snapshot,
    cliVersion: version, startedAt: new Date().toISOString(), status: 'planning', before,
    qualification: 'Staging only. Primary records/rowids/cursors retained. Secondary has no controller or distillation history. No historical hook replay.',
    records: [], blockers: [] };
  const save = () => fs.writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  save();
  const a = new Database(primary, { readonly: true, fileMustExist: true });
  const b = new Database(secondary, { readonly: true, fileMustExist: true });
  a.defaultSafeIntegers(true); b.defaultSafeIntegers(true);
  try {
    const unsupported = before.secondary.tables.filter(t => t.rows && t.name !== 'memory_entries');
    if (unsupported.length) receipt.blockers.push('Secondary has additional state: ' + unsupported.map(t => t.name).join(', '));
    const info = db => db.pragma('table_xinfo(memory_entries)');
    const ac = info(a), bc = info(b);
    if (!ac.length || !bc.length || [...ac, ...bc].some(c => c.hidden)) receipt.blockers.push('Unsupported ordinary table schema');
    const names = [...new Set([...ac, ...bc].map(c => c.name))].sort();
    for (const c of names) if ((!ac.some(v => v.name === c) || !bc.some(v => v.name === c)) && c !== 'provenance_type')
      receipt.blockers.push('Unsupported column difference: ' + c);
    const triggers = a.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND tbl_name='memory_entries'").all();
    if (triggers.length) receipt.blockers.push('Ordinary insert triggers require a separate preservation proof');
    if (receipt.blockers.length) { receipt.status = 'blocked'; save(); return receipt; }
    const select = columns => names.map(n => columns.some(c => c.name === n) ? q(n) : "'unknown' AS " + q(n)).join(',');
    const primaryRows = a.prepare('SELECT rowid AS __rowid,' + select(ac) + ' FROM memory_entries NOT INDEXED').all();
    const secondaryRows = b.prepare('SELECT rowid AS __rowid,' + select(bc) + ' FROM memory_entries NOT INDEXED').all();
    const identity = r => JSON.stringify([r.namespace, r.key]);
    const fingerprint = r => rowFingerprint(names.map(n => r[n]));
    for (const rows of [primaryRows, secondaryRows]) {
      if (rows.some(r => typeof r.id !== 'string' || !r.id || typeof r.key !== 'string')
        || new Set(rows.map(r => r.id)).size !== rows.length
        || new Set(rows.map(identity)).size !== rows.length)
        receipt.blockers.push('Ordinary source identities are missing or ambiguous');
    }
    if (receipt.blockers.length) { receipt.status = 'blocked'; save(); return receipt; }
    const byId = new Map(primaryRows.map(r => [r.id, r]));
    const byKey = new Map(primaryRows.map(r => [identity(r), r]));
    const inserts = [];
    for (const row of secondaryRows) {
      const sameId = byId.get(row.id), sameKey = byKey.get(identity(row));
      const exact = sameId && sameKey === sameId && fingerprint(sameId) === fingerprint(row);
      const disposition = exact ? 'already-exact' : sameId || sameKey ? 'blocked-conflict' : 'insert-exact';
      receipt.records.push({ id: row.id, namespace: row.namespace, key: row.key, sha256: fingerprint(row), disposition });
      if (disposition === 'blocked-conflict') receipt.blockers.push('Conflicting ordinary identity: ' + identity(row));
      if (disposition === 'insert-exact') inserts.push(row);
    }
    if (receipt.blockers.length) { receipt.status = 'blocked'; save(); return receipt; }
    // The full disposition manifest is persisted before creating any staged database.
    receipt.status = 'planned'; receipt.columns = names; save();
    await a.backup(snapshot);
    fs.chmodSync(snapshot, 0o600);
    const staged = new Database(snapshot, { fileMustExist: true }); staged.defaultSafeIntegers(true);
    try {
      staged.pragma('foreign_keys = ON');
      if (!ac.some(c => c.name === 'provenance_type') && names.includes('provenance_type')) {
        // Exact upstream memory-bridge.js additive schema migration.
        staged.exec("ALTER TABLE memory_entries ADD COLUMN provenance_type TEXT DEFAULT 'unknown'");
        receipt.addedNativeColumn = 'provenance_type';
      }
      const insert = staged.prepare(`INSERT INTO memory_entries (${names.map(q).join(',')}) VALUES (${names.map(() => '?').join(',')})`);
      staged.transaction(() => { for (const row of inserts) insert.run(...names.map(n => row[n])); })();
      const get = staged.prepare('SELECT rowid AS __rowid,' + names.map(q).join(',') + ' FROM memory_entries WHERE id IS ?');
      for (const row of [...primaryRows, ...secondaryRows]) {
        const found = get.get(row.id);
        if (!found || fingerprint(found) !== fingerprint(row)) throw Error('Exact ordinary row readback failed');
      }
      for (const row of primaryRows) if (get.get(row.id).__rowid !== row.__rowid) throw Error('Primary distillation rowid changed');
      if (staged.prepare('SELECT count(*) AS n FROM memory_entries').get().n !== BigInt(primaryRows.length + inserts.length))
        throw Error('Unexpected ordinary row count');
    } finally { staged.close(); }
    receipt.after = inspectSnapshot(Database, snapshot);
    for (const table of before.primary.tables.filter(t => t.name !== 'memory_entries')) {
      if (JSON.stringify(table) !== JSON.stringify(receipt.after.tables.find(t => t.name === table.name)))
        throw Error('Primary non-ordinary state changed: ' + table.name);
    }
    if (!receipt.after.complete || receipt.after.foreignKeyViolations.length) throw Error('Staged integrity/FK inspection incomplete');
    fs.chmodSync(snapshot, 0o400);
    receipt.inserted = inserts.length; receipt.primaryRows = primaryRows.length;
    receipt.status = 'verified'; receipt.completedAt = new Date().toISOString(); save(); return receipt;
  } catch (error) { receipt.status = 'failed'; receipt.error = error.message; save(); throw error; }
  finally { a.close(); b.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [primary, secondary, destination, cliRoot] = process.argv.slice(2);
  if (process.argv.length !== 6) throw Error('Usage: two-store-simple-union.mjs <primary-snapshot> <secondary-snapshot> <new-absolute-directory> <absolute-cli-root>');
  const r = await stageSimpleUnion({ primary, secondary, destination, cliRoot });
  console.log(JSON.stringify({ status: r.status, primaryRows: r.primaryRows, inserted: r.inserted, blockers: r.blockers, snapshot: r.snapshot }));
  if (r.status !== 'verified') process.exitCode = 1;
}
