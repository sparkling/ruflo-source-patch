// Run installed native reporting, projection and receipt code against synthetic
// terminal envelopes and an in-memory progression store. No managed driver opens.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existingPathRelative } from '../path-containment.mjs';
import { readCapturePrivacySources, stageCapturePrivacy } from '../brain-native/capture-privacy-proof.mjs';

const DRIVER = `import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {exercisePrivateCapture} from ${JSON.stringify(new URL('../brain-native/capture-privacy-proof.mjs', import.meta.url).href)};
const {resultOf,normalizeManagedExecution}=await import('./mcp/managed-cli-interface.mjs');
const {captureProjectTransition}=await import('./scripts/project-progression-hook.mjs');
const {validateProgressionSnapshot,digestCanonical}=await import('./scripts/project-progression-contract.mjs');
const {recordManagedCliObservation,validateLiveSurfaceReceipt}=await import('./scripts/capability-claim-evidence.mjs');
const root=fs.realpathSync(process.cwd()), db=path.join(root,'fixture-only.db');
const resolution={checkoutRoot:root,canonicalAgentDbPath:db,projectIdentity:{id:'fixture-project',canonicalAgentDbPath:db}};
const state={plan:[],completed:[],inProgress:[],blockers:[],failures:[],decisions:[],changedFiles:[],commands:[],proofArtifacts:[],untested:[],resumeConflicts:[],currentGoal:null,acceptanceContract:null,activeProcess:null,activeStep:null,nextAction:null};
const sourceIdentity={checkoutPath:root,worktreeId:'fixture',branch:'main',head:'native',trackedDigest:'tracked',untrackedDigest:'untracked',dirtyTreeDigest:'dirty'};
let writes=0;const exact=new Map();
const store={resolution,capture(snapshot){
  assert.equal(validateProgressionSnapshot(snapshot,{expectedProjectIdentity:resolution.projectIdentity}).ok,true);
  writes++;exact.set(snapshot.eventKey,JSON.stringify(snapshot));
  const stored=JSON.parse(exact.get(snapshot.eventKey));assert.equal(digestCanonical(stored),digestCanonical(snapshot));
  return {eventKey:stored.eventKey,payloadDigest:stored.payloadDigest,readbackDigest:stored.payloadDigest};
}};
const secret='fixture-password-never-retained';
const errorPrecedesSignal=normalizeManagedExecution({code:null,error:'timeout',signal:'SIGTERM'}).outcome==='failure';
const cases=[
  {name:'timeout',value:{code:null,error:'timed out after 30000ms',stdout:'startup banner',stderr:'warning'},outcome:'failure',reason:'timed out after 30000ms'},
  {name:'signal',value:{code:null,signal:'SIGTERM',stdout:'startup banner',stderr:''},outcome:'interrupted',reason:'SIGTERM'},
  {name:'both',value:{code:null,error:'timed out',signal:'SIGTERM',stdout:'startup banner',stderr:''},outcome:'interrupted',reason:'timed out'},
  {name:'nonzero',value:{code:23,error:null,stdout:'startup banner',stderr:''},outcome:'failure',reason:'exit 23'},
  {name:'contradiction',value:{code:0,error:null,stdout:'[ERROR] failed despite exit zero',stderr:''},outcome:'failure',reason:'fatal output despite exit 0'},
  {name:'unknown',value:{code:null,error:null,stdout:'banner',stderr:''},outcome:'unknown',reason:'no terminal exit status'},
  {name:'success',value:{code:0,error:null,stdout:'native output',stderr:'native warning'},outcome:'success'},
  {name:'redacted',value:{code:null,error:'failure password='+secret,signal:'SIGTERM',stdout:'banner',stderr:''},outcome:'interrupted',reason:'failure'},
  {name:'bounded',value:{code:null,error:'x'.repeat(5000),signal:'S'.repeat(5000),stdout:'banner',stderr:''},outcome:'interrupted',reason:'x'.repeat(5000)},
];
for(const [index,test]of cases.entries()){
  const execution=test.value, normalized=normalizeManagedExecution(execution);
  const expectedOutcome=execution.error&&execution.signal&&errorPrecedesSignal?'failure':test.outcome;
  assert.equal(normalized.outcome,expectedOutcome,'native outcomes unchanged');
  const result=resultOf('ruflo',['status'],execution),text=result.content[0].text;
  const output=[execution.stdout,execution.stderr].filter(Boolean).join(execution.stdout&&execution.stderr?'\\n':'');
  assert.equal(result.isError,expectedOutcome!=='success');
  if(test.outcome==='success')assert.equal(text,output,'successful output unchanged');
  else{
    assert(text.includes(output),'all subprocess output remains intact');
    assert(text.includes(test.reason)||(test.name==='contradiction'&&text.includes('fatal output without successful completion')),'nonempty output cannot hide terminal reason');
    if(execution.signal)assert(text.includes(execution.signal)||result.structuredContent?.signal===execution.signal,'actual signal retained in the terminal result');
  }
  const payload={session_id:'fixture-session',hook_event_name:'PostToolUse',tool_name:'ruflo',tool_input:{command:'ruflo status'},
    tool_response:{exit_code:execution.code,stdout:execution.stdout,stderr:execution.stderr,outcome:normalized.outcome,
      ...(execution.error?{error:execution.error}:{}),...(execution.signal?{signal:execution.signal,interrupted:true}:{})},
    projectProgression:{canonicalAgentDbPath:db,sourceIdentity,sequence:index,occurredAt:'2026-10-04T12:00:00.000Z',parentEventKeys:[],dedupId:'fixture-'+index,completeProjectState:state}};
  const captured=captureProjectTransition({host:'codex',adapterVersion:'4.5.4',projectDir:root,payload,storeFactory:()=>store});
  const persisted=JSON.parse(exact.get(captured.snapshot.eventKey)),observation=persisted.completeProjectState.commands[0];
  assert.equal(observation.outcome,expectedOutcome,'persisted outcome unchanged');
  if(execution.error)assert.equal(typeof observation.error,'string','durable error retained');
  if(execution.signal)assert.equal(typeof observation.signal,'string','durable native signal retained');
  if(test.name==='timeout')assert.equal(observation.error,execution.error);
  if(test.name==='signal')assert.equal(observation.signal,'SIGTERM');
  if(test.name==='success')assert.equal(observation.error,undefined);
  assert(!JSON.stringify(persisted).includes(secret),'native snapshot redactor protects diagnostics');
  if(test.name==='bounded'){assert(observation.error.length<=4110);assert(observation.signal.length<=4110);}
  const receipt=recordManagedCliObservation({toolName:'ruvnet_cli_run',executable:'ruflo',argv:['status'],execution,
    env:{HOME:root,RUVNET_HOOK_HOST:'codex',RUVNET_CAPABILITY_LIVE_EVIDENCE:path.join(root,'fixture-receipts.jsonl')}});
  assert(receipt,'native capability receipt still created');validateLiveSurfaceReceipt(receipt);
  assert(receipt.terminal,'independent native receipt retains terminal envelope');
  assert.equal(receipt.terminal.exitCode,execution.code);
  if(execution.error)assert.equal(typeof receipt.terminal.error,'string');
  if(execution.signal)assert.equal(typeof receipt.terminal.signal,'string');
  assert(!JSON.stringify(receipt).includes(secret),'receipt reuses native terminal redaction');
  const expectedReachable=execution.code===0&&!execution.error
    && (!Object.hasOwn(receipt.terminal,'outcome')||(!execution.signal&&!normalized.contradictoryFailure));
  assert.equal(receipt.reachable,expectedReachable,'native reachability precedence unchanged');
  const written=JSON.parse(fs.readFileSync(path.join(root,'fixture-receipts.jsonl'),'utf8').trim().split('\\n').at(-1));
  assert.deepEqual(written,receipt,'durable native health receipt exact');
}
assert.equal(writes,cases.length,'one native progression write per observation');
if(fs.existsSync('./scripts/turn-capture-privacy.mjs'))exercisePrivateCapture({capture:captureProjectTransition,
  projectDir:root,resolution,sourceIdentity,state});
const success=resultOf('ruflo',[],{code:0,stdout:'',stderr:''});assert.equal(success.content[0].text,'ruflo  completed successfully');
console.log(JSON.stringify({ok:true,cases:cases.length,nativeOutcomes:true,exactProgression:true,redactedHealthReceipt:true}));
`;
const STUBS = {
  'scripts/runtime-preferences.mjs': 'export const loadRuntimePreferences=()=>({values:{}});export const runtimeChildEnv=({env})=>env;',
  'scripts/project-identity.mjs': 'export const projectDirectory=()=>process.cwd();',
  'scripts/session-snapshot-hook.mjs': 'export const runSessionSnapshotHook=()=>{throw Error("proof must not run lifecycle hooks");};',
  'scripts/project-store-resolver.mjs': 'export const resolveProjectStore=()=>{throw Error("proof must not resolve a real store");};',
  'scripts/project-progression-store.mjs': 'export class ProjectProgressionStore{constructor(){throw Error("proof must not open a real store");}}export class ProgressionKeyCollisionError extends Error{}',
};
const MEMBERS = ['mcp/managed-cli-interface.mjs', 'scripts/project-progression-hook.mjs',
  'scripts/capability-claim-evidence.mjs', 'scripts/project-progression-contract.mjs'];
