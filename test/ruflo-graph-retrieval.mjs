import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { QUERY_OLD, QUERY_NEW, QUERY_DESCRIPTION_OLD, DEPTH_OLD, BUDGET_OLD } from '../lib/ruflo-graph-retrieval/patcher.mjs';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'graph-retrieval-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
const root = path.join(scratch, 'npx', 'fixture', 'node_modules', '@claude-flow', 'cli');
const file = path.join(root, 'dist', 'src', 'mcp-tools', 'agentdb-tools.js');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), '{"name":"@claude-flow/cli","version":"fixture","type":"module"}');
const pristine = `const description = {
${QUERY_DESCRIPTION_OLD}
${DEPTH_OLD}
complexityBudget: {
${BUDGET_OLD}
},
};
async function handler(params) {
const mode=params.mode;
${QUERY_OLD}
}`;
fs.writeFileSync(file, pristine);
const { apply, inspect } = await import('../lib/cwd/patch-library.mjs');
assert.equal(apply(['ruflo-graph-retrieval']).incomplete, 0);
assert.equal(inspect()['ruflo-graph-retrieval'].satisfied, 1);
assert.equal(apply(['ruflo-graph-retrieval']).patched, 0);
assert.equal(spawnSync(process.execPath, ['--check', file]).status, 0);
assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), pristine);
apply([]);
assert.equal(fs.readFileSync(file, 'utf8'), pristine, 'uninstall restores exact original');
for (const drift of [pristine.replace('Try graph-node native first', 'Changed upstream'), pristine + QUERY_OLD]) {
  fs.writeFileSync(file, drift);
  assert.ok(apply(['ruflo-graph-retrieval']).incomplete > 0);
  assert.equal(fs.readFileSync(file, 'utf8'), drift, 'drift/ambiguous source is not overwritten');
}

const defaultCTE = (...args) => JSON.stringify(args);
let nativeCalls = 0, bridgeCalls = 0, prepared = [], resultRows = [['mem:b', 1]], dbError;
let db = { prepare(sql) { prepared.push(sql); if (dbError) throw dbError;
  return { raw() { return this; }, all() { return resultRows; } }; } };
const deps = {
  getGraphBackend: async () => { nativeCalls++; return {
    isGraphBackendAvailable: async () => true,
    getNeighbors: async () => ['mem:a'],
  }; },
  getGraphEdgeWriter: async () => ({getBridgeDb: async (...args) => {
    assert.deepEqual(args, [], 'use the existing managed path, no createIfMissing override');
    bridgeCalls++; return db;
  }}),
};
function build(block, cte = defaultCTE) {
  return new Function('deps', 'buildKHopCTE', `
    const {getGraphBackend,getGraphEdgeWriter}=deps;
    const sanitizeError=e=>e.message;
    const ensureDomainPrefix=id=>/^(mem|agent|task|entity|span|pattern):/.test(id)
      ? {id,wasLegacy:false} : {id:'mem:'+id,wasLegacy:true};
    return async params=>{
      const mode='k-hop',nodeId=params.nodeId||'mem:a',t0=Date.now();
      const budgetRaw=params.complexityBudget??{};
      const budget={maxNodesVisited:budgetRaw.maxNodesVisited??10000};
      const relation=params.relation,depth=params.depth??2;
      ${block}
    };`)(deps, cte);
}
const read = build(QUERY_NEW);
for (const nativeState of ['empty', 'partial', 'unavailable', 'throws']) {
  deps.getGraphBackend = async () => {
    nativeCalls++;
    if (nativeState === 'throws') throw new Error('native failed');
    return {
      isGraphBackendAvailable: async () => nativeState !== 'unavailable',
      getNeighbors: async () => nativeState === 'empty' ? [] : ['mem:a', 'mem:unrelated'],
    };
  };
  // build captures this accessor so each hostile variant really reaches the handler.
  const result = await build(QUERY_NEW)({});
  assert.equal(result.success, true);
  assert.equal(result.retrievalContract, 'retained-sql-khop-v1');
  assert.deepEqual(result.results, [{nodeId:'mem:b',depth:1}]);
}
assert.equal(nativeCalls, 0, 'independent native contents never select retained-history reads');
resultRows = [];
assert.deepEqual((await read({})).results, [], 'empty retained source has no fabricated seed');
resultRows = [['mem:b',1],['mem:c',2],['mem:d',3]];
let result = await read({depth:5,relation:'supports',complexityBudget:{maxNodesVisited:2}});
assert.equal(result.depth, 3);
assert.equal(result.requestedDepth, 5);
assert.equal(result.depthLimited, true);
assert.equal(result.resultLimitReached, true);
assert.equal(result.truncated, true);
assert.equal(result.count, 2);
assert.deepEqual(JSON.parse(prepared.at(-1)), ['mem:a',3,'supports',3]);
assert.match(result.budgetScope, /not bounded/);
resultRows = [['mem:b',1],['mem:c',2]];
assert.equal((await read({complexityBudget:{maxNodesVisited:2}})).truncated, false);
assert.equal((await read({complexityBudget:{maxDepth:1}})).success, false, 'invalid adapter row depth refused');
resultRows = [['mem:b',1]];
assert.equal((await read({complexityBudget:{maxDepth:1}})).depth, 1);
for (const params of [
  {depth:0},{depth:-1},{depth:Infinity},{depth:1.5},{depth:'3'},
  {complexityBudget:{maxDepth:'3'}},{complexityBudget:{maxNodesVisited:-1}},
  {complexityBudget:{maxNodesVisited:'1; DROP TABLE graph_edges'}},
  {relation:''},{relation:44},{relation:'x'.repeat(201)},
]) {
  const before=bridgeCalls;
  result=await read(params);
  assert.equal(result.success,false,JSON.stringify(params));
  assert.equal(result.results,null);
  assert.equal(bridgeCalls,before,'invalid limits/filter rejected before managed access');
}
for (const rows of [null,{},[['mem:a',1]],[['mem:b',0]],[['mem:b',4]],[['mem:b','1']]]) {
  resultRows=rows;
  assert.equal((await read({})).success,false,'bad driver result must not look healthy');
}
dbError = new Error('database unreadable');
result = await read({});
assert.equal(result.success,false);
assert.match(result.error,/unreadable/);
dbError=undefined;
db=null;
assert.equal((await read({})).success,false,'missing SQL must not fall back to partial native graph');
assert.equal(nativeCalls,0);
// Original public handler is the negative control: native success hides SQL.
deps.getGraphBackend=async()=>({isGraphBackendAvailable:async()=>true,getNeighbors:async()=>['mem:a']});
const old=await build(QUERY_OLD)({});
assert.equal(old.backend,'graph-node');
assert.deepEqual(old.results,[{nodeId:'mem:a'}]);
console.log('Graph retrieval: exact-anchor/rollback, native independence, limits, empty/error and input contracts passed.');

