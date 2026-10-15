// Current upstream shapes execute through the same owners; no managed databases.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { COUNTER_IMPORT_NATIVE, COUNTER_LOAD_NATIVE, COUNTER_SAVE_NATIVE } from '../lib/ruflo-learning-stats/native-counter.mjs';
import { UNIFIED_351, LEARNING_STATS_ENTRIES, COUNTER_HEALTH_PRIOR, COUNTER_HEALTH_CURRENT } from '../lib/ruflo-learning-stats/patcher.mjs';
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-current-')));
process.env.RUFLO_SOURCE_PATCH_HOME = path.join(dir, 'home');
process.env.RUFLO_NPX_ROOT = path.join(dir, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(dir, 'global');
const { composeCliContribution, historicalCliContribution, cliClaimApplied, apply, ENTRIES } = await import('../lib/cwd/patch-library.mjs');
const entries = LEARNING_STATS_ENTRIES.filter(e => e.suffix.at(-1) === 'intelligence.js');
const file = path.join(dir, 'stats.json');
const pristine = `${COUNTER_IMPORT_NATIVE}
const file = ${JSON.stringify(file)};
let globalStats = {trajectoriesRecorded:0,patternsLearned:0,signalsProcessed:0,lastAdaptation:null};
let pendingDelta = {trajectoriesRecorded:0,patternsLearned:0,signalsProcessed:0};
let persistedStatsLoaded = false;
const sonaCoordinator = null, reasoningBank = null, intelligenceInitialized = true;
function ensureDataDir() {}
function getStatsPath() { return file; }
function getPatternsPath() { return file + '.patterns'; }
function getIntelligenceStats() { return globalStats; }
${COUNTER_LOAD_NATIVE}
${COUNTER_SAVE_NATIVE}
export const load = loadPersistedStats;
export const save = savePersistedStats;
export function bump(n) { globalStats.signalsProcessed += n; pendingDelta.signalsProcessed += n; }
${UNIFIED_351}`;
try {
  const compiled = composeCliContribution(pristine, entries);
  assert.deepEqual(compiled.missing, []);
  const target = path.join(dir, 'counter.mjs'); fs.writeFileSync(target, compiled.next);
  const a = await import(pathToFileURL(target).href + '?a');
  const b = await import(pathToFileURL(target).href + '?b');
  fs.writeFileSync(file, JSON.stringify({trajectoriesRecorded:10,patternsLearned:20,signalsProcessed:30}));
  a.bump(2); a.load(); // Native late load must retain increments not yet saved.
  b.load(); b.bump(3);
  assert.equal(a.save(), true); assert.equal(b.save(), true);
  assert.equal(JSON.parse(fs.readFileSync(file)).signalsProcessed, 35);
  assert.equal(a.save(), true); assert.equal(JSON.parse(fs.readFileSync(file)).signalsProcessed, 35);
  fs.mkdirSync(file + '.rsp-counter-lock'); b.bump(4);
  assert.equal(b.save(), false); fs.rmdirSync(file + '.rsp-counter-lock');
  assert.equal(b.save(), true); assert.equal(JSON.parse(fs.readFileSync(file)).signalsProcessed, 39);
  const report = await b.getUnifiedLearningStats();
  assert.equal(report.counterWriter.contract, 'delta-lock-v1'); assert.equal(report.counterWriter.lastError, null);
  assert.equal(report.global.signalsProcessed, 39);
  // Changed counter anchors must produce a truthful degraded report, never ReferenceError.
  const drift = composeCliContribution(pristine.replace('function loadPersistedStats() {', 'function loadPersistedStats() { /* upstream drift */'), entries);
  assert.ok(drift.missing.length);
  const broken = path.join(dir, 'unknown.mjs'); fs.writeFileSync(broken, drift.next);
  const unavailable = await (await import(pathToFileURL(broken))).getUnifiedLearningStats();
  assert.equal(unavailable.counterWriter.contract, 'unavailable');
  assert.match(unavailable.counterWriter.lastError, /unavailable/);
  // The previous released health line remains an exactly reconstructible composition.
  const old = compiled.next.replace(COUNTER_HEALTH_CURRENT, COUNTER_HEALTH_PRIOR);
  assert.equal(historicalCliContribution(pristine, old, entries).next, old);
  const partial = composeCliContribution(pristine, entries.filter(e => e.id.endsWith('/unified'))).next
    .replace(COUNTER_HEALTH_CURRENT, COUNTER_HEALTH_PRIOR);
  assert.equal(cliClaimApplied(partial, entries), true, 'previous partial patch is owned before backup classification');
  const pkg = path.join(dir, 'npx/cache/node_modules/@claude-flow/cli');
  const installed = path.join(pkg, 'dist/src/memory/intelligence.js');
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"@claude-flow/cli","version":"fixture"}');
  fs.writeFileSync(installed, partial); fs.writeFileSync(installed + '.rsp-backup', pristine);
  const upgrade = apply(['ruflo-learning-stats']);
  assert.equal(upgrade.errors, 0, upgrade.log.join('\n')); assert.equal(upgrade.incomplete, 0);
  assert.equal(fs.readFileSync(installed + '.rsp-backup', 'utf8'), pristine, 'upgrade must never adopt the partial patch as vendor source');
  assert.ok(fs.readFileSync(installed, 'utf8').includes(COUNTER_HEALTH_CURRENT));
  assert.equal(apply(['ruflo-learning-stats']).patched, 0);
  const cwdEntries = ENTRIES.filter(e => ['state/claims', 'state/neural-datadir'].includes(e.id));
  fs.mkdirSync(path.join(dir, '.git')); const nested = path.join(dir, 'docs'); fs.mkdirSync(nested);
  const claims = composeCliContribution("import { resolve } from 'node:path';\nconst CLAIMS_CONFIG_PATHS=['.claude-flow/claims.json','claude-flow.claims.json'];\nexport function claim() { return [resolve(CLAIMS_CONFIG_PATHS[0]),\nresolve(CLAIMS_CONFIG_PATHS[1]),]; }", [cwdEntries[0]]);
  assert.deepEqual(claims.missing, []);
  const claimFile = path.join(dir, 'claims.mjs'); fs.writeFileSync(claimFile, claims.next);
  const neural = composeCliContribution("import { join } from 'node:path';\nfunction getProjectCwd() { return process.cwd(); }\nfunction getDataDir() { const cwd = getProjectCwd(); return join(cwd,'.claude-flow','neural'); }\nexport {getDataDir};", [cwdEntries[1]]);
  assert.deepEqual(neural.missing, []);
  const neuralFile = path.join(dir, 'neural.mjs'); fs.writeFileSync(neuralFile, neural.next);
  const cwd = process.cwd(); try {
    process.chdir(nested);
    assert.deepEqual((await import(pathToFileURL(claimFile))).claim(), [path.join(dir,'.claude-flow/claims.json'),path.join(dir,'claude-flow.claims.json')]);
    assert.equal((await import(pathToFileURL(neuralFile))).getDataDir(), path.join(dir,'.claude-flow/neural'));
  } finally { process.chdir(cwd); }
  console.log('Current compatibility: native pending deltas, late load, stale writers, retry, statistics degradation, prior composition and nested project roots passed.');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
