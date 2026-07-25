// The gaps an independent audit found, and the bug hiding in one of them.
//
//   CC  state.json had NO LOCK around its read-modify-write. Three concurrent installs lost a target
//       in 12 runs out of 12 — the default outcome, not a rare race. And state.json is what the hook
//       and the monitor re-apply FROM, so a dropped target is one the next tick actively UN-PATCHES.
//       We had ruflo's own #2621 (last-writer-wins silently drops writes) in our own state file.
//   ML  the `memory` write-lock was only ever checked for TEXTUAL PRESENCE. The code we inject to fix
//       "50 acked, 25 on disk" had never actually RUN.
//   PG  applyPlugins()'s per-target try/catch: one throwing patcher used to blind the whole watchdog
//       while it reported health. Never tested.
//   UB  scanUncoveredBuilds(): the detector for the 38-daemons incident. `return []` passed everything.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { REPO, findVendorRoot, pristineBytes } from './fixtures.mjs';

const SB = process.argv[2];
const HOME = path.join(SB, 'home');
const STATE = path.join(HOME, '.ruflo-source-patch');
const REAL = findVendorRoot();
const lib = await import(`file://${path.join(REPO, 'lib', 'cwd', 'patch-library.mjs')}`);

const TARGETS = ['cwd', 'daemon', 'memory'];
// Keep this oracle tied to the shipped table: every CURRENT @claude-flow file touched by these
// targets belongs in the race, including the many cwd state writers. The @sparkleideas legacy
// daemon entry has its own synthesized acceptance test below and is not part of the current CLI.
const FILES = [...new Set(lib.ENTRIES
  .filter((entry) => TARGETS.includes(entry.target) && entry.suffix[0] === '@claude-flow')
  .map((entry) => entry.suffix.join('/')))]
  .filter((rel) => fs.existsSync(path.join(REAL, rel)));
const PRISTINE = new Map(FILES.map((rel) => [rel, pristineBytes(path.join(REAL, rel))]));
const DAEMON_AUTOSTART_REL = '@claude-flow/cli/dist/src/services/daemon-autostart.js';
const nm = path.join(SB, 'npx', 'h', 'node_modules');
const vendor = (rel) => path.join(nm, rel);

function freshSandbox() {
  fs.rmSync(SB, { recursive: true, force: true });
  fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}');
  for (const rel of FILES) {
    fs.mkdirSync(path.dirname(vendor(rel)), { recursive: true });
    fs.writeFileSync(vendor(rel), PRISTINE.get(rel));
  }
}

const env = {
  ...process.env,
  RUFLO_SOURCE_PATCH_HOME: HOME,
  RUFLO_NPX_ROOT: path.join(SB, 'npx'),
  RUFLO_GLOBAL_ROOT: path.join(SB, 'global'),
};
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), ...args], { env, encoding: 'utf8' });
const fail = (m) => { console.log(`\n✘ ${m}`); process.exit(1); };
const out = (r) => `${r.stdout || ''}${r.stderr || ''}`;

function requireCompleteStatus(label) {
  const status = cli(['cwd', 'status']);
  if (status.status !== 0) fail(`CC3 ${label}: status failed:\n${out(status)}`);
  const text = out(status);
  for (const targetName of TARGETS) {
    const match = text.match(new RegExp(`✔\\s+${targetName}\\s+(\\d+)\\/(\\d+)\\s+file\\(s\\) patched`));
    if (!match) fail(`CC3 ${label}: status has no installed ratio for ${targetName}:\n${text}`);
    const patched = Number(match[1]);
    const total = Number(match[2]);
    if (total <= 0 || patched !== total) {
      fail(`CC3 ${label}: ${targetName} is only ${patched}/${total} patched:\n${text}`);
    }
  }
  return text;
}

