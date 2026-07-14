# `adr-index` — the index that could be created but never updated

Patches `ruflo-adr`'s importer, `scripts/import.mjs`.
Upstream: [#2660](https://github.com/ruvnet/ruflo/issues/2660) ·
[#2594](https://github.com/ruvnet/ruflo/issues/2594)

## The bug

`adr-index` **cannot update an ADR that changed** — the one thing its own SKILL.md advertises ("Build or
*rebuild* … when the graph is out of sync with the on-disk files"). Ratify an ADR, re-run it, and the
graph still says `proposed`.

Both namespaces are insert-only, and that single choice fails in **opposite directions**:

- **`adr-patterns`** — keys are deterministic (`ADR-001::<basename>`), so they **collide**. The INSERT is
  rejected and the record stays **frozen** at whatever was first indexed.
- **`adr-edges`** — keys embed `Date.now()` + random, so they **never** collide. Every run re-inserts the
  whole edge set: 3 → 6 → 9 → … Duplicate edges silently weight an ADR by how many times someone ran the
  indexer.

Neither half is recoverable by running the tool again, and **it reports success either way** — a `UNIQUE
constraint` failure (exit 1) is counted as a stored record, so you get `Records stored: 2/2` while nothing
was written.

## The upsert twist

`memory store --help` advertises `-u, --upsert [default: true]`. That default is **declared and not
honored** ([#2594](https://github.com/ruvnet/ruflo/issues/2594)) — measured:

```
store to an existing key, no flag   -> exit 1, UNIQUE constraint failed, NO write
store to an existing key, --upsert  -> exit 0, updated
```

So the flag must be passed **explicitly**. Keep it even after #2594 is fixed: it costs nothing and makes
the intent legible at the call site.

## What it does NOT fix

**Deletions.** With upsert + deterministic keys a re-import *converges* — but a removed ADR file leaves an
orphan row that no re-import can reap. That is [`../adr-reindex/`](../adr-reindex/), and it needs raw SQL.

## `done()`, not anchor-absence

Each edit carries a `done()` predicate reporting whether the fix is **present**, independent of which
anchor produced it. Matching on anchor-*absence* would call a file "patched" when the anchor simply never
existed — which is precisely how a missing edit could sail through green while leaving the bug in place.
The installed copies genuinely differ (the marketplace checkout carries local #2474 fixes), so one anchor
cannot match both.
