// Explicit operator maintenance tool. Uses native online backup, never a live image copy.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const sha = value => createHash('sha256').update(value).digest('hex');
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const cell = value => Buffer.isBuffer(value) ? ['blob', value.toString('base64')]
  : typeof value === 'bigint' ? ['integer', String(value)]
  : value === null ? ['null'] : [typeof value, value];

export async function nativeDriver(cliRoot) {
  if (!path.isAbsolute(cliRoot)) throw Error('CLI root must be absolute');
  const manifest = JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8'));
  if (manifest.name !== '@claude-flow/cli') throw Error('Expected installed @claude-flow/cli');
  const { loadBetterSqlite3 } = await import(pathToFileURL(path.join(cliRoot, 'dist/src/memory/shared-sqlite.js')));
  return { Database: await loadBetterSqlite3(), version: manifest.version };
}

export function inspectSnapshot(Database, file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.defaultSafeIntegers(true);
  try {
    db.pragma('query_only = ON');
    const integrity = db.pragma('integrity_check').map(row => row.integrity_check);
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw Error('Snapshot integrity check failed');
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
    const tables = [];
    for (const item of schema.filter(row => row.type === 'table')) {
      const table = { name: item.name, sql: item.sql };
      try {
        table.columns = db.pragma(`table_xinfo(${quote(item.name)})`).map(row => Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value])));
        table.foreignKeys = db.pragma(`foreign_key_list(${quote(item.name)})`).map(row => Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value])));
        const statement = db.prepare(`SELECT * FROM ${quote(item.name)}`).raw();
        const hashes = [];
        for (const row of statement.iterate()) hashes.push(sha(JSON.stringify(row.map(cell))));
        hashes.sort();
        const hash = createHash('sha256');
        for (const row of hashes) hash.update(row + '\n');
        table.rows = hashes.length;
        table.contentSha256 = hash.digest('hex');
      } catch (error) { table.error = error.message; }
      tables.push(table);
    }
    const foreignKeyViolations = db.pragma('foreign_key_check').map(row => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? String(value) : value])));
    return { integrity: 'ok', schemaSha256: sha(JSON.stringify(schema)), tables, foreignKeyViolations,
      complete: tables.every(table => !table.error) };
  } finally { db.close(); }
}

export async function snapshotProject({ project, destination, cliRoot, storeNames = ['memory.db', 'agentdb-memory.db'] }) {
  if (![project, destination, cliRoot].every(value => typeof value === 'string' && path.isAbsolute(value)))
    throw Error('Project, destination and CLI root must be absolute');
  project = fs.realpathSync(project);
  if (!Array.isArray(storeNames) || !storeNames.length || new Set(storeNames).size !== storeNames.length
    || storeNames.some(name => !['memory.db', 'agentdb-memory.db'].includes(name)))
    throw Error('Select existing memory.db and/or agentdb-memory.db only');
  if (fs.existsSync(destination)) throw Error('Recovery destination already exists; never overwrite a receipt');
  const stores = storeNames.map(name => {
    const source = path.join(project, '.swarm', name);
    if (!fs.statSync(source).isFile()) throw Error('Required source is not a regular file');
    return { name, source, realpath: fs.realpathSync(source) };
  });
  if (stores.some(store => destination === store.realpath || destination.startsWith(store.realpath + path.sep)))
    throw Error('Recovery destination overlaps source');
  const { Database, version } = await nativeDriver(cliRoot);
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const receipt = { schema: 'ruflo-two-store-recovery/v1', project, cliVersion: version,
    startedAt: new Date().toISOString(), status: 'incomplete',
    qualification: 'Per-file consistent native snapshots; not an atomic cross-store cutover or proof that writers are idle.',
    stores: [] };
  const saved = new Map();
  const writeReceipt = () => fs.writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  writeReceipt();
  try {
    for (const store of stores) {
      if (saved.has(store.realpath)) {
        receipt.stores.push({ ...store, aliasOf: saved.get(store.realpath) });
        continue;
      }
      const snapshot = path.join(destination, store.name);
      const db = new Database(store.realpath, { readonly: true, fileMustExist: true });
      try { await db.backup(snapshot); }
      finally { db.close(); }
      fs.chmodSync(snapshot, 0o600);
      const inspection = inspectSnapshot(Database, snapshot);
      fs.chmodSync(snapshot, 0o400);
      receipt.stores.push({ ...store, snapshot, method: 'sqlite-online-backup', ...inspection });
      saved.set(store.realpath, store.name);
      writeReceipt();
    }
    receipt.status = receipt.stores.every(store => store.aliasOf || store.complete) ? 'verified' : 'inspection-incomplete';
    receipt.completedAt = new Date().toISOString();
    writeReceipt();
    return receipt;
  } catch (error) {
    receipt.error = error.message; writeReceipt(); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, project, destination, cliRoot, option, selected] = process.argv.slice(2);
  if (action !== 'snapshot' || ![6, 8].includes(process.argv.length)
    || option !== undefined && (option !== '--store' || !selected))
    throw Error('Usage: two-store-recovery.mjs snapshot <absolute-project> <new-absolute-destination> <absolute-cli-root> [--store memory.db|agentdb-memory.db]');
  const receipt = await snapshotProject({ project, destination, cliRoot, ...(selected && { storeNames: [selected] }) });
  console.log(JSON.stringify({ project, destination, status: receipt.status,
    stores: receipt.stores.map(store => ({ name: store.name, aliasOf: store.aliasOf,
      tables: store.tables?.map(table => ({ name: table.name, rows: table.rows, error: table.error })),
      foreignKeyViolations: store.foreignKeyViolations?.length })) }));
  if (receipt.status !== 'verified') process.exitCode = 1;
}
