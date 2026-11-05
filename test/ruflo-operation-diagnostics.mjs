// The qualified installed 3.71.4 dispatch body, with exact released150 bindings.
// Only native authorization/storage collaborators are disposable test doubles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createOperationDiagnostics } from '../lib/ruflo-memory-owner/operation-diagnostics.mjs';
import { patchSource, reverse, isPatched } from '../lib/ruflo-memory-owner/patcher.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const historical = JSON.parse(fs.readFileSync(new URL('../lib/ruflo-memory-owner/released-4.46.150.json', import.meta.url)));
assert.equal(sha(historical.dispatch), historical.dispatchSha256);
const previous = historical.runtime + '/**\n * V3 CLI MCP Client\n */\n' + historical.dispatch + '\n';
const native = reverse(previous), candidate = patchSource(previous);
assert.deepEqual(candidate.missing, []); assert(isPatched(candidate.next));
assert.equal(reverse(candidate.next), native); assert.equal(patchSource(candidate.next).next, candidate.next);
assert.equal(patchSource(native).next, candidate.next);
assert(patchSource(previous.replace('batch.flush, 50', 'batch.flush, 51')).missing.length);
assert(patchSource(candidate.next.replace("rspTrace('handler-end')", "rspTrace('foreign')")).missing.length);
const start = candidate.next.indexOf('export async function callMCPTool(');
const body = candidate.next.slice(start, candidate.next.indexOf('\n}\n', start) + 2).replace('export async function', 'return async function');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-operation-diagnostic-'));
const saved = { ...process.env };
try {
  process.env.RUFLO_SOURCE_PATCH_HOME = temp;
  delete process.env.RSP_OPERATION_DIAGNOSTICS; delete process.env.RSP_POLICY_DIAGNOSTICS;
  const diagnostics = await createOperationDiagnostics(), dir = path.join(temp, '.ruflo-source-patch/mcp-operation-diagnostics');
  const rows = () => fs.existsSync(dir) ? fs.readdirSync(dir).map(f => JSON.parse(fs.readFileSync(path.join(dir, f)))) : [];
  const clear = () => { if (fs.existsSync(dir)) for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file)); };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  class MCPClientError extends Error { constructor(message, tool, cause) { super(message, { cause }); this.tool = tool; } }
  let authorizations = 0, handlers = 0, serializations = 0, evaluatorCalls = 0;
  let allowed = true, forwarded = false, failure, defaultEvaluator = false, guardFailure;
  const result = { content: 'PRIVATE_RESULT' }, input = { secret: 'PRIVATE_INPUT', toJSON() { serializations++; return { secret: this.secret }; } };
  const root = path.join(temp, 'project'); fs.mkdirSync(root);
  const evaluate = (request, selected) => {
    evaluatorCalls++; assert.equal(selected, root); assert.equal(request.context.metadata.inputDigest, 'sha256:' + sha('{"secret":"PRIVATE_INPUT"}'));
    return { enforcedOutcome: allowed ? 'allowed' : 'denied', reason: 'fixture', receiptId: 'native-decision' };
  };
  const authorize = async (_name, value, _context, _attributes, evaluator) => {
    authorizations++; const request = { context: { metadata: { inputDigest: 'sha256:' + sha(JSON.stringify(value)) } } };
    return (evaluator ?? evaluate)(request, root);
  };
  const owner = { policyContext: c => c, tryForward: async () => ({ forwarded, result }),
    policyEvaluator: () => defaultEvaluator ? undefined : evaluate, configured: () => false };
  const registry = new Map([['memory_list', { handler: async () => { handlers++; if (failure) throw failure; return result; } }]]);
  const call = new Function('TOOL_REGISTRY', 'MCPClientError', 'authorizeMcpTool', 'classifyMcpTool',
    'rspMemoryOwner', 'applyContentBoundaryGuardrail', 'rspOperationDiagnostics', body)(registry, MCPClientError, authorize,
    () => ({}), owner, (_tool, value) => { if (guardFailure) throw guardFailure; return value; }, diagnostics);
  assert.equal(await call('memory_list', input, { projectRoot: root }), result); await tick();
  assert.equal(serializations, 1, 'diagnostics must not serialize input a second time');
  assert.equal(authorizations, 1); assert.equal(evaluatorCalls, 1); assert.equal(handlers, 1);
  let row = rows()[0];
  assert.equal(row.project, sha(root).slice(0, 16)); assert.equal(row.projectSource, 'native-policy');
  assert.equal(row.inputDigest, 'sha256:' + sha('{"secret":"PRIVATE_INPUT"}'));
  assert.equal(row.digestSource, 'native-policy-request');
  assert.deepEqual(row.phases.filter(x => x.phase !== 'lag-sample').map(x => x.phase),
    ['entered', 'forward-start', 'forward-end', 'policy-request', 'authorized', 'handler-start', 'handler-end', 'return']);
  assert.equal(row.metricScope, 'process-interval-including-overlapping-calls');
  assert(row.phases.every(x => x.elapsedMs >= 0 && x.cpuUserMicros >= 0 && x.cpuSystemMicros >= 0));
  assert(!JSON.stringify(row).includes('PRIVATE_INPUT')); assert(!JSON.stringify(row).includes('PRIVATE_RESULT'));
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  for (const file of fs.readdirSync(dir)) assert.equal(fs.statSync(path.join(dir, file)).mode & 0o777, 0o600);
  clear(); allowed = false;
  await assert.rejects(call('memory_list', input, {}), error => error instanceof MCPClientError && /policy-denied/.test(error.message));
  await tick(); assert.equal(handlers, 1); assert(rows()[0].phases.some(x => x.phase === 'error'));
  clear(); allowed = true; failure = Object.assign(Error('PRIVATE_ERROR'), { code: 'EIO' });
  await assert.rejects(call('memory_list', input, {}), error => error.cause === failure);
  await tick(); row = rows()[0]; assert.equal(row.phases.find(x => x.phase === 'error').errorCode, 'EIO');
  assert(!JSON.stringify(row).includes('PRIVATE_ERROR'));
  clear(); failure = undefined; guardFailure = Error('guardrail failure');
  await assert.rejects(call('memory_list', input, {}), error => error.cause === guardFailure);
  await tick(); assert(rows()[0].phases.some(x => x.phase === 'handler-end')); guardFailure = undefined;
  clear(); forwarded = true; const before = authorizations;
  assert.equal(await call('memory_list', input, {}), result); await tick();
  assert.equal(authorizations, before); assert.equal(rows()[0].inputDigest, null);
  clear(); forwarded = false; defaultEvaluator = true;
  assert.equal(await call('memory_list', input, {}), result); await tick();
  assert.equal(rows()[0].digestSource, 'unavailable'); defaultEvaluator = false;
  clear(); await assert.rejects(call('absent', input, {}), /MCP tool not found/); await tick();
  assert.deepEqual(rows()[0].phases.filter(x => x.phase !== 'lag-sample').map(x => x.phase), ['entered', 'error']);
  clear(); const trace = diagnostics('memory_list', { projectRoot: root });
  const until = performance.now() + 25; while (performance.now() < until) {}
  for (let i = 0; i < 1000; i++) trace('handler-start'); await tick();
  row = rows()[0]; assert.equal(row.phases.filter(x => x.phase === 'handler-start').length, 1);
  assert(row.phases.find(x => x.phase === 'lag-sample').immediateDelayMs >= 20);
  assert(row.phases.at(-1).cpuUserMicros + row.phases.at(-1).cpuSystemMicros > 0);
  // Existing unsafe slots cannot redirect writes or truncate another file.
  const selected = path.join(dir, fs.readdirSync(dir)[0]), outside = path.join(temp, 'private-other');
  fs.writeFileSync(outside, 'UNCHANGED', { mode: 0o600 }); fs.unlinkSync(selected); fs.symlinkSync(outside, selected);
  trace('handler-end'); assert.equal(fs.readFileSync(outside, 'utf8'), 'UNCHANGED');
  fs.unlinkSync(selected); fs.linkSync(outside, selected); trace('return');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'UNCHANGED'); clear();
  for (let i = 0; i < 200; i++) diagnostics('memory_list', {})('return'); await tick();
  assert(fs.readdirSync(dir).length <= 128); assert(rows().every(x => Buffer.byteLength(JSON.stringify(x)) <= 8192 && x.phases.length <= 10));
  clear(); fs.rmdirSync(dir); fs.symlinkSync(path.dirname(outside), dir);
  assert.equal(await call('memory_list', input, {}), result); await tick(); assert.equal(fs.readFileSync(outside, 'utf8'), 'UNCHANGED');
  fs.unlinkSync(dir); process.env.RSP_OPERATION_DIAGNOSTICS = 'off';
  assert.equal(await call('memory_list', input, {}), result); await tick(); assert(!fs.existsSync(dir));
  delete process.env.RSP_OPERATION_DIAGNOSTICS;
  // Native initialize installs current session synchronously before its Promise
  // settles; diagnostics must retain that ordering and exact result/error identity.
  let release, initialized = false;
  const waiting = new Promise(resolve => { release = resolve; });
  const server = { handleInitialize(request) {
    assert.equal(this, server); assert.equal(request.params.clientInfo.name, 'PRIVATE_CLIENT');
    initialized = true; return waiting.then(() => result);
  } };
  diagnostics.initialize(server);
  const initialization = server.handleInitialize({ params: { clientInfo: { name: 'PRIVATE_CLIENT' } } });
  assert(initialized, 'initialize executes in the original synchronous turn');
  await tick(); row = rows()[0]; assert.equal(row.tool, 'initialize');
  assert.equal(row.clientDigest, sha('PRIVATE_CLIENT')); assert(!JSON.stringify(row).includes('PRIVATE_CLIENT'));
  assert(!row.phases.some(x => x.phase === 'return')); release(); assert.equal(await initialization, result);
  assert(rows()[0].phases.some(x => x.phase === 'return')); clear();
  const thrown = Error('PRIVATE_INITIALIZE_ERROR'), broken = { handleInitialize() { throw thrown; } };
  diagnostics.initialize(broken); assert.throws(() => broken.handleInitialize({}), error => error === thrown);
  await tick(); assert(!JSON.stringify(rows()).includes('PRIVATE_INITIALIZE_ERROR'));
  if (process.env.RSP_OWNER_NATIVE_ROOT) {
    clear();
    const require = createRequire(path.join(process.env.RSP_OWNER_NATIVE_ROOT, 'package.json'));
    const { MCPServer } = await import(pathToFileURL(require.resolve('@claude-flow/mcp')));
    const nativeServer = new MCPServer({ transport: 'http' }, { debug() {}, info() {}, warn() {}, error() {} });
    diagnostics.initialize(nativeServer);
    try {
      const request = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'private-native-test', version: '1' } } };
      const pending = nativeServer.handleInitialize(request);
      assert.equal(nativeServer.getSessions().length, 1, 'actual native initializer still allocates before first await');
      const response = await pending; assert.equal(response.id, 1); assert(response.result);
      await tick(); row = rows()[0]; assert.equal(row.tool, 'initialize');
      assert.equal(row.clientDigest, sha('private-native-test')); assert(row.phases.some(x => x.phase === 'return'));
    } finally {
      for (const session of nativeServer.getSessions()) nativeServer.terminateSession(session.id);
      // No transport was started; native stop() is a no-op in that state.
      nativeServer.sessionManager.destroy(); nativeServer.taskManager.destroy(); nativeServer.rateLimiter.destroy();
    }
  }
  console.log('native dispatch timing: exact150 migration/reversal, unchanged results/authorization/errors, native digest reuse, bounded private slots, unsafe sinks and per-call scheduling/CPU observations pass');
} finally {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved); fs.rmSync(temp, { recursive: true, force: true });
}