function regularSource(root, relative) {
  const file = path.join(root, relative), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(root, file) === null) throw Error('unsafe diagnostic proof member: ' + file);
  return fs.readFileSync(file, 'utf8');
}
export function probeDiagnosticsBehavior(root, { transform = source => source } = {}) {
  let staged;
  try {
    staged = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-managed-diagnostics-proof-'));
    for (const relative of MEMBERS) {
      let source = transform(regularSource(root, relative));
      if (relative === 'mcp/managed-cli-interface.mjs') source += '\nexport { resultOf };\n';
      const file = path.join(staged, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source, { mode: 0o600 });
    }
    // Native 4.5.6/7 introduces these shared owners. Copy only declared imports,
    // preserving the implementation under proof; absence is still an error.
    for (const [owner, imported, relative] of [
      ['scripts/project-progression-hook.mjs', "from './continuity-events.mjs'", 'scripts/continuity-events.mjs'],
      ['mcp/managed-cli-interface.mjs', "from './managed-cli-generation.mjs'", 'mcp/managed-cli-generation.mjs'],
      ['mcp/managed-cli-interface.mjs', "from '../scripts/project-progression-suspension.mjs'", 'scripts/project-progression-suspension.mjs'],
    ]) if (regularSource(root, owner).includes(imported)) {
      fs.writeFileSync(path.join(staged, relative), regularSource(root, relative), { mode: 0o600 });
    }
    for (const [relative, source] of Object.entries(STUBS)) fs.writeFileSync(path.join(staged, relative), source, { mode: 0o600 });
    if (regularSource(root, 'scripts/project-progression-hook.mjs').includes("from './turn-capture-privacy.mjs'"))
      stageCapturePrivacy(path.join(staged, 'scripts'), readCapturePrivacySources(relative => regularSource(root, relative)));
    fs.writeFileSync(path.join(staged, 'proof.mjs'), DRIVER, { mode: 0o600 });
    const run = spawnSync(process.execPath, [path.join(staged, 'proof.mjs')], { cwd: staged,
      env: { HOME: staged, PATH: process.env.PATH || '' }, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
    if (run.error) return { state: 'unknown', evidence: run.error.message };
    if (run.status !== 0) return { state: 'live', evidence: 'native terminal proof failed: ' + (run.stderr || run.status) };
    const result = JSON.parse(run.stdout.trim());
    return result.ok ? { state: 'proven', evidence: 'native timeout/signal/nonzero/contradictory/unknown/success envelopes preserve output, outcomes, exact redacted progression and native health receipts' }
      : { state: 'live', evidence: 'native terminal diagnostics are incomplete' };
  } catch (error) { return { state: 'unknown', evidence: error.message }; }
  finally { if (staged) fs.rmSync(staged, { recursive: true, force: true }); }
}
