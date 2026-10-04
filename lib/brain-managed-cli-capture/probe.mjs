// Execute the installed producer/writer/contract, with an in-memory canonical
// reader/store fixture. No managed DB, host programme, or updater is opened.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existingPathRelative } from '../path-containment.mjs';

const DRIVER = `import assert from 'node:assert/strict';
import path from 'node:path';
const projectDir=process.cwd();
const resolution={projectRoot:projectDir,checkoutRoot:projectDir,kind:'git',canonicalAgentDbPath:path.join(projectDir,'fixture-only.db'),projectIdentity:{id:'fixture-project',canonicalAgentDbPath:path.join(projectDir,'fixture-only.db')}};
globalThis.rspCaptureFixture={snapshots:new Map(),source:{checkoutPath:projectDir,worktreeId:'fixture-worktree',branch:'main',head:'same-head',trackedDigest:'same-tracked',untrackedDigest:'same-untracked',dirtyTreeDigest:'same-dirty'}};
const {buildProjectProgression}=await import('./scripts/project-progression-producer.mjs');
const {captureProjectTransition}=await import('./scripts/project-progression-hook.mjs');
const {validateProgressionSnapshot,digestCanonical}=await import('./scripts/project-progression-contract.mjs');
const makePayload=(event,extra={})=>({session_id:'fixture-session',hook_event_name:event,...extra});
const produce=(payload)=>buildProjectProgression({resolution,projectDir,payload,host:'codex',trigger:payload.hook_event_name,now:()=> '2026-10-04T12:00:00.000Z'});
let writes=0;
const store={resolution,capture(snapshot){
  assert.equal(validateProgressionSnapshot(snapshot,{expectedProjectIdentity:resolution.projectIdentity}).ok,true);
  writes++;
  globalThis.rspCaptureFixture.snapshots.set(snapshot.eventKey,JSON.stringify(snapshot));
  const exact=JSON.parse(globalThis.rspCaptureFixture.snapshots.get(snapshot.eventKey));
  assert.equal(digestCanonical(exact),digestCanonical(snapshot));
  return {eventKey:exact.eventKey,payloadDigest:exact.payloadDigest,readbackDigest:exact.payloadDigest};
}};
const capture=(produced,payload,extra={})=>captureProjectTransition({host:'codex',projectDir,adapterVersion:'4.5.4',payload:{...payload,projectProgression:produced.projectProgression},storeFactory:()=>store,...extra});
const firstPayload=makePayload('SessionStart');
const first=produce(firstPayload); assert(!first.skipped);
capture(first,firstPayload);
assert(produce(makePayload('Stop')).skipped,'unchanged lifecycle retains no-op protection');
const before=produce(makePayload('PreToolUse',{tool_name:'ruflo',tool_input:{command:'ruflo --version'}}));
if(before.skipped){ console.log(JSON.stringify({ok:false,reason:before.skipped.reason})); process.exit(0); }
assert.equal(before.projectProgression.completeProjectState.commands.length,0,'producer does not append the action itself');
const prePayload=makePayload('PreToolUse',{tool_name:'ruflo',tool_input:{command:'ruflo --version'}});
const pre=capture(before,prePayload);
assert.equal(pre.snapshot.completeProjectState.commands.length,1,'native writer appends once');
assert.equal(pre.snapshot.completeProjectState.commands[0].outcome,'pending');
assert.equal(before.meaningDigest,digestCanonical({state:{...pre.snapshot.completeProjectState,activeStep:null,evidence:null},source:pre.snapshot.sourceIdentity}));
const cases=[
  [{exit_code:0,stdout:'native version'},'success'],
  [{exit_code:23,outcome:'success'},'failure'],
  [{signal:'SIGINT',interrupted:true},'interrupted'],
  [{stdout:'Everything succeeded'},'unknown'],
  [{isError:true,outcome:'success'},'failure'],
];
for(const [response,outcome] of cases){
  const payload=makePayload('PostToolUse',{tool_name:'ruflo',tool_input:{command:'ruflo --version'},tool_response:response});
  const produced=produce(payload); assert(!produced.skipped,'an actual result cannot disappear as a lifecycle no-op');
  const count=produced.projectProgression.completeProjectState.commands.length;
  const result=capture(produced,payload);
  assert.equal(result.snapshot.completeProjectState.commands.length,count+1);
  assert.equal(result.snapshot.completeProjectState.commands.at(-1).outcome,outcome);
  if(['failure','interrupted'].includes(outcome)) assert.equal(result.snapshot.completeProjectState.failures.at(-1).outcome,outcome);
  assert.equal(produced.meaningDigest,digestCanonical({state:{...result.snapshot.completeProjectState,activeStep:null,evidence:null},source:result.snapshot.sourceIdentity}));
}
const secret='fixture-password-never-retained';
const secretPayload=makePayload('PreToolUse',{tool_name:'ruflo',tool_input:{command:'ruflo example password='+secret}});
const protectedState=produce(secretPayload); assert(!protectedState.skipped);
assert(!JSON.stringify(protectedState).includes(secret),'producer output contains no raw action secret');
const protectedResult=capture(protectedState,secretPayload);
assert(!JSON.stringify(protectedResult).includes(secret),'native writer redacts action');
assert.equal(protectedState.meaningDigest,digestCanonical({state:{...protectedResult.snapshot.completeProjectState,activeStep:null,evidence:null},source:protectedResult.snapshot.sourceIdentity}),'meaning comparison uses the same canonical redacted action as native storage');
assert(produce(makePayload('Stop')).skipped,'later lifecycle remains no-op');
const unchangedWrites=writes;
assert.throws(()=>capture(protectedState,secretPayload,{host:'untrusted-host'}),/unsupported progression host/);
assert.equal(writes,unchangedWrites,'foreign host does not reach writer');
assert.throws(()=>capture(protectedState,secretPayload,{storeFactory:()=>({...store,capture:()=>null})}),/unverifiable exact-readback/);
assert.throws(()=>capture(protectedState,secretPayload,{storeFactory:()=>({...store,capture:(snapshot)=>({eventKey:snapshot.eventKey,payloadDigest:snapshot.payloadDigest,readbackDigest:'wrong'})})}),/unverifiable exact-readback/);
assert.throws(()=>capture(protectedState,secretPayload,{storeFactory:()=>({...store,capture:()=>{throw new Error('fixture readback failed');}})}),/fixture readback failed/);
console.log(JSON.stringify({ok:true,cases:cases.length,writes,canonicalRedaction:true,retainedLifecycleNoop:true,exactNativeReceiptRequired:true}));
`;
const SOURCES = `export const readOwnerNote=()=>null;
export const readSourceIdentity=()=>({identity:{...globalThis.rspCaptureFixture.source},headStable:true,kind:'git'});
export const readTranscriptReference=()=>({skipped:'no transcript supplied'});
export const readWorkLedger=()=>({file:'fixture-ledger',present:false,open:[],done:[],objective:null});
`;
const READER = `export function withProgressionReader(_path,work){return {ok:true,value:work({
  listKeys(namespace){return namespace==='project-progression'?[...globalThis.rspCaptureFixture.snapshots.keys()]:[];},
  readContent(namespace,key){return namespace==='project-progression'?globalThis.rspCaptureFixture.snapshots.get(key):null;}
})};}
`;
function readRegular(root, relative) {
  const file = path.join(root, relative);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(root, file) === null) {
    throw new Error(`unsafe native managed capture proof dependency: ${file}`);
  }
  return fs.readFileSync(file, 'utf8');
}
export function probeCaptureBehavior(root, { transform = (source) => source } = {}) {
  let staged;
  try {
    staged = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-managed-capture-proof-'));
    fs.mkdirSync(path.join(staged, 'scripts'));
    for (const relative of ['scripts/project-progression-producer.mjs', 'scripts/project-progression-hook.mjs', 'scripts/project-progression-contract.mjs']) {
      fs.writeFileSync(path.join(staged, relative), transform(readRegular(root, relative)), { mode: 0o600 });
    }
    fs.writeFileSync(path.join(staged, 'scripts/project-progression-sources.mjs'), SOURCES);
    fs.writeFileSync(path.join(staged, 'scripts/project-progression-reader.mjs'), READER);
    fs.writeFileSync(path.join(staged, 'scripts/project-progression-store.mjs'), 'export class ProjectProgressionStore {constructor(){throw new Error("proof must not open a real store");}}');
    fs.writeFileSync(path.join(staged, 'proof.mjs'), DRIVER);
    const run = spawnSync(process.execPath, [path.join(staged, 'proof.mjs')], { cwd: staged,
      env: { HOME: staged, PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
    if (run.error || run.status !== 0) return { state: 'unknown', evidence: `native capture proof failed: ${run.error?.message || run.stderr || `exit ${run.status}`}` };
    const result = JSON.parse(run.stdout.trim());
    return result.ok ? { state: 'proven', evidence: 'installed native producer/writer preserve unchanged lifecycle retention and capture pending/success/failure/interrupted/unknown actions exactly once with canonical redaction and verified receipt enforcement' }
      : { state: 'live', evidence: result.reason };
  } catch (error) { return { state: 'unknown', evidence: `native capture proof unavailable: ${error.message}` }; }
  finally { if (staged) fs.rmSync(staged, { recursive: true, force: true }); }
}
