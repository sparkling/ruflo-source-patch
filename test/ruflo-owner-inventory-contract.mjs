import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createOwnerInventoryContract } from '../lib/ruflo-memory-owner/inventory-contract.mjs';
import { TOOL_RUNTIME } from '../lib/ruflo-controller-inventory/runtime.mjs';
import { patchSource, reverse } from '../lib/ruflo-memory-owner/patcher.mjs';

// Real published and compatibility metadata, with inert handlers: no managed DB.
const nativeSource = fs.readFileSync(new URL('./fixtures/ruflo-controller-inventory/native-3.75.0/hierarchical-tools.js', import.meta.url), 'utf8');
const newer = await import('data:text/javascript,' + encodeURIComponent(nativeSource));
const older = await import('data:text/javascript,' + encodeURIComponent(TOOL_RUNTIME));
const old = older.agentdbHierarchicalList, fresh = newer.agentdbHierarchicalList;
assert.equal(old.inputSchema.properties.state.default, 'all');
assert.equal(fresh.inputSchema.properties.status.default, 'active');
const owner = { cwd: '/project', pin: null, url: new URL('http://127.0.0.1:1234/mcp'), token: 'fixture' };
let remote, retired = 0, connected = 0, enabled = true, eligible = true, here = { cwd: '/project', pin: null };
const make = () => createOwnerInventoryContract({ configured: () => enabled, eligible: () => eligible,
  identity: async () => here, binding: async () => owner,
  connect: async (bound, ephemeral, policy) => {
    assert.equal(bound, owner); assert.equal(ephemeral, true); assert.equal(policy, true);
    connected++; return { tools: remote };
  }, retire: async () => { retired++; } });
for (const [local, executing] of [[fresh, old], [old, fresh],
  [newer.agentdbHierarchicalGet, older.agentdbHierarchicalGet],
  [older.agentdbHierarchicalGet, newer.agentdbHierarchicalGet]]) {
  remote = [executing]; const api = make(), unrelated = { name: 'memory_search' };
  const before = JSON.stringify(local), projected = await api.project([local, unrelated]);
  assert.deepEqual(projected[0].inputSchema, executing.inputSchema);
  assert.equal(projected[0].description, executing.description);
  assert.equal(projected[0].handler, local.handler, 'native dispatch handler remains intact');
  assert.equal(projected[1], unrelated); assert.equal(JSON.stringify(local), before);
  assert.notEqual(projected[0].inputSchema, executing.inputSchema, 'no mutable shared schema');
  api.verify(local.name, remote, owner);
  api.verify('memory_store', [], owner, 'unrelated operations unchanged');
  const changed = [{ ...executing, inputSchema: { type: 'object', properties: {} } }];
  assert.throws(() => api.verify(local.name, changed, owner), /contract changed/);
  assert.throws(() => api.verify(local.name, remote, { ...owner, pin: '/other' }), /contract changed/);
  remote = changed; await assert.rejects(api.project([local]), /contract changed/);
}
remote = []; const absent = make();
assert.deepEqual(await absent.project([fresh]), []);
assert.deepEqual(await absent.project([fresh]), []);
assert.throws(() => absent.verify(fresh.name, [], owner), /does not advertise/);
remote = [old, old]; await assert.rejects(make().project([fresh]), /Invalid native/);
remote = [old]; here = { cwd: '/different', pin: null };
const count = connected; await assert.rejects(make().project([fresh]), /authority/);
assert.equal(connected, count); here = { cwd: '/project', pin: null };
for (const flag of ['enabled', 'eligible']) {
  if (flag === 'enabled') enabled = false; else eligible = false;
  const tools = [fresh]; assert.equal(await make().project(tools), tools);
  enabled = eligible = true;
}
assert.equal(connected, retired, 'every discovery connection retired, including failed projection');

// The previous installed client rendition is recognized and reverses exactly.
const release = name => JSON.parse(fs.readFileSync(new URL('../lib/ruflo-memory-owner/released-' + name + '.json', import.meta.url), 'utf8'));
const r150 = release('4.46.150'), base = reverse(r150.runtime + '/**\n * V3 CLI MCP Client\n */\n' + r150.dispatch + '\n');
const current = patchSource(base); assert.deepEqual(current.missing, []);
const prior = release('4.46.191').runtime + current.next.slice(current.next.indexOf('/**\n * V3 CLI MCP Client'));
assert.equal(reverse(prior), base); assert.equal(patchSource(prior).next, current.next);
for (const expression of ['_filterAdvertisedMcpTools(listMCPTools())',
  'mcpProtocol.sortToolsDeterministically(_filterAdvertisedMcpTools(listMCPTools()))']) {
  const source = 'const isExplicitMCP = true;\nconst tools = ' + expression + ';\n';
  const result = patchSource(source); assert.deepEqual(result.missing, []);
  assert(result.next.includes('projectInventoryTools(' + expression + ')'));
  assert.equal(reverse(result.next), source);
  assert.equal(patchSource(result.next).next, result.next);
  assert(patchSource(source + source).missing.length, 'ambiguous entrypoint refused');
}
console.log('PASS owner inventory contract: both version directions, defaults, missing methods, authority/schema drift and retirement');
