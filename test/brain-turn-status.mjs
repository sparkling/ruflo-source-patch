import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NATIVE } from '../lib/brain-turn-status/native.mjs';

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-turn-status-')));
process.env.RUFLO_SOURCE_PATCH_HOME = sandbox;
process.env.RSP_RUVNET_BRAIN_HOME = path.join(sandbox,'.cache/ruvnet-brain');
process.env.RSP_CODEX_HOME = path.join(sandbox,'.codex');
process.env.RUFLO_GLOBAL_ROOT = path.join(sandbox,'npm');
process.env.RUFLO_NPX_ROOT = path.join(sandbox,'npx');
const patch = await import('../lib/brain-turn-status/patcher.mjs');
try {
  const result = patch.patchSource(NATIVE);
  assert.deepEqual(result.missing, []);
  assert.ok(patch.isPatched(result.next));
  assert.equal(patch.reverse(result.next), NATIVE, 'byte-exact restoration');
  assert.equal(patch.patchSource(result.next).next, result.next, 'idempotent');
  assert.equal(patch.patchSource(patch.PREVIOUS).next, result.next);
  assert.equal(patch.reverse(patch.PREVIOUS), NATIVE);
  for (const source of [NATIVE + NATIVE, NATIVE.replace('resolveTurnDb', 'changedRoot'), result.next.replace('pendingKeys:', 'changedKeys:')]) {
    assert.ok(patch.patchSource(source).missing.length, 'unknown boundaries refuse mutation');
    assert.equal(patch.patchSource(source).next, source);
  }
  // Executable ESM consumer: importing the named export must work, as SessionStart does.
  // All dependencies are pure stubs. No installed runtime, environment, DB or process owner is used.
  const fixture = `import path from 'node:path'; import crypto from 'node:crypto';
const os={homedir:()=>'/fixture'};
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
let input={}; export function configure(value){input=value;}
const resolveTurnDb=()=>({db:'/fixture/project/.swarm/memory.db',skipped:input.skipped});
const storeEncryptedAtRest=()=>input.encrypted; const ENCRYPTED_STORE_REASON='encrypted';
const firstTurnCaptureNotice=()=>input.notice; const turnCapturePolicyFile=()=>'/fixture/policy';
const bytesFor=file=>Buffer.from((input[path.basename(file)]||[]).join('\\n')+'\\n');
const fs={statSync:file=>({size:bytesFor(file).length})};
const readTail=(file,limit)=>{const name=path.basename(file);if(input.errors?.[name])throw Object.assign(Error('fixture'),{code:input.errors[name]});const all=bytesFor(file),offset=Math.max(0,all.length-limit),lines=all.subarray(offset).toString().split(/\\r?\\n/);if(offset>0)lines.shift();return lines;};
const turnAttemptPending=r=>r.pending===true&&r.owner?.alive===true&&r.deadlineMs>input.now;
const redactText=s=>s; const TURN_STATUS_FRESH_MS=3600000;
${result.next}
`;
  fs.writeFileSync(path.join(sandbox, 'runtime.mjs'), fixture);
  fs.writeFileSync(path.join(sandbox, 'consumer.mjs'), `import {turnRecordingStatus,configure} from './runtime.mjs'; export function run(value){configure(value);return turnRecordingStatus({home:'/fixture',projectDir:'/fixture/project',env:{},now:value.now,noticeOnFirstUse:true});}`);
  const { run } = await import(pathToFileURL(path.join(sandbox, 'consumer.mjs')));
  const crypto = await import('node:crypto');
  const digest = s => crypto.createHash('sha256').update(s).digest('hex');
  const store = digest('/fixture/project/.swarm/memory.db');
  const now = Date.parse('2026-11-06T13:24:30.622Z');
  const row = (key, at, extra={}) => ({at:new Date(at).toISOString(),kind:'store',storeIdentity:store,key,status:0,verified:true,...extra});
  const pending = row('r3',now-244,{pending:true,status:1,verified:false,error:'turn attempt pending exact readback',owner:{alive:true},deadlineMs:now+29000});
  const invoke = (rows=[],extra={}) => run({now,'receipts.jsonl':rows.map(JSON.stringify),...extra});
  let status=invoke([pending]);
  assert.equal(status.state,'warn');
  assert.match(status.line,/pending exact readback/);
  assert.doesNotMatch(status.line,/failed|failing/);
  assert.deepEqual(status.pendingKeys,['r3']);
  for (const extra of [{owner:{alive:false}},{owner:null},{deadlineMs:now-1}]) {
    status=invoke([{...pending,...extra}]);
    assert.match(status.line,/failed or unconfirmed/);
    assert.deepEqual(status.pendingKeys,[]);
  }
  status=invoke([row('r3',now+2000)],{now:now+3000,'receipts.jsonl.1':[JSON.stringify(pending)]});
  assert.equal(status.state,'ok','same-key terminal receipt supersedes rotated pending');
  const padding=Array.from({length:250},(_,i)=>JSON.stringify(row('foreign-'+i,now,{storeIdentity:'foreign',padding:'x'.repeat(700)})));
  const rotated={'receipts.jsonl.1':[JSON.stringify({...pending,owner:{alive:false}})],
    'receipts.jsonl':[JSON.stringify(row('r3',now)),...padding]};
  status=invoke([],rotated);
  assert.equal(status.state,'ok','confirmation at start of >128KiB current file supersedes rotated pending');
  fs.writeFileSync(path.join(sandbox,'old-runtime.mjs'),fixture.replace(result.next,patch.PREVIOUS));
  const old=await import(pathToFileURL(path.join(sandbox,'old-runtime.mjs')));
  old.configure({now,...rotated});
  assert.match(old.turnRecordingStatus({home:'/fixture',env:{},now}).line,/failed or unconfirmed/,'mutation: prior tail resurrected pending');
  assert.match(invoke([],{'receipts.jsonl':[JSON.stringify(row('big',now,{padding:'x'.repeat(530000)}))]}).line,/exceeds bounded coverage/);
  const failure={at:new Date(now-10000).toISOString(),hook:'turn-capture',store:store.slice(0,16),session:'r6-session-hash',expectedKey:digest('r6').slice(0,16),error:'capacity exhausted before dispatch'};
  const ledger={'hook-failures.jsonl':[JSON.stringify(failure)]};
  status=invoke([row('other',now)],ledger);
  assert.match(status.line,/Project historical recording failure/);
  assert.match(status.line,/r6-session-hash/);
  assert.match(status.line,/Current-session attribution is not established/);
  assert.equal(status.state,'warn','unrelated success cannot erase missing historical capture');
  assert.equal(invoke([row('r6',now)],ledger).state,'ok','same-key later exact proof resolves scoped warning');
  status=invoke([row('r6',now)],{'hook-failures.jsonl':[JSON.stringify({...failure,store:undefined})]});
  assert.match(status.line,/Unscoped historical.*applicability unknown/);
  status=invoke([row('good',now)],{'receipts.jsonl.1':['null','3','"text"','[]','{broken',JSON.stringify({at:'bad'})]});
  assert.equal(status.state,'warn');
  assert.match(status.line,/coverage incomplete/);
  assert.match(invoke([],{'hook-failures.jsonl':['null']}).line,/malformed receipt/);
  assert.equal(invoke([row('good',now)],{errors:{'receipts.jsonl.1':'EACCES'}}).state,'warn');
  assert.equal(invoke([row('good',now)],{errors:{'receipts.jsonl.1':'ENOENT'}}).state,'ok');
  assert.equal(invoke().state,'unknown');
  assert.equal(invoke([row('old',now-3600001)]).state,'unknown');
  assert.equal(invoke([row('legacy',now,{verified:undefined})]).state,'unknown');
  assert.equal(invoke([],{encrypted:true}).state,'warn');
  assert.equal(invoke([],{skipped:'disabled'}).state,'unknown');
  assert.equal(invoke([],{notice:'native consent notice'}).notice,'native consent notice');
  // Deduplicate BEFORE bounding the newest 20 keys, and reorder overwritten Map entries.
  const older=Array.from({length:25},(_,i)=>row(`key-${i}`,now-1000+i));
  status=invoke([...older,row('key-0',now,{status:1,verified:false,error:'latest failure'})]);
  assert.match(status.line,/latest failure/);
  assert.match(status.line,/1\/20/);
  assert.doesNotMatch(invoke([row('foreign',now,{storeIdentity:'other-store'})]).line,/✓/);
  const { VENDOR_SPECS } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
  const root=path.join(process.env.RSP_RUVNET_BRAIN_HOME,'versions/4.7.28');
  const write=(file,text)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
  write(path.join(root,'.claude-plugin/plugin.json'),JSON.stringify({name:'ruvnet-brain',version:'4.7.28'}));
  for(const spec of VENDOR_SPECS) write(path.join(root,spec.relative),'// isolated discovery fixture');
  write(path.join(root,'scripts/hook-input.mjs'),'// isolated discovery fixture');
  write(path.join(process.env.RSP_RUVNET_BRAIN_HOME,'active.json'),JSON.stringify({version:'4.7.28',codeRoot:root}));
  const file=path.join(root,'scripts/turn-outcome-capture.mjs');
  write(file,NATIVE);
  assert.deepEqual(patch.discover(),[file]);
  const { applyComposed,statusComposed,reconcile }=await import('../lib/plugin-compose.mjs');
  let composition=applyComposed([patch.NAME]);
  assert.equal(composition.errors,0,JSON.stringify(composition));
  assert.equal(composition.incomplete,0);
  assert.equal(statusComposed([patch.NAME])[patch.NAME].patched,1);
  assert.equal(fs.readFileSync(file+'.rsp-backup','utf8'),NATIVE);
  assert.equal(applyComposed([patch.NAME]).unchanged,1);
  write(file,patch.PREVIOUS);
  composition=applyComposed([patch.NAME]);
  assert.equal(composition.errors,0,JSON.stringify(composition));
  assert.equal(fs.readFileSync(file,'utf8'),result.next,'historical composition upgrades from unchanged pristine');
  const olderRoot=path.join(process.env.RSP_RUVNET_BRAIN_HOME,'versions/4.7.27');
  fs.cpSync(root,olderRoot,{recursive:true});
  write(path.join(olderRoot,'.claude-plugin/plugin.json'),JSON.stringify({name:'ruvnet-brain',version:'4.7.27'}));
  assert.equal(patch.discover().length,2,'older source owned by this target remains discoverable');
  composition=reconcile([],[patch.NAME]);
  assert.equal(composition.errors,0,JSON.stringify(composition));
  assert.equal(fs.readFileSync(file,'utf8'),NATIVE,'shared composer uninstall restores pristine');
  assert.equal(statusComposed([patch.NAME])[patch.NAME].patched,0);
  assert.equal(fs.readFileSync(path.join(olderRoot,'scripts/turn-outcome-capture.mjs'),'utf8'),NATIVE);
  console.log('brain-turn-status: exact anchors/restoration, named ESM consumer, pending ownership, rotation/order, historical scope and malformed coverage passed');
} finally { fs.rmSync(sandbox,{recursive:true,force:true}); }