function installedSnapshot(label) {
  const snapshot = new Map();
  for (const rel of FILES) {
    const file = vendor(rel);
    const backup = `${file}.rsp-backup`;
    if (!fs.existsSync(file)) fail(`CC3 ${label}: patched file disappeared: ${rel}`);
    if (!fs.existsSync(backup)) fail(`CC3 ${label}: pristine backup is missing: ${rel}`);
    const fileBytes = fs.readFileSync(file);
    const backupBytes = fs.readFileSync(backup);
    if (fileBytes.length === 0) fail(`CC3 ${label}: concurrent apply truncated ${rel}`);
    if (backupBytes.length === 0) fail(`CC3 ${label}: pristine backup is empty: ${rel}`);
    if (!backupBytes.equals(PRISTINE.get(rel))) {
      fail(`CC3 ${label}: backup is not byte-identical to pristine vendor bytes: ${rel}`);
    }
    snapshot.set(rel, { fileBytes, backupBytes });
  }
  return snapshot;
}

function mutationArtifacts() {
  const found = [];
  for (const name of ['state.json.lock', 'state.json.mutation.lock', 'state.json.mutation.lock.recovery']) {
    const file = path.join(STATE, name);
    if (fs.existsSync(file)) found.push(file);
  }
  const pending = [nm, STATE];
  while (pending.length) {
    const dir = pending.pop();
    let children = [];
    try { children = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      const file = path.join(dir, child.name);
      if (child.isDirectory()) pending.push(file);
      else if (child.name.includes('.rsp-tmp-') || child.name.includes('.candidate-')) found.push(file);
    }
  }
  return found;
}

function requireNoMutationArtifacts(label) {
  const found = mutationArtifacts();
  if (found.length) fail(`CC2 ${label}: lock/temp artifacts were left behind:\n${found.join('\n')}`);
}

function concurrentInstall(targetName) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), targetName, 'install'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 45000);
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ targetName, stdout, stderr, timedOut, ...result });
    };
    child.once('error', (error) => settle({ code: null, signal: null, error }));
    child.once('close', (code, signal) => settle({ code, signal }));
  });
}

if (!FILES.includes(DAEMON_AUTOSTART_REL)) {
  fail(`CC fixture table does not include the current daemon-autostart entry: ${DAEMON_AUTOSTART_REL}`);
}
for (const targetName of TARGETS) {
  if (!lib.ENTRIES.some((entry) => entry.target === targetName
    && entry.suffix[0] === '@claude-flow'
    && FILES.includes(entry.suffix.join('/')))) {
    fail(`CC fixture table has no current vendor file for ${targetName}`);
  }
}

const invalidTimeout = spawnSync(process.execPath, [
  '--input-type=module',
  '--eval',
  `import(${JSON.stringify(`file://${path.join(REPO, 'lib', 'cwd', 'state.mjs')}`)}).then((m) => process.stdout.write(String(m.PATCH_LOCK_TIMEOUT_MS)))`,
], { env: { ...env, RSP_PATCH_LOCK_TIMEOUT_MS: 'banana' }, encoding: 'utf8' });
if (invalidTimeout.status !== 0 || invalidTimeout.stdout !== '30000') {
  fail(`CC0 invalid RSP_PATCH_LOCK_TIMEOUT_MS did not fall back to 30000ms:\n${out(invalidTimeout)}`);
}

// A dead owner is recovered once, under a second guard. All three contenders must still serialize;
// the stale observation that prompted recovery is never permission to delete a successor's live lock.
freshSandbox();
fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(path.join(STATE, 'state.json.mutation.lock'), `${JSON.stringify({
  pid: 2147483647, token: 'dead-owner', startedAt: new Date(0).toISOString(),
})}\n`);
const recovered = await Promise.all(TARGETS.map(concurrentInstall));
if (recovered.some((child) => child.timedOut || child.code !== 0 || child.signal || child.error)) {
  fail(`CC1 dead-owner recovery did not serialize all contenders:\n${recovered.map(out).join('\n')}`);
}
requireCompleteStatus('dead-owner recovery');
requireNoMutationArtifacts('dead-owner recovery');

