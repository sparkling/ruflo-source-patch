# ADR-006: memory: a cross-process write lock and WAL-coherent reads for memory.db

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: patch-target, durability, data-loss

## Context

`.swarm/memory.db` silently drops writes. Measured: **50 acknowledged, 25 on disk.**

`storeEntry` / `getEntry` / `deleteEntry` each perform a whole-file read-modify-write. Two processes (the
daemon and the MCP server, routinely) each read image v1 and each write it back; the second clobbers the
first. Nothing errors. The write is acknowledged and gone. This is upstream #2621, and upstream's own fix
(`withMemoryDbLock`) is opt-in and has exactly one caller, so every ordinary writer is still unguarded.

Separately, `sql.js` cannot read WAL frames. A bare `readFileSync` on a WAL-mode database returns a STALE
image (measured: "no such table: memory_entries" while 500 rows sat in a 2.3 MB `-wal`), which the caller
then writes back OVER the real image.

## Decision

**A cross-process single-writer lock** spanning read..write, injected around the memory mutators. It is:

- REENTRANT, because `storeEntry` calls `getEntry` internally and a naive lock self-deadlocks
- NEVER HARD-FAILING: on timeout or a read-only filesystem it proceeds UNLOCKED, degrading to current
  behaviour rather than breaking memory
- STALE-RECOVERING: a lock older than 15s is stolen (the holder died mid-write), with an exit-hook unlink

**WAL-coherent reads**: checkpoint(TRUNCATE) before reading a `.db`, so the image is complete. Deliberately
NOT unlinking `-wal`/`-shm` afterwards: `-shm` is SQLite's shared-memory LOCK INDEX, and unlinking it while
another process holds a connection splits the two onto different lock state, manufacturing the
unsynchronised writers this exists to prevent.

## Consequences

### Positive

- Concurrent writes stop being lost. Measured with the lock stubbed out: 38 of 80 writes survive. With it:
  80 of 80.
- A stale WAL image can no longer be written back over live data.

### Negative

- A lock adds latency to every memory write, and a degraded (unlocked) path exists by design, so the
  guarantee is "no lost writes when the lock can be taken", not an absolute.

### Neutral

- The injected lock file (`<db>.rsp-lock`) is a different path from upstream's later `<db>.lock`. When
  upstream's lands in a published build, the two should be reconciled onto one path.

## Links

- Upstream: [#2621](https://github.com/ruvnet/ruflo/issues/2621), [#2584](https://github.com/ruvnet/ruflo/issues/2584)
- `lib/cwd/patch-library.mjs` (`memLock`, `walCheckpoint` fragments)
