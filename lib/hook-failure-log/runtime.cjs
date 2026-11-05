'use strict';
// sparkling/ruflo-source-patch#5: diagnostics only; never consume stdin or change outcomes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : null;
const home = process.env.RUFLO_SOURCE_PATCH_HOME || os.userInfo().homedir;
const root = path.join(home, '.ruflo-source-patch', 'hook-failures');
const id = `${Date.now()}-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
let fd = null, file, failed = false, stderrBytes = 0;
const stderrHash = crypto.createHash('sha256');
const diagnostics = new Set();
let restoreObserved = false, restoreOperationObserved = false;
const startedAt = Date.now();
const hookNames = new Set(['session-start', 'session-end', 'session-snapshot', 'continuation-gate',
  'grounding-turn-gate', 'grounding-turn-mark', 'grounding-stamp', 'decision-gate', 'protect-state',
  'ground-before-write', 'unprompted-speech', 'ground-ruvnet', 'capacity-aware-parallel-work',
  'modify-bash', 'modify-file', 'post-command', 'post-edit', 'precompact-manual', 'precompact-auto',
  'learn-flush', 'Stop', 'SessionEnd', 'SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit',
  'SubagentStop', 'PreCompact', 'PostToolUseFailure']);
// Do not persist arbitrary stderr. Its digest/count plus allowlisted classifications retain
// diagnostic value without attempting to recognize every possible secret or user quotation.
function classify(value) {
  const text = String(value || '');
  const known = [
    ['module-not-found', /Cannot find (?:module|package)|MODULE_NOT_FOUND/],
    ['database-malformed', /database disk image is malformed/],
    ['database-locked', /database is locked|write lock unavailable/],
    ['timeout', /ETIMEDOUT|timed out|deadline exceeded/],
    ['permission-denied', /EACCES|EPERM|permission denied/i],
    ['syntax-error', /SyntaxError/],
  ];
  for (const [name, pattern] of known) if (pattern.test(text)) diagnostics.add(name);
}
function append(row) {
  if (fd === null) return;
  try { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(),
    hook: process.argv.filter(arg => hookNames.has(arg)), ...row }) + '\n'); }
  catch { /* diagnostics cannot change the hook contract */ }
}
// Preserve contemporaneous, already-redacted policy timings when a restore fails.
// These are overlapping transactions, not an assertion that each caused the failure.
// Never inspect managed stores; the 128 native diagnostic slots otherwise rotate away.
function snapshotRestorePolicy(elapsedMs) {
  const now = Date.now(), began = performance.now();
  const since = now - Math.min(60_000, Math.max(0, elapsedMs || 0) + 1000);
  const snapshot = { phase: 'restore-policy-window', since, until: now,
    scanned: 0, unavailable: 0, truncated: false, transactions: [] };
  const numeric = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  const hex = (value, length) => typeof value === 'string' && value.length === length
    && /^[a-f0-9]+$/.test(value) ? value : undefined;
  const phases = new Set(['waiting', 'acquired', 'state-loaded', 'anchors-verified',
    'operation-finished', 'publishing', 'committed', 'released', 'failed']);
  try {
    const dir = path.join(home, '.ruflo-source-patch', 'policy-diagnostics');
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)
        || (process.getuid && stat.uid !== process.getuid())) return;
    for (let slot = 0; slot < 128; slot++) {
      if (performance.now() - began >= 50) { snapshot.truncated = true; break; }
      let input;
      try {
        const name = `transaction-${slot}.json`;
        input = fs.openSync(path.join(dir, name), fs.constants.O_RDONLY
          | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
        const s = fs.fstatSync(input);
        if (!s.isFile() || s.nlink !== 1 || s.size > 16384 || (s.mode & 0o077)
            || (process.getuid && s.uid !== process.getuid())) { snapshot.unavailable++; continue; }
        // A single fixed-size read remains bounded if a concurrent writer changes size.
        const bytes = Buffer.alloc(16385), count = fs.readSync(input, bytes, 0, bytes.length, 0);
        snapshot.scanned++;
        if (count > 16384) { snapshot.unavailable++; continue; }
        const row = JSON.parse(bytes.subarray(0, count).toString('utf8'));
        const at = Date.parse(row.startedAt), events = Array.isArray(row.phases) ? row.phases : [];
        const last = events.at(-1), end = at + (numeric(last?.elapsedMs) || 0);
        if (!Number.isFinite(at) || at > now || at < now - 60_000
            || (end < since && ['released', 'failed'].includes(last?.phase))) continue;
        const transaction = { file: name, sourceSha256: hash(bytes.subarray(0, count)),
          pid: numeric(row.pid), project: hex(row.project, 16), startedAt: new Date(at).toISOString(),
          phases: events.slice(0, 16).filter(e => phases.has(e?.phase)).map(e => ({
            phase: e.phase, elapsedMs: numeric(e.elapsedMs), lockOwnerPid: numeric(e.lockOwnerPid),
            lockAgeMs: numeric(e.lockAgeMs),
            error: typeof e.error === 'string' && /^policy-[a-z-]{1,80}$/.test(e.error) ? e.error : undefined,
          })),
          operations: (Array.isArray(row.operations) ? row.operations : []).slice(0, 32).map(o => ({
            tool: typeof o?.tool === 'string' && /^[a-z0-9_-]{1,80}$/.test(o.tool) ? o.tool : undefined,
            inputDigest: typeof o?.inputDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(o.inputDigest) ? o.inputDigest : undefined,
            route: ['owner', 'owner-coalesced'].includes(o?.route) ? o.route : undefined,
            queueWaitMs: numeric(o?.queueWaitMs),
          })) };
        snapshot.transactions.push(transaction);
      } catch { snapshot.unavailable++; }
      finally { if (input !== undefined) try { fs.closeSync(input); } catch {} }
    }
    snapshot.transactions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    if (snapshot.transactions.length > 32) { snapshot.transactions.length = 32; snapshot.truncated = true; }
    while (Buffer.byteLength(JSON.stringify(snapshot)) > 65536) {
      snapshot.transactions.pop(); snapshot.truncated = true;
    }
    snapshot.snapshotMs = Math.ceil(performance.now() - began);
    append(snapshot);
  } catch { /* Missing, unsafe or unavailable diagnostics cannot alter restoration. */ }
}
function prune() {
  try {
    const files = fs.readdirSync(root).filter(f => /^\d+-\d+-[a-f0-9]{16}\.jsonl$/.test(f)).sort();
    for (const name of files.slice(0, Math.max(0, files.length - 256))) {
      const candidate = path.join(root, name), stat = fs.lstatSync(candidate);
      // Never evict another live invocation. Incomplete entries age out after a day.
      const pid = Number(name.split('-')[1]); let live = false;
      try { process.kill(pid, 0); live = true; } catch (e) { live = e.code === 'EPERM'; }
      if (stat.isFile() && !stat.isSymbolicLink() && (!live || Date.now() - stat.mtimeMs > 86400000)) fs.unlinkSync(candidate);
    }
  } catch { /* best effort retention, no effect on execution */ }
}
try {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)
      || (process.getuid && stat.uid !== process.getuid())) throw Error('unsafe diagnostic directory');
  file = path.join(root, id + '.jsonl');
  fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0), 0o600);
  append({ phase: 'started', pid: process.pid, ppid: process.ppid, cwd: process.cwd(),
    executable: process.execPath, script: process.argv[1] || '[node-e]',
    pluginRoot: process.env.CLAUDE_PLUGIN_ROOT || null,
    commandSha256: hash(JSON.stringify([process.execArgv, process.argv])) });
  prune();
} catch { /* read-only or unavailable logging never prevents a hook */ }
const originalWrite = process.stderr.write;
process.stderr.write = function (chunk, ...args) {
  try {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    stderrBytes += bytes.length; stderrHash.update(bytes); classify(bytes.toString('utf8'));
  } catch { /* preserve the original write, including its own errors */ }
  return Reflect.apply(originalWrite, this, [chunk, ...args]);
};
for (const name of ['spawnSync', 'execFileSync', 'execSync']) {
  const original = cp[name];
  cp[name] = function (...args) {
    const before = Date.now();
    try {
      const result = Reflect.apply(original, this, args);
      if (name === 'spawnSync' && (result.error || result.signal || result.status !== 0)) {
        failed = true;
        try {
          classify(result.stderr); classify(result.error?.message);
          append({ phase: 'child-failed', api: name, executable: path.basename(String(args[0])),
            argvSha256: hash(JSON.stringify(args.slice(0, 2))), status: result.status,
            signal: safeCode(result.signal), errorCode: safeCode(result.error?.code),
            elapsedMs: Date.now() - before, stderrBytes: Buffer.byteLength(result.stderr || ''),
            stderrSha256: hash(result.stderr || ''), diagnostics: [...diagnostics] });
        } catch { /* observation must not turn a returned child failure into a thrown one */ }
      }
      return result;
    } catch (error) {
      failed = true;
      try {
        classify(error.message); classify(error.stderr);
        append({ phase: 'child-threw', api: name, status: error.status ?? null,
          signal: safeCode(error.signal), errorCode: safeCode(error.code),
          elapsedMs: Date.now() - before, diagnostics: [...diagnostics] });
      } catch { /* preserve the exact original exception */ }
      throw error;
    }
  };
}
syncBuiltinESMExports();
// Brain #522: write starts immediately so a parent deadline retains in-flight reads.
// At most 32 starts and their single terminal rows per process, all metadata allowlisted.
const restoreOperations = new Map();
let restoreOperationCount = 0;
require('node:diagnostics_channel').channel('ruflo-source-patch.brain-restore-operation').subscribe(row => {
  try {
    const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (row?.event === 'start') {
      if (restoreOperationCount >= 32 || !row.token || typeof row.token !== 'object'
          || restoreOperations.has(row.token) || !['list', 'get'].includes(row.operation)) return;
      const id = ++restoreOperationCount;
      restoreOperations.set(row.token, id); restoreOperationObserved = true;
      append({ phase: 'restore-operation-start', operationId: id, operation: row.operation,
        namespaceHash: typeof row.namespaceHash === 'string' && /^[a-f0-9]{64}$/.test(row.namespaceHash) ? row.namespaceHash : null,
        limit: row.operation === 'list' ? number(row.limit) : null, deadlineAt: number(row.deadlineAt) });
    } else if (['end', 'error'].includes(row?.event) && restoreOperations.has(row.token)) {
      const id = restoreOperations.get(row.token); restoreOperations.delete(row.token);
      append({ phase: 'restore-operation-' + row.event, operationId: id, elapsedMs: number(row.elapsedMs),
        state: ['ok', 'unavailable', 'timed out', 'fallback'].includes(row.state) ? row.state : null,
        count: number(row.count), errorCode: safeCode(row.errorCode),
        errorName: ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError'].includes(row.errorName) ? row.errorName : null });
    }
  } catch { /* Observation never alters a native read or its cancellation. */ }
});
// Brain #522: caught restore errors otherwise leave neither stderr nor a cause.
// Keep a success comparison too, using this logger's existing private retention.
require('node:diagnostics_channel').channel('ruflo-source-patch.brain-restore').subscribe(row => {
  try {
    if (restoreObserved) return;
    restoreObserved = true;
    const oneOf = (value, values) => values.includes(value) ? value : null;
    const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    classify(String(row.error?.message || '').slice(0, 4096));
    append({ phase: 'restore-result', failed: row.failed === true,
      status: oneOf(row.status, ['restored', 'empty', 'unavailable', 'unknown', 'partial', 'refused', 'failed', 'timed-out']),
      route: oneOf(row.route, ['fast', 'fallback', 'fast-unverified']),
      elapsedMs: number(row.ms), budgetMs: number(row.budgetMs),
      errorCode: safeCode(row.error?.code),
      errorName: oneOf(row.error?.name, ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError']),
      errorFrames: String(row.error?.stack || '').slice(0, 8192).split('\n').slice(1, 7)
        .flatMap(line => /(?:\/|\\)([A-Za-z0-9_.-]{1,120}\.(?:mjs|cjs|js)):(\d{1,10}):(\d{1,10})\)?$/.exec(line)?.slice(1).join(':') || []),
      errorSha256: row.error ? hash(String(row.error.message || '').slice(0, 65536)) : null,
      diagnostics: [...diagnostics] });
    if (row.failed === true) snapshotRestorePolicy(number(row.ms));
  } catch { /* Never change native restoration or its advisory result. */ }
});
process.on('uncaughtExceptionMonitor', error => {
  failed = true; classify(error.message);
  append({ phase: 'uncaught', errorCode: safeCode(error.code), diagnostics: [...diagnostics] });
});
process.on('exit', status => {
  failed ||= status !== 0;
  append({ phase: 'exited', status, elapsedMs: Date.now() - startedAt,
    stderrBytes, stderrSha256: stderrHash.digest('hex'), diagnostics: [...diagnostics] });
  try { if (fd !== null) fs.closeSync(fd); } catch { /* no change to exit */ }
  if (!failed && !restoreObserved && !restoreOperationObserved && file) { try { fs.unlinkSync(file); } catch { /* harmless retained success */ } }
});
