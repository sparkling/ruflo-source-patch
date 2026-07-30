# ADR-006: memory: fail-closed serialization and WAL-sidecar refusal for memory.db

**Status**: accepted
**Date**: 2026-07-14
**Updated**: 2026-07-30. Ruflo 3.33.0 still acknowledges concurrent whole-image writes
that it loses (12 successes, 2 rows persisted in the clean reproducer). The focused residual is
[#2878](https://github.com/ruvnet/ruflo/issues/2878); closed #2621 remains the historical report.
The local lock now fails closed and is async-context reentrant. The former global WAL checkpoint
has been removed in favour of the fail-closed sidecar policy established by #2735.
**Deciders**: Henrik Pettersen
**Tags**: patch-target, durability, data-loss

## Context

`.swarm/memory.db` silently drops writes. Ruflo's fallback memory functions perform a whole-file
read-modify-write (`sql.js` export followed by atomic rename). Two processes can each read image
v1 and each publish a valid image v2; the second rename clobbers the first. Atomic publication
prevents a torn file but cannot prevent this lost update.

The clean 3.33.0 reproducer forced the documented fallback with
`CLAUDE_FLOW_DISABLE_BRIDGE=1`: all 12 `storeEntry` calls returned success, only 2 rows remained,
and `integrity_check` still passed. Upstream's `withMemoryDbLock()` is opt-in and still has only
the purge caller, so ordinary writers bypass it. This is now tracked precisely by #2878 rather
than broadening the closed #2621 body again.

There is a separate engine-boundary hazard. The AgentDB bridge uses native SQLite in WAL mode;
the fallback reads and replaces the main file as a complete image. `sql.js` cannot see frames in
`-wal`. Reading that main file while a native holder is attached can therefore produce a stale
image and replacing it can detach or mispair the holder's WAL. A helper must not "repair" that
state by checkpointing or removing another connection's sidecars.

## Decision

### Serialize every exported writer, and fail closed

Inject one `<db>.rsp-lock` protocol around `initializeMemoryDatabase`, `storeEntry`, `getEntry`,
`deleteEntry`, `applyTemporalDecay`, `ensureSchemaColumns`, and native `purgeNamespace`.

- `O_EXCL` creation provides cross-process exclusion across the complete read-modify-write.
- `AsyncLocalStorage` makes a genuinely nested call reentrant without treating unrelated sibling
  Promise chains in the same process as owners. Reentry also verifies that the inherited claim is
  still active, so a detached continuation cannot reuse permission after its ancestor releases.
- An unresolved path, filesystem error, or five-second timeout throws
  `RSP_MEMORY_LOCK_UNAVAILABLE` before the operation runs. An unavailable lock never becomes an
  acknowledged unlocked mutation.
- Each claim records a unique token. Release verifies both the open file's inode and its token,
  so a late cleanup cannot unlink another writer's successor claim.
- The patch deliberately does not steal a lock by age. Age is not proof that a large write died,
  and filesystem unlink is not compare-and-delete. A hard crash may leave a lock that requires
  explicit operator inspection/removal; this is a loud availability failure, not silent data loss.

The EOF wrapper serializes both native bridge and fallback paths so they cannot race each other,
but the image-safety checks below run only when Ruflo actually crosses its raw `fs-secure` boundary.
A successful transactional AgentDB bridge call is not falsely rejected as a whole-image rewrite.

### Refuse raw access while WAL sidecars exist

At `readFileMaybeEncrypted` and `writeFileAtomic`, fail with
`RSP_UNSAFE_WAL_SIDECARS` whenever the target is a `.db` and either `-wal` or `-shm` exists.
Sidecar presence is the signal, including a zero-byte WAL held by a live connection. A stat error
also fails closed because absence could not be proven.

The patch never checkpoints, truncates, unlinks, renames, or otherwise mutates another
connection's WAL state. `initializeMemoryDatabase({force:true})` is checked before upstream
unlinks the main database, and `checkMemoryInitialization` is guarded outside its catch block so
a live WAL cannot be misreported as an ordinary "not initialized" result.

This is the narrow policy from #2735 applied at the actual whole-image boundary. The upstream
per-function gates remain useful, but the boundary also covers `ensureSchemaColumns`,
`applyTemporalDecay`, purge fallback, and any future caller of the shared helpers.

## Consequences

### Positive

- Concurrent cross-process and same-process sibling writes serialize; the executable regression
  keeps all 80/80 cross-process updates and 40/40 sibling updates.
- Lock acquisition failure aborts before the callback, so failure cannot look like success.
- A raw fallback cannot read or replace the main database while native WAL state exists.
- The patch no longer mutates a live database merely because a helper attempted a read.
- Native purge participates in the ordinary writers' protocol, satisfying #2666 locally.

### Negative

- A lock adds latency to every exported memory operation.
- A process killed without running its exit cleanup can leave `<db>.rsp-lock`. The operator must
  verify that no writer owns it before removing it; the patch intentionally refuses to guess.
- Fallback access is unavailable while a native connection keeps WAL sidecars present. The native
  bridge must succeed, or the holder must close before retrying.

### Neutral

- Upstream's private `<db>.lock` remains nested inside purge. It is redundant locally but is left
  byte-for-byte intact.
- The historical #2621 evidence remains relevant, but #2878 is the acceptance target for ordinary
  writers and fail-closed locking.

## Links

- Upstream: [#2878](https://github.com/ruvnet/ruflo/issues/2878),
  [#2735](https://github.com/ruvnet/ruflo/issues/2735),
  [#2621](https://github.com/ruvnet/ruflo/issues/2621),
  [#2584](https://github.com/ruvnet/ruflo/issues/2584)
- `lib/cwd/patch-library.mjs` (`memLock`, `walRefusal`, `integrityGate` fragments)
- `test/concurrency.mjs` (cross-process, sibling, reentrancy, fail-closed, ownership, WAL tests)
