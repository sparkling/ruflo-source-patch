# ruflo-source-patch

Install with `npx github:sparkling/ruflo-source-patch` — zero dependencies, no registry required.

Local fixes for [ruflo](https://github.com/ruvnet/ruflo) / `@claude-flow/cli` (and its
`ruflo-adr` plugin) bugs that are still open upstream: folder sprawl, multiplying daemons, a
memory store that silently drops writes, and an ADR template whose own metadata format its
sibling parser can't read.

```bash
npx github:sparkling/ruflo-source-patch <target> <action>
```

The **first argument is the target**, the second the action. Every target installs and
uninstalls **on its own** — take the daemon fix without the SQLite write lock, drop one later,
keep the rest.

## Install

The package has **zero dependencies**, so it installs from anywhere with no npm registry
involved — no npmjs.org account, no local Verdaccio, nothing to stand up. Pick one:

```bash
# straight from GitHub (recommended — nothing to clone, always current)
npx github:sparkling/ruflo-source-patch cwd install

# or clone + one command for the full setup (every patch + adr-reindex + the monitor)
git clone https://github.com/sparkling/ruflo-source-patch && cd ruflo-source-patch
make install          # cwd+daemon+memory + adr-template+adr-index + adr-reindex + monitor
make uninstall        # revert everything and remove the package
```

`make install` applies every **patch** target — the three CLI ones and the `ruflo-adr` plugin ones —
plus `adr-reindex`, and schedules the monitor.

The **script targets stay opt-in**, because they change *your projects* rather than the library — but
they're the most immediately useful thing here, so don't skip past them:

```bash
npx github:sparkling/ruflo-source-patch dual install     # one instruction file for Claude Code + Codex
npx github:sparkling/ruflo-source-patch dedupe install    # delete the ~260 files `init --full` duplicates
```

