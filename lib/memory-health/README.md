# `memory-health`

[← ruflo-source-patch](../../README.md)

The Onboarding Console's memory-health card, scoring the wrong project.

Patches the **`ruvnet-brain`** plugin's `scripts/onboarding-console.mjs`, the local server behind
`/brain-console` (aka `/rvbc`, `/rvcb`, `/ruvnet-brain:configure`). Its "Your memory, proven" card
reported a project's `.swarm/memory.db` as missing, "Liveness: fail", capping the score at 33/100,
on a project with a real, 122MB, actively-written store.

## The bug

`gatherMemory(cwd)` scores whichever project the console server was launched from. That much is
correct on the very first request. But every read after that is served from an on-disk cache
(`~/.claude/ruvnet-brain/state-cache.json` and friends), refreshed by a **detached child process**
that `kickRefresh()` spawns at most once per 15 seconds:

```js
const child = spawn(process.execPath, [SELF, '--refresh-cache'],
  { detached: true, stdio: 'ignore', cwd: REPO });
```

`REPO` is `path.dirname(__dirname)`: the **plugin's own install directory**, not the project being
served. The refresh child's `--refresh-cache` branch calls `gatherState(process.cwd())`, which
resolves to `REPO` because that is the `cwd` it was spawned with. `REPO` has no project
`.swarm/memory.db` of its own, so the health check genuinely fails, for the wrong project, and
that result is written into the cache and served to every subsequent request, re-derived every 15s
by the next kick.

## The fix

The console's server process never calls `process.chdir()` anywhere, so `process.cwd()` read at
the moment `kickRefresh()` fires is always identical to the cwd the server was launched with. No
argument needs to be threaded through anything:

```js
const child = spawn(process.execPath, [SELF, '--refresh-cache'],
  { detached: true, stdio: 'ignore', cwd: process.cwd() });
```

The refresh child now inherits the real project directory, exactly like the server's own
`--serve`/`--print-state` CLI paths already do.

## Usage

```bash
npx github:sparkling/ruflo-source-patch memory-health install
npx github:sparkling/ruflo-source-patch memory-health status
npx github:sparkling/ruflo-source-patch memory-health uninstall
```

See [ADR-025](../../docs/adr/ADR-025-memory-health-kickrefresh-inherits-server-cwd.md).