// Malformed ownership is not "provably dead": timeout loudly instead of stealing it by age.
freshSandbox();
fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(path.join(STATE, 'state.json.mutation.lock'), 'not valid ownership metadata\n');
const malformed = spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), 'cwd', 'install'], {
  env: { ...env, RSP_PATCH_LOCK_TIMEOUT_MS: '1000' }, encoding: 'utf8',
});
if (malformed.status === 0 || !/timed out|refusing/.test(out(malformed))) {
  fail(`CC1 malformed lock was stolen or failed silently:\n${out(malformed)}`);
}

// SessionStart remains non-blocking, but a live lock timeout must be visible rather than swallowed.
fs.writeFileSync(path.join(STATE, 'state.json.mutation.lock'), `${JSON.stringify({
  pid: process.pid, token: 'live-owner', startedAt: new Date().toISOString(),
})}\n`);
const hook = spawnSync(process.execPath, [path.join(REPO, 'lib', 'cwd', 'session-start.mjs')], {
  env: { ...env, RSP_PATCH_LOCK_TIMEOUT_MS: '1000' }, encoding: 'utf8',
});
if (hook.status !== 0 || !/ATTENTION.*not re-applied|re-apply failed/s.test(out(hook))) {
  fail(`CC1 SessionStart lock timeout was silent or blocked startup:\n${out(hook)}`);
}

// A torn/corrupt desired-state image must not be reinterpreted as "nothing installed".
freshSandbox();
fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(path.join(STATE, 'state.json'), '{"patchTargets":');
const corruptState = cli(['cwd', 'install']);
if (corruptState.status === 0 || !/cannot read .*state\.json/.test(out(corruptState))) {
  fail(`CC1 corrupt desired state was treated as an empty successful install:\n${out(corruptState)}`);
}
for (const rel of FILES) {
  if (!fs.readFileSync(vendor(rel)).equals(PRISTINE.get(rel)) || fs.existsSync(`${vendor(rel)}.rsp-backup`)) {
    fail(`CC1 corrupt desired state still mutated vendor bytes: ${rel}`);
  }
}
requireNoMutationArtifacts('corrupt desired state');

// ─── CC: concurrent installs must match a fresh sequential installation ─────

// Build the byte-for-byte oracle from the same pristine vendor files, but with the mutations serialized
// explicitly. A non-empty file or a checkmark is not enough: the concurrent outcome must be identical.
freshSandbox();
for (const targetName of TARGETS) {
  const result = cli([targetName, 'install']);
  if (result.status !== 0) fail(`CC3 sequential ${targetName} install failed:\n${out(result)}`);
}
const expectedState = fs.readFileSync(path.join(STATE, 'state.json'));
requireCompleteStatus('sequential oracle');
const expectedFiles = installedSnapshot('sequential oracle');
requireNoMutationArtifacts('sequential oracle');

const RUNS = 8;
for (let i = 0; i < RUNS; i++) {
  freshSandbox();
  // eslint-disable-next-line no-await-in-loop
  const children = await Promise.all(TARGETS.map(concurrentInstall));
  for (const child of children) {
    if (child.timedOut || child.code !== 0 || child.signal || child.error) {
      fail(`CC run ${i + 1}: ${child.targetName} install failed`
        + ` (code=${child.code}, signal=${child.signal}, timedOut=${child.timedOut}):\n`
        + `${child.stdout}${child.stderr}${child.error ? `\n${child.error.message}` : ''}`);
    }
  }

  const actualState = fs.readFileSync(path.join(STATE, 'state.json'));
  if (!actualState.equals(expectedState)) {
    fail(`CC run ${i + 1}: concurrent state differs from the sequential oracle:\n${actualState}`);
  }
  requireCompleteStatus(`run ${i + 1}`);
  const actualFiles = installedSnapshot(`run ${i + 1}`);
  for (const rel of FILES) {
    const expected = expectedFiles.get(rel);
    const actual = actualFiles.get(rel);
    if (!actual.fileBytes.equals(expected.fileBytes)) {
      fail(`CC3 run ${i + 1}: patched vendor bytes differ from the sequential oracle: ${rel}`);
    }
    if (!actual.backupBytes.equals(expected.backupBytes)) {
      fail(`CC3 run ${i + 1}: backup bytes differ from the sequential oracle: ${rel}`);
    }
  }
  requireNoMutationArtifacts(`run ${i + 1}`);
}

