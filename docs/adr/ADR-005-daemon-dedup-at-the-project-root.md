# ADR-005: daemon: key native deduplication to the project root

**Status**: Superseded
**Date**: 2026-07-14
**Updated**: 2026-08-15. Exact published `@claude-flow/cli` 3.38.12 now exports one
`resolveDaemonProjectRoot()` and routes autostart plus direct start/stop/status/trigger/enable/
supervisor identities through it. The executable resolver proof covers nested cwd, an independently
initialized nested project, `.git` boundary stopping, and no-marker fallback. #2877 is therefore
fixed locally and this target retires terminally; older installed releases remain patchable.
**Deciders**: Henrik Pettersen
**Tags**: patch-target, daemon, cost

## Context

Daemon count scales with the number of `.claude-flow` folders, without bound.

A `.claude-flow` folder is the daemon spawn gate (`ensureDaemonRunning` returns early unless one exists at
that cwd), and deduplication is per-folder (`isDaemonAlive` checks `<cwd>/.claude-flow/daemon.pid`). So
every stray folder created by cwd drift (ADR-004) becomes a live daemon target.

The historical gap was that the `cwd` target normalized the autostart service and its daemon callees,
while direct `ruflo daemon start|stop|status` commands skipped autostart and derived lock, PID, stop,
status, and supervisor identity from raw `process.cwd()`.

Ruflo's #2407/#2484 `O_EXCL` lock is correct for concurrent starts in one directory. It cannot
deduplicate two starts whose raw cwd values point to different lock paths. The 3.33.0 reproduction
confirmed that distinction: four concurrent starts in four subdirectories produced four live
processes and four subdirectory PID files.

Measured on one 12-repo working set: ~25 concurrent daemons, ~1.4 GB RSS. Each independently runs headless
workers, so an unbounded daemon count is unbounded, duplicated token spend. Deleting the 97 stray folders
dropped the live count from ~25 to 1: direct causal confirmation.

## Decision

Keep Ruflo's native lock algorithm unchanged. For affected legacy releases, normalize the project
identity fed to it:

- `cwd` resolves the root in `ensureDaemonRunning`, `getDaemon`, and `startDaemon`, covering
  autostart and worker-daemon callers.
- `daemon` resolves the root in the direct command's start, stop, status, and supervisor paths,
  which bypass autostart (#2877).
- An explicit `--workspace` remains authoritative.
- Distinct Git worktrees remain distinct project roots.

For current releases, preserve upstream bytes and classify both daemon entries as native-satisfied.
Retirement requires every discovered runnable copy to pass structural classification and an executable
resolver probe; mixed, unknown, or mutated copies keep the target live.

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

- The broader durable-state work remains tracked separately by #2633 and ADR-004; native daemon
  retirement does not imply that all `.claude-flow`/`.swarm` paths are fixed.

### Neutral

- `cleanup` (ADR-013) repairs a project that already sprawled; this prevents new sprawl.

## Links

- Upstream residual: [#2877](https://github.com/ruvnet/ruflo/issues/2877)
- Broader root model: [#2633](https://github.com/ruvnet/ruflo/issues/2633)
- Native same-directory lock, retained unchanged: [#2407](https://github.com/ruvnet/ruflo/issues/2407), [#2484](https://github.com/ruvnet/ruflo/issues/2484)
- [ADR-004](ADR-004-cwd-anchor-state-to-project-root.md), [ADR-013](ADR-013-cleanup-repair-a-sprawled-project.md)
