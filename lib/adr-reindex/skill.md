---
name: adr-reindex
description: Rebuild a project's ADR index and dependency graph from docs/adr/ — reconciles the DELETIONS that adr-index's upsert can never reap (a removed ADR file, or a deleted relation line, leaves an orphan row forever). Use when adr-index prints an ORPHANS line, after deleting an ADR or a relation, or any time you want certainty that the graph matches the files.
argument-hint: "[project-dir] [--dry-run]"
allowed-tools: Bash
---

# ADR Reindex

`/adr-index` **converges** — with the `ruflo-source-patch` `adr-index` patch applied, re-running it
updates a changed ADR in place (status, metadata, relations) and stops duplicating edges.

What it can never do is **reap**. Delete an ADR file, or remove a `Depends-on:` line from one, and the
row it wrote survives every future import: nothing tells the importer that a row it wrote last week no
longer has a source on disk. The index goes on asserting a decision that does not exist.

Only a full drop-and-rebuild reconciles a deletion. That is this skill.

> Installed and kept applied by [`ruflo-source-patch`](https://github.com/sparkling/ruflo-source-patch).
> It is **not** part of upstream `ruflo-adr` — a `/plugin update` would drop it, and the patch tool's
> monitor puts it back. The missing-command gap is filed as
> [ruvnet/ruflo#2666](https://github.com/ruvnet/ruflo/issues/2666); if it lands upstream, uninstall this
> target and use theirs.

## When to use

- **`/adr-index` printed an `ORPHANS:` line** — it detected rows with no source on disk and told you to run this.
- **After deleting an ADR**, or removing a relation line from one. *(Required — nothing else reaps it.)*
- **After installing the `adr-index` patch for the first time** — rows written under the old random-key
  scheme are unreachable orphans, and show up as exactly that.
- Any time you want certainty that the graph matches the files. It is cheap: at ADR scale, instant.

For an ordinary edit — ratifying an ADR, adding a relation — you do **not** need this. Run `/adr-index`.

## Prerequisites

Requires the **`memory`** patch target. This hard-deletes rows from `memory.db`, and ruflo writes that
file as a whole-file read-modify-write image: without `memory/write-lock`, a daemon or MCP server
holding a *pre-delete* image flushes it back and resurrects every row you just removed
([ruvnet/ruflo#2621](https://github.com/ruvnet/ruflo/issues/2621)). The script refuses to run without
it rather than gambling your index on a race it cannot win.

```bash
npx github:sparkling/ruflo-source-patch memory install
```

## Steps

1. **Dry run first** if you want to see what it would do — it deletes nothing:

   ```bash
   ~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh --dry-run
   ```

2. **Rebuild.** With no argument it uses the current project (resolved to the nearest ancestor `.git`):

   ```bash
   ~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh
   ```

   Or name a project explicitly:

   ```bash
   ~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh /path/to/project
   ```

3. **Read the result.** It reports `before` and `after` counts, and verifies graph integrity. It exits
   **non-zero** if the rebuild did not reconcile — do not ignore that:

   - *"More rows than files: the DELETE did not stick"* — a concurrent ruflo writer resurrected the rows.
     Stop it (`npx @claude-flow/cli@latest daemon stop`) and re-run.
   - *"Fewer rows than files: some ADRs failed to store"* — the CLI's store is failing; run the importer
     directly to see why.

## What it does, and why each part matters

- **Takes the `<db>.rsp-lock` write lock** around the delete — the same lock the `memory` patch makes
  every ruflo writer honour. Released before the re-import, because the patched CLI takes that lock per
  store and would otherwise spin out into unlocked writes for the whole rebuild.
- **Hard-deletes both namespaces together** (`adr-patterns` + `adr-edges`) via raw SQL. Raw SQL because
  the CLI has no hard delete — `memory delete` is a *soft* delete, and the tombstone still trips the
  UNIQUE constraint on re-store ([#2652](https://github.com/ruvnet/ruflo/issues/2652)). Both namespaces,
  because clearing only `adr-patterns` fixes stale statuses and leaves the duplicate edges behind.
- **Re-imports from the ADR files**, which are the source of truth. `adr-patterns` / `adr-edges` are a
  derived cache, and for a derived cache the correct reconcile is a rebuild.
- **Asserts one record per ADR file.** The old post-condition was `records != 0`, which is blind to the
  failure this exists to prevent: if the delete is clobbered, the re-import upserts cleanly on top of the
  resurrected rows, every store reports ok, and it exits 0 having reconciled nothing.

The ADR files are never touched. Re-running is always safe.
