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
process.on('uncaughtExceptionMonitor', error => {
  failed = true; classify(error.message);
  append({ phase: 'uncaught', errorCode: safeCode(error.code), diagnostics: [...diagnostics] });
});
process.on('exit', status => {
  failed ||= status !== 0;
  append({ phase: 'exited', status, elapsedMs: Date.now() - startedAt,
    stderrBytes, stderrSha256: stderrHash.digest('hex'), diagnostics: [...diagnostics] });
  try { if (fd !== null) fs.closeSync(fd); } catch { /* no change to exit */ }
  if (!failed && file) { try { fs.unlinkSync(file); } catch { /* harmless retained success */ } }
});
