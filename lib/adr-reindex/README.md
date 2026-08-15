# `adr-reindex`

[← ruflo-source-patch](../../README.md)

> **Superseded only when the complete replacement is runnable here.** Ruflo now ships the
> reconcile and `memory purge`. Ruflo 3.38.12 routes purge and every ordinary sql.js mutator through
> the same native `withMemoryDbLock()`; older builds may instead qualify through this repository's
> stronger `<db>.rsp-lock`. The legacy command retires only after that three-part proof.

The historical reconcile that `ruflo-adr` did not ship. It is the only target that **adds** a command
rather than fixing a broken one. Filed upstream as
[ruvnet/ruflo#2666](https://github.com/ruvnet/ruflo/issues/2666).

## Contents

- [The files](#the-files)
- [Convergence is not reaping](#convergence-is-not-reaping)
- [Why the legacy path hard-deletes through raw SQL](#why-the-legacy-path-hard-deletes-through-raw-sql)
- [Why it requires the `memory` target](#why-it-requires-the-memory-target)
- [The post-condition that can see a failure](#the-post-condition-that-can-see-a-failure)
- [Why this is a *plugin* target, not a script target](#why-this-is-a-plugin-target-not-a-script-target)
- [Additive, which inverts the safety rule](#additive-which-inverts-the-safety-rule)

## The files

| File | What it is |
|---|---|
| `SKILL.md` | **The `/adr-reindex` slash command itself**, installed *into* the `ruflo-adr` plugin. Written for the **agent that executes it**: when to fire, what to run, and a decision table mapping each of the script's six failure exits to an action. Not a place for background. |
| `ruflo-adr-reindex.sh` | The rebuild. Materialized to `~/.ruflo-source-patch/adr-reindex/`, which is what the skill invokes. |
| `patcher.mjs` | Installs `SKILL.md` into every discovered copy of `ruflo-adr`. |
| `commands.mjs` | `install` / `uninstall` / `status`. Lands both artifacts, or reports INCOMPLETE. |

## Convergence is not reaping

This is the distinction the whole target rests on, and it's easy to miss:

- **`/adr-index` converges.** Native Ruflo now updates a *changed* ADR in place (status, metadata,
  relations) and stops duplicating edges; the retired `adr-index` compatibility target supplied this
  behavior on older copies.
- **It can never reap.** Delete an ADR file, or remove a `Depends-on:` line from one, and the row it
  wrote **survives every future import**. Nothing tells the importer that a row it wrote last week no
  longer has a source on disk.

Fixing [#2660](https://github.com/ruvnet/ruflo/issues/2660) does **not** give you the second. Upsert, by
construction, cannot remove a row whose source is gone.

The failure is silent in the worst possible way: **`adr-verify` certifies the rotten graph as healthy.**
An orphan row has no dangling ref and forms no cycle, so it passes every check. A clean bill of health on
an index that is lying to you.

## Why the legacy path hard-deletes through raw SQL

The older CLI had no hard delete. `memory delete` is a **soft** delete, and the tombstone still trips the
`UNIQUE` constraint on re-store ([#2652](https://github.com/ruvnet/ruflo/issues/2652)), so the row ends up
neither gone nor replaceable. `memory cleanup` only reaps stale/expired entries, which these are not.
Current Ruflo supplies `memory purge`; the raw-SQL script remains only for installations without the
complete native skill + command + shared-lock replacement.

So the only thing that actually reconciles is a drop-and-rebuild of **both** namespaces. Both, because
clearing only `adr-patterns` fixes stale statuses and leaves the duplicate edges behind. A partial
rebuild is its own trap.

## Why it requires the `memory` target

`memory.db` is written as a whole-file **read-modify-write image**. A concurrent daemon or MCP server
holding a *pre-delete* image will flush it back and **resurrect every row we just removed**
(historical [#2621](https://github.com/ruvnet/ruflo/issues/2621), focused residual
[#2878](https://github.com/ruvnet/ruflo/issues/2878)). The reconcile is the most delete-heavy
operation in the system and therefore the one most exposed to this.

On a legacy installation the `memory` target solves both halves, so this compatibility script
**depends on it rather than reimplementing a weaker copy**:

- `memory/write-lock` makes `<db>.rsp-lock` mean something. **A lock nothing else takes protects
  nothing.** It works only because the other side takes it too, and the other side only does so when
  that patch is installed.
- `memory/wal-sidecar-refusal` stops raw access while a native connection owns WAL state, without
  checkpointing or deleting its sidecars.

The legacy script takes that same lock around its `DELETE`. That is **participation** in the protocol, not
duplication of it: the CLI's lock lives inside node and cannot cover a `sqlite3` subprocess. It releases
*before* the re-import, because the patched CLI takes the lock per store and fails closed on contention.

The retirement probe separately accepts current native Ruflo only after it proves that
`ensureSchemaColumns`, temporal decay, store, get, delete, and purge all call the same native lock.
Finding one lock helper or a purge-only call is deliberately insufficient.

An earlier version warned-and-proceeded when `memory` was absent. That was wrong: it gambled the user's
index on a race the warning had just finished explaining it could not win. It now **refuses**.

## The post-condition that can see a failure

`records != 0` was the original check, and it is **blind to the exact failure this exists to prevent**.
If the delete gets clobbered, the re-import upserts cleanly *on top of the resurrected rows*, every store
reports ok, `records` is non-zero, and it exits 0 having reconciled **nothing**, orphans intact.

It now asserts **`records` == the number of ADR files**, which catches both directions: too many (the
delete didn't stick) and too few (stores are failing). Each names its likely cause.

## Why this is a *plugin* target, not a script target

`SKILL.md` lives **inside someone else's plugin**. A `/plugin update` re-fetches `ruflo-adr` wholesale and
takes our skill with it, silently. The slash command would simply stop existing, with no error and
nothing to read.

Being a plugin target means `state.json` records it, and the SessionStart hook and the monitor put it
back on legacy installations. Script targets have neither. Once the native three-part replacement
passes, the target records a terminal retirement instead.

## Additive, which inverts the safety rule

The other patchers rewrite a vendor file and keep a `.rsp-backup` to restore from. On an older
`ruflo-adr` this target **creates** a file the plugin does not ship, so there is no pristine to preserve
and nothing to re-baseline, and the hazard runs the other way:

**`uninstall` must never delete a `SKILL.md` we did not write.** If `ruflo-adr` ever ships its own
`adr-reindex`, theirs wins: we skip the install (`skip:upstream-owns-it`) and we do not remove it on
uninstall. Enforced by an ownership marker, and pinned by test **K5**, the test I would least like to be
missing.
