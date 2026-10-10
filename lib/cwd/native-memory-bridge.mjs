// #3143: accept upstream identity only after executing the installed bytes with
// fake registries. No managed store, native driver, network, or updater is used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const proven = new Map();
export function nativeMemoryBridgeSatisfied(source) {
  if (typeof source !== 'string'
    || !source.includes('const bridgeFailureReasons = new Map();')
    || !source.includes('export function __setMemoryBridgeRegistryFactoryForTests(factory)')) return false;
  const key = crypto.createHash('sha256').update(source).digest('hex');
  if (proven.has(key)) return proven.get(key);
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-bridge-proof-')));
  try {
    fs.writeFileSync(path.join(scratch, 'bridge.mjs'), source);
    fs.writeFileSync(path.join(scratch, 'package.json'), '{"type":"module"}');
    // Unrelated pure helpers may be imported but must never be called here.
    for (const [file, name] of [['live-memory-row.js', 'liveMemoryRowSql'], ['feedback-patterns.js', 'validateFeedbackPatterns']]) {
      fs.writeFileSync(path.join(scratch, file), `export function ${name}() { throw new Error('unrelated helper called'); }`);
    }
    // Ruflo 3.54.x split the native bridge dependencies into shared modules.
    // The retirement proof must load those imports without executing them.
    fs.writeFileSync(path.join(scratch, 'embedding-q8.js'),
      'export const MAX_LIST_EMBEDDINGS = 100000; export function encodeEmbeddingQ8() { return null; }');
    fs.writeFileSync(path.join(scratch, 'shared-sqlite.js'),
      'export function resolveAgentdbBetterSqlite3() { return null; }');
    fs.writeFileSync(path.join(scratch, 'append-conditions.js'),
      'export class AppendConditionFailed extends Error {} export function assertAppendConditions() { throw new Error("unrelated append called"); } export function validateAppendConditions() { throw new Error("unrelated append called"); }');
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const root = process.argv[1];
const bridge = await import(pathToFileURL(path.join(root, 'bridge.mjs')));
let instances = [];
let fail = true;
let releaseRead;
let activeRead = false;
class Registry {
  async initialize(options) {
    this.options = options; this.shutdowns = 0;
    await new Promise(resolve => setTimeout(resolve, 2));
    if (fail && options.dbPath.endsWith('fail.db')) throw new Error('isolated failure');
    instances.push(this);
  }
  get() { return null; }
  async listControllers() {
    activeRead = true;
    await new Promise(resolve => { releaseRead = resolve; });
    assert.equal(this.shutdowns, 0, 'retiring handle closed during active operation');
    return ['drained'];
  }
  async shutdown() { this.shutdowns++; }
}
bridge.__setMemoryBridgeRegistryFactoryForTests(() => new Registry());
const a = path.join(root, 'a.db'), b = path.join(root, 'b.db'), f = path.join(root, 'fail.db');
fs.writeFileSync(a, 'fixture'); fs.writeFileSync(b, 'fixture');
const alias = path.join(root, 'alias.db'); fs.symlinkSync(a, alias);
fs.mkdirSync(path.join(root, 'parent')); fs.symlinkSync(path.join(root, 'parent'), path.join(root, 'parent-alias'));
const [ar, aa, ax] = await Promise.all([a, a, alias].map(p => bridge.getControllerRegistry(p)));
assert.equal(ar, aa); assert.equal(ar, ax); assert.equal(instances.length, 1);
const br = await bridge.getControllerRegistry(b); assert.notEqual(ar, br);
assert.equal(ar.options.dbPath, fs.realpathSync(a)); assert.equal(br.options.dbPath, b);
const [future, futureAlias] = await Promise.all(['parent', 'parent-alias'].map(p => bridge.getControllerRegistry(path.join(root, p, 'future.db'))));
assert.equal(future, futureAlias);
assert.equal((await bridge.getControllerRegistry(':memory:')).options.dbPath, ':memory:');
assert.equal(await bridge.getControllerRegistry(f), null);
assert.equal(await bridge.isBridgeAvailable(f), false);
assert.equal(bridge.getBridgeFailureReason(f), 'isolated failure');
assert.equal(bridge.getBridgeFailureReason(b), null); assert.equal(await bridge.isBridgeAvailable(b), true);
// The native API owns one global retirement barrier. An in-flight registry must
// finish opening before shutdown, and a call after shutdown begins must resume
// into the next lifecycle, never borrow a retiring handle.
const read = bridge.bridgeListControllers(a);
while (!activeRead) await Promise.resolve();
const pending = bridge.getControllerRegistry(path.join(root, 'pending.db'));
const stop = bridge.shutdownBridge(); const stopAgain = bridge.shutdownBridge();
assert.equal(stop, stopAgain);
const after = bridge.getControllerRegistry(b);
const pendingRegistry = await pending;
assert.equal(ar.shutdowns, 0, 'retirement must drain the leased read');
releaseRead(); assert.deepEqual(await read, ['drained']); await stop;
assert.equal(pendingRegistry.shutdowns, 1); assert.equal(ar.shutdowns, 1); assert.equal(br.shutdowns, 1);
const restartedB = await after; assert.notEqual(restartedB, br);
assert.equal(restartedB.shutdowns, 0); assert.equal(instances.filter(r => r.options.dbPath === b).length, 2);
fail = false; assert.ok(await bridge.getControllerRegistry(f));
assert.equal(bridge.getBridgeFailureReason(f), null);
const restartedA = await bridge.getControllerRegistry(a); assert.notEqual(restartedA, restartedB);
await bridge.shutdownBridge(); assert.equal(restartedA.shutdowns, 1); assert.equal(restartedB.shutdowns, 1);
console.log('native path identity, aliases, isolation, failure recovery, drain and global shutdown proven');
`, scratch], {
      cwd: scratch,
      env: { PATH: process.env.PATH, HOME: scratch, CLAUDE_FLOW_DB_PATH: path.join(scratch, 'unused.db') },
      encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024,
    });
    const valid = result.status === 0 && result.stdout.includes('native path identity, aliases, isolation, failure recovery, drain and global shutdown proven');
    proven.set(key, valid);
    return valid;
  } catch { proven.set(key, false); return false; }
  finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
