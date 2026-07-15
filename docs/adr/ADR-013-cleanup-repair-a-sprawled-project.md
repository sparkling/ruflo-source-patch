# ADR-013: cleanup: repair a project that has already sprawled, with a containment guard

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: tooling, safety, destructive

## Context

The patches PREVENT new sprawl. They do nothing about a project that already has 97 stray `.claude-flow`
directories and a dozen orphaned daemons. That mess has to be repairable.

But this is the only code in the package that SIGNALS PROCESSES and REMOVES DIRECTORIES. A containment bug
here does not report a wrong number; it SIGTERMs another project's daemon.

And it was silently broken. `isInside()`, the containment guard, compared paths with `path.resolve()`, which
does not follow symlinks. `/var` and `/tmp` ARE symlinks on macOS, and `lsof` (how a pid's cwd is read)
always reports the RESOLVED path. So a project under `/var` or `/tmp` yielded `root=/var/x` while its
daemon's cwd read back as `/private/var/x`. Containment matched nothing: cleanup found ZERO daemons and
reported "nothing to clean" on a project full of them. Announcing success while doing nothing, in our own
cleanup command.

## Decision

A `cleanup` command that removes stray state directories and stops daemons whose cwd is inside the project,
with a hard containment boundary:

- `--dry-run` shows exactly what would happen and deletes nothing.
- Containment compares REAL (symlink-resolved) paths, on both sides.
- It refuses a root that is too broad, and fails rather than proceeding.
- Another project's daemon must survive. That is the invariant, and it is tested with real processes.

`strayStateDirs()` also serves as the LEAK DETECTOR: the SessionStart hook reports stray directories without
removing them, because a stray directory holds orphaned neural checkpoints and split `memory.db` files, and
discarding the only copy of someone's learning state is not a hook's decision.

## Consequences

### Positive

- A sprawled project can be repaired without hand-deleting 97 directories.
- The kill path is tested against real processes and real `pgrep`/`lsof`, not mocks.

### Negative

- It DESTROYS DATA. A stray `.claude-flow` may hold the only copy of state that was written there and never
  read back. Deletion is a human's decision, which is why the hook only reports.

### Neutral

- Detection (the hook) and repair (this command) are deliberately separate: read-only surfaces observe,
  mutating surfaces repair.

## Links

- [ADR-002](ADR-002-monitor-and-hooks-not-a-daemon.md), [ADR-004](ADR-004-cwd-anchor-state-to-project-root.md)
- `lib/cwd/cleanup.mjs`
