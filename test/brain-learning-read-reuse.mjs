import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { patchSource, reverseSource, isPatched, historicalPatchSource } from '../lib/brain-recall-owner-reuse/patcher.mjs';
import { composeSource } from '../lib/plugin-compose.mjs';
import { isKnownComposition } from '../lib/composition-proof.mjs';
import { descriptor } from '../lib/brain-recall-owner-reuse/patcher.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/brain-recall-native-4.7.28.json', import.meta.url)));
const reader = fixture.sources['agentdb-recall-reader.mjs'].source;
const learning = fs.readFileSync(new URL('./fixtures/brain-user-learning-root/learning-store-native-4.7.21.mjs', import.meta.url), 'utf8');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-learning-read-'));
try {
  const fixedReader = patchSource(reader), fixedLearning = patchSource(learning);
  for (const [native, fixed] of [[reader, fixedReader], [learning, fixedLearning]]) {
    assert.deepEqual(fixed.missing, []); assert(isPatched(fixed.next));
    assert.equal(patchSource(fixed.next).next, fixed.next); assert.equal(reverseSource(fixed.next), native);
  }
  const oldReader = historicalPatchSource(reader, fixture.sources['agentdb-recall-reader.mjs'].installedSource).next;
  assert(isKnownComposition(reader, oldReader, [descriptor]));
  assert.equal(patchSource(oldReader).next, fixedReader.next);
  const composed = composeSource(learning, ['brain-capture-launch', 'brain-capture-diagnostics', 'brain-recall-owner-reuse']);
  assert(composed.includes('capture-step-timing')); assert(composed.includes('readLearningThroughNativeProcess'));
  const script = path.join(root, 'agentdb-recall-reader.mjs'), module = path.join(root, 'memory.mjs'), log = path.join(root, 'calls.jsonl');
  fs.writeFileSync(script, fixedReader.next);
  fs.writeFileSync(path.join(root, 'ruflo-bin.mjs'), 'export const resolveRuflo=()=>null; export const rufloInvocationOrPlain=()=>{throw Error("Unexpected CLI fallback")};');
  fs.writeFileSync(module, `import fs from 'node:fs';
export const resolveDbPath=p=>p; export const listEntries=async()=>({success:true,entries:[]});
export async function getEntry(args){
 fs.appendFileSync(process.env.CALL_LOG,JSON.stringify(args)+'\\n');
 await new Promise(r=>setTimeout(r,process.env.CASE==='timeout'?3000:60));
 if(process.env.CASE==='missing')return{success:true,found:false};
 if(process.env.CASE==='refusal')return{success:false,error:'Native refusal'};
 if(process.env.CASE==='throw')throw Error('native failure');
 if(process.env.CASE==='shape')return{success:true,found:true,entry:{content:7}};
 return{success:true,found:true,entry:{content:process.env.CASE==='large'?'x'.repeat(45000):'  exact\\nvalue  '}};
}`);
  const begin = fixedLearning.next.indexOf('function readLearningThroughNativeProcess(');
  const end = fixedLearning.next.indexOf('\n/**', begin);
  const body = fixedLearning.next.slice(begin, end).replace('export function runLearningRuflo', 'function runLearningRuflo')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(root, 'learning-store.mjs')).href));
  let qualified = true, cliCalls = 0, qualificationDelay = 0;
  const context = vm.createContext({ fs, path, os, process, Date, JSON, URL, fileURLToPath,
    spawnSync: (...args) => spawnSync(...args),
    resolveBatchTarget: () => {
      const end = Date.now() + qualificationDelay;
      while (Date.now() < end) {} // Bounded fixture-only resolver delay; no memory or runtime operation.
      return qualified ? { node: process.execPath, moduleUrl: pathToFileURL(module).href } : null;
    },
    rufloInvocation: () => { cliCalls++; return { executable: process.execPath, args: ['-e', 'process.stdout.write("CLI result")'] }; },
    rufloRunDir: () => fs.mkdtempSync(path.join(root, 'scratch-')),
  });
  vm.runInContext(body, context);
  const db = path.join(root, 'inert-never-opened.db'), key = 'workflow-' + 'a'.repeat(64);
  const args = ['memory', 'retrieve', '--key', key, '--namespace', 'learning-observations', '--value-only', '--path', db];
  const run = (mode, argv = args, step = 1500) => {
    fs.writeFileSync(log, ''); cliCalls = 0;
    return context.runLearningRuflo('/qualified/ruflo', argv, db, { env: { ...process.env, CASE: mode, CALL_LOG: log }, deadline: Date.now() + step, maxStepMs: step });
  };
  // The unchanged native session exits on EOF before its accepted async read completes.
  fs.writeFileSync(script, reader);
  assert.notEqual(run('ok').status, 0);
  fs.writeFileSync(script, fixedReader.next);
  const exact = run('ok'); assert.equal(exact.status, 0); assert.equal(exact.stdout, '  exact\nvalue  ');
  assert.equal(cliCalls, 0); assert.deepEqual(JSON.parse(fs.readFileSync(log, 'utf8')), { key, namespace: 'learning-observations', dbPath: db });
  assert.equal(run('large').stdout.length, 45000, 'EOF waits for the complete pipe response to flush');
  for (const mode of ['missing', 'refusal', 'throw', 'shape']) {
    assert.equal(run(mode).status, 1); assert.equal(cliCalls, 0, 'no second native read after dispatch');
  }
  const timed = run('timeout', args, 250); assert.equal(timed.error.code, 'ETIMEDOUT'); assert.equal(cliCalls, 0);
  const moduleSource = fs.readFileSync(module, 'utf8');
  fs.writeFileSync(module, 'export const resolveDbPath=p=>p;');
  assert.equal(run('ok').stdout, 'CLI result'); assert.equal(cliCalls, 1);
  assert.equal(fs.readFileSync(log, 'utf8'), '', 'reader capability refusal precedes any operation');
  fs.writeFileSync(module, moduleSource);
  qualified = false; assert.equal(run('ok').stdout, 'CLI result'); assert.equal(cliCalls, 1); qualified = true;
  qualified = false; qualificationDelay = 30;
  assert.throws(() => run('ok', args, 10), /learning deadline exhausted/);
  assert.equal(cliCalls, 0, 'qualification cannot extend the original deadline');
  qualified = true; qualificationDelay = 0;
  for (const argv of [['memory', 'store'], args.map(x => x === 'learning-observations' ? 'other' : x), args.map(x => x === key ? 'ordinary-key' : x)]) {
    assert.equal(run('ok', argv).stdout, 'CLI result'); assert.equal(cliCalls, 1);
    assert.equal(fs.readFileSync(log, 'utf8'), '', 'writes and other recipes retain the original CLI');
  }
  assert(!fs.existsSync(db));
  console.log('Learning read reuse: native EOF defect reproduced; exact delayed/large output, explicit binding, bounded timeout, no replay, unchanged CLI writes and composition PASS');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
