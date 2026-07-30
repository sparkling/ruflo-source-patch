# ADR-005: daemon: key native deduplication to the project root

**Status**: accepted
**Date**: 2026-07-14
**Updated**: 2026-07-30. A clean `@claude-flow/cli` 3.33.0 reproduction started four live
foreground daemons, with four PID files, from four subdirectories of one project. Filed the
focused residual as #2877. The legacy lock injection is retired: #2407/#2484 correctly provide
the native same-directory lock, and this target now changes only its project identity.
**Deciders**: Henrik Pettersen
**Tags**: patch-target, daemon, cost

## Context

Daemon count scales with the number of `.claude-flow` folders, without bound.

A `.claude-flow` folder is the daemon spawn gate (`ensureDaemonRunning` returns early unless one exists at
that cwd), and deduplication is per-folder (`isDaemonAlive` checks `<cwd>/.claude-flow/daemon.pid`). So
every stray folder created by cwd drift (ADR-004) becomes a live daemon target.

The `cwd` target now normalizes the autostart service and its daemon callees. Direct
`ruflo daemon start|stop|status` commands are a separate path: the CLI deliberately skips
autostart for the `daemon` command, and `commands/daemon.js` still derives its lock, PID file,
status, stop, and supervisor identity from raw `process.cwd()`.

Ruflo's #2407/#2484 `O_EXCL` lock is correct for concurrent starts in one directory. It cannot
deduplicate two starts whose raw cwd values point to different lock paths. The 3.33.0 reproduction
confirmed that distinction: four concurrent starts in four subdirectories produced four live
processes and four subdirectory PID files.

Measured on one 12-repo working set: ~25 concurrent daemons, ~1.4 GB RSS. Each independently runs headless
workers, so an unbounded daemon count is unbounded, duplicated token spend. Deleting the 97 stray folders
dropped the live count from ~25 to 1: direct causal confirmation.

## Decision

Keep Ruflo's native lock algorithm unchanged. Normalize the project identity fed to it:

- `cwd` resolves the root in `ensureDaemonRunning`, `getDaemon`, and `startDaemon`, covering
  autostart and worker-daemon callers.
- `daemon` resolves the root in the direct command's start, stop, status, and supervisor paths,
  which bypass autostart (#2877).
- An explicit `--workspace` remains authoritative.
- Distinct Git worktrees remain distinct project roots.

Remove the former `@sparkleideas/cli` legacy-lock entry and its injected lock fragment. That fork
is not an installed or monitored target, and current Ruflo already owns the concurrency primitive.

## Consequences

### Positive

- One daemon per project root, not one per visited subdirectory.
- Token spend from duplicated headless workers is bounded.
- A stray folder can no longer become a daemon target, because the gate resolves the root first.
- Direct status and stop commands issued from a subdirectory address the same root daemon.
- Ruflo's native lock behavior stays byte-for-byte upstream-owned.

### Negative

- The patch remains until #2877 supplies one shared canonical root resolver to every direct daemon
  path. The broader durable-state work remains tracked by #2633 and ADR-004.

### Neutral

- `cleanup` (ADR-013) repairs a project that already sprawled; this prevents new sprawl.

## Links

- Upstream residual: [#2877](https://github.com/ruvnet/ruflo/issues/2877)
- Broader root model: [#2633](https://github.com/ruvnet/ruflo/issues/2633)
- Native same-directory lock, retained unchanged: [#2407](https://github.com/ruvnet/ruflo/issues/2407), [#2484](https://github.com/ruvnet/ruflo/issues/2484)
- [ADR-004](ADR-004-cwd-anchor-state-to-project-root.md), [ADR-013](ADR-013-cleanup-repair-a-sprawled-project.md)
