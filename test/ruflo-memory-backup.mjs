import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-backup-fixture-')));
process.env.RUFLO_SOURCE_PATCH_HOME = temporary;
process.env.RUFLO_GLOBAL_ROOT = path.join(temporary, 'global');
process.env.RUFLO_NPX_ROOT = path.join(temporary, 'npx');
process.env.RSP_CODEX_HOME = path.join(temporary, '.codex');
const patch = await import('../lib/ruflo-memory-backup/patcher.mjs');
const fixture = name => fs.readFileSync(new URL(`./fixtures/ruflo-memory-backup/${name}`, import.meta.url), 'utf8');
const native = fixture('memory-backup.js');
const bridgeNative = fixture('bridge-owner.js');
const toolsNative = 'export const memoryTools = [\n];\n';
const commandNative = "export const backupCommand = { description: 'Snapshot active project memory stores — WAL-safe, rotated, optional GCS offsite', };\n";
for (const source of [native, bridgeNative, toolsNative, commandNative]) {
  const result = patch.patchSource(source);
  assert.deepEqual(result.missing, []);
  assert(patch.isPatched(result.next));
  assert.equal(patch.reverseSource(result.next), source);
  assert.equal(patch.patchSource(result.next).next, result.next);
  for (const invalid of [source + source, result.next + result.next,
    result.next.replace(patch.PATCH_MARKER, patch.PATCH_MARKER + ' changed')]) {
    assert(patch.patchSource(invalid).missing.length);
    assert.equal(patch.patchSource(invalid).next, invalid);
  }
}
assert(patch.patchSource(native.replace('fs.copyFileSync(dbPath, destPath)', 'foreignCopy(dbPath, destPath)')).missing.length);
for (const source of [bridgeNative, patch.patchSource(bridgeNative).next])
  assert(patch.patchSource(source.replace('activeOperations++;', '// lease removed')).missing.length);

function service(source, { failure, integrity = 'ok', empty = false, collision = false, borrowed = false } = {}) {
  const actions = [], files = new Map([['/fixture/memory.db', 128]]);
  const fakeFs = {
    existsSync: p => files.has(p), realpathSync: p => p,
    mkdirSync: p => actions.push(['mkdir', p]),
    lstatSync: () => ({ isDirectory: () => true }),
    copyFileSync: (a, b) => { actions.push(['copy', a, b]); files.set(b, files.get(a)); },
    statSync: p => ({ size: files.get(p) || 0 }),
    readdirSync: () => ['memory-2026-01-01T00-00-00-000Z.db', 'memory-2026-01-02T00-00-00-000Z.db'],
    rmSync: p => actions.push(['remove', p]),
    openSync: (p, mode) => { actions.push(['open-file', p, mode]); if (mode === 'wx') {
      if (collision || files.has(p)) throw Error('EEXIST'); files.set(p, 0);
    } return 42; }, closeSync: () => {}, fsyncSync: () => {},
  };
  class Database {
    constructor(p) { this.name = p; actions.push(['connection', p]); }
    pragma(p) { assert.equal(p, 'integrity_check'); actions.push(['integrity']); return integrity; }
    async backup(p) { actions.push(['backup', p]); if (failure) throw Error(failure); files.set(p, empty ? 0 : 128); }
    close() { actions.push(['close-source']); }
  }
  const a = source.indexOf('function fileStamp('), z = source.indexOf('/** Verify a snapshot');
  let body = source.slice(a, z).replace('export async function backupMemoryDb', 'async function backupMemoryDb');
  // Explicit fixture substitution only: no native driver or managed file is opened.
  body = body.replace('(await import(mod)).default', 'Database');
  const context = vm.createContext({ fs: fakeFs, path, Database,
    loadBetterSqlite3: async () => { actions.push(['load-driver']); return Database; } });
  const run = vm.runInContext(body + ';backupMemoryDb', context);
  const handle = borrowed ? new Database('/fixture/memory.db') : undefined;
  actions.length = 0;
  return { actions, handle, run: () => run({ dbPath: '/fixture/memory.db', destDir: '/fixture/backups',
    keep: 1, timestamp: 0, existingNativeHandle: handle }) };
}
const fixed = patch.patchSource(native).next;
for (const failure of ['database disk image is malformed', 'SQLITE_IOERR', 'SQLITE_BUSY']) {
  const old = service(native, { failure });
  assert.equal((await old.run()).backedUp, true, 'reproduce native false success');
  assert(old.actions.some(a => a[0] === 'copy'));
  assert(old.actions.some(a => a[0] === 'remove'));
  for (const borrowed of [false, true]) {
    const next = service(fixed, { failure, borrowed });
    const result = await next.run();
    assert.equal(result.backedUp, false);
    assert(result.skipped.includes(failure));
    assert(!next.actions.some(a => ['copy', 'remove'].includes(a[0])));
    if (borrowed) assert(!next.actions.some(a => ['load-driver', 'connection', 'close-source'].includes(a[0])));
  }
}
for (const options of [{ integrity: 'malformed' }, { collision: true }, { empty: true }]) {
  const test = service(fixed, { ...options, borrowed: true });
  assert.equal((await test.run()).backedUp, false);
  assert(!test.actions.some(a => ['copy', 'remove', 'close-source', 'connection'].includes(a[0])));
  if (options.integrity) assert(!test.actions.some(a => ['mkdir', 'backup'].includes(a[0])));
}
const healthy = service(fixed, { borrowed: true });
const receipt = await healthy.run();
assert.equal(receipt.backedUp, true);
assert.equal(receipt.restoreQualified, false);
assert.equal(receipt.snapshotIntegrity, 'not-checked');
assert(!healthy.actions.some(a => ['copy', 'remove', 'close-source', 'load-driver', 'connection'].includes(a[0])));
const collision = service(fixed, { collision: true, borrowed: true });
assert.equal((await collision.run()).partialPath, undefined, 'preexisting destination is never called our partial snapshot');

