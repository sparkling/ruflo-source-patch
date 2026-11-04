import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
import { SPECS, descriptor, patchSource, reverseSource, hasPatch, isPatched, preflight } from '../lib/brain-capture-diagnostics/patcher.mjs';
import { INLINE_SNAPSHOT_SHA256, NATIVE_SNAPSHOT_SHA256, NATIVE_LEARNING_CALL, INLINE_LEARNING_CALL,
  prepareNativeLearningRoute, preservedRoutePath } from '../lib/brain-capture-diagnostics/native-route.mjs';
import { writeIfChanged, restoreFromBackup } from '../lib/pristine.mjs';
import { CHECKPOINT_HELPER } from '../lib/brain-capture-diagnostics/checkpoint.mjs';

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
  const nativeSnapshot = fixture('session-snapshot-hook');
  const inlineSnapshot = nativeSnapshot.replace('captureLearning(payload, { env, detach: true })', 'captureLearning(payload, { env, detach: false })');
  assert(patchSource(inlineSnapshot).missing.length, 'unregistered inline PostToolUse source must be refused');
  const digest = text => crypto.createHash('sha256').update(text).digest('hex');
  assert.equal(digest(nativeSnapshot), NATIVE_SNAPSHOT_SHA256, 'fixture equals published v4.7.28/main');
  assert.equal(digest(inlineSnapshot), INLINE_SNAPSHOT_SHA256, 'reproduces exact HZ poisoned baseline');
  const nativePatched = patchSource(nativeSnapshot).next;
  const inlinePatched = nativePatched.replace(NATIVE_LEARNING_CALL, INLINE_LEARNING_CALL);
  assert(!isPatched(inlinePatched), 'read-only status rejects marked inline caller');

  // Execute the actual native PostToolUse branch; only the module-loading seam is inert.
  const route = source => context(section(source, 'export async function runLifecycleBoundary(', '\nif (process.argv[1]')
    .replace("await import('./learn-capture.mjs')", 'await captureModule()'), {
    captureModule: async () => ({ captureLearning(payload, options) {
      assert.equal(options.detach, true, 'PostToolUse must dispatch native bounded detached capture');
      assert.equal(payload.cwd, '/inert/project');
      return { detached: true };
    } }),
  });
  const invokeRoute = source => route(source).runLifecycleBoundary('PostToolUse', { cwd: '/inert/project' }, {
    env: { RUVNET_HOOK_HOST: 'codex' }, deadlineAt: 0,
  });
  await assert.rejects(invokeRoute(inlinePatched), /PostToolUse must dispatch/, 'reproduce altered actual hook route');
  for (const source of [nativeSnapshot, nativePatched]) assert.equal((await invokeRoute(source)).learning.detached, true);

  let recoveryNumber = 0;
  const recoveryFixture = () => {
    const dir = path.join(sandbox, 'route-' + recoveryNumber++);
    fs.mkdirSync(dir);
    const file = path.join(dir, 'session-snapshot-hook.mjs'), backup = file + '.rsp-backup';
    fs.writeFileSync(file, inlinePatched); fs.writeFileSync(backup, inlineSnapshot);
    return { dir, file, backup };
  };
  const healthy = recoveryFixture();
  assert.equal(preflight([healthy.file]).ok, false, 'read-only preflight refuses known poisoned route');
  assert.equal(fs.readFileSync(healthy.backup, 'utf8'), inlineSnapshot, 'preflight never repairs');
  const restore = file => restoreFromBackup(file, {
    hasPatch, isKnownPatched: (saved, current) => patchSource(saved).missing.length === 0 && patchSource(saved).next === current,
  });
  assert.equal(restore(healthy.file).unresolved, true, 'uninstall cannot restore poisoned baseline');
  assert.deepEqual(prepareNativeLearningRoute([healthy.file], patchSource).errors, []);
  assert.equal(fs.readFileSync(healthy.file, 'utf8'), nativePatched);
  assert.equal(fs.readFileSync(healthy.backup, 'utf8'), nativeSnapshot);
  assert.equal(fs.readFileSync(preservedRoutePath(healthy.file, inlinePatched), 'utf8'), inlinePatched);
  assert.equal(fs.readFileSync(preservedRoutePath(healthy.backup, inlineSnapshot), 'utf8'), inlineSnapshot);
  assert.equal(preflight([healthy.file]).ok, true);
  assert.equal(prepareNativeLearningRoute([healthy.file], patchSource).log.length, 0, 'recovery is idempotent');
  assert.equal(restore(healthy.file).restored, true);
  assert.equal(fs.readFileSync(healthy.file, 'utf8'), nativeSnapshot, 'uninstall restores upstream detached route');

  for (const change of ['source', 'backup', 'missing-backup', 'archive-collision', 'symlink']) {
    const f = recoveryFixture();
    if (change === 'source') fs.appendFileSync(f.file, '\n// unknown edit');
    if (change === 'backup') fs.appendFileSync(f.backup, '\n// unknown baseline');
    if (change === 'missing-backup') fs.unlinkSync(f.backup);
    if (change === 'archive-collision') fs.writeFileSync(preservedRoutePath(f.backup, inlineSnapshot), 'other evidence');
    if (change === 'symlink') { fs.renameSync(f.file, f.file + '.outside'); fs.symlinkSync(f.file + '.outside', f.file); }
    const before = fs.readFileSync(f.file, 'utf8');
    assert(prepareNativeLearningRoute([f.file], patchSource).errors.length, change + ' refused');
    assert.equal(fs.readFileSync(f.file, 'utf8'), before, change + ' preserved');
  }
  const bundleRefusal = recoveryFixture(), unknown = path.join(bundleRefusal.dir, 'hook-failures.mjs');
  fs.writeFileSync(unknown, 'unrecognized member');
  assert(prepareNativeLearningRoute([bundleRefusal.file, unknown], patchSource).errors.length);
  assert.equal(fs.readFileSync(bundleRefusal.backup, 'utf8'), inlineSnapshot, 'all-member proof precedes mutation');
  assert.equal(fs.existsSync(preservedRoutePath(bundleRefusal.file, inlinePatched)), false);

  const interrupted = recoveryFixture();
  const partial = prepareNativeLearningRoute([interrupted.file], patchSource, { write(file, body, options) {
    if (file === interrupted.file) throw Error('simulated interruption after native backup');
    return writeIfChanged(file, body, options);
  } });
  assert(partial.errors.length);
  assert.equal(fs.readFileSync(interrupted.backup, 'utf8'), nativeSnapshot, 'interrupted uninstall source is native');
  assert.equal(restore(interrupted.file).unresolved, true);
  assert.deepEqual(prepareNativeLearningRoute([interrupted.file], patchSource).errors, [], 'preserved exact handoff can finish');
  assert.equal(fs.readFileSync(interrupted.file, 'utf8'), nativePatched);
  const unprovedPartial = recoveryFixture();
  fs.writeFileSync(unprovedPartial.backup, nativeSnapshot);
  assert(prepareNativeLearningRoute([unprovedPartial.file], patchSource).errors.length, 'native baseline alone cannot authorize unknown handoff');

  const raced = recoveryFixture();
  const race = prepareNativeLearningRoute([raced.file], patchSource, { write(file, body, options) {
    if (file === raced.file) fs.appendFileSync(file, '\n// concurrent change');
    return writeIfChanged(file, body, options);
  } });
  assert(race.errors.some(message => /concurrent change/.test(message)));
  assert.equal(fs.readFileSync(raced.file, 'utf8'), inlinePatched + '\n// concurrent change', 'concurrent live bytes not overwritten');
  assert.equal(fs.readFileSync(raced.backup, 'utf8'), nativeSnapshot);
  assert(prepareNativeLearningRoute([raced.file], patchSource).errors.length, 'unknown raced source cannot be silently retried');
  const bundle = [];
  for (const spec of SPECS) {
    const source = fixture(path.basename(spec.relative, '.mjs'));
    const result = patchSource(source);
    assert.deepEqual(result.missing, [], spec.relative);
    assert(isPatched(result.next), spec.relative);
    assert.equal(patchSource(result.next).next, result.next, 'idempotent');
    assert.equal(reverseSource(result.next), source, 'exact reverse');
    if (spec.relative === 'scripts/ruflo-memory-hooks.mjs') {
      const previous = spec.edits.filter(({ id }) => !id.startsWith('checkpoint-diagnostic-'))
        .reduce((text, { from, to }) => text.replace(from, () => to), source);
      assert(!isPatched(previous));
      assert.equal(patchSource(previous).next, result.next, 'prior diagnostics upgrade exactly');
      assert.equal(reverseSource(previous), source, 'prior diagnostics inverse retained');
      assert.equal(reverseSource(result.next), source);
      assert(patchSource(previous.replace('    const timeout = Math.floor', '    const timeout = Math.ceil')).missing.length === 0,
        'unowned native timeout bytes are not rewritten by diagnostics');
    }
    if (spec.relative === 'scripts/turn-outcome-capture.mjs') {
      const previous = spec.edits.filter(({ id }) => !id.startsWith('readback-'))
        .reduce((text, { from, to }) => text.replace(from, () => to), source);
      assert(!isPatched(previous), 'prior release needs precise readback diagnostics upgrade');
      assert.equal(patchSource(previous).next, result.next, 'prior release upgrades to current exact composition');
      assert.equal(reverseSource(previous), source, 'prior release remains exactly uninstallable');
      assert.equal(reverseSource(patchSource(previous).next), source);
      const partial = previous.replace("verified = read({ ruflo, db, key, run, options }) === value", 'verified = true');
      assert(patchSource(partial).missing.length, 'unknown prior readback changes cannot be blessed');
      assert.equal(reverseSource(partial), partial, 'unknown prior readback changes are preserved');
    }
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
  // Actual HZ saved pristine/live hashes, through the full shared-file composer.
  const { applyComposed } = await import('../lib/plugin-compose.mjs'), scratch = await import('../lib/brain-scratch-preservation/patcher.mjs');
  const savedDescriptors = [{ ...descriptor }, { ...scratch.descriptor }], shared = bundle[1], pristine = fixture('ruflo-memory-hooks');
  assert.equal(digest(pristine), '099c66b1a72555bd62ebd78a1506fa1b0458b95e8af4fb22cdcfa261760b7722');
  const prior = descriptor.historicalPatchSource(scratch.patchSource(pristine).next).next;
  assert.equal(digest(prior), '0d4430dfed7efed7c5fbd32075f7a7e7c868ce3a16397481752cb60185715043');
  for (const [i, spec] of SPECS.entries()) fs.writeFileSync(bundle[i], fixture(path.basename(spec.relative, '.mjs')));
  fs.writeFileSync(shared, prior); fs.writeFileSync(shared + '.rsp-backup', pristine);
  Object.assign(descriptor, { discover: () => bundle, preflight: () => preflight(bundle), prepare: () => prepareNativeLearningRoute(bundle, patchSource) });
  Object.assign(scratch.descriptor, { discover: () => [shared], preflight: () => ({ ok: !scratch.patchSource(fs.readFileSync(shared, 'utf8')).missing.length }) });
  const apply = () => applyComposed([descriptor.name, scratch.descriptor.name], { files: [shared], cliTargets: [] });
  try {
    delete descriptor.historicalPatchSource;
    assert(apply().incomplete, 'reproduces old full-composer rejection despite standalone preflight passing');
    assert.equal(fs.readFileSync(shared, 'utf8'), prior); assert.equal(fs.readFileSync(shared + '.rsp-backup', 'utf8'), pristine);
    descriptor.historicalPatchSource = savedDescriptors[0].historicalPatchSource;
    const upgraded = apply(); assert.equal(upgraded.incomplete + upgraded.errors, 0, upgraded.log.join('\n'));
    assert.equal(fs.readFileSync(shared, 'utf8'), patchSource(scratch.patchSource(pristine).next).next);
    assert.equal(fs.readFileSync(shared + '.rsp-backup', 'utf8'), pristine); assert.equal(upgraded.rebaselined, 0);
    fs.writeFileSync(shared, prior + '\n// unknown external edit');
    assert(apply().incomplete); assert.equal(fs.readFileSync(shared, 'utf8'), prior + '\n// unknown external edit');
    assert.equal(fs.readFileSync(shared + '.rsp-backup', 'utf8'), pristine);
  } finally { Object.assign(descriptor, savedDescriptors[0]); Object.assign(scratch.descriptor, savedDescriptors[1]); }
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

  // Execute the native exact-readback boundary with inert CLI/consent seams. A failed read
  // cannot establish a content conflict; append-only writes and strict byte equality remain.
  const readbackTarget = { projectRoot: sandbox, db: path.join(sandbox, 'inert-memory.db'), contentPathExcludes: [] };
  function turnReadback(source, retrieved, storeResult = { status: 1, stderr: '[ERROR] Key already exists' }) {
    let reads = 0, stores = 0;
    const turn = context(section(source, 'function readBack(', '/** Bounded recent evidence'), {
      TURN_NAMESPACE: 'turns', STEP_TIMEOUT_MS: 60_000, RUFLO_ENV: {},
      resolveTurnDb: () => readbackTarget, storeEncryptedAtRest: () => false,
      resolveRuflo: () => '/inert/ruflo', rufloInvocation: (file, args) => ({ executable: file, args }),
      rufloScratchRoot: () => sandbox, rufloRunDir: () => fs.mkdtempSync(path.join(sandbox, 'readback-')),
      flagValue: (args, flag) => args[args.indexOf(flag) + 1],
      redactText: redaction.redactText, maskExcludedPaths: value => value,
      captureFailureReason: privacy.captureFailureReason, digest: value => hash(value),
      recordHookFailure: () => {}, failureScope: () => ({}), validFailureScope: () => ({}),
    });
    const [row] = turn.runSteps({ event: 'SessionEnd', steps: [{ kind: 'store', projectRoot: sandbox,
      projectDir: sandbox, brainHome: sandbox, args: ['--key', 'turn-inert', '--value', 'exact outcome', '--path', readbackTarget.db] }] }, {
      projectDir: sandbox, brainHome: sandbox, run: (binary, args) => {
        if (args[1] === 'retrieve') { reads++; return retrieved; }
        stores++; assert(args.includes('--no-upsert') && args.includes('--append-only'));
        return storeResult;
      },
    });
    assert.equal(stores, 1, 'one native append attempt; no overwrite or replay');
    assert.equal(reads, 1, 'exact key is read once');
    return row;
  }
  const nativeTurn = fixture('turn-outcome-capture');
  // Brain4.7.28 and main blob16e1b784a516bb148d2d320d150eb66e927f316b (2026-11-02).
  assert.equal(digest(nativeTurn), 'e55c539a53fab2d9dc56be788c2af6df82b2083dd112fda74fb6631d720f2d34');
  const currentTurn = patched('turn-outcome-capture');
  assert.equal(turnReadback(nativeTurn, { status: 1, stderr: 'key not found' }).error,
    'duplicate turn key holds different content', 'native negative read is misleadingly called a content conflict');
  for (const result of [{ status: 1, stderr: 'key not found' }, { status: null, signal: 'SIGTERM' },
    { status: 0, stdout: 'exact outcome', error: Error('transport failed') }, { status: 0, stdout: 'exact outcome', signal: 'SIGTERM' }]) {
    const row = turnReadback(currentTurn, result);
    assert.equal(row.error, 'duplicate turn key could not be read back');
    assert.equal(row.verified, false); assert.notEqual(row.status, 0);
  }
  const conflict = turnReadback(currentTurn, { status: 0, stdout: 'different outcome' });
  assert.equal(conflict.error, 'duplicate turn key holds different content'); assert.equal(conflict.verified, false);
  for (const source of [nativeTurn, currentTurn]) {
    const identical = turnReadback(source, { status: 0, stdout: 'exact outcome' });
    assert.equal(identical.verified, true); assert.equal(identical.status, 0); assert.equal(identical.error, null);
  }
  const firstWrite = turnReadback(currentTurn, { status: 0, stdout: 'exact outcome' }, { status: 0 });
  assert.equal(firstWrite.verified, true);
  const unverifiedWrite = turnReadback(currentTurn, { status: 1 }, { status: 0 });
  assert.equal(unverifiedWrite.verified, false); assert.equal(unverifiedWrite.status, 1);
  assert.equal(unverifiedWrite.error, 'exact turn key/content readback failed');
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

  // Execute checkpoint -> original native runner boundary -> retrieve. The
  // child transport is inert; emitted observations and private writer are real.
  const diagnosticDir = path.join(sandbox, '.ruflo-source-patch/capture-diagnostics');
  const diagnosticFile = path.join(diagnosticDir, 'capture-0.json');
  const diagnosticProcess = { ...process, env: { RUFLO_SOURCE_PATCH_HOME: sandbox } };
  async function checkpointCase(mode, instrumented = true) {
    const spec = SPECS.find(s => s.relative === 'scripts/ruflo-memory-hooks.mjs');
    const prior = spec.edits.filter(({ id }) => !id.startsWith('checkpoint-diagnostic-'))
      .reduce((text, { from, to }) => text.replace(from, () => to), fixture('ruflo-memory-hooks'));
    const source = instrumented ? patched('ruflo-memory-hooks') : prior;
    const calls = [], deadlineAt = Date.now() + (mode === 'expired' ? -1 : 1000);
    let value;
    const checkpointCode = (instrumented ? CHECKPOINT_HELPER : '')
      + section(source, 'export function rufloMemory(', '\nfunction parseJson(')
      + section(source, 'const retrieve = ', '\nfunction gitFacts(')
      + section(source, 'export async function checkpoint(', '/** First page');
    const api = context(checkpointCode, {
      process: diagnosticProcess, failureScope: logger.failureScope,
      crypto: { ...crypto, randomUUID: () => '00000000-0000-4000-8000-000000000000' },
      AUTO_PREFIX: 'project-state-auto-', projectStore: () => ({ root: '/canonical/root', db: '/canonical/store', adopted: true, namespace: 'project' }),
      gitFacts: () => ({ branch: 'fixture', head: 'fixture' }),
      resolveRuflo: () => '/inert/ruflo', rufloInvocationOrPlain: (file, args) => ({ executable: file, args }),
      rufloSpawnOptions: () => ({ cwd: sandbox, env: {}, cleanup() {} }), killGroup() {},
      captureFailureReason: privacy.captureFailureReason,
      spawnDetached: (file, args, options, callback) => {
        calls.push(args[1]); assert(options.timeout <= 1000);
        assert(args.includes('--path')); assert.equal(args.at(-1), '/canonical/store');
        if (args[1] === 'store') { assert(args.includes('--no-upsert')); value = args[args.indexOf('--value') + 1]; }
        if (mode === 'throw') throw Object.assign(Error('PRIVATE_COMMAND'), { code: 'EACCES' });
        let error = null, stderr = '', stdout = args[1] === 'retrieve' ? value : '';
        if (mode === 'timeout' || mode === 'read-failed' && args[1] === 'retrieve') {
          error = Object.assign(Error('PRIVATE_COMMAND'), { code: null, signal: 'SIGKILL', killed: true });
          stderr = 'Native memory owner refused: Maximum sessions 100; password=SECRET; PRIVATE_PAYLOAD';
        }
        if (mode === 'launch') error = Object.assign(Error('PRIVATE_COMMAND'), { code: 'ENOENT' });
        if (mode === 'conflict' && args[1] === 'retrieve') stdout = 'PRIVATE_OTHER_VALUE';
        const child = { pid: mode === 'launch' ? undefined : 4321, exitCode: error ? null : 0, signalCode: error?.signal };
        queueMicrotask(() => callback(error, stdout, stderr));
        return child;
      },
    });
    const result = await api.checkpoint({ projectDir: '/input/path', event: 'PreCompact', payload: { session_id: 'PRIVATE_SESSION' },
      env: mode === 'off' ? { RSP_CAPTURE_DIAGNOSTICS: 'off' } : {}, deadlineAt, now: () => 1000 });
    return { result: JSON.parse(JSON.stringify(result)), calls };
  }
  for (const mode of ['success', 'timeout', 'read-failed', 'conflict', 'launch', 'expired']) {
    const old = await checkpointCase(mode, false), current = await checkpointCase(mode);
    assert.deepEqual(current, old, mode + ' native results and write/read counts unchanged');
    const receipt = JSON.parse(fs.readFileSync(diagnosticFile, 'utf8'));
    assert.equal(receipt.kind, 'brain-checkpoint-diagnostic');
    assert.equal(receipt.project, hash('/canonical/root')); assert.equal(receipt.store, hash('/canonical/store'));
    assert.equal(receipt.session, hash('PRIVATE_SESSION')); assert.equal(receipt.expectedKey, hash(current.result.key));
    assert.equal(receipt.readbackEntered, ['success', 'read-failed', 'conflict'].includes(mode));
    assert.equal(receipt.stages[0].stage, 'store'); assert.equal(receipt.stages.length, receipt.readbackEntered ? 2 : 1);
    assert(Number.isInteger(receipt.stages[0].remainingAtStartMs));
    assert(Number.isInteger(receipt.stages[0].elapsedMs));
    if (mode === 'timeout' || mode === 'read-failed') {
      const stage = receipt.stages.at(-1); assert(stage.launched && stage.attempted); assert.equal(stage.childPid, 4321);
      assert(stage.terminal.killed); assert.equal(stage.terminal.signal, 'SIGKILL');
      assert(stage.terminal.classification.includes('owner-refused')); assert(stage.terminal.classification.includes('session-capacity'));
      assert(stage.terminal.classification.includes('runner-killed'));
    }
    if (mode === 'expired') { assert(!receipt.stages[0].attempted); assert(!receipt.stages[0].launched); }
    if (mode === 'launch') { assert(receipt.stages[0].attempted); assert(!receipt.stages[0].launched); assert.equal(receipt.stages[0].terminal.code, 'ENOENT'); }
    if (mode === 'success') assert.equal(receipt.outcome, 'verified');
    if (mode === 'read-failed') assert.equal(receipt.outcome, 'readback-unavailable');
    if (mode === 'conflict') assert.equal(receipt.outcome, 'readback-conflict');
    const bytes = fs.readFileSync(diagnosticFile, 'utf8');
    for (const forbidden of ['PRIVATE_', 'SECRET', '/canonical', '/input/path', 'project-state-auto-']) assert(!bytes.includes(forbidden));
    assert(Buffer.byteLength(bytes) <= 16384); assert.equal(fs.statSync(diagnosticFile).mode & 0o777, 0o600);
  }
  for (const instrumented of [false, true]) await assert.rejects(checkpointCase('throw', instrumented), /PRIVATE_COMMAND/);
  const thrownReceipt = JSON.parse(fs.readFileSync(diagnosticFile, 'utf8'));
  assert(thrownReceipt.stages[0].terminal.classification.includes('launch-threw'));
  assert.equal(thrownReceipt.stages[0].terminal.code, 'EACCES');
  const beforeOff = fs.readFileSync(diagnosticFile, 'utf8'); await checkpointCase('off');
  assert.equal(fs.readFileSync(diagnosticFile, 'utf8'), beforeOff);
  fs.chmodSync(diagnosticFile, 0o644);
  const loggingUnavailable = await checkpointCase('success'); assert(loggingUnavailable.result.verified);
  assert.equal(fs.readFileSync(diagnosticFile, 'utf8'), beforeOff, 'unsafe diagnostic path refused without affecting checkpoint');
  fs.chmodSync(diagnosticFile, 0o600);

  // Real bounded native process-group runner, without a Ruflo driver or store.
  const nativeMemory = patched('ruflo-memory-hooks');
  const real = context(CHECKPOINT_HELPER
    + section(nativeMemory, '/** SIGKILL', '\nfunction parseJson('), {
    process: diagnosticProcess, spawn, failureScope: logger.failureScope,
    crypto: { ...crypto, randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    resolveRuflo: () => process.execPath,
    rufloInvocationOrPlain: () => ({ executable: process.execPath,
      args: ['-e', "process.stderr.write('Native memory owner refused: Maximum sessions 100 PRIVATE_PAYLOAD\\n');setInterval(()=>{},1000)"] }),
    rufloSpawnOptions: () => ({ cwd: sandbox, env: {}, cleanup() {} }), captureFailureReason: privacy.captureFailureReason,
  });
  const deadlineAt = Date.now() + 500;
  const diagnostic = real.checkpointDiagnostic({ env: {}, project: '/canonical/root', store: '/canonical/store', session: 'PRIVATE_SESSION', expectedKey: 'fixture-key', event: 'PreCompact', deadlineAt });
  const timed = await real.rufloMemory(['store'], { db: '/inert', deadlineAt, diagnostic });
  assert.equal(timed.error, 'timed out'); diagnostic.finish('store-failed');
  const realReceipt = JSON.parse(fs.readFileSync(diagnosticFile, 'utf8')), realStage = realReceipt.stages[0];
  assert(realStage.attempted && realStage.launched && realStage.childPid > 0);
  assert.equal(realStage.terminal.signal, 'SIGKILL');
  assert(realStage.terminal.timedOut || realStage.terminal.killed);
  assert(realStage.terminal.classification.includes('owner-refused'));
  assert(realStage.terminal.classification.includes('session-capacity'));
  assert(!JSON.stringify(realReceipt).includes('PRIVATE_PAYLOAD'));

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
  console.log('Brain#518: exact native PostToolUse restoration, preserved recovery/race refusal, actual detached route, scoped repeats, native stderr privacy, bounded ledger and unchanged shedding PASS');
} finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
