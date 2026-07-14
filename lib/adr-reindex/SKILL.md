---
name: adr-reindex
description: Rebuild a project's ADR index and dependency graph from docs/adr/. Use when /adr-index prints an ORPHANS line, after DELETING an ADR file or removing a relation line (Depends-on / Supersedes / Amends / Related) from one, or when the graph must be proven to match the files. This is the ONLY way to remove a stale row. /adr-index can add and update but never reaps a deletion, and /adr-verify certifies the orphaned graph as healthy. Not needed for ordinary edits.
argument-hint: "[project-dir] [--dry-run]"
allowed-tools: Bash
---

# ADR Reindex

Drop `adr-patterns` + `adr-edges`, rebuild both from the ADR files on disk.

## Use this when

- `/adr-index` printed an **`ORPHANS:`** line.
- An ADR file was **deleted**, or a relation line **removed** from one. *(Nothing else reaps it.)*
- It is the first run after installing the `adr-index` patch. Rows written under the old random-key scheme
  are unreachable orphans.
- The graph must be proven to match the files.

**Do NOT use this for ordinary edits** (ratifying an ADR, adding a relation, changing metadata). Run
`/adr-index`; it converges. This is a drop-and-rebuild: reach for it only when something must be
**removed**.

## Run it

```bash
# preview. deletes nothing
~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh --dry-run

# rebuild the current project (resolves to the nearest ancestor .git)
~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh

# or name one explicitly
~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh /path/to/project
```

**Exit 0 = reconciled.** It prints `before` / `after` counts and verifies graph integrity. Report the
counts. Stop.

## If it exits non-zero

It refuses rather than guessing. **Match the message and act. Do not work around it.** Every one of these
failures means the index is NOT reconciled, and the alternatives (`memory delete`, hand-editing
`memory.db`) will corrupt it further.

| Message | Meaning | Do this |
|---|---|---|
| `` the `memory` patch target is not installed `` | The delete would race a concurrent ruflo writer that can resurrect every removed row. **Nothing was deleted.** | Tell the user: `npx github:sparkling/ruflo-source-patch memory install`. Then re-run. |
| `could not take the write lock after 5s. Another writer holds it.` | Another ruflo process is mid-write. **Nothing was deleted.** | `npx @claude-flow/cli@latest daemon stop`, then re-run. Safe to retry. |
| `More rows than files: the DELETE did not stick` | A concurrent writer flushed a pre-delete image back. The rebuild reconciled **nothing**; the orphans are still there. | Stop the daemon, re-run. If it recurs, something is writing to `memory.db` continuously. Report that rather than retrying in a loop. |
| `Fewer rows than files: some ADRs failed to store` | The CLI's store is failing. | Run the importer directly to see the real error. The script prints both paths: `ADR_ROOT=<root> node <plugin>/scripts/import.mjs`. |
| `rebuild stored 0 records. The index is now EMPTY.` | The delete landed. The re-import stored nothing. | Re-run. The ADR files are intact, so a rebuild restores it. If it persists, run the importer directly. |
| `no docs/adr/ or docs/adrs/ under <root>` | Wrong directory. | Pass the project root explicitly. |

## Constraints

- **Never** `memory delete` an ADR row. It is a *soft* delete: the tombstone still trips the `UNIQUE`
  constraint on re-store, leaving the row neither gone nor replaceable.
- **Never** clear only `adr-patterns`. That fixes stale statuses and leaves the duplicate edges behind.
  Both namespaces, or neither.
- The ADR **files are never touched**. Re-running is always safe.

---

*Not part of upstream `ruflo-adr`. It is installed, and kept applied through `/plugin update`, by
[ruflo-source-patch](https://github.com/sparkling/ruflo-source-patch). The missing-command gap is
[ruvnet/ruflo#2666](https://github.com/ruvnet/ruflo/issues/2666); if it lands upstream, uninstall this
target and use theirs.*
