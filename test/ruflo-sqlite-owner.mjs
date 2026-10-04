import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
  SQLITE_OWNER_ENTRIES, SQLITE_OWNER_HELPER, BRIDGE_ANCHOR,
  ATTESTATION_ANCHOR, INITIALIZER_ANCHOR, INITIALIZER_REPLACEMENT,
  MARKER, patchSqliteOwnerSource, reverseSqliteOwnerSource,
} from '../lib/ruflo-sqlite-owner/patcher.mjs';
assert.equal(SQLITE_OWNER_ENTRIES.length, 3);
const args = process.argv.slice(2);
if (args[0] && path.isAbsolute(args[0]) && !args[0].endsWith('package.json')) {
  assert.ok(fs.statSync(args.shift()).isDirectory());
}
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--native-cli' && path.isAbsolute(args[1])));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-sqlite-owner-'));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
// Discovery snapshots home/global roots at import time. No discovery module may
// be statically imported before these isolated boundaries are established.
const { exerciseSqliteOwnerSources, probeSqliteOwnerReplacement } = await import('../lib/ruflo-sqlite-owner/probe.mjs');
const graphPristine = fs.readFileSync(new URL('./fixtures/ruflo-sqlite-owner/graph-edge-writer.js', import.meta.url), 'utf8');
const bridgePristine = `${BRIDGE_ANCHOR}\nexport function openAttestation() {\n${ATTESTATION_ANCHOR}\n return Database; }\n`;
const initPristine = [1, 2].map(n => `export async function loader${n}() { let Database; try {\n${INITIALIZER_ANCHOR}\n return Database; } catch { return null; } }`).join('\n');
const helperFile = 'memory-bridge.js';
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }
function packageAt(dir, name, source, extra = {}) {
  write(path.join(dir, 'package.json'), JSON.stringify({ name, main: 'index.cjs', ...extra }));
  write(path.join(dir, 'index.cjs'), source);
}
function fixture(label, { patch = true, ownerCode, nativeOwner, foreignBinding } = {}) {
  const root = path.join(scratch, label);
  const mem = path.join(root, 'dist', 'src', 'memory');
  write(path.join(root, 'package.json'), JSON.stringify({ name: '@claude-flow/cli', version: 'fixture', type: 'module' }));
  // Place one decoy AgentDB directly under CLI and the authoritative owner
  // underneath @claude-flow/memory. This catches direct CLI agentdb resolution.
  const memory = path.join(root, 'node_modules', '@claude-flow', 'memory');
  packageAt(memory, '@claude-flow/memory', 'module.exports = {};');
  packageAt(path.join(root, 'node_modules', 'agentdb'), 'agentdb', 'module.exports = {};');
  packageAt(path.join(root, 'node_modules', 'agentdb', 'node_modules', 'better-sqlite3'), 'better-sqlite3', 'throw new Error("decoy CLI AgentDB binding used");');
  const owner = path.join(memory, 'node_modules', 'agentdb');
  if (nativeOwner) {
    fs.mkdirSync(path.dirname(owner), { recursive: true }); fs.symlinkSync(nativeOwner, owner, 'dir');
  } else {
    packageAt(owner, 'agentdb', 'module.exports = {};');
    packageAt(path.join(owner, 'node_modules', 'better-sqlite3'), 'better-sqlite3', ownerCode || FAKE_NATIVE);
  }
  const foreign = path.join(root, 'node_modules', 'better-sqlite3');
  if (foreignBinding) { fs.mkdirSync(path.dirname(foreign), { recursive: true }); fs.symlinkSync(foreignBinding, foreign, 'dir'); }
  else packageAt(foreign, 'better-sqlite3', 'globalThis.foreignLoads = (globalThis.foreignLoads || 0) + 1; module.exports = class Foreign {};');
  for (const [file, source] of [[helperFile, bridgePristine], ['graph-edge-writer.js', graphPristine], ['memory-initializer.js', initPristine]]) {
    const transformed = patch ? patchSqliteOwnerSource(source, file) : { next: source, missing: [] };
    assert.deepEqual(transformed.missing, []);
    write(path.join(mem, file), transformed.next);
  }
  // Native graph writer imports the root resolver; fixture only returns its private root.
  fs.appendFileSync(path.join(mem, 'memory-initializer.js'), `\nexport function getMemoryRoot() { return ${JSON.stringify(root)}; }\n`);
  write(path.join(mem, 'embedding-quantization.js'), 'export function encodeEmbedding(value) { return JSON.stringify(value); }');
  return { root, mem, owner };
}
const FAKE_NATIVE = `module.exports = class Native {
  constructor(file) { this.file = file; this.closed = false; this.pragmas = []; }
  pragma(sql) { this.pragmas.push(sql); }
  exec() {}
  close() { this.closed = true; }
  prepare() { return { run() { return { changes: 1 }; }, get() { return { n: 1 }; } }; }
};`;
try {
  // Exact source preservation, reversibility, idempotence, unknown drift and ambiguity.
  for (const [file, pristine] of [[helperFile, bridgePristine], ['graph-edge-writer.js', graphPristine], ['memory-initializer.js', initPristine]]) {
    const result = patchSqliteOwnerSource(pristine, file);
    assert.deepEqual(result.missing, []);
    assert.equal(reverseSqliteOwnerSource(result.next, file), pristine);
    assert.equal(patchSqliteOwnerSource(result.next, file).next, result.next);
    assert.ok(patchSqliteOwnerSource('unknown source', file).missing.length);
  }
  assert.ok(patchSqliteOwnerSource(bridgePristine + '\n' + BRIDGE_ANCHOR, helperFile).missing.length);
  const good = fixture('nested-owned');
  const bridge = await import(pathToFileURL(path.join(good.mem, helperFile)));
  const native = createRequire(path.join(good.owner, 'index.cjs'))('better-sqlite3');
  assert.equal(bridge.loadAgentDbSqlite(), native, 'exact ControllerRegistry dependency owns the constructor');
  assert.equal(bridge.openAttestation(), native);
  const init = await import(pathToFileURL(path.join(good.mem, 'memory-initializer.js')));
  assert.equal(await init.loader1(), native); assert.equal(await init.loader2(), native);
  const graph = await import(pathToFileURL(path.join(good.mem, 'graph-edge-writer.js')));
  const dbPath = path.join(good.root, 'synthetic.db'); write(dbPath, 'fixture');
  const cachedOwner = new native(dbPath);
  const owned = await graph.getBridgeDb(dbPath);
  assert.ok(owned instanceof native); assert.notEqual(owned, cachedOwner, 'writer owns a separate handle');
  assert.equal(await graph.insertGraphEdge({ sourceId: 'a', targetId: 'b', relation: 'rel', dbPath }), true);
  assert.equal(graph.releaseBridgeDb(dbPath), true); assert.equal(owned.closed, true);
  assert.equal(cachedOwner.closed, false, 'never close a borrowed registry handle');
  assert.ok(owned.pragmas.includes('wal_checkpoint(TRUNCATE)'), 'native lifecycle preserved');
  assert.equal(globalThis.foreignLoads || 0, 0, 'CLI library is never loaded');
  for (const [label, code] of [['missing', 'throw new Error("native binding missing");'], ['bad-constructor', 'module.exports = {};']]) {
    const failed = fixture(label, { ownerCode: code });
    const unavailable = await import(pathToFileURL(path.join(failed.mem, helperFile)));
    assert.throws(() => unavailable.loadAgentDbSqlite());
    const writer = await import(pathToFileURL(path.join(failed.mem, 'graph-edge-writer.js')));
    const file = path.join(failed.root, 'synthetic.db'); write(file, 'fixture');
    assert.equal(await writer.getBridgeDb(file), null, 'missing owned binding cannot use the CLI library');
    const fallback = await import(pathToFileURL(path.join(failed.mem, 'memory-initializer.js')));
    assert.equal(await fallback.loader1(), null); assert.equal(await fallback.loader2(), null);
  }
  // Engine and selective-uninstall coexistence runs after parent registration.
  const cli = fixture('engine');
  const nm = path.join(process.env.RUFLO_NPX_ROOT, 'fixture', 'node_modules', '@claude-flow');
  fs.mkdirSync(nm, { recursive: true }); fs.symlinkSync(cli.root, path.join(nm, 'cli'), 'dir');
  for (const [file, pristine] of [[helperFile, bridgePristine], ['graph-edge-writer.js', graphPristine], ['memory-initializer.js', initPristine]]) write(path.join(cli.mem, file), pristine);
  const { apply, PATCH_TARGETS } = await import('../lib/cwd/patch-library.mjs');
  const { nodeModulesDirs } = await import('../lib/cwd/package-discovery.mjs');
  const { HOME_BASE, NPX_ROOT, GLOBAL_ROOTS } = await import('../lib/cwd/paths.mjs');
  assert.equal(fs.realpathSync(HOME_BASE), fs.realpathSync(scratch), 'mutation home must be the private fixture');
  assert.equal(NPX_ROOT, process.env.RUFLO_NPX_ROOT);
  assert.deepEqual(GLOBAL_ROOTS, [process.env.RUFLO_GLOBAL_ROOT]);
  assert.ok(nodeModulesDirs().every(root => {
    const relative = path.relative(scratch, root);
    return relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  }), 'every mutation inventory root must be inside this private fixture');
  assert.ok(PATCH_TARGETS.includes('ruflo-sqlite-owner'), 'named target is registered');
  const applied = apply(['ruflo-sqlite-owner']);
  assert.equal(applied.patched, 3, JSON.stringify(applied));
  assert.equal(applied.skipped, 0, JSON.stringify(applied));
  assert.equal(apply(['ruflo-sqlite-owner']).patched, 0);
  assert.equal(apply([]).restored, 3);
  assert.equal(fs.readFileSync(path.join(cli.mem, helperFile), 'utf8'), bridgePristine);
  const nativeInit = ['recoverMemoryDatabase', 'repairVectorIndexes'].map(name =>
    `export async function ${name}(dbPath, opts = {}) {\n let Database; try {\n${INITIALIZER_REPLACEMENT}\n } catch {}\n`
      + (name === 'recoverMemoryDatabase' ? '    const ts = Date.now();' : '    let db;') + '\n}\n').join('\n');
  const withoutMarker = source => source.replaceAll(MARKER, 'native SQLite dependency owner');
  const nativeSources = {
    bridge: withoutMarker(patchSqliteOwnerSource(bridgePristine, helperFile).next),
    graph: withoutMarker(patchSqliteOwnerSource(graphPristine, 'graph-edge-writer.js').next),
    initializer: withoutMarker(nativeInit),
  };
  assert.deepEqual(exerciseSqliteOwnerSources(nativeSources), { ok: true });
  assert.equal(exerciseSqliteOwnerSources({ ...nativeSources, graph: graphPristine }).ok, false);
  assert.equal(exerciseSqliteOwnerSources({ ...nativeSources,
    bridge: nativeSources.bridge.replace("createRequire(new URL(memoryOwner)).resolve('agentdb')", "createRequire(import.meta.url).resolve('agentdb')") }).ok, false, 'wrong owner cannot retire');
  assert.equal(exerciseSqliteOwnerSources({ ...nativeSources,
    graph: nativeSources.graph.replace('BetterSqlite3 = loadAgentDbSqlite();', 'BetterSqlite3 = class Fake {};') }).ok, false, 'dead/comment-only owner cannot retire');
  assert.equal(exerciseSqliteOwnerSources({ ...nativeSources, initializer: nativeSources.initializer
    .replace('Database = loadAgentDbSqlite();', 'Database = null;') }).ok, false);
  assert.equal(probeSqliteOwnerReplacement({ roots: [] }).state, 'unknown');
  for (const [kind, file] of [['bridge', helperFile], ['graph', 'graph-edge-writer.js'], ['initializer', 'memory-initializer.js']]) write(path.join(cli.mem, file), nativeSources[kind]);
  assert.equal(probeSqliteOwnerReplacement({ roots: [cli.mem] }).state, 'superseded');
  write(path.join(cli.mem, helperFile), patchSqliteOwnerSource(bridgePristine, helperFile).next);
  assert.equal(probeSqliteOwnerReplacement({ roots: [cli.mem] }).state, 'live', 'local patch cannot prove upstream retirement');

  if (args[1]) {
    const cliPackage = fs.realpathSync(args[1]);
    assert.equal(JSON.parse(fs.readFileSync(cliPackage, 'utf8')).name, '@claude-flow/cli');
    const requireCli = createRequire(cliPackage);
    const memoryEntry = requireCli.resolve('@claude-flow/memory');
    const agentEntry = createRequire(memoryEntry).resolve('agentdb');
    const nativeOwner = path.dirname(createRequire(agentEntry).resolve('agentdb/package.json'));
    const foreignBinding = path.dirname(requireCli.resolve('better-sqlite3/package.json'));
    const owningLibrary = createRequire(agentEntry)('better-sqlite3');
    const otherLibrary = requireCli('better-sqlite3');
    assert.notEqual(owningLibrary, otherLibrary, 'regression requires actual separate libraries');
    const broken = fixture('native-original', { patch: false, nativeOwner, foreignBinding });
    const brokenFile = path.join(broken.root, 'synthetic.db');
    const oldHolder = new owningLibrary(brokenFile);
    oldHolder.pragma('journal_mode = WAL'); oldHolder.exec('CREATE TABLE records (value TEXT)');
    const oldSidecars = ['-wal', '-shm'].map(s => brokenFile + s);
    const oldInodes = oldSidecars.map(p => fs.statSync(p).ino);
    const originalWriter = await import(pathToFileURL(path.join(broken.mem, 'graph-edge-writer.js')));
    try {
      assert.ok(await originalWriter.getBridgeDb(brokenFile) instanceof otherLibrary);
      originalWriter.releaseBridgeDb(brokenFile);
      const after = oldSidecars.map(p => { try { return fs.statSync(p).ino; } catch { return null; } });
      assert.notDeepEqual(after, oldInodes, 'original mixed-library close detaches the holder sidecars');
      console.log(JSON.stringify({ regression: 'original-mixed-library-close', before: oldInodes, after,
        ownerVersion: createRequire(agentEntry)('better-sqlite3/package.json').version,
        foreignVersion: requireCli('better-sqlite3/package.json').version }));
    } finally { originalWriter.releaseBridgeDb(brokenFile); oldHolder.close(); }
    const actual = fixture('native', { nativeOwner, foreignBinding });
    // Only this newly created un-managed synthetic DB is opened by this test.
    const file = path.join(actual.root, 'synthetic.db');
    const holder = new owningLibrary(file);
    holder.pragma('journal_mode = WAL');
    holder.exec('CREATE TABLE records (value TEXT); INSERT INTO records VALUES (\'keep\')');
    const sidecars = ['-wal', '-shm'].map(s => file + s);
    const inode = sidecars.map(p => fs.statSync(p).ino);
    const writer = await import(pathToFileURL(path.join(actual.mem, 'graph-edge-writer.js')));
    try {
      const db = await writer.getBridgeDb(file); assert.ok(db instanceof owningLibrary);
      assert.equal(await writer.insertGraphEdge({ sourceId: 'a', targetId: 'b', relation: 'rel', dbPath: file }), true);
      assert.equal(writer.releaseBridgeDb(file), true);
      assert.deepEqual(sidecars.map(p => fs.statSync(p).ino), inode, 'closing writer preserves live holder sidecar identities');
      assert.equal(holder.prepare('SELECT value FROM records').get().value, 'keep');
      assert.equal(holder.prepare('SELECT COUNT(*) AS n FROM graph_edges').get().n, 1);
      assert.equal(holder.pragma('integrity_check', { simple: true }), 'ok');
      const refresh = await writer.getBridgeDb(file); assert.ok(refresh instanceof owningLibrary);
      writer.releaseBridgeDb(file);
      assert.deepEqual(sidecars.map(p => fs.statSync(p).ino), inode);
      console.log(JSON.stringify({ regression: 'patched-owned-library-close', before: inode,
        after: sidecars.map(p => fs.statSync(p).ino), priorRecord: 'keep', edgeCount: 1, integrity: 'ok' }));
    } finally { writer.releaseBridgeDb(file); holder.close(); }
    // Compose the real installed vendor sources in an isolated package copy.
    // No module in this copy is executed and no database is present.
    const actualSource = path.join(path.dirname(cliPackage), 'dist', 'src', 'memory');
    const saved = {};
    for (const name of [helperFile, 'memory-initializer.js', 'graph-edge-writer.js']) {
      const live = path.join(actualSource, name); const backup = live + '.rsp-backup';
      saved[name] = fs.readFileSync(fs.existsSync(backup) ? backup : live, 'utf8');
      write(path.join(cli.mem, name), saved[name]);
    }
    const { ENTRIES, composeCliContribution } = await import('../lib/cwd/patch-library.mjs');
    const sharedTargets = ['cwd', 'memory', 'ruflo-sqlite-owner'];
    const first = apply(sharedTargets); assert.equal(first.skipped, 0, JSON.stringify(first));
    for (const name of [helperFile, 'memory-initializer.js', 'graph-edge-writer.js']) {
      const entries = ENTRIES.filter(e => sharedTargets.includes(e.target) && e.suffix.at(-1) === name);
      assert.equal(fs.readFileSync(path.join(cli.mem, name), 'utf8'), composeCliContribution(saved[name], entries).next);
    }
    assert.equal(apply(['cwd', 'memory']).skipped, 0);
    for (const name of [helperFile, 'memory-initializer.js', 'graph-edge-writer.js']) {
      const entries = ENTRIES.filter(e => ['cwd', 'memory'].includes(e.target) && e.suffix.at(-1) === name);
      assert.equal(fs.readFileSync(path.join(cli.mem, name), 'utf8'), composeCliContribution(saved[name], entries).next);
    }
    assert.equal(apply(sharedTargets).skipped, 0);
    assert.equal(apply(['ruflo-sqlite-owner']).skipped, 0, 'other target removal retains owned constructor');
    for (const name of [helperFile, 'memory-initializer.js', 'graph-edge-writer.js']) {
      assert.equal(fs.readFileSync(path.join(cli.mem, name), 'utf8'), composeCliContribution(saved[name],
        ENTRIES.filter(e => e.target === 'ruflo-sqlite-owner' && e.suffix.at(-1) === name)).next);
    }
    apply([]);
    console.log('Actual mixed-library fixture: owned writer release preserves canonical holder and WAL/SHM identity.');
  }
  console.log('Ruflo SQLite owner: exact binding, nested owner, fail-closed dependency, native lifetime and restoration passed.');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
