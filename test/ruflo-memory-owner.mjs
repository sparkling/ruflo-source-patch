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
  const live = new Map(); let sequence = 0, current;
  const server = { getSessions: () => [...live.values()],
    terminateSession(id) { live.delete(id); if (current?.id === id) current = undefined; },
    async handleInitialize(request) {
      if (!request.params) return { error: 'invalid params' };
      current = { id: String(++sequence), clientInfo: request.params.clientInfo }; live.set(current.id, current);
      return { result: { initialized: true } };
    } };
  api.attachServer(server);
  const a = 'ruflo-native-owner-client:00000000-0000-4000-8000-000000000001';
  const b = 'ruflo-native-owner-client:00000000-0000-4000-8000-000000000002';
  await server.handleInitialize({ params: { clientInfo: { name: a } } });
  await server.handleInitialize({ params: { clientInfo: { name: b } } });
  assert.deepEqual(api.releaseSession(b), { scheduled: 1 });
  assert.equal(live.size, 2, 'release does not clear the current initialized session');
  await server.handleInitialize({}); assert.equal(live.size, 2, 'invalid init must not drain');
  for (let i = 0; i < 120; i++) {
    const next = server.handleInitialize({ params: { clientInfo: { name: b } } });
    assert(current && current.clientInfo.name === b, 'handover is synchronous before yielding');
    await next; assert.equal(live.size, 2); api.releaseSession(b);
  }
  assert([...live.values()].some(row => row.clientInfo.name === a), 'unrelated persistent client survives');
  assert.throws(() => api.releaseSession('foreign-session'), /Invalid/);

  const child = await createMemoryOwnerClient(pathToFileURL(path.join(temporary, 'mcp-client.js')).href);
  assert.equal(child.configured(), true, 'fresh client still inherits the explicit binding');
  const defaultFile = path.join(temporary, '.config', 'ruflo', 'memory-owners.json');
  fs.mkdirSync(path.dirname(defaultFile), { recursive: true });
  fs.copyFileSync(configFile, defaultFile); fs.chmodSync(defaultFile, 0o600);
  delete process.env.RUFLO_MEMORY_OWNER_CONFIG;
  assert.equal(child.configured(), true, 'explicit default file reaches unchanged parent-launched CLI callers');
  assert.equal((await child.binding(store)).pin, store);
  await api.close();
  // Exercise the serialized production client at its SDK boundary. Two callers
  // must not dispatch through a connection retired by an earlier handshake waiter.
  const sdkFile = path.join(temporary, 'sdk.mjs');
  fs.writeFileSync(sdkFile, `
export const state = { calls: [], mode: 'ok' };
export class StreamableHTTPClientTransport {}
export class Client {
  async connect() { if (state.block) await new Promise(resolve => { state.resume = resolve; }); }
  async listTools() { return { tools: ['memory_owner_identity','memory_owner_release','memory_store'].map(name => ({name,inputSchema:{properties:{}}})) }; }
  async callTool({name}) {
    state.calls.push(name);
    if (name === 'memory_owner_identity') return {structuredContent:state.identity};
    if (name === 'memory_store' && state.mode === 'unknown') throw new Error('response lost');
    if (name === 'memory_owner_release' && state.mode === 'cleanup-fails') throw new Error('cleanup unavailable');
    return {structuredContent:{success:true}};
  }
  async close() {}
}`);
  const sdkUrl = pathToFileURL(sdkFile).href;
  const factoryFile = path.join(temporary, 'factory.mjs');
  fs.writeFileSync(factoryFile, 'export ' + createMemoryOwnerClient.toString()
    .replace("'@modelcontextprotocol/sdk/client/index.js'", JSON.stringify(sdkUrl))
    .replace("'@modelcontextprotocol/sdk/client/streamableHttp.js'", JSON.stringify(sdkUrl)));
  const { createMemoryOwnerClient: isolatedFactory } = await import(pathToFileURL(factoryFile));
  const { state } = await import(sdkUrl);
  state.identity = {protocol:1,cwd,pin:store};
  state.block = true;
  const pooled = await isolatedFactory(pathToFileURL(path.join(temporary, 'mcp-client.js')).href);
  const first = pooled.call('missing_operation', {}, {sessionId:'shared'});
  const second = pooled.call('memory_store', {}, {sessionId:'shared'});
  const outcomes = Promise.allSettled([first, second]);
  while (!state.resume) await new Promise(resolve => setImmediate(resolve));
  state.resume();
  const settled = await outcomes;
  assert.equal(settled[0].status, 'rejected');
  assert.match(settled[0].reason.message, /does not advertise/);
  assert.equal(settled[1].status, 'rejected');
  assert.match(settled[1].reason.message, /closing/);
  assert.equal(state.calls.filter(name => name === 'memory_store').length, 0,
    'no queued write dispatch after connection retirement');
  assert.equal(state.calls.filter(name => name === 'memory_owner_release').length, 1);
  await pooled.close();
  await assert.rejects(pooled.call('memory_store'), /shutting down/);
  state.block = false; state.calls = []; state.mode = 'unknown';
  const uncertain = await isolatedFactory(pathToFileURL(path.join(temporary, 'mcp-client.js')).href);
  await assert.rejects(uncertain.call('memory_store'), /response lost/);
  await uncertain.close();
  assert.equal(state.calls.filter(name => name === 'memory_store').length, 1, 'unknown write is never replayed');
  assert.equal(state.calls.includes('memory_owner_release'), false, 'unknown execution keeps native session');
  state.calls = []; state.mode = 'cleanup-fails';
  const acknowledged = await isolatedFactory(pathToFileURL(path.join(temporary, 'mcp-client.js')).href);
  const diagnostic = console.error; const warnings = []; console.error = value => warnings.push(value);
  try { assert.deepEqual(await acknowledged.call('memory_store'), {success:true}); }
  finally { console.error = diagnostic; }
  assert.equal(warnings.length, 1, 'cleanup failure is diagnostic, not a retryable write failure');
  await acknowledged.close();
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
