// Execute the published activity/verified-outcome session handler, with only
// the native database bridge stubbed. Optional SONA is absent in this fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO, findVendorRootWith, pristineBytes } from './fixtures.mjs';
import { ENTRIES, composeCliContribution } from '../lib/cwd/patch-library.mjs';

const SB = path.resolve(process.argv[2]);
const HOME = path.join(SB, 'home');
const NPX = path.join(SB, 'npx');
const NM = path.join(NPX, 'current', 'node_modules');
const CLI = path.join(NM, '@claude-flow', 'cli');
const HOOKS = 'dist/src/mcp-tools/hooks-tools.js';
const SENTINEL = 'const verifiedOutcomes = await ingestVerifiedQuietly();';
const SOURCE = findVendorRootWith(HOOKS, [SENTINEL]);
const env = { ...process.env, HOME, CLAUDE_FLOW_CWD: '', RUFLO_SOURCE_PATCH_HOME: HOME,
  RUFLO_NPX_ROOT: NPX, RUFLO_GLOBAL_ROOT: path.join(SB, 'global'),
  RSP_NO_HOST_AUTO_UPDATE: '1', RSP_NO_LAUNCHCTL: '1', RSP_NO_SELF_UPDATE: '1',
  RSP_NO_MONITOR_RECOVER: '1', RSP_NO_STALE_WRITER_KILL: '1' };
const out = run => `${run.stdout || ''}${run.stderr || ''}`;
const cli = (...args) => spawnSync(process.execPath, [path.join(REPO, 'bin/cli.mjs'), ...args],
  { env, encoding: 'utf8', timeout: 30_000 });
const write = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const pristine = pristineBytes(path.join(SOURCE, '@claude-flow/cli', HOOKS)).toString('utf8');
const dependencies = [
  'memory/feedback-patterns.js', 'mcp-tools/types.js', 'mcp-tools/validate-input.js',
  'services/command-recording.js', 'mcp-tools/tool-loop-guardrail.js',
  'services/learned-routing.js', 'ruvector/typesafe-router.js', 'ruvector/router-embedder.js',
  'memory/verified-outcomes.js', 'memory/verified-guards.js', 'memory/verified-reverify.js',
];

