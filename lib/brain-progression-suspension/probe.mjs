// Native #390 handoff: prove executable boundaries, persist suspension, then retire.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existingPathRelative } from '../path-containment.mjs';
import { composeSource, isOurs } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';
import { HOME_BASE } from '../cwd/paths.mjs';
import { reviewedBoundary } from '../brain-native/reviewed-source.mjs';
import { NAME, PATCH_MARKER } from './patcher.mjs';
import { CONTROL, REVIEWED, selectedSurfaces, nativeControl, nativeSurfaceReady, verifyNativeProgressionSuspensionPreserved } from './native.mjs';
export { CONTROL, verifyNativeProgressionSuspensionPreserved } from './native.mjs';
const clean = source => source.replace(/^#!.*\n/, '').replace(/^import[\s\S]*?;\n/gm, '')
  .replace(/^export \{[^\n]+\n/gm, '').replace(/^export /gm, '')
  .replaceAll('import.meta.url', '"file:///fixture/module.mjs"')
  .split('\nif (process.argv[1]')[0];
const trap = () => { throw Error('automatic history/storage/worker boundary ran'); };

export async function exerciseSuspensionSources(sources, root) {
  for (const [relative, digest] of Object.entries(REVIEWED)) {
    assert(reviewedBoundary(sources[relative], sources[relative], null, digest), `unreviewed native boundary ${relative}`);
  }
  const env = { HOME: root, RUVNET_BRAIN_STATE_DIR: path.join(root, 'operator-state') };
  const control = vm.runInNewContext(clean(sources[CONTROL]) +
    '\n({operatorProgressionSuspension,automaticProgressionSuspensionResult,isAutomaticProgressionSuspension,setOperatorProgressionSuspension,progressionSuspensionFile})',
  { fs, os, path, randomUUID, process: { env, argv: [], pid: process.pid } }, { timeout: 1000 });
  assert.equal(control.operatorProgressionSuspension(env), null);
  control.setOperatorProgressionSuspension(true, { env });
  assert.equal(control.operatorProgressionSuspension(env).source, 'operator-state');
  assert.equal(fs.statSync(control.progressionSuspensionFile(env)).mode & 0o777, 0o600);
  assert.equal(control.isAutomaticProgressionSuspension({ progressionSuspended: true }), false);
  const context = {
    ...control, path, os, Buffer, env, console,
    process: { env, argv: [], cwd: () => root },
    fs: new Proxy({}, { get: () => trap }), fileURLToPath: () => '/fixture/module.mjs',
    readTransitionHistory: trap, runSessionSnapshotHook: trap, resolveProjectStore: trap,
    developmentHooksSuspended: () => false, normalizeTransition: trap, spawn: trap,
    boundedStoreFactory: trap, captureNormalizedTransition: trap,
    DETACHED_REPLAY_BUDGET_MS: 45000, SESSION_CONTINUITY_LIMIT_BYTES: 8192,
    SESSION_CONTINUITY_DEADLINE_MS: 3500, STAGE_BUDGETS_MS: { restore: 3500 }, replayTurnQueue: () => ({ pending: 2 }),
  };
  const run = (relative, expression, extra = {}) => vm.runInNewContext(clean(sources[relative]) + '\n' + expression,
    { ...context, ...extra }, { timeout: 1000 });
  for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStop']) {
    const result = run('scripts/project-transition-hook.mjs', `runProjectTransitionHook(${JSON.stringify(root)},${JSON.stringify(event)},{env})`);
    assert.equal(result.state, 'suspended'); assert.equal(result.receipt, null);
    assert.equal(control.isAutomaticProgressionSuspension(result), true);
  }
  assert.equal(run('scripts/project-transition-hook.mjs', 'captureNormalizedTransition({env}).receipt'), null);
  const restored = run('scripts/project-progression-session-start.mjs', 'restoreProgressionForSession({cwd:env.HOME,env})');
  assert.equal(restored.reason, 'operator-suspended'); assert.equal(restored.pendingTurns, 2);
  for (const [expression, expected] of [
    ['queueCapture({projectDir:env.HOME,env})', null],
    ['replayOutboxDetached({projectDir:env.HOME,env})', false],
    ['runOutboxReplay({projectDir:env.HOME,env})', 0],
  ]) assert.equal(run('scripts/project-capture-queue.mjs', expression), expected);
  const drained = run('scripts/project-capture-queue.mjs', 'drainCaptureQueue({projectDir:env.HOME,env})');
  assert.equal(drained.state, 'suspended'); assert.equal(drained.pending, null);
  let turns = 0, events = 0;
  const material = {
    resolveTurnDb: () => ({}), captureProjectTransition: trap, buildProjectProgression: trap,
    captureTurnOutcome: () => (++turns, { recorded: true }),
    captureContinuityEvents: () => (++events, { recorded: 1 }), replayOutboxDetached: trap,
  };
  for (const event of ['Stop', 'PreCompact', 'SessionEnd']) {
    const result = run('scripts/session-snapshot-hook.mjs',
      `runSessionSnapshotHook(env.HOME,${JSON.stringify(event)},{env,writeMetadata:false,rawInput:'{"session_id":"fixture"}'})`, material);
    assert(control.isAutomaticProgressionSuspension(result)); assert.equal(result.receipt, null);
    assert.equal(result.turn.recorded, true); assert.equal(result.continuity.recorded, 1);
  }
  const denied = run('scripts/session-snapshot-hook.mjs', 'runSessionSnapshotHook(env.HOME,"Stop",{env,writeMetadata:false})',
    { ...material, resolveTurnDb: () => ({ skipped: 'operator consent' }) });
  assert.equal(denied.skipped, 'operator consent'); assert.equal(turns, 3); assert.equal(events, 3);
  let executions = 0;
  const command = ({ fresh = true, executable = 'ruflo', argv = ['status'], host = 'codex', forged = false, code = 0 } = {}) =>
    run('mcp/managed-cli-interface.mjs',
      `execute = fakeExecution; freshStamp = () => ${fresh}; callManagedCli('ruvnet_cli_run',args,env,null,lifecycle)`, {
        ...material, env: { ...env, RUVNET_HOOK_HOST: host }, args: { executable, argv },
        fs: { existsSync: () => true }, projectDirectory: () => root,
        resolveProjectStore: () => ({ projectRoot: root }),
        loadRuntimePreferences: () => ({ values: { routing: 'off', qeFleet: false } }),
        runtimeChildEnv: ({ env }) => env, managedGenerationIdentity: () => 'fixture-generation',
        recordManagedCliObservation: () => {},
        runSessionSnapshotHook: () => control.automaticProgressionSuspensionResult(env),
        fakeExecution: async () => (++executions, { code, stdout: 'native result', stderr: '' }),
        lifecycle: { generationBinding: 'fixture-generation', ...(forged ? { capture: () => ({ adopted: true, progressionCaptured: false, progressionSuspended: true }) } : {}) },
      });
  let result = await command(); assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(result.structuredContent.continuity, 'operator-suspended'); assert.equal(executions, 1);
  for (const options of [{ fresh: false }, { host: '' }, { executable: 'sh' }, { executable: 'agentic-flow' },
    { executable: 'agentic-qe', argv: ['fleet', 'run'] }, { forged: true }]) {
    assert.equal((await command(options)).isError, true); assert.equal(executions, 1);
  }
  result = await command({ code: 7 }); assert.equal(result.isError, true); assert.equal(result.structuredContent.code, 7);
  let checkpoints = 0;
  const checkpoint = run('scripts/project-progression-checkpoint.mjs',
    'runCheckpoint({projectDir:env.HOME,state:{currentGoal:"explicit checkpoint"},host:"codex",produce,capture,storeFactory})', {
      fs: { existsSync: () => true }, resolveProjectStore: () => ({ canonicalAgentDbPath: path.join(root, '.swarm', 'fixture') }),
      projectDirectory: () => root, buildProjectProgression: trap, captureProjectTransition: trap,
      produce: () => ({ projectProgression: { completeProjectState: { provenance: {} } } }),
      capture: () => (++checkpoints, { receipt: { payloadDigest: 'fixture', readbackDigest: 'fixture' }, snapshot: { sequence: 1 } }),
      storeFactory: () => ({ replay: () => [] }),
    });
  assert.equal(checkpoints, 1); assert.equal(checkpoint.receipt.payloadDigest, checkpoint.receipt.readbackDigest);
  control.setOperatorProgressionSuspension(false, { env });
  assert.equal(control.automaticProgressionSuspensionResult(env), null);
  fs.writeFileSync(control.progressionSuspensionFile(env), '{invalid');
  assert.throws(() => control.operatorProgressionSuspension(env), /unreadable or invalid/);
  return { turns, events, checkpoints, executions, forgedFlagRejected: true };
}

function nativeSource(surface, relative, installed) {
  const file = path.join(surface.root, relative);
  const regular = candidate => {
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(surface.root, candidate) === null) throw Error(`unsafe native source ${candidate}`);
  };
  regular(file);
  const live = fs.readFileSync(file, 'utf8');
  if (!live.includes('ruflo-source-patch')) return live;
  const owners = installed.filter(owner => owner !== NAME || live.includes(PATCH_MARKER));
  if (!isOurs(live, owners)) throw Error('foreign or untracked native source');
  const backup = `${file}.rsp-backup`; regular(backup);
  const original = fs.readFileSync(backup, 'utf8');
  if (original.includes('ruflo-source-patch') || composeSource(original, owners, { file }) !== live) throw Error('unproved pristine native composition');
  return original;
}
export function probeProgressionSuspensionReplacement({ surfaces = selectedSurfaces(), installed = readState().pluginTargets } = {}) {
  let temporary;
  try {
    if (!surfaces.some(surface => surface.kind === 'full')) throw Error('no current full native Brain bundle');
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-suspension-'));
    const full = surfaces.find(surface => surface.kind === 'full');
    const baseline = Object.fromEntries(Object.keys(REVIEWED).map(relative => [relative, nativeSource(full, relative, installed)]));
    for (let i = 0; i < surfaces.length; i++) {
      const surface = surfaces[i], sources = { ...baseline };
      const relatives = surface.kind === 'full' ? Object.keys(REVIEWED) : [CONTROL, 'mcp/managed-cli-interface.mjs'];
      for (const relative of relatives) sources[relative] = nativeSource(surface, relative, installed);
      const root = path.join(temporary, String(i)); fs.mkdirSync(root);
      const fixture = path.join(root, 'sources.json'); fs.writeFileSync(fixture, JSON.stringify(sources), { mode: 0o600 });
      const result = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import fs from 'node:fs';import {exerciseSuspensionSources} from ${JSON.stringify(import.meta.url)};await exerciseSuspensionSources(JSON.parse(fs.readFileSync(process.argv[1],'utf8')),process.argv[2]);`, fixture, root],
      { encoding: 'utf8', timeout: 5000, env: { HOME: temporary, PATH: process.env.PATH || '' }, maxBuffer: 1024 * 1024 });
      if (result.error || result.status !== 0) throw Error(result.error?.message || result.stderr || `probe exited ${result.status}`);
    }
    return { state: 'superseded', evidence: `${surfaces.length} current native bundles preserve persisted suspension, consent, material events, explicit checkpoints and managed command authorization/outcomes` };
  } catch (error) { return { state: 'live', evidence: `native progression suspension proof failed: ${error.message}` }; }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}

export function prepareNativeProgressionSuspensionRetirement({ surfaces = selectedSurfaces(), installed = readState().pluginTargets,
  env = { ...process.env, HOME: HOME_BASE } } = {}) {
  try {
    if (!installed.includes(NAME)) throw Error('no selected operator suspension to transfer');
    const proof = probeProgressionSuspensionReplacement({ surfaces, installed });
    if (proof.state !== 'superseded') throw Error(proof.evidence);
    const surface = surfaces.find(surface => surface.kind === 'full');
    const before = nativeControl(surface, '--status', env);
    if (before.automaticProgression !== 'operator-suspended' || before.source !== 'operator-state') nativeControl(surface, '--suspend', env);
    const after = nativeControl(surface, '--status', env);
    if (after.automaticProgression !== 'operator-suspended' || after.source !== 'operator-state') throw Error('persisted native suspension handoff failed');
    return { errors: [], log: ['native operator suspension persisted and read back before local overlay removal'], receipt: { before, after } };
  } catch (error) { return { errors: [error.message], log: [] }; }
}
// Installation/monitor callers may encounter old and current native copies together.
// Transfer only the proved native subset; retain the local target on older copies.
// This is a MUTATING preparation helper, never a status or preflight operation.
export function prepareNativeProgressionSuspensionApplication({ surfaces = selectedSurfaces(), installed = readState().pluginTargets,
  env = { ...process.env, HOME: HOME_BASE } } = {}) {
  try {
    if (!installed.includes(NAME)) return { errors: [], log: [] };
    const native = [];
    for (const surface of surfaces) {
      if (!fs.existsSync(path.join(surface.root, CONTROL))) continue;
      nativeSurfaceReady(surface);
      native.push(surface);
    }
    if (!native.length) return { errors: [], log: ['legacy operator suspension remains source-patched; no native handoff available'] };
    return prepareNativeProgressionSuspensionRetirement({ surfaces: native, installed, env });
  } catch (error) { return { errors: [error.message], log: [] }; }
}
export function brainProgressionSuspensionSupersession() {
  return { issue: 'https://github.com/stuinfla/ruvnet-brain/issues/390',
    replacement: 'native independently scoped persisted automatic-progression suspension',
    check: probeProgressionSuspensionReplacement,
    postRetireCheck: verifyNativeProgressionSuspensionPreserved };
}
