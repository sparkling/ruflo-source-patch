# ADR-002: Keep patches live with a scheduled monitor and session hooks, not a daemon

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: runtime, monitor, safety

## Context

`npx -y ruflo@latest` fetches a NEW cache directory the moment a version changes, and a `ruflo update` can
land mid-session. A patch applied once is therefore not a patch that stays applied: a fresh, unpatched copy
can be running for hours.

A SessionStart hook alone does not close this. It fires only when a session STARTS, and people leave Claude
Code running for days.

The obvious answer is a resident watcher process. But this package exists partly BECAUSE ruflo daemons
multiply without bound; shipping another long-lived process would be poor taste and worse engineering.

## Decision

No resident process. The OS scheduler (launchd on macOS, cron on Linux) runs a **short-lived** check on an
interval (default 300s). It re-applies the installed target set and exits. Steady state is a few stats and
no writes.

Three surfaces, each with a distinct job:

- **SessionStart hook**: re-apply on session start, and report problems where a human will see them.
- **The monitor tick**: close the mid-session window the hook cannot reach.
- **UserPromptSubmit notifier**: the monitor is detached and cannot reach a running session, so it leaves
  a note; the notifier surfaces it on the next prompt.

And the watchdog is itself watched: a heartbeat plus liveness checks, because a dead monitor is
indistinguishable from a healthy system, which is the most dangerous state a watchdog can be in and the one
it cannot report on itself.

Read-only actions observe; mutating actions repair. `status` and `monitor check` never heal on their way to
looking, or the gate could only ever say `ok`.

## Consequences

### Positive

- The mid-session window is closed without adding to the daemon population this package was written to
  bound.
- A tick that dies still proves the scheduler fired, because the heartbeat is written before any work that
  could throw.
- Problems reach a human on the next prompt rather than dying in a log file nobody reads.

### Negative

- Bounded staleness, not zero: a fresh unpatched copy can run for up to one interval.
- A scheduled job is another thing that can be mis-registered; the schedule itself needs a health check.

### Neutral

- The interval is configurable (`RSP_MONITOR_INTERVAL`), clamped to a floor so a 1-second monitor cannot
  hammer the machine.

## Links

- [ADR-003](ADR-003-the-stable-copy-is-the-executable.md)
- `lib/cwd/monitor.mjs`, `lib/cwd/health.mjs`, `lib/cwd/notify.mjs`
