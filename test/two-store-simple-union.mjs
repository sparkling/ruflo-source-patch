// Opt-in native reconciliation proof; no production stores are opened.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeDriver, inspectSnapshot } from '../scripts/two-store-recovery.mjs';
import { stageSimpleUnion } from '../scripts/two-store-simple-union.mjs';

const cliRoot = process.argv[2], { Database } = await nativeDriver(cliRoot);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-simple-union-proof-'));
const primary = path.join(scratch, 'primary.db'), secondary = path.join(scratch, 'secondary.db');
const run = name => stageSimpleUnion({ primary, secondary, cliRoot, destination: path.join(scratch, name) });
const mutate = (file, sql) => {
  fs.chmodSync(file, 0o600); const db = new Database(file);
  try { db.exec(sql); } finally { db.close(); fs.chmodSync(file, 0o400); }
};
try {
  for (const [i, file] of [primary, secondary].entries()) {
    const db = new Database(file);
    db.exec('CREATE TABLE memory_entries(id TEXT PRIMARY KEY,key TEXT,namespace TEXT,content TEXT,' +
      'embedding BLOB,created_at INTEGER,status TEXT,UNIQUE(namespace,key));');
    db.prepare('INSERT INTO memory_entries(rowid,id,key,namespace,content,embedding,created_at,status) VALUES(?,?,?,?,?,?,?,?)')
      .run(91, 'id-' + i, 'key-' + i, 'research', 'original-' + i, Buffer.from([0, 255, i]), 9007199254740993n, i ? 'deleted' : 'active');
    if (!i) db.exec("CREATE TABLE distill_state(namespace TEXT PRIMARY KEY,last_rowid INTEGER); INSERT INTO distill_state VALUES('research',40);" +
      'CREATE TABLE episodes(id INTEGER PRIMARY KEY,source_id TEXT REFERENCES memory_entries(id));' +
      "INSERT INTO episodes VALUES(31,'id-0');");
    else db.exec("ALTER TABLE memory_entries ADD COLUMN provenance_type TEXT DEFAULT 'unknown'");
    db.close(); fs.chmodSync(file, 0o400);
  }
  const before = [primary, secondary].map(file => inspectSnapshot(Database, file));
  const receipt = await run('success');
  assert.equal(receipt.status, 'verified'); assert.equal(receipt.inserted, 1);
  assert.equal(receipt.addedNativeColumn, 'provenance_type');
  const db = new Database(receipt.snapshot, { readonly: true }); db.defaultSafeIntegers(true);
  try {
    const rows = db.prepare('SELECT rowid,* FROM memory_entries ORDER BY id').all();
    assert.equal(rows[0].rowid, 91n); assert.equal(rows[1].rowid, 92n);
    assert.equal(rows[1].status, 'deleted'); assert.equal(rows[1].created_at, 9007199254740993n);
    assert.deepEqual(rows[1].embedding, Buffer.from([0, 255, 1]));
    assert.equal(db.prepare('SELECT last_rowid FROM distill_state').get().last_rowid, 40n);
    assert.equal(db.prepare('SELECT source_id FROM episodes').get().source_id, 'id-0');
  } finally { db.close(); }
  assert.deepEqual([primary, secondary].map(file => inspectSnapshot(Database, file)), before);
  await assert.rejects(run('success'), /already exists/);
  mutate(secondary, "INSERT INTO memory_entries(id,key,namespace,content) VALUES('other-id','key-0','research','different')");
  const conflict = await run('conflict'); assert.equal(conflict.status, 'blocked');
  assert(conflict.records.some(r => r.disposition === 'blocked-conflict'));
  assert(!fs.existsSync(conflict.snapshot), 'dry-run conflicts must not create a staged database');
  mutate(secondary, 'CREATE TABLE episodes(id INTEGER PRIMARY KEY); INSERT INTO episodes VALUES(1)');
  const state = await run('history'); assert.equal(state.status, 'blocked');
  assert(state.blockers.some(s => s.includes('additional state: episodes')));
  assert(!fs.existsSync(state.snapshot));
  console.log('bounded staging union: exact int64/blob/tombstone/native-ID preservation; primary rowids/cursors/learning untouched; conflicts and secondary controller history block before staged writes');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
