// The STALE-WRITER guard (ADR-023) — the second half of the "never corrupt memory.db again" fix.
//
// The in-file write lock + integrity gate protect only a process that LOADED the patch. A ruflo
// MCP server / daemon still running pre-patch or unpatched memory code keeps flushing the old
// unguarded way — the exact stale image that tore semantic-product-mock. This module detects
// such a writer and, on the monitor tick, SIGTERMs it so it reloads patched.
//
// Real processes, real ps. Fakes whose argv resolves to a controlled @claude-flow/cli root whose
// memory-initializer.js we mark patched or unpatched at will. Like cleanup-procs.mjs, the danger
// here is a WRONG kill, so the negative cases (healthy writer, unresolvable argv, memory target
// not installed) matter as much as the positive one.
//
// Isolation: RUFLO_SOURCE_PATCH_HOME points state.json at the sandbox, so the test's verdict does
// not depend on whether THIS machine happens to have the memory target installed. It is set before
// the first import of the module (which transitively loads paths.mjs, which reads the env once).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const SB = process.argv[2];
const fail = (m) => { console.log(`\n✘ ${m}`); process.exit(1); };

const HOME = path.join(SB, 'home');
const STATE_DIR = path.join(HOME, '.ruflo-source-patch');
fs.mkdirSync(STATE_DIR, { recursive: true });
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
delete process.env.RSP_NO_STALE_WRITER_KILL;
const setMemoryInstalled = (on) =>
  fs.writeFileSync(path.join(STATE_DIR, 'state.json'),
    JSON.stringify({ patchTargets: on ? ['memory'] : [], pluginTargets: [], retired: {}, all: false }));
setMemoryInstalled(true);

