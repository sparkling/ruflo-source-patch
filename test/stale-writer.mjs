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
import { spawn } from 'node:child_process';

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

// A fake @claude-flow/cli install. `patched` decides whether its memory-initializer.js carries the
// write-lock needle. `mtimeAgeSec` back-dates the module (to prove a process that started AFTER the
// patch is NOT flagged). Returns the cli.js a fake worker should run.
function fakeCli(name, { patched, mtimeAgeSec = 0 } = {}) {
  const root = path.join(SB, name, 'node_modules', '@claude-flow', 'cli');
  fs.mkdirSync(path.join(root, 'dist', 'src', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  const mi = path.join(root, 'dist', 'src', 'memory', 'memory-initializer.js');
  fs.writeFileSync(mi, patched
    ? 'export async function storeEntry(){}\nstoreEntry = __rufloGuard(storeEntry, true);\n'
    : 'export async function storeEntry(){}\n// unpatched: no lock\n');
  if (mtimeAgeSec) { const t = new Date(Date.now() - mtimeAgeSec * 1000); fs.utimesSync(mi, t, t); }
  const cliJs = path.join(root, 'bin', 'cli.js');
  fs.writeFileSync(cliJs, 'setInterval(() => {}, 1e9);\n');
  return cliJs;
}
function fakeWorker(cliJs, ...args) {
  const p = spawn(process.execPath, [cliJs, ...args], { stdio: 'ignore', detached: false });
  p.unref(); // a never-exiting child must not keep THIS test's event loop alive
  spawned.push(p);
  return p;
}
const publish = () => new Promise((r) => setTimeout(r, 700)); // let ps see the argv

// ── SW1 + SW6: pre-patch DAEMON *and* pre-patch MCP CLIENT are both killed ────
// Per explicit user directive: kill every pre-patch writer, daemon or MCP client, to force fresh
// code — even though an MCP-client kill is destructive (no auto-reconnect; needs a manual
// /mcp -> Reconnect afterward). The loud warning half of that trade is covered separately by the
// addProblems() feed (monitor-run.mjs), not by this module. Both need a patched copy + a process
// older than the patch, so spawn both and share one wait.
const preDaemonMi = path.join(SB, 'pre-daemon', 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js');
const preMcpMi = path.join(SB, 'pre-mcp', 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js');
const preDaemon = fakeWorker(fakeCli('pre-daemon', { patched: true }), 'daemon', 'start');
const preMcp = fakeWorker(fakeCli('pre-mcp', { patched: true }), 'mcp', 'start');
await new Promise((r) => setTimeout(r, 7000)); // age both past the +5s margin
// Poll: `ps etime` is 1s-resolution and can hiccup under parallel load, so re-touch each patch to
// "now" (process predates it) and check until BOTH are seen, rather than trusting a single shot.
let dHit, mHit;
for (let i = 0; i < 20 && !(dHit && mHit); i++) {
  fs.utimesSync(preDaemonMi, new Date(), new Date());
  fs.utimesSync(preMcpMi, new Date(), new Date());
  const s = staleWriters();
  dHit = s.find((w) => w.pid === preDaemon.pid);
  mHit = s.find((w) => w.pid === preMcp.pid);
  if (!(dHit && mHit)) await new Promise((r) => setTimeout(r, 300));
}
if (!dHit) fail('SW1 a pre-patch daemon was NOT detected');
if (dHit.kind !== 'daemon' || dHit.severity !== 'pre-patch') fail(`SW1 expected daemon/pre-patch, got ${dHit.kind}/${dHit.severity}`);
if (!mHit) fail('SW6 a pre-patch MCP client was NOT detected');
if (mHit.kind !== 'mcp' || mHit.severity !== 'pre-patch') fail(`SW6 expected mcp/pre-patch, got ${mHit.kind}/${mHit.severity}`);

// SW1a — dry-run reports but kills nothing.
recoverStaleWriters({ dryRun: true });
if (!alive(preDaemon.pid)) fail('SW1a dry-run KILLED the daemon — a dry run must change nothing');
// SW1b — the kill switch reports but kills nothing.
process.env.RSP_NO_STALE_WRITER_KILL = '1';
recoverStaleWriters();
if (!alive(preDaemon.pid)) fail('SW1b RSP_NO_STALE_WRITER_KILL did not prevent the kill');
delete process.env.RSP_NO_STALE_WRITER_KILL;
// SW1c + SW6 — one real recovery: BOTH the daemon and the MCP client are killed.
const rec = recoverStaleWriters();
if (!rec.killed.some((w) => w.pid === preDaemon.pid)) fail('SW1c recovery did not restart the pre-patch daemon');
if (!rec.killed.some((w) => w.pid === preMcp.pid)) fail('SW6 recovery did not kill the pre-patch MCP client — per directive it must, to force fresh code');
await new Promise((r) => setTimeout(r, 400));
if (alive(preDaemon.pid)) fail('SW1c the pre-patch daemon survived recovery — it should respawn patched');
if (alive(preMcp.pid)) fail('SW6 the pre-patch MCP client survived recovery — it should have been killed');

// ── SW7: an UNPATCHED writer (even a daemon) is detected but NEVER auto-killed ─
// The copy has no lock because the patch could not apply; a respawn reads the same unpatched copy
// and LOOPS. That is drift, fixed by re-anchoring, not by killing the process.
const unpDaemon = fakeWorker(fakeCli('unpatched-daemon', { patched: false }), 'daemon', 'start');
await publish();
let hit = staleWriters().find((w) => w.pid === unpDaemon.pid);
if (!hit) fail('SW7 an unpatched daemon was NOT detected');
if (hit.severity !== 'unpatched') fail(`SW7 expected severity 'unpatched', got '${hit.severity}'`);
recoverStaleWriters();
if (!alive(unpDaemon.pid)) fail('SW7 recovery KILLED an unpatched writer — a respawn would loop unpatched; must never be auto-killed');

// ── SW2: a PATCHED writer that started AFTER its patch is NEVER flagged ───────
// Back-date the module an hour; the worker is seconds old, so it loaded the patched code.
const healthy = fakeWorker(fakeCli('healthy', { patched: true, mtimeAgeSec: 3600 }), 'daemon', 'start');
await publish();
if (!alive(healthy.pid)) fail('fixture: the healthy fake writer died before the test began');
if (staleWriters().some((w) => w.pid === healthy.pid)) fail('SW2 a patched writer that started after its patch was flagged STALE — a false positive would restart healthy daemons every tick');
recoverStaleWriters();
if (!alive(healthy.pid)) fail('SW2 recovery KILLED a healthy patched writer — the false-positive kill this guard must never do');

// ── SW3: an unresolvable argv (npm-exec wrapper) is never touched ────────────
fs.writeFileSync(path.join(SB, 'wrap.js'), 'setInterval(() => {}, 1e9);\n');
const wrapper = fakeWorker(path.join(SB, 'wrap.js'), 'mcp'); // path has no @claude-flow/cli root
await publish();
if (staleWriters().some((w) => w.pid === wrapper.pid)) fail('SW3 a process whose argv does not resolve to an @claude-flow/cli install was flagged — never touch what we cannot positively identify');

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
hit = staleWriters().find((w) => w.pid === symServer.pid);
if (!hit) fail('SW5 a plugin MCP server launched via the .bin/cli SYMLINK was NOT detected — the blind spot that reported zero stale on a box running five');
if (hit.kind !== 'server') fail(`SW5 the default (no-subcommand) stdio server must be kind 'server', got '${hit.kind}'`);
recoverStaleWriters();
if (!alive(symServer.pid)) fail('SW5 recovery KILLED a .bin/cli MCP client — MCP clients are never auto-killed');

// ── SW4: the whole guard is inert unless the `memory` target is installed ─────
const idle = fakeWorker(fakeCli('idle-unpatched', { patched: false }), 'daemon', 'start');
await publish();
setMemoryInstalled(false);
if (staleWriters().length) fail('SW4 stale writers were reported with the memory target NOT installed — with no lock to protect, an unpatched copy is not a fault');
if (!alive(idle.pid)) fail('SW4 a writer was killed with memory uninstalled');
setMemoryInstalled(true);

// ── SW8: addProblems() MERGES a loud MCP-kill warning, it does not clobber ────
// monitor-run.mjs feeds the "we killed your MCP client" warning through addProblems() specifically
// because a plain recordProblems() call would REPLACE whatever runOnce() already recorded that same
// tick (e.g. a genuine anchor-drift problem) — losing it. Prove the merge, not just that a message
// lands: seed an unrelated problem first, add the MCP-kill lines, and confirm BOTH survive.
const { recordProblems, addProblems } = await import('../lib/cwd/problems.mjs');
const { PROBLEMS_PATH } = await import('../lib/cwd/paths.mjs');
recordProblems(['pre-existing: something runOnce found this tick']);
addProblems(['!! ruflo-source-patch KILLED 1 stale MCP client(s) to force fresh code: pid 99999']);
const stored = JSON.parse(fs.readFileSync(PROBLEMS_PATH, 'utf8')).problems;
if (!stored.some((p) => p.startsWith('pre-existing:'))) fail('SW8 addProblems CLOBBERED the pre-existing problem runOnce had already recorded this tick');
if (!stored.some((p) => p.includes('KILLED 1 stale MCP client'))) fail('SW8 addProblems did not record the MCP-kill warning at all');
// Calling it again with the SAME lines must not duplicate them (de-dupe via Set).
addProblems(['!! ruflo-source-patch KILLED 1 stale MCP client(s) to force fresh code: pid 99999']);
const stored2 = JSON.parse(fs.readFileSync(PROBLEMS_PATH, 'utf8')).problems;
if (stored2.filter((p) => p.includes('KILLED 1 stale MCP client')).length !== 1) fail('SW8 addProblems duplicated an already-recorded line instead of de-duping');

console.log('✔ stale-writer guard (SW1 pre-patch daemon+MCP client both killed, SW1a/b dry-run+kill-switch inert, SW7 unpatched NOT killed, SW2 patched-after-patch untouched, SW3 unresolvable untouched, SW5 .bin/cli unpatched not-killed, SW4 inert unless memory installed, SW8 addProblems merges not clobbers)');

for (const p of spawned) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
process.exit(0);