console.log(`✔ concurrency (CC ${RUNS} runs of 3 simultaneous installs match a fresh sequential state + ${FILES.length} vendor/backup byte oracle; every status ratio complete; CC2 no lock/temp artifacts)`);

// ─── ML: the injected memory WRITE LOCK actually works ───────────────────────
// The highest-value missing test in the package. We inject this lock to fix ruflo #2621 — "50 acked,
// 25 on disk" — and had only ever asserted that the STRING was present in the file.
//
// Run the real fragment: two processes doing a read-modify-write of a shared file, each incrementing a
// counter 40 times, exactly the shape storeEntry() has. Without a lock the interleaving loses writes.

const memLockSrc = lib.FRAGMENTS?.memLock?.src;
if (!memLockSrc) fail('ML the memLock fragment is not exported from patch-library — cannot test the code we inject');

const target = path.join(SB, 'counter.json');
const worker = path.join(SB, 'worker.mjs');
fs.writeFileSync(target, JSON.stringify({ n: 0 }));

// The fragment verbatim, plus the __rufloReq shim the patched module provides, plus a read-modify-write
// wrapped in the lock exactly as __rufloGuard wraps storeEntry.
fs.writeFileSync(worker, `
import { createRequire as __rufloCreateRequire } from 'node:module';
const __rufloReq = __rufloCreateRequire(import.meta.url);
${memLockSrc}

const p = process.argv[2];
const fs2 = __rufloReq('fs');
for (let i = 0; i < 40; i++) {
  const h = await __rufloLockAcquire(p);
  try {
    const cur = JSON.parse(fs2.readFileSync(p, 'utf8'));      // READ
    await new Promise((r) => setTimeout(r, 1));               // ...widen the window, as real I/O does
    cur.n += 1;
    fs2.writeFileSync(p, JSON.stringify(cur));                // MODIFY-WRITE
  } finally {
    __rufloLockRelease(p, h);
  }
}
`);

await Promise.all([0, 1].map(() => new Promise((res) => {
  spawn(process.execPath, [worker, target], { stdio: 'ignore' }).on('exit', res);
})));

const finalN = JSON.parse(fs.readFileSync(target, 'utf8')).n;
if (finalN !== 80) {
  fail(`ML the injected write lock LOST WRITES: counter = ${finalN}, expected 80.\n`
    + '   This is the lock we inject into ruflo to fix "50 acked, 25 on disk" (#2621). It does not work.');
}

// ML2 — it is REENTRANT. storeEntry() calls getEntry() internally; a naive lock self-deadlocks, and the
// fragment's comment claims reentrancy. Claiming is not proving.
const reentrant = path.join(SB, 'reentrant.mjs');
fs.writeFileSync(reentrant, `
import { createRequire as __rufloCreateRequire } from 'node:module';
const __rufloReq = __rufloCreateRequire(import.meta.url);
${memLockSrc}
const p = process.argv[2];
const outer = await __rufloLockAcquire(p);
const inner = await __rufloLockAcquire(p);   // <- would deadlock if not reentrant
__rufloLockRelease(p, inner);
__rufloLockRelease(p, outer);
console.log('reentrant-ok');
`);
const rr = spawnSync(process.execPath, [reentrant, target], { encoding: 'utf8', timeout: 15000 });
if (!/reentrant-ok/.test(out(rr))) {
  fail(`ML2 the lock is NOT reentrant — storeEntry() calls getEntry() internally and would self-deadlock:\n${out(rr)}`);
}

