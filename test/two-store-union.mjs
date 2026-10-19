// Opt-in native proof. Uses shipped AgentDB schemas and disposable stores only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { nativeDriver, inspectSnapshot } from '../scripts/two-store-recovery.mjs';
import { stageUnion } from '../scripts/two-store-union.mjs';

const cliRoot = process.argv[2], { Database } = await nativeDriver(cliRoot);
const require = createRequire(path.join(cliRoot, 'package.json'));
const agentRoot = path.resolve(path.dirname(require.resolve('agentdb')), '../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-reference-union-proof-'));
const primary = path.join(scratch, 'primary.db'), secondary = path.join(scratch, 'secondary.db');
const run = name => stageUnion({ primary, secondary, destination: path.join(scratch, name), cliRoot,
  custody: 'Synthetic primary is the declared current ordinary owner; preserve both versions.' });
try {
  for (const [i, file] of [primary, secondary].entries()) {
    const db = new Database(file);
    db.exec(fs.readFileSync(path.join(agentRoot, 'dist/schemas/schema.sql'), 'utf8'));
    db.exec(fs.readFileSync(path.join(agentRoot, 'dist/schemas/frontier-schema.sql'), 'utf8'));
    db.exec("CREATE TABLE memory_entries(id TEXT PRIMARY KEY,key TEXT,namespace TEXT,content TEXT,embedding TEXT,status TEXT DEFAULT 'active',UNIQUE(namespace,key));" +
      'CREATE TABLE reasoning_patterns(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER,task_type TEXT,approach TEXT,success_rate REAL,uses INTEGER,avg_reward REAL,tags TEXT,metadata TEXT);' +
      'CREATE TABLE pattern_embeddings(pattern_id INTEGER PRIMARY KEY REFERENCES reasoning_patterns(id),embedding BLOB);' +
      'CREATE TABLE tiered_memory(id TEXT PRIMARY KEY,key TEXT,value TEXT,tier TEXT,ts INTEGER,valid_from TEXT,valid_until TEXT,superseded_by TEXT,archived INTEGER);' +
      'CREATE TABLE distill_state(namespace TEXT PRIMARY KEY,last_rowid INTEGER,last_run_at INTEGER);');
    db.prepare('INSERT INTO memory_entries(id,key,namespace,content,embedding) VALUES(?,?,?,?,?)')
      .run('same-id', 'same-key', 'research', 'version-' + i, '[1,0,0]');
    db.prepare('INSERT INTO episodes(id,session_id,task,reward,metadata) VALUES(1,?,?,?,?)')
      .run('session-' + i, 'task-' + i, 0.13 + i * 0.2, JSON.stringify({ namespace: 'research', sourceIds: ['same-id'] }));
    db.prepare('INSERT INTO episode_embeddings(episode_id,embedding) VALUES(1,?)').run(Buffer.from([0, 255, i]));
    db.prepare('INSERT INTO reasoning_patterns VALUES(1,?,?,?,?,?,?,?,?)')
      .run(9007199254740993n, 'type-' + i, 'approach-' + i, 0.25, 19, 0.125, '[]', JSON.stringify({ sourceIds: ['same-id'] }));
    db.prepare('INSERT INTO pattern_embeddings VALUES(1,?)').run(Buffer.from([0, 19, i]));
    db.prepare('INSERT INTO skills(id,name,signature,created_from_episode) VALUES(1,?,?,1)').run('skill-' + i, '{}');
    db.prepare('INSERT INTO skill_embeddings(skill_id,embedding) VALUES(1,?)').run(Buffer.from([17, i]));
    db.prepare('INSERT INTO causal_edges(id,from_memory_id,from_memory_type,to_memory_id,to_memory_type,confidence) VALUES(1,1,?,1,?,?)')
      .run('episode', 'skill', 0.37);
    db.prepare('INSERT INTO tiered_memory VALUES(?,?,?,?,?,?,?,?,?)')
      .run('same-tier', 'key-' + i, 'value-' + i, 'episodic', 19, '2026-01-01', '2027-01-01', null, 0);
    db.exec("INSERT INTO distill_state VALUES('research',1,901); UPDATE sqlite_sequence SET seq=100 WHERE name='episodes'");
    if (i) {
      db.exec("INSERT INTO memory_entries(id,key,namespace,content,embedding) VALUES('new','new-key','research','unprocessed','[0,1,0]');" +
        "INSERT INTO memory_entries(id,key,namespace,content,status) VALUES('deleted','deleted-key','research','tombstone','deleted');");
    }
    db.close(); fs.chmodSync(file, 0o400);
  }
  const before = [primary, secondary].map(f => inspectSnapshot(Database, f));
  const receipt = await run('verified'); assert.equal(receipt.status, 'verified');
  assert.equal(receipt.after.foreignKeyViolations.length, 0);
  const db = new Database(receipt.snapshot, { readonly: true }); db.defaultSafeIntegers(true);
  try {
    const alternate = db.prepare("SELECT rowid AS r,* FROM memory_entries WHERE namespace='runtime-migration-alternates'").get();
    assert(alternate.r < 0n); assert.equal(alternate.content, 'version-1');
    assert.equal(db.prepare("SELECT content FROM memory_entries WHERE namespace='research' AND key='same-key'").get().content, 'version-0');
    const episode = db.prepare("SELECT * FROM episodes WHERE session_id='session-1'").get();
    assert(episode.id > 100n); assert.equal(episode.reward, 0.33);
    assert.equal(JSON.parse(episode.metadata).sourceIds[0], alternate.id);
    assert.deepEqual(db.prepare('SELECT embedding FROM episode_embeddings WHERE episode_id=?').get(episode.id).embedding, Buffer.from([0, 255, 1]));
    const skill = db.prepare("SELECT * FROM skills WHERE name='skill-1'").get();
    assert.equal(skill.created_from_episode, episode.id);
    const edge = db.prepare('SELECT * FROM causal_edges WHERE id<>1').get();
    assert.equal(edge.from_memory_id, episode.id); assert.equal(edge.to_memory_id, skill.id); assert.equal(edge.confidence, 0.37);
    const pattern = db.prepare("SELECT * FROM reasoning_patterns WHERE task_type='type-1'").get();
    assert.equal(pattern.ts, 9007199254740993n); assert.equal(pattern.uses, 19n); assert.equal(pattern.avg_reward, 0.125);
    assert.equal(JSON.parse(pattern.metadata).sourceIds[0], alternate.id);
    assert.deepEqual(db.prepare('SELECT embedding FROM pattern_embeddings WHERE pattern_id=?').get(pattern.id).embedding, Buffer.from([0, 19, 1]));
    assert.equal(db.prepare("SELECT status FROM memory_entries WHERE id='deleted'").get().status, 'deleted');
    assert.equal(db.prepare("SELECT last_rowid FROM distill_state WHERE namespace='research'").get().last_rowid, 1n);
    const probe = path.join(scratch, 'distill-probe.db'); await db.backup(probe);
    const { runDistillation } = await import(pathToFileURL(path.join(cliRoot, 'dist/src/services/memory-distillation.js')));
    const report = await runDistillation({ dbPath: probe, dryRun: true });
    assert.equal(report.processed, 1, JSON.stringify(report));
  } finally { db.close(); }
  assert.deepEqual([primary, secondary].map(f => inspectSnapshot(Database, f)), before);
  await assert.rejects(run('verified'), /already exists/);
  fs.chmodSync(secondary, 0o600); const source = new Database(secondary);
  source.exec('CREATE TABLE unknown_state(id INTEGER); INSERT INTO unknown_state VALUES(1)'); source.close(); fs.chmodSync(secondary, 0o400);
  const blocked = await run('blocked'); assert.equal(blocked.status, 'blocked');
  assert(!fs.existsSync(blocked.snapshot)); assert(blocked.plan.blockers.some(s => s.includes('unknown_state')));
  console.log('native reference union: both conflicting versions; episode/skill/embedding/causal IDs mapped; metrics/int64/blob/tombstones/temporal history intact; native dry-run processes only genuinely unprocessed rows; originals unchanged; unsupported state blocks');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
