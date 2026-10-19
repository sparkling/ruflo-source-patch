// Opt-in native/mixed-version proof; all writes are synthetic JSON in tmpdir.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { nativeCounterSource, nativeCounterWriterSatisfied } from '../lib/ruflo-learning-stats/native-proof.mjs';
import { COUNTER_IMPORT_NEW } from '../lib/ruflo-learning-stats/counter-writer.mjs';
import { COUNTER_SUPPORT_NATIVE } from '../lib/ruflo-learning-stats/native-counter.mjs';

const cliRoot = fs.realpathSync(process.argv[2]);
const source = fs.readFileSync(path.join(cliRoot, 'dist/src/memory/intelligence.js'), 'utf8');
assert(nativeCounterWriterSatisfied(source), 'native writer must pass lock/delegation/data-integrity proof');
assert.equal(nativeCounterWriterSatisfied(source.replace('withStatsFileLock(statsPath, (path) => {', 'noLock(statsPath, (path) => {')), false);
assert.equal(nativeCounterWriterSatisfied(source.replace('(disk.signalsProcessed ?? 0) + pendingDelta.signalsProcessed', '(disk.signalsProcessed ?? 0) + 0')), false);
const body = nativeCounterSource(source);
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-counter-')));
const file = path.join(scratch, 'stats.json');
try {
  fs.symlinkSync(scratch, path.join(scratch, 'alias'), 'dir');
  const header = `${COUNTER_IMPORT_NEW}
import {join,dirname} from 'node:path';
const file=process.env.PROOF_STATS_FILE;
function ensureDataDir(){return dirname(file)}
function getStatsPath(){return file}
let globalStats={trajectoriesRecorded:0,patternsLearned:0,signalsProcessed:0,lastAdaptation:null};
let pendingDelta={trajectoriesRecorded:0,patternsLearned:0,signalsProcessed:0};
let persistedStatsLoaded=false;`;
  const exports = `export const load=loadPersistedStats,save=savePersistedStats;
export function bump(n=1){for(const k of ['trajectoriesRecorded','patternsLearned','signalsProcessed'])bumpStat(k,n)}
export const pending=()=>pendingDelta.signalsProcessed;`;
  const nativeFile = path.join(scratch, 'native.mjs'), legacyFile = path.join(scratch, 'legacy.mjs');
  fs.writeFileSync(nativeFile, header + `\nimport {withStatsFileLock} from ${JSON.stringify(pathToFileURL(path.join(cliRoot, 'dist/src/memory/stats-file-lock.js')).href)};\n` + body + '\n' + exports);
  const bump = body.match(/^function bumpStat\([^)]*\) \{[\s\S]*?^\}/m)[0];
  fs.writeFileSync(legacyFile, header + '\n' + bump + '\n' + COUNTER_SUPPORT_NATIVE + '\n' + exports);
  const child = path.join(scratch, 'child.mjs');
  fs.writeFileSync(child, `const c=await import(process.argv[2]);c.load();process.send('ready');process.on('message',()=>{
for(let i=0;i<20;i++){c.bump();const deadline=Date.now()+10000;do{c.save();if(!c.pending())break;if(Date.now()>deadline)throw Error('unflushed delta');}while(true)}process.exit(0)});`);
  fs.writeFileSync(file, JSON.stringify({ trajectoriesRecorded: 100, patternsLearned: 200, signalsProcessed: 300, lastAdaptation: 99 }));
  const workers = Array.from({ length: 6 }, (_, i) => spawn(process.execPath, [child, pathToFileURL(i % 2 ? legacyFile : nativeFile).href], {
    env: { PATH: process.env.PATH, HOME: scratch, PROOF_STATS_FILE: i % 2 ? path.join(scratch, 'alias/stats.json') : file },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  }));
  const ready = workers.map(w => new Promise((resolve, reject) => { w.once('message', resolve); w.once('error', reject); w.once('exit', code => { if (code) reject(Error('writer exited before readiness')); }); }));
  const exits = workers.map(w => new Promise((resolve, reject) => {
    let stderr = ''; w.stderr.on('data', d => { stderr += d; });
    w.once('error', reject); w.once('exit', code => code === 0 ? resolve() : reject(Error(stderr || String(code))));
  }));
  await Promise.all(ready); workers.forEach(w => w.send('go'));
  const settled = await Promise.allSettled(exits); const failed = settled.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { trajectoriesRecorded: 220, patternsLearned: 320, signalsProcessed: 420, lastAdaptation: 99 });
  process.env.PROOF_STATS_FILE = file;
  const native = await import(pathToFileURL(nativeFile)), legacy = await import(pathToFileURL(legacyFile));
  native.load(); legacy.load(); fs.mkdirSync(file + '.lock'); fs.writeFileSync(file + '.lock/foreign-owner', 'retained');
  const prior = fs.readFileSync(file, 'utf8'); native.bump(); legacy.bump(); native.save(); legacy.save();
  assert.equal(fs.readFileSync(file, 'utf8'), prior); assert.equal(native.pending(), 1); assert.equal(legacy.pending(), 1);
  assert.equal(fs.readFileSync(file + '.lock/foreign-owner', 'utf8'), 'retained');
  fs.unlinkSync(file + '.lock/foreign-owner'); fs.rmdirSync(file + '.lock'); native.save(); legacy.save();
  assert.equal(JSON.parse(fs.readFileSync(file)).signalsProcessed, 422);
  assert(!fs.readdirSync(scratch).some(name => name.endsWith('.tmp')));
  console.log('native counter retirement: six real concurrent native/legacy writers share canonical lock across aliases; exact totals; foreign lock retained; pending increments retry once; bad native writer mutations refused');
} finally { delete process.env.PROOF_STATS_FILE; fs.rmSync(scratch, { recursive: true, force: true }); }
