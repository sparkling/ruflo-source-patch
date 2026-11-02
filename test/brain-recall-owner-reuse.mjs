import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import dc from 'node:diagnostics_channel';
import { pathToFileURL } from 'node:url';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/brain-recall-native-4.7.28.json', import.meta.url), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-recall-owner-')));
for (const [key, folder] of Object.entries({ RUFLO_SOURCE_PATCH_HOME: 'home', RUFLO_NPX_ROOT: 'npx',
  RUFLO_GLOBAL_ROOT: 'global', RSP_CODEX_HOME: 'codex', RSP_RUVNET_BRAIN_HOME: 'brain', RSP_RUVNET_BRAIN_MARKETPLACE: 'marketplace' }))
  process.env[key] = path.join(base, folder);
const patcher = await import('../lib/brain-recall-owner-reuse/patcher.mjs');
const { NAME, SPECS, PATCH_MARKER, patchSource, reverseSource, isPatched } = patcher;
const scratchPatch = await import('../lib/brain-scratch-preservation/patcher.mjs');
const withdrawn = await import('../lib/brain-recall-runtime/patcher.mjs');
const scripts = path.join(base, 'scripts');
fs.mkdirSync(scripts);
const write = (name, source) => fs.writeFileSync(path.join(scripts, name), source);
for (const [name, entry] of Object.entries(fixture.sources)) {
  assert.equal(hash(entry.source), entry.sha256);
  assert.equal(hash(entry.installedSource), entry.installedSha256);
  for (const source of [entry.source, entry.installedSource]) {
    const result = patchSource(source);
    assert.deepEqual(result.missing, [], name);
    assert(isPatched(result.next));
    assert.equal(patchSource(result.next).next, result.next);
    assert.equal(reverseSource(result.next), source);
    assert(!result.next.includes('RUFLO_BRIDGE_MEMORY_ENTRIES_ONLY'));
    const spec = SPECS.find(row => row.relative.endsWith('/' + name));
    assert(patchSource(source.replace(spec.edits[0][1], 'changed upstream')).missing.length);
    assert(patchSource(source + '\n' + spec.edits[0][1]).missing.length);
    assert(patchSource(result.next.replace(PATCH_MARKER, PATCH_MARKER + '-changed')).missing.length);
  }
  if (name !== 'agentdb-recall-reader.mjs') {
    assert.equal(scratchPatch.patchSource(entry.source).next, entry.installedSource);
    const composed = patchSource(entry.installedSource).next;
    assert.equal(scratchPatch.reverseSource(reverseSource(composed)), entry.source);
    assert.equal(patchSource(scratchPatch.patchSource(entry.source).next).next,
      scratchPatch.patchSource(patchSource(entry.source).next).next);
  }
  const historical = withdrawn.patchSource(entry.installedSource).next;
  assert.equal(withdrawn.descriptor.patchSource(historical).next, entry.installedSource);
  assert.deepEqual(patchSource(withdrawn.descriptor.patchSource(historical).next).missing, []);
  write(name, patchSource(entry.source).next);
}
for (const [name, entry] of Object.entries(fixture.helpers)) {
  assert.equal(hash(entry.source), entry.sha256);
  write(name, entry.source);
}

// Full native recall/process/reader bodies execute. Peripheral project policy and
// redaction are fixture interfaces; no installed database or SDK is opened.
write('ruflo-bin.mjs', `import fs from 'node:fs';
export const resolveRuflo=()=>null;
export const nativeNodeFor=()=>({node:process.execPath});
export const rufloInvocation=(bin,args)=>({executable:process.execPath,args:[bin,...args]});
export const rufloInvocationOrPlain=rufloInvocation;
export const rufloCwdFor=()=>${JSON.stringify(base)};
export const rufloScratchRoot=()=>${JSON.stringify(base)};
export const rufloScratchDisposition=dir=>{try{fs.rmdirSync(dir)}catch{};return{}};
`);
write('project-store-resolver.mjs', 'export const resolveProjectStore=()=>({});');
write('hook-input.mjs', 'export const isHarnessGenerated=()=>false; export const readStdinBounded=async()=>Buffer.from("{}");');
write('runtime-preferences.mjs', 'export const learningContext=({env})=>({enabled:env.TEST_LEARNING_ENABLED==="1"});');
write('learning-store.mjs', `export const learningTarget=()=>${JSON.stringify(path.join(base, 'user-learning.db'))}; export const LEARNING_NAMESPACE='learning';`);
write('learn-capture.mjs', 'export const safeAction=x=>x;');
write('continuity-events.mjs', 'export const redactText=x=>String(x);');
write('turn-outcome-capture.mjs', `import path from 'node:path'; export const resolveTurnDb=({projectDir})=>({projectRoot:projectDir,db:path.join(projectDir,'.swarm/memory.db'),contentPathExcludes:[]});`);
write('turn-capture-privacy.mjs', 'export const maskExcludedPaths=x=>x;');
write('lesson-store.mjs', 'export const makeLesson=x=>x;');
write('decision-record.mjs', 'export const supersededKeys=()=>new Set(); export const tombstonedKeys=()=>new Set();');
write('entrypoint.mjs', 'export const isDirectInvocation=()=>false;');

