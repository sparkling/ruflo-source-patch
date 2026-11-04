// Brain #518: checkpoint-specific observations using the existing capture ring.
import { TIMING_EDITS } from '../brain-capture-launch/diagnostics.mjs';

// Reuse the reviewed private/FIFO-safe bounded writer verbatim. This is source
// composition, not a second logger or a new installed module dependency.
const timing = TIMING_EDITS.find(([id]) => id === 'timing-helpers')[2];
const start = timing.indexOf('  const persist = trace => {');
const end = timing.indexOf('  const run = ', start);
if (start < 0 || end <= start) throw Error('Shared capture diagnostic persistence boundary unavailable');
const persistence = timing.slice(start, end);

function checkpointDiagnostic({ env, project, store, session, expectedKey, event, deadlineAt }) {
  const idle = { begin() {}, attempt() {}, spawned() {}, terminal() {}, finish() {} };
  try {
    if (env?.RSP_CAPTURE_DIAGNOSTICS === 'off') return idle;
    const started = Date.now();
    const row = { schemaVersion: 1, kind: 'brain-checkpoint-diagnostic', invocation: crypto.randomUUID(),
      pid: process.pid, observedAt: new Date(started).toISOString(),
      event: ['PreCompact', 'SessionEnd'].includes(event) ? event : 'unknown',
      ...failureScope({ project, store, session, expectedKey }),
      deadlineAt: Number.isSafeInteger(deadlineAt) ? deadlineAt : null,
      readbackEntered: false, stages: [] };
    const numeric = value => Number.isSafeInteger(value) ? value : null;
    const signal = value => ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGHUP', 'SIGPIPE', 'SIGSEGV', 'SIGBUS'].includes(value) ? value : null;
    const code = value => Number.isSafeInteger(value) ? value
      : ['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ENOBUFS', 'ENOMEM', 'EAGAIN', 'EPIPE', 'ECONNRESET',
        'ECONNREFUSED', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ERR_OUT_OF_RANGE', 'ERR_INVALID_ARG_TYPE'].includes(value) ? value : null;
    const observe = fn => { try { return fn(); } catch { /* observation never changes a native result */ } };
    const classify = (details) => {
      const text = String(details.stderr || '').slice(0, 65536), classes = [];
      for (const [name, pattern] of [
        ['owner-binding-refused', /Memory owner binding is missing or ambiguous|owner binding.*(?:mismatch|refus)/i],
        ['owner-refused', /Native memory owner refused/i],
        ['owner-unavailable', /owner.*(?:unavailable|not configured|not reachable)|ECONNREFUSED/i],
        ['session-capacity', /Maximum sessions|session.*(?:capacity|limit.*reached)/i],
        ['native-wal-refused', /active.*(?:WAL|sql\.js)|whole.image.*(?:refus|WAL)|Native memory writer required/i],
        ['policy-denied', /policy.denied|policy.*(?:deny|denied|refus)|authorization.*(?:failed|denied)/i],
        ['append-only-conflict', /already exists|append.only.*(?:conflict|refus)/i],
      ]) if (pattern.test(text)) classes.push(name);
      if (details.cancelled) classes.push('cancelled');
      if (details.timedOut) classes.push('deadline-expired');
      if (details.error?.killed) classes.push('runner-killed');
      if (details.reason === 'global Ruflo unavailable') classes.push('ruflo-unavailable');
      if (details.reason === 'cancelled') classes.push('cancelled-before-launch');
      if (details.reason === 'deadline exceeded before launch') classes.push('deadline-before-launch');
      if (details.launchError) classes.push('launch-threw');
      if (!classes.length) classes.push(details.error || details.reason ? 'unclassified-failure' : 'completed');
      return classes;
    };
    // __SHARED_CAPTURE_PERSISTENCE__
    return {
      begin: (stage, deadline) => observe(() => {
        if (!['store', 'retrieve'].includes(stage) || row.stages.length >= 2) return;
        const entry = { stage, startedAt: Date.now(), deadlineAt: numeric(deadline),
          remainingAtStartMs: numeric(deadline - Date.now()), attempted: false, launched: false, childPid: null };
        row.stages.push(entry);
        if (stage === 'retrieve') row.readbackEntered = true;
        return entry;
      }),
      attempt: entry => observe(() => { if (entry) entry.attempted = true; }),
      spawned: (entry, child) => observe(() => {
        if (entry && Number.isSafeInteger(child?.pid) && child.pid > 0) {
          entry.launched = true; entry.childPid = child.pid;
          entry.childRole = process.platform === 'win32' ? 'command' : 'watchdog-process-group';
        }
      }),
      terminal: (entry, details = {}) => observe(() => {
        if (!entry) return;
        if (Number.isSafeInteger(details.pid) && details.pid > 0) { entry.launched = true; entry.childPid = details.pid; }
        entry.elapsedMs = Date.now() - entry.startedAt;
        entry.remainingAtEndMs = numeric(entry.deadlineAt - Date.now());
        entry.terminal = { code: code(details.error?.code ?? details.code), signal: signal(details.error?.signal ?? details.signal),
          killed: details.error?.killed === true, timedOut: details.timedOut === true, cancelled: details.cancelled === true,
          errorPresent: !!details.error, classification: classify(details),
          classificationInputTruncated: typeof details.stderr === 'string' && details.stderr.length > 65536 };
        row.elapsedMs = Date.now() - started;
        persist(row);
      }),
      finish: outcome => observe(() => {
        row.outcome = ['store-failed', 'verified', 'readback-unavailable', 'readback-conflict'].includes(outcome) ? outcome : 'unknown';
        row.elapsedMs = Date.now() - started;
        persist(row);
      }),
    };
  } catch { return idle; }
}

export const CHECKPOINT_HELPER = checkpointDiagnostic.toString().replace('    // __SHARED_CAPTURE_PERSISTENCE__', persistence);
export const CHECKPOINT_EDITS = [
  ['checkpoint-diagnostic-helper', "import { openBatchSession } from './agentdb-recall-process.mjs';",
    "import { openBatchSession } from './agentdb-recall-process.mjs';\nimport { failureScope } from './hook-failures.mjs';\n" + CHECKPOINT_HELPER],
  ['checkpoint-diagnostic-option', '  run = spawnDetached, invoke = rufloInvocationOrPlain } = {}) {',
    '  run = spawnDetached, invoke = rufloInvocationOrPlain, diagnostic } = {}) {'],
  ['checkpoint-diagnostic-start', "    const refuse = (error) => resolve({ ok: false, stdout: '', error });",
    "    const operation = diagnostic?.begin(args[0], deadlineAt);\n    const refuse = (error) => { diagnostic?.terminal(operation, { reason: error }); resolve({ ok: false, stdout: '', error }); };"],
  ['checkpoint-diagnostic-attempt', '    child = run(inv.executable, inv.args,',
    '    diagnostic?.attempt(operation);\n    try { child = run(inv.executable, inv.args,'],
  ['checkpoint-diagnostic-terminal', "        resolve({ ok: !error, stdout: String(stdout || ''), error: reason });\n      });\n    // Backstop",
    "        diagnostic?.terminal(operation, { error, stderr, pid: child?.pid, code: child?.exitCode, signal: child?.signalCode, timedOut, cancelled: signal?.aborted });\n        resolve({ ok: !error, stdout: String(stdout || ''), error: reason });\n      });\n    } catch (error) { diagnostic?.terminal(operation, { error, launchError: true }); throw error; }\n    diagnostic?.spawned(operation, child);\n    // Backstop"],
  ['checkpoint-diagnostic-binding', '  const options = { db: store.db, env, bin, deadlineAt };',
    '  const diagnostic = checkpointDiagnostic({ env, project: store.root, store: store.db, session: payload.session_id, expectedKey: key, event, deadlineAt });\n  const options = { db: store.db, env, bin, deadlineAt, diagnostic };'],
  ['checkpoint-diagnostic-failed', '  if (!stored.ok) return { stored: false, key, skipped: `store failed: ${stored.error}` };',
    "  if (!stored.ok) { diagnostic.finish('store-failed'); return { stored: false, key, skipped: `store failed: ${stored.error}` }; }"],
  ['checkpoint-diagnostic-readback', '  return { stored: true, key, namespace: store.namespace, verified: readBack === value };',
    "  diagnostic.finish(readBack === value ? 'verified' : readBack === null ? 'readback-unavailable' : 'readback-conflict');\n  return { stored: true, key, namespace: store.namespace, verified: readBack === value };"],
].map(([id, from, to]) => ({ id, from, to }));
