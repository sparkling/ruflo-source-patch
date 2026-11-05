// Actual native HTTP + SDK and native durable policy; only the final storage
// handler is a disposable double. Never opens a managed memory database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createMemoryOwnerClient } from '../lib/ruflo-memory-owner/runtime.mjs';
import { createOwnerPolicyProtocol } from '../lib/ruflo-memory-owner/policy.mjs';
import { patchSource } from '../lib/ruflo-memory-owner/patcher.mjs';
const nativeRoot = process.env.RSP_OWNER_NATIVE_ROOT;
if (!nativeRoot) { console.log('owner policy HTTP: set RSP_OWNER_NATIVE_ROOT for native integration'); process.exit(0); }
const src = process.env.RSP_OWNER_NATIVE_SRC || path.join(nativeRoot, 'dist/src');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-owner-policy-'));
const cwd = process.cwd(), saved = { ...process.env };
let server, client, owner, sdk;
try {
  for (const key of Object.keys(process.env)) if (/^CLAUDE_FLOW_(PRINCIPAL|CAPABILITY|MCP_|POLICY_|DB_PATH)/.test(key)) delete process.env[key];
  process.env.HOME = path.join(scratch, 'home'); fs.mkdirSync(process.env.HOME);
  process.env.XDG_CONFIG_HOME = path.join(scratch, 'config');
  process.env.RSP_POLICY_DIAGNOSTICS = 'off';
  fs.mkdirSync(path.join(scratch, 'project')); const root = fs.realpathSync(path.join(scratch, 'project')); process.chdir(root);
  const pkg = path.join(scratch, 'native'); fs.mkdirSync(path.join(pkg, 'services'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'mods'));
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(nativeRoot, 'node_modules'), path.join(pkg, 'node_modules'));
  for (const file of fs.readdirSync(path.join(src, 'services')).filter(name => name.startsWith('policy') && name.endsWith('.js')))
    fs.copyFileSync(path.join(src, 'services', file), path.join(pkg, 'services', file));
  fs.copyFileSync(path.join(src, 'mods/policy-projection.js'), path.join(pkg, 'mods/policy-projection.js'));
  const policyFile = path.join(pkg, 'services/policy-runtime.js');
  const policyPatch = patchSource(fs.readFileSync(policyFile, 'utf8')); assert.deepEqual(policyPatch.missing, []);
  fs.writeFileSync(policyFile, policyPatch.next);
  // The token parser is already independently tested; this fixture uses one
  // disposable bearer. Transport authentication remains native MCPServer.
  fs.writeFileSync(path.join(pkg, 'mcp-server.js'), "export const resolveMcpHttpAuthToken=()=> 'disposable';");
  fs.writeFileSync(path.join(pkg, 'factory.mjs'), createOwnerPolicyProtocol.toString() + '\n' + createMemoryOwnerClient.toString() + '\nexport { createMemoryOwnerClient, createOwnerPolicyProtocol };');
  const factory = await import(pathToFileURL(path.join(pkg, 'factory.mjs')));
  const moduleUrl = pathToFileURL(path.join(pkg, 'mcp-client.js')).href;
  const native = await import(pathToFileURL(policyFile));
  const req = createRequire(path.join(nativeRoot, 'package.json'));
  const { MCPServer } = await import(pathToFileURL(process.env.RSP_OWNER_MCP_ENTRY || req.resolve('@claude-flow/mcp')));
  const { Client } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/index.js')));
  const { StreamableHTTPClientTransport } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')));
  const tokenFile = path.join(scratch, 'token'), config = path.join(scratch, 'owners.json');
  fs.writeFileSync(tokenFile, 'disposable', { mode: 0o600 });
  const configuration = { version: 1, owners: { one: { cwd: root, pin: null, url: 'http://127.0.0.1:19872/mcp', tokenFile } }, contexts: [{ cwd: root, pin: null, owner: 'one' }], stores: [] };
  const writeConfig = () => fs.writeFileSync(config, JSON.stringify(configuration), { mode: 0o600 });
  writeConfig(); process.env.RUFLO_MEMORY_OWNER_CONFIG = config;
  server = new MCPServer({ transport: 'http', host: '127.0.0.1', port: 0,
    auth: { enabled: true, method: 'token', tokens: ['disposable'] },
    rateLimit: { windowMs: 60000, limit: 1000 }, sessionRateLimit: { requestsPerSecond: 1000, burstSize: 1000, perSessionLimit: 1000 } }, { debug(){}, info(){}, warn(){}, error(){} });
  owner = await factory.createMemoryOwnerClient(moduleUrl); await owner.enterServerMode(root); owner.attachServer(server);
  client = await factory.createMemoryOwnerClient(moduleUrl);
  assert(fs.readFileSync(path.join(src, 'mcp-server.js'), 'utf8').includes("{ sessionId: context?.sessionId || fallbackSessionId, transport: this.options.transport === 'websocket' ? 'websocket' : 'http' }"), 'qualified native HTTP context');
  const source = patchSource(fs.readFileSync(path.join(src, 'mcp-client.js'), 'utf8')).next;
  const start = source.indexOf('export async function callMCPTool(');
  const body = source.slice(start, source.indexOf('\n}\n', start) + 2).replace('export async function', 'return async function');
  let executed = 0;
  const registry = new Map([['memory_retrieve', { handler: async () => ({ success: true, invocation: ++executed }) }]]);
  const explicitReads = ['memory_list', 'memory_stats', 'memory_export', 'memory_search', 'memory_retrieve'], routed = [];
  let heldEntered, heldRelease, heldDone, heldSession;
  for (const name of explicitReads) registry.set(name, { handler: async (input, context) => {
    if (name === 'memory_retrieve' && input.dbPath === undefined) return { success: true, invocation: ++executed };
    if (input.namespace === 'held-inventory') {
      heldSession=context.sessionId;heldEntered();await new Promise(resolve=>{heldRelease=resolve;});heldDone();
    }
    routed.push({ name, input }); return { success: true, dbPath: input.dbPath };
  } });
  const dispatch = api => new Function('TOOL_REGISTRY', 'MCPClientError', 'authorizeMcpTool', 'classifyMcpTool', 'rspMemoryOwner', 'applyContentBoundaryGuardrail', body)(registry, Error, native.authorizeMcpTool, native.classifyMcpTool, api, (_name, value) => value);
  const receiver = dispatch(owner), caller = dispatch(client);
  // This is the exact native cliTools context construction. Native MCPServer
  // receives _meta on the wire, and the attached owner handles its scope.
  for (const name of explicitReads) server.registerTool({ name, description: 'Explicit store fixture',
    inputSchema: { type: 'object', properties: { dbPath: { type: 'string' }, namespace: { type: 'string' }, key: { type: 'string' }, query: { type: 'string' } } },
    handler: (input, context) => receiver(name, input, { sessionId: context?.sessionId || 'fixture-http', transport: 'http' }) });
  await server.start(); configuration.owners.one.url = 'http://127.0.0.1:' + server.transports[0].server.address().port + '/mcp'; writeConfig();
  sdk = new Client({ name: 'fixture-direct', version: '1' }, { capabilities: {} });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(configuration.owners.one.url), { requestInit: { headers: { Authorization: 'Bearer disposable' } } }));
  const input = { namespace: 'fixture', key: 'one' }, context = { transport: 'stdio', approvalIds: ['once'] };
  const state = () => native.loadPolicyState(root);
  const count = () => state().receipts.length;
  await caller('memory_retrieve', input, { transport: 'stdio' });
  assert.equal(count(), 1, 'default legacy forwarding has exactly one durable decision');
  assert.equal(executed, 1);
  // Fixed-store read facades explicitly select one store while the same-project
  // owner serves multiple stores. The original path and native policy must agree.
  const pinnedStore = path.join(root, '.swarm', 'agentdb-memory.db');
  configuration.stores.push({ dbPath: pinnedStore, owner: 'one' }); writeConfig();
  process.env.CLAUDE_FLOW_DB_PATH = pinnedStore;
  for (const name of explicitReads) {
    const selected = { dbPath: pinnedStore, namespace: 'fixture' }, priorCount = count();
    const result = await client.tryForward(name, selected, { transport: 'stdio' });
    assert.equal(result.forwarded, true, name + ' explicit pinned read qualifies');
    assert.deepEqual(result.result, { success: true, dbPath: pinnedStore });
    assert.equal(count(), priorCount + 1, name + ' keeps one authoritative durable decision');
    assert.deepEqual(routed.at(-1), { name, input: selected }, 'selected store and selectors cross the wire unchanged');
    assert.equal(state().receipts.at(-1).payload.request.action.type, native.classifyMcpTool(name).actionType,
      'export retains its native action classification');
  }
  // An authenticated direct HTTP read with the default native caller has the
  // same request as the source-bound stdio projection. This proves policy data
  // equivalence only: external adapters must still qualify identity/lifecycle.
  const directProtocol = await factory.createOwnerPolicyProtocol(moduleUrl);
  for (const name of explicitReads) {
    const selected = { dbPath: pinnedStore, namespace: 'fixture' };
    const projected = await directProtocol.project(name, selected, { transport:'stdio' }, configuration.owners.one);
    const priorCount = count(), priorRouted = routed.length;
    const direct = await sdk.callTool({ name, arguments:selected });
    assert(!direct.isError); assert.equal(count(), priorCount + 1); assert.equal(routed.length, priorRouted + 1);
    assert.deepEqual(routed.at(-1), { name, input:selected });
    const request = structuredClone(state().receipts.at(-1).payload.request);
    delete request.requestId; delete request.context.now;
    assert.deepEqual(request, JSON.parse(JSON.stringify(projected.request)), 'default direct HTTP read retains complete native policy request');
  }
  // A Product/service process lives outside the source cwd. Its fixed reader
  // still constructs the source request natively, with verified one-call HTTP.
  const facade = path.join(scratch, 'facade'); fs.mkdirSync(facade);
  const beforeFacade = count(), beforeFacadeRouted = routed.length;
  const childSource = `
    import assert from 'node:assert/strict';
    import {createMemoryOwnerClient} from ${JSON.stringify(pathToFileURL(path.join(pkg,'factory.mjs')).href)};
    delete process.env.CLAUDE_FLOW_DB_PATH;
    const api=await createMemoryOwnerClient(${JSON.stringify(moduleUrl)});
    const root=${JSON.stringify(root)}, dbPath=${JSON.stringify(pinnedStore)};
    const reader=await api.openInventoryReader({root,dbPath});
    assert.equal(reader.registry.length,3);
    const read=(name,args,options)=>reader.client.callTool({name,arguments:args},undefined,options);
    for(const [name,args] of [['memory_store',{dbPath}],['agentdb_pattern-search',{dbPath}],
      ['memory_list',{dbPath:root+'/foreign.db'}],['memory_list',Object.create({dbPath})],
      ['memory_list',{dbPath,toJSON(){return{dbPath:root+'/foreign.db'}}}]]) await assert.rejects(read(name,args));
    process.env.CLAUDE_FLOW_PRINCIPAL_ID='changed';await assert.rejects(read('memory_stats',{dbPath}));delete process.env.CLAUDE_FLOW_PRINCIPAL_ID;
    process.env.CLAUDE_FLOW_DB_PATH=root+'/foreign.db';await assert.rejects(read('memory_stats',{dbPath}));delete process.env.CLAUDE_FLOW_DB_PATH;
    const aborted=new AbortController();aborted.abort();await assert.rejects(read('memory_stats',{dbPath},{signal:aborted.signal}));
    const pending=Array.from({length:4},(_,i)=>read('memory_list',{dbPath,namespace:'parallel-'+i}));
    await assert.rejects(read('memory_stats',{dbPath}),/concurrency bound/);
    await Promise.all(pending);await reader.client.close();
    await assert.rejects(read('memory_stats',{dbPath}),/closed/);await api.close();
  `;
  const facadeRun = spawn(process.execPath, ['--input-type=module','-e',childSource], {cwd:facade,env:process.env,stdio:['ignore','pipe','pipe']});
  let facadeOutput='';for(const stream of [facadeRun.stdout,facadeRun.stderr])stream.on('data',data=>{facadeOutput+=data;});
  const facadeExit = await new Promise(resolve=>facadeRun.on('close',resolve));
  assert.equal(facadeExit,0,facadeOutput);assert.equal(count(),beforeFacade+4);assert.equal(routed.length,beforeFacadeRouted+4);
  for(const {name,input:selected} of routed.slice(-4)) {
    const projected=await directProtocol.project(name,selected,{transport:'stdio'},configuration.owners.one);
    const receipt=state().receipts.slice(-4).find(row=>row.payload.request.action.namespace===selected.namespace);
    const request=structuredClone(receipt.payload.request);delete request.requestId;delete request.context.now;
    assert.deepEqual(request,JSON.parse(JSON.stringify(projected.request)),'cross-cwd reader retains exact native source request');
  }
  // Cancelling an acquisition after native allocation may not leak its late
  // initialized session, and must never dispatch a read afterward.
  const beforeAcquisition=count(), originalInitialize=server.handleInitialize;
  let initialized, releaseInitialize, allocatedClient;
  const allocated=new Promise(resolve=>{initialized=resolve;});
  server.handleInitialize=async request=>{
    const result=await originalInitialize(request);allocatedClient=request.params.clientInfo.name;
    initialized();await new Promise(resolve=>{releaseInitialize=resolve;});return result;
  };
  const acquisitionAbort=new AbortController();
  const acquisition=client.openInventoryReader({root,dbPath:pinnedStore,signal:acquisitionAbort.signal});
  await allocated;acquisitionAbort.abort(new Error('acquisition cancelled'));releaseInitialize();
  await assert.rejects(acquisition,/acquisition cancelled/);server.handleInitialize=originalInitialize;
  assert.equal(count(),beforeAcquisition,'late initialization never dispatches a read');
  let sweep=await client.openInventoryReader({root,dbPath:pinnedStore});await sweep.client.close();
  assert(!server.getSessions().some(session=>session.clientInfo.name===allocatedClient),'late allocated session retired');
  server.handleInitialize=request=>{
    const older=structuredClone(request);delete older.params.capabilities.experimental['ruflo/native-memory-owner-one-call'];
    return originalInitialize(older);
  };
  await assert.rejects(client.openInventoryReader({root,dbPath:pinnedStore}),/one-call retirement/);
  assert.equal(count(),beforeAcquisition,'older owner without safe disposal cannot dispatch inventory reads');
  server.handleInitialize=originalInitialize;
  const lifetimeAbort=new AbortController(), beforeLifetime=count();
  const lifetimeReader=await client.openInventoryReader({root,dbPath:pinnedStore,signal:lifetimeAbort.signal});
  lifetimeAbort.abort(Error('reader lifetime cancelled'));
  await assert.rejects(lifetimeReader.client.callTool({name:'memory_stats',arguments:{dbPath:pinnedStore}}),/reader lifetime cancelled/);
  await lifetimeReader.client.close();assert.equal(count(),beforeLifetime,'reader lifetime abort prevents dispatch without call options');
  for(const cancel of [false,true]) {
    const abort=new AbortController(), reader=await client.openInventoryReader({root,dbPath:pinnedStore,signal:abort.signal});
    const entered=new Promise(resolve=>{heldEntered=resolve;}), done=new Promise(resolve=>{heldDone=resolve;});
    const pending=reader.client.callTool({name:'memory_list',arguments:{dbPath:pinnedStore,namespace:'held-inventory'}});
    await entered;
    if(cancel) { abort.abort(new Error('held read cancelled'));await assert.rejects(pending,/held read cancelled/); }
    let closed=false;const closing=reader.client.close().then(()=>{closed=true;});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(closed,cancel,'close awaits pending client requests; cancellation is not proof of server completion');
    await assert.rejects(reader.client.callTool({name:'memory_stats',arguments:{dbPath:pinnedStore}}),/closed/);
    sweep=await client.openInventoryReader({root,dbPath:pinnedStore});await sweep.client.close();
    assert(server.getSessions().some(session=>session.id===heldSession),'native pending handler survives another initialization');
    heldRelease();await done;if(!cancel)await pending;await closing;await new Promise(resolve=>setImmediate(resolve));
    sweep=await client.openInventoryReader({root,dbPath:pinnedStore});await sweep.client.close();
    assert(!server.getSessions().some(session=>session.id===heldSession),'settled one-call handler retires without replay');
  }
  for (const [name, args] of [
    ['memory_list', {}], ['memory_list', { dbPath: '.swarm/agentdb-memory.db' }],
    ['memory_retrieve', {}], ['memory_search', {}],
    ['memory_store', { dbPath: pinnedStore }], ['memory_index_status', { dbPath: pinnedStore }],
    ['agentdb_pattern-search', { dbPath: pinnedStore }],
    ['memory_list', { dbPath: pinnedStore, provenanceFilter: [] }],
  ]) assert.equal((await client.tryForward(name, args)).forwarded, false, 'other default-store contracts remain separate');
  for (const args of [Object.create({ dbPath: pinnedStore }),
    Object.defineProperty({}, 'dbPath', { value: pinnedStore }),
    Object.defineProperty({}, 'dbPath', { enumerable: true, get: () => pinnedStore })])
    assert.equal((await client.tryForward('memory_list', args)).forwarded, false, 'selected store must survive the wire as an own data field');
  await assert.rejects(client.tryForward('memory_list', { dbPath: path.join(root, 'foreign.db') },
    { transport: 'stdio' }), /configured MCP client authority/);
  assert.equal((await client.tryForward('memory_list', { dbPath: pinnedStore }, { environment: 'other' })).forwarded, false);
  configuration.owners.one.pin = path.join(root, 'different.db'); writeConfig();
  await assert.rejects(client.tryForward('memory_list', { dbPath: pinnedStore }), /conflicts with configured owner authority/);
  configuration.owners.one.pin = null; configuration.owners.one.cwd = scratch; writeConfig();
  assert.equal((await client.tryForward('memory_list', { dbPath: pinnedStore })).forwarded, false, 'explicit store does not merge policy roots');
  configuration.owners.one.cwd = root; writeConfig();
  const nativeHandle = server.handleRequest;
  server.handleRequest = async request => {
    const response = structuredClone(await nativeHandle.call(server, request));
    if (request.method === 'tools/list') for (const tool of response.result.tools)
      if (explicitReads.includes(tool.name)) delete tool.inputSchema.properties.dbPath;
    return response;
  };
  const schemaCount = count(), routedCount = routed.length;
  for (const name of explicitReads)
    await assert.rejects(client.tryForward(name, { dbPath: pinnedStore }), /lacks explicit read store authority/);
  assert.equal(count(), schemaCount); assert.equal(routed.length, routedCount, 'missing selector contract refuses before policy or read dispatch');
  server.handleRequest = nativeHandle;
  delete process.env.CLAUDE_FLOW_DB_PATH;
  await native.withPolicyTransaction(root, engine => {
    engine.setMode('enforce');
    engine.upsertRule({ id: 'approval', effect: 'require_approval', actions: ['memory.read'] });
    engine.issueApproval({ id: 'once', principal: 'legacy-cli', actions: ['memory.read'], issuedBy: 'fixture-admin', expiresAt: Date.now() + 60000, maxUses: 1 });
  }, { approvalIssuerVerifier: who => who === 'fixture-admin' });
  const deniedReader=await client.openInventoryReader({root,dbPath:pinnedStore}), beforeReaderDenial=count(), beforeDeniedRouted=routed.length;
  await assert.rejects(deniedReader.client.callTool({name:'memory_list',arguments:{dbPath:pinnedStore}}),/Native memory owner refused/);
  await deniedReader.client.close();assert.equal(count(),beforeReaderDenial+1);assert.equal(routed.length,beforeDeniedRouted);
  let before = count();
  await caller('memory_retrieve', input, context);
  assert.equal(count(), before + 1); assert.equal(state().approvals[0].uses, 1); assert.equal(executed, 2);
  await assert.rejects(caller('memory_retrieve', input, context), /Native memory owner refused/);
  assert.equal(count(), before + 2); assert.equal(state().approvals[0].uses, 1); assert.equal(executed, 2);
  await native.withPolicyTransaction(root, engine => engine.issueApproval({ id: 'pinned-once',
    principal: 'legacy-cli', actions: ['memory.read'], issuedBy: 'fixture-admin',
    expiresAt: Date.now() + 60000, maxUses: 1 }), { approvalIssuerVerifier: who => who === 'fixture-admin' });
  process.env.CLAUDE_FLOW_DB_PATH = pinnedStore;
  const pinnedInput = { dbPath: pinnedStore, namespace: 'fixture' };
  const pinnedContext = { transport: 'stdio', approvalIds: ['pinned-once'], evidence: [] };
  const pinnedProtocol = await factory.createOwnerPolicyProtocol(moduleUrl);
  const pinnedProjection = await pinnedProtocol.project('memory_list', pinnedInput, pinnedContext, configuration.owners.one);
  before = count(); const pinnedExecuted = routed.length;
  await caller('memory_list', pinnedInput, pinnedContext);
  assert.equal(count(), before + 1); assert.equal(routed.length, pinnedExecuted + 1);
  const pinnedReceipt = structuredClone(state().receipts.at(-1).payload.request);
  assert.equal(typeof pinnedReceipt.requestId, 'string'); assert(Number.isFinite(pinnedReceipt.context.now));
  delete pinnedReceipt.requestId; delete pinnedReceipt.context.now;
  assert.deepEqual(pinnedReceipt, JSON.parse(JSON.stringify(pinnedProjection.request)),
    'new branch evaluates the complete unchanged native caller request');
  assert.equal(state().approvals.find(row => row.id === 'pinned-once').uses, 1);
  await assert.rejects(caller('memory_list', pinnedInput, pinnedContext), /Native memory owner refused/);
  assert.equal(count(), before + 2); assert.equal(routed.length, pinnedExecuted + 1, 'exhausted pinned approval cannot dispatch');
  assert.equal(state().approvals.find(row => row.id === 'pinned-once').uses, 1);
  for (const name of ['memory_search', 'memory_retrieve']) {
    const approval = name + '-once';
    await native.withPolicyTransaction(root, engine => engine.issueApproval({ id: approval,
      principal: 'legacy-cli', actions: ['memory.read'], issuedBy: 'fixture-admin',
      expiresAt: Date.now() + 60000, maxUses: 1 }), { approvalIssuerVerifier: who => who === 'fixture-admin' });
    const selected = { ...pinnedInput, ...(name === 'memory_search'
      ? { query: 'same native search', smart: true, limit: 3, provenance_filter: ['tool_result'] }
      : { key: 'same exact key', nativeResult: true }) };
    const scoped = { ...pinnedContext, approvalIds: [approval] };
    const projected = await pinnedProtocol.project(name, selected, scoped, configuration.owners.one);
    const prior = count(), executions = routed.length;
    await caller(name, selected, scoped);
    assert.equal(count(), prior + 1, name + ' has one authoritative decision');
    assert.deepEqual(routed.at(-1), { name, input: selected }, 'read arguments are not rewritten');
    const request = structuredClone(state().receipts.at(-1).payload.request);
    delete request.requestId; delete request.context.now;
    assert.deepEqual(request, JSON.parse(JSON.stringify(projected.request)), 'complete native authorization request survives');
    assert.equal(state().approvals.find(row => row.id === approval).uses, 1);
    await assert.rejects(caller(name, selected, scoped), /Native memory owner refused/);
    assert.equal(count(), prior + 2); assert.equal(routed.length, executions + 1, 'exhausted approval prevents dispatch');
  }
  delete process.env.CLAUDE_FLOW_DB_PATH;
  const protocol = await factory.createOwnerPolicyProtocol(moduleUrl);
  const projection = await protocol.project('memory_retrieve', input, context, configuration.owners.one);
  const send = meta => sdk.callTool({ name: 'memory_retrieve', arguments: input, _meta: { [protocol.key]: meta } });
  for (const mutate of [p => p.request.identity.id = 'admin', p => p.request.action.server = 'permissive',
    p => p.request.action.environment = 'permissive', p => p.authority.root = scratch,
    p => p.authority.trustRoot = scratch, p => p.request.context.metadata.inputDigest = 'sha256:wrong',
    p => p.request.context.envelope = {}, p => p.extra = true]) {
    const forged = structuredClone(projection); mutate(forged); before = count();
    try { const response = await send(forged); assert.equal(response.isError, true); }
    catch (error) { assert.match(error.message, /policy-owner-projection-mismatch|Internal error/); }
    assert.equal(count(), before, 'mismatch rejected before durable evaluation'); assert.equal(executed, 2);
  }
  // Profile is rechecked at dispatch, not merely at initialize.
  process.env.CLAUDE_FLOW_PRINCIPAL_ID = 'changed'; before = count();
  const changed = await send(projection); assert.equal(changed.isError, true); assert.equal(count(), before);
  delete process.env.CLAUDE_FLOW_PRINCIPAL_ID;
  // Native metadata-free HTTP still evaluates, and cannot borrow approval IDs.
  const direct = await sdk.callTool({ name: 'memory_retrieve', arguments: input });
  assert.equal(direct.isError, true); assert.equal(count(), before + 1);
  // Ineligible caller contexts keep the existing path. They never qualify by
  // selecting a more permissive server/environment through metadata.
  assert.equal((await client.tryForward('memory_retrieve', input, { environment: 'alternate' })).forwarded, false);
  for (const key of ['CLAUDE_FLOW_PRINCIPAL_ID', 'CLAUDE_FLOW_CAPABILITY_ENVELOPE', 'CLAUDE_FLOW_MCP_CALLER_AUTH', 'CLAUDE_FLOW_MCP_INVOCATION_TOKEN', 'CLAUDE_FLOW_MCP_CALLER_PUBKEY', 'CLAUDE_FLOW_POLICY_SIGNING_KEY', 'CLAUDE_FLOW_POLICY_KEY_ID', 'CLAUDE_FLOW_POLICY_EVIDENCE_KEYS']) {
    process.env[key] = ''; assert.equal((await client.tryForward('memory_retrieve', input)).forwarded, false); delete process.env[key];
  }
  const other = path.join(root, 'other'); fs.mkdirSync(other); configuration.contexts.push({ cwd: other, pin: null, owner: 'one' }); writeConfig();
  process.chdir(other);
  assert.equal((await client.tryForward('memory_retrieve', input, { projectRoot: root })).forwarded, false, 'projectRoot override cannot qualify a different caller cwd');
  process.chdir(root);
  // Old owner protocol is refused before caller evaluation or operation dispatch.
  const initialize = server.handleInitialize;
  server.handleInitialize = async r => { const response = await initialize(r); delete response.result.capabilities.experimental['ruflo/native-memory-owner'].policy; return response; };
  before = count(); await assert.rejects(caller('memory_retrieve', input, context), /policy capability is absent/);
  assert.equal(count(), before); assert.equal(executed, 2);
  server.handleInitialize = async r => { const response = await initialize(r); delete response.result.capabilities.experimental['ruflo/native-memory-owner']; return response; };
  await assert.rejects(caller('memory_retrieve', input, context), /policy capability is absent/);
  assert.equal(count(), before, 'pre-capability peers do not run the legacy identity tool');
  server.handleInitialize = initialize;
  // Separate concurrent request scopes retain their own approval and digest.
  await native.withPolicyTransaction(root, engine => {
    for (const id of ['parallel-a', 'parallel-b']) engine.issueApproval({ id, principal: 'legacy-cli', actions: ['memory.read'], issuedBy: 'fixture-admin', expiresAt: Date.now() + 60000, maxUses: 1 });
  }, { approvalIssuerVerifier: who => who === 'fixture-admin' });
  before = count();
  await Promise.all(['parallel-a', 'parallel-b'].map(id => caller('memory_retrieve', { ...input, key: id }, { transport: 'stdio', approvalIds: [id] })));
  assert.equal(count(), before + 2); assert.equal(executed, 4);
  const concurrent = state().receipts.slice(-2).map(({ payload }) => payload);
  assert.deepEqual(concurrent.map(row => row.decision.approvalId).sort(), ['parallel-a', 'parallel-b']);
  for (const row of concurrent) assert.deepEqual(row.request.context.approvalIds, [row.decision.approvalId]);
  assert.notEqual(concurrent[0].request.context.metadata.inputDigest, concurrent[1].request.context.metadata.inputDigest);
  await native.withPolicyTransaction(root, engine => engine.issueApproval({ id: 'uncertain', principal: 'legacy-cli', actions: ['memory.read'], issuedBy: 'fixture-admin', expiresAt: Date.now() + 60000, maxUses: 1 }), { approvalIssuerVerifier: who => who === 'fixture-admin' });
  const http = server.transports[0], handle = http.requestHandler;
  http.requestHandler = async (request, context) => { const response = await handle(request, context); if (request.params?.arguments?.key === 'lost-response') http.server.closeAllConnections(); return response; };
  before = count();
  await assert.rejects(caller('memory_retrieve', { ...input, key: 'lost-response' }, { approvalIds: ['uncertain'] }));
  http.requestHandler = handle;
  assert.equal(count(), before + 1); assert.equal(executed, 5, 'unknown outcome never replays');
  // Unsigned/claimed evidence cannot satisfy the native verifier.
  await native.withPolicyTransaction(root, engine => {
    engine.upsertRule({ id: 'approval', actions: ['memory.read'], effect: 'require_approval', enabled: false });
    engine.upsertRule({ id: 'evidence', effect: 'allow', actions: ['memory.read'], constraints: { requireSignedEvidence: true } });
  });
  before = count();
  await assert.rejects(caller('memory_retrieve', input, { evidence: [{ id: 'forged', provenance: 'system_observation', signed: true, signature: 'forged' }] }), /Native memory owner refused/);
  assert.equal(count(), before + 1); assert.equal(executed, 5);
  // Native MCP classification supplies no cost meter. Do not invent a charge:
  // configured monetary budgets must retain their native missing-meter denial.
  await native.withPolicyTransaction(root, engine => {
    engine.upsertRule({ id: 'evidence', actions: ['memory.read'], effect: 'allow', enabled: false }); engine.upsertRule({ id: 'allow', effect: 'allow', actions: ['memory.read'] });
    engine.setBudget({ id: 'money', maxCostUsd: 100, periodMs: 60000 });
  });
  before = count(); await assert.rejects(caller('memory_retrieve', input), /Native memory owner refused/);
  assert.equal(count(), before + 1); assert.equal(executed, 5);
  assert.match(state().receipts.at(-1).payload.decision.reason, /budget-metering-required/);
  assert.equal(state().usage.length, 0);
  // No owner configuration preserves the direct native policy path.
  const noOwner = dispatch({ configured: () => false, policyContext: c => c, tryForward: async () => ({ forwarded: false }), policyEvaluator: () => undefined });
  before = count(); await assert.rejects(noOwner('memory_retrieve', input), /policy-denied/);
  assert.equal(count(), before + 1); assert.equal(executed, 5);
  assert.equal((await native.verifyPolicyLedger(root, { full: true })).valid, true);
  console.log(JSON.stringify({ nativeHttp: true, defaultDecisions: 1, approvalUses: state().approvals[0].uses, executed, fullAudit: true, mismatchBeforeEvaluation: true, oldOwnerRefusedBeforeEvaluation: true }));
} finally {
  await client?.close(); await sdk?.close(); await owner?.close();
  if (server) { await server.stop(); server.sessionManager.destroy(); }
  process.chdir(cwd);
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved);
  fs.rmSync(scratch, { recursive: true, force: true });
}
