# `adr-reindex` — the reconcile `ruflo-adr` doesn't ship

[← ruflo-source-patch](../../README.md)

The only target that **adds** a command rather than fixing a broken one. Filed upstream as
[ruvnet/ruflo#2666](https://github.com/ruvnet/ruflo/issues/2666); if it lands, uninstall this target and
use theirs.

| File | What it is |
|---|---|
| `SKILL.md` | **The `/adr-reindex` slash command itself** — installed *into* the `ruflo-adr` plugin. Written for the **agent that executes it**: when to fire, what to run, and a decision table mapping each of the script's six failure exits to an action. Not a place for background. |
| `ruflo-adr-reindex.sh` | The rebuild. Materialized to `~/.ruflo-source-patch/adr-reindex/`, which is what the skill invokes. |
| `patcher.mjs` | Installs `SKILL.md` into every discovered copy of `ruflo-adr`. |
| `commands.mjs` | `install` / `uninstall` / `status`. Lands both artifacts, or reports INCOMPLETE. |

## Contents

- [Convergence is not reaping](#convergence-is-not-reaping)
- [Why it hard-deletes through raw SQL](#why-it-hard-deletes-through-raw-sql)
- [Why it requires the `memory` target](#why-it-requires-the-memory-target)
- [The post-condition that can see a failure](#the-post-condition-that-can-see-a-failure)
- [Why this is a *plugin* target, not a script target](#why-this-is-a-plugin-target-not-a-script-target)
- [Additive, which inverts the safety rule](#additive-which-inverts-the-safety-rule)

## Convergence is not reaping

This is the distinction the whole target rests on, and it's easy to miss:

- **`/adr-index` converges.** With the `adr-index` patch applied, re-running it updates a *changed* ADR
  in place — status, metadata, relations — and stops duplicating edges.
- **It can never reap.** Delete an ADR file, or remove a `Depends-on:` line from one, and the row it
  wrote **survives every future import**. Nothing tells the importer that a row it wrote last week no
  longer has a source on disk.

Fixing [#2660](https://github.com/ruvnet/ruflo/issues/2660) does **not** give you the second. Upsert, by
construction, cannot remove a row whose source is gone.

The failure is silent in the worst possible way: **`adr-verify` certifies the rotten graph as healthy.**
An orphan row has no dangling ref and forms no cycle, so it passes every check. A clean bill of health on
an index that is lying to you.

## Why it hard-deletes through raw SQL

The CLI has no hard delete. `memory delete` is a **soft** delete, and the tombstone still trips the
`UNIQUE` constraint on re-store ([#2652](https://github.com/ruvnet/ruflo/issues/2652)) — the row ends up
neither gone nor replaceable. `memory cleanup` only reaps stale/expired entries, which these are not.

So the only thing that actually reconciles is a drop-and-rebuild of **both** namespaces. Both, because
clearing only `adr-patterns` fixes stale statuses and leaves the duplicate edges behind — a partial
rebuild is its own trap.

## Why it requires the `memory` target

`memory.db` is written as a whole-file **read-modify-write image**. A concurrent daemon or MCP server
holding a *pre-delete* image will flush it back and **resurrect every row we just removed**
([#2621](https://github.com/ruvnet/ruflo/issues/2621)). The reconcile is the most delete-heavy operation
in the system and therefore the one most exposed to this.

The `memory` target already solves both halves, so this **depends on it rather than reimplementing a
weaker copy**:

- `memory/write-lock` makes `<db>.rsp-lock` mean something. **A lock nothing else takes protects
  nothing** — it works only because the other side takes it too, and the other side only does so when
  that patch is installed.
- `memory/wal-coherent-reads` stops any reader acting on a stale image.

The script takes that same lock around its `DELETE` — **participation** in the protocol, not duplication
of it: the CLI's lock lives inside node and cannot cover a `sqlite3` subprocess. It releases *before* the
re-import, because the patched CLI takes the lock per store and would otherwise spin out into unlocked
writes for the whole rebuild.

An earlier version warned-and-proceeded when `memory` was absent. That was wrong: it gambled the user's
index on a race the warning had just finished explaining it could not win. It now **refuses**.

## The post-condition that can see a failure

`records != 0` was the original check, and it is **blind to the exact failure this exists to prevent**:
if the delete gets clobbered, the re-import upserts cleanly *on top of the resurrected rows*, every store
reports ok, `records` is non-zero — and it exits 0 having reconciled **nothing**, orphans intact.

It now asserts **`records` == the number of ADR files**, which catches both directions: too many (the
delete didn't stick) and too few (stores are failing). Each names its likely cause.

## Why this is a *plugin* target, not a script target

`SKILL.md` lives **inside someone else's plugin**. A `/plugin update` re-fetches `ruflo-adr` wholesale and
takes our skill with it — silently. The slash command would simply stop existing, with no error and
nothing to read.

Being a plugin target means `state.json` records it, and the SessionStart hook and the monitor put it
back. Script targets have neither. (Verified: delete the skill, run one monitor tick, it returns.)

## Additive, which inverts the safety rule

The other patchers rewrite a vendor file and keep a `.rsp-backup` to restore from. This one **creates** a
file upstream does not ship — so there is no pristine to preserve and nothing to re-baseline, and the
hazard runs the other way:

**`uninstall` must never delete a `SKILL.md` we did not write.** If `ruflo-adr` ever ships its own
`adr-reindex`, theirs wins: we skip the install (`skip:upstream-owns-it`) and we do not remove it on
uninstall. Enforced by an ownership marker, and pinned by test **K5** — the test I would least like to be
missing.