const { recall } = await import(pathToFileURL(path.join(scripts, 'agentdb-recall.mjs')));
const { resolveBatchTarget } = await import(pathToFileURL(path.join(scripts, 'agentdb-recall-process.mjs')));
assert.equal(vm.runInNewContext(`(${resolveBatchTarget.toString()})('/unused', {})`,
  { process: { platform: 'win32' } }), null);

const root = path.join(base, 'project'), namespace = path.basename(root);
const store = path.join(root, '.swarm/memory.db');
fs.mkdirSync(path.dirname(store), { recursive: true });
fs.writeFileSync(store, 'fixture existence marker; never opened');
fs.writeFileSync(path.join(base, 'user-learning.db'), 'fixture existence marker; never opened');
const checkpoint = `project-state-auto-${Date.now()}-privateproof`;
const checkpointValue = JSON.stringify({ kind: 'automatic-checkpoint', projectRoot: root, summary: 'Research HTML delivery evidence' });
const bin = path.join(base, 'ruflo/bin/ruflo.js');
const cli = path.join(base, 'ruflo/node_modules/@claude-flow/cli');
fs.mkdirSync(path.dirname(bin), { recursive: true });
fs.mkdirSync(cli, { recursive: true });
fs.writeFileSync(path.join(base, 'ruflo/package.json'), JSON.stringify({ name: 'ruflo', bin: 'bin/ruflo.js', type: 'module' }));
fs.writeFileSync(path.join(cli, 'package.json'), JSON.stringify({ name: '@claude-flow/cli', type: 'module', exports: { './memory': './memory.mjs' } }));
const hit = { key: 'research-html-result', namespace, score: 0.9, preview: 'Research HTML delivery evidence', provenanceType: 'tool_result' };
fs.writeFileSync(bin, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({results:[${JSON.stringify(hit)}]}));\n`);
fs.chmodSync(bin, 0o700);
let owned = [];
const observe = ({ process: child }) => child.once('spawn', () => owned.push(child.pid));
dc.subscribe('child_process', observe);
const nativeKill = process.kill;
const modes = ['ok', 'timeout', 'native-false', 'throws', 'malformed', 'oversized', 'capability-absent', 'abort-during-search', 'already-aborted', 'unconfirmed', 'learning-consented'];
try {
  for (const mode of modes) {
    const late = path.join(base, mode + '.late');
    const search = mode === 'capability-absent' ? 'undefined' : `async ({query,namespace,limit,dbPath,...rest})=>{
      check(dbPath);
      if(namespace!==ns||limit!==12||query!=='html versions research results hosted local tailscale'||Object.keys(rest).length)throw Error('changed semantic options');
      ${['timeout', 'abort-during-search'].includes(mode) ? `await new Promise(resolve=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(late)},'late');resolve()},3000));` : ''}
      ${mode === 'native-false' ? "return {success:false,error:'native refusal'};" : mode === 'throws' ? "throw Error('native error');" : mode === 'malformed' ? 'return {success:true,results:[{}]};' : `return {success:true,results:[{key:'research-html-result',namespace:ns,score:0.9,content:${mode === 'oversized' ? "'x'.repeat(1048577)" : "'Research HTML delivery evidence'"},provenanceType:'tool_result'}]};`}
    }`;
    fs.writeFileSync(path.join(cli, 'memory.mjs'), `import fs from 'node:fs';
      export const resolveDbPath=p=>p;
      const expected=${JSON.stringify(store)},ns=${JSON.stringify(namespace)},checkpoint=${JSON.stringify(checkpoint)},content=${JSON.stringify(checkpointValue)};
      function check(p){if(p!==expected)throw Error('wrong native store');}
      export async function listEntries({namespace,dbPath}){check(dbPath);return{success:true,entries:namespace===ns?[{key:checkpoint},{key:'research-html-result'}]:[]};}
      export async function getEntry({key,namespace,dbPath}){check(dbPath);return namespace===ns&&(key===checkpoint||key==='research-html-result')?{success:true,found:true,entry:{content:key===checkpoint?content:'Research HTML delivery evidence'}}:{success:true,found:false};}
      export const searchEntries=${search};
    `);
    const abort = new AbortController();
    if (mode === 'already-aborted') abort.abort();
    const abortTimer = mode === 'abort-during-search' ? setTimeout(() => abort.abort(), 120) : null;
    owned = [];
    if (mode === 'unconfirmed') process.kill = (pid, signal) => pid < 0 && signal === 0 ? true : nativeKill(pid, signal);
    let result;
    try {
      result = await recall({ prompt: 'I want HTML versions of the research results, hosted on local tailscale', projectDir: root,
        ruflo: bin, deadlineMs: 600, signal: abort.signal, scratch: () => base,
        env: { ...process.env, TEST_LEARNING_ENABLED: mode === 'learning-consented' ? '1' : '0' } });
    } finally { clearTimeout(abortTimer); process.kill = nativeKill; }
    if (mode === 'already-aborted') {
      assert.equal(owned.length, 0);
      assert.equal(result.outcome, 'unavailable');
    } else if (['ok', 'capability-absent', 'learning-consented'].includes(mode)) {
      assert.equal(result.outcome, 'ok-with-results', JSON.stringify(result));
      assert(result.picks.some(row => row.key === 'research-html-result'));
    } else {
      assert.equal(result.outcome, mode === 'timeout' ? 'timed-out' : 'unavailable', JSON.stringify(result));
      assert(result.picks.some(row => row.key === checkpoint), `curated record erased: ${mode}`);
      if (mode !== 'unconfirmed') assert(!result.picks.some(row => row.key === 'research-html-result'));
      assert(result.block.includes(mode === 'timeout' ? 'Search timed out' : 'Search unavailable'));
      if (mode === 'unconfirmed') assert.equal(result.receipt.outcome, 'unavailable');
    }
    if (mode === 'capability-absent') await new Promise(resolve => setTimeout(resolve, 30));
    for (const pid of owned) assert.throws(() => nativeKill(-pid, 0), error => error.code === 'ESRCH', `owned child remains: ${mode}`);
    assert(!fs.existsSync(late), 'late query survived retirement');
  }
  // The same-owner route must never search one store while labeling another.
  const route = SPECS[2].edits.find(([id]) => id === 'same-store-native-search')[2].slice('...await ('.length, -1);
  for (const sameStore of [true, false]) {
    let called;
    const value = await vm.runInNewContext(`(async()=>${route})()`, {
      batchSearch: true, session: { storePath: '/project', search: async () => { called = 'shared'; return {}; } },
      jobStore: { path: sameStore ? '/project' : '/consented-user' }, query: 'q', namespace: 'n', searchDeadline: 1,
      useSpec: false, spec: null, bin: 'bin', env: {}, scratchFor: null, args: [], signal: null,
      searchOnce: async ({ store: selected }) => { called = selected.path; return {}; },
    });
    assert(value);
    assert.equal(called, sameStore ? 'shared' : '/consented-user');
  }
  // A dependent three-file protocol cannot partially install. Reuse the actual
  // composition/discovery owners against two isolated native Brain surfaces.
  const put = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
  const { fixtureSources, VENDOR_SPECS } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
  const native = fixtureSources();
  const roots = [path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'versions/4.7.28'),
    path.join(process.env.RSP_CODEX_HOME, 'plugins/cache/ruvnet-brain/ruvnet-brain/4.7.28')];
  for (const surface of roots) {
    put(path.join(surface, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruvnet-brain', version: '4.7.28' }));
    for (const spec of VENDOR_SPECS) put(path.join(surface, spec.relative),
      spec.id === 'shim' ? native.nativeShim : spec.id === 'hijack' ? native.nativeHijack : native.mcp4310);
    put(path.join(surface, 'scripts/hook-input.mjs'), 'export const parseHookEvent=()=>null;');
    for (const spec of SPECS) put(path.join(surface, spec.relative), fixture.sources[path.basename(spec.relative)].source);
  }
  const active = path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'active.json');
  const selector = JSON.stringify({ version: '4.7.28', codeRoot: 'versions/4.7.28' });
  put(active, selector);
  const compose = await import('../lib/plugin-compose.mjs');
  const state = await import('../lib/cwd/state.mjs');
  state.writeState({ patchTargets: [], pluginTargets: [NAME] });
  const files = roots.flatMap(surface => SPECS.map(spec => path.join(surface, spec.relative)));
  for (const file of files) for (const defect of ['missing', 'drift']) {
    const source = fs.readFileSync(file, 'utf8');
    if (defect === 'missing') fs.unlinkSync(file);
    else put(file, source.replace(SPECS.find(spec => file.endsWith(spec.relative)).edits[0][1], 'changed upstream'));
    const preserved = files.filter(candidate => fs.existsSync(candidate)).map(candidate => [candidate, fs.readFileSync(candidate)]);
    const refused = compose.applyComposed([NAME]);
    assert(refused.incomplete > 0, `${defect} member must block the complete bundle`);
    for (const [candidate, bytes] of preserved) {
      assert.deepEqual(fs.readFileSync(candidate), bytes);
      assert(!fs.existsSync(candidate + '.rsp-backup'), 'blocked first install creates no partial backup');
    }
    assert.equal(compose.statusComposed([NAME])[NAME].files, 6);
    assert.equal(compose.statusComposed([NAME])[NAME].patched, 0);
    put(file, source);
  }
  // Upgrade from the exact withdrawn composition is qualified before preflight
  // and still reconstructed by the shared pristine owner, never re-baselined.
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    put(file + '.rsp-backup', source);
    put(file, withdrawn.patchSource(source).next);
  }
  const owners = [withdrawn.NAME, NAME];
  state.writeState({ patchTargets: [], pluginTargets: owners });
  assert(patcher.preflight().ok);
  const installed = compose.applyComposed(owners);
  assert.equal(installed.errors, 0, installed.log.join('\n'));
  assert.equal(installed.incomplete, 0, installed.log.join('\n'));
  assert.deepEqual(compose.statusComposed([NAME])[NAME], { files: 6, patched: 6 });
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    fs.unlinkSync(file);
    const preserved = files.filter(candidate => candidate !== file).map(candidate => [candidate, fs.readFileSync(candidate), fs.readFileSync(candidate + '.rsp-backup')]);
    assert(compose.applyComposed(owners).incomplete > 0);
    assert.deepEqual(compose.statusComposed([NAME])[NAME], { files: 6, patched: 5 });
    for (const [candidate, bytes, backup] of preserved) {
      assert.deepEqual(fs.readFileSync(candidate), bytes);
      assert.deepEqual(fs.readFileSync(candidate + '.rsp-backup'), backup);
    }
    put(file, source);
  }
  const foreignFile = files[0];
  const knownBytes = fs.readFileSync(foreignFile);
  const pristineBytes = fs.readFileSync(foreignFile + '.rsp-backup');
  const foreignBytes = Buffer.concat([knownBytes, Buffer.from('\n// foreign mutation outside the patch anchors\n')]);
  put(foreignFile, foreignBytes);
  const installPreserved = files.map(file => [file, fs.readFileSync(file), fs.readFileSync(file + '.rsp-backup')]);
  assert(compose.applyComposed(owners).incomplete > 0,
    'install must not re-baseline a marker-preserving foreign mutation');
  for (const [file, live, pristine] of installPreserved) {
    assert.deepEqual(fs.readFileSync(file), live);
    assert.deepEqual(fs.readFileSync(file + '.rsp-backup'), pristine);
  }
  assert(compose.reconcile([withdrawn.NAME], [NAME]).incomplete > 0,
    'a retained marker cannot prove foreign bytes are our composition');
  assert.deepEqual(fs.readFileSync(foreignFile), foreignBytes);
  assert.deepEqual(fs.readFileSync(foreignFile + '.rsp-backup'), pristineBytes);
  put(foreignFile, knownBytes);
  const restored = compose.reconcile([withdrawn.NAME], [NAME]);
  assert.equal(restored.incomplete, 0, restored.log.join('\n'));
  for (const file of files) assert.equal(fs.readFileSync(file, 'utf8'), fixture.sources[path.basename(file)].source);
  assert.equal(fs.readFileSync(active, 'utf8'), selector);
} finally {
  process.kill = nativeKill;
  dc.unsubscribe('child_process', observe);
  fs.rmSync(base, { recursive: true, force: true });
}
console.log(`brain-recall-owner-reuse: full native assembly, ${modes.length} lifecycle cases and exact restoration passed`);
