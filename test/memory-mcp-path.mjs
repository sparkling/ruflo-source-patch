import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { MCP_PATH_ANCHOR, MCP_PATH_REPLACEMENT, MCP_LEGACY_ANCHOR, MCP_LEGACY_REPLACEMENT } from '../lib/cwd/memory-mcp-path.mjs';

const operations = ['storeEntry', 'searchEntries', 'listEntries', 'getEntry',
  'deleteEntry', 'initializeMemoryDatabase'];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function make(source, configured) {
  const capture = (options) => options;
  const body = source.replaceAll(
    "await import('../memory/memory-initializer.js')", 'initializer');
  return new AsyncFunction('process', 'initializer', ...operations,
    'checkMemoryInitialization', body)(
    { env: { CLAUDE_FLOW_DB_PATH: configured } },
    { resolveDbPath: (value) => path.resolve(value) },
    ...operations.map(() => capture), capture);
}
const user = '/configured/user-memory.db';
const pristine = await make(MCP_PATH_ANCHOR, user);
assert.equal((await pristine.getEntry({ key: 'existing' })).dbPath, undefined);
for (const configured of [undefined, '', '   ', user]) {
  const api = await make(MCP_PATH_REPLACEMENT, configured);
  for (const name of operations) {
    const options = { key: 'existing', namespace: 'user-patterns' };
    const result = await api[name](options);
    const expected = configured === user ? { ...options, dbPath: user } : options;
    if (configured === user && name === 'initializeMemoryDatabase') expected.migrate = false;
    assert.deepEqual(result, expected);
    assert.equal(options.dbPath, undefined, 'must not mutate the request');
  }
  assert.equal(await api.checkMemoryInitialization('/caller.db'), configured === user ? user : '/caller.db');
  let migrations = 0;
  new Function('process', 'hasLegacyStore', 'migrate',
    MCP_LEGACY_REPLACEMENT + ' migrate(); }')(
    { env: { CLAUDE_FLOW_DB_PATH: configured } }, () => true, () => migrations++);
  assert.equal(migrations, configured === user ? 0 : 1);
}
const api = await make(MCP_PATH_REPLACEMENT, user);
assert.equal((await api.getEntry({ dbPath: '/wrong/project.db' })).dbPath, user);
assert.equal((await api.initializeMemoryDatabase()).dbPath, user);
assert.equal((await api.initializeMemoryDatabase({migrate:true})).migrate, false);

// Real patch-engine lifecycle against source fixtures only; never a memory database.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-path-test-'));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
const file = path.join(process.env.RUFLO_NPX_ROOT, 'fixture', 'node_modules',
  '@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'memory-tools.js');
const source = `async function getMemoryFunctions() {\n${MCP_PATH_ANCHOR}\n}\nfunction migrate() {\n${MCP_LEGACY_ANCHOR}\n return true;\n}\n}`;
fs.mkdirSync(path.dirname(file), {recursive:true});
fs.writeFileSync(file, source);
const {apply} = await import('../lib/cwd/patch-library.mjs');
try {
  const first = apply(['memory']);
  assert.equal(first.patched, 1);
  assert.equal(first.incomplete, 0);
  assert.equal(first.errors, 0);
  assert.equal(apply(['memory']).patched, 0, 'idempotent reapply');
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), source);
  apply([]);
  assert.equal(fs.readFileSync(file, 'utf8'), source, 'exact pristine restoration');
  const drift = source.replace(MCP_LEGACY_ANCHOR, '        if (changedLegacy()) {');
  fs.writeFileSync(file, drift);
  const refused = apply(['memory']);
  assert.ok(refused.incomplete > 0, 'drift is not success');
  assert.equal(fs.readFileSync(file, 'utf8'), drift, 'no partial patch on drift');
} finally {
  fs.rmSync(scratch, {recursive:true, force:true});
}
console.log('memory MCP configured-store regression passed');