const { staleWriters, recoverStaleWriters } = await import('../lib/cwd/stale-writer.mjs');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const spawned = [];
process.on('exit', () => { for (const p of spawned) { try { p.kill('SIGKILL'); } catch { /* gone */ } } });
// The production detector is intentionally machine-wide. This live-process test must constrain
// every detect/kill to its own children so running it can never terminate a user's real MCP client.
const fixturePids = () => spawned.map((p) => p.pid);
const detect = (opts = {}) => staleWriters({ ...opts, pids: fixturePids() });
const recover = (opts = {}) => recoverStaleWriters({ ...opts, pids: fixturePids() });
const fixturePs = () => {
  try {
    const wanted = new Set(fixturePids());
    return execFileSync('ps', ['-Awwo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n')
      .filter((line) => wanted.has(Number(/^\s*(\d+)/.exec(line)?.[1])));
  } catch (error) { return [`ps failed: ${error.message}`]; }
};

// A fake @claude-flow/cli install. `patched` means the current fail-closed lock; `legacy` means the
// older wrapper that silently proceeded unlocked on acquisition failure. `mtimeAgeSec` back-dates
// the module (to prove a process that started AFTER the patch is NOT flagged).
function fakeCli(name, { patched, legacy = false, mtimeAgeSec = 0 } = {}) {
  const root = path.join(SB, name, 'node_modules', '@claude-flow', 'cli');
  fs.mkdirSync(path.join(root, 'dist', 'src', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  const mi = path.join(root, 'dist', 'src', 'memory', 'memory-initializer.js');
  const current = "e.code = 'RSP_MEMORY_LOCK_UNAVAILABLE';\n"
    + 'const __rufloLockScope = new __rufloAsyncLocalStorage();\n'
    + 'export async function storeEntry(){}\nstoreEntry = __rufloGuard(storeEntry);\n';
  const old = 'export async function storeEntry(){}\nstoreEntry = __rufloGuard(storeEntry, true);\n';
  fs.writeFileSync(mi, patched ? current : legacy ? old : 'export async function storeEntry(){}\n// unpatched: no lock\n');
  if (mtimeAgeSec) { const t = new Date(Date.now() - mtimeAgeSec * 1000); fs.utimesSync(mi, t, t); }
  const cliJs = path.join(root, 'bin', 'cli.js');
  fs.writeFileSync(cliJs, 'setInterval(() => {}, 1e9);\n');
  return cliJs;
}
function fakeRuflo(name, { patched, packageName = 'ruflo' } = {}) {
  const install = path.join(SB, name);
  const wrapperRoot = path.join(install, 'node_modules', 'ruflo');
  const cliRoot = path.join(install, 'node_modules', '@claude-flow', 'cli');
  const mi = path.join(cliRoot, 'dist', 'src', 'memory', 'memory-initializer.js');
  fs.mkdirSync(path.join(wrapperRoot, 'bin'), { recursive: true });
  fs.mkdirSync(path.dirname(mi), { recursive: true });
  fs.mkdirSync(path.join(cliRoot, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(wrapperRoot, 'package.json'), JSON.stringify({ name: packageName }));
  fs.writeFileSync(path.join(cliRoot, 'package.json'), JSON.stringify({ name: '@claude-flow/cli' }));
  fs.writeFileSync(mi, patched
    ? "e.code = 'RSP_MEMORY_LOCK_UNAVAILABLE';\nconst __rufloLockScope = new __rufloAsyncLocalStorage();\nexport async function storeEntry(){}\nstoreEntry = __rufloGuard(storeEntry);\n"
    : '// unpatched: no lock\n');
  const wrapper = path.join(wrapperRoot, 'bin', 'ruflo.js');
  fs.writeFileSync(wrapper, 'setInterval(() => {}, 1e9);\n');
  const binDir = path.join(install, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const entry = path.join(binDir, 'ruflo');
  fs.symlinkSync(wrapper, entry);
  return { entry, mi };
}
function fakeWorker(cliJs, ...args) {
  const p = spawn(process.execPath, [cliJs, ...args], { stdio: 'ignore', detached: false });
  p.unref(); // a never-exiting child must not keep THIS test's event loop alive
  spawned.push(p);
  return p;
}
const publish = () => new Promise((r) => setTimeout(r, 700)); // let ps see the argv

// ── SW1 + SW6: pre-patch daemon is restarted; MCP clients are detected but spared ──
// A daemon can respawn patched. A detached monitor cannot reconnect a host's stdio MCP transport,
// so killing that child creates a durable `Transport closed` outage. Both still need detection.
const preDaemonMi = path.join(SB, 'pre-daemon', 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js');
const preMcpMi = path.join(SB, 'pre-mcp', 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js');
const preRuflo = fakeRuflo('pre-ruflo', { patched: true });
const preDaemon = fakeWorker(fakeCli('pre-daemon', { patched: true }), 'daemon', 'start');
const preMcp = fakeWorker(fakeCli('pre-mcp', { patched: true }), 'mcp', 'start');
const preRufloMcp = fakeWorker(preRuflo.entry, 'mcp', 'start');
await new Promise((r) => setTimeout(r, 8000)); // age all three past the +5s margin
// Poll: `ps etime` is 1s-resolution and can hiccup under parallel load, so re-touch each patch to
// "now" (process predates it) and check until all three launch shapes are seen.
let dHit, mHit, rHit;
for (let i = 0; i < 60 && !(dHit && mHit && rHit); i++) {
  // One second in the past avoids a filesystem timestamp rounding into the detector's future;
  // the process is already >=8s old, so it remains safely beyond the +5s production margin.
  const patchedAt = new Date(Date.now() - 1000);
  fs.utimesSync(preDaemonMi, patchedAt, patchedAt);
  fs.utimesSync(preMcpMi, patchedAt, patchedAt);
  fs.utimesSync(preRuflo.mi, patchedAt, patchedAt);
  const s = detect();
  dHit = s.find((w) => w.pid === preDaemon.pid);
  mHit = s.find((w) => w.pid === preMcp.pid);
  rHit = s.find((w) => w.pid === preRufloMcp.pid);
  if (!(dHit && mHit && rHit)) await new Promise((r) => setTimeout(r, 500));
}
if (!dHit) fail(`SW1 a pre-patch daemon was NOT detected (alive=${alive(preDaemon.pid)}, pid=${preDaemon.pid}, seen=${JSON.stringify(detect())}, ps=${JSON.stringify(fixturePs())})`);
if (dHit.kind !== 'daemon' || dHit.severity !== 'pre-patch') fail(`SW1 expected daemon/pre-patch, got ${dHit.kind}/${dHit.severity}`);
if (!mHit) fail(`SW6 a pre-patch MCP client was NOT detected (alive=${alive(preMcp.pid)}, pid=${preMcp.pid}, seen=${JSON.stringify(detect())})`);
if (mHit.kind !== 'mcp' || mHit.severity !== 'pre-patch') fail(`SW6 expected mcp/pre-patch, got ${mHit.kind}/${mHit.severity}`);
if (!rHit) fail(`SW10 a pre-patch MCP client launched through .bin/ruflo was NOT detected (alive=${alive(preRufloMcp.pid)}, pid=${preRufloMcp.pid}, seen=${JSON.stringify(detect())})`);
if (rHit.kind !== 'mcp' || rHit.severity !== 'pre-patch') fail(`SW10 expected mcp/pre-patch, got ${rHit.kind}/${rHit.severity}`);

// SW1a — dry-run reports but kills nothing.
recover({ dryRun: true });
if (!alive(preDaemon.pid)) fail('SW1a dry-run KILLED the daemon — a dry run must change nothing');
// SW1b — the kill switch reports but kills nothing.
process.env.RSP_NO_STALE_WRITER_KILL = '1';
recover();
if (!alive(preDaemon.pid)) fail('SW1b RSP_NO_STALE_WRITER_KILL did not prevent the kill');
delete process.env.RSP_NO_STALE_WRITER_KILL;
// SW1c + SW6 — one real recovery: daemon dies; both MCP launch shapes remain alive.
const rec = recover();
if (!rec.killed.some((w) => w.pid === preDaemon.pid)) fail('SW1c recovery did not restart the pre-patch daemon');
if (rec.killed.some((w) => w.pid === preMcp.pid || w.pid === preRufloMcp.pid)) fail('SW6/SW10 recovery killed an MCP client that the detached monitor cannot reconnect');
await new Promise((r) => setTimeout(r, 400));
if (alive(preDaemon.pid)) fail('SW1c the pre-patch daemon survived recovery — it should respawn patched');
if (!alive(preMcp.pid)) fail('SW6 the pre-patch MCP client was killed — host transport cannot self-reconnect');
if (!alive(preRufloMcp.pid)) fail('SW10 the .bin/ruflo MCP client was killed — host transport cannot self-reconnect');

// ── SW7: an UNPATCHED writer (even a daemon) is detected but NEVER auto-killed ─
// The copy has no lock because the patch could not apply; a respawn reads the same unpatched copy
// and LOOPS. That is drift, fixed by re-anchoring, not by killing the process.
const unpDaemon = fakeWorker(fakeCli('unpatched-daemon', { patched: false }), 'daemon', 'start');
await publish();
let hit = detect().find((w) => w.pid === unpDaemon.pid);
if (!hit) fail('SW7 an unpatched daemon was NOT detected');
if (hit.severity !== 'unpatched') fail(`SW7 expected severity 'unpatched', got '${hit.severity}'`);
recover();
if (!alive(unpDaemon.pid)) fail('SW7 recovery KILLED an unpatched writer — a respawn would loop unpatched; must never be auto-killed');

// ── SW9: the older fail-open wrapper is NOT accepted as the current lock ─────
const legacyDaemon = fakeWorker(fakeCli('legacy-daemon', { legacy: true }), 'daemon', 'start');
await publish();
hit = detect().find((w) => w.pid === legacyDaemon.pid);
if (!hit || hit.severity !== 'unpatched') {
  fail('SW9 the legacy fail-open __rufloGuard wrapper was accepted as the current fail-closed patch');
}
recover();
if (!alive(legacyDaemon.pid)) fail('SW9 recovery killed a legacy on-disk copy that a respawn cannot repair');

// ── SW2: a PATCHED writer that started AFTER its patch is NEVER flagged ───────
// Back-date the module an hour; the worker is seconds old, so it loaded the patched code.
const healthy = fakeWorker(fakeCli('healthy', { patched: true, mtimeAgeSec: 3600 }), 'daemon', 'start');
await publish();
if (!alive(healthy.pid)) fail('fixture: the healthy fake writer died before the test began');
if (detect().some((w) => w.pid === healthy.pid)) fail('SW2 a patched writer that started after its patch was flagged STALE — a false positive would restart healthy daemons every tick');
recover();
if (!alive(healthy.pid)) fail('SW2 recovery KILLED a healthy patched writer — the false-positive kill this guard must never do');

// ── SW3: an unresolvable argv (npm-exec wrapper) is never touched ────────────
fs.writeFileSync(path.join(SB, 'wrap.js'), 'setInterval(() => {}, 1e9);\n');
const wrapper = fakeWorker(path.join(SB, 'wrap.js'), 'mcp'); // path has no @claude-flow/cli root
await publish();
if (detect().some((w) => w.pid === wrapper.pid)) fail('SW3 a process whose argv does not resolve to an @claude-flow/cli install was flagged — never touch what we cannot positively identify');

// SW11: a same-named wrapper without the official package identity is never trusted.
const impostor = fakeRuflo('impostor-ruflo', { patched: true, packageName: 'not-ruflo' });
const impostorMcp = fakeWorker(impostor.entry, 'mcp', 'start');
await publish();
if (detect().some((w) => w.pid === impostorMcp.pid)) fail('SW11 an unverified .bin/ruflo executable was treated as an official writer');

// ── SW5: the plugin MCP server's `.bin/cli` symlink is RESOLVED (unpatched copy: not killed) ─
// The blind spot that let a live box report zero stale while five were running: `npm exec
// @claude-flow/cli` launches `node .../node_modules/.bin/cli` with NO @claude-flow/cli in the argv
// and NO subcommand. cliRootOf must follow the symlink; roleOf reads the empty subcommand as the
// default stdio 'server' (an MCP client). This fixture's copy is UNPATCHED, so — unlike SW6's
// pre-patch MCP client above — it must still be spared: a kill+respawn would just reload the same
// broken code.
const symRoot = path.join(SB, 'sym', 'node_modules', '@claude-flow', 'cli');
fs.mkdirSync(path.join(symRoot, 'dist', 'src', 'memory'), { recursive: true });
fs.mkdirSync(path.join(symRoot, 'bin'), { recursive: true });
fs.writeFileSync(path.join(symRoot, 'dist', 'src', 'memory', 'memory-initializer.js'), '// unpatched: no lock\n');
fs.writeFileSync(path.join(symRoot, 'bin', 'cli.js'), 'setInterval(() => {}, 1e9);\n');
const binDir = path.join(SB, 'sym', 'node_modules', '.bin');
fs.mkdirSync(binDir, { recursive: true });
fs.symlinkSync(path.join(symRoot, 'bin', 'cli.js'), path.join(binDir, 'cli'));
const symServer = fakeWorker(path.join(binDir, 'cli')); // NO subcommand: the default stdio MCP client
await publish();
if (!alive(symServer.pid)) fail('fixture: the .bin/cli symlink server died before the test began');
hit = detect().find((w) => w.pid === symServer.pid);
if (!hit) fail('SW5 a plugin MCP server launched via the .bin/cli SYMLINK was NOT detected — the blind spot that reported zero stale on a box running five');
if (hit.kind !== 'server') fail(`SW5 the default (no-subcommand) stdio server must be kind 'server', got '${hit.kind}'`);
recover();
if (!alive(symServer.pid)) fail('SW5 recovery KILLED a .bin/cli MCP client — MCP clients are never auto-killed');

// ── SW4: the whole guard is inert unless the `memory` target is installed ─────
const idle = fakeWorker(fakeCli('idle-unpatched', { patched: false }), 'daemon', 'start');
await publish();
setMemoryInstalled(false);
if (detect().length) fail('SW4 stale writers were reported with the memory target NOT installed — with no lock to protect, an unpatched copy is not a fault');
if (!alive(idle.pid)) fail('SW4 a writer was killed with memory uninstalled');
setMemoryInstalled(true);

// ── SW8: addProblems() MERGES a deferred-reconnect warning, it does not clobber ────
// monitor-run.mjs feeds the "MCP needs reconnect" warning through addProblems() specifically
// because a plain recordProblems() call would REPLACE whatever runOnce() already recorded that same
// tick (e.g. a genuine anchor-drift problem) — losing it. Prove the merge, not just that a message
// lands: seed an unrelated problem first, add the MCP-reconnect lines, and confirm BOTH survive.
const { recordProblems, addProblems } = await import('../lib/cwd/problems.mjs');
const { PROBLEMS_PATH } = await import('../lib/cwd/paths.mjs');
recordProblems(['pre-existing: something runOnce found this tick']);
addProblems(['ruflo-source-patch deferred 1 stale MCP client(s): pid 99999']);
const stored = JSON.parse(fs.readFileSync(PROBLEMS_PATH, 'utf8')).problems;
if (!stored.some((p) => p.startsWith('pre-existing:'))) fail('SW8 addProblems CLOBBERED the pre-existing problem runOnce had already recorded this tick');
if (!stored.some((p) => p.includes('deferred 1 stale MCP client'))) fail('SW8 addProblems did not record the deferred MCP warning at all');
// Calling it again with the SAME lines must not duplicate them (de-dupe via Set).
addProblems(['ruflo-source-patch deferred 1 stale MCP client(s): pid 99999']);
const stored2 = JSON.parse(fs.readFileSync(PROBLEMS_PATH, 'utf8')).problems;
if (stored2.filter((p) => p.includes('deferred 1 stale MCP client')).length !== 1) fail('SW8 addProblems duplicated an already-recorded line instead of de-duping');

console.log('✔ stale-writer guard (SW1 daemon recovery; SW6/SW10 pre-patch MCP detection without killing; SW1a/b dry-run+kill-switch inert; SW7/SW9 unpatched not killed; SW2 healthy untouched; SW3/SW11 unresolvable or unverified untouched; SW5 .bin/cli not killed; SW4 inert unless memory installed; SW8 warnings merge)');

for (const p of spawned) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
process.exit(0);
