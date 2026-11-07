import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import dc from 'node:diagnostics_channel';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/brain-recall-native-4.7.28.json', import.meta.url), 'utf8'));
const learningNative = fs.readFileSync(new URL('./fixtures/brain-user-learning-root/learning-store-native-4.7.21.mjs', import.meta.url), 'utf8');
const nativeSource = file => path.basename(file) === 'learning-store.mjs' ? learningNative : fixture.sources[path.basename(file)].source;
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
    const released = spec.edits.filter(([id]) => !['presence-only-option', 'presence-only-limit', 'turn-presence-only'].includes(id))
      .reduce((text, [, from, to]) => text.replace(from, () => to), source);
    assert.equal(patchSource(released).next, result.next, 'exact4.46.120 composition migrates');
    assert.equal(reverseSource(patchSource(released).next), source, 'migration reverses to the same native source');
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
const { resolveBatchTarget, nativeRead } = await import(pathToFileURL(path.join(scripts, 'agentdb-recall-process.mjs')));
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
fs.mkdirSync(process.env.RUFLO_SOURCE_PATCH_HOME, { recursive: true, mode: 0o700 });
const diagnosticRoot = path.join(process.env.RUFLO_SOURCE_PATCH_HOME, '.ruflo-source-patch/hook-failures/recall');
const scopeHash = value => hash(value).slice(0, 16);
const listCalls = path.join(base, 'native-list-calls.jsonl');
const modes = ['ok', 'timeout', 'native-false', 'throws', 'malformed', 'oversized', 'capability-absent', 'abort-during-search', 'already-aborted', 'unconfirmed', 'learning-consented', 'diagnostic-refused'];
try {
  for (const mode of modes) {
    fs.writeFileSync(listCalls, '');
    fs.rmSync(diagnosticRoot, { recursive: true, force: true });
    if (mode === 'diagnostic-refused') { fs.mkdirSync(diagnosticRoot, { recursive: true }); fs.chmodSync(diagnosticRoot, 0o755); }
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
      export async function listEntries({namespace,dbPath,limit,offset}){check(dbPath);fs.appendFileSync(${JSON.stringify(listCalls)},JSON.stringify({namespace,limit,offset})+'\\n');return{success:true,entries:namespace===ns?[{key:checkpoint},{key:'research-html-result'}]:namespace==='turns'?[{key:'turn-presence-only'}]:[]};}
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
        diagnosticSessionId: 'fixture-session-secret',
        env: { ...process.env, TEST_LEARNING_ENABLED: mode === 'learning-consented' ? '1' : '0' } });
    } finally { clearTimeout(abortTimer); process.kill = nativeKill; }
    const observedLists = fs.readFileSync(listCalls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    if (observedLists.length) {
      assert.equal(observedLists.find(row => row.namespace === 'turns')?.limit, 1);
      assert(observedLists.filter(row => row.namespace !== 'turns').every(row => row.limit === 100000 && row.offset === 0));
    }
    if (mode === 'already-aborted') {
      assert.equal(owned.length, 0);
      assert.equal(result.outcome, 'unavailable');
    } else if (['ok', 'capability-absent', 'learning-consented', 'diagnostic-refused'].includes(mode)) {
      assert.equal(result.outcome, 'ok-with-results', JSON.stringify(result));
      assert(result.picks.some(row => row.key === 'research-html-result'));
    } else {
      assert.equal(result.outcome, mode === 'timeout' ? 'timed-out' : 'unavailable', JSON.stringify(result));
      assert(result.picks.some(row => row.key === checkpoint), `curated record erased: ${mode}`);
      if (mode !== 'unconfirmed') assert(!result.picks.some(row => row.key === 'research-html-result'));
      assert(result.block.includes(mode === 'timeout' ? 'Search timed out' : 'Search unavailable'));
      if (mode === 'unconfirmed') assert.equal(result.receipt.outcome, 'unavailable');
    }
    if (!['already-aborted', 'capability-absent', 'diagnostic-refused'].includes(mode)) {
      assert(fs.existsSync(diagnosticRoot), mode + ': diagnostic directory absent; ' + JSON.stringify(result));
      const files = fs.readdirSync(diagnosticRoot);
      assert.equal(files.length, 1, mode);
      const file = path.join(diagnosticRoot, files[0]);
      const bytes = fs.readFileSync(file, 'utf8'), diagnostic = JSON.parse(bytes);
      assert(Buffer.byteLength(bytes) <= 16384);
      assert.equal(fs.statSync(diagnosticRoot).mode & 0o777, 0o700);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.equal(diagnostic.project, scopeHash(root));
      assert.equal(diagnostic.store, scopeHash(store));
      assert.equal(diagnostic.session, scopeHash('fixture-session-secret'));
      for (const privateText of [root, store, checkpoint, 'fixture-session-secret', checkpointValue,
        'html versions research results hosted local tailscale', 'Research HTML delivery evidence']) assert(!bytes.includes(privateText));
      assert.equal(diagnostic.retirementResult, mode === 'unconfirmed' ? 'unconfirmed' : 'confirmed');
      assert(diagnostic.events.some(row => row.phase === 'child-spawn' && row.pid > 0 && row.pgid === row.pid));
      assert(diagnostic.events.some(row => row.phase === 'termination-attempt' && row.signal === 'SIGKILL' && row.target < 0));
      assert(diagnostic.events.some(row => row.phase === 'operation-start' && row.op === 'search') || mode === 'abort-during-search');
      assert(diagnostic['child-close']);
      assert.equal(diagnostic.lastRetirementCheck.groupAlive, mode === 'unconfirmed');
      if (mode === 'unconfirmed') {
        assert(diagnostic.lastRetirementCheck.remainingMs <= 0);
        assert(diagnostic.lastRetirementCheck.childClosed);
        assert(diagnostic.retirementChecks > 1);
      }
      if (['ok', 'learning-consented'].includes(mode)) assert.equal(files[0], 'success.json');
      if (mode === 'timeout') assert(diagnostic.events.some(row => row.phase === 'operation-finish' && row.state === 'timed out'));
    }
    if (mode === 'diagnostic-refused') assert.deepEqual(fs.readdirSync(diagnosticRoot), []);
    if (mode === 'capability-absent') await new Promise(resolve => setTimeout(resolve, 30));
    for (const pid of owned) assert.throws(() => nativeKill(-pid, 0), error => error.code === 'ESRCH', `owned child remains: ${mode}`);
    assert(!fs.existsSync(late), 'late query survived retirement');
  }
  // Presence truncation is an explicit consumer option, never a namespace-wide policy.
  for (const presenceOnly of [[], ['turns']]) {
    const calls = [];
    const session = { storePath: store, list: async (namespace, limit) => {
      calls.push({ namespace, limit });
      return { state: 'ok', rows: (namespace === 'turns' ? ['old-turn', 'project-state-auto-9999999999999-x'] : ['decision-one'])
        .slice(0, limit).map(key => ({ key })) };
    } };
    const result = await nativeRead({ store: { path: store }, namespaces: ['turns', 'project'], session, presenceOnly });
    assert.equal(result.ok, true); assert.deepEqual(calls.map(row => row.limit), [presenceOnly.length ? 1 : 100000, 100000]);
    assert.equal(result.value.turns.length, presenceOnly.length ? 1 : 2);
  }
  const recallSource = fs.readFileSync(path.join(scripts, 'agentdb-recall.mjs'), 'utf8');
  const presenceExpression = /const presenceOnly = ([^;]+);/.exec(recallSource)[1];
  const { checkpointNamespaces } = await import(pathToFileURL(path.join(scripts, 'checkpoint-keys.mjs')));
  for (const name of ['turns', 'Turns']) assert.equal(vm.runInNewContext(presenceExpression,
    { root: path.join(base, name), checkpointNamespaces }).length, 0, 'checkpoint namespace keeps every key');
  for (const state of ['unavailable', 'timed out']) {
    const failed = await nativeRead({ store: { path: store }, namespaces: ['turns'], presenceOnly: ['turns'],
      session: { storePath: store, list: async () => ({ state }) } });
    assert.equal(failed.ok, false); assert.equal(failed.fatal, true); assert.equal(failed.state, state);
  }

  // Fixed retention and late-close observations are bounded independently of a
  // long retirement polling loop. Logging cannot follow a substituted directory.
  fs.rmSync(diagnosticRoot, { recursive: true, force: true });
  const { diagnosticsSource } = await import('../lib/brain-recall-owner-reuse/diagnostics.mjs');
  let slot = 0;
  const logger = vm.runInNewContext('(' + diagnosticsSource + ')', {
    fs, path, os, process, Buffer, crypto: { ...crypto, randomInt: () => slot++ % 64 },
  });
  let last;
  for (let i = 0; i < 70; i++) {
    const d = logger({ env: process.env, storePath: store, diagnostics: { project: root, session: 'fixture-session-secret', deadline: 1 } });
    for (let j = 0; j < 120; j++) d.note('operation-start', { id: j, op: 'get' });
    for (let j = 0; j < 400; j++) d.note('retirement-check', { childClosed: false, groupAlive: true, remainingMs: -j });
    d.retired('unconfirmed');
    last = d;
  }
  assert.equal(fs.readdirSync(diagnosticRoot).length, 64);
  last.closed(null, 'SIGKILL');
  const finalDiagnostic = JSON.parse(fs.readFileSync(path.join(diagnosticRoot, 'failure-05.json')));
  assert.equal(finalDiagnostic.retirementResult, 'unconfirmed', 'late close cannot rewrite the original warning');
  assert.equal(finalDiagnostic['child-close'].signal, 'SIGKILL');
  assert.equal(finalDiagnostic.retirementChecks, 400);
  assert.equal(finalDiagnostic.events.length, 96);
  assert(finalDiagnostic.droppedEvents > 0);
  for (const file of fs.readdirSync(diagnosticRoot)) assert(fs.statSync(path.join(diagnosticRoot, file)).size <= 16384);
  fs.rmSync(diagnosticRoot, { recursive: true });
  const outside = path.join(base, 'outside-diagnostics'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, diagnosticRoot);
  assert.doesNotThrow(() => logger({ env: process.env, storePath: store, diagnostics: {} }).retired('unconfirmed'));
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(diagnosticRoot);
  // Exercise the real stdin main path: explicit host session identity overrides
  // an unrelated inherited environment and never enters the native binding.
  const binHelper = fs.readFileSync(path.join(scripts, 'ruflo-bin.mjs'), 'utf8');
  write('ruflo-bin.mjs', binHelper.replace('resolveRuflo=()=>null', 'resolveRuflo=()=>'+JSON.stringify(bin)));
  write('entrypoint.mjs', 'export const isDirectInvocation=()=>true;');
  const inputHelper = fs.readFileSync(path.join(scripts, 'hook-input.mjs'), 'utf8');
  write('hook-input.mjs', "import fs from 'node:fs'; export const isHarnessGenerated=()=>false; export const readStdinBounded=async()=>fs.readFileSync(0);");
  for (const field of ['session_id', 'sessionId']) {
    execFileSync(process.execPath, [path.join(scripts, 'agentdb-recall.mjs')], {
      input: JSON.stringify({ prompt: 'I want HTML versions of the research results, hosted on local tailscale', cwd: root, [field]: 'stdin-session-'+field }),
      env: { ...process.env, CLAUDE_SESSION_ID: 'unrelated-inherited-session' }, timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const diagnostic = JSON.parse(fs.readFileSync(path.join(diagnosticRoot, 'success.json')));
    assert.equal(diagnostic.session, scopeHash('stdin-session-'+field));
    assert.equal(diagnostic.project, scopeHash(root));
  }
  write('entrypoint.mjs', 'export const isDirectInvocation=()=>false;');
  write('ruflo-bin.mjs', binHelper);
  write('hook-input.mjs', inputHelper);
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
  // A dependent four-file protocol cannot partially install. Reuse the actual
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
    for (const spec of SPECS) put(path.join(surface, spec.relative), nativeSource(spec.relative));
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
    assert.equal(compose.statusComposed([NAME])[NAME].files, 8);
    assert.equal(compose.statusComposed([NAME])[NAME].patched, 0);
    put(file, source);
  }
  // The composer must recognize released bytes from pristine, not merely the
  // patcher's direct in-place upgrade path.
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const spec = SPECS.find(row => file.endsWith(row.relative));
    const released = spec.edits.filter(([id]) => !id.startsWith('reader-') && !id.startsWith('learning-reader-') && !['presence-only-option', 'presence-only-limit', 'turn-presence-only'].includes(id))
      .reduce((text, [, from, to]) => text.replace(from, () => to), source);
    put(file + '.rsp-backup', source);
    put(file, released);
  }
  const releasedUpgrade = compose.applyComposed([withdrawn.NAME, NAME]);
  assert.equal(releasedUpgrade.incomplete, 0, releasedUpgrade.log.join('\n'));
  for (const file of files) assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), nativeSource(file));
  assert.equal(compose.reconcile([], [NAME]).incomplete, 0);
  // An installed pre-diagnostics owner is an exact historical composition,
  // so upgrading never re-baselines or loses the pristine bytes.
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    put(file + '.rsp-backup', source);
    put(file, patcher.historicalPatchSource(source).next);
  }
  const previousUpgrade = compose.applyComposed([withdrawn.NAME, NAME]);
  assert.equal(previousUpgrade.incomplete, 0, previousUpgrade.log.join('\n'));
  for (const file of files) {
    assert(isPatched(fs.readFileSync(file, 'utf8')));
    assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), nativeSource(file));
  }
  assert.equal(compose.reconcile([], [NAME]).incomplete, 0);
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
  assert.deepEqual(compose.statusComposed([NAME])[NAME], { files: 8, patched: 8 });
  assert.deepEqual(compose.statusComposed(owners), {
    [withdrawn.NAME]: { files: 6, patched: 6 }, [NAME]: { files: 8, patched: 8 },
  }, 'retired #514 health recognizes the exact new native owner composition');
  for (const file of files) {
    if (path.basename(file) === 'learning-store.mjs') continue; // Never owned by withdrawn #514.
    const current = fs.readFileSync(file, 'utf8');
    assert(withdrawn.descriptor.isPatched(current));
    assert.deepEqual(withdrawn.descriptor.patchSource(current), { next: current, applied: [], missing: [] });
    const stale = withdrawn.patchSource(fixture.sources[path.basename(file)].source).next;
    assert(!withdrawn.descriptor.isPatched(stale), 'new-owner compatibility never accepts stale #514');
  }
  const alteredReader = fs.readFileSync(files[0], 'utf8').replace('search: typeof mod.searchEntries', 'search: false && typeof mod.searchEntries');
  assert(!isPatched(alteredReader));
  assert(!withdrawn.descriptor.isPatched(alteredReader));
  assert(withdrawn.descriptor.patchSource(alteredReader).missing.length > 0,
    'a modified new owner is not accepted as an exact native composition');
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    fs.unlinkSync(file);
    const preserved = files.filter(candidate => candidate !== file).map(candidate => [candidate, fs.readFileSync(candidate), fs.readFileSync(candidate + '.rsp-backup')]);
    assert(compose.applyComposed(owners).incomplete > 0);
    assert.deepEqual(compose.statusComposed([NAME])[NAME], { files: 8, patched: 7 });
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
  for (const file of files) assert.equal(fs.readFileSync(file, 'utf8'), nativeSource(file));
  assert.equal(fs.readFileSync(active, 'utf8'), selector);
} finally {
  process.kill = nativeKill;
  dc.unsubscribe('child_process', observe);
  fs.rmSync(base, { recursive: true, force: true });
}
console.log(`brain-recall-owner-reuse: full native assembly, ${modes.length} lifecycle cases and exact restoration passed`);
