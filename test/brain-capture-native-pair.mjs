import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { NATIVE_PAIR_HELPER } from '../lib/brain-capture-idempotency/native-pair.mjs';
import { preflight } from '../lib/brain-capture-idempotency/patcher.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-pair-'));
try {
  const surface = path.join(root, 'turn-outcome-capture.mjs');
  assert.equal(preflight([surface]).ok, false, 'missing native imports refuse installation');
  for (const [file, name] of [['agentdb-recall-process.mjs', 'resolveBatchTarget'], ['hook-input.mjs', 'readStdinBounded']])
    fs.writeFileSync(path.join(root, file), `export function ${name}() {}`);
  assert.equal(preflight([surface]).ok, true);
  fs.writeFileSync(path.join(root, 'hook-input.mjs'), 'export function different() {}');
  assert.equal(preflight([surface]).ok, false, 'incompatible native export refuses installation');
  const worker = path.join(root, 'pair.mjs'), log = path.join(root, 'calls.jsonl');
  const moduleUrl = pathToFileURL(path.join(root, 'memory/index.js')).href;
  const db = path.join(root, 'inert.db');
  fs.mkdirSync(path.join(root, 'memory'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  // The owner seam is inert. Actual child transport, timeout and response decoding run unchanged.
  fs.writeFileSync(path.join(root, 'mcp-client.js'), `import fs from 'node:fs';
export const rspMemoryOwner = process.env.CASE === 'missing' ? undefined : {
 configured:()=>process.env.CASE !== 'unconfigured',
 binding:async db=>{if(process.env.CASE==='bad-binding')throw Error('Invalid bound store');},
 close:async()=>{},
 call:async(name,input,context,canonical)=>{
  fs.appendFileSync(process.env.CALL_LOG,JSON.stringify({name,input,context,canonical})+'\\n');
  if(name==='memory_store'){
   if(process.env.CASE==='refusal')return {success:false,error:'Native policy denied'};
   if(process.env.CASE==='duplicate')return {success:false,error:'Key already exists'};
   if(process.env.CASE==='shape')return {ok:true};
   if(process.env.CASE==='killed-after-commit') {fs.writeFileSync(process.env.COMMIT_MARKER,'committed');await new Promise(r=>setTimeout(r,10000));}
   return {success:true};
  }
  if(process.env.CASE==='read-error')throw Error('Native read terminal EIO');
  return {success:true,found:true,entry:{content:'exact\\nvalue '}};
 }
};`);
  fs.writeFileSync(worker, `import fs from 'node:fs';import path from 'node:path';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const TURN_NAMESPACE='turns';const resolveBatchTarget=()=>({node:process.execPath,moduleUrl:${JSON.stringify(moduleUrl)}});
${NATIVE_PAIR_HELPER}
await nativeCapturePairWorker(JSON.parse(fs.readFileSync(0,'utf8')));
`);
  const context = vm.createContext({ process, spawnSync, Date, JSON,
    fileURLToPath: () => worker, resolveBatchTarget: () => ({ node: process.execPath, moduleUrl }) });
  vm.runInContext(NATIVE_PAIR_HELPER.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(worker).href)), context);
  const run = (kind, { scanner, timeout = 3000 } = {}) => {
    fs.writeFileSync(log, '');
    return context.runNativeCapturePair({ ruflo: '/qualified/native/ruflo', db, key: 'turn-test', value: 'exact\nvalue ',
      options: { env: { ...process.env, CASE: kind, CALL_LOG: log, COMMIT_MARKER: path.join(root, 'committed'),
        ...(scanner ? { RUFLO_MEMORY_SCAN_ON_WRITE: scanner } : {}) },
      cwd: root, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 } });
  };
  const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  for (const kind of ['normal', 'duplicate']) {
    const result = run(kind); assert.equal(result.read.stdout, 'exact\nvalue ');
    assert.deepEqual(calls().map(x => x.name), ['memory_store', 'memory_retrieve']);
    assert.deepEqual(calls()[0], { name: 'memory_store', input: { key: 'turn-test', value: 'exact\nvalue ', namespace: 'turns',
      generateEmbeddingFlag: true, requireNative: true, appendOnly: true, tags: [], upsert: false,
      provenanceType: 'agent_output', dbPath: db }, context: {}, canonical: true });
    assert(result.phases.totalMs >= result.phases.initializationMs);
  }
  for (const kind of ['missing', 'bad-binding']) {
    const result = run(kind); assert.equal(result.store.status, 1); assert.equal(calls().length, 0);
  }
  assert.equal(run('unconfigured'), null); assert.equal(calls().length, 0);
  for (const scanner of ['1', 'true', 'yes', 'on', 'TRUE']) {
    assert.equal(run('normal', { scanner }), null); assert.equal(calls().length, 0);
  }
  for (const kind of ['refusal', 'shape']) {
    const result = run(kind); assert.equal(result.store.status, 1); assert.equal(result.read, null);
    assert.equal(calls().length, 1, 'neither read nor retry follows an unsupported/refused store');
  }
  assert.match(run('read-error').read.stderr, /Native read terminal EIO/);
  const killed = run('killed-after-commit', { timeout: 250 });
  assert(fs.existsSync(path.join(root, 'committed')));
  assert.equal(killed.store.error.code, 'ETIMEDOUT'); assert.equal(killed.read, null);
  assert.equal(calls().length, 1, 'unknown committed write is never replayed');
  console.log('Native capture pair: exact CLI controls, bounded stdin child, full bytes, duplicate readback, authority refusal, scanner compatibility, terminal cause and killed-after-commit no replay PASS');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
