// Native list functions over disposable SQLite fixtures only; no managed store.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { findVendorRootWith, pristineBytes } from './fixtures.mjs';
import { patchSource, reverse, isPatched, prepareMemoryListPage } from '../lib/ruflo-memory-list-pagination/patcher.mjs';
import { nativeMemoryBridgeSatisfied } from '../lib/cwd/native-memory-bridge.mjs';
import { ENTRIES, composeCliContribution } from '../lib/cwd/patch-library.mjs';
import { composeSource } from '../lib/plugin-compose.mjs';
const relative = 'dist/src/memory/memory-bridge.js';
const vendor = findVendorRootWith(relative, ['export async function bridgeListEntries(options) {', 'const registryInstances = new Map();', 'MAX_LIST_EMBEDDINGS']);
const root = path.join(vendor, '@claude-flow/cli'), require = createRequire(path.join(root, 'package.json'));
const DB = require('better-sqlite3');
const SQL = await (await import(pathToFileURL(require.resolve('sql.js')))).default();
const directory = path.join(process.env.RSP_LIST_NATIVE_SRC ?? path.join(root, 'dist/src'), 'memory');
const { liveMemoryRowSql } = await import(pathToFileURL(path.join(directory, 'live-memory-row.js')));
const { MAX_LIST_EMBEDDINGS, encodeEmbeddingQ8 } = await import(pathToFileURL(path.join(directory, 'embedding-q8.js')));
const files = ['memory-bridge.js', 'memory-initializer.js'];
const sources = files.map(file => pristineBytes(path.join(directory, file)).toString());
// The published fallback is an independent unpaged oracle. Native 3.71.2's
// paged query silently loses/overselects rows when _rowid_ is a user column.
const nativePagination = sources[0].includes('const pagedSql =');
const references = sources.map(source => source
  .replace('ctx.db.prepare(pagedSql).all(', 'ctx.db.prepare(originalSql).all(')
  .replace('listRows = runList(pagedSql);', 'listRows = runList(originalSql);'));
