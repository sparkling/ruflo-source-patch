import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { patchSource, reverseSource, isPatched, SPECS, REASON } from '../lib/brain-progression-suspension/patcher.mjs';
import { patchSource as notice, reverseSource as undoNotice } from '../lib/brain-transition-notice/patcher.mjs';
import { patchSource as validation, reverseSource as undoValidation } from '../lib/brain-transition-validation/patcher.mjs';
import { patchSource as diagnostics, reverseSource as undoDiagnostics } from '../lib/brain-managed-cli-diagnostics/patcher.mjs';
const read = relative => fs.readFileSync(new URL('./fixtures/' + relative, import.meta.url), 'utf8');
const sources = {
  'scripts/project-transition-hook.mjs': read('brain-transition-validation/project-transition-hook.mjs'),
  'scripts/session-snapshot-hook.mjs': read('brain-progression-suspension/session-snapshot-hook.mjs'),
  'scripts/project-progression-session-start.mjs': read('brain-progression-suspension/project-progression-session-start.mjs'),
  'scripts/project-capture-queue.mjs': read('brain-progression-collision/project-capture-queue.mjs') + read('brain-progression-suspension/queue-boundaries.mjs'),
  'mcp/managed-cli-interface.mjs': read('brain-managed-cli-diagnostics/mcp/managed-cli-interface.mjs'),
};
const patched = {};
for (const spec of SPECS) {
  const source = sources[spec.relative], result = patchSource(source);
  assert.deepEqual(result.missing, [], spec.relative);
  assert(isPatched(result.next));
  assert.equal(reverseSource(result.next), source);
  assert.equal(patchSource(result.next).next, result.next);
  for (const drift of [source + source, source.replace(spec.edits[0][0], '/* drift */'), result.next + result.next]) {
    assert(patchSource(drift).missing.length);
    assert.equal(patchSource(drift).next, drift);
  }
  patched[spec.relative] = result.next;
}
// Execute native functions with traps at the history/storage/worker boundaries.
// The trap proves suspension precedes those boundaries; a receipt is never invented.
const trap = () => { throw Error('history/storage/worker boundary must not run'); };
const context = {
  process: { env: {} }, Buffer, path, os: { homedir: () => '/synthetic' },
  fs: new Proxy({}, { get: () => trap }),
  readTransitionHistory: trap, runSessionSnapshotHook: trap, resolveProjectStore: trap,
  developmentHooksSuspended: trap, normalizeTransition: trap, spawn: trap,
  boundedStoreFactory: trap, captureNormalizedTransition: trap,
  DETACHED_REPLAY_BUDGET_MS: 45000, SESSION_CONTINUITY_LIMIT_BYTES: 8192,
  SESSION_CONTINUITY_DEADLINE_MS: 3500,
};
const clean = source => source.replaceAll('import.meta.url', '"file:///synthetic/module.mjs"').replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '').split('\nif (process.argv[1]')[0];
function evaluate(source, expression, extra = {}) {
  return vm.runInNewContext(clean(source) + '\n' + expression, { ...context, ...extra }, { timeout: 1000 });
}
const transition = patched['scripts/project-transition-hook.mjs'];
// Fixture includes module constants, so use the whole target function only.
const boundary = transition.slice(transition.indexOf('export function runProjectTransitionHook('));
for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStop']) {
  const result = evaluate(boundary, `runProjectTransitionHook('/synthetic', ${JSON.stringify(event)})`);
  assert.equal(result.state, 'suspended'); assert.equal(result.receipt, null);
}
const restored = evaluate(patched['scripts/project-progression-session-start.mjs'], 'restoreProgressionForSession({cwd:"/synthetic"})');
assert.equal(restored.status, 'unavailable'); assert.equal(restored.reason, 'operator-suspended');
assert(restored.context.includes(REASON));
const queue = patched['scripts/project-capture-queue.mjs'];
assert.equal(evaluate(queue, 'replayOutboxDetached({projectDir:"/synthetic"})'), false);
assert.equal(evaluate(queue, 'runOutboxReplay({projectDir:"/synthetic"})'), 0);
const drained = evaluate(queue, 'drainCaptureQueue({projectDir:"/synthetic"})');
assert.equal(drained.state, 'suspended'); assert.equal(drained.pending, null, 'never claim pending debt is zero');
let turns = 0, events = 0;
const captureContext = {
  resolveTurnDb: () => ({}), captureProjectTransition: trap, buildProjectProgression: trap,
  effectiveBudgetMs: () => 8000, replayOutboxDetached: trap,
  captureTurnOutcome: () => (++turns, { recorded: true }),
  captureContinuityEvents: () => (++events, { recorded: 1 }),
};
for (const event of ['Stop', 'PreCompact', 'SessionEnd']) {
  const result = evaluate(patched['scripts/session-snapshot-hook.mjs'],
    `runSessionSnapshotHook('/synthetic', '${event}', { writeMetadata:false, rawInput:'{"session_id":"fixture"}' })`, captureContext);
  assert.equal(result.progressionCaptured, false); assert.equal(result.receipt, null);
  assert.equal(result.progressionSuspended, true); assert.equal(result.turn.recorded, true);
  assert.equal(result.continuity.recorded, 1);
}
assert.equal(turns, 3); assert.equal(events, 3);
const denied = evaluate(patched['scripts/session-snapshot-hook.mjs'],
  `runSessionSnapshotHook('/synthetic','Stop',{writeMetadata:false})`,
  { ...captureContext, resolveTurnDb: () => ({ skipped: 'persisted turn capture opt-out' }) });
