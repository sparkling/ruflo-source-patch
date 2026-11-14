import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createMemoryOwnerClient } from '../lib/ruflo-memory-owner/runtime.mjs';
import { createOwnerInventoryContract } from '../lib/ruflo-memory-owner/inventory-contract.mjs';
import { createOwnerPolicyProtocol } from '../lib/ruflo-memory-owner/policy.mjs';
import { patchSource as patchHttp, reverse as reverseHttp, descriptor as httpDescriptor } from '../lib/ruflo-http-sessions/patcher.mjs';
import { proveSessionRecovery } from './ruflo-owner-session-recovery.mjs';
const capability = 'ruflo/native-memory-owner-one-call';
const clientId = () => 'ruflo-native-owner-client:' + randomUUID();
const init = (id, ephemeral = true) => ({ jsonrpc:'2.0',id:1,method:'initialize',params:{
  protocolVersion:'2025-11-25',clientInfo:{name:id,version:'1'},
  capabilities:ephemeral ? {experimental:{[capability]:{version:1}}}:{} } });
const request = (id, token, method = 'tools/call', name = 'fixture_read') => ({jsonrpc:'2.0',id:2,method,
  params:{name,arguments:{},_meta:{[capability]:{clientId:id,token}}} });
if (process.argv[2] === 'killed-client') {
  const [url, token, tool] = process.argv.slice(3), id = clientId();
  let httpSession;
  const post = async body => { const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...(httpSession?{'Mcp-Session-Id':httpSession}:{})},body:JSON.stringify(body)});httpSession=r.headers.get('mcp-session-id')??httpSession;return r.json(); };
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
async listTools(){if(state.mode==='list-fails')throw Error('list failed');return{tools:[{name:'memory_store',inputSchema:{properties:{nativeResult:{},requireNative:{},appendOnly:{},appendConditions:{},generateEmbeddingFlag:{}}}}]};}
async callTool(r){state.calls.push(r);if(state.mode==='received')return state.response;throw Error('response lost');}
async notification(r){state.calls.push(r);}async close(){state.closed=(state.closed||0)+1;}}
`);
  const factory=path.join(scratch,'factory.mjs'),sdkUrl=JSON.stringify(pathToFileURL(sdk).href);
  fs.writeFileSync(factory,createOwnerInventoryContract.toString() + '\n' + createOwnerPolicyProtocol.toString()+'\n'+createMemoryOwnerClient.toString().replace("'@modelcontextprotocol/sdk/client/index.js'",sdkUrl).replace("'@modelcontextprotocol/sdk/client/streamableHttp.js'",sdkUrl)+'\nexport {createMemoryOwnerClient};');
  const create=(await import(pathToFileURL(factory))).createMemoryOwnerClient;
  const state=(await import(pathToFileURL(sdk))).state;
  const failed=await create(moduleUrl);await assert.rejects(failed.call('memory_store'),/list failed/);
  assert.equal(state.calls[0].method,'notifications/ruflo/memory-owner-release');
  assert.equal(state.calls[0].params.token,'00000000-0000-4000-8000-000000000001');
  assert.equal(state.options.capabilities.experimental[capability].version,1);
  // A received response proves one-call completion even when decode refuses it.
  // Preserve the native refusal/invalid-result error without another release.
  for(const [response,canonical,error] of [
    [{content:[{type:'text',text:'{"success":true}'}]},false,null],
    [{isError:true,content:[{type:'text',text:'{"error":"fixture refusal"}'}]},false,/Native memory owner refused: fixture refusal/],
    [{content:[{type:'text',text:'{"value":1}'}]},true,/invalid canonical result/],
    [{content:[{type:'text',text:'{broken'}]},false,/invalid JSON/],
  ]){
    state.calls=[];state.closed=0;state.mode='received';state.response=response;
    const received=await create(moduleUrl);
    if(error)await assert.rejects(received.call('memory_store',{}, {},canonical),error);
    else assert.deepEqual(await received.call('memory_store'),{success:true});
    assert.equal(state.calls.length,1,'received one-call response never sends redundant release');
    assert.equal(state.calls[0].name,'memory_store');assert.equal(state.closed,1,'received response closes transport');
    await received.close();assert.equal(state.closed,1,'close does not retire a completed call twice');
  }
  state.calls=[];state.mode='lost';const uncertain=await create(moduleUrl);
  await assert.rejects(uncertain.call('memory_store'),/response lost/);
  assert.equal(state.calls.length,1);assert.equal(state.calls[0].name,'memory_store');
  assert(state.calls[0]._meta[capability].token,'server can attribute completion despite client uncertainty');
  state.calls=[];const pooled=await create(moduleUrl);
  await assert.rejects(pooled.call('memory_store',{}, {sessionId:'persistent'}),/response lost/);
  assert.deepEqual(state.options.capabilities,{});assert.equal(state.calls[0]._meta,undefined);

  if(process.env.RSP_OWNER_NATIVE_ROOT){
    const require=createRequire(path.join(process.env.RSP_OWNER_NATIVE_ROOT,'package.json'));
    const nativeRoot=path.resolve(require.resolve('@claude-flow/mcp'),'../..'), staged=path.join(scratch,'native-mcp');
    fs.cpSync(path.join(nativeRoot,'dist'),path.join(staged,'dist'),{recursive:true});
    fs.copyFileSync(path.join(nativeRoot,'package.json'),path.join(staged,'package.json'));
    const nativeRequire=createRequire(path.join(nativeRoot,'package.json'));
    for(const dependency of Object.keys(JSON.parse(fs.readFileSync(path.join(nativeRoot,'package.json'))).dependencies ?? { ajv:1, cors:1, express:1, 'express-rate-limit':1, helmet:1, ws:1 })) {
      let resolved=path.dirname(nativeRequire.resolve(dependency));
      while(!fs.existsSync(path.join(resolved,'package.json')) || JSON.parse(fs.readFileSync(path.join(resolved,'package.json'))).name!==dependency) {
        const parent=path.dirname(resolved);assert.notEqual(parent,resolved);resolved=parent;
      }
      const link=path.join(staged,'node_modules',dependency);fs.mkdirSync(path.dirname(link),{recursive:true});fs.symlinkSync(resolved,link);
    }
    for(const relative of ['server.js','transport/http.js']) {
      const file=path.join(staged,'dist',relative), source=fs.readFileSync(file,'utf8'), candidate=patchHttp(source);
      assert.deepEqual(candidate.missing,[]);assert.equal(reverseHttp(candidate.next),source);
      assert.equal(patchHttp(candidate.next).next,candidate.next);fs.writeFileSync(file,candidate.next);
      const prior=httpDescriptor.historicalPatchSource(source).next;
      assert.equal(patchHttp(prior).next,candidate.next,'exact released HTTP revision upgrades');
      assert.equal(reverseHttp(prior),source,'released HTTP revision restores pristine');
      if(relative==='server.js'){
        assert.equal(httpDescriptor.isPatched(prior),false);
        assert(patchHttp(prior.replace('scope.session = session;','scope.session = undefined;')).missing.length,
          'unknown changes to the prior boundary are refused');
      }
    }
    const installRoot=path.join(scratch,'global/@claude-flow/mcp');
    fs.mkdirSync(path.join(installRoot,'dist/transport'),{recursive:true});
    fs.copyFileSync(path.join(nativeRoot,'package.json'),path.join(installRoot,'package.json'));
    for(const file of ['server.js','transport/http.js'])fs.copyFileSync(path.join(nativeRoot,'dist',file),path.join(installRoot,'dist',file));
    fs.mkdirSync(path.join(scratch,'home/.claude'),{recursive:true});fs.writeFileSync(path.join(scratch,'home/.claude/settings.json'),'{}');
    const cli=action=>spawnSync(process.execPath,[fileURLToPath(new URL('../bin/cli.mjs',import.meta.url)),'ruflo-http-sessions',action],
      {encoding:'utf8',timeout:30000,env:{...process.env,RUFLO_SOURCE_PATCH_HOME:path.join(scratch,'home'),RUFLO_GLOBAL_ROOT:path.join(scratch,'global'),RUFLO_NPX_ROOT:path.join(scratch,'npx'),
        RSP_NO_SELF_UPDATE:'1',RSP_NO_MONITOR_RECOVER:'1',RSP_NO_LAUNCHCTL:'1',RSP_NO_STALE_WRITER_KILL:'1',RSP_NO_HOST_AUTO_UPDATE:'1'}});
    const firstInstall=cli('install');assert.equal(firstInstall.status,0,firstInstall.stdout+firstInstall.stderr);assert.match(firstInstall.stdout,/patched: 2/);
    const status=cli('status');assert.equal(status.status,0,status.stdout+status.stderr);assert.match(status.stdout,/2\/2 file\(s\) patched/);
    assert.equal(cli('install').status,0);
    const previousServer=path.join(installRoot,'dist/server.js');
    fs.writeFileSync(previousServer,httpDescriptor.historicalPatchSource(fs.readFileSync(previousServer+'.rsp-backup','utf8')).next);
    assert.equal(cli('install').status,0,'installed historical HTTP source upgrades through exact composition');
    assert(httpDescriptor.isPatched(fs.readFileSync(previousServer,'utf8')));
    for(const file of ['server.js','transport/http.js'])assert.equal(fs.readFileSync(path.join(installRoot,'dist',file)+'.rsp-backup','utf8'),fs.readFileSync(path.join(nativeRoot,'dist',file),'utf8'));
    const uninstall=cli('uninstall');assert.equal(uninstall.status,0,uninstall.stdout+uninstall.stderr);
    for(const file of ['server.js','transport/http.js'])assert.equal(fs.readFileSync(path.join(installRoot,'dist',file),'utf8'),fs.readFileSync(path.join(nativeRoot,'dist',file),'utf8'));
    fs.unlinkSync(path.join(installRoot,'dist/transport/http.js'));
    assert.notEqual(cli('install').status,0,'missing companion surface refuses whole target');
    assert.equal(fs.readFileSync(path.join(installRoot,'dist/server.js'),'utf8'),fs.readFileSync(path.join(nativeRoot,'dist/server.js'),'utf8'));
    if (process.env.RSP_OWNER_NATIVE_SRC || fs.existsSync(path.join(process.env.RSP_OWNER_NATIVE_ROOT,'dist/src/services'))) {
      const policy=spawnSync(process.execPath,[fileURLToPath(new URL('./ruflo-owner-policy.mjs',import.meta.url))],
        {encoding:'utf8',timeout:60000,env:{...saved,RSP_OWNER_MCP_ENTRY:path.join(staged,'dist/index.js')}});
      assert.equal(policy.status,0,policy.stdout+policy.stderr);console.log('staged HTTP native authorization/cancellation fixture passed');
    }
    const {MCPServer}=await import(pathToFileURL(path.join(staged,'dist/index.js')).href);
    const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
    const {StreamableHTTPClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')));
    const warnings=[],logger={debug(){},info(){},warn(message,fields){warnings.push({message,fields});},error(){}};
    native=new MCPServer({transport:'http',host:'127.0.0.1',port:0,auth:{enabled:true,method:'token',tokens:['disposable','other-principal']},
      rateLimit:{windowMs:60000,limit:1200},sessionRateLimit:{requestsPerSecond:100,burstSize:1000,perSessionLimit:500}},logger);
    const api=await attach(native);let gate,finish,entered;
    const calls={fixture_read:0,fixture_write:0};
    for(const name of Object.keys(calls))native.registerTool({name,description:'Disposable lifecycle boundary',inputSchema:{type:'object',properties:{}},handler:async()=>{calls[name]++;entered();await gate;return{success:true};}});
    await native.start();const endpoint='http://127.0.0.1:'+native.transports[0].server.address().port+'/mcp';
    let sessionCalls=0;
    const sessionTool={name:'fixture_session',description:'Read native session identity',inputSchema:{type:'object',properties:{}},
      handler:async(_args,context)=>{sessionCalls++;const before=context.sessionId;await new Promise(resolve=>setImmediate(resolve));return{before,after:context.sessionId};}};
    native.registerTool(sessionTool);
    const sdk=async(label,token='disposable',oneCall=false)=>{
      const transport=new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:'Bearer '+token,Connection:'close'}}});
      const client=new Client({name:label,version:'1'},{capabilities:oneCall?{experimental:{[capability]:{version:1}}}:{}});await client.connect(transport);return{client,transport};
    };
    const [a,b,c]=await Promise.all([sdk('session-a'),sdk('session-b','other-principal'),sdk('session-a-sibling')]);
    const ephemeralId=clientId(), e=await sdk(ephemeralId,'disposable',true);
    const disposal=e.client.getServerCapabilities().experimental[capability];
    const attributed={name:'fixture_session',arguments:{},_meta:{[capability]:{clientId:ephemeralId,token:disposal.token}}};
    for(const wrong of [b,c])await assert.rejects(wrong.client.callTool(attributed),/Invalid/);
    const wrongRelease=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer disposable','Mcp-Session-Id':c.transport.sessionId},
      body:JSON.stringify({jsonrpc:'2.0',method:'notifications/ruflo/memory-owner-release',params:{clientId:ephemeralId,token:disposal.token}})});
    assert.equal(wrongRelease.status,500);await wrongRelease.arrayBuffer();
    const diagnostic=warnings.find(row=>row.message==='Native HTTP notification rejected');
    assert.deepEqual(diagnostic?.fields,{method:'notifications/ruflo/memory-owner-release',reason:'Invalid one-call owner retirement'});
    assert(!JSON.stringify(diagnostic).includes(disposal.token),'notification diagnostic excludes token/body');
    assert.equal(sessionCalls,0,'foreign session cannot dispatch or release a one-call token');
    await e.client.callTool(attributed);assert.equal(sessionCalls,1,'own token executes once after alien attempts');
    await e.client.close();native.terminateSession(e.transport.sessionId);
    const aId=a.transport.sessionId,bId=b.transport.sessionId;
    assert(aId&&bId&&c.transport.sessionId);assert.equal(new Set([aId,bId,c.transport.sessionId]).size,3,'same and different principals receive distinct native session IDs');
    const value=response=>JSON.parse(response.content.find(row=>row.type==='text').text);
    for(let batch=0;batch<6;batch++)await Promise.all([a,b,c,a].map(async client=>{
      const result=value(await client.client.callTool({name:'fixture_session',arguments:{}}));
      assert.deepEqual(result,{before:client.transport.sessionId,after:client.transport.sessionId});
    }));
    assert.equal(native.getSessions().length,3,'warm calls do not allocate new native sessions');
    const raw=async(body,{id,token='disposable',url=endpoint}={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,Connection:'close',...(id?{'Mcp-Session-Id':id}:{})},body:JSON.stringify(body)});
    const read={jsonrpc:'2.0',id:31,method:'tools/call',params:{name:'fixture_session',arguments:{}}};
    const beforeRefusals=sessionCalls;
    for(const [options,status]of [[{id:aId,token:'other-principal'},404],[{id:'unknown-native-session'},404],[{},400],[{id:aId,token:'invalid'},401]]) {
      const response=await raw(read,options);assert.equal(response.status,status);await response.arrayBuffer();
    }
    assert.equal(sessionCalls,beforeRefusals,'missing/stolen/unknown/unauthenticated session never dispatches');
    // Retained HTTP+SSE binds its native session to its authenticated connection.
    const abortSse=new AbortController();
    const stream=await fetch(endpoint,{headers:{Authorization:'Bearer disposable'},signal:abortSse.signal});
    const reader=stream.body.getReader(),first=new TextDecoder().decode((await reader.read()).value);
    const legacyUrl=new URL(first.match(/data: (.+)/)[1],endpoint).href;
    const legacyInit=await raw(init(clientId(),false),{url:legacyUrl});
    assert.equal(legacyInit.status,202);const legacyId=legacyInit.headers.get('mcp-session-id');assert(legacyId);await legacyInit.arrayBuffer();
    const legacyRead=await raw(read,{url:legacyUrl});assert.equal(legacyRead.status,202);await legacyRead.arrayBuffer();
    const alien=await raw(read,{url:legacyUrl,token:'other-principal'});assert.equal(alien.status,404);await alien.arrayBuffer();
    abortSse.abort();await reader.cancel().catch(()=>{});
    native.terminateSession(aId);
    const beforeExpired=sessionCalls;await assert.rejects(a.client.callTool({name:'fixture_session',arguments:{}}),error=>error.code===404);
    assert.equal(sessionCalls,beforeExpired,'expired-session call cannot execute');
    await a.client.close();await b.client.close();await c.client.close();
    for(const session of native.getSessions())native.terminateSession(session.id);
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
    const nativeFactory=path.join(scratch,'native-factory.mjs');
    fs.writeFileSync(nativeFactory,createOwnerInventoryContract.toString() + '\n' + createOwnerPolicyProtocol.toString()+'\n'+createMemoryOwnerClient.toString()
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
    // Complete the one-call handler, then initialize its successor before the
    // first response reaches the client. Server retirement has already won.
    const releasedFactory=path.join(scratch,'released-factory.mjs');
    const released=JSON.parse(fs.readFileSync(new URL('../lib/ruflo-memory-owner/released-4.46.134.json',import.meta.url),'utf8')).runtime;
    fs.writeFileSync(releasedFactory,released
      .replace("'@modelcontextprotocol/sdk/client/index.js'",JSON.stringify(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href))
      .replace("'@modelcontextprotocol/sdk/client/streamableHttp.js'",JSON.stringify(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')).href))
      .replace('export const rspMemoryOwner = await createMemoryOwnerClient(import.meta.url);','export {createMemoryOwnerClient};'));
    await proveSessionRecovery({ native, create:(await import(pathToFileURL(nativeFactory))).createMemoryOwnerClient,
      createReleased:(await import(pathToFileURL(releasedFactory))).createMemoryOwnerClient, moduleUrl, config });
    for(const [label,factory,expectedPosts]of [['released-4.46.134',releasedFactory,1],['candidate',nativeFactory,0]]){
    const raceHttp=native.transports[0],raceDispatch=raceHttp.requestHandler,raceNotify=raceHttp.notificationHandler;
    const raceWarnings=[],savedError=console.error;let successor,retiredSession,releasePosts=0;
    const raceClient=await (await import(pathToFileURL(factory))).createMemoryOwnerClient(moduleUrl);
    raceHttp.requestHandler=async(r,context)=>{
      const response=await raceDispatch(r,context);
      if(r.method==='tools/call'&&r.params.name==='fixture_read'){
        retiredSession=context.sessionId;
        assert(native.getSessions().some(session=>session.id===retiredSession));
        successor=await sdk('retirement-race-successor');
        assert(!native.getSessions().some(session=>session.id===retiredSession),'successor removes completed one-call session before response delivery');
      }
      return response;
    };
    raceHttp.notificationHandler=(r,context)=>{
      if(r.method==='notifications/ruflo/memory-owner-release')releasePosts++;
      return raceNotify(r,context);
    };
    const beforeRace=calls.fixture_read;console.error=value=>raceWarnings.push(String(value));
    try{
      assert.deepEqual(await raceClient.call('fixture_read'),{success:true});
      assert(retiredSession);assert.equal(calls.fixture_read,beforeRace+1,'completed read is never replayed');
      console.log(JSON.stringify({retirementInterleaving:label,releasePosts,warnings:raceWarnings,executions:calls.fixture_read-beforeRace}));
      assert.equal(releasePosts,expectedPosts,'received one-call result needs no redundant retirement POST');
      if(expectedPosts){assert.equal(raceWarnings.length,1);assert.match(raceWarnings[0],/-32002.*HTTP session is absent, expired or belongs to another principal/);}
      else assert.deepEqual(raceWarnings,[],'completed server retirement is not reported as unavailable');
      assert(native.getSessions().some(session=>session.id===successor.transport.sessionId),'successor remains live');
    }finally{
      console.error=savedError;raceHttp.requestHandler=raceDispatch;raceHttp.notificationHandler=raceNotify;
      await raceClient.close();if(successor){await successor.client.close();native.terminateSession(successor.transport.sessionId);}
    }
    }
    const transport=()=>new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:'Bearer disposable'}}});
    const stableSdk=new Client({name:'persistent-sdk-fixture',version:'1'},{capabilities:{}});
    await stableSdk.connect(transport());
    const http=native.transports[0],dispatch=http.requestHandler;
    http.requestHandler=async (r,context)=>{const response=await dispatch(r,context);
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
    const retained=await sdk('restart-retained');
    const priorId=retained.transport.sessionId;await retained.client.callTool({name:'fixture_session',arguments:{}});
    const restartClient=await (await import(pathToFileURL(nativeFactory))).createMemoryOwnerClient(moduleUrl);
    const restartBefore=await restartClient.call('fixture_session',{}, {sessionId:'restart-cached'});
    const port=native.transports[0].server.address().port;
    await api.close();await native.stop();native.sessionManager.destroy();
    native=new MCPServer({transport:'http',host:'127.0.0.1',port,auth:{enabled:true,method:'token',tokens:['disposable']}},logger);
    const replacementApi=await attach(native);native.registerTool(sessionTool);await native.start();
    const beforeRestartRead=sessionCalls;
    await assert.rejects(retained.client.callTool({name:'fixture_session',arguments:{}}),error=>error.code===404);
    assert.equal(sessionCalls,beforeRestartRead,'old process ID is refused before handler execution');
    await retained.client.close();
    const reinitialized=await sdk('restart-retained');assert.notEqual(reinitialized.transport.sessionId,priorId);
    const recovered=value(await reinitialized.client.callTool({name:'fixture_session',arguments:{}}));
    assert.equal(recovered.before,reinitialized.transport.sessionId);assert.equal(sessionCalls,beforeRestartRead+1);
    const automaticallyRecovered=await restartClient.call('fixture_session',{}, {sessionId:'restart-cached'});
    assert.notEqual(automaticallyRecovered.before,restartBefore.before);
    assert.equal(sessionCalls,beforeRestartRead+2,'cached owner client reinitializes and dispatches once after server restart');
    await restartClient.close();
    await reinitialized.client.close();await replacementApi.close();await native.stop();native.sessionManager.destroy();native=null;
    console.log('HTTP session regression: two-principal isolation, 24 interleaved calls, SSE binding, auth/expiry refusals, restart 404, cached owner recovery; no uncertain replay');
    console.log('actual native HTTP+SDK: killed read/write and105lost-response clients retire after completion; persistent survives below capacity; native capacity eviction='+nativeCapacity);
  }
}finally{
  Date.now=now;if(native){await native.stop();native.sessionManager.destroy();}
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);
  fs.rmSync(scratch,{recursive:true,force:true});
}
console.log('native owner abandoned-session regression passed');
