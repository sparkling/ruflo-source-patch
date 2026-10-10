// Explicit isolated native qualification; no managed project database is used.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {backupMemoryDb} from '../lib/ruflo-memory-backup/runtime.mjs';
const require=createRequire(process.env.RUFLO_AGENTDB_PACKAGE);const Database=require('better-sqlite3');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'rsp-backup-native-fixture-'))),source=path.join(root,'source.db'),destDir=path.join(root,'snapshots');fs.mkdirSync(destDir);
let owner,check;
try{
 owner=new Database(source);owner.pragma('journal_mode=WAL');owner.exec('CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ("placeholder")'.replace('"placeholder"',"'committed WAL value'"));
 assert(fs.statSync(source+'-wal').size>0);const walBefore=fs.statSync(source+'-wal');
 const context=vm.createContext({fs,path,loadBetterSqlite3:()=>{throw Error('must not load another source driver')},snapshotPrefix:()=> 'memory-',fileStamp:()=> 'fixture',defaultMemoryDbPath:()=>source});
 const run=vm.runInContext('('+backupMemoryDb.toString()+')',context);
 const receipt=await run({dbPath:source,destDir,existingNativeHandle:owner});assert.equal(receipt.backedUp,true,JSON.stringify(receipt));assert.equal(owner.open,true);
 assert.equal(owner.prepare('SELECT value FROM fixture').get().value,'committed WAL value');assert.equal(fs.statSync(source+'-wal').ino,walBefore.ino);
 // Snapshot verification is a separate fixture operation, never claimed by production receipt.
 check=new Database(receipt.path,{readonly:true});assert.equal(check.prepare('SELECT value FROM fixture').get().value,'committed WAL value');assert.equal(check.pragma('integrity_check',{simple:true}),'ok');
 console.log(JSON.stringify({isolated:true,liveProjectOpened:false,nativeWalSnapshotPreserved:true,sourceOwnerRemainsOpen:true,productionRestoreQualified:receipt.restoreQualified}));
}finally{check?.close();owner?.close();fs.rmSync(root,{recursive:true,force:true});}