assert.equal(denied.skipped, 'persisted turn capture opt-out'); assert.equal(turns, 3);
// Managed command authentication, help and policy gates still precede execution.
let executions = 0;
const cliContext = {
  ...context, fs: { existsSync: () => true },
  loadRuntimePreferences: () => ({ values: { routing: 'off', qeFleet: false } }),
  runtimeChildEnv: ({env}) => env, projectDirectory: () => '/synthetic',
  recordManagedCliObservation: () => {},
  fakeExecution: async () => (++executions, { code: 0, stdout: 'native result', stderr: '' }),
};
const cliSource = patched['mcp/managed-cli-interface.mjs'];
async function command({ executable = 'ruflo', argv = ['status'], host = 'codex', fresh = true, lifecycle = {}, execution } = {}) {
  return evaluate(cliSource,
    `execute = fakeExecution; freshStamp = () => ${fresh};
     callManagedCli('ruvnet_cli_run', args, env, null, lifecycle)`,
    { ...cliContext, args: { executable, argv }, env: { RUVNET_HOOK_HOST: host }, lifecycle,
      ...(execution ? { fakeExecution: async () => (++executions, execution) } : {}) });
}
let result = await command();
assert.equal(result.isError, false, JSON.stringify(result)); assert.equal(result.content[0].text, 'native result');
assert(result.content.at(-1).text.includes(REASON)); assert.equal(executions, 1);
for (const args of [{fresh:false}, {host:''}, {executable:'sh'}, {executable:'agentic-flow'}, {executable:'agentic-qe',argv:['fleet','run']}]) {
  assert.equal((await command(args)).isError, true); assert.equal(executions, 1);
}
result = await command({execution:{code:7,stdout:'failed result',stderr:''}});
assert.equal(result.isError, true); assert(result.content.at(-1).text.includes(REASON));
const prior = executions;
result = await command({lifecycle:{capture:()=>({adopted:true,progressionCaptured:false,policy:Symbol('operator-suspended progression')})}});
assert.equal(result.isError, true); assert.equal(executions, prior, 'external failed capture cannot forge the private operator policy');
// Real sibling transformations commute and each remains independently reversible.
for (const [relative, siblings] of [
  ['scripts/project-transition-hook.mjs', [[notice, undoNotice], [validation, undoValidation]]],
  ['mcp/managed-cli-interface.mjs', [[diagnostics, undoDiagnostics]]],
]) for (const [apply, reverse] of siblings) {
  const native = sources[relative], sibling = apply(native);
  assert.deepEqual(sibling.missing, []);
  const both = patchSource(sibling.next).next;
  assert.equal(both, apply(patchSource(native).next).next);
  assert.equal(reverseSource(both), sibling.next);
  assert.equal(reverse(both), patchSource(native).next);
}
console.log('PASS progression suspension: preserved consent/material events; no history, replay, receipts; managed policy and outcomes intact; reversible composition');
