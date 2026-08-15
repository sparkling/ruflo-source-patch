# ADR-009: adr-reindex: add the reconcile ruflo did not ship (superseded)

**Status**: Superseded
**Date**: 2026-07-14
**Updated**: 2026-08-15. Exact published Ruflo 3.38.12 now routes native purge and every ordinary
sql.js mutator through shared `withMemoryDbLock()`. The retirement predicate accepts either that
complete native writer set or the stronger local `.rsp-lock` overlay, rejects a single unlocked
writer, and checks nested global `ruflo` installations. The additive compatibility target remains
terminally retired where the native skill, purge command, and shared-lock proof all pass.
**Deciders**: Henrik Pettersen
**Tags**: patch-target, plugin, adr, superseded

## Context

`adr-index` can ADD an ADR and (with ADR-008) UPDATE one. It has no way to REMOVE one.

Delete an ADR file, or a single relation line from a surviving file, and the row written for it survives
every future import, forever. Worse, `adr-verify` then certifies the resulting graph as HEALTHY, because an
orphan row with zero edges in or out has no dangling reference and forms no cycle. It is invisible to both
of its checks.

Upsert converges. It can never REAP. Reaping needs a hard delete, and the CLI had none: `memory delete` is
a SOFT delete whose tombstone still occupies the UNIQUE(namespace, key) slot and blocks a later re-store.

## Decision

Add an `/adr-reindex` slash command to the `ruflo-adr` plugin (a skill, plus the script it invokes) that
drops both namespaces and rebuilds from the ADR files on disk. The files are the source of truth; the
namespaces are a derived cache, and for a derived cache the correct reconcile is a REBUILD.

The legacy script REQUIRES the `memory` target (ADR-006). This is the one operation whose entire job is
to delete rows, and without a shared write lock a concurrent daemon holding a pre-delete image flushes
it back and resurrects everything just removed. Current native reindex uses native purge, whose complete
3.38.12 writer set now passes the same shared-lock retirement boundary.

It is a PLUGIN target rather than a script one because the skill file lives inside someone else's plugin: a
`/plugin update` re-fetches `ruflo-adr` wholesale and takes the skill with it, silently.

## Consequences

### Positive

- A deleted ADR can be reconciled, which upsert can never do.
- The rebuild is verified by a post-condition (records on disk == records in the index), not by a tally of
  successful store calls, which cannot see a concurrent clobber.

### Negative

- It hard-deletes rows, so it is the most destructive thing in the package and is gated on the write lock.

### Neutral

- The upstream skill and `memory purge` are necessary but not sufficient. Retirement additionally
  proves that purge shares one lock with `ensureSchemaColumns`, temporal decay, store, get, delete,
  and purge itself. A partial or mixed installed fleet keeps the compatibility target live.

## Links

- Upstream: [ruvnet/ruflo#2666](https://github.com/ruvnet/ruflo/issues/2666) (closed)
- [ADR-006](ADR-006-memory-write-lock-and-wal-coherent-reads.md), [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md)
- `lib/adr-reindex/`
