import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalEdits } from '../lib/ruflo-memory-owner/canonical.mjs';
import { createMemoryOwnerClient } from '../lib/ruflo-memory-owner/runtime.mjs';
import { ENTRIES, composeCliContribution } from '../lib/cwd/patch-library.mjs';
import { patchSource, reverse, isPatched } from '../lib/ruflo-memory-owner/patcher.mjs';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-owner-test-'));
const before = { config: process.env.RUFLO_MEMORY_OWNER_CONFIG, pin: process.env.CLAUDE_FLOW_DB_PATH, home: process.env.HOME };
const tokenFile = path.join(temporary, 'token');
const configFile = path.join(temporary, 'owners.json');
const store = path.join(temporary, 'source.db');
const cwd = process.cwd();
fs.writeFileSync(tokenFile, 'disposable-owner-test-token', { mode: 0o600 });
fs.writeFileSync(path.join(temporary, 'mcp-server.js'),
  `export function resolveMcpHttpAuthToken({tokenFile}) { return 'disposable-owner-test-token'; }`);
fs.writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}');
const config = () => ({ version: 1,
  owners: { source: { url: 'http://127.0.0.1:19872/mcp', tokenFile, cwd, pin: store } },
  contexts: [{ cwd, pin: store, owner: 'source' }], stores: [{ dbPath: store, owner: 'source' }] });
