# ADR-009: adr-reindex: add the reconcile ruflo did not ship (superseded)

**Status**: accepted
**Date**: 2026-07-14
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

It REQUIRES the `memory` target (ADR-006). This is the one operation whose entire job is to delete rows, and
without the write lock a concurrent daemon holding a pre-delete image flushes it back and resurrects
everything just removed.

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

- SUPERSEDED as of `ruflo-adr` 0.4.0 plus `@claude-flow/cli` 3.29.0, which together ship an `/adr-reindex`
  and the `memory purge` hard-delete it needs. The target now retires ITSELF on that proof (ADR-014), and
  did so on this machine. It is retained for anyone on an older CLI, where the gap is still real.

## Links

- Upstream: [ruvnet/ruflo#2666](https://github.com/ruvnet/ruflo/issues/2666) (closed)
- [ADR-006](ADR-006-memory-write-lock-and-wal-coherent-reads.md), [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md)
- `lib/adr-reindex/`