See [Script targets — what they do and how to run them](#script-targets--what-they-do-and-how-to-run-them).

To pick targets individually instead:

```bash
npx github:sparkling/ruflo-source-patch cwd install
npx github:sparkling/ruflo-source-patch daemon install
npx github:sparkling/ruflo-source-patch memory install
npx github:sparkling/ruflo-source-patch monitor install   # keeps them applied

npx github:sparkling/ruflo-source-patch cwd status        # what's live?
npx github:sparkling/ruflo-source-patch memory uninstall  # drop one, keep the rest
```

Requirements: Node.js ≥ 18, Claude Code with ruflo / `@claude-flow/cli` used via `npx`.

---

## Targets

**Patch targets** — source patches to the installed `@claude-flow/cli`.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`cwd`** | `.claude-flow`/`.swarm` stop following a drifted cwd — one state dir at the project root, not one per visited subdirectory | [#2633](https://github.com/ruvnet/ruflo/issues/2633) |
| **`daemon`** | One daemon per project **root**. Dedup was keyed per-cwd, so a `daemon start` from any subdirectory forked its own daemon | [#2633](https://github.com/ruvnet/ruflo/issues/2633) · [#2407](https://github.com/ruvnet/ruflo/issues/2407) · [#2484](https://github.com/ruvnet/ruflo/issues/2484) |
| **`memory`** | `.swarm/memory.db` durability — a cross-process **write lock** (concurrent writers silently *drop* writes) and **WAL-coherent reads** (sql.js reads a stale image) | [#2621](https://github.com/ruvnet/ruflo/issues/2621) · [#2584](https://github.com/ruvnet/ruflo/issues/2584) · [#2646](https://github.com/ruvnet/ruflo/issues/2646) · [#2652](https://github.com/ruvnet/ruflo/issues/2652) |

**Plugin patches (`ruflo-adr`)** — changes to the installed `ruflo-adr` plugin, not
`@claude-flow/cli`; same shape as the patch targets above. Together they cover the whole ADR
round-trip: what `adr-create` **writes**, what `adr-index` **reads back in**, and what neither
can **reap**. Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`adr-template`** | `adr-create`'s own template writes ADR metadata as a bullet list (`- **Status**: proposed`); `adr-index`'s parser only recognises an unprefixed `**Status**:` line or YAML frontmatter, so Status/Date/Tags silently come back empty/Unknown for every ADR authored via `adr-create`'s documented template. Strips the leading `- ` from those four lines so the two skills in the same plugin agree | [#2659](https://github.com/ruvnet/ruflo/issues/2659) |
| **`adr-index`** | `adr-index` **cannot update an ADR that changed** — the one thing its own SKILL.md advertises ("Build or *rebuild* … when the graph is out of sync with the on-disk files"). Ratify an ADR, re-run it, and the graph still says `proposed`. Both namespaces are insert-only, failing in *opposite* directions: `adr-patterns` keys are deterministic → collide → the write is rejected and the record stays **frozen**; `adr-edges` keys embed `Date.now()`+random → never collide → every run **duplicates** the whole edge set (3 → 6 → 9). It reports `Records stored: 2/2` either way, because a `UNIQUE constraint` failure is counted as a success | [#2660](https://github.com/ruvnet/ruflo/issues/2660) · [#2594](https://github.com/ruvnet/ruflo/issues/2594) |
| **`adr-reindex`** | The only target that **adds** rather than fixes: upstream ships no reconcile command, so this installs a **`/adr-reindex`** skill into `ruflo-adr` (next to `/adr-create`, `/adr-index`, `/adr-review`, `/adr-verify`) plus the script it invokes. `adr-index` converges; it can never **reap** — delete an ADR file or a relation line and the orphan row survives every future import. Needs raw SQL: the CLI has no hard delete (`memory delete` is a *soft* delete whose tombstone still trips the UNIQUE constraint on re-store). **Requires the `memory` target** — it hard-deletes rows and refuses to do that without the write lock | [#2666](https://github.com/ruvnet/ruflo/issues/2666) · [#2660](https://github.com/ruvnet/ruflo/issues/2660) · [#2652](https://github.com/ruvnet/ruflo/issues/2652) |

**Plugin patches (`ruvnet-brain`)** — a different plugin, the same machinery and the same reason
to be a target: a `/plugin update` reverts a hand-edit silently.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`verify-interface`** | Its PreToolUse gate — block a rUv CLI call until you've read that command's `--help` — is a good idea that **cannot be opened**. The tool regex `($TOOLS)[@a-z0-9.-]*` absorbs `@latest` *and* any hyphenated **binary name**, so `ruflo-source-patch adr-index status` (a different tool) reads as the `ruflo` CLI and it demands `ruflo adr-index status --help` — a command that does not exist. Unanchored, it also matches inside **prose**: a `git commit` message mentioning `ruflo-adr-reindex.sh was the …` parsed as `ruflo was the`. And the documented override (`RUVNET_SKIP_INTERFACE_CHECK=1`) is read from the *hook's* environment, where a caller can never set it. Anchors the match, absorbs only a `@version`, and honours the override on the command. **The gate still blocks an unread interface** — fixed, not disabled | [stuinfla/ruvnet-brain#12](https://github.com/stuinfla/ruvnet-brain/issues/12) |

**`monitor`** — re-applies the patches when something overwrites them.
Actions: `install` · `uninstall` · `status` · `run` · `check`

## Script targets

Project *toolkits*, not patches. They fix nothing in the library; they set up and clean up **your
projects**. Nothing is patched, no hook is registered — `install` just materializes the scripts at a
stable path so you can run them.
Actions: `install` · `uninstall` · `status`

| Target | What it gives you |
|--------|-------------------|
| **`dual-codex-claude`** *(alias `dual`)* | **Start or convert** a project so Claude Code and Codex share **one** instruction file. Two scripts: build a fresh dual project, or convert an existing one. ([#2634](https://github.com/ruvnet/ruflo/issues/2634) · [#2635](https://github.com/ruvnet/ruflo/issues/2635) · [#2636](https://github.com/ruvnet/ruflo/issues/2636) · [#2637](https://github.com/ruvnet/ruflo/issues/2637) · [#2638](https://github.com/ruvnet/ruflo/issues/2638)) |
| **`dedupe-bundle`** *(alias `dedupe`)* | **Slim a bloated project.** `ruflo init --full` bundles ~260 files that ~100% duplicate the installed plugins. This deletes the duplicates and the double-firing hooks. ([#2640](https://github.com/ruvnet/ruflo/issues/2640)) |

[**What each script does, and how to run it →**](#script-targets--what-they-do-and-how-to-run-them)

---

## `cwd` — folder sprawl

`@claude-flow/cli` anchors its state to raw `process.cwd()`. Under Claude Code's
working-directory drift (sub-agents, worktrees, `cd` inside Bash steps) `cwd` is frequently a
subdirectory rather than the project root — so a fresh `.claude-flow` folder appears in every
visited directory and memory scatters across stray `.swarm/memory.db` files.

Caller-side interception can't reach every path — ruflo's own bundled plugin hooks invoke the
CLI with a drifted cwd. Patching the **callee** fixes every caller at once:

| Function | File |
|----------|------|
| `ensureDaemonRunning` | `@claude-flow/cli` · `services/daemon-autostart.js` |
| `getMemoryRoot` + config paths | `@claude-flow/cli` · `memory/memory-initializer.js` |
| `getProjectCwd` | `@claude-flow/cli-core` · `mcp-tools/types.js` |

Each resolves the nearest ancestor `.git` (worktree-safe) before using cwd.

## `daemon` — one daemon per project root

Two distinct bugs, one target.

**1. Dedup is keyed per-CWD — live in current upstream.** `commands/daemon.js` anchors its own
state (`.claude-flow/`, `daemon.pid`, and the #2484 dedup lockfile *itself*) to raw
`process.cwd()`. The lock therefore dedups against starts in the **same directory** and not at
all against starts elsewhere in the repo. Patching `daemon-autostart.js` doesn't cover it — the
CLI command does its own resolution.

Measured on **3.25.6**, which already *has* the #2484 spawn lock. 6 concurrent `daemon start`:

| | Before | After |
|---|---|---|
| all 6 from the repo **root** | 1 daemon | 1 daemon |
| 6 from 6 different **subdirs** | **6 daemons, 6 stray `.claude-flow` dirs** | **1 daemon, 1 `.claude-flow`** |

`daemon status`/`stop` from a subdirectory now find the root daemon instead of reporting "not
running". The `const cwd = process.cwd();` path-validation guard is **deliberately not patched**
— that's a security boundary, not state anchoring.

**2. Old/forked builds have no spawn lock at all.** Builds predating #2407/#2484 dedup like
this: read `daemon.pid` → not running → `killStaleDaemons` → spawn, **with no lock**. N
concurrent starts all see an empty PID file in the same instant and each fork a daemon. The
patch injects the same `O_EXCL` lockfile upstream uses, at the same path
(`<root>/.claude-flow/daemon.lock`), so a patched old build and a modern build dedup against
*each other*. Upstream ≥ 3.25 already has it, so the anchor doesn't match there and it is
safe-skipped — never double-locked.

## `memory` — `.swarm/memory.db` durability

`memory.db` is written by **two different SQLite engines**: the AgentDB bridge
(better-sqlite3, **WAL mode**) and a fallback that does a whole-file read-modify-write
(sql.js: `db.export()` → atomic rename). ruflo 3.25.2 made those flushes atomic
([#2585](https://github.com/ruvnet/ruflo/pull/2585)), closing the *torn-write* class. The two
failure modes named as follow-ups in the [#2584](https://github.com/ruvnet/ruflo/issues/2584)
close-out are still open upstream. This target patches both.

**Write lock** ([#2621](https://github.com/ruvnet/ruflo/issues/2621)). `storeEntry`, `getEntry`,
`deleteEntry`, `applyTemporalDecay` and `ensureSchemaColumns` each do a whole-file
read-modify-write, so two processes can each read image *v1* and each rename — the second
silently clobbers the first. Per-write atomicity cannot fix this; only mutual exclusion spanning
read..write can. Uses the same `O_EXCL` primitive ruflo already ships in `commands/daemon.js`.
Reentrant (`storeEntry` calls `getEntry` internally), steals stale locks (>15 s), and **never
hard-fails**: if the lock can't be taken within 5 s it proceeds unlocked, degrading to current
behaviour rather than breaking memory.

Measured — two processes × 25 concurrent `storeEntry` on one DB:

```
UNPATCHED   acked: 50/50   on disk: 25/50   SILENTLY LOST: 25   integrity_check: ok
PATCHED     acked: 50/50   on disk: 50/50   SILENTLY LOST:  0   integrity_check: ok
```

Every lost write returned `success: true`, and the database stays `integrity_check: ok` —
nothing errors, the data is simply gone.

**WAL-coherent reads.** sql.js reads the main DB file only; it cannot see frames sitting in
`-wal`. With an uncheckpointed WAL it can read a database in which the table does not even exist
(measured: `no such table: memory_entries` while 500 rows sat in a 2.3 MB WAL) and then write
that fiction back over the image. `PRAGMA wal_checkpoint(TRUNCATE)` now runs before any `*.db`
read, so the image is complete.

> Deliberately **not** done: unlinking `-wal`/`-shm` after the swap. `-shm` is SQLite's
> shared-memory *lock index* — unlinking it while another process holds a connection splits the
> two onto different lock state, manufacturing the unsynchronised writers this exists to prevent.
> After a `TRUNCATE` checkpoint the WAL is zero-length and replays nothing, so it's redundant.

**The cost, stated plainly:** `getEntry` rewrites the entire DB image just to bump
`access_count`, and it now takes the lock — so reads serialise too. On a large DB that's a real
throughput hit. Correct-and-slower beats fast-and-lossy, but the honest fix is upstream
follow-up #3 (native better-sqlite3 + WAL for the primary flush), which deletes this problem
class instead of guarding it. Don't want the trade? `memory uninstall`.

## `adr-template` — adr-create's own template breaks adr-index's parser

`ruflo-adr`'s two skills disagree with each other on ADR metadata format. `adr-create`'s own
template (`SKILL.md` step 3) writes:

```
- **Status**: proposed
- **Date**: 2026-07-13
- **Tags**: golden-corpus, ddd, microservices
```

`adr-index`'s parser (`scripts/import.mjs`) reads these fields with `^`-anchored regexes
(`/^\*\*Status\*\*:.../m`, same shape for `Date`/`Tags`) that require the field marker at the
*start* of the line — per its own doc comment, it recognises exactly two formats: "v3-style"
(an unprefixed `**Status**:` line) or YAML frontmatter. The bullet list `adr-create` itself
emits is neither, so the leading `- ` breaks the `^` anchor and `parseStatus`/`parseDate`/
`parseTags` silently return `Unknown`/`''`/`[]` for every ADR authored by following
`adr-create`'s documented template to the letter — confirmed against a real ADR
(`docs/adr/ADR-001-*.md`) produced exactly that way ([#2659](https://github.com/ruvnet/ruflo/issues/2659)).

**Fix:** strip the leading `- ` from those four template lines, so `adr-create`'s own output
matches the "v3-style" format `adr-index` — its sibling skill in the SAME plugin — already
parses. One plugin, one format; both skills agree once patched.

Unlike `cwd`/`daemon`/`memory`, this patches an installed **Claude Code plugin** (`ruflo-adr`'s
`adr-create/SKILL.md`), not `@claude-flow/cli` — scoped to the **upstream `ruflo` marketplace
only** (`~/.claude/plugins/cache/ruflo/ruflo-adr/*/skills/adr-create/SKILL.md` and
`~/.claude/plugins/marketplaces/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md`), same
pristine-backup + atomic-write discipline as the JS patches above — and, like them, re-applied by
the SessionStart hook and the `monitor` (see below).

## `adr-index` — the index can't be updated, only created

`adr-template` fixes what `adr-create` **writes**. This fixes what `adr-index` **reads back in** —
and it is the more consequential half, because it breaks the ADR lifecycle itself.

An ADR's life *is* mutation: `proposed` → `accepted` → `superseded`, a new `Amends:`, a corrected
date. `adr-index` cannot reflect any of it. Ratify an ADR, re-run the indexer, and the graph still
says `proposed` — while printing `Records stored: 1/1`.

Both namespaces are insert-only, and that single choice fails in **opposite directions** depending
on whether the key is deterministic:

| Namespace | Key | Re-run | Failure |
|---|---|---|---|
| `adr-patterns` | `ADR-001::<basename>` — deterministic | collides → INSERT rejected | **frozen** at the first value ever indexed |
| `adr-edges` | `<rel>:<from>-><to>:${Date.now()}-${rand}` | never collides | **duplicates** — 3 → 6 → 9 edges, one set per run |

Measured on a 2-ADR repo with nothing changed on disk between runs. Duplicate edges silently weight
an ADR by *how many times someone ran the indexer*, and `verify` reports the inflated graph as
healthy — every duplicate is individually valid.

The failure is invisible because a `UNIQUE constraint` failure (exit **1**) is mapped to an
`'exists'` sentinel and then **counted as a stored record**, so `errors` stays empty and the summary
reports full success.

Three edits fix it: pass `--upsert`, stop counting `'exists'` as stored, and make the edge key
deterministic (`<rel>:<from>-><to>` — `capturedAt` already lives in the value, where identity has no
business).

> **The `--upsert` twist ([#2594](https://github.com/ruvnet/ruflo/issues/2594)).** `memory store --help`
> advertises `-u, --upsert  [default: true]`. That default is **declared but not honored** — storing
> to an existing key without the flag exits 1 with `UNIQUE constraint failed` and writes nothing;
> pass it explicitly and it works. So the flag is passed explicitly here, and must be: trusting the
> documented default silently gets you a strict insert. Worth keeping even after #2594 lands.

Two copies get patched and they are **not identical** — the marketplace checkout carries local #2474
fixes and passes args as `` `--key=${key}` `` (npm rejects an argv token starting with a U+2014
em-dash, which ADR titles contain). Each edit therefore carries *variants* plus a `done()` predicate
that reports whether the fix is present independently of which anchor produced it. That is what makes
a **partial** patch visible: matching on anchor-absence alone would call a file "patched" when an
anchor simply never existed — which is exactly how a missing `--upsert` could pass green while
leaving the bug fully intact. `install` prints `INCOMPLETE` and `status` names the missing edits.

**What it does not fix: deletions — but it now tells you.** With upsert and deterministic keys a
re-import *converges*: status, metadata and changed relations all land. What it can never do is
**reap**. A removed ADR file, or a deleted `Depends-on:` line, leaves an orphan row that no future
import touches — the index goes on asserting a decision that no longer exists on disk.

Reaping needs a rebuild (`adr-reindex`). The importer can't do it, but it can *say so*, which is the
part that actually matters — an orphan you're told about is a chore; an orphan you're not told about
is a graph quietly rotting:

```
### Issues found
- ORPHANS: 0 record(s) + 1 edge(s) in the index have no source on disk
  (an ADR file or a relation line was deleted; an import can add and update, but never reap)
  reconcile with a rebuild:  ~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh
```

The count is **exact, not a heuristic.** The CLI can't enumerate keys (`memory list` truncates them
and caps at `--limit`, with no `--json`), so a key-by-key diff is impossible — but the *total* is
reported and excludes soft-deleted rows. Every desired record is written before we look, so the
namespace then holds exactly `desired ∪ orphans`, making `count − desired` the precise orphan count.
It even catches a same-size swap: delete ADR-003 and add ADR-004 in one go, and the index lands at 4
against a desired 3.

(The tempting alternative — have the importer keep a manifest of what it wrote, and prune the
difference — was rejected. It trades a stateless one-second rebuild for persistent state that can
drift, a new "manifest is wrong" failure mode, and a much larger patch surface. The files are the
truth; nothing else should have to be.)

## `adr-reindex` — reconcile the graph to the files

The ADR files are the source of truth; `adr-patterns` / `adr-edges` are a derived cache. For a derived
cache the correct reconcile is a **rebuild**, and at ADR scale it's instant.

```bash
npx github:sparkling/ruflo-source-patch memory install       # REQUIRED — see below
npx github:sparkling/ruflo-source-patch adr-reindex install
~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh [project-dir] [--dry-run]
```

Drop both namespaces, re-import, verify. You don't have to remember when: the patched importer
**prints an `ORPHANS:` line** the moment the index holds a row with no source on disk, and points you
here. Reach for it after **deleting** an ADR or a relation line (the one case upsert can't reap),
after installing the `adr-index` patch for the first time (rows written under the old random-key
scheme are unreachable orphans, and show up as exactly that), or any time you want certainty. For an
ordinary edit, the patched importer handles it — just run `/adr-index`.

### It **requires** the `memory` target

Not a suggestion — `adr-reindex install` refuses without it, and so does the script. This is the one
operation in the whole package whose entire job is to **delete rows**, and ruflo writes `memory.db` as
a whole-file read-modify-write image: a daemon or MCP server holding a *pre-delete* image flushes it
back and resurrects everything you just removed. That is [#2621](https://github.com/ruvnet/ruflo/issues/2621),
aimed squarely at the reconcile itself.

The `memory` target already solves both halves, so this **depends on it rather than reimplementing a
weaker copy** — `memory/write-lock` makes `<db>.rsp-lock` mean something (a lock nothing else takes
protects nothing), and `memory/wal-coherent-reads` stops any reader acting on a stale image. The script
takes that same lock around its `DELETE`, which is *participation* in the protocol, not duplication of
it: the CLI's lock lives inside node and can't cover a `sqlite3` subprocess. It releases before the
re-import, because the patched CLI takes the same lock per store and would otherwise spin out into
unlocked writes for the whole rebuild.

An earlier version carried its own `PRAGMA wal_checkpoint` as "belt-and-braces" and *warned* instead of
refusing when `memory` was absent. Both were wrong: the checkpoint duplicated `memory/wal-coherent-reads`
with worse guarantees, and warning-then-deleting gambles your index on a race the warning has just
finished explaining it cannot win.

### Three things it has to get right, each learned the hard way

- **Both namespaces, together.** Clearing only `adr-patterns` fixes stale statuses and leaves the
  duplicate edges behind. A partial rebuild is its own trap.
- **Run from the project root.** `import.mjs` takes `ADR_ROOT` to find the ADR *files*, but the CLI it
  shells out to resolves *which `memory.db` to write* from its **cwd**. Invoked from anywhere else it
  reads the right ADRs and writes them to the wrong database — after this script has already emptied
  the real one. This is what an early version did, and it is what an empty index looks like.
- **A post-condition that can see a reconcile that didn't happen.** It used to check `records != 0`,
  which is blind to the exact failure it exists to prevent: if the delete is clobbered, the re-import
  upserts *cleanly on top of the resurrected rows*, every store reports ok, `records` is nonzero — and
  the script exits 0 having reconciled nothing, orphans intact. It now asserts **`records` == the
  number of ADR files**, which catches both directions: too many (the delete didn't stick) and too few
  (stores are failing). It names the likely cause of each.

Because the delete precedes the rebuild, a failed rebuild would leave an **empty** graph — which
`verify` then certifies as healthy (0 records, 0 dangling refs, 0 cycles is a clean bill of health on
nothing). The ADR files are never touched; re-running is always safe.

## Script targets — what they do and how to run them

Everything else in this package fixes **the library**. These fix **your projects** — and they're the
part people miss, because they're not patches and nothing re-applies them. `install` materializes the
scripts; you run them by hand, on a project, when you want them.

```bash
npx github:sparkling/ruflo-source-patch dual install      # or: dual-codex-claude
npx github:sparkling/ruflo-source-patch dedupe install     # or: dedupe-bundle
```

They land in `~/.ruflo-source-patch/<target>/` and stay there. `status` byte-compares them against the
packaged versions, so an upgraded package with a stale materialized script says **`STALE`** rather than
`installed`.

---

### `dual` — one instruction file, two agents

`ruflo init` writes `CLAUDE.md`. `codex init` writes `AGENTS.md`. They **diverge immediately**, and
keeping them in sync by hand is a losing game ([#2638](https://github.com/ruvnet/ruflo/issues/2638),
[#2636](https://github.com/ruvnet/ruflo/issues/2636)).

The model here is **one canonical file, no symlinks, no duplication**:

- **`AGENTS.md`** — the single source of truth. Codex reads it directly.
- **`CLAUDE.md`** — literally `@AGENTS.md` (Claude Code imports it) plus a short Claude-only overlay.

Edit the shared bulk **once**, in `AGENTS.md`; both platforms see it. Each platform's unique bits live
only in the file that platform reads. Nothing to keep in sync, so nothing drifts.

**Two scripts, depending on where you're starting:**

```bash
# a NEW dual project, from scratch
~/.ruflo-source-patch/dual/ruflo-new-dual.sh <project-dir> [--no-start-all] [--template <t>] [--force]

# convert an EXISTING ruflo/Claude Code project
~/.ruflo-source-patch/dual/ruflo-add-codex.sh [project-dir] [--template <t>] [--force]
```

`ruflo-new-dual.sh` runs `ruflo init` with the **default** preset, deliberately — not `--full`, which
bundles the ~260 duplicate files that `dedupe` exists to remove. It also uses `npx --yes` so a missing
`@claude-flow/codex` doesn't abort the whole init ([#2635](https://github.com/ruvnet/ruflo/issues/2635)),
and it gitignores the root `.env` that `ruflo init` leaves **tracked**
([#2637](https://github.com/ruvnet/ruflo/issues/2637)).

---

### `dedupe` — delete what the plugins already give you

`ruflo init --full` bundles roughly **260** skill/command/agent files into `.claude/`. Of those, ~**100%**
of the agents and commands, and ~**97%** of the skills, are *already provided* by the installed `ruflo/*`
plugins ([#2640](https://github.com/ruvnet/ruflo/issues/2640)). The project's `settings.json` also
registers lifecycle hooks that duplicate the plugin hooks — so `post-edit` and `session-end` **fire
twice**.

```bash
~/.ruflo-source-patch/dedupe-bundle/ruflo-dedupe-bundle.sh <project-dir> [--strip-dup-hooks] [--dry-run]
```

**Start with `--dry-run`.** It prints exactly what it would remove and touches nothing.

It is conservative by construction: an item is removed **only when a plugin actually provides it**, so
anything project-unique is kept. Everything it removes is backed up first. `--strip-dup-hooks` is opt-in
because that one edits your `settings.json`.

## `verify-interface` — a gate that cannot be opened

`ruvnet-brain` ships a PreToolUse hook that blocks a Bash command naming a rUv CLI until you have read
that command's `--help`. **The idea is sound and this target does not disable it** — it exists because
someone once called `ruflo memory search "query"` positionally, got nothing back, and declared AgentDB
broken three times over. Keep the gate. It simply cannot be *opened*.

**1. It fires on things that are not the tool.**

```bash
MATCH_RE="($TOOLS)[@a-z0-9.-]*[[:space:]]+([a-z][a-z-]*)…"
```

The character class exists to absorb `@latest`. It also absorbs a hyphenated **binary name** — so
`ruflo-source-patch adr-index status`, an entirely different tool with its own CLI, is read as the
`ruflo` CLI, and the gate demands you first run `ruflo adr-index status --help`. That command does not
exist; `ruflo` has no `adr-index` subcommand. It asks for something impossible, then blocks until you
provide it.

There is no command-position anchor either, so the regex is applied to the **whole command string,
quoted text included**. A `git commit` whose message contained the sentence *"…the installed
`ruflo-adr-reindex.sh` **was the** pre-71be214 copy"* matched as `ruflo … was the`, and the gate
demanded the help output for a command called **`was the`**. Ordinary English prose is enough.

**2. The documented override cannot work.** The block message ends:

> *(Deliberate override, say why out loud: `RUVNET_SKIP_INTERFACE_CHECK=1`)*

But the check reads that variable from the **hook's own environment** — and a PreToolUse hook is handed
the proposed command as JSON on stdin and **never executes it**. Setting the variable on the command,
which is precisely what the message instructs, cannot reach the hook. The one documented escape hatch is
unreachable from the only side that is told to use it.

Together: a false-positive match with no working override. In one session it blocked **five** unrelated
commands — including a `git commit` — in a repo whose name begins `ruflo-`. There is no way round it
except to not name the tool.

The patch absorbs only a `@version`, anchors the tool to command position, and honours the override where
the message says to write it. The regex necessarily gains capture groups (bash ERE has no non-capturing
`(?:…)`), so its `BASH_REMATCH` readers move with it — **five edits, each with its own `done()`
predicate**, because a *partial* apply here is worse than none: land the regex without its readers and the
gate blocks on garbage.

Tested **behaviourally, not textually** — asserting "the regex string changed" would pass on a patch that
broke the gate outright. The suite proves the unpatched fixture really does block (else everything below
is vacuous), that all three commands which actually blocked us now pass, that the override finally works,
and — the one that matters — **that an unread interface still blocks.**

When upstream fixes [#12](https://github.com/stuinfla/ruvnet-brain/issues/12), the anchors stop matching
and `apply()` reports `skip:no-anchor-matched`, naming #12 as the likely reason. Then uninstall the
target. It never guesses.

## `monitor` — keep the patches applied

```bash
npx github:sparkling/ruflo-source-patch monitor install     # every 5 min (RSP_MONITOR_INTERVAL=secs)
npx github:sparkling/ruflo-source-patch monitor status      # scheduled? drifting? last repair?
npx github:sparkling/ruflo-source-patch monitor check       # dry-run; exit 1 on drift
```

The `SessionStart` hook only fires when a session **starts**. But `npx -y ruflo@latest` fetches a
**new** cache directory the moment a version changes, and a `ruflo update` can land mid-session —
so a fresh, unpatched copy can run for hours until you restart Claude Code. The monitor closes
that window.

**It covers the plugin patches too** (`adr-template`, `adr-index`), not just the CLI targets. A
`/plugin update` fetches a fresh `ruflo-adr` and drops those patches — and an unpatched `adr-index`
doesn't fail loudly, it simply goes back to reporting `Records stored: N/N` while writing nothing,
so the ADR index rots with no signal at all. Leaving the fix for silent staleness vulnerable to
silent removal would be self-defeating. Both the hook and the monitor re-apply everything recorded
in `state.json` — `patchTargets` (CLI) and `pluginTargets` (plugin) alike:

```
2026-07-13T18:38:05.742Z REPAIRED 1 plugin file(s) [adr-template,adr-index] — adr-index: patched …/scripts/import.mjs (4/4 edits)
```

**It keeps *itself* current, too — and this was the sharpest bug in the package.**
`~/.ruflo-source-patch/lib` is not a cache, it's the **executable**: the hook and the scheduled job
both run modules from *there*, never from the npm package. But only an `install` action ever wrote it.
So `npm i -g …@next` — a version that adds an entry for an anchor upstream re-worded — changed
**nothing** about what the hook and the monitor actually did. They kept applying the old entry set,
forever, and every reporting surface was *also* the old code, so it was silent. The package upgraded
and nothing it does upgraded with it. Found live at nine modules behind.

The invariant is **provenance**, not location: the stable copy must match *the source it was synced
from*, recorded at sync time. (Diffing against the globally-installed package is the obvious answer
and it's wrong — develop from a clone and the global is *older*, so the CLI would sync your clone in
and the monitor would dutifully heal it **backward** to the stale release, the two writers fighting
each other on a timer. The fuzz suite caught exactly that.) The monitor now self-heals on its own
tick, any mutating command refreshes it, and `monitor status` / `monitor check` **report** it rather
than repairing it out from under the question:

```
[monitor] STALE LIB: 9 module(s) behind the installed package — the hook and monitor are running OLD code
```

**It is not a daemon.** This project exists partly *because* ruflo daemons multiply; shipping
another resident watcher would be poor taste. The OS scheduler runs a short-lived check instead
(**launchd** on macOS, **cron** on Linux) which re-applies the installed target set and exits.

There's no drift heuristic and no timestamp comparison: it recomputes what each file *should* be
and compares bytes. Files are written **only when the bytes differ**, so a steady-state tick is a
few `stat`s and no I/O. It logs only when it *repairs* something:

```
2026-07-13T10:38:04.222Z REPAIRED 1 file(s) [cwd,daemon,memory] — patched daemon.js <- daemon/command-root
```

`monitor check` exits **1** on drift, so it doubles as a CI or pre-flight gate. It also surfaces
**uncovered builds**: patch discovery is package-name-driven, so a ruflo CLI published under a
name we don't list gets *zero* protection, silently — which is how 38 daemons piled up on one cwd
from a differently-named build while `daemon status --all` reported "6 daemons, all within TTL".

---

## How you find out when a patch stops working

A patch that silently stops applying, while `status` still says *installed*, is the exact failure
this project exists to prevent. It must not be how the project itself fails — so nothing is allowed
to end its life in a log file.

### Anchors are literal, and they will break

Edits are exact string find/replace — no line numbers, no regex, no `sed`. That's deliberate: an
anchor that no longer matches is **skipped**, never guessed at. Each edit also carries alternative
anchors and a `done()` predicate that asks *"is the fix present?"* rather than *"is the anchor
absent?"* — because an anchor can be absent for two very different reasons, and only one of them
means success. (That distinction is not theoretical: it caught a copy taking 3 of 4 edits and
reporting it as fine.)

So when upstream reindents or renames, the patch degrades **loudly**:

```
adr-index: INCOMPLETE …/scripts/import.mjs — applied: upsert, edge-key;
           NOT APPLIED: records-miscount (upstream shape changed?)
```

### Two hooks, and the honest reason for each

| Hook | When | Job |
|---|---|---|
| `SessionStart` | session start | re-apply every installed target, and report anything broken |
| `UserPromptSubmit` | every prompt | **report only** — reads one small file, usually absent (~28ms) |

The second exists because the first is too late. A new ruflo can land in the npx cache **while you
work** — which is precisely how 3.26.1 arrived and silently disabled `cwd/daemon-autostart` — and a
session-start-only warning would sit quiet for hours. The monitor detects it within one tick, but a
detached scheduled job can't reach your session; it can only leave a note. It now leaves that note
in `problems.json`, and the prompt hook reads it:

```
monitor tick (≤5 min)   →  writes ~/.ruflo-source-patch/problems.json
UserPromptSubmit hook   →  surfaces it on the very next thing you type
```

Worst case between *"patch broke"* and *"you know"* is **one tick plus one keystroke**, not one
session. It's rate-limited (an unchanged problem re-announces at most every 30 min; a new one at
once) and it **clears itself** when fixed — a stale warning is as bad as no warning.

### Watching the watchman

Every warning above is delivered by the monitor. So if the **monitor** is dead, the system goes
quiet — and quiet is exactly what healthy looks like. That's the one failure a watchdog can never
report on itself, and it voids every guarantee on this page.

The prompt hook therefore checks the monitor's own liveness, from a heartbeat plus two path checks
(no subprocess — `installMonitor` records what it scheduled in `monitor.json`, so verification costs
an `existsSync` and one `mtime`):

- **its node interpreter is gone** — version managers pin an absolute path, so a node upgrade deletes
  the interpreter out from under the job while launchd still reports it as scheduled;
- **its job script is missing** — the schedule points at a file we've since moved;
- **it simply isn't running** — no tick in hours: an unloaded launchd job, a removed crontab line,
  permissions, a crash loop.

A user who never installed a monitor is never nagged about not having one. The staleness threshold is
deliberately generous (6 intervals, 30-min floor): a laptop that slept through six ticks is not a
broken monitor, and a false alarm trains you to ignore a true one.

### It found two real bugs on its first run

Not a hypothetical, so it is worth stating plainly what it caught within minutes of existing.

**The patcher could destroy the file it was patching.** Found `daemon-autostart.js` at **0 bytes** in
two npx caches — no backup, mtime matching a monitor tick, while the published tarball has 4,553
bytes.

The lethal path is an **empty `.rsp-backup`**. Everything is rebuilt from pristine, so an empty
pristine means: no anchor matches → the "nothing applies, restore the original" branch runs →
`writeIfChanged(file, '')` → **the real file is truncated to zero and its backup deleted.** Measured:
a healthy 3,954-byte vendor file reduced to 0 by *one* monitor tick. It is now pinned as a regression
test (`R1a`), and verified to fail without the guard.

Guarding only the *on-disk file* misses this completely — with an empty backup, a perfectly healthy
file is what gets destroyed. So both patchers now reject an empty backup outright (discard it; if the
file is already patched, refuse to guess at a pristine and say so) **and** refuse to touch a
zero-byte target.

Honest limit: the destruction path is proven and closed, but *how* those backups came to be empty is
not fully reconstructable after the fact — a torn read of a file `npx` had created but not yet
written is the likeliest origin, and is guarded, but I can't prove that's what happened. A patcher
that eats the code it patches is worse than the bug it fixes, so both doors are shut regardless.

**`cwd/daemon-autostart` had silently stopped applying on 3.26.x.** Its anchor was the
`if (autostartDisabled())` line plus its exact reason string, and 3.26.0 changed both — so #2633
folder sprawl was quietly back on the version `npx` resolves as *latest*, with `cwd` reporting a
contented 13/15. Re-anchored on the function head of `ensureDaemonRunning()`, which is stable across
3.25.1 / 3.26.0 / 3.26.1 and is also *more* correct: 3.26 reads a project-local
`claude-flow.config.json` inside `autostartDisabled(projectRoot)`, so the root has to be resolved
**before** that check, not one line after it.

---

## `cleanup` — de-sprawl a project

Removes a single project's daemon and folder sprawl — the mess that accumulated *before* the
`cwd`/`daemon` patches were applied (they prevent new sprawl; this clears the old).
([#2633](https://github.com/ruvnet/ruflo/issues/2633))

```bash
npx github:sparkling/ruflo-source-patch cleanup [dir]              # default: cwd
npx github:sparkling/ruflo-source-patch cleanup [dir] --dry-run    # preview, change nothing
npx github:sparkling/ruflo-source-patch cleanup [dir] --all-daemons  # also kill the root daemon
```

Scoped strictly to the project root (nearest ancestor `.git`):

- **stray state dirs** — removes any `.claude-flow` / `.swarm` in a *subdirectory*. The root's
  own are kept; they're the project's real state.
- **daemons** — keeps one daemon anchored at the exact root (the legit one) and kills every
  other daemon whose cwd is inside the project tree: subdirectory-anchored strays and root
  duplicates. `--all-daemons` kills the root one too (it respawns on next use).

**Hard safety:** a process is killed only if its resolved cwd is the project root or beneath it
— a daemon belonging to any other project is never touched, even by name. It also refuses to run
against `$HOME` or `/`. (This is not idle caution: an earlier ad-hoc cleanup on this machine, with
looser scoping, nearly killed unrelated sessions' daemons.)

---

## How it works

Each library file is rebuilt from a **pristine backup** on every apply:

```
pristine (.rsp-backup)  →  prelude(fragments the active targets need)  →  edits
```

That's what makes independent install/uninstall possible. `memory-initializer.js` is patched by
**two** targets — `cwd` (`getMemoryRoot`, config paths) and `memory` (the write lock) — so
uninstalling one must un-apply *its* edits and leave the other's intact. Rebuilding from pristine
means the file is always exactly *pristine + the entries currently requested*: correct for any
subset, idempotent by construction.

Injected code is composed from **fragments with dependencies** (`req` → `resolveRoot` /
`walCheckpoint` / `memLock` / `daemonLock`), each emitted at most once. The shared `req` base
matters: installing `memory` *without* `cwd` would otherwise inject a lock referencing an
undeclared `__rufloReq`.

`~/.ruflo-source-patch/state.json` records which targets are installed — `patchTargets` (CLI) and
`pluginTargets` (`ruflo-adr`). The `SessionStart` hook and the monitor both read it and re-apply
exactly that set, never a target you uninstalled.

**A backup is not pristine forever.** Rebuilding from `.rsp-backup` is only correct while the vendor
file is the one we backed up. When upstream rewrites it **in place** — a `/plugin update`, or an
`npm update -g` on a global CLI install, both of which land at a *fixed* path rather than a fresh
versioned one — treating a stale backup as truth means writing old code over the new file, and the
monitor would do it every five minutes: a watchdog turned into a downgrade machine.

So a file on disk is read as exactly one of three states: **ours** (already patched — nothing to do),
**the backup** (pristine — apply), or **neither** — which means upstream replaced it, so its bytes
become the new pristine and the patches are re-derived on top. Reality outranks our snapshot, always.
If the new file no longer matches the anchors, you get `INCOMPLETE` rather than a lie, and a
`REBASELINE` line in the monitor log — which is your cue to check whether the anchors still hold.

### One install, every repo

You install this **once per machine**, not per project. `npx ruflo` doesn't put a copy of
`@claude-flow/cli` in each repo — every repo runs the *same* binary out of the shared npx cache
(`~/.npm/_npx/`), plus any global `npm i -g` install. That shared binary is what gets patched, so
there's one `state.json`, one pair of hooks (`SessionStart` to re-apply, `UserPromptSubmit` to warn),
and one monitor job covering all of them.

The patch is global, but its **behaviour is per-repo**, decided at call time: the injected code
calls `__rufloResolveRoot(process.cwd())` on every invocation, so the same binary run from repo A
resolves A's project root and locks A's `.swarm/memory.db`, while run from repo B it resolves B's.
One patch, per-repo effect — which is why the data each repo stores (`.swarm/`, `.claude-flow/`,
the daemon PID and locks) stays cleanly separated even though the code fixing it is shared.

That's also why the monitor is a single machine-wide job: it has nothing per-repo to track. Its
only job is "keep the shared binary patched," so when *any* repo pulls a new `ruflo` version into
a fresh cache dir, one tick re-patches it and every repo is covered again.

**Safety.** Writes are atomic (temp → `fsync` → rename), because the monitor rewrites these files
while Claude Code sessions are importing them. Backups are the untouched vendor files, so a full
uninstall restores **byte-identical** originals. Version drift is safe-failed **per entry**: an
anchor that no longer matches is skipped individually — never a partial write, never blocking its
neighbours.

## Tested

`npm test` runs a property fuzzer: 60 random sequences × 8 steps over
`{cwd, daemon, memory} × {install, uninstall, status}`, with a monitor tick after **every** step,
asserting after every step:

| | Invariant |
|---|---|
| **I1** | an entry is applied ⟺ its target is installed — checked **per entry**, so it catches a target missing from a file *shared* with another target |
| **I2** | every patched file still parses as valid ESM |
| **I3** | empty state ⇒ every file byte-identical to pristine, no backups left |
| **I4** | no stray temp files, ever |
| **I5** | `monitor check`'s exit code matches actual drift |
| **I6** | installing twice is a no-op the second time |
| **I7** | no vendor file is **ever** truncated to zero bytes |

Plus deterministic regressions for the two bugs that actually shipped — random sequences never
generate either, because both need the **vendor file to change underneath us**, which no sequence of
our own commands can do:

| | Regression |
|---|---|
| **R1a** | an empty `.rsp-backup` never destroys the real file *(without the guard: 3954 → 0 bytes)* |
| **R1b** | a zero-byte target is never patched, and never adopted as pristine |
| **R1c** | **`uninstall`** never destroys the file from an empty backup *(without the guard: 3954 → 0)* |
| **R2** | an in-place vendor update is **re-baselined**, not reverted to a stale backup *(without the guard: "CLOBBERED an upstream update")* |

A second suite covers the **plugin patches, the notifier, and the monitor's own liveness** — 30
sequences × 6 steps over `{adr-template, adr-index} × {install, uninstall, status}`, plus:

| | |
|---|---|
| **P1–P5** | applied ⟺ installed · pristine restore · still parses · never truncated · idempotent |
| **R3** | an in-place `/plugin update` is re-baselined, not reverted *(without the guard: "CLOBBERED")* |
| **R4** | an empty backup never destroys the plugin file — on **`monitor run` and `uninstall`** *(without the guard: 13337 → 0)* |
| **R5** | a broken anchor is reported as `INCOMPLETE` and **names the edit that failed** — never silently skipped |
| **N1–N4** | the notifier: silent when healthy · announces the break · rate-limits · self-clears when fixed |
| **H1–H4** | monitor liveness: silent when no monitor installed · stale heartbeat · dead interpreter · missing script |

A third suite covers **every path where a failure could be mistaken for success** — which, for a
package that is almost entirely notification paths, is the only thing that matters. It exists because
the other two stayed green through a round of fixes they were green *before*: they pinned the old
invariants, and an untested notification path rots without anyone noticing.

| | |
|---|---|
| **S1–S9** | the **stable copy** — the code the hook and the monitor actually *run*. Provenance recorded · the mirror is complete · a stale module **fails `monitor check`** · is named in `status` · a mutating command heals it · **the monitor heals itself with no CLI invocation** (the case that bites: nobody re-runs `install` after `npm i -g`) · modules the package no longer ships are reaped · modules it *does* ship survive the reap · **non-`.mjs` assets reach the copy too** (the mirror once dropped `skill.md`, so the monitor threw `ENOENT` every tick — caught in the wild by the notifier, one prompt after it shipped) |
| **E1–E3** | the **error path** — a patch that **throws** (EACCES on a global npm root, a read-only fs) is counted and summarised, exits nonzero, and matches the shared problem predicate so the notifier will say it. Before: logged, counted nowhere, matched by none of *three divergent* regexes, and summarised as `nothing to do` |
| **R1–R6** | **`adr-reindex`** — the `memory` prerequisite is enforced at install *and* by the script, which **refuses and deletes nothing** · a real rebuild reaps an orphan · and the post-condition catches a rebuild that reconciled **nothing**, in both directions (a clobbered delete, and silently failing stores) |
| **K1–K5** | the **`/adr-reindex` skill** — skill and script both land, or the install reports INCOMPLETE · it **survives a `/plugin update`** (the reason it is a plugin target, not a script one) · uninstall removes ours · and **never** deletes a skill upstream owns |
| **H5–H8** | **legacy hooks** — our own *unmarked* hooks are reaped (install and uninstall could both see straight past them, so they outlived `uninstall` itself) · a **foreign** hook on the same event is untouched · exactly one of ours survives, and it is the current one |
| **V1–V6** | **`verify-interface`** — behavioural, not textual. The unpatched fixture really does block (else all of this is vacuous — and V1 caught exactly that on its first run) · all three commands that wrongly blocked us now pass · the documented override finally works · **an unread interface still blocks** · uninstall restores the vendor bytes byte-for-byte |

**Every regression is mutation-tested**: the guard is removed and the test confirmed to fail. That
discipline earned its keep repeatedly — it caught two tests being *vacuous* (passing with the guard
deleted, therefore proving nothing), and fixing them exposed a live bug: `restore()` bypassed every
guard, so a poisoned backup made **`uninstall` the most destructive command in the tool**.

It paid again on the third suite. Writing **S3** exposed that `monitor check` **synced the stable copy
on its way to checking it** — healing the drift before looking for it, so the gate could only ever
report `none`. A check that cannot fail. Read-only actions now observe; mutating actions repair. A
test that cannot fail is worth nothing, and you only ever find out by making it fail on purpose.

## Upstream issues

Every target here is a local workaround for an **open** (or closed-but-with-open-follow-ups) upstream
issue — almost all in `ruvnet/ruflo`, and one in `stuinfla/ruvnet-brain`. Most we filed ourselves while
building this tool; one we contributed a reproduction and fix to. The tool doesn't *fix* upstream — it
works around these locally until they land, and reports `skip:no-anchor-matched` (loudly) when a fix
does land and the anchors stop matching.

**One target adds rather than fixes:** `adr-reindex` installs a `/adr-reindex` command that `ruflo-adr`
does not ship. That gap is now filed as [#2666](https://github.com/ruvnet/ruflo/issues/2666) — the plugin
can *add* an ADR to the index and (once #2660 lands) *update* one, but it has no way to **remove** one, and
`adr-verify` then certifies the orphaned graph as healthy.

**Filed by us:**

| Issue | What's wrong upstream | Worked around by |
|-------|-----------------------|------------------|
| [#2666](https://github.com/ruvnet/ruflo/issues/2666) | `ruflo-adr` has **no way to reconcile a deleted ADR** — the orphan row survives every import, and `adr-verify` certifies it as healthy (an orphan has no dangling ref and forms no cycle). Upsert converges; it can never reap | `adr-reindex` |
| [ruvnet-brain#12](https://github.com/stuinfla/ruvnet-brain/issues/12) | `verify-interface.sh`'s PreToolUse gate is **unopenable**: its tool regex swallows any hyphenated binary name (`ruflo-source-patch …` → `ruflo …`) and matches inside plain English prose, while the documented `RUVNET_SKIP_INTERFACE_CHECK=1` override is read from the hook's own environment, where a caller can never set it | `verify-interface` |
| [#2633](https://github.com/ruvnet/ruflo/issues/2633) | Unbounded daemon proliferation — `.claude-flow`/`.swarm` state and the daemon dedup lock anchored to raw `process.cwd()` | `cwd`, `daemon`, `cleanup` |
| [#2640](https://github.com/ruvnet/ruflo/issues/2640) | `ruflo init` bundle duplicates plugin-provided skills/commands/agents (100% / 97% overlap) | `dedupe-bundle` |
| [#2638](https://github.com/ruvnet/ruflo/issues/2638) | `ruflo init` (CLAUDE.md) and `codex init` (AGENTS.md) generate divergent instruction files | `dual-codex-claude` |
| [#2637](https://github.com/ruvnet/ruflo/issues/2637) | `ruflo init` gitignores only a nested `.claude-flow/.gitignore`; root `.env` is left tracked | `dual-codex-claude` (its `.gitignore` step) |
| [#2636](https://github.com/ruvnet/ruflo/issues/2636) | `ruflo init --dual` produces a Codex-primary layout (thin CLAUDE.md stub) | `dual-codex-claude` |
| [#2635](https://github.com/ruvnet/ruflo/issues/2635) | `ruflo init --dual/--codex` aborts the whole init when `@claude-flow/codex` isn't installed | `dual-codex-claude` (uses `npx --yes`) |
| [#2634](https://github.com/ruvnet/ruflo/issues/2634) | `codex init --template full` generates ~100 placeholder stub skills | `dual-codex-claude` (default template only) |
| [#2659](https://github.com/ruvnet/ruflo/issues/2659) | `ruflo-adr`'s own `adr-create` template writes bullet-list metadata that `adr-index`'s parser can't read (Status/Date/Tags silently come back empty/Unknown) | `adr-template` |
| [#2660](https://github.com/ruvnet/ruflo/issues/2660) | `adr-index` **cannot update a changed ADR** — the one thing its own SKILL.md advertises. Both namespaces are insert-only: deterministic keys collide so records stay **frozen**; random edge keys never collide so edges **duplicate** every run (3 → 6 → 9). A `UNIQUE` failure (exit 1) is counted as a stored record, so both are reported as success | `adr-index`, `adr-reindex` |

**Contributed a reproduction + fix (filed by someone else):**

| Issue | What's wrong upstream | Worked around by |
|-------|-----------------------|------------------|
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) | daemon ↔ MCP last-writer-wins **silently drops writes** — we posted a 30-line repro and the lock implementation | `memory` write lock |
| [#2594](https://github.com/ruvnet/ruflo/issues/2594) | `memory store --help` advertises `-u, --upsert [default: true]`, but that default is **declared and not honored** — an unpassed flag still does a strict INSERT (exit 1, `UNIQUE constraint failed`, no write). We measured it and posted the finding; it is the root cause of #2660 | `adr-index` (passes `--upsert` explicitly rather than trusting the documented default) |

**Referenced (upstream, not ours):** the `daemon` spawn-lock builds on
[#2407](https://github.com/ruvnet/ruflo/issues/2407) / [#2484](https://github.com/ruvnet/ruflo/issues/2484);
the `memory` write lock is ruvnet's own follow-up from the [#2584](https://github.com/ruvnet/ruflo/issues/2584)
corruption close-out, and its atomic-write baseline is [#2585](https://github.com/ruvnet/ruflo/pull/2585);
the WAL-coherent-reads half addresses the visibility symptom reported in
[#2646](https://github.com/ruvnet/ruflo/issues/2646) and [#2652](https://github.com/ruvnet/ruflo/issues/2652).
[#2652](https://github.com/ruvnet/ruflo/issues/2652) is load-bearing for `adr-reindex` for a second
reason: `memory delete` is a **soft** delete and the tombstoned row still trips the UNIQUE constraint
on re-store, so there is no CLI hard-delete and the rebuild has to clear the namespace with raw SQL.

**Related but NOT addressed by `adr-template`:**
[#2474](https://github.com/ruvnet/ruflo/issues/2474) (closed) fixed a different `adr-index`
parsing gap (`**Status**:` vs `**Status:**` placement, em-dash titles, worktree
double-counting) — its residual note on Nygard-style `## Status` sections and non-English
status words is still open but distinct from the bullet-prefix bug this target fixes.
[#2651](https://github.com/ruvnet/ruflo/issues/2651) (open) is a separate `adr-create` defect —
step 4's `agentdb_hierarchical-store` param/key-charset mismatch — left unpatched here.

## Limits

- Covers the **npx cache** and **global installs** (`npm i -g` — the root reported by `npm
  root -g`). If `@claude-flow/cli` isn't installed in one of those, that location is simply
  skipped. A custom npm prefix can be pointed at with `RUFLO_GLOBAL_ROOT`.
- The scheduled job records an absolute `node` path. Version managers pin that per version
  (mise: `.../installs/node/24.14.1/bin/node`), so upgrading node breaks it — `monitor status`
  detects this and reports `BROKEN`; re-run `monitor install` to re-pin.
- A copy fetched mid-session runs unpatched until the next monitor tick (≤ 5 min).
- Anchor-based patching is inherently brittle across upstream refactors. Mitigated by per-entry
  safe-fail, but a large enough refactor means new anchors.
- `adr-template` is scoped to the `ruflo` marketplace only — a fork installed under a
  different marketplace name is out of scope by design, not a gap. It is also not wired into
  `monitor` (plugin files don't get silently replaced by a background `npx` fetch) and not
  covered by the `npm test` property fuzzer below, which only exercises `{cwd, daemon, memory}`.
- `adr-template` fixes the bullet-prefix parsing gap only ([#2659](https://github.com/ruvnet/ruflo/issues/2659));
  it does not touch the separate `agentdb_hierarchical-store` defect in `adr-create` step 4
  ([#2651](https://github.com/ruvnet/ruflo/issues/2651)).

These are **workarounds**, not substitutes for the upstream fixes. Remove a target with its own
`uninstall`; when the last one goes, the `SessionStart` hook is removed — then delete
`~/.ruflo-source-patch/` to clean up completely.

## License

MIT © sparkling