for (const modern of [true, false]) {
  fs.rmSync(SB, { recursive: true, force: true });
  write(path.join(HOME, '.claude/settings.json'), '{}');
  write(path.join(CLI, 'package.json'), '{"name":"@claude-flow/cli","type":"module"}');
  for (const rel of dependencies) write(path.join(CLI, 'dist/src', rel),
    pristineBytes(path.join(SOURCE, '@claude-flow/cli/dist/src', rel)));
  const core = path.join(NM, '@claude-flow/cli-core');
  write(path.join(core, 'package.json'), pristineBytes(path.join(SOURCE, '@claude-flow/cli-core/package.json')));
  for (const name of ['types', 'validate-input']) write(path.join(core, 'dist/src/mcp-tools', `${name}.js`),
    pristineBytes(path.join(SOURCE, '@claude-flow/cli-core/dist/src/mcp-tools', `${name}.js`)));
  const source = modern ? pristine : pristine
    .replace(`        ${SENTINEL}\n`, '').replace('            verifiedOutcomes,\n', '');
  const file = path.join(CLI, HOOKS);
  write(file, source);
  const installed = cli('cwd', 'install');
  assert.equal(installed.status, 0, out(installed));
  const status = cli('cwd', 'status');
  assert.equal(status.status, 0, out(status));
  assert.match(out(status), /cwd\s+\d+\/\d+ file\(s\) satisfied/);
  const bridge = path.join(CLI, 'dist/src/memory/memory-bridge.js');
  write(bridge, `
export async function bridgeSessionEnd(value) { globalThis.bridgeInput = value; return { controller: 'fixture', persisted: true }; }
export async function shutdownBridge() { globalThis.bridgeClosed = true; }
`);
  const project = path.join(SB, 'project');
  const deep = path.join(project, 'src/deep/nested');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  fs.mkdirSync(deep, { recursive: true });
  const projectReal = fs.realpathSync(project);
  const startedAt = new Date(Date.now() - 120_000).toISOString();
  const completedAt = new Date(Date.now() - 60_000).toISOString();
  const sessionFile = path.join(project, '.claude-flow/sessions/current.json');
  write(sessionFile, JSON.stringify({ id: 'current', startedAt, metrics: { edits: 3, commands: 4, errors: 1 } }));
  write(path.join(project, '.claude-flow/tasks/store.json'), JSON.stringify({ tasks: {
    current: { status: 'completed', completedAt }, pending: { status: 'pending' },
  } }));
  write(path.join(project, '.claude-flow/memory/store.json'), JSON.stringify({ entries: {
    learned: { key: 'learned-pattern', storedAt: completedAt }, agent: { key: 'agent-one' },
  } }));
  write(path.join(project, '.claude-flow/data/pending-insights.jsonl'), '{}\n{}\n');
  const runner = path.join(SB, 'session-behavior.mjs');
  write(runner, `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { hooksSessionEnd } from ${JSON.stringify(pathToFileURL(file).href)};
const project = ${JSON.stringify(projectReal)}, sessionFile = ${JSON.stringify(sessionFile)};
const modern = ${modern};
const snapshotDir = path.join(project, '.claude/sessions');
const call = options => hooksSessionEnd.handler({ stopDaemon: false, ...options });
const withoutSave = await call({ saveState: false });
assert.equal(withoutSave.statePath, undefined);
assert.equal(fs.existsSync(snapshotDir), false, 'saveState:false wrote a snapshot');
const result = await call({});
assert.equal(result.statePath, path.join(snapshotDir, 'current.json'));
const saved = JSON.parse(fs.readFileSync(result.statePath, 'utf8'));
const { statePath, ...snapshot } = result;
const { savedAt, ...persisted } = saved;
assert.deepEqual(persisted, snapshot);
assert.ok(Number.isFinite(Date.parse(savedAt)));
assert.ok(result.duration >= 120_000);
assert.deepEqual(result.summary, { tasksExecuted: 1, filesModified: 3, agentsSpawned: 1, pendingInsights: 2, memoryEntries: 2 });
assert.deepEqual(result.learningUpdates, { patternsLearned: 1, trajectoriesRecorded: 0 });
assert.deepEqual(result.sessionPersistence, { controller: 'fixture', persisted: true });
assert.equal(globalThis.bridgeInput.tasksCompleted, 1);
assert.equal(globalThis.bridgeInput.patternsLearned, 1);
assert.equal(globalThis.bridgeClosed, true);
assert.equal(Object.hasOwn(result, 'verifiedOutcomes'), modern);
if (modern) {
  assert.equal(result.verifiedOutcomes.skipped, 'no-file');
  assert.equal(result.verifiedOutcomes.sonaAvailable, false);
  assert.equal(result.verifiedOutcomes.trained, 0);
  assert.deepEqual(saved.verifiedOutcomes, result.verifiedOutcomes);
}
for (const operation of ['writeFileSync', 'renameSync']) {
  const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  session.id = operation;
  fs.writeFileSync(sessionFile, JSON.stringify(session));
  const original = fs[operation];
  fs[operation] = (...args) => {
    if (String(args[0]).startsWith(path.join(snapshotDir, operation + '.json'))) {
      throw Object.assign(new Error('injected ' + operation), { code: 'EACCES' });
    }
    return original(...args);
  };
  syncBuiltinESMExports();
  try { await assert.rejects(call({}), new RegExp('injected ' + operation)); }
  finally { fs[operation] = original; syncBuiltinESMExports(); }
  assert.equal(fs.existsSync(path.join(snapshotDir, operation + '.json')), false);
}
assert.equal(fs.existsSync(path.join(process.cwd(), '.claude')), false);
assert.equal(fs.existsSync(path.join(process.cwd(), '.claude-flow')), false);
`);
  const run = spawnSync(process.execPath, [runner], { env, cwd: deep, encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 0, out(run));
  fs.unlinkSync(bridge);
  const patched = fs.readFileSync(file, 'utf8');
  write(file, patched.replace('        return { ...snapshot, statePath };', '        return snapshot;'));
  assert.notEqual(cli('cwd', 'status').status, 0, 'mutated snapshot passed status');
  assert.notEqual(cli('monitor', 'check').status, 0, 'mutated snapshot passed monitor');
  write(file, patched);
  const removed = cli('cwd', 'uninstall');
  assert.equal(removed.status, 0, out(removed));
  assert.equal(fs.readFileSync(file, 'utf8'), source, 'uninstall did not restore exact source');
  const returnAnchor = `            duration,\n            ${modern ? 'verifiedOutcomes,' : 'statePath:'}`;
  assert.ok(source.includes(returnAnchor));
  write(file, source.replace(returnAnchor, returnAnchor.replace('duration,', 'duration: duration + 1,')));
  const drifted = cli('cwd', 'install');
  assert.notEqual(drifted.status, 0, 'changed native return shape was silently accepted');
  assert.match(out(drifted), /skip:anchor-not-found.*session-(verified|activity)/);
  assert.notEqual(cli('cwd', 'status').status, 0, 'unpatched native return shape passed status');
  console.log(`✔ actual ${modern ? 'verified-outcome' : 'activity'} session handler: rooted atomic snapshots, native fields, no-save, failures, drift, exact uninstall`);
}

const pluginSource = pristineBytes(path.join(SOURCE, '@claude-flow/cli/dist/src/commands/plugins.js')).toString('utf8');
const pluginEntries = ENTRIES.filter(entry => entry.id.startsWith('plugin-hosts/commands'));
const composed = composeCliContribution(pluginSource, pluginEntries);
assert.deepEqual(composed.missing, []);
assert.equal(composed.applied.length, 1, 'both plugin variants applied');
assert.ok(composed.next.includes('rateCommand, verifyCommand, pathsCommand, __rspHostInstallCommand,'));
const driftedCommands = pluginSource.replace('rateCommand, verifyCommand, pathsCommand],', 'rateCommand, pathsCommand],');
assert.notEqual(driftedCommands, pluginSource, 'modern plugin mutation changed nothing');
const refused = composeCliContribution(driftedCommands, pluginEntries);
assert.equal(refused.missing.length, 1, 'modern native command drift was silently accepted');
assert.equal(refused.applied.length, 0);

// Reuse the complete host-operation suite for the modern native command list.
const plugins = spawnSync(process.execPath, [path.join(REPO, 'test/plugin-hosts.mjs'), path.join(SB, 'plugins'), 'modern'],
  { env, encoding: 'utf8', timeout: 60_000 });
assert.equal(plugins.status, 0, out(plugins));
console.log(out(plugins).trim());
