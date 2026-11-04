import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { patchSource, NATIVE_SHA256 } from '../lib/ruflo-auto-memory-persistence/candidate.mjs';

// Two verbatim halves keep each fixture below the repository's 500-line limit.
const native = ['a', 'b'].map(part => fs.readFileSync(new URL(`./ruflo-auto-memory-persistence/native-${part}.txt`, import.meta.url), 'utf8')).join('');
assert.equal(crypto.createHash('sha256').update(native).digest('hex'), NATIVE_SHA256);
const result = patchSource(native);
assert.deepEqual(result.missing, []);
const candidate = result.next;
assert(patchSource(native + '\n').missing.length, 'unknown upstream bytes refuse transformation');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-auto-memory-'));
const record = { id: 'one', namespace: 'auto-memory', key: 'auto-memory:test.md:Heading', content: 'Complete original content\nSecond line', metadata: { sourceFile: 'test.md' } };
function backend(source, overrides = {}) {
  const lock = source.slice(source.indexOf('const LOCK_WAIT_MS'), source.indexOf('// Claude Code shares'));
  const cls = source.slice(source.indexOf('class JsonFileBackend'), source.indexOf('// Resolve memory package path'));
  return vm.runInNewContext(lock + cls + '\nJsonFileBackend', { ...fs, ...overrides, process, Atomics, SharedArrayBuffer, Int32Array });
}
function run(file, args, project, env = {}) {
  return spawnSync(process.execPath, [file, ...args], { env: { ...process.env, HOME: root, CLAUDE_PROJECT_DIR: project, ...env }, encoding: 'utf8', timeout: 8000 });
}
try {
  const db = path.join(root, 'disposable.json');
  const failRename = () => { throw Object.assign(Error('synthetic rename EIO'), { code: 'EIO' }); };
  const Old = backend(native, { renameSync: failRename });
  const old = new Old(db); await old.initialize(); await old.store(record);
  assert.equal(fs.existsSync(db), false, 'original silently accepts failed persistence');
  assert.equal((await old.get('one')).content, record.content);
  const Fixed = backend(candidate, { renameSync: failRename });
  const fixed = new Fixed(db); await fixed.initialize();
  await assert.rejects(fixed.store(record), /synthetic rename EIO/);
  fs.writeFileSync(db, '{broken');
  const OldNormal = backend(native); const corrupt = new OldNormal(db);
  await corrupt.initialize(); await corrupt.shutdown();
  assert.equal(fs.readFileSync(db, 'utf8'), '[]', 'original erases malformed store');
  fs.writeFileSync(db, '{broken');
  const NewNormal = backend(candidate); const strict = new NewNormal(db);
  await assert.rejects(strict.initialize(), { name: 'SyntaxError' });
  assert.equal(fs.readFileSync(db, 'utf8'), '{broken');
  assert.throws(() => new NewNormal(path.join(root, 'never-created.json')).verifyPersisted(), /readback missing/);
  for (const body of ['{}', '[null]', '[{"id":"same"},{"id":"same"}]']) {
    fs.writeFileSync(db, body);
    await assert.rejects(new NewNormal(db).initialize());
    assert.equal(fs.readFileSync(db, 'utf8'), body);
  }
  fs.writeFileSync(db, '[]');
  const mutate = new NewNormal(db); await mutate.initialize();
  fs.writeFileSync(db, '{later corruption');
  await assert.rejects(mutate.store(record));
  assert.equal(fs.readFileSync(db, 'utf8'), '{later corruption', 'merge read corruption remains intact');
  fs.writeFileSync(db, '[]');
  const changed = backend(candidate, { renameSync: (from, to) => { fs.renameSync(from, to); fs.writeFileSync(to, '[]'); } });
  const changedStore = new changed(db); await changedStore.initialize();
  await assert.rejects(changedStore.store(record), /readback mismatch/);
  const denied = backend(candidate, { readFileSync: () => { throw Object.assign(Error('EACCES'), { code: 'EACCES' }); } });
  await assert.rejects(new denied(db).initialize(), /EACCES/);

  const project = path.join(root, 'project');
  const helpers = path.join(project, '.claude/helpers'); fs.mkdirSync(helpers, { recursive: true });
  const helper = path.join(helpers, 'auto-memory-hook.mjs'); fs.writeFileSync(helper, candidate);
  const data = path.join(project, '.claude-flow/data');
  const exact = run(helper, ['read', record.namespace, record.key], project);
  assert.equal(exact.status, 0, exact.stderr);
  assert.deepEqual(JSON.parse(exact.stdout), { schemaVersion: 1, store: path.join(data, 'auto-memory-store.json'), storePresent: false, namespace: record.namespace, key: record.key, found: false, entry: null });
  assert(!fs.existsSync(data), 'read must not initialize any data directory');
  fs.mkdirSync(data, { recursive: true });
  const store = path.join(data, 'auto-memory-store.json'); fs.writeFileSync(store, JSON.stringify([record]));
  const before = fs.statSync(store), bytes = fs.readFileSync(store);
  const found = run(helper, ['read', record.namespace, record.key], project);
  assert.equal(found.status, 0, found.stderr);
  assert.deepEqual(JSON.parse(found.stdout).entry, record);
  assert(fs.readFileSync(store).equals(bytes));
  assert.equal(fs.statSync(store).mtimeMs, before.mtimeMs);
  assert(!fs.existsSync(store + '.lock'));
  assert.equal(run(helper, ['read', record.namespace], project).status, 1);
  fs.writeFileSync(store, JSON.stringify([record, { ...record, id: 'two' }]));
  assert.equal(run(helper, ['read', record.namespace, record.key], project).status, 1, 'ambiguous key refuses first-row guess');
  fs.writeFileSync(store, '{corrupt');
  assert.equal(run(helper, ['read', record.namespace, record.key], project).status, 1);
  assert.equal(fs.readFileSync(store, 'utf8'), '{corrupt');

  // Isolated bridge seam drives the full native helper command/backend. It is
  // deliberately not a claim about every native Markdown parser behaviour.
  const pkg = path.join(project, 'fake-memory.mjs');
  fs.writeFileSync(pkg, `import { EventEmitter } from 'node:events';
export class AutoMemoryBridge extends EventEmitter {
  constructor(backend) { super(); this.backend = backend; }
  async importFromAutoMemory() {
    await this.backend.bulkInsert([${JSON.stringify(record)}]);
    if (process.env.TEST_SOURCE_FAILURE) this.emit('import:file-error', {});
    return { imported: 1, skipped: 0 };
  }
  destroy() {}
}`);
  fs.writeFileSync(path.join(project, '.claude-flow/memory-package.json'), JSON.stringify({ distPath: pkg }));
  fs.writeFileSync(store, '{corrupt');
  const corruptImport = run(helper, ['import'], project);
  assert.equal(corruptImport.status, 1); assert(!corruptImport.stdout.includes('✓ Imported'));
  assert.equal(fs.readFileSync(store, 'utf8'), '{corrupt');
  fs.unlinkSync(store);
  const shim = path.join(root, 'rename-failure.cjs');
  fs.writeFileSync(shim, "require('fs').renameSync = () => { throw Error('synthetic rename EIO'); }; require('module').syncBuiltinESMExports();");
  const failedWrite = spawnSync(process.execPath, ['--require', shim, helper, 'import'], {
    env: { ...process.env, HOME: root, CLAUDE_PROJECT_DIR: project }, encoding: 'utf8', timeout: 8000,
  });
  assert.equal(failedWrite.status, 1); assert(!failedWrite.stdout.includes('✓ Imported'));
  assert(!fs.existsSync(store));
  const goodImport = run(helper, ['import'], project);
  assert.equal(goodImport.status, 0, goodImport.stderr); assert(goodImport.stdout.includes('✓ Imported 1 entries'));
  assert.deepEqual(JSON.parse(run(helper, ['read', record.namespace, record.key], project).stdout).entry, record);
  const partial = run(helper, ['import'], project, { TEST_SOURCE_FAILURE: '1' });
  assert.equal(partial.status, 1); assert(!partial.stdout.includes('✓ Imported'));
  console.log('AutoMemory: reproduced original false persistence/corruption; strict native backend, read-only exact accessor, verified import and honest failure PASS');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
