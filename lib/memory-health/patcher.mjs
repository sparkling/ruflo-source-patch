// Patches the installed `ruvnet-brain` plugin's Onboarding Console server,
// `scripts/onboarding-console.mjs` (stuinfla/ruvnet-brain, memory-health card).
//
// THE BUG. The console's "Your memory, proven" card scores the memory store of the project the
// server was launched FROM — gatherMemory(cwd) checks `path.join(cwd, '.swarm/memory.db')`, and
// startServer() correctly captures that real `cwd` at launch. But every read after the first is
// served from an on-disk cache (serveCached(), STATE_CACHE/etc.), refreshed by a DETACHED CHILD
// PROCESS that kickRefresh() spawns at most once per 15s:
//
//   const child = spawn(process.execPath, [SELF, '--refresh-cache'],
//     { detached: true, stdio: 'ignore', cwd: REPO });
//
// `REPO` is `path.dirname(__dirname)` — the PLUGIN's own install directory, not the project the
// server is serving. The refresh child's `--refresh-cache` branch calls
// `gatherState(process.cwd())`, which resolves to `REPO` because that is the `cwd` the child was
// spawned with. `REPO` has no `.swarm/memory.db` of its own, so `gatherMemory()` falls back to
// scoring `REPO` itself, produces a genuine "Liveness: fail" for the WRONG project, and writes
// that result into the on-disk cache — where it is then served to every subsequent request,
// including the very next page load, and re-written every 15s by the next kick. Measured live
// (2026-07-24): a project with a real, 122MB, actively-written `.swarm/memory.db` scored 33/100
// with "this project has no memory store (.swarm/memory.db) yet", because the number being shown
// was ruvnet-brain's OWN directory, never the project's.
//
// The console's own server process never calls `process.chdir()` anywhere in this file (grepped),
// so `process.cwd()` read at the moment `kickRefresh()` fires is always identical to the cwd the
// server was launched with. The fix does not need to thread a `cwd` argument through anything —
// it only needs the spawn call to stop hardcoding `REPO` and read the live `process.cwd()` instead,
// exactly as `startServer()`'s own default parameter and the `--print-state`/`--serve` CLI branches
// already do.
//
// WHY PATCH RATHER THAN EDIT IN PLACE: a `/plugin update` re-fetches ruvnet-brain wholesale and
// reverts any hand-edit, silently — same reason verify-interface/design-wall are targets rather
// than one-off edits.
//
// WHEN UPSTREAM FIXES THIS: the anchor stops matching and this reports `skip:no-anchor-matched`
// loudly, at which point uninstall the target. It never guesses.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';

const MARKETPLACE = 'ruvnet-brain';
const SCRIPT = ['scripts', 'onboarding-console.mjs'];

// Exact string, not a regex — this toolkit's literal find/replace discipline, so an anchor
// upstream has reworded is SKIPPED rather than guessed at.
const BUGGY = `    const child = spawn(process.execPath, [SELF, '--refresh-cache'], { detached: true, stdio: 'ignore', cwd: REPO });`;

const FIXED = `    // ruflo-source-patch: the refresh child must inherit the SERVER's cwd, not the plugin's own
    // install directory. \`REPO\` has no project .swarm/memory.db of its own, so a refresh spawned
    // with cwd:REPO scores the wrong project's memory health — every subsequent request (this
    // console never calls process.chdir(), so process.cwd() here is always the server's real cwd).
    const child = spawn(process.execPath, [SELF, '--refresh-cache'], { detached: true, stdio: 'ignore', cwd: process.cwd() });`;

const EDITS = [
  { id: 'kickrefresh-cwd', find: BUGGY, replace: FIXED, done: (s) => s.includes("cwd: process.cwd() });") && s.includes('the refresh child must inherit') },
];

// Every installed copy this console script could be loaded from. Unlike verify-interface.sh /
// design-wall.sh (which live under `plugin/scripts/`, the bundle Claude Code's hook loader reads),
// `onboarding-console.mjs` is invoked directly by the slash commands (/brain-console et al.) off
// the repo-root `scripts/` — measured live: no `plugin/scripts/onboarding-console.mjs` and no cache
// copy exist on this machine. Check all three shapes anyway rather than assume one: an absent path
// is a legitimate miss (fs.existsSync guards each), never a failure, and a future ruvnet-brain
// layout change is exactly the kind of drift this should keep finding without a re-release here.
export function discover() {
  const found = [];

  const mpRoot = path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', MARKETPLACE, ...SCRIPT);
  if (fs.existsSync(mpRoot)) found.push(mpRoot);
  const mpPlugin = path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', MARKETPLACE, 'plugin', ...SCRIPT);
  if (fs.existsSync(mpPlugin) && !found.includes(mpPlugin)) found.push(mpPlugin);

  const cacheRoot = path.join(HOME_BASE, '.claude', 'plugins', 'cache', MARKETPLACE, MARKETPLACE);
  try {
    for (const version of fs.readdirSync(cacheRoot)) {
      const f = path.join(cacheRoot, version, ...SCRIPT);
      if (fs.existsSync(f)) found.push(f);
    }
  } catch { /* not installed via the cache path */ }

  return [...new Set(found)];
}

const isPatched = (src) => EDITS.every((e) => e.done(src));

// How many times does this anchor occur? An anchor no longer unique would apply to every
// occurrence, silently, in a place never inspected. Today it is unique — a measurement, checked
// at apply time, not a promise trusted forever.
const occurrences = (src, needle) => {
  let n = 0;
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
};

function patchSource(pristine) {
  let next = pristine;
  const applied = [];
  const missing = [];
  for (const e of EDITS) {
    if (e.done(next)) continue;
    const n = occurrences(next, e.find);
    if (n === 1) { next = next.split(e.find).join(e.replace); applied.push(e.id); }
    else { missing.push(n > 1 ? `${e.id}(AMBIGUOUS: anchor occurs ${n}x)` : e.id); }
  }
  return { next, applied, missing };
}

// The composable descriptor. Single edit, so atomicity is moot, but declared explicitly rather
// than left implicit — a partial match on a single-edit target is just "not applied", never
// "half applied".
export const descriptor = {
  name: 'memory-health',
  atomic: false,
  editCount: EDITS.length,
  discover,
  patchSource,
  isPatched,
};
