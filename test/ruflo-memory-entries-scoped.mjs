// Exact published 3.75 handler and namespace resolver, no database or MCP call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { descriptor } from '../lib/ruflo-memory-entries-only/patcher.mjs';
const fixture = name => fs.readFileSync(new URL('./fixtures/ruflo-memory-entries-only/' + name, import.meta.url), 'utf8');
const handler = fixture('scoped-retrieve-3.75.0.txt');
const scope = fixture('scoped-namespace-3.75.0.txt').replaceAll('export ', '');
const pristine = `const tool = {name: 'memory_retrieve',\n${handler}};`;
const fixed = descriptor.patchSource(pristine);
assert.deepEqual(fixed.missing, []);
assert.notEqual(fixed.next, pristine);
assert.equal(descriptor.reverse(fixed.next), pristine);
assert.equal(descriptor.patchSource(fixed.next).next, fixed.next);
assert(descriptor.isPatched(fixed.next));
assert(!fixed.next.includes('memoryEntriesOnly'));
for (const changed of [pristine.replace('namespace = scoped.namespace', 'namespace = input.namespace'),
  pristine.replace('resolveDbPathOption(input.dbPath, context)', 'resolveDbPathOption(input.dbPath)'), pristine + handler]) {
  assert(descriptor.patchSource(changed).missing.length);
  assert.equal(descriptor.patchSource(changed).next, changed);
}
// Store calls are inert seams. Path authority refuses before reaching getEntry;
// native namespace partitioning and presentation execute unchanged.
const create = (source, getEntry) => new Function('getEntry', `
  const validateIdentifier = value => ({valid: typeof value === 'string' && value.length > 0});
  ${scope}
  const missingRequiredString = (input, field) => typeof input[field] === 'string' && input[field]
    ? null : {success:false,error:'missing key'};
  const resolveDbPathOption = (dbPath, context) => {if(!context?.allowed)throw Error('native path authority refused');return dbPath;};
  const ensureInitialized = async () => {};
  const getMemoryFunctions = async () => ({getEntry});
  const validateMemoryInput = () => {};
  const describeBackend = async () => 'native';
  ${source}
  return tool.handler;
`)(getEntry);
const input = {key:'k',namespace:'ns',scope:'project',agentId:'agent_1',dbPath:'/private-fixture.db'};
const context = {allowed:true};
const refusal = {success:false,found:false,error:'native read refused'};
const original = await create(pristine, async () => refusal)(input,context);
assert.equal(original.found,false);assert.equal(original.error,undefined);
assert.equal(original.success,undefined,'upstream false-empty failure reproduced');
let received, calls=0;
const run = result => create(fixed.next,async options=>{received=options;calls++;return result;});
const failed = await run(refusal)(input,context);
assert.equal(failed.success,false);assert.equal(failed.error,refusal.error);
assert.deepEqual(received,{key:'k',namespace:'agent-memory:project:agent_1:ns',dbPath:input.dbPath});
const absent=await run({success:true,found:false})(input,context);
assert.deepEqual(absent,{key:'k',namespace:received.namespace,scope:'project',agentId:'agent_1',value:null,found:false});
const success=await run({success:true,found:true,entry:{content:'{"n":42}',tags:['a']}})(input,context);
assert.deepEqual(success.value,{n:42});assert.equal(success.scope,'project');assert.equal(success.agentId,'agent_1');
assert.equal(success.namespace,'agent-memory:project:agent_1:ns');
await run({success:true,found:false})({key:'k',dbPath:input.dbPath},context);
assert.equal(received.namespace,'default');
const before=calls;
assert.match((await run(refusal)({...input,scope:'unknown'},context)).error,/scope must be/);
assert.match((await run(refusal)({...input,agentId:undefined},context)).error,/scope requires agentId/);
await assert.rejects(()=>run(refusal)(input,{allowed:false}),/native path authority refused/);
assert.equal(calls,before,'invalid scope and path authority never reach storage');
const thrown=await create(fixed.next,async()=>{throw Error('native throw');})(input,context);
assert.equal(thrown.success,false);assert.equal(thrown.error,'native throw');
console.log('PASS entries-only scoped 3.75: false-empty reproduction, exact refusal/absence/success, native scope/path authority, reversal and idempotence');
