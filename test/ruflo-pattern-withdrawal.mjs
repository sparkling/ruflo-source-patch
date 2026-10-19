import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-pattern-withdrawal-')));
process.env.RUFLO_SOURCE_PATCH_HOME=scratch;
process.env.RUFLO_GLOBAL_ROOT=path.join(scratch,'global');
process.env.RUFLO_NPX_ROOT=path.join(scratch,'npx');
process.env.CLAUDE_FLOW_DB_PATH='/fixture/canonical.db';
const patch=await import('../lib/ruflo-pattern-withdrawal/patcher.mjs');
const { HISTORICAL_BRIDGES }=await import('../lib/ruflo-pattern-withdrawal/historical.mjs');
const { BRIDGE_RUNTIME, TOOL_RUNTIME }=await import('../lib/ruflo-pattern-withdrawal/runtime.mjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
let checks=0;
try {
 const prefix=`import * as crypto from 'node:crypto';
let active=false, leases=0, guardAllowed=true, registry, registryCalls=0, implicitPath='/fixture/canonical.db';
export function configure(value, allowed=true){registry=value;guardAllowed=allowed;}
export function leaseCount(){return leases;}
export function scopeProbe(path){implicitPath=path;registryCalls=0;}
export function calls(){return registryCalls;}
const operationContext = {getStore:()=>({active})};
async function withBridgeOperation(fn){leases++;active=true;try{return await fn();}finally{active=false;}}
async function getRegistry(dbPath){registryCalls++;if(registry instanceof Error)throw registry;return registry;}
function canonicalDbPath(dbPath){return dbPath??implicitPath;}
async function guardValidate(reg,operation,params){if(!active)throw Error('missing lease');return {allowed:guardAllowed};}
async function logAttestation(reg,operation,id,metadata){if(!active)throw Error('missing lease');reg.audit?.push({operation,id,metadata});}
export async function bridgeStorePattern(options) {return options;}
`;
 const pristine=prefix+'// ===== Phase 3: CausalMemoryGraph =====\n';
 const fixed=patch.patchSource(pristine);
 assert.deepEqual(fixed.missing,[]);assert.equal(patch.isPatched(fixed.next),true);
 assert.equal(patch.reverse(fixed.next),pristine);assert.equal(patch.patchSource(fixed.next).next,fixed.next);checks++;
 for(const source of [pristine+pristine,fixed.next+fixed.next,pristine.replace('CausalMemoryGraph','drift'),pristine.replace('async function withBridgeOperation(', 'async function missingLease('),fixed.next.replace('approachSha256 !== options.expectedApproachSha256','false')]){
  assert.equal(patch.patchSource(source).next,source);assert.ok(patch.patchSource(source).missing.length);checks++;
 }
 const file=path.join(scratch,'bridge.mjs');fs.writeFileSync(file,fixed.next);
 const mod=await import(pathToFileURL(file));
 const kept={id:501,approach:'A real tested method',successRate:0.8,uses:2,avgReward:0,tags:['method'],metadata:{scope:'local'},createdAt:7,embedding:new Float32Array([1,2])};
 const junk={...kept,id:17,approach:'[turn 2026-10-18T00:00:00Z] fixture junk',tags:['raw-turn']};
 const rows=new Map([[17,junk],[501,kept]]),deleted=[];
 const rb={getPattern:id=>rows.get(id)??null,deletePattern:id=>{deleted.push(id);return rows.delete(id);}};
 const reg={dbPath:'/fixture/canonical.db',audit:[],get:name=>name==='reasoningBank'?rb:null};mod.configure(reg);
 mod.scopeProbe('/fixture/sibling.db');assert.equal((await mod.bridgeGetReasoningPattern({patternId:'17'})).reason,'native-registry-identity-mismatch');assert.equal(mod.calls(),1);checks++;
 // A distinct native AgentDB owner is valid even while CLI/sql.js env names another store.
 reg.dbPath='/fixture/sibling.db';assert.equal((await mod.bridgeGetReasoningPattern({patternId:'17'})).found,true);checks++;
 reg.dbPath='/fixture/canonical.db';mod.scopeProbe('/fixture/canonical.db');
 const found=await mod.bridgeGetReasoningPattern({patternId:'17',dbPath:'/fixture/canonical.db'});
 assert.equal(found.found,true);assert.equal(found.registryIdentity.explicitAndImplicitSameInstance,true);assert.equal(found.dbPath,'/fixture/canonical.db');assert.equal(found.approachSha256,hash(junk.approach));assert.equal(found.pattern.approach,junk.approach);assert.equal(found.pattern.successRate,0.8);assert.equal('embedding'in found.pattern,false);checks++;
 for(const patternId of ['0','-1','01','1.0','1e2','9007199254740992',17,null]){
  assert.equal((await mod.bridgeGetReasoningPattern({patternId})).success,false);checks++;
 }
 const input={patternId:'17',expectedApproachSha256:hash(junk.approach),reason:'Owner-authorised fixture withdrawal'};
 assert.equal((await mod.bridgeDeleteReasoningPattern({...input,expectedApproachSha256:'0'.repeat(64)})).reason,'pattern-hash-mismatch');assert.deepEqual(deleted,[]);checks++;
 rb.vectorBackend={};assert.equal((await mod.bridgeDeleteReasoningPattern(input)).reason,'native-vector-delete-unqualified');assert.deepEqual(deleted,[]);delete rb.vectorBackend;checks++;
 mod.configure(reg,false);assert.equal((await mod.bridgeDeleteReasoningPattern(input)).reason,'mutation-guard-refused');assert.deepEqual(deleted,[]);checks++;mod.configure(reg);
 reg.dbPath='/fixture/sibling.db';assert.equal((await mod.bridgeDeleteReasoningPattern(input)).reason,'native-registry-identity-mismatch');assert.deepEqual(deleted,[]);reg.dbPath='/fixture/canonical.db';checks++;
 const result=await mod.bridgeDeleteReasoningPattern(input);assert.equal(result.success,true);assert.equal(result.verifiedAbsent,true);assert.deepEqual(deleted,[17]);assert.equal(rows.get(501),kept);assert.equal(reg.audit.length,1);assert.equal(reg.audit[0].metadata.approachSha256,input.expectedApproachSha256);assert.equal('approach'in reg.audit[0].metadata,false);checks++;
 assert.equal((await mod.bridgeGetReasoningPattern({patternId:'17'})).found,false);
 assert.equal((await mod.bridgeDeleteReasoningPattern(input)).alreadyAbsent,true);assert.deepEqual(deleted,[17]);checks++;
 for(const reason of ['',null,'x'.repeat(501)])assert.equal((await mod.bridgeDeleteReasoningPattern({...input,reason})).success,false);checks++;
 mod.configure({dbPath:'/fixture/canonical.db',get:()=>null});assert.equal((await mod.bridgeGetReasoningPattern({patternId:'17'})).reason,'native-pattern-get-unsupported');assert.equal((await mod.bridgeDeleteReasoningPattern(input)).reason,'native-pattern-delete-unsupported');checks++;
 mod.configure({dbPath:'/fixture/canonical.db',get:()=>({getPattern:()=>junk,deletePattern:()=>false})});assert.equal((await mod.bridgeDeleteReasoningPattern(input)).reason,'native-pattern-deletion-unconfirmed');checks++;
 mod.configure({dbPath:'/fixture/canonical.db',get:()=>({getPattern:()=>junk,deletePattern:()=>true})});assert.equal((await mod.bridgeDeleteReasoningPattern(input)).reason,'native-pattern-deletion-unconfirmed');checks++;
 mod.configure({dbPath:'/fixture/canonical.db',get:()=>({getPattern:()=>{throw Error('native refusal');},deletePattern:()=>true})});assert.equal((await mod.bridgeDeleteReasoningPattern(input)).reason,'native-pattern-delete-failed');checks++;
 assert.ok(mod.leaseCount()>20);
 const toolsPristine="async function getBridge(){return globalThis.fixtureBridge;}\nexport const agentdbPatternStore={};\nexport const agentdbPatternSearch={};\n// ===== Export all tools =====\nexport const agentdbTools=[\n    agentdbPatternStore,\n    agentdbPatternSearch,\n];\n";
 const toolsFixed=patch.patchSource(toolsPristine);assert.deepEqual(toolsFixed.missing,[]);assert.equal(patch.reverse(toolsFixed.next),toolsPristine);assert.equal(patch.patchSource(toolsFixed.next).next,toolsFixed.next);checks++;
 const toolsFile=path.join(scratch,'tools.mjs');fs.writeFileSync(toolsFile,toolsFixed.next);globalThis.fixtureBridge=mod;mod.configure(reg);
 const tools=await import(pathToFileURL(toolsFile));assert.equal(tools.agentdbTools.length,4);assert.equal(tools.agentdbPatternGet.annotations.readOnlyHint,true);assert.equal(tools.agentdbPatternDelete.annotations.destructiveHint,true);assert.equal(tools.agentdbPatternDelete.inputSchema.required.includes('expectedApproachSha256'),true);assert.equal((await tools.agentdbPatternGet.handler({patternId:'501'})).pattern.approach,kept.approach);checks++;
 const root=path.join(process.env.RUFLO_GLOBAL_ROOT,'@claude-flow/cli/dist/src');for(const [name,body] of [['memory/memory-bridge.js',pristine],['mcp-tools/agentdb-tools.js',toolsPristine]]){const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,body);}
 assert.equal(patch.preflight().ok,true);const compose=await import('../lib/plugin-compose.mjs');
 const installed=compose.applyComposed([patch.NAME]);assert.equal(installed.errors,0,JSON.stringify(installed));assert.equal(installed.incomplete,0);assert.equal(installed.patched,2);assert.equal(compose.applyComposed([patch.NAME]).patched,0);assert.equal(compose.reconcile([],[patch.NAME]).errors,0);assert.equal(fs.readFileSync(path.join(root,'memory/memory-bridge.js'),'utf8'),pristine);checks++;
 for(const historical of HISTORICAL_BRIDGES){
  const old=pristine.replace('// ===== Phase 3: CausalMemoryGraph =====',()=>historical+'// ===== Phase 3: CausalMemoryGraph =====');
  assert.deepEqual(patch.patchSource(old).missing,[]);assert.equal(patch.patchSource(old).next,fixed.next);
  assert.equal(patch.historicalPatchSource(pristine,old).next,old);
  fs.writeFileSync(path.join(root,'memory/memory-bridge.js'),old);fs.writeFileSync(path.join(root,'memory/memory-bridge.js.rsp-backup'),pristine);
  fs.writeFileSync(path.join(root,'mcp-tools/agentdb-tools.js'),toolsFixed.next);fs.writeFileSync(path.join(root,'mcp-tools/agentdb-tools.js.rsp-backup'),toolsPristine);
  const upgrade=compose.applyComposed([patch.NAME]);assert.equal(upgrade.errors,0,JSON.stringify(upgrade));assert.equal(upgrade.incomplete,0);assert.equal(fs.readFileSync(path.join(root,'memory/memory-bridge.js'),'utf8'),fixed.next);assert.equal(fs.readFileSync(path.join(root,'memory/memory-bridge.js.rsp-backup'),'utf8'),pristine);assert.equal(compose.applyComposed([patch.NAME]).patched,0);checks++;
 }
 assert.equal(BRIDGE_RUNTIME.includes('.prepare('),false);assert.equal(BRIDGE_RUNTIME.includes('getDb('),false);assert.equal(TOOL_RUNTIME.includes('pattern-delete'),true);checks++;
 console.log('pattern-withdrawal: '+checks+' meaningful checks passed; no database/driver or real native owner opened');
} finally {delete globalThis.fixtureBridge;fs.rmSync(scratch,{recursive:true,force:true});}
