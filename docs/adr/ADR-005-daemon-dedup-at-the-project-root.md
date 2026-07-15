# ADR-005: daemon: deduplicate at the project root, and lock the spawn

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: patch-target, daemon, cost

## Context

Daemon count scales with the number of `.claude-flow` folders, without bound.

A `.claude-flow` folder is the daemon SPAWN GATE (`ensureDaemonRunning` returns early unless one exists at
that cwd), and deduplication is per-folder (`isDaemonAlive` checks `<cwd>/.claude-flow/daemon.pid`) with no
global registry. So every stray folder created by the cwd drift (ADR-004) becomes a live daemon target.

Since 3.24.0 autostart runs on every command, and the ruflo MCP server is the same CLI, so every Claude Code
session auto-spawns a daemon for whatever cwd it happens to have.

Measured on one 12-repo working set: ~25 concurrent daemons, ~1.4 GB RSS. Each independently runs headless
workers, so an unbounded daemon count is unbounded, duplicated token spend. Deleting the 97 stray folders
dropped the live count from ~25 to 1: direct causal confirmation.

## Decision

Anchor the daemon to the project ROOT, at the callee, so every caller is fixed at once: `ensureDaemonRunning`,
`getDaemon` and `startDaemon` resolve the root before using the cwd they were handed.

Also inject an `O_EXCL` spawn lock at `<root>/.claude-flow/daemon.lock` for older and forked builds that
lack upstream's own lock. Deliberately at the SAME path upstream uses, so a patched old build and a modern
build deduplicate against each other rather than racing.

## Consequences

### Positive

- One daemon per project root, not one per visited subdirectory.
- Token spend from duplicated headless workers is bounded.
- A stray folder can no longer become a daemon target, because the gate resolves the root first.

### Negative

- This treats the symptom. The anchor is the disease, and ADR-004 is the actual fix; a global daemon
  registry alone would bound the daemons and leave the data loss untouched.

### Neutral

- `cleanup` (ADR-013) repairs a project that already sprawled; this prevents new sprawl.

## Links

- Upstream: [#2633](https://github.com/ruvnet/ruflo/issues/2633), [#2407](https://github.com/ruvnet/ruflo/issues/2407), [#2484](https://github.com/ruvnet/ruflo/issues/2484)
- [ADR-004](ADR-004-cwd-anchor-state-to-project-root.md), [ADR-013](ADR-013-cleanup-repair-a-sprawled-project.md)
