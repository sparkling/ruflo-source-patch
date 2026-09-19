import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { STATS_OLD, STATS_342, STATS_NEW, STATS_SQL, STATS_PREFIX } from '../lib/ruflo-memory-stats/patcher.mjs';

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
  db.exec('CREATE TABLE memory_entries (namespace TEXT, status TEXT, embedding TEXT)');
  let result = await tool.handler();
  assert.equal(result.success, true);
  assert.equal(result.initialized, true);
  assert.equal(result.totalEntries, 0, 'empty is measured, not a swallowed error');
  assert.equal(result.embeddingCoverage, '0%');
  assert.equal(prepares, 1, 'one aggregate statement');
  assert.equal(bridge.getCalls(), 1, 'same registry, no alternate driver');
  const insert = db.prepare('INSERT INTO memory_entries VALUES (?, ?, ?)');
  insert.run('constructor', 'active', '[0.1,0.2,0.3]');
  insert.run('__proto__', null, '[0.1,0.2,0.3]');
  insert.run('legacy', null, null);
  insert.run('', 'active', null);
  insert.run(null, 'active', '[]');
  insert.run('deleted', 'deleted', '[0.1,0.2,0.3]');
  insert.run('archived', 'archived', null);
  db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100001)
    INSERT INTO memory_entries SELECT 'large', 'active', '[0.1,0.2,0.3]' FROM n`);
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