const write = value => fs.writeFileSync(configFile, JSON.stringify(value), { mode: 0o600 });
try {
  delete process.env.RUFLO_MEMORY_OWNER_CONFIG;
  process.env.HOME = temporary;
  const api = await createMemoryOwnerClient(pathToFileURL(path.join(temporary, 'mcp-client.js')).href);
  assert.equal(api.configured(), false);
  process.env.RUFLO_MEMORY_OWNER_CONFIG = configFile;
  process.env.CLAUDE_FLOW_DB_PATH = store;
  write(config());
  assert.deepEqual(await api.identity(), { protocol: 1, cwd, pin: store });
  assert.equal((await api.binding()).pin, store);
  assert.equal((await api.binding(store)).pin, store);
  await assert.rejects(api.binding(path.join(temporary, 'different.db')), /missing or ambiguous/);
  const wrong = config(); wrong.stores.push({ dbPath: path.join(temporary, 'different.db'), owner: 'source' });
  write(wrong); await assert.rejects(api.binding(wrong.stores[1].dbPath), /conflicts/);
  const duplicate = config(); duplicate.stores.push(duplicate.stores[0]);
  write(duplicate); await assert.rejects(api.binding(store), /ambiguous/);
  const otherRole = config(); otherRole.contexts[0].pin = path.join(temporary, 'learning.db');
  write(otherRole); await assert.rejects(api.binding(), /missing or ambiguous/);
  for (const url of ['https://example.com/mcp', 'http://localhost:19872/mcp',
    'http://user:secret@127.0.0.1:19872/mcp', 'file:///tmp/owner', 'http://127.0.0.1:19872/mcp?token=x']) {
    const invalid = config(); invalid.owners.source.url = url; write(invalid);
    await assert.rejects(api.binding(store), /authenticated literal loopback/);
  }
  write(config()); fs.chmodSync(configFile, 0o666);
  await assert.rejects(api.binding(store), /Unsafe/);
  fs.chmodSync(configFile, 0o600); fs.chmodSync(tokenFile, 0o644);
  await assert.rejects(api.binding(store), /private/);
  fs.chmodSync(tokenFile, 0o600);
  const timeout = config(); timeout.owners.source.requestTimeoutMs = -1; write(timeout);
  await assert.rejects(api.binding(store), /timeout/);
  timeout.owners.source.requestTimeoutMs = 180_000; write(timeout);
  assert.equal((await api.binding(store)).requestTimeoutMs, 180_000);
  const aborted = new AbortController(); aborted.abort(new Error('caller cancelled'));
  await assert.rejects(api.call('memory_store', { dbPath: store }, { signal: aborted.signal }), /caller cancelled/);
  await assert.rejects(api.call('memory_store', { dbPath: path.join(temporary, 'wrong.db') },
    { transport: 'stdio' }), /configured MCP client authority/);
  await assert.rejects(api.enterServerMode(path.join(temporary, 'other-project')), /HTTP server context/);
  await api.enterServerMode(cwd);
  assert.equal(api.configured(), false, 'server role changes only this runtime instance');
  const child = await createMemoryOwnerClient(pathToFileURL(path.join(temporary, 'mcp-client.js')).href);
  assert.equal(child.configured(), true, 'fresh client still inherits the explicit binding');
  const defaultFile = path.join(temporary, '.config', 'ruflo', 'memory-owners.json');
  fs.mkdirSync(path.dirname(defaultFile), { recursive: true });
  fs.copyFileSync(configFile, defaultFile); fs.chmodSync(defaultFile, 0o600);
  delete process.env.RUFLO_MEMORY_OWNER_CONFIG;
  assert.equal(child.configured(), true, 'explicit default file reaches unchanged parent-launched CLI callers');
  assert.equal((await child.binding(store)).pin, store);
  await api.close();
  const canonicalHelper = canonicalEdits[0][1].replace('export const memoryTools = [', 'return rspCanonicalMemoryOptions;');
  const canonicalOptions = new Function(canonicalHelper)();
  const original = { nativeResult: true, key: 'immutable', value: 'raw', encryptWrites: false,
    appendOnly: true, requireNative: true, appendConditions: [{ key: 'prior' }],
    includeContent: true, includeEmbedding: true, includeExpired: true, limit: 0,
    provenance_type: 'user', provenanceFilter: ['user'] };
  const mapped = canonicalOptions(original, store);
  const expected = { ...original, dbPath: store, provenanceType: 'user' };
  delete expected.nativeResult; delete expected.provenance_type;
  assert.deepEqual(mapped, expected);
  assert.equal(Object.hasOwn(mapped, 'upsert'), false, 'do not inject presentation defaults');
  const native = process.env.RSP_OWNER_NATIVE_SRC;
  if (native) for (const file of ['mcp-client.js', 'mcp-server.js', 'mcp-tools/memory-tools.js', 'mcp-tools/agentdb-tools.js',
    'memory/memory-initializer.js', 'commands/memory.js']) {
    const source = fs.readFileSync(path.join(native, file), 'utf8');
    const result = patchSource(source);
    assert.deepEqual(result.missing, [], file);
    assert.equal(reverse(result.next), source, file + ' exact restoration');
    assert.equal(isPatched(result.next), true, file + ' idempotency');
    if (file === 'memory/memory-initializer.js') {
      const core = composeCliContribution(source, ENTRIES.filter(entry =>
        ['cwd', 'memory'].includes(entry.target) && entry.suffix.slice(-2).join('/') === file));
      assert.deepEqual(core.missing, []);
      const composed = patchSource(core.next);
      assert.deepEqual(composed.missing, []);
      assert.equal(reverse(composed.next), core.next, 'restore preserves the existing core guards');
      assert.equal(isPatched(composed.next), true);
      assert.ok(composed.next.lastIndexOf("storeEntry = forward(storeEntry") >
        composed.next.lastIndexOf('storeEntry = __rufloGuard(storeEntry)'), 'forward before local locking');
    }
    const doubled = source + source;
    assert.equal(patchSource(doubled).next, doubled);
    assert.ok(patchSource(doubled).missing.length, file + ' duplicate source must refuse');
  }
} finally {
  if (before.config === undefined) delete process.env.RUFLO_MEMORY_OWNER_CONFIG;
  else process.env.RUFLO_MEMORY_OWNER_CONFIG = before.config;
  if (before.pin === undefined) delete process.env.CLAUDE_FLOW_DB_PATH;
  else process.env.CLAUDE_FLOW_DB_PATH = before.pin;
  if (before.home === undefined) delete process.env.HOME;
  else process.env.HOME = before.home;
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('native owner configuration authority regression passed');
