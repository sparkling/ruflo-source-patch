import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { STATS_OLD, STATS_342, STATS_351, STATS_NEW, STATS_SQL, STATS_351_SQL, STATS_PREFIX } from '../lib/ruflo-memory-stats/patcher.mjs';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-stats-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
const root = path.join(scratch, 'npx', 'fixture', 'node_modules', '@claude-flow', 'cli');
const mem = path.join(root, 'dist', 'src', 'memory');
const toolDir = path.join(root, 'dist', 'src', 'mcp-tools');
fs.mkdirSync(mem, { recursive: true });
fs.mkdirSync(toolDir, { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), '{"name":"@claude-flow/cli","version":"fixture","type":"module"}');
const file = path.join(toolDir, 'memory-tools.js');
const bridgeFile = path.join(mem, 'memory-bridge.js');
const pristine = `function ensureInitialized() { throw new Error('raw WAL probe forbidden'); }
function getMemoryFunctions() { throw new Error('raw initializer import forbidden'); }
function describeBackend() { throw new Error('unmeasured backend probe forbidden'); }
export const tool = {
${STATS_PREFIX}${STATS_OLD}
};`;
fs.writeFileSync(file, pristine);
fs.writeFileSync(bridgeFile, `let value = null; let calls = 0;
export function setRegistry(v) { value = v; calls = 0; }
export function getCalls() { return calls; }
export async function getControllerRegistry(...args) {
  if (args.length) throw new Error('stats changed default database authority');
  calls++; if (value instanceof Error) throw value; return value;
}
`);
const { apply } = await import('../lib/cwd/patch-library.mjs');
const db = new DatabaseSync(':memory:'); // Only a new, test-owned in-memory store.
try {
  const applied = apply(['ruflo-memory-stats']);
  assert.equal(applied.patched, 1);
  assert.equal(applied.incomplete, 0);
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), pristine);
  assert.equal(apply(['ruflo-memory-stats']).patched, 0);
  assert.equal(spawnSync(process.execPath, ['--check', file]).status, 0);
  const { tool } = await import(pathToFileURL(file).href);
  const bridge = await import(pathToFileURL(bridgeFile).href);
  let prepares = 0;
  const existingHandle = {
    prepare(sql) { prepares++; assert.equal(sql, STATS_SQL); return db.prepare(sql); },
    close() { assert.fail('borrowed handle closed'); },
    exec() { assert.fail('DDL/checkpoint performed'); },
  };
  bridge.setRegistry({ getAgentDB: () => ({ database: existingHandle }) });
  db.exec('CREATE TABLE memory_entries (namespace TEXT, status TEXT, embedding TEXT, created_at)');
  let result = await tool.handler();
  assert.equal(result.success, true);
  assert.equal(result.initialized, true);
  assert.equal(result.totalEntries, 0, 'empty is measured, not a swallowed error');
  assert.equal(result.embeddingCoverage, '0%');
  assert.equal(prepares, 1, 'one aggregate statement');
  assert.equal(bridge.getCalls(), 1, 'same registry, no alternate driver');
  const insert = db.prepare('INSERT INTO memory_entries (namespace, status, embedding) VALUES (?, ?, ?)');
  insert.run('constructor', 'active', '[0.1,0.2,0.3]');
  insert.run('__proto__', null, '[0.1,0.2,0.3]');
  insert.run('legacy', null, null);
  insert.run('', 'active', null);
  insert.run(null, 'active', '[]');
  insert.run('deleted', 'deleted', '[0.1,0.2,0.3]');
  insert.run('archived', 'archived', null);
  db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100001)
    INSERT INTO memory_entries (namespace, status, embedding) SELECT 'large', 'active', '[0.1,0.2,0.3]' FROM n`);
  result = await tool.handler();
  assert.equal(result.totalEntries, 100006);
  assert.equal(result.entriesWithEmbeddings, 100003);
  assert.equal(result.namespaces.large, 100001, 'no 100k listing cap');
  assert.equal(result.namespaces.default, 2, 'same default normalization as CRUD');
  assert.equal(result.namespaces.constructor, 1);
  assert.equal(result.namespaces.__proto__, 1);
  assert.equal(Object.getPrototypeOf(result.namespaces), null);
  assert.equal(JSON.parse(JSON.stringify(result)).namespaces.__proto__, 1);
  assert.equal(result.namespaces.deleted, undefined);
  assert.equal(result.namespaces.archived, undefined);
  assert.equal(result.features.hnswIndex, null, 'counts do not prove index readiness');
  assert.equal(result.version, null, 'no invented version');
  assert.equal(result.reportingContract, 'registry-memory-stats-v1');
  // A commit through the already-open owner must be visible on the next call.
  insert.run('after-first-read', 'active', null);
  assert.equal((await tool.handler()).totalEntries, 100007);
  for (const unavailable of [null, {}, new Error('registry load failed'),
    { getAgentDB: () => ({ database: { prepare() { throw new Error('SQLITE_BUSY'); } } }) }]) {
    bridge.setRegistry(unavailable);
    result = await tool.handler();
    assert.equal(result.success, false);
    assert.equal(result.initialized, null, 'unavailable is not uninitialized');
    assert.equal(result.totalEntries, null);
    assert.equal(result.namespaces, null);
    assert.ok(result.error);
  }
  for (const rows of [null, [{ namespace: 'x', total: -1, embedded: 0 }],
    [{ namespace: 'x', total: 1, embedded: 2 }],
    [{ namespace: 'x', total: 1, embedded: 0 }, { namespace: 'x', total: 1, embedded: 0 }],
    [{ namespace: 'x', total: Number.MAX_SAFE_INTEGER, embedded: 0 }, { namespace: 'y', total: 1, embedded: 0 }]]) {
    bridge.setRegistry({ getAgentDB: () => ({ database: { prepare: () => ({ all: () => rows }) } }) });
    assert.equal((await tool.handler()).success, false, 'malformed aggregates fail closed');
  }
  apply([]);
  assert.equal(fs.readFileSync(file, 'utf8'), pristine, 'byte-exact restoration');
  const legacy = pristine.replace('backend: await describeBackend(),', "backend: 'sql.js + HNSW',");
  fs.writeFileSync(file, legacy);
  assert.equal(apply(['ruflo-memory-stats']).incomplete, 0, 'exact legacy source supported');
  const legacyTool = (await import(pathToFileURL(file).href + '?legacy')).tool;
  bridge.setRegistry({ getAgentDB: () => ({ database: existingHandle }) });
  assert.equal((await legacyTool.handler()).totalEntries, 100007);
  apply([]);
  assert.equal(fs.readFileSync(file, 'utf8'), legacy, 'legacy source restored exactly');
  const native342 = pristine.replace(STATS_OLD, STATS_342);
  fs.writeFileSync(file, native342);
  assert.equal(apply(['ruflo-memory-stats']).incomplete, 0, 'exact Ruflo 3.42.4 source supported');
  const native342Tool = (await import(pathToFileURL(file).href + '?native342')).tool;
  bridge.setRegistry({ getAgentDB: () => ({ database: existingHandle }) });
  assert.equal((await native342Tool.handler()).totalEntries, 100007);
  apply([]);
  assert.equal(fs.readFileSync(file, 'utf8'), native342, '3.42.4 source restored exactly');
  const native351Source = `import { resolve } from 'node:path';
