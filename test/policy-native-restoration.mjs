// Opt-in native policy-format conversion: synthetic history and isolated trust only.
import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{pathToFileURL}from'node:url';
import{patchSource}from'../lib/ruflo-policy-ledger/patcher.mjs';import{patchSource as serialization}from'../lib/ruflo-policy-serialization/patcher.mjs';
import{nativePolicyRuntimeSatisfied,nativePolicyEngineSatisfied}from'../lib/policy-native-proof.mjs';
import{createRequire}from'node:module';
import{restoreNativePolicy}from'../scripts/policy-native-restoration.mjs';
const nativeRoot=fs.realpathSync(process.argv[2]);
const runtimeFile=path.join(nativeRoot,'dist/src/services/policy-runtime.js');const runtimeSource=fs.readFileSync(runtimeFile,'utf8');const engineEntry=createRequire(runtimeFile).resolve('@claude-flow/security');const engineSource=fs.readFileSync(path.join(path.dirname(engineEntry),'policy/engine.js'),'utf8');
assert(nativePolicyRuntimeSatisfied(runtimeSource));assert(nativePolicyEngineSatisfied(engineSource));assert(!nativePolicyRuntimeSatisfied(runtimeSource+'\n'));assert(!nativePolicyEngineSatisfied(engineSource.replace('receipt-chain-mismatch','accepted')));
for(const module of ['ruflo-policy-serialization','ruflo-policy-ledger']){const patcher=await import('../lib/'+module+'/patcher.mjs');assert(patcher.isPatched(runtimeSource));assert.equal(patcher.patchSource(runtimeSource).next,runtimeSource);assert.equal(patcher.reverseSource(runtimeSource),runtimeSource);}
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'rsp-policy-format-'));process.env.HOME=scratch;process.env.XDG_CONFIG_HOME=path.join(scratch,'.config');
const legacyRoot=path.join(scratch,'legacy-cli'),dir=path.join(legacyRoot,'dist/src/services');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(legacyRoot,'package.json'),JSON.stringify({name:'@claude-flow/cli',version:'3.56.3',type:'module'}));
const base=new URL('./fixtures/ruflo-policy-ledger/',import.meta.url).pathname;const files=JSON.parse(fs.readFileSync(base+'3.56.3.json')).files;const f=new Proxy(files,{get:(v,k)=>v[k]??fs.readFileSync(base+k,'utf8')});
fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');for(const name of['engine','canonical','evaluator','envelope','types'])fs.writeFileSync(path.join(dir,name+'.js'),name==='engine'?patchSource(f[name+'.js']).next:f[name+'.js']);
fs.writeFileSync(path.join(dir,'policy-ledger-anchor.js'),f['policy-ledger-anchor.js']);
let source=patchSource(serialization(f['policy-runtime.js']).next).next.replace(/^import \{ AgenticPolicyEngine[^\n]+\n/,"import { AgenticPolicyEngine, createLegacyCompatibleState } from './engine.js';\n").replace("import { syncPolicyProjection } from '../mods/policy-projection.js';",'const syncPolicyProjection = () => {};');fs.writeFileSync(path.join(dir,'policy-runtime.js'),source);
const old=await import(pathToFileURL(path.join(dir,'policy-runtime.js')));const{AgenticPolicyEngine}=await import(pathToFileURL(path.join(dir,'engine.js')));const e=new AgenticPolicyEngine({mode:'legacy'});for(let i=0;i<5000;i++)e.evaluate({identity:{id:'format-proof',type:'agent'},action:{type:'read',resource:String(i)}});
const root=path.join(scratch,'project'),state=path.join(root,'.claude-flow/policy/state.json');fs.mkdirSync(path.dirname(state),{recursive:true});fs.writeFileSync(state,JSON.stringify(e.exportState()));await old.withPolicyTransaction(root,()=>null,{compactLedger:true});assert(old.loadPolicyState(root,{compact:true}).policyArchive);const before=old.loadPolicyState(root);assert.equal((await old.verifyPolicyLedger(root)).valid,true);
const native=await import(pathToFileURL(path.join(nativeRoot,'dist/src/services/policy-runtime.js')));
assert.equal((await native.verifyPolicyLedger(root)).valid,false,'native cannot read old compact format');
const recovery=path.join(root,'.local/two-store-restoration');fs.mkdirSync(recovery,{recursive:true});
const converted=await restoreNativePolicy({project:root,destination:path.join(recovery,'policy-format-v1'),oldCliRoot:legacyRoot,newCliRoot:nativeRoot});assert.equal(converted.status,'verified');assert.equal(converted.receipts,5000);
await assert.rejects(restoreNativePolicy({project:root,destination:path.join(recovery,'policy-format-v1'),oldCliRoot:legacyRoot,newCliRoot:nativeRoot}),/never overwrite/);
assert.deepEqual(old.loadPolicyState(root),before);assert.equal((await native.verifyPolicyLedger(root,{full:true})).valid,true);
await native.evaluatePolicyRequest({identity:{id:'format-proof',type:'agent'},action:{type:'read',resource:'after-native'}},root);const after=native.loadPolicyState(root);assert(after.retainedFrom>0);assert.equal(after.retainedFrom+after.receipts.length,5001);
const archive=path.join(root,'.claude-flow/policy/receipts.ledger.jsonl');const bytes=fs.readFileSync(archive);fs.writeFileSync(archive,'');assert.equal((await native.verifyPolicyLedger(root,{full:true})).valid,false,'missing original history must fail full audit');fs.writeFileSync(archive,bytes);assert.equal((await native.verifyPolicyLedger(root,{full:true})).valid,true);
console.log(JSON.stringify({status:'passed',receipts:5000,oldHistoryUnchanged:true,nativeFullVerification:true,nativeNewReceiptAndPruneVerified:true,scratch}));
