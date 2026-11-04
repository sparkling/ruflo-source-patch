import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-controller-inventory-')));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
const patch = await import('../lib/ruflo-controller-inventory/patcher.mjs');
const { BRIDGE_RUNTIME } = await import('../lib/ruflo-controller-inventory/runtime.mjs');
let checks = 0;
try {
  const pristine = `import * as crypto from 'node:crypto';
let registry, active=false, leases=0;
export function configure(value){registry=value;}
export function leaseCount(){return leases;}
const operationContext = {getStore:()=>({active})};
async function withBridgeOperation(fn){leases++;active=true;try{return await fn();}finally{active=false;}}
async function getRegistry(){if(!active)throw Error('missing lease');return registry;}
export async function getControllerRegistry(){return getRegistry();}
function canonicalDbPath(dbPath){return dbPath??'/fixture/native.db';}
function describeHierarchicalStore(hm,fallback){return {controller:'tieredMemoryStore',durable:hm.isDurable(),persistence:hm.getPersistence(),fallbackFrom:fallback.reason};}
function getHierarchicalFallback(reg){return reg.getHierarchicalFallback();}
async function guardValidate(){return {allowed:true};}
async function logAttestation(){}
export async function bridgeStorePattern(options) {return options;}
// ===== Phase 3: CausalMemoryGraph =====
// ===== Phase 4: Health check with attestation =====
`;
  const toolsPristine = `async function getBridge(){return globalThis.fixtureInventoryBridge;}
export const agentdbHealth={},agentdbPatternStore={},agentdbPatternSearch={};
// ===== Export all tools =====
export const agentdbTools = [
    agentdbHealth,
    agentdbPatternStore,
    agentdbPatternSearch,
];
`;
  const fixed = patch.patchSource(pristine), toolsFixed = patch.patchSource(toolsPristine);
  for (const [original, changed] of [[pristine, fixed], [toolsPristine, toolsFixed]]) {
    assert.deepEqual(changed.missing, []); assert(patch.isPatched(changed.next));
    assert.equal(patch.patchSource(changed.next).next, changed.next); assert.equal(patch.reverse(changed.next), original); checks++;
  }
  for (const source of [pristine + pristine, toolsPristine + toolsPristine,
    pristine.replace('async function withBridgeOperation(', 'async function missingLease('),
    pristine.replace('Health check with attestation', 'upstream drift'),
    fixed.next.replace('native-inventory-unsupported', 'false success'),
    toolsPristine + '\nconst agentdbSkillList = {};']) {
    assert.equal(patch.patchSource(source).next, source); assert(patch.patchSource(source).missing.length); checks++;
  }
  const withdrawal = await import('../lib/ruflo-pattern-withdrawal/patcher.mjs');
  for (const original of [pristine, toolsPristine]) {
    const both = patch.patchSource(withdrawal.patchSource(original).next).next;
    assert(patch.isPatched(both)); assert(withdrawal.isPatched(both));
    assert.equal(withdrawal.reverse(patch.reverse(both)), original); checks++;
  }
  const bridgeFile = path.join(scratch, 'bridge.mjs'); fs.writeFileSync(bridgeFile, fixed.next);
  const mod = await import(pathToFileURL(bridgeFile)); globalThis.fixtureInventoryBridge = mod;
  const toolsFile = path.join(scratch, 'tools.mjs'); fs.writeFileSync(toolsFile, toolsFixed.next);
  const { agentdbTools } = await import(pathToFileURL(toolsFile));
  const tools = new Map(agentdbTools.filter(t => t.name).map(t => [t.name, t]));
  assert.equal(tools.size, 4);
  const call = (name, args) => tools.get('agentdb_' + name).handler(args);
  const invoked = [], rows = [{ id: 30, taskType: 'research', approach: 'method', metadata: { status: 'retained' } }, { id: 20 }, { id: 10 }];
  const rb = { listPatterns: query => { invoked.push(query); const limit = query.limit ?? 50, offset = query.offset ?? 0; return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset }; } };
  const skills = { listSkills: rb.listPatterns, getSkill: id => rows.find(row => row.id === id) ?? null };
  const tiers = { getTierStats: () => ({ working: 2, episodic: 3, semantic: 4, superseded: 5 }), countPersisted: () => 14, isDurable: () => true, getPersistence: () => 'sqlite' };
  const reg = { dbPath: '/fixture/native.db', get: name => ({ reasoningBank: rb, skills, hierarchicalMemory: tiers })[name], getHierarchicalFallback: () => ({ reason: 'native-export-unavailable' }) };
  mod.configure(reg);
  const first = await call('pattern-list', { limit: 2, offset: 0, taskType: 'research' });
  const second = await call('pattern-list', { limit: 2, offset: 2 });
  assert.deepEqual(first.page.items, rows.slice(0, 2)); assert.equal(first.page.total, 3); assert.deepEqual(second.page.items, [rows[2]]);
  assert.deepEqual(invoked[0], { limit: 2, offset: 0, taskType: 'research' }); assert.equal(first.dbPath, reg.dbPath); checks++;
  const beyond = await call('pattern-list', { offset: 3 }); assert.deepEqual(beyond.page.items, []); assert.equal(beyond.page.total, 3); checks++;
  const skillPage = await call('skill-list', { minSuccessRate: 0.5, limit: 1 }); assert.equal(skillPage.page.total, 3); assert.deepEqual(invoked.at(-1), { minSuccessRate: 0.5, limit: 1 }); checks++;
  assert.equal((await call('skill-get', { skillId: 30 })).skill, rows[0]);
  assert.deepEqual((await call('skill-get', { skillId: 99 })).skill, null); assert.equal((await call('skill-get', { skillId: 99 })).found, false); checks++;
  const count = await call('hierarchical-stats', {}); assert.equal(count.coverage, 'count-only'); assert.equal(count.persistedRows, 14); assert.equal(count.tierStats.semantic, 4); assert.equal(count.controller, 'tieredMemoryStore'); assert.equal(count.fallbackFrom, 'native-export-unavailable'); assert.equal(count.durable, true); checks++;
  tiers.isDurable = () => false; tiers.getPersistence = () => 'volatile'; tiers.countPersisted = () => null;
  const volatile = await call('hierarchical-stats', {}); assert.equal(volatile.persistedRows, null); assert.equal(volatile.durable, false); checks++;
  for (const [name, args] of [['pattern-list', { dbPath: '/foreign.db' }], ['pattern-list', { limit: 0 }], ['pattern-list', { offset: -1 }], ['pattern-list', { limit: 501 }], ['pattern-list', { taskType: 5 }], ['skill-list', { minSuccessRate: NaN }], ['skill-get', {}], ['skill-get', { skillId: -1 }], ['hierarchical-stats', { topK: 10 }], ['pattern-list', null], ['pattern-list', []]]) {
    const before = mod.leaseCount(); const denied = await call(name, args); assert.equal(denied.success, false); assert.equal(typeof denied.error, 'string'); assert.equal(mod.leaseCount(), before); checks++;
  }
  reg.dbPath = '/fixture/sibling.db'; assert.equal((await call('pattern-list', {})).reason, 'native-registry-identity-mismatch'); checks++;
  // An explicit internal binding must match the actual registry; public tools never accept it.
  assert.equal((await mod.bridgeControllerInventory('patterns', { dbPath: reg.dbPath })).success, true); checks++; reg.dbPath = '/fixture/native.db';
  mod.configure(null); assert.equal((await call('pattern-list', {})).success, false); checks++;
  mod.configure({ dbPath: reg.dbPath, get: () => null }); assert.equal((await call('skill-list', {})).reason, 'native-inventory-unsupported'); checks++;
  mod.configure(reg); skills.getSkill = () => undefined; assert.equal((await call('skill-get', { skillId: 30 })).reason, 'invalid-native-skill'); checks++;
  skills.listSkills = () => { throw Error('native backend is not SQL-addressable'); };
  const refusal = await call('skill-list', {}); assert.equal(refusal.success, false); assert.match(refusal.error, /not SQL-addressable/); checks++;
  rb.listPatterns = () => undefined; assert.equal((await call('pattern-list', {})).reason, 'invalid-native-inventory'); checks++;
  assert.equal((await mod.bridgeControllerInventory('constructor', {})).success, false); checks++;
  for (const tool of tools.values()) { assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.inputSchema.additionalProperties, false); assert.equal('dbPath' in tool.inputSchema.properties, false); } checks++;
  const root = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src');
  for (const [name, body] of [['memory/memory-bridge.js', pristine], ['mcp-tools/agentdb-tools.js', toolsPristine]]) { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, body); }
  assert.equal(patch.preflight().ok, true);
  const compose = await import('../lib/plugin-compose.mjs');
  const installed = compose.applyComposed([withdrawal.NAME, patch.NAME]); assert.equal(installed.errors, 0, JSON.stringify(installed)); assert.equal(installed.incomplete, 0); assert.equal(installed.patched, 2);
  assert.equal(compose.applyComposed([withdrawal.NAME, patch.NAME]).patched, 0);
  assert.equal(compose.reconcile([], [patch.NAME, withdrawal.NAME]).errors, 0); assert.equal(fs.readFileSync(path.join(root, 'memory/memory-bridge.js'), 'utf8'), pristine); checks++;
  fs.writeFileSync(path.join(root, 'mcp-tools/agentdb-tools.js'), toolsPristine.replace('async function getBridge(', 'async function missingBridge('));
  const blocked = compose.applyComposed([patch.NAME]); assert.equal(blocked.patched, 0); assert(blocked.incomplete > 0); assert.equal(fs.readFileSync(path.join(root, 'memory/memory-bridge.js'), 'utf8'), pristine); checks++;
  assert(!BRIDGE_RUNTIME.includes('.prepare(')); assert(!BRIDGE_RUNTIME.includes('new AgentDB')); checks++;
  console.log('controller-inventory: ' + checks + ' meaningful checks passed; no database or owner opened');
} finally { delete globalThis.fixtureInventoryBridge; fs.rmSync(scratch, { recursive: true, force: true }); }
