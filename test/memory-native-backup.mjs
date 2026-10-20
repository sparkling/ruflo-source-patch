import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MEMORY_NATIVE_BACKUP_ENTRIES, BACKUP_IMPORT, BACKUP_FAILURE, BACKUP_SUCCESS,
  BACKUP_OPTION, BACKUP_FORWARD } from '../lib/cwd/memory-native-backup.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-backup-proof-'));
process.env.RUFLO_SOURCE_PATCH_HOME = root;
process.env.RUFLO_NPX_ROOT = path.join(root, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(root, 'global');
const { composeCliContribution, apply } = await import('../lib/cwd/patch-library.mjs');
const service = `export async function backupMemoryDb(opts = {}) {
${BACKUP_IMPORT}
    } catch { return {backedUp:false}; }
    let db;
    const dbPath=opts.dbPath,destPath='/fixture/snapshot.db';
    try {db=new Database(dbPath,{readonly:true});await db.backup(destPath);db.close();}
    catch(e) {
        try {db?.close();} catch {}
${BACKUP_FAILURE}
        fs.copyFileSync(dbPath,destPath);
        return {backedUp:true};
    }
    const sizeBytes=8192,rotatedAway=[],gcsUri=undefined;
${BACKUP_SUCCESS}
}`;
const command = `export const backupCommand = {
 options:[
${BACKUP_OPTION}
 ], action: async ctx => ({
${BACKUP_FORWARD}
 })
};`;
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
async function exercise(source, nativeOnly, failed = true) {
  let copied=0,closed=0;
  class Database {async backup(){if(failed)throw Error('SQLITE_BUSY');}close(){closed++;}}
  const body=source.replace('export async function','async function')
    .replace('(await import(mod)).default','Database');
  const run=new AsyncFunction('fs','Database','loadBetterSqlite3','opts',body+'\nreturn backupMemoryDb(opts);');
  const result=await run({copyFileSync(){copied++;}},Database,async()=>Database,{dbPath:'/fixture/live.db',nativeOnly});
  return {result,copied,closed};
}
try {
  const fixed=composeCliContribution(service,[MEMORY_NATIVE_BACKUP_ENTRIES[0]]);
  assert.deepEqual(fixed.missing,[]);
  assert.equal((await exercise(service,true)).copied,1,'pristine failure must demonstrate the unsafe fallback');
  const refused=await exercise(fixed.next,true);
  assert.equal(refused.result.backedUp,false);assert.equal(refused.copied,0);assert.equal(refused.closed,1);
  assert.equal(refused.result.skipped,'native-online-backup-failed');
  const success=await exercise(fixed.next,true,false);
  assert.equal(success.result.method,'sqlite-online-backup');assert.equal(success.result.backedUp,true);assert.equal(success.copied,0);
  assert.equal((await exercise(fixed.next,false)).copied,1,'explicit native-only does not silently rewrite legacy encrypted compatibility');
  const cli=composeCliContribution(command,[MEMORY_NATIVE_BACKUP_ENTRIES[1]]);
  assert.deepEqual(cli.missing,[]);
  const tool=await new AsyncFunction(cli.next.replace('export const','const')+'\nreturn backupCommand;')();
  assert(tool.options.some(option=>option.name==='native-only'));
  assert.equal((await tool.action({flags:{'native-only':true}})).nativeOnly,true);
  assert.equal((await tool.action({flags:{}})).nativeOnly,false);
  const files=[service,command].map((source,index)=>{
    const file=path.join(process.env.RUFLO_GLOBAL_ROOT,...MEMORY_NATIVE_BACKUP_ENTRIES[index].suffix);
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);return file;
  });
  const first=apply(['memory']);assert.equal(first.errors,0);assert.equal(first.incomplete,0);assert.equal(first.patched,2);
  assert.equal(apply(['memory']).patched,0);apply([]);
  assert.equal(fs.readFileSync(files[0],'utf8'),service);assert.equal(fs.readFileSync(files[1],'utf8'),command);
  // Execute the exact published 3.59.1 function with fault-injected I/O only.
  const modern=fs.readFileSync(new URL('./fixtures/memory-backup-3.59.1.js',import.meta.url),'utf8');
  const entry=MEMORY_NATIVE_BACKUP_ENTRIES.find(e=>e.id==='memory/native-online-backup-modern');
  const modernFixed=composeCliContribution(modern,MEMORY_NATIVE_BACKUP_ENTRIES);
  assert.deepEqual(modernFixed.missing,[]);
  assert(modernFixed.next.includes('explicit native-only'));
  assert(!modernFixed.next.includes("method: 'sqlite-online-backup'"),'preserve the native method receipt');
  async function runModern(source,{nativeOnly=false,encrypted=false,wal=false,failed=true}={}) {
    let copied=0;
    class Database {async backup(){if(failed)throw Error('SQLITE_BUSY');}close(){}}
    const body=source.replace('export async function','async function')
      .replace('(await import(mod)).default','Database');
    const run=new AsyncFunction('fs','path','Database','loadBetterSqlite3','existingFileIsEncrypted',
      'hasActiveWal','finishBackup','snapshotPrefix','fileStamp','defaultMemoryDbPath','opts',
      body+'\nreturn backupMemoryDb(opts);');
    const io={existsSync:()=>true,mkdirSync(){},statSync:()=>({size:8192}),rmSync(){},copyFileSync(){copied++;}};
    const result=await run(io,path,Database,async()=>Database,()=>encrypted,()=>wal,
      async(_a,_b,_c,_d,method)=>({backedUp:true,method}),()=> 'snapshot-',()=> 'time',()=> '/fixture/source.db',
      {dbPath:'/fixture/source.db',nativeOnly});
    return {result,copied};
  }
  assert.equal((await runModern(modern)).copied,0,'native ordinary-source failure is already fixed upstream');
  assert.equal((await runModern(modern,{nativeOnly:true,encrypted:true})).copied,1,'pristine native-only contract is still missing');
  const modernRefused=await runModern(modernFixed.next,{nativeOnly:true,encrypted:true});
  assert.equal(modernRefused.copied,0);assert.equal(modernRefused.result.backedUp,false);
  assert.equal((await runModern(modernFixed.next,{encrypted:true})).copied,1,'keep native encrypted compatibility');
  assert.equal((await runModern(modernFixed.next,{encrypted:true,wal:true})).copied,0);
  assert.equal((await runModern(modernFixed.next,{failed:false})).result.method,'native-online-backup');
  assert(composeCliContribution(modern.replace('existingFileIsEncrypted(dbPath) !== true','changed(dbPath)'),[entry]).missing.length);
  console.log('3.59.1 backup: native ordinary refusal retained; encrypted native-only mutant fails; method and WAL behavior preserved');
  console.log('native backup: failed native snapshot refuses copying; success has method receipt; CLI forwards explicit requirement; lifecycle preserves pristine');
} finally {fs.rmSync(root,{recursive:true,force:true});}
