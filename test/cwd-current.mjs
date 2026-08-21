// Current-release project-root regressions that do not fit the older broad fixtures.
// Uses pristine installed vendor bytes, applies the real CLI, executes generated
// helpers/permission paths, and mutation-tests fail-honest replace-all status.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  REPO, findVendorRootWith, pristineBytes,
} from './fixtures.mjs';

const SB = process.argv[2];
const HOME = path.join(SB, 'home');
const NPX = path.join(SB, 'npx');
const NM = path.join(NPX, 'current', 'node_modules');
const CLI = path.join(NM, '@claude-flow', 'cli');
const SOURCE = findVendorRootWith('dist/src/permission/permission-audit.js', [
  "swarmDir ?? path.join(process.cwd(), '.swarm')",
]);
const REL = {
  permission: 'dist/src/permission/permission-audit.js',
  helpers: 'dist/src/init/helpers-generator.js',
  statusline: 'dist/src/init/statusline-generator.js',
  swarm: 'dist/src/commands/swarm.js',
  neural: 'dist/src/commands/neural.js',
  hooks: 'dist/src/mcp-tools/hooks-tools.js',
};
const CURRENT_HOOKS_SOURCE = [
  "import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';",
  "import * as nodeFs from 'fs';",
  "import * as pathMod from 'path';",
  "import { join, resolve } from 'path';",
  "import { getProjectCwd } from './types.js';",
  "const memoryPath = pathMod.resolve(process.cwd(), '.swarm', 'memory.db');",
  'export async function endSession(saveState, sessionId, duration, currentActivity) {',
  '    const daemonStopped = true;',
  "    const sessionPersistence = { controller: 'fixture', persisted: true };",
  '    const allEntries = [];',
  '    const agentCount = 0;',
  '    const trajectoryCount = 0;',
  '    let insightCount = 0;',
  '    const summary = {};',
  "    const insightsPath = resolve(join('.claude-flow', 'data', 'pending-insights.jsonl'));",
  '    if (existsSync(insightsPath)) insightCount = readFileSync(insightsPath).length;',
  '    const observed = pathMod.resolve(process.cwd(), \'.swarm\', \'observed.json\');',
  '    const activity = loadSessionActivity(session, endedAt);',
  '    void memoryPath; void observed; void summary; void currentActivity;',
  '        return {',
  '            sessionId,',
  '            duration,',
  "            statePath: saveState ? `.claude/sessions/${sessionId}.json` : undefined,",
  '            daemon: { stopped: daemonStopped },',
  "            sessionPersistence: sessionPersistence || { controller: 'none', persisted: false },",
  '            summary: {',
  '                tasksExecuted: activity.tasksCompleted,',
  '                filesModified: activity.editsRecorded,',
  '                agentsSpawned: agentCount,',
  '                pendingInsights: insightCount,',
  '                memoryEntries: allEntries.length,',
  '            },',
  '            learningUpdates: {',
  '                patternsLearned: activity.patternsLearned,',
  '                trajectoriesRecorded: trajectoryCount,',
  '            },',
  '        };',
  '}',
].join('\n');
const env = {
  ...process.env,
  RUFLO_SOURCE_PATCH_HOME: HOME,
  RUFLO_NPX_ROOT: NPX,
  RUFLO_GLOBAL_ROOT: path.join(SB, 'global'),
  RSP_NO_HOST_AUTO_UPDATE: '1',
  RSP_NO_LAUNCHCTL: '1',
};
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), ...args], {
  env, encoding: 'utf8',
});
const out = (run) => `${run.stdout || ''}${run.stderr || ''}`;
const fail = (message) => { console.error(`\n✘ ${message}`); process.exit(1); };
const read = (key) => fs.readFileSync(path.join(CLI, REL[key]), 'utf8');

