# ADR-021: The monitor survives interpreter drift and self-recovers from the prompt hook

**Status**: accepted
**Date**: 2026-07-15
**Deciders**: Henrik Pettersen

**Tags**: monitor, runtime, safety

## Context

The whole tool depends on the monitor to keep the patches live between sessions, and the monitor is a
launchd (macOS) or cron (Linux) job. That job can silently DROP, and once dropped it cannot bring itself
back, because a dead tick never runs. Two ways this happens routinely, and both were observed:

1. **The interpreter vanishes.** The plist/cron entry recorded `process.execPath`, which under a version
   manager is a per-version path: mise `.../mise/installs/node/24.14.1/bin/node`, asdf, volta, nvm. The
   next `node` upgrade or GC deletes that exact path, and the scheduler is left invoking a program that no
   longer exists. A huge fraction of Node developers use a version manager, so this is not an edge case.
2. **The agent gets unloaded** by a logout, a sleep, or a launchd quirk. On this machine the launchd agent
   dropped twice in one session with no reboot and nothing in the tool unloading it.

Recovery was fragile: the only path back was `healMonitor()` on SessionStart, whose failure was swallowed,
and which no-ops while launchd still reports the job "scheduled" (so it misses a throttled/zombie job whose
heartbeat has gone stale). Between sessions, a dropped monitor stayed dead and INVISIBLE, and the plist
captured no stderr, so a crash-on-launch left no trace. "A dead watchdog that certifies its own health" is
the exact failure this package exists to hunt, and it was happening to the watchdog itself. That does not
work for a user base.

## Decision

Three changes, together making a drop from ANY cause survivable, recoverable, and visible.

1. **Register against a VERSION-STABLE node.** `resolveStableNode()` maps a manager-pinned interpreter to
   the manager's stable launcher, whose path never changes (mise/asdf `<root>/shims/node`, volta
   `<home>/.volta/bin/node`), and uses it for the plist/cron entry AND the recorded meta, but ONLY when
   that launcher exists and actually runs (`node --version`); otherwise it keeps `process.execPath`, and
   the existing "interpreter GONE" heal still covers it. nvm has no standalone shim, so it falls back.

2. **The prompt hook recovers a down monitor.** The UserPromptSubmit hook already checks liveness cheaply
   (a heartbeat and two path checks, no subprocess). When (and only when) that check says the monitor is
   not running, the hook now UNCONDITIONALLY re-bootstraps it (`recoverMonitor()`) and announces the
   recovery. It runs from the live Claude Code process, never from the launchd job, so it is not a
   self-bootout. Healthy prompts are unchanged: no heavy import, no launchctl.

3. **Instrument the failure.** The plist redirects the job's stderr+stdout to `monitor-stderr.log`, so a
   crash before `monitor-run.mjs`'s try/catch is CAPTURED. Recovery and session-start heal outcomes
   (`RECOVERED` / `RECOVER-FAILED` / `HEALED` / `HEAL-FAILED`) are logged, the captured crash is surfaced
   on recovery, and `healMonitor`'s error is no longer swallowed.

## Consequences

### Positive

- A version-manager node upgrade no longer kills the monitor: the shim path survives it.
- A drop from any cause self-recovers within the staleness window plus one prompt, with no user action,
  and says so instead of dying silently.
- A crash-on-launch is recorded rather than vanishing, so a real user report is diagnosable.

### Negative

- Recovery latency is bounded by the deliberately generous staleness threshold (6 intervals / 30 min
  floor, to avoid false alarms from a slept laptop), so a drop is auto-healed within roughly that window,
  not instantly. Still vastly better than "never, until a session restart".
- The prompt hook now touches launchd on the down path, a heavier but rare branch; the common (healthy)
  path stays free.
- The shim resolves the manager's GLOBAL node, which may differ from the version originally pinned. Any
  recent node runs the tick, so this is acceptable, and it is verified to launch before being adopted.

### Neutral

- This revises ADR-002's "the notifier only reports; repair is the monitor's job": the one thing the
  monitor cannot repair is its own death, so the live prompt hook is now the recovery path for exactly
  that case. Everything else the notifier still only reports.

## Links

- [ADR-002](ADR-002-monitor-and-hooks-not-a-daemon.md), [ADR-003](ADR-003-the-stable-copy-is-the-executable.md)
- `lib/cwd/monitor.mjs` (`resolveStableNode`, `recoverMonitor`, `readMonitorStderr`), `lib/cwd/notify.mjs`, `lib/cwd/commands.mjs`, `lib/cwd/health.mjs`
