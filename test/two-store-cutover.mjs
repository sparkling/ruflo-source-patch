// Opt-in activation proof with real native SQLite and real descriptor census, fixture-only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeDriver, snapshotProject, stageClone, inspectSnapshot } from '../scripts/two-store-recovery.mjs';
import { activateAgentDb } from '../scripts/two-store-cutover.mjs';

const cliRoot = process.argv[2], { Database } = await nativeDriver(cliRoot);
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-cutover-proof-'));
fs.mkdirSync(path.join(project, '.swarm'));
const memory = path.join(project, '.swarm/memory.db'), agent = path.join(project, '.swarm/agentdb-memory.db');
let owner;
try {
  owner = new Database(memory); owner.pragma('journal_mode = WAL');
  owner.exec("CREATE TABLE records(id TEXT PRIMARY KEY,value TEXT); INSERT INTO records VALUES('old','retained')"); owner.close(); owner = null;
  fs.symlinkSync('memory.db', agent);
  const base = path.join(project, '.local/two-store-restoration');
  const final = await snapshotProject({ project, destination: base + '/final', cliRoot });
  const staged = await stageClone({ source: final.stores[0].snapshot, destination: base + '/stage', cliRoot });
  const args = { project, staged: staged.snapshot, finalReceipt: base + '/final/receipt.json', destination: base + '/cutover', cliRoot };
  const before = inspectSnapshot(Database, memory);
  owner = new Database(memory);
  await assert.rejects(activateAgentDb(args), /Live database handles/);
  assert(!fs.existsSync(args.destination)); owner.close(); owner = null;
  const receipt = await activateAgentDb(args);
  assert.equal(receipt.status, 'activated'); assert.equal(receipt.originalAlias, 'memory.db');
  assert(fs.lstatSync(receipt.original).isSymbolicLink()); assert(!fs.lstatSync(agent).isSymbolicLink());
  assert.deepEqual(inspectSnapshot(Database, memory), before); assert.deepEqual(inspectSnapshot(Database, agent), before);
  assert.notEqual(fs.statSync(memory).ino, fs.statSync(agent).ino);
  owner = new Database(agent); owner.exec("INSERT INTO records VALUES('new','independent owner')"); owner.close(); owner = null;
  assert.deepEqual(inspectSnapshot(Database, memory), before);
  assert.equal(inspectSnapshot(Database, agent).tables.find(t => t.name === 'records').rows, 2);
  await assert.rejects(activateAgentDb(args), /already exists/);
  const other = { ...args, destination: base + '/stale-final' };
  await assert.rejects(activateAgentDb(other), /Final source changed/);
  assert(!fs.existsSync(other.destination));
  console.log('native cutover: live holders refused; original alias archived intact; active files independent; exact content parity; subsequent AgentDB writes leave memory.db unchanged; repeat and stale-final activation refused');
} finally { owner?.close(); fs.rmSync(project, { recursive: true, force: true }); }