function reset() {
  fs.rmSync(SB, { recursive: true, force: true });
  fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}\n');
  fs.mkdirSync(path.join(CLI, 'dist', 'src'), { recursive: true });
  fs.writeFileSync(path.join(CLI, 'package.json'), JSON.stringify({
    name: '@claude-flow/cli', type: 'module', version: 'fixture',
  }));
  for (const rel of Object.values(REL)) {
    const destination = path.join(CLI, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (rel === REL.hooks) {
      fs.writeFileSync(destination, CURRENT_HOOKS_SOURCE);
    } else {
      const source = path.join(SOURCE, '@claude-flow', 'cli', rel);
      fs.writeFileSync(destination, pristineBytes(source));
    }
  }
}

reset();
const installed = cli(['cwd', 'install']);
if (installed.status !== 0) fail(`current cwd anchors did not install:\n${out(installed)}`);
const status = cli(['cwd', 'status']);
if (status.status !== 0 || !/✔\s+cwd\s+\d+\/\d+ file\(s\) satisfied/.test(out(status))) {
  fail(`current cwd target did not report complete satisfaction:\n${out(status)}`);
}

for (const key of ['permission', 'helpers', 'swarm', 'neural']) {
  const checked = spawnSync(process.execPath, ['--check', path.join(CLI, REL[key])], { encoding: 'utf8' });
  if (checked.status !== 0) fail(`${key} output does not parse:\n${out(checked)}`);
}

const hooks = read('hooks');
for (const stale of [
  "statePath: saveState ? `.claude/sessions/${sessionId}.json` : undefined,",
  "const insightsPath = resolve(join('.claude-flow', 'data', 'pending-insights.jsonl'));",
  "process.cwd(), '.swarm'",
]) {
  if (hooks.includes(stale)) fail(`current hooks build retains stale session state behavior: ${stale}`);
}
for (const required of [
  "const stateDir = join(__rufloResolveRoot(getProjectCwd()), '.claude', 'sessions');",
  'const sessionSummary = {',
  'return { ...snapshot, statePath };',
]) {
  if (!hooks.includes(required)) fail(`current hooks build missed the 3.38.16 repair: ${required}`);
}
const hooksChecked = spawnSync(process.execPath, ['--check', path.join(CLI, REL.hooks)], { encoding: 'utf8' });
if (hooksChecked.status !== 0) fail(`current hooks output does not parse:\n${out(hooksChecked)}`);
const hooksFile = path.join(CLI, REL.hooks);
fs.writeFileSync(hooksFile, hooks.replace('        return { ...snapshot, statePath };', '        return snapshot;'));
if (cli(['cwd', 'status']).status === 0 || cli(['monitor', 'check']).status === 0) {
  fail('mutated 3.38.16 session snapshot still passed status or monitor check');
}
fs.writeFileSync(hooksFile, hooks);

const project = path.join(SB, 'project');
const deep = path.join(project, 'src', 'deep');
fs.mkdirSync(path.join(project, '.git'), { recursive: true });
fs.mkdirSync(path.join(project, '.claude-flow'), { recursive: true });
fs.mkdirSync(deep, { recursive: true });
const projectReal = fs.realpathSync(project);

// Permission defaults are live API behavior, not merely strings in a build.
const priorCwd = process.cwd();
process.chdir(deep);
const permission = await import(`${pathToFileURL(path.join(CLI, REL.permission)).href}?t=${Date.now()}`);
const expectedAudit = path.join(projectReal, '.swarm', 'permission-audit.jsonl');
const expectedGrants = path.join(projectReal, '.swarm', 'permissions.jsonl');
if (permission.auditLogPath() !== expectedAudit || permission.grantsPath() !== expectedGrants) {
  fail(`permission ledgers followed the nested cwd: ${permission.auditLogPath()} / ${permission.grantsPath()}`);
}
const explicitSwarm = path.join(deep, 'explicit-swarm');
if (permission.auditLogPath(explicitSwarm) !== path.join(explicitSwarm, 'permission-audit.jsonl')) {
  fail('permission patch changed an explicit caller-supplied swarm directory');
}
process.chdir(priorCwd);

