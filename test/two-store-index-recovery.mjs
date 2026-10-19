// Opt-in native proof: corruption and all repairs are confined to disposable fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeDriver, inspectSnapshot } from '../scripts/two-store-recovery.mjs';
import { recoverIndex } from '../scripts/two-store-index-recovery.mjs';

const cliRoot = process.argv[2];
const { Database } = await nativeDriver(cliRoot);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-index-recovery-proof-'));
try {
  const source = path.join(scratch, 'corrupt.db');
  const db = new Database(source);
  db.exec('CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT, payload BLOB);' +
    "INSERT INTO records VALUES(1,'retained',x'00ff');" +
    'CREATE INDEX broken ON records(value) WHERE id < 0');
  // Deliberately stale index definition: only this disposable fixture is corrupted.
  db.unsafeMode(true);
  db.pragma('writable_schema = ON');
  db.prepare("UPDATE sqlite_schema SET sql=? WHERE name='broken'").run('CREATE INDEX broken ON records(value)');
  db.close();
  const before = inspectSnapshot(Database, source, { requireIntegrity: false });
  assert(before.integrity.includes('wrong # of entries in index broken'));
  assert.throws(() => inspectSnapshot(Database, source), /integrity check failed/);
  const destination = path.join(scratch, 'repaired');
  const receipt = await recoverIndex({ source, destination, cliRoot, index: 'broken' });
  assert.equal(receipt.status, 'verified'); assert.equal(receipt.after.integrity, 'ok');
  assert.deepEqual(receipt.before.tables, receipt.after.tables);
  assert.deepEqual(inspectSnapshot(Database, source, { requireIntegrity: false }), before);
  await assert.rejects(recoverIndex({ source, destination, cliRoot, index: 'broken' }), /already exists/);
  await assert.rejects(recoverIndex({ source, destination: path.join(scratch, 'wrong-index'), cliRoot, index: 'absent' }), /exact index-count/);
  await assert.rejects(recoverIndex({ source: receipt.snapshot, destination: path.join(scratch, 'healthy'), cliRoot, index: 'broken' }), /exact index-count/);
  await assert.rejects(recoverIndex({ source, destination: path.join(scratch, 'invalid'), cliRoot, index: 'broken; VACUUM' }), /Invalid index/);
  console.log('staged index recovery: exact row/schema/FK parity; source remains corrupt and untouched; wrong/healthy/invalid targets refused');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
