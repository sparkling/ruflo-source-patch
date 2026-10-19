// Operator-authorized index repair on a NEW native snapshot only; never repairs its source.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeDriver, inspectSnapshot } from './two-store-recovery.mjs';

export async function recoverIndex({ source, destination, cliRoot, index }) {
  if (![source, destination, cliRoot].every(value => typeof value === 'string' && path.isAbsolute(value)))
    throw Error('Source, new destination and CLI root must be absolute');
  if (typeof index !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(index)) throw Error('Invalid index name');
  source = fs.realpathSync(source);
  if (!fs.statSync(source).isFile()) throw Error('Source must be a regular snapshot file');
  if (fs.existsSync(destination)) throw Error('Recovery destination already exists');
  const { Database, version } = await nativeDriver(cliRoot);
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const snapshot = path.join(destination, 'recovered.db');
  const receipt = { schema: 'ruflo-staged-index-recovery/v1', source, snapshot, index,
    cliVersion: version, startedAt: new Date().toISOString(), status: 'incomplete',
    qualification: 'Staging copy only; no live source repair or cutover.' };
  const save = () => fs.writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  save();
  try {
    const original = new Database(source, { readonly: true, fileMustExist: true });
    try { await original.backup(snapshot); } finally { original.close(); }
    fs.chmodSync(snapshot, 0o600);
    receipt.before = inspectSnapshot(Database, snapshot, { requireIntegrity: false }); save();
    const expected = `wrong # of entries in index ${index}`;
    const missing = new RegExp(`^row [0-9]+ missing from index ${index}$`);
    if (!receipt.before.complete || !Array.isArray(receipt.before.integrity)
      || !receipt.before.integrity.includes(expected)
      || receipt.before.integrity.some(message => message !== expected && !missing.test(message)))
      throw Error('Refusing repair: expected exact index-count diagnostics for the named index only');
    const db = new Database(snapshot, { fileMustExist: true });
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='index' AND name=?").get(index))
        throw Error('Named index is absent');
      db.exec(`REINDEX "${index}"`);
    } finally { db.close(); }
    receipt.after = inspectSnapshot(Database, snapshot);
    if (JSON.stringify(receipt.before.tables) !== JSON.stringify(receipt.after.tables)
      || receipt.before.schemaSha256 !== receipt.after.schemaSha256
      || JSON.stringify(receipt.before.foreignKeyViolations) !== JSON.stringify(receipt.after.foreignKeyViolations))
      throw Error('Repair failed exact table/schema/foreign-key parity');
    fs.chmodSync(snapshot, 0o400);
    receipt.status = 'verified'; receipt.completedAt = new Date().toISOString(); save();
    return receipt;
  } catch (error) { receipt.error = error.message; save(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, destination, cliRoot, index] = process.argv.slice(2);
  if (process.argv.length !== 6) throw Error('Usage: two-store-index-recovery.mjs <absolute-snapshot> <new-absolute-directory> <absolute-cli-root> <index-name>');
  const receipt = await recoverIndex({ source, destination, cliRoot, index });
  console.log(JSON.stringify({ status: receipt.status, source: receipt.source, snapshot: receipt.snapshot,
    integrity: receipt.after.integrity, tables: receipt.after.tables.length,
    foreignKeyViolations: receipt.after.foreignKeyViolations.length }));
}
