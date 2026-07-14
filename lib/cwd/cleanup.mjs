// Target: cleanup — remove a project's daemon + folder sprawl.
//
//   ruflo-source-patch cleanup [dir]            clean the project at [dir] (default: cwd)
//   ruflo-source-patch cleanup [dir] --dry-run  show what it WOULD do, change nothing
//   ruflo-source-patch cleanup [dir] --all-daemons  also kill the one root daemon
//
// What it does, scoped STRICTLY to the given project root (nearest ancestor .git):
//   - stray state dirs: removes any `.claude-flow` / `.swarm` in a SUBDIRECTORY. The
//     root's own are kept — they're the project's real state.
//   - daemons: keeps ONE daemon anchored at the exact project root (the legit one),
//     kills every other daemon whose cwd is inside the project tree — subdirectory-
//     anchored strays (the cwd-drift bug) and root duplicates. `--all-daemons` kills
//     the root one too (it respawns on next use).
//
// HARD SAFETY: a process is only ever killed if its resolved cwd is the project root
// or a path beneath it. A daemon belonging to any other project is never touched — the
// scoping bug that let an earlier ad-hoc cleanup nearly kill unrelated sessions.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function resolveRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir || process.cwd());
}

// Fully resolve a path — SYMLINKS INCLUDED. path.resolve() does not follow them, and that is not a
// pedantic distinction here: on macOS /var and /tmp are symlinks to /private/var and /private/tmp, and
// `lsof` (which is how we read a pid's cwd) always reports the RESOLVED path.
//
// So a project under /var/... yields root=/var/x while its daemon's cwd reads back as /private/var/x.
// The containment check then matches NOTHING, cleanup finds zero daemons, and reports "nothing to clean"
// — on a project full of them. Silently doing nothing while announcing success is the failure this whole
// package exists to hunt, and it was sitting in our own cleanup.
//
// Falls back to path.resolve() when the path no longer exists (a dead pid's cwd), which is the safe
// direction: an unresolvable cwd fails containment and the pid is NOT killed.
function realpath(p) {
  try { return fs.realpathSync(path.resolve(p)); } catch { return path.resolve(p); }
}

// A path is "inside" root if it IS root or sits beneath it — with a separator guard so
// /a/project never matches /a/project-other.
function isInside(root, p) {
  if (!p) return false;
  const r = realpath(root);
  const c = realpath(p);
  return c === r || c.startsWith(r + path.sep);
}

// cwd of a pid: /proc on Linux, lsof on macOS. Null if it can't be determined (then the
// pid is NOT killed — unknown cwd fails the containment check).
function pidCwd(pid) {
  try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { /* not linux */ }
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.startsWith('n'));
    return line ? line.slice(1) : null;
  } catch { return null; }
}

function pidAge(pid) {
  try { return execFileSync('ps', ['-o', 'etime=', '-p', String(pid)], { encoding: 'utf8' }).trim(); }
  catch { return '?'; }
}

// pidAge() is a HUMAN string — `ps` etime, formatted [[dd-]hh:]mm:ss. This is the same thing as
// a number, so "which is oldest" can actually be answered.
//
// It has to be, because the keep-one rule sorted by PID ascending while its comment claimed to
// keep the OLDEST. Those agree only until the kernel's pid counter wraps — after which the
// oldest daemon has the HIGHEST pid, and the rule silently keeps the newest and kills the
// established one. Sorting by a value that merely correlates with the thing you mean is how a
// comment and its code end up describing different programs.
//
// Unparseable => -1, which sorts LAST: a daemon whose age we cannot establish is never the one
// we choose to keep.
function pidAgeSeconds(pid) {
  const raw = pidAge(pid);
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(raw);
  if (!m) return -1;
  const [, d, h, mm, ss] = m;
  return ((Number(d || 0) * 24 + Number(h || 0)) * 60 + Number(mm)) * 60 + Number(ss);
}

function daemonPids() {
  try {
    return execFileSync('pgrep', ['-f', 'daemon start'], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean).map(Number);
  } catch { return []; } // pgrep exits 1 when there are no matches
}

// Stray `.claude-flow` / `.swarm` in subdirectories of root (not root's own, not inside
// node_modules or .git). Bounded walk — never leaves the project tree.
function strayStateDirs(root) {
  const out = [];
  const SKIP = new Set(['node_modules', '.git']);
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if ((e.name === '.claude-flow' || e.name === '.swarm') && full !== path.join(root, e.name)) {
        out.push(full);
        continue; // don't descend into a dir we're removing
      }
      walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** Compute what cleanup WOULD do. Pure — no side effects. */
export function planCleanup(startDir, { allDaemons = false } = {}) {
  const root = resolveRoot(startDir);
  const guard = root === path.parse(root).root || root === (process.env.HOME || process.env.USERPROFILE);
  if (guard) return { root, refused: `refusing to clean up ${root} — too broad (not a project root)` };

  const inTree = daemonPids()
    .map((pid) => ({ pid, cwd: pidCwd(pid) }))
    .filter((d) => isInside(root, d.cwd))
    .map((d) => ({
      ...d, age: pidAge(d.pid), ageSec: pidAgeSeconds(d.pid), atRoot: realpath(d.cwd) === realpath(root),
    }));

  const rootDaemons = inTree.filter((d) => d.atRoot);
  const strayDaemons = inTree.filter((d) => !d.atRoot);

  // Keep the OLDEST root daemon (most established); everything else is a duplicate. Sorted by
  // actual elapsed time — see pidAgeSeconds(). This used to sort by pid, which is age only until
  // the pid counter wraps.
  const keep = allDaemons
    ? null
    : rootDaemons.slice().sort((a, b) => b.ageSec - a.ageSec)[0] || null;
  const kill = inTree.filter((d) => d !== keep);

  return { root, refused: null, keep, kill, strayDaemons, rootDaemons, dirs: strayStateDirs(root) };
}

export function runCleanup(startDir, { dryRun = false, allDaemons = false } = {}) {
  const plan = planCleanup(startDir, { allDaemons });
  const log = [];
  if (plan.refused) return { ...plan, log: [plan.refused] };

  log.push(`project root: ${plan.root}`);
  if (plan.keep) log.push(`keeping daemon pid=${plan.keep.pid} (root, age ${plan.keep.age})`);

  // Count what we FAILED to do. A cleanup whose every kill and every removal failed used to log
  // its failures line by line and then exit 0 — so the caller (and `make`) saw a clean run over
  // a project still carrying every daemon and every stray state dir it started with.
  let failures = 0;

  for (const d of plan.kill) {
    const why = !d.atRoot ? 'stray (subdir-anchored)' : plan.keep ? 'root duplicate' : 'root (--all-daemons)';
    if (dryRun) { log.push(`would kill pid=${d.pid} — ${why} — ${d.cwd}`); continue; }
    try { process.kill(d.pid, 'SIGTERM'); log.push(`killed pid=${d.pid} — ${why}`); }
    catch (e) { failures++; log.push(`could not kill pid=${d.pid}: ${e.message}`); }
  }

  for (const dir of plan.dirs) {
    if (dryRun) { log.push(`would remove ${dir}`); continue; }
    try { fs.rmSync(dir, { recursive: true, force: true }); log.push(`removed ${dir}`); }
    catch (e) { failures++; log.push(`could not remove ${dir}: ${e.message}`); }
  }

  if (!plan.kill.length && !plan.dirs.length) log.push('nothing to clean — no stray daemons or subdir state dirs');
  if (failures) log.push(`INCOMPLETE — ${failures} action(s) failed; the project is NOT clean`);
  return { ...plan, dryRun, failures, log };
}