// Generated helpers execute from a drifted cwd but derive their project from their
// installed .claude/helpers location. This catches a textual patch in dead generator code.
const helpers = await import(`${pathToFileURL(path.join(CLI, REL.helpers)).href}?t=${Date.now()}`);
const helperDir = path.join(project, '.claude', 'helpers');
fs.mkdirSync(helperDir, { recursive: true });
const generated = [
  ['session-manager.cjs', helpers.generateSessionManager(), ['start']],
  ['memory-helper.cjs', helpers.generateMemoryHelper(), ['set', 'answer', '42']],
  ['cross-platform-session.cjs', helpers.generateCrossPlatformSessionManager(), ['start']],
];
for (const [name, source, args] of generated) {
  const file = path.join(helperDir, name);
  fs.writeFileSync(file, source);
  const run = spawnSync(process.execPath, [file, ...args], { cwd: deep, encoding: 'utf8' });
  if (run.status !== 0) fail(`${name} failed from nested cwd:\n${out(run)}`);
}
for (const expected of [
  path.join(project, '.claude-flow', 'sessions', 'current.json'),
  path.join(project, '.claude-flow', 'data', 'memory.json'),
]) {
  if (!fs.existsSync(expected)) fail(`generated helper wrote no project-root artifact: ${expected}`);
}
if (fs.existsSync(path.join(deep, '.claude-flow'))) fail('generated helper leaked .claude-flow under nested cwd');

const swarm = read('swarm');
for (const raw of ["process.cwd(), '.swarm'", "process.cwd(), '.claude-flow'"]) {
  if (swarm.includes(raw)) fail(`swarm command retains raw state anchor: ${raw}`);
}
if (!swarm.includes("__rufloResolveRoot(process.cwd()), '.claude-flow'")) {
  fail('swarm status registries were not project-root anchored');
}

const neural = read('neural');
for (const raw of [
  "path.resolve(process.cwd(), '.claude-flow/neural/weft-export/sft.jsonl')",
  "path.resolve(process.cwd(), '.claude-flow/neural/weft-export/dpo.jsonl')",
]) {
  if (neural.includes(raw)) fail(`neural command retains raw WEFT default: ${raw}`);
}
if (!neural.includes('requestedOutDir ? process.cwd() : __rufloResolveRoot(process.cwd())')) {
  fail('neural export does not preserve invocation-relative semantics for an explicit --out-dir');
}

// Mutation guard: replace-all is complete only when NO raw sibling remains. One
// reverted permission call must fail both status surfaces even though the other
// call still contains the replacement token.
const permissionFile = path.join(CLI, REL.permission);
fs.writeFileSync(permissionFile, read('permission').replace(
  "swarmDir ?? path.join(__rufloResolveRoot(process.cwd()), '.swarm')",
  "swarmDir ?? path.join(process.cwd(), '.swarm')",
));
if (cli(['cwd', 'status']).status === 0 || cli(['monitor', 'check']).status === 0) {
  fail('one reverted replace-all sibling still passed status or monitor check');
}

// A mutating install with no discoverable files must fail, not announce success
// over an empty target.
fs.rmSync(path.join(NPX, 'current'), { recursive: true, force: true });
const emptyInstall = cli(['init', 'install']);
if (emptyInstall.status === 0 || !/INCOMPLETE init — no installed target files discovered/.test(out(emptyInstall))) {
  fail(`zero-file install did not fail honestly:\n${out(emptyInstall)}`);
}
if (cli(['init', 'status']).status === 0 || cli(['all', 'status']).status === 0) {
  fail('zero-file tracked target passed init status or all status');
}

console.log('✔ current cwd coverage (permission + generated helpers execute at root; swarm/neural defaults rooted; mutation and zero-file installs fail honest)');