// Real native lifecycle lease and shutdown code, with only registry/filesystem/service fixtures.
let releaseBackup;
const pendingBackup = new Promise(resolve => { releaseBackup = resolve; });
let calls = 0, closed = 0, seen;
const db = { backup() {}, name: '/fixture/memory.db' };
const agentdb = { database: db, isWasm: false };
const registry = { getAgentDB: () => agentdb, shutdown: async () => { closed++; } };
const context = vm.createContext({ AsyncLocalStorage, path, process,
  canonicalDbPath: p => p, shouldDisableNativeBridge: () => false,
  fixtureFs: { lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false, uid: process.getuid() }), realpathSync: p => p },
  fixtureService: { backupMemoryDb: async opts => { calls++; seen = opts; await pendingBackup; return { backedUp: true }; } },
});
let bridge = patch.patchSource(bridgeNative).next.replaceAll('export ', '');
assert.equal(bridge.split("await import('node:fs')").length, 2);
bridge = bridge.replace("await import('node:fs')", 'fixtureFs')
  .replace("await import('../services/memory-backup.js')", 'fixtureService');
const api = vm.runInContext(bridge + ';({bridgeBackupExisting,shutdownBridge,registryInstances})', context);
const args = { dbPath: '/fixture/memory.db', destDir: '/fixture/backups' };
assert.equal((await api.bridgeBackupExisting(args)).success, false, 'absent owner never initializes');
assert.equal(calls, 0);
api.registryInstances.set(args.dbPath, registry);
assert.equal((await api.bridgeBackupExisting({ ...args, dbPath: 'relative' })).success, false);
agentdb.isWasm = true;
assert.equal((await api.bridgeBackupExisting(args)).success, false);
agentdb.isWasm = false;
const healthyService = context.fixtureService.backupMemoryDb;
context.fixtureService.backupMemoryDb = async () => ({ backedUp: false, skipped: 'Source integrity failed' });
const refused = await api.bridgeBackupExisting(args);
assert.equal(refused.success, false);
assert.equal(refused.error, 'Source integrity failed', 'native MCP hasToolError requires a nonempty error string');
context.fixtureService.backupMemoryDb = healthyService;
const operation = api.bridgeBackupExisting(args);
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls, 1);
assert.equal(seen.existingNativeHandle, db);
const shutdown = api.shutdownBridge();
await new Promise(resolve => setImmediate(resolve));
assert.equal(closed, 0, 'native shutdown must wait for backup lease');
releaseBackup();
assert.equal((await operation).success, true);
await shutdown;
assert.equal(closed, 1);
assert.equal((await api.bridgeBackupExisting(args)).success, false, 'retired owner must not be recreated');
// Shared composition install/uninstall only in a synthetic package tree.
const root = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src');
const sources = { 'services/memory-backup.js': native, 'memory/memory-bridge.js': bridgeNative,
  'mcp-tools/memory-tools.js': toolsNative, 'commands/memory-backup.js': commandNative };
for (const [file, source] of Object.entries(sources)) {
  const p = path.join(root, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, source);
}
const compose = await import('../lib/plugin-compose.mjs');
try {
  assert.equal(patch.preflight().ok, true);
  const applied = compose.applyComposed([patch.NAME]);
  assert.equal(applied.errors, 0, JSON.stringify(applied));
  assert.equal(applied.incomplete, 0, JSON.stringify(applied));
  assert.equal(applied.patched, 4);
  assert.equal(compose.applyComposed([patch.NAME]).patched, 0);
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  for (const [file, source] of Object.entries(sources)) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), source);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log('ruflo-memory-backup: source guards, error reproduction, preservation and native owner lease passed');
