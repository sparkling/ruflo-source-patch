# ADR-008: adr-index: make the importer converge instead of reporting false success

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: patch-target, plugin, adr, data-integrity

## Context

`/adr-index` cannot update a changed ADR, which is the one thing its own SKILL.md advertises.

Both namespaces are insert-only. Deterministic keys COLLIDE, so an existing record stays FROZEN at its first
value: edit an ADR, re-run the import, and the stored copy never changes. Random edge keys never collide, so
edges DUPLICATE on every run (3 -> 6 -> 9).

And the failure is invisible: a `UNIQUE` constraint violation (exit 1) is counted as a stored record, so
both outcomes are reported as `Records stored: N/N`. The index rots while the tool announces success.

## Decision

Patch the importer so a re-import CONVERGES: upsert the record rather than colliding, and make edge keys
deterministic so re-running is idempotent rather than additive. Count a failed store as a failure, so the
summary reports what actually happened.

Also print an `ORPHANS:` line when the index holds a record whose source file no longer exists on disk,
which is the one condition an upsert-only importer can never repair (see ADR-009).

## Consequences

### Positive

- Re-running `/adr-index` converges instead of freezing records and multiplying edges.
- `Records stored: N/N` means N records were stored.
- Deletions become visible, via the `ORPHANS:` line, even though the importer cannot reap them.

### Negative

- Deterministic edge keys change the stored shape, so an index built under the old scheme contains
  unreachable rows and needs one rebuild.

### Neutral

- This is convergence, not reaping. An ADR file that is DELETED still leaves an orphan, which is why
  ADR-009 exists.

## Links

- Upstream: [ruvnet/ruflo#2660](https://github.com/ruvnet/ruflo/issues/2660)
- [ADR-009](ADR-009-adr-reindex-reconcile-a-deleted-adr.md)
- `lib/adr-index/`
