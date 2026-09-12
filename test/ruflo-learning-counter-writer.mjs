import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { COUNTER_SUPPORT_NEW, COUNTER_IMPORT_NEW } from '../lib/ruflo-learning-stats/counter-writer.mjs';

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'counter-writer-test-')));
const file = path.join(dir, 'stats.json');
const moduleFile = path.join(dir, 'counter.mjs');
fs.writeFileSync(moduleFile, `${COUNTER_IMPORT_NEW}
let currentPath = ${JSON.stringify(file)};
let globalStats = { trajectoriesRecorded: 0, patternsLearned: 0, signalsProcessed: 0, lastAdaptation: null };
function getStatsPath() { return currentPath; }
function ensureDataDir() {}
${COUNTER_SUPPORT_NEW}
export const load = loadPersistedStats;
export const save = savePersistedStats;
export function bump(n=1) { globalStats.trajectoriesRecorded += n; globalStats.patternsLearned += n; globalStats.signalsProcessed += n; }
export function error() { return counterPersistenceError; }
export function changePath(p) { currentPath=p; }
`);
const baseline = { trajectoriesRecorded: 100, patternsLearned: 200, signalsProcessed: 300, lastAdaptation: 50 };
try {
  fs.writeFileSync(file, JSON.stringify(baseline));
  const a = await import(pathToFileURL(moduleFile).href + '?a');
  const b = await import(pathToFileURL(moduleFile).href + '?b');
  a.load(); b.load();
  a.bump(3); b.bump(5);
  assert.equal(a.save(), true);
  assert.equal(b.save(), true);
  assert.equal(JSON.parse(fs.readFileSync(file)).trajectoriesRecorded, 108, 'stale process adds its delta rather than replacing a newer total');
  assert.equal(a.save(), true);
  assert.equal(b.save(), true);
  assert.equal(JSON.parse(fs.readFileSync(file)).trajectoriesRecorded, 108, 'repeat flushes do not duplicate increments');

  // Six processes load the same snapshot before any write; a barrier tests overlap.
  const child = path.join(dir, 'child.mjs');
  fs.writeFileSync(child, `import * as c from './counter.mjs';
c.load(); process.send('ready'); process.on('message', () => {
  for (let i=0;i<10;i++) { c.bump(); if(!c.save()) throw new Error(c.error()); }
  process.exit(0);
});`);
  const workers = Array.from({length:6},()=>spawn(process.execPath,[child],{stdio:['ignore','ignore','pipe','ipc']}));
  const exits = workers.map(w => new Promise((resolve,reject)=>{
    let stderr=''; w.stderr.on('data',d=>stderr+=d);
    w.on('error',reject); w.on('exit',code=>code===0?resolve():reject(new Error(stderr||String(code))));
  }));
  await Promise.all(workers.map(w=>new Promise(resolve=>w.once('message',resolve))));
  workers.forEach(w=>w.send('go'));
  await Promise.all(exits);
  let result = JSON.parse(fs.readFileSync(file));
  assert.equal(result.trajectoriesRecorded,168);
  assert.equal(result.patternsLearned,268);
  assert.equal(result.signalsProcessed,368);

  // A held lock never leads to an unbounded spin, destructive stealing or lost delta.
  const lock=file+'.rsp-counter-lock';
  fs.mkdirSync(lock); a.bump(2);
  const started=Date.now();
  assert.equal(a.save(),false);
  assert.ok(Date.now()-started<2000);
  assert.match(a.error(),/lock busy/);
  assert.ok(fs.existsSync(lock));
  fs.rmdirSync(lock);
  assert.equal(a.save(),true);
  assert.equal(JSON.parse(fs.readFileSync(file)).trajectoriesRecorded,170);
  assert.equal(a.error(),null);

  fs.writeFileSync(file,'malformed'); a.bump(1);
  assert.equal(a.save(),false);
  assert.equal(fs.readFileSync(file,'utf8'),'malformed','bad store never overwritten with fabricated counters');
  fs.writeFileSync(file,JSON.stringify({...baseline,trajectoriesRecorded:170,patternsLearned:270,signalsProcessed:370}));
  assert.equal(a.save(),true);
  assert.equal(JSON.parse(fs.readFileSync(file)).trajectoriesRecorded,171,'failed write retains exact pending delta');
  a.changePath(path.join(dir,'another.json'));
  assert.equal(a.save(),false);
  assert.match(a.error(),/path changed/);
  assert.equal(fs.existsSync(path.join(dir,'another.json')),false);
  assert.equal(fs.readdirSync(dir).filter(p=>p.endsWith('.tmp')).length,0);
  console.log('Counter writer: stale snapshots, six concurrent processes, idempotence, bounded lock failure, retry, corrupt store, path isolation and temporary-file cleanup passed.');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
