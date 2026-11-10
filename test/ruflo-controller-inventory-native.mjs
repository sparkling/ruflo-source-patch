import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-inventory-')));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'node_modules');
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
const fixture = name => fs.readFileSync(new URL('./fixtures/ruflo-controller-inventory/native-3.75.0/' + name, import.meta.url), 'utf8');
const patch = await import('../lib/ruflo-controller-inventory/patcher.mjs');
const root = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src');
const memoryRoot = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/memory');
const put = (file, source) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source); };
const toolFile = path.join(root, 'mcp-tools/agentdb-tools.js');
const bridgeFile = path.join(root, 'memory/memory-bridge.js');
const tierFile = path.join(memoryRoot, 'dist/tiered-memory.js');
const sources = new Map();
const registrySetup = `let registry, leases=0, active=false;
export const configure = value => {registry=value;};
export const leaseCount = () => leases;
const operationContext = { getStore: () => ({active}) };
async function withBridgeOperation(fn){leases++;active=true;try{return await fn();}finally{active=false;}}
async function getRegistry(){if(!active)throw Error('missing lease');return registry;}
function describeHierarchicalStore(hm){return {controller:'tieredMemoryStore',durable:hm.durable,persistence:'fixture'};}
function getHierarchicalFallback(){return null;}
export async function bridgeStorePattern(options) {return options;}
`;
const registration = `import { agentdbInventoryTools } from './agentdb-inventory-tools.js';
import { agentdbHierarchicalInventoryTools } from './agentdb-hierarchical-inventory-tools.js';
export const agentdbTools = [
    ...agentdbInventoryTools,
    ...agentdbHierarchicalInventoryTools,
];
`;
const tier = `import { getPersistedEntry, listPersistedEntries, TieredMemoryUnsupportedError, } from './tiered-memory-inventory.js';
${fixture('tier-decode.txt')}const VALID_TIERS = ['working', 'episodic', 'semantic'];
${fixture('tier-temporal.txt')}const INVENTORY_DEPS = {
    decode: rowToEntry,
    isValid: isTemporallyValid,
    validTiers: VALID_TIERS,
};
export class TieredMemoryStore {
${fixture('tier-count.txt')}    /**
     * Page through every PERSISTED entry */
${fixture('tier-methods.txt')}    /** Load persisted rows back into the tier maps and the archive. */
${fixture('tier-stats.txt')}    findActive(idOrKey) {}
}
`;
try {
  put(path.resolve(root, '../../package.json'), '{"name":"@claude-flow/cli","type":"module"}');
  put(path.join(memoryRoot, 'package.json'), '{"name":"@claude-flow/memory","type":"module","main":"dist/index.js"}');
  put(path.join(memoryRoot, 'dist/index.js'), '');
  const agentdb = path.join(process.env.RUFLO_GLOBAL_ROOT, 'agentdb');
  put(path.join(agentdb, 'package.json'), '{"name":"agentdb","main":"dist/src/index.js","type":"module"}');
  put(path.join(agentdb, 'dist/src/index.js'), '');
  const crudFile = path.join(agentdb, 'dist/src/controllers/crud-helpers.js');
  const validationFile = path.join(agentdb, 'dist/src/security/input-validation.js');
  put(crudFile, fixture('crud-helpers.js'));
  put(validationFile, fixture('validation-error.txt'));
  for (const [name, tail] of [['ReasoningBank','    /**\n     * Delete pattern by ID */'],['SkillLibrary','    /**\n     * Update a skill in place */']]) {
    const imported = name === 'ReasoningBank'
      ? 'assertMetadata, assertTags, embeddingBlob, inTransaction, mergeMetadata, toPage, toRecordId, CrudValidationError,'
      : 'assertMetadata, embeddingBlob, inTransaction, mergeMetadata, toPage, toRecordId, CrudValidationError';
    put(path.join(agentdb, 'dist/src/controllers/' + name + '.js'), `import { ${imported} } from './crud-helpers.js';\n` + fixture('safe-json.txt')
      + 'export class ' + name + ' {\n' + fixture(name + '.txt') + tail + '\n}');
  }
  for (const [file, source] of [
    [toolFile, registration], [bridgeFile, registrySetup + fixture('bridge-inventory.js')], [tierFile, tier],
    [path.join(root, 'mcp-tools/agentdb-inventory-tools.js'), fixture('inventory-tools.js')],
    [path.join(root, 'mcp-tools/agentdb-hierarchical-inventory-tools.js'), fixture('hierarchical-tools.js')],
    [path.join(memoryRoot, 'dist/tiered-memory-inventory.js'), fixture('tier-inventory.js')],
  ]) { sources.set(file, source); put(file, source); }
  for (const file of [toolFile, bridgeFile, tierFile]) {
    const source = sources.get(file), result = patch.patchSource(source, file);
    assert.deepEqual(result.missing, []); assert.equal(result.next, source);
    assert.equal(patch.isPatched(source, file), true); assert.equal(patch.hasPatch(source), false);
    assert.equal(patch.reverse(source), source);
  }
  // Pristine upstream and the exact sibling coherence composition both retire.
  const pristineTier = tier.replace(fixture('tier-stats.txt'), fixture('tier-stats-pristine.txt'));
  assert.notEqual(pristineTier,tier);
  put(tierFile,pristineTier);
  for(const file of [toolFile,bridgeFile,tierFile]) {
    const bytes=fs.readFileSync(file,'utf8'), result=patch.patchSource(bytes,file);
    assert.deepEqual(result.missing,[]);assert.equal(result.next,bytes);
  }
  put(tierFile,pristineTier.replace('stats[name] = map.size','stats[name] = 0'));
  assert(patch.patchSource(registration,toolFile).missing.length,'pristine stats mutation must refuse');
  put(tierFile,tier);
  assert.equal(patch.preflight().ok, true, JSON.stringify(patch.preflight()));
  const compose = await import('../lib/plugin-compose.mjs');
  const applied = compose.applyComposed([patch.NAME]);
  assert.equal(applied.errors, 0); assert.equal(applied.incomplete, 0); assert.equal(applied.patched, 0);
  assert.deepEqual(compose.statusComposed([patch.NAME])[patch.NAME], {files:3,patched:3});
  // A missing/drifted split member blocks the whole registered bundle and cannot
  // fall through to injecting six legacy definitions into the aggregator.
  const split = path.join(root, 'mcp-tools/agentdb-inventory-tools.js');
  for (const changed of [sources.get(split).replace("required: ['id']", "required: ['skillId']"), '']) {
    put(split, changed); assert(patch.patchSource(registration, toolFile).missing.length);
    assert.equal(patch.patchSource(registration, toolFile).next, registration);
    assert.equal(patch.preflight().ok, false);
  }
  put(split, sources.get(split));
  assert(patch.patchSource(registration + "\nconst duplicate={name:'agentdb_skill-get'};", toolFile).missing.length);
  assert(patch.patchSource(registration, undefined).missing.length, 'no file context cannot certify split ownership');
  // Unknown helper behavior must fail closed, not silently install our old tier algorithm.
  const helperFile = path.join(memoryRoot, 'dist/tiered-memory-inventory.js');
  put(helperFile, sources.get(helperFile).replace("opts.status ?? 'active'", "opts.status ?? 'all'"));
  assert(patch.patchSource(tier, tierFile).missing.length); put(helperFile, sources.get(helperFile));
  // Helper bodies and their imported bindings participate in whole-bundle proof.
  const bankFile = path.join(agentdb, 'dist/src/controllers/ReasoningBank.js');
  for (const [file, before, after] of [[crudFile, 'MAX_LIST_LIMIT = 500', 'MAX_LIST_LIMIT = 5000'],
    [validationFile, "this.name = 'ValidationError'", "this.name = 'OtherError'"],
    [bankFile, "from './crud-helpers.js'", "from './other-helpers.js'"],
    [bankFile, 'return JSON.parse(value)', 'return value'],
    [tierFile, 'return Number(row?.n ?? 0)', 'return 0'],
    [tierFile, 'stats[name] = map.size', 'stats[name] = 0']]) {
    const original=fs.readFileSync(file,'utf8');assert(original.includes(before));
    put(file,original.replace(before,after));
    assert(patch.patchSource(registration,toolFile).missing.length);assert.equal(patch.preflight().ok,false);
    put(file,original);
  }
  const bridge = await import(pathToFileURL(bridgeFile));
  const { agentdbTools } = await import(pathToFileURL(toolFile));
  assert.equal(agentdbTools.length, 6); assert.equal(new Set(agentdbTools.map(t => t.name)).size, 6);
  const call = (name, args = {}) => agentdbTools.find(t => t.name === 'agentdb_' + name).handler(args);
  let received;
  const page = { items: [{ id: 7 }], total: 51, limit: 1, offset: 50 };
  const rb = { listPatterns: args => { received = args; return page; } };
  const skills = { listSkills: rb.listPatterns, getSkill: id => id === 7 ? { id } : null };
  const hm = { durable: true, listEntries: args => { received=args; return { entries:[{id:'tm1'}], nextCursor:'native-cursor' }; },
    getEntry: (id, args) => { received=args; return id === 'tm1' ? {id} : null; },
    getTierStats: () => ({semantic:2}), countPersisted: () => 55 };
  bridge.configure({ get: name => ({reasoningBank:rb,skills,hierarchicalMemory:hm})[name] });
  assert.deepEqual(await call('pattern-list', {limit:1,offset:50,taskType:'exact'}), {success:true,controller:'reasoningBank',...page});
  assert.deepEqual(received, {taskType:'exact',limit:1,offset:50});
  assert.equal((await call('skill-get', {id:7})).skill.id, 7);
  assert.equal((await call('skill-get', {id:8})).found, false);
  assert.equal((await call('skill-get', {skillId:7})).code, 'invalid-argument');
  const listing = await call('hierarchical-list', {cursor:'native-cursor',status:'all',tier:'semantic',limit:1});
  assert.deepEqual(listing.entries, [{id:'tm1'}]); assert.equal(listing.nextCursor,'native-cursor');
  assert.deepEqual(received,{tier:'semantic',status:'all',limit:1,cursor:'native-cursor'});
  await call('hierarchical-list'); assert.equal(received.status,'active');
  await call('hierarchical-get',{id:'tm1',includeInactive:true}); assert.deepEqual(received,{includeInactive:true});
  assert.equal((await call('hierarchical-get',{id:'absent'})).found,false);
  assert.equal((await call('hierarchical-stats')).persistedRows,55);
  rb.listPatterns=undefined; assert.equal((await call('pattern-list')).code,'unsupported');
  skills.listSkills=()=>{throw Object.assign(Error('native graph is not SQL-addressable'),{code:'unsupported'});};
  const refusal=await call('skill-list'); assert.equal(refusal.success,false); assert.match(refusal.error,/not SQL-addressable/);
  bridge.configure(null); assert.equal((await call('pattern-list')).success,false);
  bridge.configure({get:()=>({getStats(){},promote(){}})});
  assert.equal((await call('hierarchical-list')).controller,'native-unsupported');
  assert.equal((await call('hierarchical-stats')).success,false);
  // Native helper exercised over an inert prepared-statement seam: no managed
  // database, SQL driver, owner, store initialization or write is opened.
  const helper = await import(pathToFileURL(helperFile));
  const { TieredMemoryStore } = await import(pathToFileURL(tierFile));
  assert.throws(()=>new TieredMemoryStore().listEntries(), /volatile store/);
  const rows=Array.from({length:5003},(_,i)=>({id:'tm'+String(i).padStart(5,'0'),ts:i,tier:'semantic',archived:0,superseded_by:null,valid:true}));
  rows.push({id:'expired',ts:6000,tier:'semantic',archived:0,valid:false,valid_until:'2000-01-01'},
    {id:'future',ts:6001,tier:'semantic',archived:0,valid:false,valid_from:'2999-01-01'},
    {id:'archived',ts:6002,tier:'semantic',archived:1,valid:true},
    {id:'superseded',ts:6003,tier:'semantic',archived:1,superseded_by:'tm1',valid:true});
  const db={prepare(sql){return {all(...params){
    let list=rows;
    if(sql.includes('tier = ?')) list=list.filter(r=>r.tier===params.shift());
    if(sql.includes("COALESCE(superseded_by, '') <> ''")) list=list.filter(r=>r.superseded_by);
    else if(sql.includes("COALESCE(superseded_by, '') = ''")) {
      list=list.filter(r=>!r.superseded_by && (sql.includes('archived <> 0') ? r.archived : !r.archived));
    }
    if(sql.includes('ts < ?')) {const [ts,,id]=params.splice(0,3);list=list.filter(r=>r.ts<ts || r.ts===ts && r.id<id);}
    return [...list].sort((a,b)=>b.ts-a.ts||b.id.localeCompare(a.id)).slice(0,params.at(-1));
  },get(id){if(sql.includes('WHERE id = ?'))return rows.find(r=>r.id===id);return {n:rows.length};}};}};
  const deps={validTiers:['semantic'],decode:r=>({...r}),isValid:r=>r.valid};
  let cursor, ids=[];
  do {const result=helper.listPersistedEntries(db,{status:'all',limit:500,cursor},deps);
    ids.push(...result.entries.map(e=>e.id));cursor=result.nextCursor;
  } while(cursor);
  assert.equal(ids.length,rows.length);assert.equal(new Set(ids).size,rows.length);
  assert.equal(helper.listPersistedEntries(db,{},deps).entries[0].id,'tm05002');
  assert.equal(helper.getPersistedEntry(db,'superseded',{},deps),null);
  assert.equal(helper.getPersistedEntry(db,'superseded',{includeInactive:true},deps).status,'superseded');
  assert.equal(helper.getPersistedEntry(db,'future',{includeInactive:true},deps).status,'expired');
  const next=helper.listPersistedEntries(db,{status:'all',limit:1},deps).nextCursor;
  assert.throws(()=>helper.listPersistedEntries(db,{status:'active',cursor:next},deps),/different tier\/status/);
  assert.throws(()=>helper.listPersistedEntries(db,{cursor:'!'},deps),/invalid cursor/);
  assert.throws(()=>helper.listPersistedEntries({prepare(){throw Error('native read failed');}},{},deps),/native read failed/);
  const nativeStore = new TieredMemoryStore(); nativeStore.db=db;
  assert.equal(nativeStore.listEntries({limit:1}).entries[0].id,'tm05002');
  assert.equal(nativeStore.getEntry('future'),null);
  assert.equal(nativeStore.getEntry('future',{includeInactive:true}).status,'expired');
  assert.equal(nativeStore.getEntry('superseded',{includeInactive:true}).supersededBy,'tm1');
  assert.equal(nativeStore.getEntry('superseded'),null);
  assert.equal(nativeStore.countPersisted(),rows.length);
  assert.equal(new TieredMemoryStore().countPersisted(),null);
  nativeStore.db={prepare(){throw Error('read failed');}};assert.equal(nativeStore.countPersisted(),null);
  nativeStore.hydrate=()=>{nativeStore.tiers={working:new Map([['a',{}]]),semantic:new Map()};nativeStore.archived=[{}];};
  assert.deepEqual(nativeStore.getTierStats(),{working:1,semantic:0,superseded:1});
  nativeStore.hydrate=()=>{throw Error('native hydration failed');};assert.throws(()=>nativeStore.getTierStats(),/native hydration failed/);
  const pristineStats = new Function('return ({'+fixture('tier-stats-pristine.txt')+'}).getTierStats')();
  assert.deepEqual(pristineStats.call({tiers:{working:new Map([['a',{}]])},archived:[{}]}),{working:1,superseded:1});
  // Exact published controller methods, detached from constructor/store setup.
  const { ReasoningBank } = await import(pathToFileURL(path.join(agentdb,'dist/src/controllers/ReasoningBank.js')));
  const { SkillLibrary } = await import(pathToFileURL(path.join(agentdb,'dist/src/controllers/SkillLibrary.js')));
  const bank = Object.create(ReasoningBank.prototype), library = Object.create(SkillLibrary.prototype);
  const queries=[];
  bank.db=library.db={prepare(sql){return {
    all(...args){queries.push({sql,args});return [{id:7,task_type:'exact',tags:'["kept"]',metadata:'{"authority":true}'}];},
    get(id){return sql.includes('COUNT') ? {c:5101} : id===7 ? {id:7,name:'exact',metadata:'{"authority":true}'} : undefined;},
  };}};
  assert.equal(bank.listPatterns({taskType:'exact',limit:1,offset:5100}).total,5101);
  assert.deepEqual(queries.at(-1).args,['exact',1,5100]);
  assert.deepEqual(bank.listPatterns().items[0].tags,['kept']);
  assert.equal(library.listSkills({minSuccessRate:.5,limit:1,offset:5100}).total,5101);
  assert.deepEqual(queries.at(-1).args,[.5,1,5100]);
  assert.equal(library.getSkill(7).name,'exact');assert.equal(library.getSkill(8),null);
  assert.equal(library.getSkill('7').id,7);
  for(const options of [{limit:0},{limit:501},{limit:1.5},{offset:-1},{offset:0.5}]) {
    assert.throws(()=>bank.listPatterns(options),e=>e.name==='CrudValidationError'&&e.code==='CRUD_VALIDATION_ERROR');
    assert.throws(()=>library.listSkills(options),e=>e.name==='CrudValidationError'&&e.code==='CRUD_VALIDATION_ERROR');
  }
  assert.deepEqual(bank.listPatterns({limit:'2',offset:'3'}).limit,2);
  for(const id of [0,-1,1.5,'7-notes',Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>library.getSkill(id),e=>e.code==='CRUD_VALIDATION_ERROR'&&e.field==='skillId');
  assert.throws(()=>library.listSkills({minSuccessRate:NaN}),/must be a finite number/);
  assert.deepEqual(library.skillRow({id:9,signature:'broken',metadata:''}).metadata,undefined);
  bank.db={prepare(){return {get(){return {c:1};},all(){return [{id:9,tags:'broken',metadata:''}];}};}};
  assert.deepEqual(bank.listPatterns().items[0].tags,[]);assert.deepEqual(bank.listPatterns().items[0].metadata,{});
  library.graphBackend={storeSkill(){}};
  assert.throws(()=>library.getSkill(7),/not available with a graph adapter/);
  assert.throws(()=>library.listSkills(),/not available with a graph adapter/);
  console.log('PASS native inventory: whole-bundle retirement, six unique registrations, native contracts, failure propagation, >5000 persisted rows, exact history and cursor guards');
} finally { fs.rmSync(scratch,{recursive:true,force:true}); }
