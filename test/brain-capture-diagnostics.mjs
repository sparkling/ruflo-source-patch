import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { SPECS, patchSource, reverseSource, isPatched, preflight } from '../lib/brain-capture-diagnostics/patcher.mjs';

const fixture = name => {
  const reused = {
    'learning-store': '../brain-user-learning-root/learning-store-native-4.7.21.mjs',
    'turn-capture-privacy': '../brain-native-4510/scripts/turn-capture-privacy.mjs',
    'learn-capture': '../brain-learning-receipts/native-4.7.28.mjs',
  };
  const file = new URL(`./fixtures/brain-capture-diagnostics/${reused[name] || name + '.mjs'}`, import.meta.url);
  return name === 'turn-outcome-capture'
    ? fs.readFileSync(file.pathname + '.part1', 'utf8') + fs.readFileSync(file.pathname + '.part2', 'utf8')
    : fs.readFileSync(file, 'utf8');
};
const patched = name => patchSource(fixture(name)).next;
const plain = source => source.replace(/^import .*;\n/gm, '').replace(/\bexport /g, '');
const section = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `exact native section ${start}`);
  return source.slice(from, to);
};
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-capture-diagnostics-'));
const contexts = [];
function context(source, supplied = {}) {
  const c = vm.createContext({ fs, os, path, crypto, createHash: crypto.createHash, Buffer,
    process, Date, setTimeout, clearTimeout, ...supplied });
  const exports = [...source.matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map(match => match[1]);
  vm.runInContext(plain(source) + exports.map(name => `\nglobalThis.${name} = ${name};`).join(''), c, { timeout: 1000 });
  contexts.push(c); return c;
}
const hash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
const rows = home => fs.existsSync(path.join(home, 'hook-failures.jsonl'))
  ? fs.readFileSync(path.join(home, 'hook-failures.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];
try {
  const bundle = [];
  for (const spec of SPECS) {
    const source = fixture(path.basename(spec.relative, '.mjs'));
    const result = patchSource(source);
    assert.deepEqual(result.missing, [], spec.relative);
    assert(isPatched(result.next), spec.relative);
    assert.equal(patchSource(result.next).next, result.next, 'idempotent');
    assert.equal(reverseSource(result.next), source, 'exact reverse');
    const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: result.next, encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const file = path.join(sandbox, path.basename(spec.relative));
    fs.writeFileSync(file, source); bundle.push(file);
    for (const { from, to } of spec.edits) {
      assert(patchSource(source.replace(from, '// changed upstream anchor')).missing.length, 'missing native anchor refused');
      assert(patchSource(source + '\n' + from).missing.length, 'ambiguous anchor refused');
      const changed = result.next.replace(to, '// marker-preserving external mutation');
      assert(!isPatched(changed), 'partial composition cannot pass');
      assert(patchSource(changed).missing.length, 'marked partial source refused');
    }
  }
  assert.equal(preflight(bundle).ok, true);
  fs.writeFileSync(bundle[0], 'unknown upstream replacement');
  assert.equal(preflight(bundle).ok, false, 'one unknown member protects the whole dependent bundle');
  assert.equal(preflight([...bundle, path.join(sandbox, 'missing.mjs')]).ok, false);

  // Actual native logger, first demonstrating the defect, then patched scope separation/repeats.
  const nativeLogger = context(fixture('hook-failures'));
  const legacyHome = path.join(sandbox, 'native');
  for (const store of ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'])
    nativeLogger.recordHookFailure({ hook: 'turn-capture', event: 'Stop', error: 'exact readback failed', store }, { brainHome: legacyHome, now: 1000 });
  nativeLogger.failureLine(legacyHome, { now: 1001 });
  assert.equal(rows(legacyHome)[1].store, undefined, 'reproduced lost repeat identity');

  const logger = context(patched('hook-failures'));
  const home = path.join(sandbox, 'patched');
  const a = logger.failureScope({ project: '/private/project-a', store: '/private/a.db', session: 'session-a', expectedKey: 'turn-a' });
  const b = logger.failureScope({ project: '/private/project-b', store: '/private/b.db', session: 'session-b', expectedKey: 'turn-b' });
  for (const scope of [a, b, a, b]) logger.recordHookFailure({ hook: 'turn-capture', event: 'Stop', error: 'same failure', ...scope }, { brainHome: home, now: 1000 });
  logger.failureLine(home, { now: 1001 });
  const logged = rows(home);
  assert.equal(logged.length, 4);
  for (const scope of [a, b]) {
    const own = logged.filter(row => row.store === scope.store);
    assert.equal(own.length, 2);
    for (const row of own) for (const key of ['project', 'store', 'session', 'expectedKey']) assert.equal(row[key], scope[key]);
    assert.equal(own[1].count, 1);
  }
  assert(!JSON.stringify(logged).includes('/private/'));
  logger.recordHookFailure({ hook: 'test', error: 'invalid correlation', project: '/secret/path', store: 'secret', session: {}, expectedKey: 'raw-key' }, { brainHome: home, now: 1002 });
  assert.equal(rows(home).at(-1).project, undefined);
  assert.equal(rows(home).at(-1).store, undefined);
  const boundsHome = path.join(sandbox, 'bounds');
  for (let i = 0; i < 70; i++) logger.recordHookFailure({ hook: 'test', error: 'one error', ...logger.failureScope({ store: `store-${i}` }) }, { brainHome: boundsHome, now: 2000 + i });
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(boundsHome, 'hook-failures.window.json')))).length, 64);
  fs.writeFileSync(path.join(boundsHome, 'hook-failures.jsonl'), 'x'.repeat(256 * 1024 + 1));
  logger.recordHookFailure({ hook: 'rotation', error: 'next' }, { brainHome: boundsHome, now: 3000 });
  assert(fs.existsSync(path.join(boundsHome, 'hook-failures.jsonl.1')));
  assert(fs.statSync(path.join(boundsHome, 'hook-failures.jsonl')).size < 1024);

  // Use native redaction, not a substitute sanitizer. All operations here are pure functions.
  const redaction = context(section(fixture('continuity-events'), 'function canonicalize(', '/** Redact, then'));
  const privacy = context(section(fixture('turn-capture-privacy'), 'export function captureFailureReason(', '/** One notice'), { redactText: redaction.redactText });
  let kills = 0, cleanups = 0;
  const memory = context(section(patched('ruflo-memory-hooks'), 'export function rufloMemory(', '\nfunction parseJson('), {
    resolveRuflo: () => '/inert/ruflo', rufloInvocationOrPlain: (file, args) => ({ executable: file, args }),
    rufloSpawnOptions: () => ({ cwd: '/inert/tmp', env: {}, cleanup: () => cleanups++ }),
    killGroup: () => kills++, captureFailureReason: privacy.captureFailureReason,
  });
  const invoke = async ({ error = Object.assign(new Error('generic error contains --value PRIVATE_PAYLOAD'), { code: 1 }), stderr = '', signal, abort } = {}) => {
    const options = { db: '/private/a.db', signal, deadlineAt: Date.now() + 1000,
      run: (file, args, opts, cb) => { queueMicrotask(() => { abort?.(); cb(error, '', stderr); }); return {}; } };
    return memory.rufloMemory(['store', '--value', 'PRIVATE_PAYLOAD'], options);
  };
  const reason = await invoke({ stderr: 'startup\n[ERROR] Native memory writer required; refusing whole-image sql.js fallback\ncleanup complete' });
  assert(reason.error.includes('exited 1: [ERROR] Native memory writer required'));
  assert(!reason.error.includes('PRIVATE_PAYLOAD'));
  const secret = await invoke({ stderr: '[ERROR] password="SUPERSECRET" token="HIDDEN_TOKEN" ' + 'x'.repeat(1000) });
  assert(!secret.error.includes('SUPERSECRET') && !secret.error.includes('HIDDEN_TOKEN'));
  assert(secret.error.length < 340, 'native redactor bounds the child detail to300');
  assert.equal((await invoke({ error: Object.assign(new Error('argv'), { code: 1, killed: true }), stderr: '[ERROR] unrelated' })).error, 'timed out');
  assert.equal((await invoke({ error: Object.assign(new Error('argv'), { signal: 'SIGTERM' }) })).error, 'ruflo memory store exited SIGTERM');
  const controller = new AbortController();
  assert.equal((await invoke({ signal: controller.signal, abort: () => controller.abort(), stderr: '[ERROR] unrelated' })).error, 'cancelled');
  assert(kills > 0 && cleanups === 5);

  // Existing learning admission with two occupied live-PID slots: no child, no writer, one scoped shed.
  let spawned = 0, writes = 0, childEnv;
  const learnHome = path.join(sandbox, 'learning');
  const common = { recordHookFailure: logger.recordHookFailure, failureScope: logger.failureScope, validFailureScope: logger.validFailureScope };
  const learn = context(section(patched('learn-capture'), '// LOAD BOUNDS', '\nconst isMain =').replace('fileURLToPath(import.meta.url)', "'/inert/learn-capture.mjs'"), {
    ...common, learningContext: () => ({ enabled: true, projectDir: '/tmp/detached-cwd', scope: 'project' }),
    resolveRuflo: () => '/inert/ruflo', observationKey: o => `workflow-${hash(JSON.stringify([o.session, o.tool, o.action]))}`,
    recordLearningObservation: (bin, ctx, obs, options) => { writes++; Object.assign(options.diagnostics, logger.failureScope({ store: '/private/native-selected.db' })); throw Error('capture refused'); },
    distillObservations: () => {}, spawn: (bin, args, options) => { spawned++; childEnv = options.env; return { pid: process.pid, unref() {} }; },
  });
  const first = learn.acquireObserveSlot(learnHome), second = learn.acquireObserveSlot(learnHome);
  assert(first && second && first !== second);
  const input = { cwd: '/private/origin-project', session_id: 'origin-session', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } };
  assert.equal(learn.captureLearning(input, { brainHome: learnHome, detach: true }), false);
  assert.equal(spawned, 0); assert.equal(writes, 0);
  const shed = rows(learnHome).at(-1);
  assert.equal(shed.error, 'shed observation (load)');
  assert.equal(shed.project, hash(input.cwd)); assert.equal(shed.session, hash(input.session_id));
  assert(shed.expectedKey); assert.equal(shed.store, undefined, 'no store was resolved before native admission');
  learn.releaseObserveSlot(first); learn.releaseObserveSlot(second);
  assert.equal(learn.captureLearning(input, { brainHome: learnHome, detach: true }), true);
  assert.equal(spawned, 1); assert.equal(writes, 0);
  assert(!childEnv.RUVNET_LEARN_FAILURE_SCOPE.includes('/private/'));
  const oldEnv = process.env;
  learn.process = { ...process, env: childEnv };
  learn.runDetached('--observe');
  const failed = rows(learnHome).at(-1);
  assert.equal(failed.project, hash(input.cwd), 'child retains handed origin; never guesses from /tmp cwd');
  assert.equal(failed.store, hash('/private/native-selected.db'));
  assert.equal(failed.session, hash(input.session_id)); assert(failed.expectedKey);
  assert.equal(writes, 1); assert.equal(process.env, oldEnv);
  assert.equal(fs.readdirSync(path.join(learnHome, 'learn-capture', 'slots')).length, 0);

  // The actual store function adds only the store/key it has already resolved, without resolving twice.
  let resolutions = 0; const diagnostics = { ...a };
  const store = context(section(patched('learning-store'), 'export function recordLearningObservation(', '\n/**\n * The namespace'), {
    failureScope: logger.failureScope, learningTarget: () => { resolutions++; return '/private/actual.db'; },
    observationKey: () => 'workflow-native-key', LEARNING_NAMESPACE: 'learning-observations',
    runLearningRuflo: () => ({ status: 1, stderr: '[ERROR] refused' }), captureFailureReason: privacy.captureFailureReason,
  });
  assert.throws(() => store.recordLearningObservation('/inert/ruflo', {}, { tool: 'Bash', action: 'git status', session: 'native-session' }, { diagnostics }), /refused/);
  assert.equal(resolutions, 1); assert.equal(diagnostics.store, hash('/private/actual.db'));
  assert.equal(diagnostics.expectedKey, hash('workflow-native-key')); assert.equal(diagnostics.project, a.project);
  const distill = context(section(patched('learning-store'), 'export function distillObservations(', '/** What the console shows'), {
    failureScope: logger.failureScope, learningTarget: () => '/private/distill.db', LEARNING_NAMESPACE: 'learning-observations',
    runLearningRuflo: () => ({ status: 1 }),
  });
  const distillDiagnostics = { project: a.project, session: a.session };
  assert.throws(() => distill.distillObservations('/inert', {}, { diagnostics: distillDiagnostics }), /did not complete/);
  assert.equal(distillDiagnostics.store, hash('/private/distill.db')); assert.equal(distillDiagnostics.expectedKey, undefined);

  // Native lifecycle/turn callers preserve scope on unverified writes, including detached-origin data.
  const checkpoints = context(section(patched('session-snapshot-hook'), 'async function checkpointNow(', '/** The detached checkpoint:')
    .replace("  const { checkpoint } = await import('./ruflo-memory-hooks.mjs');", ''), {
    ...common, resolveTurnDb: () => ({ projectRoot: '/canonical/project', db: '/canonical/project/.swarm/memory.db' }),
    checkpoint: async () => ({ stored: false, key: 'expected-checkpoint', skipped: 'store failed: native refusal' }),
  });
  await checkpoints.checkpointNow({ projectDir: '/tmp/origin-worktree', event: 'PreCompact', payload: { session_id: 'checkpoint-session' }, env: {}, brainHome: home });
  const checkpointRow = rows(home).at(-1);
  assert.equal(checkpointRow.project, hash('/canonical/project'));
  assert.equal(checkpointRow.store, hash('/canonical/project/.swarm/memory.db'));
  assert.equal(checkpointRow.session, hash('checkpoint-session'));
  assert.equal(checkpointRow.expectedKey, hash('expected-checkpoint'));
  const turns = context(section(patched('turn-outcome-capture'), 'export function runSteps(', '/** Bounded recent evidence'), {
    ...common, spawnSync: () => { throw Error('must not spawn'); }, readBack: () => null,
    flagValue: (args, flag) => args[args.indexOf(flag) + 1], resolveTurnDb: () => { throw Error('native resolver refusal'); },
    redactText: redaction.redactText, maskExcludedPaths: value => value, digest: value => crypto.createHash('sha256').update(value).digest('hex'),
  });
  turns.runSteps({ steps: [{ kind: 'store', projectRoot: '/origin', projectDir: '/origin', brainHome: home,
    failureScope: a, args: ['--key', 'expected-turn', '--path', '/origin/memory.db'] }], event: 'Stop' }, { brainHome: home, projectDir: '/tmp/detached' });
  const turn = rows(home).at(-1);
  assert.equal(turn.project, a.project); assert.equal(turn.session, a.session);
  assert.equal(turn.store, hash('/origin/memory.db')); assert.equal(turn.expectedKey, hash('expected-turn'));
  assert(!JSON.stringify(rows(home)).includes('/origin/'));
  console.log('Brain#518: exact source transforms/reversal, scoped repeats, native stderr privacy/terminal precedence, bounded ledger, unchanged shedding, detached origin and caller correlation PASS');
} finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
