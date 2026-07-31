# `adr-index`

[← ruflo-source-patch](../../README.md)

The historical compatibility patch for an index that could be created but never updated.

Patches `ruflo-adr`'s importer, `scripts/import.mjs`.
Upstream: [#2660](https://github.com/ruvnet/ruflo/issues/2660) ·
[#2594](https://github.com/ruvnet/ruflo/issues/2594)

**Retired on active native proof.** Every active Claude Code and Codex marketplace/cache copy now
executes stable-key upsert and edge de-duplication, the pristine importer reports failed stores
honestly, and native `adr-index` explicitly routes deletions to native `adr-reindex`. The retirement
predicate also requires that reindex route to be runnable through `memory purge` and the shared
fail-closed writer lock. #2870 remains separate release-identity hygiene, not a reason to retain a
behaviorally redundant patch.

## The historical bug

The affected `adr-index` **could not update an ADR that changed**, which was the one thing its own SKILL.md advertised
("Build or *rebuild* … when the graph is out of sync with the on-disk files"). Ratify an ADR, re-run it,
and the graph still says `proposed`.

Both namespaces are insert-only, and that single choice fails in **opposite directions**:

- **`adr-patterns`** has deterministic keys (`ADR-001::<basename>`), so they **collide**. The INSERT is
  rejected and the record stays **frozen** at whatever was first indexed.
- **`adr-edges`** has keys embedding `Date.now()` plus random, so they **never** collide. Every run
  re-inserts the whole edge set: 3 → 6 → 9 → … Duplicate edges silently weight an ADR by how many times
  someone ran the indexer.

Neither half is recoverable by running the tool again, and **it reports success either way**. A `UNIQUE
constraint` failure (exit 1) is counted as a stored record, so you get `Records stored: 2/2` while nothing
was written.

## The upsert twist

Before Ruflo 3.32.36, `memory store --help` advertised `-u, --upsert [default: true]`, but that
default was **declared and not honored** ([#2594](https://github.com/ruvnet/ruflo/issues/2594)).
Measured on those older bytes:

```
store to an existing key, no flag   -> exit 1, UNIQUE constraint failed, NO write
store to an existing key, --upsert  -> exit 0, updated
```

Ruflo 3.32.36 fixed the default. The native importer now passes the flag **explicitly**. The retired
compatibility transform remains as a rollback fixture for genuinely stale copies.

## What convergence does not do

**Deletions.** With upsert plus deterministic keys a re-import *converges*, but a removed ADR file leaves
an orphan row that no re-import can reap. Native `adr-index` now documents that boundary and routes the
user to native [`adr-reindex`](../adr-reindex/). The local `ORPHANS` line was useful extra diagnostics,
but it was not part of #2660's acceptance and no longer justifies retaining the patch once both native
paths are proven runnable.

## `done()`, not anchor-absence

Each edit carries a `done()` predicate reporting whether the fix is **present**, independent of which
anchor produced it. Matching on anchor-*absence* would call a file "patched" when the anchor simply never
existed, which is precisely how a missing edit could sail through green while leaving the bug in place.
The installed copies genuinely differ (the marketplace checkout carries local #2474 fixes), so one anchor
cannot match both.
