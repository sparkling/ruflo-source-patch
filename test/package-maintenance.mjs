import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'rsp-package-maintenance-'));
process.env.RUFLO_SOURCE_PATCH_HOME=scratch;
process.env.RUFLO_NPX_ROOT=path.join(scratch,'.npm/_npx');
process.env.RUFLO_GLOBAL_ROOT=path.join(scratch,'global');
const {configurePackageMaintenance,runPackageMaintenance,packageMaintenanceStatus,cacheDisposition}=await import('../lib/cwd/package-maintenance.mjs');
const npm=path.join(scratch,'bin/npm');fs.mkdirSync(path.dirname(npm),{recursive:true});fs.writeFileSync(npm,'fixture');
const now=Date.now(),root=process.env.RUFLO_NPX_ROOT,calls=[];
function cache(key,name,version,age=0){const dir=path.join(root,key);fs.mkdirSync(path.join(dir,'node_modules',name),{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({dependencies:{[name]:version}}));fs.writeFileSync(path.join(dir,'node_modules',name,'package.json'),JSON.stringify({name,version}));fs.utimesSync(dir,new Date(now-age*86400000),new Date(now-age*86400000));}
try {
 assert.deepEqual(runPackageMaintenance(),{skipped:'not-enabled'});
 assert.throws(()=>configurePackageMaintenance({enabled:true,npm,prefixes:['relative']}),/Invalid/);
 configurePackageMaintenance({enabled:true,npm,prefixes:[scratch],npmSpec:'npm@latest'});
 cache('1111111111111111','ruflo','3.38.0');
 cache('2222222222222222','ruflo','3.38.0');
 cache('3333333333333333','other','1.0.0',31);
 cache('4444444444444444','ruvnet-brain','4.0.0',50);
 cache('5555555555555555','other','1.0.0');
 cache('6666666666666666','ruflo','3.38.0');fs.mkdirSync(path.join(root,'6666666666666666/.swarm'));
 cache('7777777777777777','ruflo','3.38.0');fs.mkdirSync(path.join(scratch,'.codex'));fs.writeFileSync(path.join(scratch,'.codex/config.toml'),path.join(root,'7777777777777777/node_modules/ruflo/bin/ruflo.js'));
 const run=(file,args)=>{calls.push([file,args]);if(args[0]==='view')return '3.59.1\n';if(file==='/bin/ps')return 'node '+path.join(root,'2222222222222222/node_modules/ruflo/bin/ruflo.js');if(file.endsWith('lsof'))return '';if(args.slice(0,3).join(' ')==='cache npx rm'){fs.rmSync(path.join(root,args[3]),{recursive:true});return ''; }if(args[0]==='--version')return '12.2.0';return 'verified';};
 const r=runPackageMaintenance({force:true,run});assert.equal(r.status,'passed');
 assert.deepEqual(r.removed.map(x=>x.key),['1111111111111111','3333333333333333']);
 for(const key of ['2222222222222222','4444444444444444','5555555555555555','6666666666666666','7777777777777777'])assert(fs.existsSync(path.join(root,key)));
 assert(calls.some(([,a])=>a.includes('--engine-strict')));assert(calls.some(([,a])=>a.join(' ')==='cache verify'));
 assert.deepEqual(runPackageMaintenance({run:()=>{throw Error('should not run');}}),{skipped:'not-due'});
 const refused=runPackageMaintenance({force:true,run:()=>{throw Error('unavailable');}});assert.equal(refused.status,'failed');assert.equal(packageMaintenanceStatus().receipt.status,'failed');
 const base={key:'8888888888888888',packages:[{name:'ruflo',version:'3.0.0'}],modifiedAt:now,unsafe:true};assert.equal(cacheDisposition(base,{now,versions:{ruflo:'3.59.1'},protectedKeys:new Set()}),'unclassified');
 configurePackageMaintenance({enabled:false,npm,prefixes:[scratch]});assert.equal(runPackageMaintenance().skipped,'not-enabled');
 console.log('package maintenance: opt-in, cadence, native engine-strict updates/removal/verify, expiry, active/config/Brain/runtime protection, and truthful failure');
} finally {fs.rmSync(scratch,{recursive:true,force:true});}