// ML3 — the lock file is released, not leaked.
if (fs.existsSync(`${target}.rsp-lock`)) fail('ML3 the injected lock leaked its lockfile — every later write would stall 15s');

console.log('✔ memory write lock (ML 2 processes × 40 read-modify-writes lose nothing, ML2 reentrant, ML3 no leaked lockfile)');

// ─── IG: the injected INTEGRITY GATE actually refuses a torn image ───────────
// We inject __rufloIntegrityCheck (ADR-023) so a whole-file flush can never land on an
// already-torn memory.db and overwrite the damage as if the store were empty. Asserting the
// STRING is present proves nothing — run the real fragment against crafted SQLite headers.
const igSrc = lib.FRAGMENTS?.integrityGate?.src;
const reqSrc = lib.FRAGMENTS?.req?.src;
if (!igSrc || !reqSrc) fail('IG the integrityGate/req fragment is not exported from patch-library — cannot test the code we inject');

const igMod = path.join(SB, 'ig.mjs');
fs.writeFileSync(igMod, `${reqSrc}\n${igSrc}\nexport { __rufloIntegrityCheck };\n`);
const { __rufloIntegrityCheck } = await import(`file://${igMod}`);

// A SQLite file whose header we control. Consistent by default; pass totalBytes to tear it.
function sqliteFile(pageSize, pageCount, { changeCounter = 1, versionValidFor = 1, totalBytes = null, magic = true } = {}) {
  const size = totalBytes != null ? totalBytes : pageSize * pageCount;
  const buf = Buffer.alloc(Math.max(size, 100));
  if (magic) buf.write('SQLite format 3\0', 'latin1');
  buf.writeUInt16BE(pageSize === 65536 ? 1 : pageSize, 16);
  buf.writeUInt32BE(changeCounter, 24);
  buf.writeUInt32BE(pageCount, 28);
  buf.writeUInt32BE(versionValidFor, 92);
  return buf.subarray(0, size);
}
const allowed = (p) => { try { __rufloIntegrityCheck(p); return true; } catch (e) { if (e && e.__rufloIntegrity) return false; throw e; } };
const dbPath = (name) => { const q = path.join(SB, name); return q; };
const writeDb = (name, buf) => { const q = dbPath(name); fs.writeFileSync(q, buf); return q; };

// IG1 — a consistent image is ALLOWED (no false positive; this is the common case).
if (!allowed(writeDb('ok.db', sqliteFile(4096, 4)))) fail('IG1 a healthy, self-consistent SQLite image was REFUSED — false positive would block every legitimate write');
// IG2 — the header declares 4 pages but the file is half that: a torn/truncated flush. REFUSED.
if (allowed(writeDb('torn.db', sqliteFile(4096, 4, { totalBytes: 8192 })))) fail('IG2 a truncated image (header says 16384 bytes, file is 8192) was ALLOWED — the gate would let a flush overwrite the damage');
// IG3 — a fractional tail (not a whole number of pages) with a non-authoritative header. REFUSED.
if (allowed(writeDb('frac.db', sqliteFile(4096, 0, { changeCounter: 1, versionValidFor: 2, totalBytes: 4097 })))) fail('IG3 a mid-page-truncated image (4097 bytes, page size 4096) was ALLOWED');
// IG4 — no SQLite magic on a non-trivial file: not a database at all. REFUSED.
if (allowed(writeDb('nomagic.db', sqliteFile(4096, 4, { magic: false })))) fail('IG4 a file with no SQLite magic header was ALLOWED');
// IG5 — smaller than a header. REFUSED.
if (allowed(writeDb('tiny.db', Buffer.alloc(50)))) fail('IG5 a 50-byte file (smaller than a SQLite header) was ALLOWED');
// IG6 — a non-.db path is never our concern; ALLOWED (ignored).
if (!allowed(writeDb('notes.json', Buffer.from('not a db')))) fail('IG6 a non-.db path was REFUSED — the gate must only guard *.db');
// IG7 — a missing file is a legitimate FIRST write; ALLOWED.
if (!allowed(dbPath('does-not-exist.db'))) fail('IG7 a missing file (first write) was REFUSED — init could never create the store');
// IG8 — an empty file is init's to fill; ALLOWED.
if (!allowed(writeDb('empty.db', Buffer.alloc(0)))) fail('IG8 an empty (0-byte) file was REFUSED — a fresh store could never be initialised');