const patched = sources.map(source => {
  const result = patchSource(source); assert.deepEqual(result.missing, []);
  assert.equal(reverse(result.next), source); assert(isPatched(result.next));
  assert.equal(patchSource(result.next).next, result.next);
  assert(patchSource(source + source).missing.length);
  assert(patchSource(source.replaceAll('ORDER BY updated_at DESC', 'ORDER BY created_at DESC')).missing.length);
  return result.next;
});
assert(nativeMemoryBridgeSatisfied(patched[0]), 'pagination preserves native path isolation and draining proof');
for (const [index, file] of files.entries()) {
  const source = sources[index];
  const core = composeCliContribution(source, ENTRIES.filter(entry => ['cwd', 'memory'].includes(entry.target)
    && entry.suffix.slice(-2).join('/') === 'memory/' + file));
  assert.deepEqual(core.missing, []);
  const target = 'ruflo-memory-list-pagination', owners = file === 'memory-initializer.js' ? ['ruflo-memory-owner'] : [];
  const combined = composeSource(core.next, [...owners, target]);
  assert.equal(reverse(combined), composeSource(core.next, owners), 'reverse retains other native owners');
  assert.equal(composeSource(combined, [...owners, target]), combined, 'shared composition is idempotent');
  assert.equal(composeSource(core.next, [target, ...owners]), combined, 'disjoint owner order preserves bytes');
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-list-pages-'));
try {
  const fixture = path.join(scratch, 'global', '@claude-flow', 'cli');
  const memory = path.join(fixture, 'dist', 'src', 'memory');
  fs.mkdirSync(memory, { recursive: true });
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({name:'@claude-flow/cli', version:'3.71.0', type:'module'}));
  files.forEach((file, index) => fs.writeFileSync(path.join(memory, file), sources[index]));
  const unidentified = path.join(scratch, 'npx', 'unidentified', 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'memory');
  fs.mkdirSync(unidentified, { recursive:true });
  fs.writeFileSync(path.join(unidentified, files[0]), sources[0]);
  const nullManifest = path.join(scratch, 'npx', 'null-manifest', 'node_modules', '@claude-flow', 'cli');
  fs.mkdirSync(path.join(nullManifest, 'dist/src/memory'), { recursive:true });
  fs.writeFileSync(path.join(nullManifest, 'package.json'), 'null');
  fs.writeFileSync(path.join(nullManifest, 'dist/src/memory', files[0]), sources[0]);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'; import fs from 'node:fs';
    import { spawnSync } from 'node:child_process';
    import { applyComposed, reconcile, statusComposed } from ${JSON.stringify(new URL('../lib/plugin-compose.mjs', import.meta.url).href)};
    const name='ruflo-memory-list-pagination', files=${JSON.stringify(files.map(file => path.join(memory, file)))};
    const originals=files.map(file=>fs.readFileSync(file,'utf8'));
    const first=applyComposed([name]); assert.equal(first.errors,0);assert.equal(first.incomplete,0);assert.equal(first.patched,2);
    files.forEach((file,index)=>{assert.equal(fs.readFileSync(file+'.rsp-backup','utf8'),originals[index]);assert.equal(spawnSync(process.execPath,['--check',file]).status,0);});
    assert.deepEqual(statusComposed([name])[name],{files:2,patched:2});
    assert.equal(applyComposed([name]).patched,0);
    fs.writeFileSync(files[0], originals[0]);
    assert.equal(statusComposed([name])[name].patched,1);
    assert.equal(applyComposed([name]).patched,1,'monitor reapplies upstream replacement');
    const restored=reconcile([],[name]);assert.equal(restored.errors,0);assert.equal(restored.restored,2);
    files.forEach((file,index)=>assert.equal(fs.readFileSync(file,'utf8'),originals[index]));
  `], { encoding:'utf8', timeout:30000, env:{...process.env, RUFLO_SOURCE_PATCH_HOME:path.join(scratch,'home'),
    RUFLO_NPX_ROOT:path.join(scratch,'npx'), RUFLO_GLOBAL_ROOT:path.join(scratch,'global')} });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal(fs.readFileSync(path.join(unidentified, files[0]), 'utf8'), sources[0], 'missing package identity remains unclaimed');
  fs.mkdirSync(path.join(scratch, 'home/.claude'), { recursive:true });
  fs.writeFileSync(path.join(scratch, 'home/.claude/settings.json'), '{}');
  const cli = action => {
    const result = spawnSync(process.execPath, [new URL('../bin/cli.mjs', import.meta.url).pathname,
      'ruflo-memory-list-pagination', action], { encoding:'utf8', timeout:30000, env:{...process.env,
      RUFLO_SOURCE_PATCH_HOME:path.join(scratch,'home'), RUFLO_NPX_ROOT:path.join(scratch,'npx'),
      RUFLO_GLOBAL_ROOT:path.join(scratch,'global'), RSP_NO_SELF_UPDATE:'1', RSP_NO_MONITOR_RECOVER:'1',
      RSP_NO_LAUNCHCTL:'1', RSP_NO_STALE_WRITER_KILL:'1', RSP_NO_HOST_AUTO_UPDATE:'1'} });
    assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout;
  };
  assert.match(cli('install'), /patched: 2/);
  assert.match(cli('status'), /2\/2 file\(s\) patched — tracked/);
  const stateFile = path.join(scratch, 'home/.ruflo-source-patch/state.json');
  assert(JSON.parse(fs.readFileSync(stateFile)).pluginTargets.includes('ruflo-memory-list-pagination'));
  files.forEach((file,index)=>{
    assert(isPatched(fs.readFileSync(path.join(memory,file),'utf8')));
    assert.equal(fs.readFileSync(path.join(memory,file)+'.rsp-backup','utf8'),sources[index]);
  });
  assert.match(cli('uninstall'), /restored 2 file\(s\)/);
  assert(!JSON.parse(fs.readFileSync(stateFile)).pluginTargets.includes('ruflo-memory-list-pagination'));
  files.forEach((file,index)=>assert.equal(fs.readFileSync(path.join(memory,file),'utf8'),sources[index]));
  assert.match(cli('status'), /0\/2 file\(s\) patched — NOT tracked/);
} finally { fs.rmSync(scratch, { recursive:true, force:true }); }
const fn = (source, name) => {
  const start = source.indexOf('export ' + (name === 'ensureBridgeSchema' ? '' : 'async ') + 'function ' + name + '(');
  const end = source.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start);
  return source.slice(start, end).replace('export ', '') + '\nreturn ' + name + ';';
};
const ensure = new Function(fn(sources[0], 'ensureBridgeSchema'))();
const makeBridge = (source, db) => new Function('operationContext', 'withBridgeOperation', 'getRegistry', 'getDb',
  'isValidProvenanceType', 'liveMemoryRowSql', 'MAX_LIST_EMBEDDINGS', 'encodeEmbeddingQ8', fn(source, 'bridgeListEntries'))(
  { getStore: () => ({ active: true }) }, operation => operation(), async () => ({}), () => ({ db }),
  type => ['unknown', 'tool_result', 'user_claim'].includes(type), liveMemoryRowSql, MAX_LIST_EMBEDDINGS, encodeEmbeddingQ8);
const makeLegacy = (source, bytes, sql = SQL) => new Function('getBridge', 'isValidProvenanceType', 'PROVENANCE_TYPES',
  'getMemoryRoot', 'path', 'fs', 'releaseOwnNativeHandle', 'hasNativeWalSidecars', 'ensureSchemaColumns',
  'getSqlJs', 'readFileMaybeEncrypted', 'liveMemoryRowSql', 'MAX_LIST_EMBEDDINGS', 'encodeEmbeddingQ8',
  fn(source, 'listEntries').replace("await import('sql.js')", 'await getSqlJs()'))(
  async () => null, type => ['unknown', 'tool_result', 'user_claim'].includes(type), ['unknown', 'tool_result', 'user_claim'],
  () => os.tmpdir(), path, { existsSync: () => true }, async () => {}, async () => false, async () => {},
  async () => ({ default: async () => sql }), () => bytes, liveMemoryRowSql, MAX_LIST_EMBEDDINGS, encodeEmbeddingQ8);
const normalized = result => ({ ...result, entries: [...result.entries].sort((a,b) => a.key.localeCompare(b.key)) });
let checks = 0;
for (const mode of ['rowid', 'without-rowid', 'shadow-null', 'shadow-nonunique', 'shadow-case', 'shadow-generated', 'view']) {
  const withoutRowid = mode === 'without-rowid';
  const db = new DB(':memory:'); assert.equal(ensure(db), true);
  if (withoutRowid) {
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_entries'").get().sql;
    db.exec('DROP TABLE memory_entries'); db.exec(ddl + ' WITHOUT ROWID'); assert.equal(ensure(db), true);
  }
  if (mode.startsWith('shadow-')) db.exec(`ALTER TABLE memory_entries ADD COLUMN ${mode==='shadow-case' ? '_ROWID_' : '_rowid_'} TEXT${
    mode==='shadow-nonunique' ? " DEFAULT 'shared'" : mode==='shadow-generated' ? " GENERATED ALWAYS AS ('shared') VIRTUAL" : ''}`);
  const insert = db.prepare(`INSERT INTO memory_entries(id,key,namespace,content,embedding,created_at,updated_at,status,expires_at,tags,provenance_type)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  for (let i=0;i<640;i++) insert.run(!withoutRowid && i<2 ? null : 'id-'+i, 'key-'+i, i%3 ? 'selected' : 'other',
    `Original 😀 漢字 \u0000 ${i}`, JSON.stringify([.1,.2,-.3,.4]), 100+i, 1000+Math.floor(i/4),
    i%17===0 ? 'deleted' : i%11===0 ? null : 'active', i%13===0 ? 1 : null,
    JSON.stringify(i%2 ? ['prod','exact"tag'] : ['PROD']), i%5 ? 'tool_result' : 'user_claim');
  if (mode === 'view') db.exec('ALTER TABLE memory_entries RENAME TO original_entries; CREATE VIEW memory_entries AS SELECT * FROM original_entries');
  for (const options of [
    { limit: 0 }, { limit: 20, offset: 1 }, { limit: 100, offset: 500 }, { limit: 1000, includeContent: true },
    { limit: 1000, includeEmbedding: true }, { limit: 1000, includeExpired: true },
    { namespace: 'selected', limit: 20, offset: 50, tags: ['prod'], provenanceFilter: ['tool_result'] },
    { namespace: 'absent', limit: 20 }, { tags: ['exact"tag'], limit: 1000 },
  ]) {
    const expected = await makeBridge(references[0], db)(options), actual = await makeBridge(patched[0], db)(options);
    assert.equal(actual.success, true); assert.deepEqual(normalized(actual), normalized(expected));
    for (let i=1;i<actual.entries.length;i++) assert(actual.entries[i-1].updatedAt >= actual.entries[i].updatedAt);
    const bytes = db.serialize();
    const oldLegacy = await makeLegacy(references[1], bytes)(options), newLegacy = await makeLegacy(patched[1], bytes)(options);
    assert.equal(newLegacy.success, true); assert.deepEqual(normalized(newLegacy), normalized(oldLegacy)); checks+=2;
  }
  if (nativePagination) {
    const options = { limit: 20, includeContent: true };
    for (const [index, read] of [[0, source => makeBridge(source, db)], [1, source => makeLegacy(source, db.serialize())]]) {
      const expected = await read(references[index])(options), upstream = await read(sources[index])(options);
      if (mode === 'rowid' || mode === 'without-rowid') assert.deepEqual(normalized(upstream), normalized(expected));
      else if (mode.startsWith('shadow-')) assert.notDeepEqual(normalized(upstream), normalized(expected), `native shadowed rowid gap remains reproducible: ${mode}/${index}`);
    }
    if (mode === 'rowid') {
      const queries = [];
      const failing = { prepare(sql) {
        queries.push(sql); const statement = db.prepare(sql);
        return sql.includes('WHERE _rowid_ IN') ? { all() { throw Error('fixture database is locked'); } } : statement;
      } };
      const result = await makeBridge(patched[0], failing)({ limit: 20 });
      assert.equal(result, null, 'bridge retains its native failure result');
      assert.equal(queries.filter(sql => sql.includes('ORDER BY updated_at DESC')).length, 1, 'native bridge execution error never runs fallback');
      queries.length = 0;
      class FailingDatabase extends SQL.Database {
        prepare(sql) {
          queries.push(sql); const statement = super.prepare(sql);
          if (sql.includes('WHERE _rowid_ IN')) statement.step = () => { throw Error('fixture database is locked'); };
          return statement;
        }
      }
      const legacy = await makeLegacy(patched[1], db.serialize(), { ...SQL, Database: FailingDatabase })({ limit: 20 });
      assert.equal(legacy.success, false); assert.match(legacy.error, /locked/);
      assert.equal(queries.filter(sql => sql.includes('ORDER BY updated_at DESC')).length, 1, 'sql.js execution error never runs fallback');
    }
  }
  const read = makeBridge(patched[0], db), all = [];
  for (let offset=0, pages=0;;) {
    assert(pages++ < 100, 'pagination must make bounded progress');
    const page = await read({ limit: 37, offset, includeContent: true }); assert.equal(page.success, true);
    all.push(...page.entries); offset+=page.entries.length; if(offset>=page.total)break;
  }
  const expected = await makeBridge(references[0], db)({ limit: 1000, includeContent: true });
  assert.deepEqual(normalized({ ...expected, entries: all }), normalized(expected), 'ties/offsets enumerate every native identity once');
  const retained = all[0];
  const writeTable = mode === 'view' ? 'original_entries' : 'memory_entries';
  db.prepare(`UPDATE ${writeTable} SET content=?,updated_at=? WHERE key=?`).run('Changed 😀', Date.now(), retained.key);
  assert.equal((await read({ limit: 1, includeContent: true })).entries[0].content, 'Changed 😀');
  db.prepare(`UPDATE ${writeTable} SET status='deleted' WHERE key=?`).run(retained.key);
  assert(!(await read({ limit: 1000 })).entries.some(row=>row.key===retained.key));
  db.close();
}
let prepares = [];
assert.throws(() => prepareMemoryListPage({ prepare(sql) { prepares.push(sql); throw Error('database is locked'); } }, 'original', 'paged'), /locked/);
assert.deepEqual(prepares, ["PRAGMA table_list('memory_entries')"], 'metadata errors never retry');
prepares=[];
const fake = error => ({ prepare(sql) {
  prepares.push(sql);
  if(sql.startsWith('PRAGMA'))return{all:()=>sql.includes('table_list')?[{name:'memory_entries',type:'table',wr:0}]:[{name:'id'}]};
  if(sql==='paged')throw Error(error);return 'native-statement';
} });
assert.equal(prepareMemoryListPage(fake('no such column: _rowid_'), 'original', 'paged'), 'native-statement');
assert.deepEqual(prepares.slice(-2), ['paged','original']);
prepares=[];assert.throws(()=>prepareMemoryListPage(fake('database is locked'), 'original','paged'), /locked/);
assert(!prepares.includes('original'), 'other prepare failures never retry');
for (const unavailable of ['table_list', 'table_xinfo']) {
  prepares=[];
  const unknown = { prepare(sql) { prepares.push(sql);return sql==='original' ? 'native-statement'
    : { all:()=>sql.includes(unavailable) ? [] : [{name:'memory_entries',type:'table',wr:0}] }; } };
  assert.equal(prepareMemoryListPage(unknown, 'original','paged'), 'native-statement');
  assert(!prepares.includes('paged'), 'incomplete schema metadata keeps original query');
}
if (process.env.RSP_LIST_BENCHMARK === '1') {
  const db = new DB(':memory:'); assert.equal(ensure(db), true);
  const insert = db.prepare('INSERT INTO memory_entries(id,key,namespace,content,embedding,created_at,updated_at,status) VALUES(?,?,?,?,?,?,?,?)');
  const body = 'synthetic paragraph 😀 '.repeat(100), vector = JSON.stringify(Array(384).fill(.01234567));
  db.transaction(() => { for(let i=0;i<50000;i++) insert.run('id-'+i,'key-'+i,'ns-'+i%80,body,vector,100,100+(i*3571)%50000,i%29?'active':'deleted'); })();
  for (const offset of [0, 40000]) {
    let expected;
    for (const [name, source] of [['original', sources[0]], ['paged', patched[0]]]) {
      const queries = [], observed = { prepare(sql) { queries.push(sql); return db.prepare(sql); } };
      const started = performance.now(), result = await makeBridge(source, observed)({ limit:10000, offset });
      const elapsedMs = performance.now()-started; assert.equal(result.success, true);
      if (expected) assert.deepEqual(normalized(result), normalized(expected)); else expected=result;
      const query = queries.find(sql=>sql.includes('ORDER BY updated_at DESC'));
      console.log(JSON.stringify({ benchmark:name, offset, elapsedMs, returned:result.entries.length,
        plan:db.prepare('EXPLAIN QUERY PLAN '+query).all(10000,offset).map(row=>row.detail) }));
    }
  }
  db.close();
}
console.log(JSON.stringify({ nativeListChecks: checks, rowidAndWithoutRowid: true, nullIds: true,
  exactFields: true, unicodeAndNul: true, tiedPages: true, updateDeleteVisibility: true,
  shadowedRowidAndViews: true, nativePagination, noManagedDatabase: true }));
