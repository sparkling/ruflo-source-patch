// Explicit opt-in native acceptance proof. Only disposable stores under tmpdir.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const cli = fs.realpathSync(process.argv[2]);
assert(cli.startsWith(fs.realpathSync(os.tmpdir()) + path.sep), 'use a disposable pristine package copy');
const file = path.join(cli, 'dist/src/memory/memory-bridge.js');
const source = fs.readFileSync(file, 'utf8');
assert(!source.includes('ruflo-source-patch'), 'native proof must use pristine bridge bytes');
const version = JSON.parse(fs.readFileSync(path.join(cli, 'package.json'))).version;
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-identity-')));
const originalCwd = process.cwd();
process.chdir(scratch);
process.env.CLAUDE_FLOW_MEMORY_PATH = path.join(scratch, '.swarm');
delete process.env.CLAUDE_FLOW_DB_PATH;
process.env.RUFLO_DAEMON_AUTOSTART = '0';
const bridge = await import(pathToFileURL(file));
const paths = ['project.db', 'user.db'].map(name => path.join(scratch, name));
const namespace = 'identity-proof', key = 'same-key';
const content = row => row?.entry?.content;
let checks = 0;
try {
  const registries = await Promise.all(paths.map(dbPath => bridge.getControllerRegistry(dbPath)));
  registries.forEach((registry, index) => assert.equal(registry?.dbPath, paths[index]));
  assert.notEqual(registries[0], registries[1]); checks++;
  const alias = path.join(scratch, 'alias.db'); fs.symlinkSync(paths[0], alias);
  const [again, viaAlias] = await Promise.all([paths[0], alias].map(p => bridge.getControllerRegistry(p)));
  assert.equal(again, registries[0]); assert.equal(viaAlias, registries[0]); checks++;
  for (let index = 0; index < paths.length; index++) {
    const result = await bridge.bridgeStoreEntry({ dbPath: paths[index], namespace, key,
      value: 'unique-store-' + index, generateEmbeddingFlag: false, requireNative: true, upsert: true });
    assert.equal(result?.success, true, JSON.stringify(result)); checks++;
  }
  for (const order of [[0, 1], [1, 0]]) for (const index of order) {
    const entry = await bridge.bridgeGetEntry({ dbPath: paths[index], namespace, key });
    assert.equal(content(entry), 'unique-store-' + index);
    const list = await bridge.bridgeListEntries({ dbPath: paths[index], namespace, limit: 100, includeContent: true });
    assert.equal(list?.entries.length, 1); assert.equal(list.entries[0].content, 'unique-store-' + index); checks++;
    const search = await bridge.bridgeSearchEntries({ dbPath: paths[index], namespace,
      query: 'unique-store-' + index, threshold: 0, limit: 10 });
    assert.equal(search?.success, true); assert.equal(search.results.length, 1);
    assert.equal(search.results[0].content, 'unique-store-' + index); checks++;
  }
  // A distinct process must see the committed values while this one is still alive.
  execFileSync(process.execPath, ['--input-type=module', '--eval', `
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const bridge=await import(pathToFileURL(process.argv[1]));
try {
  for (const [index,dbPath] of process.argv.slice(2).entries()) {
    const row=await bridge.bridgeGetEntry({dbPath,namespace:'identity-proof',key:'same-key'});
    assert.equal(row?.entry?.content,'unique-store-'+index);
  }
} finally {await bridge.shutdownBridge();}
`, file, ...paths], { cwd: scratch, timeout: 30000, maxBuffer: 1024 * 1024, stdio: 'pipe' }); checks++;
  if (process.argv[3] === '--native-backup') {
    const { backupMemoryDb } = await import(pathToFileURL(path.join(cli, 'dist/src/services/memory-backup.js')));
    const receipt = await backupMemoryDb({ dbPath: paths[0], destDir: path.join(scratch, 'snapshots'), nativeOnly: true });
    assert.equal(receipt.backedUp, true, JSON.stringify(receipt));
    assert.equal(receipt.method, 'sqlite-online-backup');
    assert.equal(content(await bridge.bridgeGetEntry({ dbPath: receipt.path, namespace, key })), 'unique-store-0'); checks++;
  }
  const badParent = path.join(scratch, 'not-a-directory'); fs.writeFileSync(badParent, 'fixture');
  assert.equal(await bridge.getControllerRegistry(path.join(badParent, 'fail.db')), null);
  assert.equal(content(await bridge.bridgeGetEntry({ dbPath: paths[1], namespace, key })), 'unique-store-1'); checks++;
  await bridge.shutdownBridge();
  for (const index of [1, 0]) {
    assert.equal(content(await bridge.bridgeGetEntry({ dbPath: paths[index], namespace, key })), 'unique-store-' + index); checks++;
  }
  assert.equal((await bridge.bridgeDeleteEntry({ dbPath: paths[0], namespace, key }))?.success, true);
  assert.equal((await bridge.bridgeGetEntry({ dbPath: paths[0], namespace, key }))?.found, false);
  assert.equal(content(await bridge.bridgeGetEntry({ dbPath: paths[1], namespace, key })), 'unique-store-1'); checks++;
  assert.equal((await bridge.bridgePurgeNamespace({ dbPath: paths[1], namespace }))?.success, true);
  assert.equal((await bridge.bridgeGetEntry({ dbPath: paths[1], namespace, key }))?.found, false); checks++;
  console.log(JSON.stringify({ verified: true, version, checks,
    bridgeSha256: createHash('sha256').update(source).digest('hex'),
    scope: 'native store/get/list/search/delete/purge, path isolation, aliases, failure isolation, fresh-process visibility and restart; vector quality and all controller export are not covered' }));
} finally {
  await bridge.shutdownBridge(); process.chdir(originalCwd);
  fs.rmSync(scratch, { recursive: true, force: true });
}