console.log('✔ memory integrity gate (IG1 consistent allowed, IG2 truncated refused, IG3 fractional refused, IG4 no-magic refused, IG5 sub-header refused, IG6 non-db ignored, IG7 first-write allowed, IG8 empty allowed)');

// ─── PG: one throwing plugin patcher must not blind the watchdog ─────────────

freshSandbox();
cli(['cwd', 'install']);
cli(['adr-template', 'install']);

// Make a plugin file unreadable so its patcher THROWS...
const pluginSkill = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'ruflo', 'plugins', 'ruflo-adr', 'skills', 'adr-create', 'SKILL.md');
let havePlugin = fs.existsSync(pluginSkill);
if (!havePlugin) {
  // create a minimal one so the patcher discovers it and then chokes on it
  fs.mkdirSync(path.dirname(pluginSkill), { recursive: true });
  fs.writeFileSync(pluginSkill, '   - **Status**: proposed\n');
  cli(['adr-template', 'install']);
  havePlugin = true;
}
fs.chmodSync(pluginSkill, 0o000);

// ...and simultaneously break a CLI anchor, so there is a CLI-side problem found EARLIER in the same tick.
fs.writeFileSync(vendor(DAEMON_AUTOSTART_REL), 'export function unrelated() {}\n');

const tick = spawnSync(process.execPath, [path.join(REPO, 'lib', 'cwd', 'monitor-run.mjs')], { env, encoding: 'utf8' });
fs.chmodSync(pluginSkill, 0o644);

// PG — the tick must not die. The CLI-side problem is found BEFORE the plugin throws, and
// recordProblems() sits AFTER it — so an unguarded throw discarded it. And beat() has already run, so
// the health check would report a perfectly live monitor. One unreadable file blinded the watchdog.
const problems = path.join(STATE, 'problems.json');
if (!fs.existsSync(problems)) {
  fail(`PG a throwing plugin patcher swallowed the CLI-side problems found in the same tick — nothing was recorded:\n${out(tick)}`);
}
const rec = fs.readFileSync(problems, 'utf8');
if (!/skip:|INCOMPLETE|error /.test(rec)) fail(`PG problems.json was written but holds no problem:\n${rec}`);

console.log('✔ plugin guard (PG one throwing patcher does not discard the problems found earlier in the same tick)');

// ─── UB: the uncovered-build detector ────────────────────────────────────────
// It exists because 38 daemons accumulated from a package no entry covered, while `daemon status --all`
// reported health. Mutation `return []` used to pass everything.

freshSandbox();
cli(['cwd', 'install']);

// a DIFFERENT scoped CLI, with a daemon command, that no entry patches
const uncovered = path.join(nm, '@someone-else', 'cli', 'dist', 'src', 'commands', 'daemon.js');
fs.mkdirSync(path.dirname(uncovered), { recursive: true });
fs.writeFileSync(uncovered, 'export function daemonStart() { return process.cwd(); }\n');
fs.writeFileSync(path.join(nm, '@someone-else', 'cli', 'package.json'), JSON.stringify({ name: '@someone-else/cli', version: '1.0.0' }));

