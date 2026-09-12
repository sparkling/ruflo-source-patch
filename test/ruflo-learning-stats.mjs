import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { UNIFIED_OLD, UNIFIED_NEW, NEURAL_OLD, NEURAL_NEW, DESCRIPTION_OLD } from '../lib/ruflo-learning-stats/patcher.mjs';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'learning-stats-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
const root = path.join(scratch, 'npx', 'fixture', 'node_modules', '@claude-flow', 'cli');
const mem = path.join(root, 'dist', 'src', 'memory');
const neural = path.join(root, 'dist', 'src', 'mcp-tools');
fs.mkdirSync(mem, { recursive: true });
fs.mkdirSync(neural, { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), '{"name":"@claude-flow/cli","version":"fixture","type":"module"}');
const intelPrefix = `import { existsSync, readFileSync } from 'node:fs';
const data = ${JSON.stringify(scratch)};
let intelligenceInitialized = false;
let sonaCoordinator = null;
let reasoningBank = null;
export function setState(s, bank) { sonaCoordinator = s; reasoningBank = bank; intelligenceInitialized = !!s; }
function getStatsPath() { return data + '/stats.json'; }
function getPatternsPath() { return data + '/patterns.json'; }
function getIntelligenceStats() { return { patternsLearned: 1000, trajectoriesRecorded: 999, signalsProcessed: 9000 }; }
`;
const neuralPrefix = `import { existsSync, readFileSync } from 'node:fs';
function getNeuralPath() { return ${JSON.stringify(path.join(scratch, 'models.json'))}; }
`;
const bridgeSource = `export async function getMemoryBridgeStats() {
    const namespaces = [
        'default', 'patterns', 'claude-memories', 'auto-memory',
    ];
    return { reachable: true, totalEntries: 8, perNamespace: Object.fromEntries(namespaces.map(n => [n, 1])) };
}
`;
const intelFile = path.join(mem, 'intelligence.js');
const neuralFile = path.join(neural, 'neural-tools.js');
const bridgeFile = path.join(mem, 'memory-bridge.js');
fs.writeFileSync(intelFile, intelPrefix + UNIFIED_OLD);
fs.writeFileSync(neuralFile, neuralPrefix + NEURAL_OLD);
fs.writeFileSync(bridgeFile, bridgeSource);
fs.writeFileSync(path.join(neural, 'hooks-tools.js'), 'export const tool = {\n' + DESCRIPTION_OLD + '\n};');
const { apply } = await import('../lib/cwd/patch-library.mjs');
try {
  const applied = apply(['ruflo-learning-stats']);
  assert.equal(applied.patched, 4);
  assert.equal(applied.incomplete, 0);
  assert.equal(fs.readFileSync(intelFile + '.rsp-backup', 'utf8'), intelPrefix + UNIFIED_OLD);
  assert.equal(apply(['ruflo-learning-stats']).patched, 0);
  const intel = await import(pathToFileURL(intelFile).href);
  fs.writeFileSync(path.join(scratch, 'stats.json'), JSON.stringify({ patternsLearned: 773, trajectoriesRecorded: 723, signalsProcessed: 7191 }));
  fs.writeFileSync(path.join(scratch, 'patterns.json'), JSON.stringify([{ id: 'retained-1' }, { id: 'retained-2' }]));
  let result = await intel.getUnifiedLearningStats();
  assert.equal(result.global.trajectoriesRecorded, 723, 'fresh process reads persisted totals');
  assert.equal(result.globalInProcess.trajectoriesRecorded, 999, 'process cache is distinct');
  assert.equal(result.reasoningBank.patternCount, 2, 'retained patterns visible before coordinator init');
  assert.equal(result.sona.trajectoriesTotal, null, 'unavailable is not a fake zero');
  assert.equal(result.consistency.sonaTracksGlobal, null);
  assert.equal(result.neuralPatterns.patternCount, 0, 'absent optional store is empty');
  assert.match(result.neuralPatterns.source, /models\.json/);
  assert.equal(result.neuralPatterns.readStatus, 'absent');
  assert.equal(result.memoryBridge.perNamespace.pattern, 1);
  intel.setState({ stats: () => ({ trajectoryCount: 3, avgAdaptationMs: 0.5 }) }, { stats: () => ({ patternCount: 1 }) });
  result = await intel.getUnifiedLearningStats();
  assert.equal(result.sona.trajectoriesTotal, 3, 'actual coordinator field is mapped');
  assert.equal(result.sona.avgAdaptationTimeMs, 0.5);
  assert.equal(result.reasoningBank.inMemoryCount, 1, 'cache lag remains visible');
  assert.equal(result.reasoningBank.patternCount, 2);
  assert.equal(result.consistency.comparable, false, 'bounded buffer is not lifetime count');
  assert.ok(result.consistency.notes.every(n => !/expected to track/.test(n)));
  fs.writeFileSync(path.join(scratch, 'models.json'), JSON.stringify({models: {m: {}}, patterns: {p: {type: 'task'}}}));
  result = await intel.getUnifiedLearningStats();
  assert.equal(result.neuralPatterns.patternCount, 1);
  assert.equal(result.neuralPatterns.byType.task, 1);
  fs.writeFileSync(path.join(scratch, 'models.json'), 'broken');
  result = await intel.getUnifiedLearningStats();
  assert.equal(result.neuralPatterns.available, false);
  assert.equal(result.neuralPatterns.patternCount, null, 'unreadable is not an empty store');
  fs.writeFileSync(path.join(scratch, 'patterns.json'), '{}');
  fs.writeFileSync(path.join(scratch, 'stats.json'), 'broken');
  result = await intel.getUnifiedLearningStats();
  assert.equal(result.reasoningBank.patternCount, null);
  assert.equal(result.global.trajectoriesRecorded, null);
  for (const file of [intelFile, neuralFile, bridgeFile]) assert.equal(spawnSync(process.execPath, ['--check', file]).status, 0);
  apply([]);
  assert.equal(fs.readFileSync(intelFile, 'utf8'), intelPrefix + UNIFIED_OLD);
  assert.equal(fs.readFileSync(neuralFile, 'utf8'), neuralPrefix + NEURAL_OLD);
  assert.equal(fs.readFileSync(bridgeFile, 'utf8'), bridgeSource);
  fs.writeFileSync(neuralFile, neuralPrefix + NEURAL_OLD.replace('neural/patterns.json', 'neural/models.json'));
  const alternate = apply(['ruflo-learning-stats']);
  assert.equal(alternate.incomplete, 0, 'both observed native source-label variants are supported');
  assert.ok(fs.readFileSync(neuralFile, 'utf8').includes(NEURAL_NEW));
  apply([]);
  fs.writeFileSync(intelFile, intelPrefix + UNIFIED_OLD.replace('const intel = getIntelligenceStats();', 'const intel = changedUpstream();'));
  const drift = apply(['ruflo-learning-stats']);
  assert.ok(drift.incomplete > 0 || drift.skipped > 0, 'unknown upstream source is not silently patched');
  assert.ok(fs.readFileSync(intelFile, 'utf8').includes('changedUpstream()'));
  console.log('Learning stats: persistence, buffer/reset scope, source paths, errors, namespace, idempotence, reversal, anchor drift and syntax passed.');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