import { statSync } from 'node:fs';
function ensureInitialized() { throw new Error('default initialization forbidden'); }
export const tool = {
${STATS_351}
};`;
  fs.writeFileSync(file, native351Source);
  assert.equal(apply(['ruflo-memory-stats']).incomplete, 0, '3.51 native source supported');
  assert.equal(spawnSync(process.execPath, ['--check', file]).status, 0);
  // A separate fixture bridge verifies the selected explicit path reaches the
  // same existing owner; invalid paths must fail before acquiring any owner.
  fs.writeFileSync(bridgeFile, `export async function getControllerRegistry(dbPath) {
    return globalThis.__rspStatsOwner(dbPath);
  }`);
  // Existing imported bridge has its old exports cached, so use its test seam
  // for the default first, then execute the handler independently for path proof.
  const native351Handler = fs.readFileSync(file, 'utf8').slice(fs.readFileSync(file, 'utf8').indexOf('        handler:'));
  const executableHandler = native351Handler.slice(native351Handler.indexOf('async ('), native351Handler.lastIndexOf('},') + 1);
  const proofBridge = path.join(mem, 'path-proof-bridge.js');
  fs.writeFileSync(proofBridge, `export async function getControllerRegistry(dbPath) { return globalThis.__rspStatsOwner(dbPath); }`);
  const handlerSource = executableHandler.replace("'../memory/memory-bridge.js'", JSON.stringify(pathToFileURL(proofBridge).href));
  const native351HandlerFn = (await import('data:text/javascript;base64,' + Buffer.from(
    `import { resolve } from 'node:path'; import { statSync } from 'node:fs'; export default ${handlerSource};`).toString('base64'))).default;
  let paths = [];
  const datedHandle = { prepare(sql) { assert.equal(sql, STATS_351_SQL); return db.prepare(sql); } };
  globalThis.__rspStatsOwner = value => { paths.push(value); return { getAgentDB: () => ({ database: datedHandle }) }; };
  const explicit = path.join(scratch, 'chosen.db');
  fs.writeFileSync(explicit, 'test-owned metadata');
  const created = db.prepare('UPDATE memory_entries SET created_at = ? WHERE namespace = ?');
  created.run(1000, 'constructor');
  created.run('3000', 'legacy');
  created.run('1970-01-01T00:00:02.125Z', 'after-first-read');
  created.run('invalid-date', '__proto__');
  created.run(8640000000000001, 'deleted');
  db.prepare("INSERT INTO memory_entries (namespace,status,created_at) VALUES ('constructor','active',8640000000000001)").run();
  result = await native351HandlerFn({ dbPath: explicit });
  assert.equal(result.success, true);
  assert.deepEqual(paths, [explicit]);
  assert.equal(result.location, explicit);
  assert.equal(result.totalSize, fs.statSync(explicit).size);
  assert.equal(result.oldestEntry, '1970-01-01T00:00:01.000Z');
  assert.equal(result.newestEntry, '1970-01-01T00:00:03.000Z');
  assert.equal(result.totalEntries, 100008);
  for (const value of ['', '  ', 5, null]) assert.equal((await native351HandlerFn({ dbPath: value })).success, false);
  assert.deepEqual(paths, [explicit], 'invalid path never opens a registry');
  assert.equal((await native351HandlerFn()).success, true);
  assert.deepEqual(paths, [explicit, undefined], 'omitted path retains native default authority');
  delete globalThis.__rspStatsOwner;
  apply([]);
  assert.equal(fs.readFileSync(file, 'utf8'), native351Source, '3.51 exact reversal');
  const changedUpstream = pristine.replace('limit: 100000', 'limit: 200000');
  fs.writeFileSync(file, changedUpstream);
  const drift = apply(['ruflo-memory-stats']);
  assert.ok(drift.incomplete > 0 || drift.skipped > 0);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(STATS_NEW), 'drift is not partially patched');
  assert.equal(fs.readFileSync(file, 'utf8'), changedUpstream, 'unknown source remains byte-exact');
  console.log('Memory stats: real in-memory SQL, >100k, status, namespaces, errors, ownership, anchors and reversal passed.');
} finally {
  db.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
