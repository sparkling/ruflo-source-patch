# ADR-008: adr-index: make the importer converge instead of reporting false success

**Status**: accepted
**Date**: 2026-07-14
**Updated**: 2026-07-31. #2660 is fixed in every active Claude Code and Codex
marketplace/cache copy on this machine. Retirement executes the native stable-key/upsert and
edge-deduplication behavior, checks the pristine importer for honest store counts, and requires
native `adr-index` to route deletions to a runnable native `adr-reindex`. #2870 remains separate
release-identity hygiene. The target restored vendor bytes and retired only after the same proof
passed again post-reconciliation.
**Deciders**: Henrik Pettersen
**Tags**: patch-target, plugin, adr, data-integrity

## Context

The affected `/adr-index` could not update a changed ADR, which was the one thing its own SKILL.md advertised.

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
- The compatibility patch made deletions visible via `ORPHANS:` while older copies remained active.

### Negative

- Deterministic edge keys change the stored shape, so an index built under the old scheme contains
  unreachable rows and needs one rebuild.

### Neutral

- This is convergence, not reaping. Native `adr-index` now documents that boundary and routes deletions
  to native `adr-reindex`; retirement also proves that route is runnable here under ADR-009's lock gate.

## Links

- Upstream: [ruvnet/ruflo#2660](https://github.com/ruvnet/ruflo/issues/2660)
- [ADR-009](ADR-009-adr-reindex-reconcile-a-deleted-adr.md)
- `lib/adr-index/`
