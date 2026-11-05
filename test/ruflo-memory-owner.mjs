import assert from 'node:assert/strict';
import './ruflo-policy-diagnostics.mjs';
import './ruflo-owner-schema.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { nativePolicyRuntimeSatisfied } from '../lib/policy-native-proof.mjs';
import { composeSource } from '../lib/plugin-compose.mjs';
import { canonicalEdits } from '../lib/ruflo-memory-owner/canonical.mjs';
import { createMemoryOwnerClient } from '../lib/ruflo-memory-owner/runtime.mjs';
import { createOwnerPolicyProtocol } from '../lib/ruflo-memory-owner/policy.mjs';
import { ENTRIES, composeCliContribution, entryApplied } from '../lib/cwd/patch-library.mjs';
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
  // Always exercise the immediately preceding installed runtime, even when the
  // optional upstream source fixture is not configured for the full suite.
  const clientBase = '/**\n * V3 CLI MCP Client\n */\nexport async function callMCPTool(toolName, input = {}, context) {\n'
    + '        // ADR-324: one policy chokepoint for every local CLI/MCP invocation.\n'
    + 'const decision = await authorizeMcpTool(toolName, input, context, classifyMcpTool(toolName));\n'
    + '        const result = await tool.handler(input, context);\n}\n';
  const currentClient = patchSource(clientBase); assert.deepEqual(currentClient.missing, []);
  const oldRuntime = JSON.parse(fs.readFileSync(new URL('../lib/ruflo-memory-owner/released-4.46.137.json', import.meta.url))).runtime;
  const runtimeEnd = currentClient.next.indexOf('/**\n * V3 CLI MCP Client');
  const previousClient = oldRuntime + currentClient.next.slice(runtimeEnd);
  assert.notEqual(previousClient, currentClient.next);
  assert.equal(patchSource(previousClient).next, currentClient.next, 'exact installed 4.46.137 runtime upgrades');
  assert.equal(reverse(previousClient), clientBase, 'previous release restores pristine anchors');
  assert.equal(isPatched(currentClient.next), true);
  const modifiedClient = previousClient.replace('explicitInventoryRead = false', 'explicitInventoryRead = true');
  assert.notEqual(modifiedClient, previousClient);
  assert.deepEqual(patchSource(modifiedClient).missing, ['modified-owner-forwarding']);
  assert.equal(patchSource(modifiedClient).next, modifiedClient, 'unknown prior runtime is never overwritten');
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
  const server = { handleNotification: async () => {}, getSessions: () => [...live.values()],
    terminateSession(id) { live.delete(id); if (current?.id === id) current = undefined; },
    async handleInitialize(request) {
      if (!request.params) return { error: 'invalid params' };
      current = { id: String(++sequence), clientInfo: request.params.clientInfo }; live.set(current.id, current);
      return { result: { initialized: true } };
    } };
  api.attachServer(server);
  const a = 'ruflo-native-owner-client:00000000-0000-4000-8000-000000000001';
  const b = 'ruflo-native-owner-client:00000000-0000-4000-8000-000000000002';
  const initialized = await server.handleInitialize({ params: { clientInfo: { name: a } } });
  assert.deepEqual(initialized.result.capabilities.experimental['ruflo/native-memory-owner'], {
    protocol:1,cwd,pin:store,releaseNotification:'notifications/ruflo/memory-owner-release'});
  await server.handleInitialize({ params: { clientInfo: { name: b } } });
  assert.deepEqual(api.releaseSession(b), { scheduled: 1 });
  assert.equal(live.size, 2, 'release does not clear the current initialized session');
  await server.handleInitialize({}); assert.equal(live.size, 2, 'invalid init must not drain');
  for (let i = 0; i < 120; i++) {
    const next = server.handleInitialize({ params: { clientInfo: { name: b } } });
    assert(current && current.clientInfo.name === b, 'handover is synchronous before yielding');
    await next; assert.equal(live.size, 2);
    if(i%2)await server.handleNotification({method:'notifications/ruflo/memory-owner-release',params:{clientId:b}});
    else api.releaseSession(b);
  }
  assert([...live.values()].some(row => row.clientInfo.name === a), 'unrelated persistent client survives');
  assert.throws(() => api.releaseSession('foreign-session'), /Invalid/);

  fs.mkdirSync(path.join(temporary,'services'));
  fs.writeFileSync(path.join(temporary,'services/policy-runtime.js'), `
export const state={transactions:[],committed:[],gate:null,fail:false};
export async function withPolicyTransaction(root,operation){
 const requests=[];state.transactions.push({root,requests});
 const result=await operation({evaluate(request){requests.push(request);if(request.throw)throw Error('evaluation failed');return {allowed:!request.deny,id:request.id};}});
 if(state.gate)await state.gate;if(state.fail)throw Error('commit failed');
 state.committed.push(...requests);return result;
}`);
  const {state:policyState}=await import(pathToFileURL(path.join(temporary,'services/policy-runtime.js')));
  assert.equal(api.policyEvaluator({transport:'stdio'},'memory_list'),undefined);
  const evaluateHook=api.policyEvaluator({transport:'http'},'hooks_post-command');
  assert.equal(typeof evaluateHook,'function','hook authorization must share the same owner policy queue');
  const evaluateWrite=api.policyEvaluator({transport:'http'},'memory_store');
  assert.equal(typeof evaluateWrite,'function');
  const evaluate=api.policyEvaluator({transport:'http'},'memory_list');
  let commit;policyState.gate=new Promise(resolve=>{commit=resolve;});let delivered=false;
  const pending=Promise.all([evaluate({id:0},cwd),evaluate({id:1,deny:true},cwd)]).then(value=>{delivered=true;return value;});
  while(!policyState.transactions.length)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(delivered,false,'no authorization escapes before native durable commit');
  assert.equal(policyState.committed.length,0);commit();
  assert.deepEqual(await pending,[{allowed:true,id:0},{allowed:false,id:1}]);
  assert.equal(policyState.committed.length,2,'denied calls retain individual receipt evaluation');
  policyState.gate=null;policyState.transactions=[];policyState.committed=[];
  let releaseActive;
  policyState.gate=new Promise(resolve=>{releaseActive=resolve;});
  const heldDecision=evaluate({id:'held'},cwd);
  while(!policyState.transactions.length)await new Promise(resolve=>setImmediate(resolve));
  const queued=Array.from({length:33},(_,id)=>[evaluate,evaluateWrite,evaluateHook][id%3]({id},cwd));
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(policyState.transactions.length,1,'queued batches must not contend with their own active policy lock');
  releaseActive();await heldDecision;await Promise.all(queued);
  assert.deepEqual(policyState.transactions.map(x=>x.requests.length),[1,32,1]);
  assert.equal(policyState.committed.length,34,'mixed reads, writes and hooks each retain their native decision');
  policyState.gate=null;policyState.transactions=[];policyState.committed=[];
  const many=await Promise.all(Array.from({length:33},(_,id)=>evaluate({id},cwd)));
  assert.deepEqual(many.map(x=>x.id),Array.from({length:33},(_,i)=>i));
  assert.deepEqual(policyState.transactions.map(x=>x.requests.length),[32,1]);
  policyState.transactions=[];
  await Promise.all([evaluate({id:'a'},cwd),evaluate({id:'b'},temporary)]);
  assert.equal(policyState.transactions.length,2,'distinct policy roots never share a transaction');
  for(const fault of ['evaluation','commit']){
    policyState.committed=[];policyState.fail=fault==='commit';
    const failed=await Promise.allSettled([evaluate({id:0},cwd),evaluate({id:1,throw:fault==='evaluation'},cwd)]);
    assert(failed.every(x=>x.status==='rejected'));assert.equal(policyState.committed.length,0);
  }
  policyState.fail=false;

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
export class StreamableHTTPClientTransport { constructor(_url,options){state.fetch=options.fetch;} }
export class Client {
  getServerCapabilities() { return state.capabilities; }
  async notification({method}) { state.calls.push(method); if(state.mode==='cleanup-fails')throw Error('cleanup unavailable'); if(state.mode==='hang')return state.fetch('http://127.0.0.1:19872/mcp',{}); }
  async connect() { if (state.block) await new Promise(resolve => { state.resume = resolve; }); }
  async listTools() { return { tools: ['memory_owner_identity','memory_owner_release','memory_store'].map(name => ({name,inputSchema:{properties:{nativeResult:{},requireNative:{},appendOnly:{},appendConditions:{},generateEmbeddingFlag:{}}}})) }; }
  async callTool({name}) {
    state.calls.push(name);
    if (name === 'memory_owner_identity') return {structuredContent:state.identity};
    if (name === 'memory_store' && state.mode === 'unknown') throw new Error('response lost');
    if (name === 'memory_store' && state.response) return state.response;
    if (name === 'memory_owner_release' && state.mode === 'cleanup-fails') throw new Error('cleanup unavailable');
    return {structuredContent:{success:true}};
  }
  async close() {}
}`);
  const sdkUrl = pathToFileURL(sdkFile).href;
  const factoryFile = path.join(temporary, 'factory.mjs');
  fs.writeFileSync(factoryFile, createOwnerPolicyProtocol.toString() + '\nexport ' + createMemoryOwnerClient.toString()
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
  const protocol = { ...state.identity, releaseNotification:'notifications/ruflo/memory-owner-release' };
  state.capabilities = {experimental:{'ruflo/native-memory-owner':protocol}};
  state.calls = []; state.mode = 'ok';
  const modern = await isolatedFactory(pathToFileURL(path.join(temporary, 'mcp-client.js')).href);
  assert.deepEqual(await modern.call('memory_store'), {success:true});
  assert.deepEqual(state.calls, ['memory_store', 'notifications/ruflo/memory-owner-release'],
    'protocol controls add no policy-authorized tool calls');
  await modern.close();
  // Native MCP marks canonical operation failures isError and pretty-prints them.
  // Public-memory callers need the original result, including append-only refusal,
  // so Brain can perform its existing exact readback instead of losing the cause.
  const failure = {success:false,id:'',error:'Key already exists: qualification-only'};
  for (const response of [
    {isError:true,content:[{type:'text',text:JSON.stringify(failure,null,2)}]},
    {isError:true,structuredContent:failure},
  ]) {
    state.response=response; state.calls=[];
    const failed=await isolatedFactory(pathToFileURL(path.join(temporary,'mcp-client.js')).href);
    assert.deepEqual(await failed.call('memory_store',{}, {},true),failure,'canonical false remains false with its original reason');
    assert.equal(state.calls.filter(name=>name==='memory_store').length,1,'no error replay');
    assert(state.calls.includes('notifications/ruflo/memory-owner-release'),'completed refusal retires normally');
    await failed.close();
    const presented=await isolatedFactory(pathToFileURL(path.join(temporary,'mcp-client.js')).href);
    await assert.rejects(presented.call('memory_store'),{message:'Native memory owner refused: Key already exists: qualification-only'});
    await presented.close();
  }
  for (const result of [
    {success:false,error:{code:'DENIED',message:'policy denied'},value:'PRIVATE_PAYLOAD already exists'},
    {success:true,value:'PRIVATE_PAYLOAD already exists'},
    {success:false,error:null,value:'PRIVATE_PAYLOAD already exists'},
    {success:false,error:'   ',value:'PRIVATE_PAYLOAD already exists'},
  ]) {
    state.response={isError:true,content:[{type:'text',text:JSON.stringify(result,null,2)}]};
    const refused=await isolatedFactory(pathToFileURL(path.join(temporary,'mcp-client.js')).href);
    await assert.rejects(refused.call('memory_store',{}, {},true),error=>{
      assert(!error.message.includes('PRIVATE_PAYLOAD')&&!error.message.includes('already exists'));
      assert(!error.message.includes('\n')); return true;
    });
    await refused.close();
  }
  for (const isError of [true,false]) {
    state.response={isError,content:[{type:'text',text:'{"value":"PRIVATE_PAYLOAD already exists", BROKEN'}]};
    const malformed=await isolatedFactory(pathToFileURL(path.join(temporary,'mcp-client.js')).href);
    await assert.rejects(malformed.call('memory_store',{}, {},true),error=>
      !error.message.includes('PRIVATE_PAYLOAD')&&!error.message.includes('already exists'));
    await malformed.close();
  }
  state.response={isError:true,structuredContent:{error:{message:'policy denied\n'+ 'x'.repeat(2000)}}};
  const detailed=await isolatedFactory(pathToFileURL(path.join(temporary,'mcp-client.js')).href);
  await assert.rejects(detailed.call('memory_store'),error=>error.message.startsWith('Native memory owner refused: policy denied ')
    && !error.message.includes('\n') && error.message.length<=1053);
  await detailed.close(); delete state.response;
  for (const advertised of [{...protocol,cwd:temporary},{...protocol,pin:temporary},{...protocol,releaseNotification:'wrong'},null]) {
    state.capabilities = {experimental:{'ruflo/native-memory-owner':advertised}};state.calls=[];
    const bad = await isolatedFactory(pathToFileURL(path.join(temporary, 'mcp-client.js')).href);
    await assert.rejects(bad.call('memory_store'), /identity does not match|Invalid native owner protocol/);
    assert(!state.calls.includes('memory_store'));assert(!state.calls.includes('memory_owner_identity'),
      'malformed/misbound protocol never downgrades to legacy controls');await bad.close();
  }
  state.capabilities = {experimental:{'ruflo/native-memory-owner':protocol}};
  state.calls=[];state.mode='unknown';
  const modernUnknown=await isolatedFactory(pathToFileURL(path.join(temporary,'mcp-client.js')).href);
  await assert.rejects(modernUnknown.call('memory_store'), /response lost/);await modernUnknown.close();
  assert.deepEqual(state.calls,['memory_store'],'uncertain protocol write is neither retried nor released');
  state.calls=[];state.mode='hang';const savedFetch=globalThis.fetch;const savedError=console.error;let abortedFetch=false;
  globalThis.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{abortedFetch=true;reject(signal.reason);},{once:true}));
  console.error=()=>{};const started=Date.now();
  try {
    const hung=await isolatedFactory(pathToFileURL(path.join(temporary,'mcp-client.js')).href);
    assert.deepEqual(await hung.call('memory_store'),{success:true});await hung.close();
    assert(abortedFetch,'cleanup deadline must cancel the actual HTTP fetch');
    assert(Date.now()-started>=4900 && Date.now()-started<15000,'bounded cleanup without changing native operation deadlines');
  } finally {globalThis.fetch=savedFetch;console.error=savedError;}

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
  const anchorSource=fs.readFileSync(new URL('./fixtures/ruflo-memory-owner/policy-anchor-log-3.71.0.js',import.meta.url),'utf8');
  const anchorPatched=patchSource(anchorSource);
  assert.deepEqual(anchorPatched.missing,[]);
  assert.equal(reverse(anchorPatched.next),anchorSource);
  assert.equal(patchSource(anchorPatched.next).next,anchorPatched.next);
  fs.writeFileSync(path.join(temporary,'anchor-original.js'),anchorSource);
  fs.writeFileSync(path.join(temporary,'anchor-patched.js'),anchorPatched.next);
  const parsers=await Promise.all(['original','patched'].map(name=>import(pathToFileURL(path.join(temporary,'anchor-'+name+'.js')))));
  const entry={seq:0,hash:'hash',by:'escaped " quote \\ newline\n braces } ] 😀'};
  const documents=[
    JSON.stringify({version:1,entries:[entry,{...entry,seq:1}]},null,2),
    '{"version":1,"entries":[\n'+JSON.stringify(entry)+',\n'+JSON.stringify({...entry,seq:1})+'\n]}',
    JSON.stringify({entries:[{...entry,by:'😀'.repeat(20000)},entry],version:1}),
    '{"version":1,"entries":[\n'+JSON.stringify(entry)+',\n]}',
    '{"version":1,"entries":[\n'+JSON.stringify(entry)+'\n',
    '{"version":1,"version":1,"entries":[]}',
    '{"version":2,"entries":[\n'+JSON.stringify(entry)+'\n]}',
    '{"version":1,"entries":[\n{"by":"literal\nnewline"}\n]}',
    '{"version":1,"entries":[]} trailing',
  ];
  for(const [index,document] of documents.entries()){
    const file=path.join(temporary,'anchor-case.json');fs.writeFileSync(file,document);
    const outcomes=parsers.map(parser=>{try{return{entries:[...parser.anchorEntries(file)]};}catch(error){return{error:error.message};}});
    assert.deepEqual(outcomes[1],outcomes[0],'native parser equivalence case '+index);
  }
  for(const parser of parsers){
    const file=path.join(temporary,'anchor-write.json');let validations=0;
    const fd=fs.openSync(file,'w');
    try{parser.appendedAnchorLog(undefined,entry,()=>{validations++;return false;})[parser.ATOMIC_JSON_WRITER](fd);assert.fail('invalid anchor accepted');}
    catch(error){assert.match(error.message,/policy-anchor-log-corrupt/);}
    finally{fs.closeSync(fd);}
    assert.equal(validations,1,'writer retains native authentication');
  }
  const native = process.env.RSP_OWNER_NATIVE_SRC;
  if (native) for (const file of ['mcp-client.js', 'mcp-server.js', 'mcp-tools/memory-tools.js', 'mcp-tools/agentdb-tools.js',
    'memory/memory-initializer.js', 'commands/memory.js', 'services/policy-runtime.js', 'services/policy-anchor-log.js']) {
    const source = fs.readFileSync(path.join(native, file), 'utf8');
    const result = patchSource(source);
    assert.deepEqual(result.missing, [], file);
    assert.equal(reverse(result.next), source, file + ' exact restoration');
    assert.equal(isPatched(result.next), true, file + ' idempotency');
    if (file === 'mcp-tools/memory-tools.js') {
      const { descriptor: errors } = await import('../lib/ruflo-memory-entries-only/patcher.mjs');
      const { isKnownComposition } = await import('../lib/composition-proof.mjs');
      const entries = ENTRIES.filter(entry => entry.suffix.slice(-2).join('/') === file);
      const cli = { patchSource: value => composeCliContribution(value, entries) };
      const core = cli.patchSource(source); assert.deepEqual(core.missing, []);
      const guarded = errors.patchSource(core.next); assert.deepEqual(guarded.missing, []);
      const complete = patchSource(guarded.next); assert.deepEqual(complete.missing, []);
      assert(errors.isPatched(complete.next) && isPatched(complete.next));
      assert.equal(errors.reverse(reverse(complete.next)), core.next);
      const owners = [cli, errors, { patchSource }];
      assert(isKnownComposition(source, complete.next, owners));
      assert(isKnownComposition(source, patchSource(core.next).next, owners), 'partial install remains exactly recoverable');
    }
    if(file==='mcp-client.js') for(const version of ['4.46.107','4.46.108']) {
      const prior=JSON.parse(fs.readFileSync(new URL('../lib/ruflo-memory-owner/released-'+version+'.json',import.meta.url),'utf8'));
      const current='// ruflo-source-patch (ruflo#4654): native owner forwarding\n'+createMemoryOwnerClient.toString()+'\nexport const rspMemoryOwner = await createMemoryOwnerClient(import.meta.url);\n';
      const old=source.replace('/**\n * V3 CLI MCP Client',prior.runtime+'/**\n * V3 CLI MCP Client').replace('export async function callMCPTool(toolName, input = {}, context) {','export async function callMCPTool(toolName, input = {}, context) {\n    if (rspMemoryOwner.configured()) return rspMemoryOwner.call(toolName, input, context);');assert.notEqual(old,result.next);
      assert.equal(patchSource(old).next,result.next,'exact published '+version+' migration');
      assert.equal(reverse(old),source,'exact published '+version+' restoration');
    }
    if(file==='services/policy-runtime.js') {
      const old=source.replace('export async function authorizeMcpTool(toolName, input, context = {}, attributes = {}) {',
        '// ruflo-source-patch (ruflo#4654): native owner forwarding: preserve native request construction and individual decisions.\nexport async function authorizeMcpTool(toolName, input, context = {}, attributes = {}, evaluate = evaluatePolicyRequest) {')
        .replace('    return evaluatePolicyRequest({\n        identity: resolveMcpCallerIdentity(),','    return evaluate({\n        identity: resolveMcpCallerIdentity(),');
      assert.equal(nativePolicyRuntimeSatisfied(old),true,'installed prior owner rendition remains a proven native ledger before upgrade');
      assert.equal(patchSource(old).next,result.next,'prior policy rendition upgrades exactly');
      const release112=result.next.replace('// ruflo-source-patch (ruflo#4654): native owner forwarding: owner-authorized temporary contention budget; mutual exclusion unchanged.\nconst LOCK_WAIT_MS = 15_000;', 'const LOCK_WAIT_MS = 5_000;');
      assert.notEqual(release112,result.next);
      assert.equal(nativePolicyRuntimeSatisfied(release112),true,'112 diagnostics retain native ledger proof');
      assert.equal(patchSource(release112).next,result.next,'112 diagnostics upgrade without losing native proof');
      const targets=['ruflo-policy-serialization','ruflo-policy-ledger','ruflo-memory-owner'];
      assert.equal(nativePolicyRuntimeSatisfied(source),true);
      assert.equal(nativePolicyRuntimeSatisfied(result.next),true,'exact sibling keeps qualified native ledger retired');
      assert.equal(nativePolicyRuntimeSatisfied(result.next+'\n'),false,'unknown modification is not native proof');
      assert.equal(composeSource(source,targets),result.next);
      assert.equal(composeSource(result.next,targets),result.next,'all active policy owners reinstall without old overlays');
      assert.equal(reverse(result.next),source);
    }
    if(file==='mcp-client.js') {
      for (const version of ['4.46.116', '4.46.117', '4.46.123', '4.46.126', '4.46.128', '4.46.134', '4.46.137']) {
      const previous=JSON.parse(fs.readFileSync(new URL('../lib/ruflo-memory-owner/released-'+version+'.json',import.meta.url),'utf8')).runtime;
      const liveRuntime=result.next.slice(0,result.next.indexOf('/**\n * V3 CLI MCP Client'));
      let prior=result.next.replace(liveRuntime,previous);
      if (!['4.46.123', '4.46.126', '4.46.128', '4.46.134', '4.46.137'].includes(version)) prior=prior.replace('        context = rspMemoryOwner.policyContext(context);\n        const forwarded = await rspMemoryOwner.tryForward(toolName, input, context);\n        if (forwarded.forwarded) return applyContentBoundaryGuardrail(toolName, forwarded.result);\n', '');
      assert.notEqual(prior,result.next,'reproduces previous multiline refusal decoder');
      assert.equal(reverse(prior),source,'prior released source restores exactly');
      assert.equal(patchSource(prior).next,result.next,'released decoder upgrades without overwriting unknown bytes');
      }
      const start=result.next.indexOf('export async function callMCPTool(');
      const fn=result.next.slice(start,result.next.indexOf('\n}\n',start)+2).replace('export async function','return async function');
      const events=[];let allow=true;const context={approvalIds:['approval'],evidence:[{proof:'native'}],serverId:'caller-server',environment:'test'};
      const input={namespace:'scope',key:'exact'};
      const call=new Function('TOOL_REGISTRY','MCPClientError','authorizeMcpTool','classifyMcpTool','rspMemoryOwner','applyContentBoundaryGuardrail',fn)(
        new Map([['memory_retrieve',{handler:async()=>{throw Error('local handler must not run');}}]]),Error,
        async(name,args,ctx)=>{assert.equal(args,input);assert.equal(ctx,context);events.push('caller-policy');return{enforcedOutcome:allow?'allowed':'denied',reason:'fixture',receiptId:'native-receipt'};},
        ()=>({actionType:'memory.read'}),{configured:()=>true,policyContext:c=>c,tryForward:async()=>({forwarded:false}),policyEvaluator:()=>undefined,call:async()=>{events.push('owner-dispatch');return{found:true};}},
        (_name,value)=>{events.push('native-result-screen');return value;});
      allow=false;await assert.rejects(call('memory_retrieve',input,context),/policy-denied/);assert.deepEqual(events,['caller-policy']);
      allow=true;events.length=0;assert.deepEqual(await call('memory_retrieve',input,context),{found:true});
      assert.deepEqual(events,['caller-policy','owner-dispatch','native-result-screen']);
    }
    if (file === 'memory/memory-initializer.js') {
      const core = composeCliContribution(source, ENTRIES.filter(entry =>
        ['cwd', 'memory'].includes(entry.target) && entry.suffix.slice(-2).join('/') === file));
      assert.deepEqual(core.missing, []);
      const composed = patchSource(core.next);
      assert.deepEqual(composed.missing, []);
      assert.equal(reverse(composed.next), core.next, 'restore preserves the existing core guards');
      assert.equal(isPatched(composed.next), true);
      const lock=ENTRIES.find(entry=>entry.id==='memory/write-lock');
      assert.equal(entryApplied(composed.next,lock),true,'monitor accepts exact owner/lock composition');
      assert.equal(entryApplied(composed.next.replace('storeEntry = __rufloGuard(storeEntry)', 'storeEntry = storeEntry'),lock),false,'missing guard still fails');
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
