// cleanup's PROCESS half — the only code in this package that signals processes.
//
// The directory half is covered (untested.mjs CL1-CL4). This is the other one, and it is the dangerous
// one: `isInside()` is the guard that stops us SIGTERM-ing a daemon belonging to a DIFFERENT project,
// and it had never been exercised.
//
// Real processes, real pgrep/lsof/ps. Fakes whose argv contains "daemon start" (what daemonPids() greps
// for) and whose cwd we control (what pidCwd() reads). Anything less would be testing a mock of the
// thing rather than the thing.
//
// Safety: cleanup only kills pids whose cwd resolves INSIDE the target root, and every fake here lives
// under a temp dir. A real ruflo daemon on this machine has its cwd elsewhere and is therefore excluded
// by the very guard under test — which is itself part of the point.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { REPO } from './fixtures.mjs';

const SB = process.argv[2];
const fail = (m) => { console.log(`\n✘ ${m}`); process.exit(1); };
const out = (r) => `${r.stdout || ''}${r.stderr || ''}`;

// A process that LOOKS like a ruflo daemon to pgrep -f 'daemon start', and sits in a chosen cwd.
const FAKE = path.join(SB, 'fake-daemon.mjs');
fs.mkdirSync(SB, { recursive: true });
fs.writeFileSync(FAKE, 'setTimeout(() => {}, 60_000);\n');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const spawned = [];
function fakeDaemon(cwd) {
  fs.mkdirSync(cwd, { recursive: true });
  // argv must contain "daemon start" — that is what daemonPids() greps for.
  const p = spawn(process.execPath, [FAKE, 'daemon', 'start'], { cwd, stdio: 'ignore', detached: false });
  spawned.push(p);
  return p;
}
const killAll = () => { for (const p of spawned) { try { p.kill('SIGKILL'); } catch { /* gone */ } } };
process.on('exit', killAll);

const cleanup = (dir, ...flags) =>
  spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), 'cleanup', dir, ...flags], { encoding: 'utf8' });

// ── two SIBLING projects. Cleaning one must never touch the other. ───────────
const A = path.join(SB, 'proj-a');
const B = path.join(SB, 'proj-b');
for (const d of [A, B]) { fs.mkdirSync(d, { recursive: true }); execFileSync('git', ['init', '-q'], { cwd: d }); }

const aRoot = fakeDaemon(A);                       // A's own daemon, at the root — should be KEPT
const aStray = fakeDaemon(path.join(A, 'sub'));    // anchored to a subdirectory — the bug we fix
const bRoot = fakeDaemon(B);                       // ANOTHER PROJECT'S daemon — must SURVIVE

// give the OS a moment to publish cwd/cmdline so pgrep/lsof can see them
await new Promise((r) => setTimeout(r, 900));

for (const [name, p] of [['A root', aRoot], ['A stray', aStray], ['B root', bRoot]]) {
  if (!alive(p.pid)) fail(`fixture: the ${name} fake daemon died before the test began — nothing below would mean anything`);
}

// ── K1: --dry-run kills NOTHING ──────────────────────────────────────────────
const dry = cleanup(A, '--dry-run');
// SIGTERM is asynchronous — checking liveness immediately would pass even if the process HAD been
// signalled, and the assertion would be vacuous. (Mutation-testing caught exactly that: a --dry-run
// that really killed slipped through until this wait was added.) Give the signal time to land.
await new Promise((r) => setTimeout(r, 600));
if (!alive(aStray.pid)) fail('K1 --dry-run KILLED a process');
if (!/would kill/.test(out(dry))) fail(`K1 --dry-run did not say what it would kill:\n${out(dry)}`);

// ── K2/K3: the real run kills the STRAY, keeps A's root daemon, and NEVER touches B ──
const run = cleanup(A);
await new Promise((r) => setTimeout(r, 500));

if (alive(aStray.pid)) fail(`K2 the subdirectory-anchored daemon SURVIVED cleanup:\n${out(run)}`);

// K3 — THE CONTAINMENT GUARD. This is the assertion that matters: another project's daemon is not ours
// to kill, and isInside() is the only thing standing between us and doing it.
if (!alive(bRoot.pid)) fail('K3 cleanup KILLED A DIFFERENT PROJECT\'S DAEMON — isInside() containment is broken');

// and A's own root daemon is kept (the keep-oldest rule keeps exactly one)
if (!alive(aRoot.pid)) fail(`K3 cleanup killed the project's OWN root daemon — it should keep one:\n${out(run)}`);
if (run.status !== 0) fail(`K3 a successful cleanup exited nonzero:\n${out(run)}`);

// ── K4: --all-daemons takes the root one too — and STILL not B's ─────────────
const all = cleanup(A, '--all-daemons');
await new Promise((r) => setTimeout(r, 500));
if (alive(aRoot.pid)) fail(`K4 --all-daemons did not kill the project's root daemon:\n${out(all)}`);
if (!alive(bRoot.pid)) fail('K4 --all-daemons reached into ANOTHER PROJECT and killed its daemon');

// ── K5: nothing to do is reported honestly, and exits 0 ──────────────────────
const none = cleanup(A);
if (none.status !== 0) fail(`K5 a no-op cleanup exited nonzero:\n${out(none)}`);
if (!/nothing to clean/.test(out(none))) fail(`K5 a no-op cleanup did not say so:\n${out(none)}`);

killAll();
console.log('✔ cleanup processes (K1 --dry-run kills nothing, K2 strays killed, K3 ANOTHER PROJECT\'S daemon survives, K4 --all-daemons still respects the boundary, K5 no-op is honest)');
