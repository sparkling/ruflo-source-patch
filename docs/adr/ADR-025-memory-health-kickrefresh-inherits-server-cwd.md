# ADR-025: memory-health: kickRefresh's cache-refresh child inherits the server's cwd

**Status**: accepted
**Date**: 2026-07-24
**Deciders**: Henrik Pettersen
**Tags**: patch-target, plugin, ruvnet-brain

## Context

`ruvnet-brain` ships an Onboarding Console (`scripts/onboarding-console.mjs`, served via
`/brain-console` and aliases) whose "Your memory, proven" card scores a project's memory-store
health across five weighted dimensions (liveness, coverage, recall quality, compaction survival,
session surfacing). A `fail` on any tested dimension caps the whole score at <=49.

Measured live (2026-07-24): a project with a genuine, 122MB, actively-written
`.swarm/memory.db` (confirmed by `stat`, and separately confirmed healthy via the AgentDB/ruflo
memory bridge: 10,875 entries, 16,390 patterns learned) scored 33/100. The liveness probe reported
status `fail`, detail "this project has no memory store (.swarm/memory.db) yet".

The card is correct on the very first request: `startServer({ cwd = process.cwd() })` captures the
real launch directory, and `gatherMemory(cwd)` checks `path.join(cwd, '.swarm/memory.db')` against
it. But every subsequent read is served from an on-disk cache
(`~/.claude/ruvnet-brain/state-cache.json` and siblings), refreshed by a **detached child process**
that `kickRefresh()` spawns at most once per 15 seconds:

```js
function kickRefresh() {
  const now = Date.now();
  if (now - LAST_REFRESH_KICK < 15000) return;
  LAST_REFRESH_KICK = now;
  try {
    const child = spawn(process.execPath, [SELF, '--refresh-cache'],
      { detached: true, stdio: 'ignore', cwd: REPO });
    child.unref();
  } catch { /* best-effort */ }
}
```

`REPO` (`path.dirname(__dirname)`, the plugin's own install directory) is hardcoded as the child's
`cwd`. The child was spawned with `cwd: REPO`, so the `--refresh-cache` CLI branch's call to
`gatherState(process.cwd())` resolves to the plugin's own directory, never the project being
served. `REPO` has no project `.swarm/memory.db`, so `gatherMemory()` falls back to scoring `REPO`
itself: a genuine "no store" result, for the wrong project, written straight into the on-disk cache
and served to every request thereafter (including the very next page load), then re-derived every
15 seconds by the next kick. Verified against the live server process (bound cwd: the correct
project), the live `/api/state` response (wrong: reports the plugin's own directory), and the
on-disk cache file (also wrong, byte-identical shape to what the console rendered).

## Decision

Read the live `process.cwd()` at spawn time instead of the hardcoded `REPO` constant:

```js
const child = spawn(process.execPath, [SELF, '--refresh-cache'],
  { detached: true, stdio: 'ignore', cwd: process.cwd() });
```

This is sound because the console's server process never calls `process.chdir()` anywhere in the
file (grepped, zero hits), so `process.cwd()` read at the exact moment `kickRefresh()` fires is
always identical to the cwd the server was launched with: the same value `startServer()`'s own
default parameter and the `--serve`/`--print-state` CLI branches already use. No argument needs to
be threaded through `kickRefresh()`'s signature or either of its two call sites
(`startServer()`'s listen callback, and `serveCached()`'s warm-cache branch).

Single literal edit, applied wherever `onboarding-console.mjs` is found installed. Measured: only
under the marketplace checkout's `scripts/` on this machine today. Neither `plugin/scripts/` nor
any cache copy ships this file, unlike `verify-interface.sh`/`design-wall.sh`; `discover()` still
checks all three shapes so a future layout change is caught rather than silently missed.

## Consequences

### Positive

- The memory-health card scores the ACTUAL project the console was launched for, on every request,
  not just the first.
- No behavior change to anything else `REPO` is used for in this file (SBOM path, script-runner
  invocations, gate surveys); only the one spawn call inside `kickRefresh()` is touched.

### Negative

- None identified. The fix strictly narrows an existing bug's blast radius; it does not change any
  documented behavior. `discover()`'s `plugin/scripts/` and cache-copy checks are speculative
  (nothing to patch there today) and cost only an `fs.existsSync` each.