const chk = cli(['monitor', 'check']);
if (!/WARN/.test(out(chk))) {
  fail(`UB an UNCOVERED build with its own daemon command was not warned about by \`monitor check\`:\n${out(chk)}`);
}
if (!/someone-else/.test(out(chk))) fail(`UB the warning does not name the uncovered package:\n${out(chk)}`);

const stat = cli(['monitor', 'status']);
if (!/WARN/.test(out(stat))) fail('UB `monitor status` does not surface the uncovered build');

console.log('✔ uncovered builds (UB an unpatched CLI with its own daemon command is named by monitor check + status)');

// ─── DL: daemon/spawn-lock-legacy — the only entry with NO coverage of any kind ──
// It targets @sparkleideas/cli, a legacy fork that exists on no machine here, so there is no real
// fixture to patch: the entry has never been applied, probed, restored, or even parse-checked, and its
// `daemonLock` fragment has never run. An entry nobody can exercise is an entry nobody can trust.
//
// So synthesize the fixture FROM THE SHIPPED ENTRY ITSELF — the anchor is read out of ENTRIES, so the
// fixture can never drift from the thing it is meant to exercise. (Hand-copying the anchor into the test
// would let the two diverge silently, which is the whole failure mode this package is about.)

freshSandbox();

const legacy = lib.ENTRIES.find((e) => e.id === 'daemon/spawn-lock-legacy');
if (!legacy) fail('DL the daemon/spawn-lock-legacy entry has vanished from the table');

const legacyFile = path.join(nm, ...legacy.suffix);
fs.mkdirSync(path.dirname(legacyFile), { recursive: true });

// A minimal legacy build: valid ESM that CONTAINS the exact anchor this entry patches.
const anchor = legacy.edits[0].find;
fs.writeFileSync(legacyFile, `// a legacy @sparkleideas/cli build (pre-#2407/#2484: spawns with NO lock)
export function startDaemon(projectRoot, isDaemonProcess, quiet) {
${anchor}
                    console.log('already running');
                }
                return;
            }
        }
}
`);

// DL1 — it parses BEFORE we touch it. If the fixture is broken, everything below is meaningless.
if (spawnSync(process.execPath, ['--check', legacyFile], { encoding: 'utf8' }).status !== 0) {
  fail('DL1 the synthesized legacy fixture is not valid ESM — the test would prove nothing');
}

const legacyPristine = fs.readFileSync(legacyFile, 'utf8');

// DL2 — installing `daemon` APPLIES the entry to it. It never had before.
cli(['daemon', 'install']);
const patchedLegacy = fs.readFileSync(legacyFile, 'utf8');
if (patchedLegacy === legacyPristine) fail('DL2 daemon/spawn-lock-legacy did NOT apply to a build that matches its anchor');
if (!/__rufloDaemonLock|__ruflo/.test(patchedLegacy)) fail(`DL2 the entry wrote something, but not its lock fragment:\n${patchedLegacy.slice(0, 300)}`);

// DL3 — and the result still PARSES. A patcher that emits broken JS into a daemon is worse than the
// race it fixes.
if (spawnSync(process.execPath, ['--check', legacyFile], { encoding: 'utf8' }).status !== 0) {
  fail('DL3 the patched legacy daemon.js is a SYNTAX ERROR — we would break the fork we meant to fix');
}

// DL4 — uninstall restores it byte-for-byte.
cli(['daemon', 'uninstall']);
if (fs.readFileSync(legacyFile, 'utf8') !== legacyPristine) fail('DL4 uninstall did not restore the legacy file byte-for-byte');
if (fs.existsSync(`${legacyFile}.rsp-backup`)) fail('DL4 uninstall left a backup behind');

console.log('✔ legacy daemon entry (DL1 fixture valid, DL2 applies, DL3 still parses, DL4 restores byte-for-byte)');
