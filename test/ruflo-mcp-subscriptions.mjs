import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-subscriptions-')));
process.env.RUFLO_SOURCE_PATCH_HOME = tmp;
process.env.RUFLO_GLOBAL_ROOT = path.join(tmp, 'global');
process.env.RUFLO_NPX_ROOT = path.join(tmp, 'npx');
process.env.RSP_CODEX_HOME = path.join(tmp, '.codex');
const patch = await import('../lib/ruflo-mcp-subscriptions/patcher.mjs');
const compose = await import('../lib/plugin-compose.mjs');
const source = fs.readFileSync(new URL('./fixtures/mcp-subscriptions/native-3.80.8.js', import.meta.url), 'utf8');
const changed = patch.patchSource(source);
assert.deepEqual(changed.missing, []);
assert(patch.isPatched(changed.next));
assert.equal(patch.reverse(changed.next), source);
assert.equal(patch.patchSource(changed.next).next, changed.next);
const load = text => import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
const before = await load(source), after = await load(changed.next);
const identity = { name: 'fixture', version: '3.80.8' };
const caps = Object.freeze({ tools: Object.freeze({ listChanged: true, fixture: 'retained' }), resources: Object.freeze({}) });
const request = (method, params = {}) => ({ jsonrpc: '2.0', id: 'bounded-regression', method, params });
const modern = { _meta: { [after.META_PROTOCOL_VERSION]: '2026-07-28', [after.META_CLIENT_CAPABILITIES]: {} } };
for (const params of [{}, modern]) {
  const call = request('server/discover', params);
  const old = before.protocolPreflight(call, caps, identity), fixed = after.protocolPreflight(call, caps, identity);
  assert.equal(old.response.result.capabilities.tools.listChanged, true, 'reproduce unsupported advertisement');
  assert.equal(fixed.response.result.capabilities.tools.listChanged, undefined);
  const expected = structuredClone(old); delete expected.response.result.capabilities.tools.listChanged;
  assert.deepEqual(fixed, expected, 'only modern notification advertisement changes');
}
for (const protocolVersion of [...after.LEGACY_PROTOCOL_VERSIONS, '2025-03-26', 'unknown', undefined]) {
  const call = request('initialize', { protocolVersion });
  assert.deepEqual(after.protocolPreflight(call, caps, identity), before.protocolPreflight(call, caps, identity));
  assert.equal(after.protocolPreflight(call, caps, identity).response.result.capabilities, caps);
}
for (const capability of [{}, { resources: {} }, { tools: {} }]) {
  assert.deepEqual(after.protocolPreflight(request('server/discover'), capability, identity),
    before.protocolPreflight(request('server/discover'), capability, identity));
}
for (const call of [request('tools/list', modern), request('tools/call', modern),
  request('subscriptions/listen', modern), request('tools/list', { _meta: { [after.META_PROTOCOL_VERSION]: 'unknown' } }),
  request('tools/list', { _meta: { [after.META_PROTOCOL_VERSION]: '2026-07-28' } })]) {
  assert.deepEqual(after.protocolPreflight(call, caps, identity), before.protocolPreflight(call, caps, identity),
    'no handler, validation, client guard or owner dispatch substitute');
}
for (const modernFlag of [false, true]) {
  const response = { jsonrpc: '2.0', id: 7, result: { tools: [] } }, context = { modern: modernFlag };
  assert.deepEqual(after.finalizeResponse(response, 'tools/list', context, identity),
    before.finalizeResponse(response, 'tools/list', context, identity));
}
assert.equal(caps.tools.listChanged, true, 'legacy shared capability object remains untouched');
for (const mutant of [source + '\n', source + source, source.replace('capabilities,\n', 'capabilities: {},\n'),
  changed.next.replace('delete capabilities.tools.listChanged;', ''), changed.next.replace(patch.MARKER, patch.MARKER + ' changed')]) {
  assert(patch.patchSource(mutant).missing.length);
  assert.equal(patch.patchSource(mutant).next, mutant);
  assert.equal(patch.reverse(mutant), mutant);
}
try {
  const root = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli');
  const file = path.join(root, 'dist/src/mcp-protocol.js');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
  // Caller fixture checks only topology; full installed callers are independently qualified on rollout.
  const caller = "import './mcp-protocol.js';\nconst caps = { tools: { listChanged: true }, resources: {} };\nprotocolPreflight(message, caps);\n";
  for (const name of ['bin/cli.js', 'bin/mcp-server.js', 'dist/src/mcp-server.js']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), caller);
  }
  assert(patch.preflight([file]).ok);
  const applied = compose.applyComposed([patch.NAME]);
  assert.equal(applied.errors, 0); assert.equal(applied.incomplete, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), changed.next);
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), source);
  assert.equal(compose.applyComposed([patch.NAME]).patched, 0);
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  fs.appendFileSync(path.join(root, 'bin/mcp-server.js'), '// subscriptions/listen now implemented upstream');
  assert(!patch.preflight([file]).ok, 'new subscription implementation requires upstream retirement review');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('PASS MCP subscription advertisement: modern correction, unchanged legacy/validation/dispatch, immutable capabilities, exact restoration, drift and caller guards');
