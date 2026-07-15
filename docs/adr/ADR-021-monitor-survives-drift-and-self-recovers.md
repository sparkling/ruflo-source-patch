# ADR-021: The monitor survives interpreter drift and self-recovers from the prompt hook

**Status**: accepted
**Date**: 2026-07-15
**Updated**: 2026-07-15: heartbeat is now a GATE with an authoritative launchctl/crontab probe (no 30-min floor, no sleep false-alarm); and the plist is ProcessType Standard, not Background, so the job is not opted into the aggressive power management the drop evidence pointed at.
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

2. **The prompt hook recovers a down monitor, and the heartbeat is a GATE, not the verdict.** The
   UserPromptSubmit hook checks liveness cheaply (path checks plus a heartbeat mtime, no subprocess).
   The heartbeat alone cannot tell a DROPPED job from an idle/slept one (both stop it), so the old design
   guessed with a 30-minute threshold and still false-alarmed after a lunch break. Now: a fresh heartbeat
   is definitely alive (do nothing); a heartbeat older than `2 × interval` (two consecutive missed ticks,
   one interval of margin over normal jitter, since the hook only runs while you are ACTIVE and ticks are
   firing) triggers the ONE authoritative question (`launchctl list` / `crontab -l`, run only here, never
   on a healthy prompt), which distinguishes death from sleep. Only a job that is genuinely NOT loaded is
   "down": the hook then UNCONDITIONALLY re-bootstraps it (`recoverMonitor()`) and announces it, from the
   live Claude Code process (never the launchd job, so not a self-bootout). A loaded-but-stale job (slept)
   is silent, and is never auto-kicked. On any probe uncertainty it assumes alive, so it never
   false-recovers.

3. **Instrument the failure.** The plist redirects the job's stderr+stdout to `monitor-stderr.log`, so a
   crash before `monitor-run.mjs`'s try/catch is CAPTURED. Recovery and session-start heal outcomes
   (`RECOVERED` / `RECOVER-FAILED` / `HEALED` / `HEAL-FAILED`) are logged, the captured crash is surfaced
   on recovery, and `healMonitor`'s error is no longer swallowed.

4. **Do not advertise the watchdog as throttleable.** The plist was `ProcessType=Background` +
   `LowPriorityIO`, which opts the job into macOS's most aggressive power management (App Nap, timer
   coalescing, deferral). After ruling out crash, logout, reboot and full sleep, that configuration is the
   one factor the drop evidence points at: the agent was unloaded during an idle low-power window on a job
   flagged as deferrable. It is now `ProcessType=Standard` with no `LowPriorityIO`. The tick is a few
   stats per interval, so normal scheduling costs nothing, and a watchdog that must fire on time should
   not be telling the OS it is fine to defer. This reduces drop FREQUENCY; recovery (2) still covers
   whatever slips through. The exact launchd bootout is not recorded in any accessible log, so this is a
   measurement-backed mitigation of the most-likely cause, not a proven root-cause fix.

## Consequences

### Positive

- A version-manager node upgrade no longer kills the monitor: the shim path survives it.
- A drop from any cause self-recovers within `2 × interval` plus one prompt, with no user action, and says
  so instead of dying silently.
- The sleep/idle false alarm is GONE: a slept-but-loaded monitor (the lunch case) is silent, because the
  authoritative probe, not a timer, decides. The magic 30-minute floor is deleted.
- A crash-on-launch is recorded rather than vanishing, so a real user report is diagnosable.

### Negative

- Recovery is auto but not instant: a genuine drop is caught within `2 × interval` (10 min at the default)
  plus one prompt, since the cheap heartbeat gate has to go stale before the authoritative probe runs.
  Vastly better than "never, until a session restart".
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
