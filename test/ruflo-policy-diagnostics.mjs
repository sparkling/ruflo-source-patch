import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { policyDiagnostic } from '../lib/ruflo-memory-owner/policy-diagnostics.mjs';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-policy-diagnostics-'));
const old = process.env.RSP_POLICY_DIAGNOSTICS;
const names = ['createHash','randomUUID','resolve','userInfo','join','mkdirSync','lstatSync','openSync','fsConstants','writeFileSync','closeSync','readLockFile'];
const values = [crypto.createHash,crypto.randomUUID,path.resolve,()=>({homedir:home}),path.join,
  fs.mkdirSync,fs.lstatSync,fs.openSync,fs.constants,fs.writeFileSync,fs.closeSync,
  ()=>JSON.stringify({pid:4321,acquiredAt:Date.now()-500})];
const make = new Function(...names, `return ${policyDiagnostic.toString()}`)(...values);
const dir = path.join(home,'.ruflo-source-patch','policy-diagnostics');
try {
  delete process.env.RSP_POLICY_DIAGNOSTICS;
  const note = make('/private/project','/private/lock',{tool:'memory_retrieve',inputDigest:'sha256:'+'a'.repeat(64),value:'NEVER_LOG_VALUE'});
  note('waiting'); note('acquired'); note('failed',new Error('policy-state-lock-timeout: NEVER_LOG_SECRET'));
  const files=fs.readdirSync(dir);
  assert.equal(files.length,1);
  const bytes=fs.readFileSync(path.join(dir,files[0]),'utf8');
  assert.ok(!bytes.includes('NEVER_LOG')&&!bytes.includes('/private/'));
  const r=JSON.parse(bytes);
  assert.equal(r.phases[0].lockOwnerPid,4321);
  assert.equal(r.phases[2].error,'policy-state-lock-timeout');
  assert.equal(r.operations[0].tool,'memory_retrieve');
  assert.equal(fs.statSync(path.join(dir,files[0])).mode&0o777,0o600);
  for(let i=0;i<150;i++)make('/project','/lock')('waiting');
  assert.ok(fs.readdirSync(dir).length<=128);
  const before=fs.readdirSync(dir).map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
  process.env.RSP_POLICY_DIAGNOSTICS='off';make('/project','/lock')('failed',new Error('secret'));
  assert.equal(fs.readdirSync(dir).map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join(''),before);
  delete process.env.RSP_POLICY_DIAGNOSTICS;
  fs.renameSync(dir,dir+'.preserved');fs.symlinkSync(dir+'.preserved',dir);
  assert.doesNotThrow(()=>make('/project','/lock')('waiting'));
  assert.equal(fs.readdirSync(dir).map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join(''),before,'refuse symlink destination');
} finally {
  if(old===undefined)delete process.env.RSP_POLICY_DIAGNOSTICS;else process.env.RSP_POLICY_DIAGNOSTICS=old;
  fs.rmSync(home,{recursive:true,force:true});
}
console.log('policy diagnostics: bounded, private, observational');