const nativeArg=process.argv.indexOf('--native-cli');
if(nativeArg!==-1) {
  const cli=process.argv[nativeArg+1];
  assert.ok(path.isAbsolute(cli||'') && path.basename(cli)==='package.json');
  const require=createRequire(cli);
  const BetterSqlite3=require('better-sqlite3');
  // Only owned in-memory fixture. No installed registry or managed store opened.
  db=new BetterSqlite3(':memory:');
  db.exec('CREATE TABLE graph_edges(source_id TEXT,target_id TEXT,relation TEXT,weight REAL,metadata TEXT)');
  const insert=db.prepare('INSERT INTO graph_edges VALUES (?,?,?,?,?)');
  for(const [a,b,rel] of [['a','b','supports'],['a','c','other'],['b','d','supports'],
    ['d','e','supports'],['e','f','supports'],['d','a','supports'],['x','a','supports']])
    insert.run('mem:'+a,'mem:'+b,rel,0.8,'{"untouched":true}');
  const snapshot=()=>db.prepare('SELECT * FROM graph_edges ORDER BY source_id,target_id,relation').all();
  const before=snapshot();
  const installed=fs.readFileSync(path.join(path.dirname(cli),'dist/src/mcp-tools/agentdb-tools.js'),'utf8');
  const sourceFile=path.join(path.dirname(cli),'dist/src/mcp-tools/agentdb-tools.js');
  const original=fs.readFileSync(fs.existsSync(sourceFile+'.rsp-backup') ? sourceFile+'.rsp-backup' : sourceFile,'utf8');
  fs.writeFileSync(file,original);
  assert.equal(apply(['ruflo-graph-retrieval']).incomplete,0,'exact installed upstream source must accept the patch');
  assert.equal(spawnSync(process.execPath,['--check',file]).status,0,'complete installed handler remains valid JavaScript');
  apply([]);
  assert.equal(fs.readFileSync(file,'utf8'),original,'complete installed source restores exactly');
  const cte=installed.slice(installed.indexOf('function buildKHopCTE('),installed.indexOf('function cosineSim('));
  assert.match(cte,/WITH RECURSIVE/);
  const nativeRead=build(QUERY_NEW,new Function(cte+';return buildKHopCTE;')());
  result=await nativeRead({nodeId:'mem:a',depth:3,relation:'supports'});
  assert.deepEqual(result.results,[{nodeId:'mem:b',depth:1},{nodeId:'mem:d',depth:2},{nodeId:'mem:e',depth:3}]);
  assert.equal(result.truncated,false);
  result=await nativeRead({nodeId:'mem:a',depth:5});
  assert.deepEqual(result.results.map(r=>r.nodeId),['mem:b','mem:c','mem:d','mem:e']);
  assert.equal(result.truncated,true);
  assert.equal(result.depth,3);
  assert.deepEqual((await nativeRead({nodeId:'mem:a',relation:"supports' OR 1=1 --"})).results,[]);
  assert.deepEqual((await nativeRead({nodeId:"mem:a' OR 1=1 --"})).results,[]);
  assert.deepEqual((await nativeRead({nodeId:'mem:absent'})).results,[]);
  result=await nativeRead({nodeId:'a',relation:'supports'});
  assert.equal(result.resolvedNodeId,'mem:a');
  assert.equal(result.legacyIdMapped,true);
  assert.deepEqual(result.results,[{nodeId:'mem:b',depth:1},{nodeId:'mem:d',depth:2}]);
  result=await nativeRead({nodeId:'mem:a',complexityBudget:{maxNodesVisited:1}});
  assert.equal(result.resultLimitReached,true);
  assert.equal(result.count,1);
  assert.deepEqual(snapshot(),before,'every retained relationship field remains unchanged');
  db.close();
  console.log('Native SQLite: actual installed CTE, branching/cycles, direction/filter/depth/limit and unchanged source rows passed.');
}
