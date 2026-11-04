import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createMemoryOwnerClient } from '../lib/ruflo-memory-owner/runtime.mjs';
import { createOwnerPolicyProtocol } from '../lib/ruflo-memory-owner/policy.mjs';
const capability = 'ruflo/native-memory-owner-one-call';
const clientId = () => 'ruflo-native-owner-client:' + randomUUID();
const init = (id, ephemeral = true) => ({ jsonrpc:'2.0',id:1,method:'initialize',params:{
  protocolVersion:'2025-11-25',clientInfo:{name:id,version:'1'},
  capabilities:ephemeral ? {experimental:{[capability]:{version:1}}}:{} } });
const request = (id, token, method = 'tools/call', name = 'fixture_read') => ({jsonrpc:'2.0',id:2,method,
  params:{name,arguments:{},_meta:{[capability]:{clientId:id,token}}} });
if (process.argv[2] === 'killed-client') {
  const [url, token, tool] = process.argv.slice(3), id = clientId();
  const post = body => fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}).then(r=>r.json());
  const initialized = await post(init(id));
  const disposal = initialized.result.capabilities.experimental[capability];
  process.send({id});
  await post(request(id,disposal.token,'tools/call',tool));
  process.exit(0);
}
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'rsp-owner-retirement-'));
const saved={...process.env}, now=Date.now;
let native;
try {
  process.env.HOME=scratch; delete process.env.CLAUDE_FLOW_DB_PATH;
  const tokenFile=path.join(scratch,'token'),config=path.join(scratch,'config.json');
  fs.writeFileSync(tokenFile,'disposable',{mode:0o600});
  fs.writeFileSync(config,JSON.stringify({version:1,owners:{one:{cwd:process.cwd(),pin:null,url:'http://127.0.0.1:19872/mcp',tokenFile}},contexts:[{cwd:process.cwd(),pin:null,owner:'one'}],stores:[]}),{mode:0o600});
  process.env.RUFLO_MEMORY_OWNER_CONFIG=config;
  fs.writeFileSync(path.join(scratch,'package.json'),'{"type":"module"}');
  fs.writeFileSync(path.join(scratch,'mcp-server.js'),"export function resolveMcpHttpAuthToken(){return 'disposable';}");
  const moduleUrl=pathToFileURL(path.join(scratch,'mcp-client.js')).href;
  const makeServer=()=>{
    const sessions=new Map();let sequence=0,held,release,current;
    return {calls:[],sessions,
      getSessions:()=>[...sessions.values()],terminateSession(id){sessions.delete(id);if(current?.id===id)current=undefined;},
      async handleInitialize(r){if(!r.params)return{error:'invalid'};if(sessions.size>=100)throw Error('Maximum sessions (100) reached');current={id:String(++sequence),clientInfo:r.params.clientInfo};sessions.set(current.id,current);return{result:{capabilities:{}}};},
      async handleNotification(){},
      async handleRequest(r){if(r.method==='initialize')return this.handleInitialize(r);this.calls.push(r);if(held)await held;return{result:{success:true}};},
      hold(){held=new Promise(r=>release=r);},release(){held=null;release();},
    };
  };
  const attach=async server=>{const api=await createMemoryOwnerClient(moduleUrl);await api.enterServerMode(process.cwd());api.attachServer(server);return api;};
  const server=makeServer();const serverApi=await attach(server);
  const abandoned=[];
  for(let i=0;i<100;i++){const id=clientId();const r=await server.handleInitialize(init(id));abandoned.push({id,token:r.result.capabilities.experimental[capability].token});}
  await assert.rejects(server.handleInitialize(init(clientId())),/Maximum sessions/);
  Date.now=()=>now()+30001;
  await server.handleInitialize(init(clientId(),false));
  assert.equal(server.getSessions().length,1,'100 abandoned handshakes reclaimed before successor initialize');
  await assert.rejects(server.handleRequest(request(abandoned[0].id,abandoned[0].token)),/expired|Invalid/);
  Date.now=now;
  const persistent=server.getSessions()[0].id;
  for(const tool of ['fixture_read','fixture_write']){
    const id=clientId(),r=await server.handleInitialize(init(id)),token=r.result.capabilities.experimental[capability].token;
    await assert.rejects(server.handleRequest(request(id,randomUUID(),'tools/call',tool)),/Invalid/);
    server.hold();const running=server.handleRequest(request(id,token,'tools/call',tool));
    Date.now=()=>now()+60000;
    await server.handleInitialize(init(clientId(),false));
    assert(server.getSessions().some(s=>s.clientInfo.name===id),'no expiry or retirement of in-flight work');
    server.release();await running;
    await assert.rejects(server.handleRequest(request(id,token,'tools/call',tool)),/completed/);
    await server.handleInitialize(init(clientId(),false));
    assert(!server.getSessions().some(s=>s.clientInfo.name===id));
    assert(server.getSessions().some(s=>s.id===persistent));Date.now=now;
  }
  assert.equal(server.calls.filter(r=>r.params.name==='fixture_write').length,1,'no write replay');
  const releasedId=clientId(),releasedInit=await server.handleInitialize(init(releasedId));
  const releasedToken=releasedInit.result.capabilities.experimental[capability].token;
  assert.throws(()=>serverApi.releaseSession(releasedId,randomUUID()),/Invalid/);
  serverApi.releaseSession(releasedId,releasedToken);
  await assert.rejects(server.handleRequest(request(releasedId,releasedToken)),/completed/);
  for(let i=0;i<105;i++){
    const id=clientId(),r=await server.handleInitialize(init(id));
    await server.handleRequest(request(id,r.result.capabilities.experimental[capability].token));
  }
  assert(server.getSessions().length<10,'completed one-call requests need no client release');
  // Actual serialized client seam: initialization succeeds but tools/list fails.
  const sdk=path.join(scratch,'sdk.mjs');
  fs.writeFileSync(sdk,`export const state={calls:[],mode:'list-fails',identity:${JSON.stringify({protocol:1,cwd:process.cwd(),pin:null})}};
export class StreamableHTTPClientTransport{}
export class Client{constructor(info,opts){state.options=opts;state.info=info;}async connect(){}
getServerCapabilities(){return{experimental:{'ruflo/native-memory-owner':{...state.identity,releaseNotification:'notifications/ruflo/memory-owner-release'},'${capability}':{version:1,token:'00000000-0000-4000-8000-000000000001'}}};}
async listTools(){if(state.mode==='list-fails')throw Error('list failed');return{tools:[{name:'memory_store',inputSchema:{properties:{}}}]};}
async callTool(r){state.calls.push(r);throw Error('response lost');}
async notification(r){state.calls.push(r);}async close(){}}
`);
  const factory=path.join(scratch,'factory.mjs'),sdkUrl=JSON.stringify(pathToFileURL(sdk).href);
  fs.writeFileSync(factory,createOwnerPolicyProtocol.toString()+'\n'+createMemoryOwnerClient.toString().replace("'@modelcontextprotocol/sdk/client/index.js'",sdkUrl).replace("'@modelcontextprotocol/sdk/client/streamableHttp.js'",sdkUrl)+'\nexport {createMemoryOwnerClient};');
  const create=(await import(pathToFileURL(factory))).createMemoryOwnerClient;
  const state=(await import(pathToFileURL(sdk))).state;
  const failed=await create(moduleUrl);await assert.rejects(failed.call('memory_store'),/list failed/);
  assert.equal(state.calls[0].method,'notifications/ruflo/memory-owner-release');
  assert.equal(state.calls[0].params.token,'00000000-0000-4000-8000-000000000001');
  assert.equal(state.options.capabilities.experimental[capability].version,1);
  state.calls=[];state.mode='lost';const uncertain=await create(moduleUrl);
  await assert.rejects(uncertain.call('memory_store'),/response lost/);
  assert.equal(state.calls.length,1);assert.equal(state.calls[0].name,'memory_store');
  assert(state.calls[0]._meta[capability].token,'server can attribute completion despite client uncertainty');
  state.calls=[];const pooled=await create(moduleUrl);
  await assert.rejects(pooled.call('memory_store',{}, {sessionId:'persistent'}),/response lost/);
  assert.deepEqual(state.options.capabilities,{});assert.equal(state.calls[0]._meta,undefined);

  if(process.env.RSP_OWNER_NATIVE_ROOT){
    const require=createRequire(path.join(process.env.RSP_OWNER_NATIVE_ROOT,'package.json'));
    const {MCPServer}=await import(pathToFileURL(require.resolve('@claude-flow/mcp')).href);
    const logger={debug(){},info(){},warn(){},error(){}};
    native=new MCPServer({transport:'http',host:'127.0.0.1',port:0,auth:{enabled:true,method:'token',tokens:['disposable']},
      rateLimit:{windowMs:60000,limit:600},sessionRateLimit:{requestsPerSecond:100,burstSize:1000,perSessionLimit:500}},logger);
    const api=await attach(native);let gate,finish,entered;
    const calls={fixture_read:0,fixture_write:0};
    for(const name of Object.keys(calls))native.registerTool({name,description:'Disposable lifecycle boundary',inputSchema:{type:'object',properties:{}},handler:async()=>{calls[name]++;entered();await gate;return{success:true};}});
    await native.start();const endpoint='http://127.0.0.1:'+native.transports[0].server.address().port+'/mcp';
    const firstAbandoned=clientId();await native.handleInitialize(init(firstAbandoned));
    for(let i=1;i<100;i++)await native.handleInitialize(init(clientId()));
    const nativeCapacity=typeof native.sessionManager.reserveCapacity==='function';
    if(nativeCapacity){
      const priorCurrent=native.getSessions().at(-1).id;
      assert((await native.handleInitialize(init(clientId()))).result,'native capacity eviction admits the successor');
      assert.equal(native.getSessions().length,100,'upstream capacity stays bounded');
      assert(!native.getSessions().some(s=>s.clientInfo.name===firstAbandoned),'upstream evicts the oldest superseded allocation');
      assert(native.getSessions().some(s=>s.id===priorCurrent),'upstream preserves the current allocation');
    }else await assert.rejects(native.handleInitialize(init(clientId())),/Maximum sessions/);
    Date.now=()=>now()+30001;
    const stable=clientId();await native.handleInitialize(init(stable,false));
    assert.equal(native.getSessions().length,1);Date.now=now;
    for(const name of Object.keys(calls)){
      gate=new Promise(r=>finish=r);const reached=new Promise(r=>entered=r);
      const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'killed-client',endpoint,'disposable',name],{stdio:['ignore','pipe','pipe','ipc']});
      const identity=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('child exited '+code)));});
      await Promise.race([reached,new Promise((_,reject)=>setTimeout(()=>reject(Error('native dispatch timeout')),5000).unref())]);
      const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
      await native.handleInitialize(init(clientId(),false));
      assert(native.getSessions().some(s=>s.clientInfo.name===identity.id));
      finish();await new Promise(resolve=>setTimeout(resolve,20));
      await native.handleInitialize(init(clientId(),false));
      assert(!native.getSessions().some(s=>s.clientInfo.name===identity.id));
      assert(native.getSessions().some(s=>s.clientInfo.name===stable));
    }
    assert.deepEqual(calls,{fixture_read:1,fixture_write:1});
    const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
    const {StreamableHTTPClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')));
    const nativeFactory=path.join(scratch,'native-factory.mjs');
    fs.writeFileSync(nativeFactory,createOwnerPolicyProtocol.toString()+'\n'+createMemoryOwnerClient.toString()
      .replace("'@modelcontextprotocol/sdk/client/index.js'",JSON.stringify(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href))
      .replace("'@modelcontextprotocol/sdk/client/streamableHttp.js'",JSON.stringify(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')).href))+'\nexport {createMemoryOwnerClient};');
    const configuration=JSON.parse(fs.readFileSync(config));configuration.owners.one.url=endpoint;fs.writeFileSync(config,JSON.stringify(configuration),{mode:0o600});
    const savedList=native.handleToolsList;
    native.handleToolsList=r=>({jsonrpc:'2.0',id:r.id,error:{code:-32603,message:'deliberate list failure'}});
    const failedNative=await (await import(pathToFileURL(nativeFactory))).createMemoryOwnerClient(moduleUrl);
    const initialCount=native.getSessions().length;
    await assert.rejects(failedNative.call('fixture_read'),/deliberate list failure/);
    native.handleToolsList=savedList;
    await native.handleInitialize(init(clientId(),false));
    assert.equal(native.getSessions().length,initialCount+1,'failed listTools session is retired at next initialize');
    await failedNative.close();
    const transport=()=>new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:'Bearer disposable'}}});
    const stableSdk=new Client({name:'persistent-sdk-fixture',version:'1'},{capabilities:{}});
    await stableSdk.connect(transport());
    const http=native.transports[0],dispatch=http.requestHandler;
    http.requestHandler=async r=>{const response=await dispatch(r);
      if(r.method==='tools/call'&&r.params.arguments?.loseResponse)http.server.closeAllConnections();
      return response;
    };
    let peak=0;
    for(let i=0;i<105;i++){
      const id=clientId(),client=new Client({name:id,version:'1'},{capabilities:{experimental:{[capability]:{version:1}}}});
      await client.connect(transport());
      const token=client.getServerCapabilities().experimental[capability].token;
      await client.listTools({_meta:{[capability]:{clientId:id,token}}});
      await assert.rejects(client.callTool({name:'fixture_write',arguments:{loseResponse:true},_meta:{[capability]:{clientId:id,token}}},undefined,{timeout:3000}));
      await client.close(); // No release notification, exactly like lost-response disposal.
      peak=Math.max(peak,native.getSessions().length);
    }
    assert(peak<10,'105 lost responses must not fill native maxSessions100');
    assert.equal(calls.fixture_write,106,'each uncertain write executes once, never replayed');
    assert((await stableSdk.listTools()).tools.some(tool=>tool.name==='fixture_write'));
    assert(native.getSessions().some(s=>s.clientInfo.name==='persistent-sdk-fixture'));
    await stableSdk.close();
    if(nativeCapacity){
      // Upstream #4682 fixes admission at capacity, not completion-aware disposal.
      // A superseded allocation can be evicted while its actual handler is held;
      // the handler still settles once. Keep that limit separate from the normal
      // one-call/persistent preservation checks above, which remain unchanged.
      const heldId=clientId(),heldInit=await native.handleInitialize(init(heldId));
      const heldToken=heldInit.result.capabilities.experimental[capability].token;
      gate=new Promise(r=>finish=r);const reached=new Promise(r=>entered=r);
      const before=calls.fixture_read;
      const pending=native.handleRequest(request(heldId,heldToken,'tools/call','fixture_read'));
      await reached;
      for(let i=0;i<102;i++)assert((await native.handleInitialize(init(clientId(),false))).result);
      assert(!native.getSessions().some(s=>s.clientInfo.name===heldId),'native capacity eviction is not pending-handler aware');
      assert(!native.getSessions().some(s=>s.clientInfo.name==='persistent-sdk-fixture'),'native capacity eviction does not preserve older persistent allocation identity');
      assert.equal(native.getSessions().length,100);
      finish();assert((await pending).result,'eviction does not turn the running handler into a failed write or replay');
      assert.equal(calls.fixture_read,before+1,'capacity pressure executes once');
    }
    await api.close();await native.stop();native.sessionManager.destroy();native=null;
    console.log('actual native HTTP+SDK: killed read/write and105lost-response clients retire after completion; persistent survives below capacity; native capacity eviction='+nativeCapacity);
  }
}finally{
  Date.now=now;if(native){await native.stop();native.sessionManager.destroy();}
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);
  fs.rmSync(scratch,{recursive:true,force:true});
}
console.log('native owner abandoned-session regression passed');
