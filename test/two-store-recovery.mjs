// Opt-in native maintenance proof; all database operations use disposable fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeDriver, snapshotProject, inspectSnapshot } from '../scripts/two-store-recovery.mjs';

const cliRoot = process.argv[2];
const { Database } = await nativeDriver(cliRoot);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-two-store-recovery-proof-'));
const project = path.join(scratch, 'project');
fs.mkdirSync(path.join(project, '.swarm'), { recursive: true });
const owners = [];
try {
  for (const name of ['memory.db', 'agentdb-memory.db']) {
    const db = new Database(path.join(project, '.swarm', name)); owners.push(db);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT, embedding BLOB);' +
      'CREATE TABLE edges(id TEXT PRIMARY KEY, target INTEGER REFERENCES records(id));');
    db.prepare('INSERT INTO records VALUES(?,?,?)').run(9007199254740993n, name, Buffer.from([0, 255, 19]));
    db.prepare('INSERT INTO edges VALUES(?,?)').run('edge', 9007199254740993n);
  }
  const destination = path.join(scratch, 'recovery');
  const receipt = await snapshotProject({ project, destination, cliRoot });
  assert.equal(receipt.status, 'verified'); assert.equal(receipt.stores.length, 2);
  assert(receipt.stores.every(store => store.method === 'sqlite-online-backup' && store.integrity === 'ok'));
  for (const [index, store] of receipt.stores.entries()) {
    assert.equal(store.foreignKeyViolations.length, 0);
    assert.equal(store.tables.find(table => table.name === 'records').rows, 1);
    const db = new Database(store.snapshot, { readonly: true, fileMustExist: true });
    db.defaultSafeIntegers(true);
    try {
      const row = db.prepare('SELECT * FROM records').get();
      assert.equal(row.id, 9007199254740993n);
      assert.equal(row.value, store.name);
      assert.deepEqual(row.embedding, Buffer.from([0, 255, 19]));
    } finally { db.close(); }
    // A later source write cannot change the completed native snapshot.
    owners[index].prepare('UPDATE records SET value=?').run('later');
    assert.equal(inspectSnapshot(Database, store.snapshot).tables.find(t => t.name === 'records').contentSha256,
      store.tables.find(t => t.name === 'records').contentSha256);
  }
  await assert.rejects(snapshotProject({ project, destination, cliRoot }), /already exists/);
  await assert.rejects(snapshotProject({ project: 'relative', destination, cliRoot }), /absolute/);
  const aliasProject = path.join(scratch, 'alias-project');
  fs.mkdirSync(path.join(aliasProject, '.swarm'), { recursive: true });
  const aliasOwner = new Database(path.join(aliasProject, '.swarm/memory.db')); owners.push(aliasOwner);
  aliasOwner.exec('CREATE TABLE retained(id TEXT PRIMARY KEY); INSERT INTO retained VALUES(\'preserved\')');
  fs.symlinkSync('memory.db', path.join(aliasProject, '.swarm/agentdb-memory.db'));
  const alias = await snapshotProject({ project: aliasProject, destination: path.join(scratch, 'alias-recovery'), cliRoot });
  assert.equal(alias.status, 'verified'); assert.equal(alias.stores[1].aliasOf, 'memory.db');
  assert.equal(alias.stores[0].tables.find(t => t.name === 'retained').rows, 1);
  assert(fs.lstatSync(path.join(aliasProject, '.swarm/agentdb-memory.db')).isSymbolicLink());
  const invalid = path.join(scratch, 'invalid'); fs.mkdirSync(path.join(invalid, '.swarm'), { recursive: true });
  for (const name of ['memory.db', 'agentdb-memory.db']) fs.writeFileSync(path.join(invalid, '.swarm', name), 'RFE1-fixture');
  const failed = path.join(scratch, 'failed-recovery');
  await assert.rejects(snapshotProject({ project: invalid, destination: failed, cliRoot }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(failed, 'receipt.json'))).status, 'incomplete');
  for (const name of ['memory.db', 'agentdb-memory.db']) assert.equal(fs.readFileSync(path.join(invalid, '.swarm', name), 'utf8'), 'RFE1-fixture');
  console.log('native recovery: live WAL snapshots preserve int64/blob/FK data; stable exact fingerprints; aliases preserved; existing destinations and invalid native sources refuse without overwriting originals');
} finally {
  for (const owner of owners) owner.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
