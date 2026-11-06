import assert from 'node:assert/strict';
import fs from 'node:fs';
import { patchCli, reverseCli } from '../lib/ruflo-pii-policy/cli.mjs';
const read = name => fs.readFileSync(new URL('./fixtures/pii-policy/'+name, import.meta.url),'utf8');
const patterns=read('pii-patterns.js');const selector=patchCli(patterns);
assert.deepEqual(selector.missing,[]);
const detector=new Function(selector.next+';return new Detector;')();
for(const value of ['research@example.org','123-45-6789','4111111111111111']) assert.equal(detector.detectCredentials(value),false);
for(const value of ['sk-'+'A7b9'.repeat(12),'password=abcd']) for(let i=0;i<3;i++) assert.equal(detector.detectCredentials(value),true);
assert(patchCli(patterns.replace("type: 'api_key'","type: 'unknown'")).missing.length);
const builtin=read('builtin.js'),patchedBuiltin=patchCli(builtin);
assert.deepEqual(patchedBuiltin.missing,[]);assert.equal(reverseCli(patchedBuiltin.next),builtin);
const pureBuiltin=new Function('createHash',patchedBuiltin.next.replace(/^import .*\n/gm,'').replace('export function','function')+'\n;return createBuiltinAIDefence();')(()=>({update(){return this},digest(){return 'fixture'}}));
assert.equal(pureBuiltin.hasCredentials('research@example.org'),false);
assert.equal(pureBuiltin.hasCredentials('sk-'+'A7b9'.repeat(12)),true);
const native=read('defend.js'),patched=patchCli(native);
assert.deepEqual(patched.missing,[]);assert.equal(reverseCli(patched.next),native);
for(const format of ['json','text']) for(const test of [
 {safe:true,piiFound:true,threats:[],credential:false,accepted:true},
 {safe:false,piiFound:true,threats:[],credential:false,accepted:true},
 {safe:true,piiFound:true,threats:[],credential:true,accepted:false},
 {safe:false,piiFound:true,threats:[{severity:'high',type:'prompt_injection',confidence:1}],credential:false,accepted:false},
 {safe:false,piiFound:false,threats:[],credential:false,accepted:false},
]) {
 const lines=[];const output=new Proxy({writeln:x=>lines.push(x),createSpinner:()=>({start(){},stop(){}})}, {get:(o,k)=>o[k]||((x)=>x)});
 const defender={detect:async()=>test,hasCredentials:()=>test.credential};
 const source=patched.next.replace("await import('@claude-flow/aidefence')",'await load()');
 const command=new Function('output','load','createBuiltinAIDefence',source+';return defendCommand;')(output,async()=>({createAIDefence:()=>defender}),()=>defender);
 const result=await command.action({flags:{input:'fixture input',output:format,learn:false}});
 assert.equal(result.success,test.accepted);assert.equal(result.exitCode,test.accepted?0:1);
 if(format==='json') {const raw=JSON.parse(lines.find(x=>typeof x==='string'&&x.startsWith('{')));assert.equal(raw.safe,test.safe);assert.equal(raw.piiFound,test.piiFound);assert.deepEqual(raw.threats,test.threats);}
}
console.log('PASS CLI PII-only admission, native credential selectors, unchanged raw verdicts, threat/error refusal, exact reversal');
