# ruflo-source-patch

Install with `npx github:sparkling/ruflo-source-patch`. Zero dependencies, no registry required.

Local fixes for [ruflo](https://github.com/ruvnet/ruflo) / `@claude-flow/cli` (and its
`ruflo-adr` plugin) bugs that are still open upstream: folder sprawl, multiplying daemons, a
memory store that silently drops writes, and an ADR template whose own metadata format its
sibling parser can't read.

```bash
npx github:sparkling/ruflo-source-patch <target> <action>
```

The **first argument is the target**, the second the action. Every target installs and
uninstalls **on its own**. Take the daemon fix without the SQLite write lock, drop one later,
keep the rest.

## Contents

- [Install](#install)
- [Targets](#targets)
  - [Patch targets](#patch-targets)
  - [Plugin patches](#plugin-patches)
    - [ruflo-adr](#ruflo-adr)
    - [ruvnet-brain](#ruvnet-brain)
  - [Script targets](#script-targets)
  - [Monitor](#monitor)
- [The patches in detail](#the-patches-in-detail)
  - [cwd](#cwd)
  - [daemon](#daemon)
  - [memory](#memory)
  - [adr-template](#adr-template)
  - [adr-index](#adr-index)
  - [adr-reindex](#adr-reindex)
  - [verify-interface](#verify-interface)
- [The script targets in detail](#the-script-targets-in-detail)
  - [dual](#dual)
  - [dedupe](#dedupe)
- [The monitor](#the-monitor)
- [How you find out when a patch stops working](#how-you-find-out-when-a-patch-stops-working)
- [How a patch retires itself](#how-a-patch-retires-itself)
  - [Publish a predicate, not a verdict](#publish-a-predicate-not-a-verdict)
  - [The failure direction](#the-failure-direction)
  - [What you see, and what you can do about it](#what-you-see-and-what-you-can-do-about-it)
- [How the update reaches you](#how-the-update-reaches-you)
  - [The tick pulls it, not the hook](#the-tick-pulls-it-not-the-hook)
  - [Tags, never the branch](#tags-never-the-branch)
- [How you find out when a patch stops working](#how-you-find-out-when-a-patch-stops-working)
  - [Anchors are literal, and they will break](#anchors-are-literal-and-they-will-break)
  - [Two hooks, and the honest reason for each](#two-hooks-and-the-honest-reason-for-each)
  - [Watching the watchman](#watching-the-watchman)
  - [It found two real bugs on its first run](#it-found-two-real-bugs-on-its-first-run)
- [cleanup](#cleanup)
- [How it works](#how-it-works)
  - [One install, every repo](#one-install-every-repo)
- [Tested](#tested)
- [Upstream issues](#upstream-issues)
- [Limits](#limits)
- [License](#license)

## Install

The package has **zero dependencies**, so it installs from anywhere with no npm registry
involved. No npmjs.org account, no local Verdaccio, nothing to stand up. Pick one:

```bash
# straight from GitHub (recommended; nothing to clone, always current)
npx github:sparkling/ruflo-source-patch cwd install

# or clone + one command for the full setup (every patch + adr-reindex + the monitor)
git clone https://github.com/sparkling/ruflo-source-patch && cd ruflo-source-patch
make install          # cwd+daemon+memory + adr-template+adr-index + adr-reindex + monitor
make uninstall        # revert everything and remove the package
```

`make install` applies every **patch** target (the three CLI ones and the `ruflo-adr` plugin
ones), plus `adr-reindex`, and schedules the monitor.

The **script targets stay opt-in**, because they change *your projects* rather than the library.
They are also the most immediately useful thing here, so don't skip past them:

```bash
npx github:sparkling/ruflo-source-patch dual install     # one instruction file for Claude Code + Codex
npx github:sparkling/ruflo-source-patch dedupe install    # delete the ~260 files `init --full` duplicates
```

See [The script targets in detail](#the-script-targets-in-detail).

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

## Targets

### Patch targets

Source patches to the installed `@claude-flow/cli`.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`cwd`** | **Silent data loss.** `.claude-flow` holds the learning state (autopilot, `neural/`, `metrics/`, `agentdb`, `memory.db`) and it is anchored to raw `process.cwd()`. Under an agent the cwd drifts and *sticks*, so state is written to a subdirectory nothing will ever read again. `loadState()` does not error: it returns **defaults** and writes a fresh file. The system quietly resets to zero, and it looks exactly like normal operation. Anchors the resolver, the callees and the implicit-relative constants; plus a leak detector, because completeness cannot be proven | [#2633](https://github.com/ruvnet/ruflo/issues/2633) |
| **`daemon`** | One daemon per project **root**. Dedup was keyed per-cwd, so a `daemon start` from any subdirectory forked its own daemon | [#2633](https://github.com/ruvnet/ruflo/issues/2633) · [#2407](https://github.com/ruvnet/ruflo/issues/2407) · [#2484](https://github.com/ruvnet/ruflo/issues/2484) |
| **`memory`** | `.swarm/memory.db` durability. A cross-process **write lock** (concurrent writers silently *drop* writes) and **WAL-coherent reads** (sql.js reads a stale image) | [#2621](https://github.com/ruvnet/ruflo/issues/2621) · [#2584](https://github.com/ruvnet/ruflo/issues/2584) · [#2646](https://github.com/ruvnet/ruflo/issues/2646) · [#2652](https://github.com/ruvnet/ruflo/issues/2652) |

### Plugin patches

Two installed Claude Code plugins get patched, not just `@claude-flow/cli`. Same shape as the
patch targets above, same actions, same pristine-backup discipline.

#### ruflo-adr

Changes to the installed `ruflo-adr` plugin. Together they cover the whole ADR round-trip: what
`adr-create` **writes**, what `adr-index` **reads back in**, and what neither can **reap**.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`adr-template`** | `adr-create`'s own template writes ADR metadata as a bullet list (`- **Status**: proposed`); `adr-index`'s parser only recognises an unprefixed `**Status**:` line or YAML frontmatter, so Status/Date/Tags silently come back empty/Unknown for every ADR authored via `adr-create`'s documented template. Strips the leading `- ` from those four lines so the two skills in the same plugin agree | [#2659](https://github.com/ruvnet/ruflo/issues/2659) |
| **`adr-index`** | `adr-index` **cannot update an ADR that changed**, which is the one thing its own SKILL.md advertises ("Build or *rebuild* … when the graph is out of sync with the on-disk files"). Ratify an ADR, re-run it, and the graph still says `proposed`. Both namespaces are insert-only, failing in *opposite* directions. `adr-patterns` keys are deterministic, so they collide, the write is rejected, and the record stays **frozen**. `adr-edges` keys embed `Date.now()`+random, so they never collide, and every run **duplicates** the whole edge set (3 → 6 → 9). It reports `Records stored: 2/2` either way, because a `UNIQUE constraint` failure is counted as a success | [#2660](https://github.com/ruvnet/ruflo/issues/2660) · [#2594](https://github.com/ruvnet/ruflo/issues/2594) |
| **`adr-reindex`** | The only target that **adds** rather than fixes. `adr-index` converges; it can never **reap**. Delete an ADR file or a relation line and the orphan row survives every future import. Needs raw SQL, because the CLI has no hard delete (`memory delete` is a *soft* delete whose tombstone still trips the UNIQUE constraint on re-store). **Requires the `memory` target**: it hard-deletes rows and refuses to do that without the write lock. **SUPERSEDED on `@claude-flow/cli` 3.29.0+**, which ships the `memory purge` that `ruflo-adr` 0.4.0's own `/adr-reindex` needs; on an older CLI that command is missing, an unknown subcommand exits 0, and theirs reports "purged" having purged nothing. `apply()` checks the CLI on this machine and says which of the two is runnable | [#2666](https://github.com/ruvnet/ruflo/issues/2666) · [#2660](https://github.com/ruvnet/ruflo/issues/2660) · [#2652](https://github.com/ruvnet/ruflo/issues/2652) |

#### ruvnet-brain

A different plugin, the same machinery, and the same reason to be a target: a `/plugin update`
reverts a hand-edit silently.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`verify-interface`** | Its PreToolUse gate blocks a rUv CLI call until you have read that command's `--help`. A good idea that **cannot be opened**. The tool regex `($TOOLS)[@a-z0-9.-]*` absorbs `@latest` *and* any hyphenated **binary name**, so `ruflo-source-patch adr-index status` (a different tool) reads as the `ruflo` CLI and the gate demands `ruflo adr-index status --help`, a command that does not exist. It also matches inside **English prose**: `another ruflo process is writing` parses as `ruflo process is`, so an `echo` or a heredoc that merely *describes* the tool is blocked. And the documented override (`RUVNET_SKIP_INTERFACE_CHECK=1`) is read from the *hook's* environment, where a caller can never set it. The patch absorbs only a `@version`, requires the tool to be in **command position** (a boundary, then any wrappers, then the tool), and honours the override on the command. **The gate still blocks an unread interface.** Fixed, not disabled. **Upstream adopted v1 of this patch into `ruvnet-brain` 2.7.x while #12 stayed open**, prose bug included, so each edit carries two anchors | [stuinfla/ruvnet-brain#12](https://github.com/stuinfla/ruvnet-brain/issues/12) |

### Script targets

Project *toolkits*, not patches. They fix nothing in the library; they set up and clean up **your
projects**. Nothing is patched, no hook is registered. `install` just materializes the scripts at a
stable path so you can run them.
Actions: `install` · `uninstall` · `status`

| Target | What it gives you |
|--------|-------------------|
| **`dual-codex-claude`** *(alias `dual`)* | **Start or convert** a project so Claude Code and Codex share **one** instruction file. Two scripts: build a fresh dual project, or convert an existing one. ([#2634](https://github.com/ruvnet/ruflo/issues/2634) · [#2635](https://github.com/ruvnet/ruflo/issues/2635) · [#2636](https://github.com/ruvnet/ruflo/issues/2636) · [#2637](https://github.com/ruvnet/ruflo/issues/2637) · [#2638](https://github.com/ruvnet/ruflo/issues/2638)) |
| **`dedupe-bundle`** *(alias `dedupe`)* | **Slim a bloated project.** `ruflo init --full` bundles ~260 files that ~100% duplicate the installed plugins. This deletes the duplicates and the double-firing hooks. ([#2640](https://github.com/ruvnet/ruflo/issues/2640)) |

[**What each script does, and how to run it →**](#the-script-targets-in-detail)

### Monitor

Re-applies the patches when something overwrites them.
Actions: `install` · `uninstall` · `status` · `run` · `check`

[**Why it exists, and what it caught →**](#the-monitor)

## The patches in detail

### `cwd`

Stray folders are the symptom. **The bug is silent data loss.**

`.claude-flow/` holds the *learning* state: `autopilot-state.json`, `neural/` checkpoints, `metrics/`,
`learning.json`, `vectors.json`, `agentdb/`, `hnsw/`, and `.swarm/memory.db`. All of it is anchored to raw
`process.cwd()`, and under an agent `process.cwd()` is not the project. It is wherever the agent last ran
`cd`, and **it stays there**:

```text
tool call 1:   cd docs && pwd      ->  /repo/docs
tool call 2:   pwd                 ->  /repo/docs     # a separate call, no cd. It never goes back.
```

The user is at the repo root and never leaves it. The agent runs `cd src/website && npm test` for an
unrelated reason, and from that moment every `ruflo` command, `npx` invocation and MCP spawn in the
session is anchored in `src/website/`.

So state is written to a directory nothing will ever read again. And it does not error:

```js
export function loadState() {
  const filePath = resolve(STATE_FILE);      // relative to the DRIFTED cwd
  try { if (existsSync(filePath)) { … } } catch { }
  return defaults;                            // not found => start over, silently
}
```

Nothing is corrupted. The self-learning system quietly resets to zero, and it looks exactly like normal
operation. That is the worst shape a data bug can have.

#### Three forms, and only one is greppable

| Form | Sites | Findable by search? |
|------|-------|---------------------|
| `path.join(process.cwd(), '.claude-flow', …)` | 62 | yes |
| `resolve('.claude-flow/data')` | 11 | **no**. A one-arg `resolve()` is *already* cwd-relative, so there is no `process.cwd()` token to find |
| `applyChampion(process.cwd())` | 87 | **no**. The callee builds the path from a parameter |

A grep-driven patch therefore cannot be complete. And **an incomplete one is worse than none**, because it
splits writers from readers. We shipped exactly that: `getProjectCwd` (the **reader** of
`harness-active-policy.json`) was anchored while `applyChampion` (its **writer**) still followed the
drifted cwd, so the reader looked at the project root for a file the writer had put elsewhere and silently
found nothing. Unpatched, both sides at least agreed on the drifted directory. Fixed in 4.16.0.

#### What it does

Ported from [`sparkling/ruflo`](https://github.com/sparkling/ruflo)'s ADR-0100 and ADR-0137, which triaged
all 91 sites (70 fixed, 21 kept as deliberate `intentional-cwd`).

**The resolver**, by marker priority: `.ruflo-project` sentinel, then `CLAUDE.md` **and** `.claude/` (both
required, so a `docs/CLAUDE.md` is not mistaken for a project), then `.git`, then the start dir unchanged.
`.git` alone is not enough: a monorepo package has its own `.claude/` and no `.git`, so a bare `.git` walk
sails past it and pools every package's state into one store. Memoised per **resolved start dir**, never at
module load, because a module-level cache goes stale precisely when the cwd drifts.

**Anchored at the callee, not the call site.** One edit fixes every caller, present and future:

| Anchored | Where |
|----------|-------|
| `ensureDaemonRunning`, `getDaemon`, `startDaemon` | `services/daemon-autostart.js`, `services/worker-daemon.js` |
| `getMemoryRoot` + config paths | `memory/memory-initializer.js` |
| `getProjectCwd` | `@claude-flow/cli-core` · `mcp-tools/types.js` |
| `applyChampion`, `applyChampionParams`, `rollbackActivePolicy` | `config/harness-feedback-applier.js` |
| `getDataDir` (neural), `defaultMemoryDbPath`, `defaultTunedConfigPath`, `createClaimService`, `runHarnessLoopWorker` | `memory/`, `services/` |
| `STATE_DIR` (the implicit-relative case) | `autopilot-state.js`. Patching the **constant** fixes all five `resolve()` sites, since `resolve(<absolute>)` returns it unchanged |

**`commands/init.js` is deliberately left alone.** `init` legitimately targets the invocation directory, so
resolving it would initialise a nested project at the outer repo root. That is the fork's
`adr-0100-allow: intentional-cwd` triage, and it is also why a blanket `chdir` at the entry point cannot
work.

#### And a leak detector, because completeness cannot be proven

A `.claude-flow`/`.swarm` in a subdirectory **is** an anchor that leaked, whatever syntactic form it took.
The SessionStart hook reports them, and only reports: those directories hold orphaned neural checkpoints and
split `memory.db` files, and discarding the only copy of someone's learning state is not a hook's decision.

Upstream: [#2633](https://github.com/ruvnet/ruflo/issues/2633).

### `daemon`

Fixes daemon multiplication: one daemon per project **root**, not one per directory you happen to
start it from.

Two distinct bugs, one target.

#### Dedup is keyed per-CWD

Live in current upstream. `commands/daemon.js` anchors its own state (`.claude-flow/`,
`daemon.pid`, and the #2484 dedup lockfile *itself*) to raw `process.cwd()`. The lock therefore
dedups against starts in the **same directory** and not at all against starts elsewhere in the
repo. Patching `daemon-autostart.js` doesn't cover it, because the CLI command does its own
resolution.

Measured on **3.25.6**, which already *has* the #2484 spawn lock. 6 concurrent `daemon start`:

| | Before | After |
|---|---|---|
| all 6 from the repo **root** | 1 daemon | 1 daemon |
| 6 from 6 different **subdirs** | **6 daemons, 6 stray `.claude-flow` dirs** | **1 daemon, 1 `.claude-flow`** |

`daemon status`/`stop` from a subdirectory now find the root daemon instead of reporting "not
running". The `const cwd = process.cwd();` path-validation guard is **deliberately not patched**.
That's a security boundary, not state anchoring.

#### Old and forked builds have no spawn lock at all

Builds predating #2407/#2484 dedup like this: read `daemon.pid` → not running →
`killStaleDaemons` → spawn, **with no lock**. N concurrent starts all see an empty PID file in the
same instant and each fork a daemon. The patch injects the same `O_EXCL` lockfile upstream uses, at
the same path (`<root>/.claude-flow/daemon.lock`), so a patched old build and a modern build dedup
against *each other*. Upstream ≥ 3.25 already has it, so the anchor doesn't match there and it is
safe-skipped, never double-locked.

### `memory`

Fixes `.swarm/memory.db` durability: concurrent writers that silently drop writes, and readers
that act on a stale database image.

`memory.db` is written by **two different SQLite engines**: the AgentDB bridge
(better-sqlite3, **WAL mode**) and a fallback that does a whole-file read-modify-write
(sql.js: `db.export()` → atomic rename). ruflo 3.25.2 made those flushes atomic
([#2585](https://github.com/ruvnet/ruflo/pull/2585)), closing the *torn-write* class. The two
failure modes named as follow-ups in the [#2584](https://github.com/ruvnet/ruflo/issues/2584)
close-out are still open upstream. This target patches both.

#### The write lock

[#2621](https://github.com/ruvnet/ruflo/issues/2621). `storeEntry`, `getEntry`, `deleteEntry`,
`applyTemporalDecay` and `ensureSchemaColumns` each do a whole-file read-modify-write, so two
processes can each read image *v1* and each rename, and the second silently clobbers the first.
Per-write atomicity cannot fix this; only mutual exclusion spanning read..write can. It uses the
same `O_EXCL` primitive ruflo already ships in `commands/daemon.js`. Reentrant (`storeEntry` calls
`getEntry` internally), it steals stale locks (>15 s), and it **never hard-fails**: if the lock
can't be taken within 5 s it proceeds unlocked, degrading to current behaviour rather than breaking
memory.

Measured, two processes × 25 concurrent `storeEntry` on one DB:

```
UNPATCHED   acked: 50/50   on disk: 25/50   SILENTLY LOST: 25   integrity_check: ok
PATCHED     acked: 50/50   on disk: 50/50   SILENTLY LOST:  0   integrity_check: ok
```

Every lost write returned `success: true`, and the database stays `integrity_check: ok`. Nothing
errors. The data is simply gone.

#### WAL-coherent reads

sql.js reads the main DB file only; it cannot see frames sitting in `-wal`. With an uncheckpointed
WAL it can read a database in which the table does not even exist (measured: `no such table:
memory_entries` while 500 rows sat in a 2.3 MB WAL) and then write that fiction back over the
image. `PRAGMA wal_checkpoint(TRUNCATE)` now runs before any `*.db` read, so the image is complete.

> Deliberately **not** done: unlinking `-wal`/`-shm` after the swap. `-shm` is SQLite's
> shared-memory *lock index*, and unlinking it while another process holds a connection splits the
> two onto different lock state, manufacturing the unsynchronised writers this exists to prevent.
> After a `TRUNCATE` checkpoint the WAL is zero-length and replays nothing, so it's redundant.

#### The cost, stated plainly

`getEntry` rewrites the entire DB image just to bump `access_count`, and it now takes the lock, so
reads serialise too. On a large DB that's a real throughput hit. Correct-and-slower beats
fast-and-lossy, but the honest fix is upstream follow-up #3 (native better-sqlite3 + WAL for the
primary flush), which deletes this problem class instead of guarding it. Don't want the trade?
`memory uninstall`.

### `adr-template`

Fixes `adr-create`'s own template, whose output its sibling `adr-index` cannot parse.

`ruflo-adr`'s two skills disagree with each other on ADR metadata format. `adr-create`'s own
template (`SKILL.md` step 3) writes:

```
- **Status**: proposed
- **Date**: 2026-07-13
- **Tags**: golden-corpus, ddd, microservices
```

`adr-index`'s parser (`scripts/import.mjs`) reads these fields with `^`-anchored regexes
(`/^\*\*Status\*\*:.../m`, same shape for `Date`/`Tags`) that require the field marker at the
*start* of the line. Per its own doc comment, it recognises exactly two formats: "v3-style"
(an unprefixed `**Status**:` line) or YAML frontmatter. The bullet list `adr-create` itself
emits is neither, so the leading `- ` breaks the `^` anchor and `parseStatus`/`parseDate`/
`parseTags` silently return `Unknown`/`''`/`[]` for every ADR authored by following
`adr-create`'s documented template to the letter. Confirmed against a real ADR
(`docs/adr/ADR-001-*.md`) produced exactly that way ([#2659](https://github.com/ruvnet/ruflo/issues/2659)).

**Fix:** strip the leading `- ` from those four template lines, so `adr-create`'s own output
matches the "v3-style" format `adr-index`, its sibling skill in the SAME plugin, already parses.
One plugin, one format; both skills agree once patched.

Unlike `cwd`/`daemon`/`memory`, this patches an installed **Claude Code plugin** (`ruflo-adr`'s
`adr-create/SKILL.md`), not `@claude-flow/cli`. It is scoped to the **upstream `ruflo` marketplace
only** (`~/.claude/plugins/cache/ruflo/ruflo-adr/*/skills/adr-create/SKILL.md` and
`~/.claude/plugins/marketplaces/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md`), with the same
pristine-backup + atomic-write discipline as the JS patches above, and, like them, it is re-applied
by the SessionStart hook and the [monitor](#the-monitor).

### `adr-index`

Fixes an index that can be created but never updated.

`adr-template` fixes what `adr-create` **writes**. This fixes what `adr-index` **reads back in**,
and it is the more consequential half, because it breaks the ADR lifecycle itself.

An ADR's life *is* mutation: `proposed` → `accepted` → `superseded`, a new `Amends:`, a corrected
date. `adr-index` cannot reflect any of it. Ratify an ADR, re-run the indexer, and the graph still
says `proposed`, while printing `Records stored: 1/1`.

Both namespaces are insert-only, and that single choice fails in **opposite directions** depending
on whether the key is deterministic:

| Namespace | Key | Re-run | Failure |
|---|---|---|---|
| `adr-patterns` | `ADR-001::<basename>`, deterministic | collides → INSERT rejected | **frozen** at the first value ever indexed |
| `adr-edges` | `<rel>:<from>-><to>:${Date.now()}-${rand}` | never collides | **duplicates**. 3 → 6 → 9 edges, one set per run |

Measured on a 2-ADR repo with nothing changed on disk between runs. Duplicate edges silently weight
an ADR by *how many times someone ran the indexer*, and `verify` reports the inflated graph as
healthy, because every duplicate is individually valid.

The failure is invisible because a `UNIQUE constraint` failure (exit **1**) is mapped to an
`'exists'` sentinel and then **counted as a stored record**, so `errors` stays empty and the summary
reports full success.

Three edits fix it: pass `--upsert`, stop counting `'exists'` as stored, and make the edge key
deterministic (`<rel>:<from>-><to>`, since `capturedAt` already lives in the value, where identity
has no business).

> **The `--upsert` twist ([#2594](https://github.com/ruvnet/ruflo/issues/2594)).** `memory store --help`
> advertises `-u, --upsert  [default: true]`. That default is **declared but not honored**: storing
> to an existing key without the flag exits 1 with `UNIQUE constraint failed` and writes nothing;
> pass it explicitly and it works. So the flag is passed explicitly here, and must be. Trusting the
> documented default silently gets you a strict insert. Worth keeping even after #2594 lands.

Two copies get patched and they are **not identical**. The marketplace checkout carries local #2474
fixes and passes args as `` `--key=${key}` `` (npm rejects an argv token starting with a U+2014
em-dash, which ADR titles contain). Each edit therefore carries *variants* plus a `done()` predicate
that reports whether the fix is present independently of which anchor produced it. That is what makes
a **partial** patch visible: matching on anchor-absence alone would call a file "patched" when an
anchor simply never existed, which is exactly how a missing `--upsert` could pass green while
leaving the bug fully intact. `install` prints `INCOMPLETE` and `status` names the missing edits.

#### What it does not fix

Deletions. But it now tells you. With upsert and deterministic keys a re-import *converges*: status,
metadata and changed relations all land. What it can never do is **reap**. A removed ADR file, or a
deleted `Depends-on:` line, leaves an orphan row that no future import touches, and the index goes on
asserting a decision that no longer exists on disk.

Reaping needs a rebuild ([`adr-reindex`](#adr-reindex)). The importer can't do it, but it can *say
so*, which is the part that actually matters. An orphan you're told about is a chore; an orphan
you're not told about is a graph quietly rotting:

```
#### Issues found
- ORPHANS: 0 record(s) + 1 edge(s) in the index have no source on disk
  (an ADR file or a relation line was deleted; an import can add and update, but never reap)
  reconcile with a rebuild:  ~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh
```

The count is **exact, not a heuristic.** The CLI can't enumerate keys (`memory list` truncates them
and caps at `--limit`, with no `--json`), so a key-by-key diff is impossible. But the *total* is
reported and excludes soft-deleted rows. Every desired record is written before we look, so the
namespace then holds exactly `desired ∪ orphans`, making `count − desired` the precise orphan count.
It even catches a same-size swap: delete ADR-003 and add ADR-004 in one go, and the index lands at 4
against a desired 3.

The tempting alternative, having the importer keep a manifest of what it wrote and prune the
difference, was rejected. It trades a stateless one-second rebuild for persistent state that can
drift, a new "manifest is wrong" failure mode, and a much larger patch surface. The files are the
truth; nothing else should have to be.

### `adr-reindex`

> **SUPERSEDED on a current CLI.** `ruflo-adr` **0.4.0** ships its own `/adr-reindex`,
> [#2666](https://github.com/ruvnet/ruflo/issues/2666) is **closed**, and the `memory purge` command it
> depends on shipped in **`@claude-flow/cli` 3.29.0**. On that CLI, uninstall this target.
>
> **On an older CLI it still matters, and the failure is quiet.** The plugin ships from the marketplace
> the instant it lands; the CLI ships on npm separately, so for a window the skill was installed and the
> command it needs was not. Their `reindex.mjs` gates on `status !== 0`, and an unknown subcommand prints
> the help text and **exits 0**, so against a pre-3.29.0 CLI it reports `adr-patterns: purged` having
> purged nothing. (Its post-condition catches the mismatch and exits 1, but blames a concurrent writer.)
>
> So `apply()` asks the only question that decides it: **does the CLI on THIS machine have `memory
> purge`?** If yes, it says to uninstall. If no, it keeps our script, which reconciles with raw SQL and
> depends on no CLI subcommand. Either way it never overwrites upstream's skill file.

Rebuilds the graph from the ADR files, for a CLI that cannot yet do it itself.

The ADR files are the source of truth; `adr-patterns` / `adr-edges` are a derived cache. For a derived
cache the correct reconcile is a **rebuild**, and at ADR scale it's instant.

```bash
npx github:sparkling/ruflo-source-patch memory install       # REQUIRED, see below
npx github:sparkling/ruflo-source-patch adr-reindex install
~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh [project-dir] [--dry-run]
```

Drop both namespaces, re-import, verify. You don't have to remember when: the patched importer
**prints an `ORPHANS:` line** the moment the index holds a row with no source on disk, and points you
here. Reach for it after **deleting** an ADR or a relation line (the one case upsert can't reap),
after installing the `adr-index` patch for the first time (rows written under the old random-key
scheme are unreachable orphans, and show up as exactly that), or any time you want certainty. For an
ordinary edit, the patched importer handles it. Just run `/adr-index`.

#### It requires the `memory` target

Not a suggestion. `adr-reindex install` refuses without it, and so does the script. This is the one
operation in the whole package whose entire job is to **delete rows**, and ruflo writes `memory.db` as
a whole-file read-modify-write image: a daemon or MCP server holding a *pre-delete* image flushes it
back and resurrects everything you just removed. That is [#2621](https://github.com/ruvnet/ruflo/issues/2621),
aimed squarely at the reconcile itself.

The `memory` target already solves both halves, so this **depends on it rather than reimplementing a
weaker copy**. `memory/write-lock` makes `<db>.rsp-lock` mean something (a lock nothing else takes
protects nothing), and `memory/wal-coherent-reads` stops any reader acting on a stale image. The script
takes that same lock around its `DELETE`, which is *participation* in the protocol, not duplication of
it: the CLI's lock lives inside node and can't cover a `sqlite3` subprocess. It releases before the
re-import, because the patched CLI takes the same lock per store and would otherwise spin out into
unlocked writes for the whole rebuild.

An earlier version carried its own `PRAGMA wal_checkpoint` as "belt-and-braces" and *warned* instead of
refusing when `memory` was absent. Both were wrong: the checkpoint duplicated `memory/wal-coherent-reads`
with worse guarantees, and warning-then-deleting gambles your index on a race the warning has just
finished explaining it cannot win.

#### Three things it has to get right, each learned the hard way

- **Both namespaces, together.** Clearing only `adr-patterns` fixes stale statuses and leaves the
  duplicate edges behind. A partial rebuild is its own trap.
- **Run from the project root.** `import.mjs` takes `ADR_ROOT` to find the ADR *files*, but the CLI it
  shells out to resolves *which `memory.db` to write* from its **cwd**. Invoked from anywhere else it
  reads the right ADRs and writes them to the wrong database, after this script has already emptied
  the real one. This is what an early version did, and it is what an empty index looks like.
- **A post-condition that can see a reconcile that didn't happen.** It used to check `records != 0`,
  which is blind to the exact failure it exists to prevent: if the delete is clobbered, the re-import
  upserts *cleanly on top of the resurrected rows*, every store reports ok, `records` is nonzero, and
  the script exits 0 having reconciled nothing, orphans intact. It now asserts **`records` == the
  number of ADR files**, which catches both directions: too many (the delete didn't stick) and too few
  (stores are failing). It names the likely cause of each.

Because the delete precedes the rebuild, a failed rebuild would leave an **empty** graph, which
`verify` then certifies as healthy (0 records, 0 dangling refs, 0 cycles is a clean bill of health on
nothing). The ADR files are never touched; re-running is always safe.

### `verify-interface`

Fixes a PreToolUse gate that blocks commands it should not, and that cannot be overridden.

`ruvnet-brain` ships a PreToolUse hook that blocks a Bash command naming a rUv CLI until you have read
that command's `--help`. **The idea is sound and this target does not disable it.** It exists because
someone once called `ruflo memory search "query"` positionally, got nothing back, and declared AgentDB
broken three times over. Keep the gate. It simply cannot be *opened*.

#### It fires on things that are not the tool

```bash
MATCH_RE="($TOOLS)[@a-z0-9.-]*[[:space:]]+([a-z][a-z-]*)…"
```

The character class exists to absorb `@latest`. It also absorbs a hyphenated **binary name**, so
`ruflo-source-patch adr-index status`, an entirely different tool with its own CLI, is read as the
`ruflo` CLI, and the gate demands you first run `ruflo adr-index status --help`. That command does not
exist; `ruflo` has no `adr-index` subcommand. It asks for something impossible, then blocks until you
provide it.

There is no command-position anchor either, so the regex is applied to the **whole command string,
quoted text included**. A `git commit` whose message contained the sentence *"…the installed
`ruflo-adr-reindex.sh` **was the** pre-71be214 copy"* matched as `ruflo … was the`, and the gate
demanded the help output for a command called **`was the`**. Ordinary English prose is enough.

#### The documented override cannot work

The block message ends:

> *(Deliberate override, say why out loud: `RUVNET_SKIP_INTERFACE_CHECK=1`)*

But the check reads that variable from the **hook's own environment**, and a PreToolUse hook is handed
the proposed command as JSON on stdin and **never executes it**. Setting the variable on the command,
which is precisely what the message instructs, cannot reach the hook. The one documented escape hatch is
unreachable from the only side that is told to use it.

Together: a false-positive match with no working override. In one session it blocked **five** unrelated
commands, including a `git commit`, in a repo whose name begins `ruflo-`. There is no way round it
except to not name the tool.

#### The fix

The patch absorbs only a `@version`, anchors the tool to command position, and honours the override where
the message says to write it. The regex necessarily gains capture groups (bash ERE has no non-capturing
`(?:…)`), so its `BASH_REMATCH` readers move with it. That means **five edits, each with its own `done()`
predicate**, because a *partial* apply here is worse than none: land the regex without its readers and the
gate blocks on garbage.

Tested **behaviourally, not textually**. Asserting "the regex string changed" would pass on a patch that
broke the gate outright. The suite proves the unpatched fixture really does block (else everything below
is vacuous), that all three commands which actually blocked us now pass, that the override finally works,
and, the one that matters, **that an unread interface still blocks.**

When upstream fixes [#12](https://github.com/stuinfla/ruvnet-brain/issues/12), the anchors stop matching
and `apply()` reports `skip:no-anchor-matched`, naming #12 as the likely reason. Then uninstall the
target. It never guesses.

## The script targets in detail

Everything else in this package fixes **the library**. These fix **your projects**, and they're the
part people miss, because they're not patches and nothing re-applies them. `install` materializes the
scripts; you run them by hand, on a project, when you want them.

```bash
npx github:sparkling/ruflo-source-patch dual install      # or: dual-codex-claude
npx github:sparkling/ruflo-source-patch dedupe install     # or: dedupe-bundle
```

They land in `~/.ruflo-source-patch/<target>/` and stay there. `status` byte-compares them against the
packaged versions, so an upgraded package with a stale materialized script says **`STALE`** rather than
`installed`.

### `dual`

Gives Claude Code and Codex one instruction file instead of two that drift apart.

`ruflo init` writes `CLAUDE.md`. `codex init` writes `AGENTS.md`. They **diverge immediately**, and
keeping them in sync by hand is a losing game ([#2638](https://github.com/ruvnet/ruflo/issues/2638),
[#2636](https://github.com/ruvnet/ruflo/issues/2636)).

The model here is **one canonical file, no symlinks, no duplication**:

- **`AGENTS.md`** is the single source of truth. Codex reads it directly.
- **`CLAUDE.md`** is literally `@AGENTS.md` (Claude Code imports it) plus a short Claude-only overlay.

Edit the shared bulk **once**, in `AGENTS.md`; both platforms see it. Each platform's unique bits live
only in the file that platform reads. Nothing to keep in sync, so nothing drifts.

**Two scripts, depending on where you're starting:**

```bash
# a NEW dual project, from scratch
~/.ruflo-source-patch/dual/ruflo-new-dual.sh <project-dir> [--no-start-all] [--template <t>] [--force]

# convert an EXISTING ruflo/Claude Code project
~/.ruflo-source-patch/dual/ruflo-add-codex.sh [project-dir] [--template <t>] [--force]
```

`ruflo-new-dual.sh` runs `ruflo init` with the **default** preset, deliberately, and not `--full`, which
bundles the ~260 duplicate files that `dedupe` exists to remove. It also uses `npx --yes` so a missing
`@claude-flow/codex` doesn't abort the whole init ([#2635](https://github.com/ruvnet/ruflo/issues/2635)),
and it gitignores the root `.env` that `ruflo init` leaves **tracked**
([#2637](https://github.com/ruvnet/ruflo/issues/2637)).

### `dedupe`

Deletes what the installed plugins already give you.

`ruflo init --full` bundles roughly **260** skill/command/agent files into `.claude/`. Of those, ~**100%**
of the agents and commands, and ~**97%** of the skills, are *already provided* by the installed `ruflo/*`
plugins ([#2640](https://github.com/ruvnet/ruflo/issues/2640)). The project's `settings.json` also
registers lifecycle hooks that duplicate the plugin hooks, so `post-edit` and `session-end` **fire
twice**.

```bash
~/.ruflo-source-patch/dedupe-bundle/ruflo-dedupe-bundle.sh <project-dir> [--strip-dup-hooks] [--dry-run]
```

**Start with `--dry-run`.** It prints exactly what it would remove and touches nothing.

It is conservative by construction: an item is removed **only when a plugin actually provides it**, so
anything project-unique is kept. Everything it removes is backed up first. `--strip-dup-hooks` is opt-in
because that one edits your `settings.json`.

## The monitor

Keeps the patches applied when something overwrites them.

```bash
npx github:sparkling/ruflo-source-patch monitor install     # every 5 min (RSP_MONITOR_INTERVAL=secs)
npx github:sparkling/ruflo-source-patch monitor status      # scheduled? drifting? last repair?
npx github:sparkling/ruflo-source-patch monitor check       # dry-run; exit 1 on drift
```

The `SessionStart` hook only fires when a session **starts**. But `npx -y ruflo@latest` fetches a
**new** cache directory the moment a version changes, and a `ruflo update` can land mid-session,
so a fresh, unpatched copy can run for hours until you restart Claude Code. The monitor closes
that window.

**It covers the plugin patches too** (`adr-template`, `adr-index`), not just the CLI targets. A
`/plugin update` fetches a fresh `ruflo-adr` and drops those patches, and an unpatched `adr-index`
doesn't fail loudly. It simply goes back to reporting `Records stored: N/N` while writing nothing,
so the ADR index rots with no signal at all. Leaving the fix for silent staleness vulnerable to
silent removal would be self-defeating. Both the hook and the monitor re-apply everything recorded
in `state.json`, `patchTargets` (CLI) and `pluginTargets` (plugin) alike:

```
2026-07-13T18:38:05.742Z REPAIRED 1 plugin file(s) [adr-template,adr-index] — adr-index: patched …/scripts/import.mjs (4/4 edits)
```

**It keeps *itself* current, too, and this was the sharpest bug in the package.**
`~/.ruflo-source-patch/lib` is not a cache, it's the **executable**: the hook and the scheduled job
both run modules from *there*, never from the npm package. But only an `install` action ever wrote it.
So `npm i -g …@next`, a version that adds an entry for an anchor upstream re-worded, changed
**nothing** about what the hook and the monitor actually did. They kept applying the old entry set,
forever, and every reporting surface was *also* the old code, so it was silent. The package upgraded
and nothing it does upgraded with it. Found live at nine modules behind.

The invariant is **provenance**, not location: the stable copy must match *the source it was synced
from*, recorded at sync time. (Diffing against the globally-installed package is the obvious answer
and it's wrong. Develop from a clone and the global is *older*, so the CLI would sync your clone in
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
name we don't list gets *zero* protection, silently. Which is how 38 daemons piled up on one cwd
from a differently-named build while `daemon status --all` reported "6 daemons, all within TTL".

## How a patch retires itself

Every target here is temporary by design: upstream is supposed to fix these, and when it does, the
patch should get out of the way. It should not need me to notice, or you to run anything.

### Publish a predicate, not a verdict

The obvious mechanism is a list of *fixed* issues that the monitor reads and acts on. It is the wrong
mechanism, and this week showed why twice:

| Issue | Closed? | Fixed? | Runnable on your machine? |
|---|---|---|---|
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) | yes | **no**. Upstream's own commit says it does not close it | n/a |
| [#2666](https://github.com/ruvnet/ruflo/issues/2666) | yes | yes | **only on `@claude-flow/cli` 3.29.0+** |

`closed` is not `fixed`, and `fixed` is not `runnable here`. `ruflo-adr` ships from the marketplace the
instant it lands; the `memory purge` its `/adr-reindex` calls shipped on npm **separately**. For a window
the skill was installed and the command it invokes did not exist. An unknown subcommand exits 0, so
it reported `adr-patterns: purged` having purged nothing.

A retirement list keyed on "fixed" would have uninstalled a **working** reconcile on everyone still
running 3.28.0, unattended, via cron. That is this tool manufacturing its own founding failure mode on
other people's machines.

So [`lib/supersede.mjs`](lib/supersede.mjs) holds **predicates, not verdicts**. Each target declares the
condition under which it is obsolete, as code, and that code is evaluated **locally against the software
actually installed**. Retirement is a measurement, the same way the anchors are: we never trust a version
number, we check that the string is really there.

The predicate **ships in the package**. It is not fetched at runtime, deliberately: a remote file that an
unattended launchd job parses and acts on destructively is a live channel into every user's machine, where
one typo is a mass uninstall with no review at the moment it happens. Shipped in-repo, publishing a
supersession means committing a predicate and cutting a release. That is the trust boundary you already accepted,
and no new one.

### The failure direction

Every unknown biases toward **keeping** the patch:

| Situation | Verdict | Result |
|---|---|---|
| Replacement present **and** runnable here | `superseded` | retire |
| Replacement present, but cannot run (no `memory purge`) | `live` | **keep** |
| Replacement absent | `live` | **keep**. Never retire into a hole |
| CLI not found, or the probe throws | `unknown` | **keep** |

The cost of wrongly keeping a patch is a redundant slash command and a banner. The cost of wrongly retiring
one is an index that reports a successful reconcile and reconciles nothing. Those are not symmetric.

### What you see, and what you can do about it

Retiring is not uninstalling. It is recorded, with its evidence, and it **sticks**. It has to, because the
SessionStart hook re-applies everything in `state.json` and `make install` installs every target, so a
retirement with no memory of itself would be undone within the hour and redone on the next tick, forever.

```console
$ npx github:sparkling/ruflo-source-patch monitor run
RETIRED retired adr-reindex — ruflo-adr ships its own /adr-reindex AND the installed
  @claude-flow/cli registers `memory purge`, so the replacement is present and runnable.
  This is not a failure: upstream now does this job. (#2666)
```

Announced **once**, then silence. The old behaviour was a `skip:upstream-owns-it` warning that fired every
session and could never resolve itself, and a banner that always cries wolf is a banner people stop reading.
A retirement is explicitly **not** a problem, so it never triggers the *"a patch may no longer be doing
anything"* alarm. That would be crying wolf over good news.

`install` on a retired target refuses, prints the evidence, and stops. That refusal is the entire retirement
interface. **There is no `unretire` and no `pin`**, deliberately: a target retires only when its replacement
is proven present *and* runnable on that machine, so "I disagree" is not a state worth modelling, and every
override is another surface to test, document and get wrong. If the predicate is right, the answer is right.
If the predicate is wrong, fix the predicate.

Read-only actions never retire anything. `status` and `monitor check` observe; `install` and `monitor run`
repair. A `check` that quietly uninstalled things would be the worst possible violation of that rule.

## How the update reaches you

A predicate is worthless if it never arrives. Retirement only works if a machine actually *gets* the code
that knows a patch is obsolete, and nothing about a patched `node_modules` updates itself.

### The tick pulls it, not the hook

The monitor tick ends by asking GitHub for the repo's tags. If a newer **semver tag** than the running
version exists, it runs the package's own installer at that exact tag:

```bash
npx -y github:sparkling/ruflo-source-patch#v4.15.0 monitor install
```

That re-syncs the stable copy, re-registers the hook and the schedule. The new code takes effect on the
**next tick**: the child rewrites `~/.ruflo-source-patch/lib` while the current process already holds its
modules in memory, which is the same "effective next tick" rule `healStableLib()` follows.

**Not the SessionStart hook.** I built it there first, and it was the same mistake the monitor exists to
fix: the hook fires only when a session *starts*, and people leave Claude Code running for days. A patch
that upstream's restructuring has turned from redundant into actively **wrong** would keep re-applying
itself every five minutes until someone happened to restart. Bounded staleness is the entire reason there
is a scheduler, and the update is the thing that most needs bounding.

### Tags, never the branch

`github:sparkling/ruflo-source-patch` is a git **ref**, not a version: no semver, nothing immutable, and a
force-push retroactively changes what everyone already installed. Auto-pulling that is standing remote code
execution from a moving target.

A **tag** is immutable. `v4.15.0` is the same bytes forever, a bad commit on `main` reaches nobody until it
is tagged, and the version that ran is a version you can go back and read.

| Rule | Why |
|---|---|
| Immutable semver tags only (`v1.2.3`) | A branch or a moving `latest` is the live wire tags exist to avoid |
| **Forward** only | A downgrade reinstates patches upstream fixed, and un-retires what was retired on proof |
| Installs the **pinned** tag | `#v4.15.0`, never `#main` |
| Offline, or GitHub down | Keep the working version, silently. A tool that breaks itself upgrading is worse than a stale one |
| A failed install | Stay on the old version and **say so**. Half-upgraded and quiet is the failure this package hunts |
| End of the tick, never mid-apply | The child must not rewrite modules this tick is still using |
| `RSP_NO_SELF_UPDATE=1` | The kill switch. Pin your install, and keep the test suite off the network |

That last one is not hypothetical: several suites spawn `monitor run`, so without the switch running
`npm test` would reach the network and genuinely reinstall the developer's own tool.

## How you find out when a patch stops working

A patch that silently stops applying, while `status` still says *installed*, is the exact failure
this project exists to prevent. It must not be how the project itself fails, so nothing is allowed
to end its life in a log file.

### Anchors are literal, and they will break

Edits are exact string find/replace: no line numbers, no regex, no `sed`. That's deliberate. An
anchor that no longer matches is **skipped**, never guessed at. Each edit also carries alternative
anchors and a `done()` predicate that asks *"is the fix present?"* rather than *"is the anchor
absent?"*, because an anchor can be absent for two very different reasons, and only one of them
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
| `UserPromptSubmit` | every prompt | **report only.** Reads one small file, usually absent (~28ms) |

The second exists because the first is too late. A new ruflo can land in the npx cache **while you
work**, which is precisely how 3.26.1 arrived and silently disabled `cwd/daemon-autostart`, and a
session-start-only warning would sit quiet for hours. The monitor detects it within one tick, but a
detached scheduled job can't reach your session; it can only leave a note. It now leaves that note
in `problems.json`, and the prompt hook reads it:

```
monitor tick (≤5 min)   →  writes ~/.ruflo-source-patch/problems.json
UserPromptSubmit hook   →  surfaces it on the very next thing you type
```

Worst case between *"patch broke"* and *"you know"* is **one tick plus one keystroke**, not one
session. It's rate-limited (an unchanged problem re-announces at most every 30 min; a new one at
once) and it **clears itself** when fixed. A stale warning is as bad as no warning.

### Watching the watchman

Every warning above is delivered by the monitor. So if the **monitor** is dead, the system goes
quiet, and quiet is exactly what healthy looks like. That's the one failure a watchdog can never
report on itself, and it voids every guarantee on this page.

The prompt hook therefore checks the monitor's own liveness, from a heartbeat plus two path checks.
There is no subprocess: `installMonitor` records what it scheduled in `monitor.json`, so verification
costs an `existsSync` and one `mtime`. Three ways it can be dead:

- **Its node interpreter is gone.** Version managers pin an absolute path, so a node upgrade deletes
  the interpreter out from under the job while launchd still reports it as scheduled.
- **Its job script is missing.** The schedule points at a file we've since moved.
- **It simply isn't running.** No tick in hours: an unloaded launchd job, a removed crontab line,
  permissions, a crash loop.

A user who never installed a monitor is never nagged about not having one. The staleness threshold is
deliberately generous (6 intervals, 30-min floor): a laptop that slept through six ticks is not a
broken monitor, and a false alarm trains you to ignore a true one.

### It found two real bugs on its first run

Not a hypothetical, so it is worth stating plainly what it caught within minutes of existing.

**The patcher could destroy the file it was patching.** Found `daemon-autostart.js` at **0 bytes** in
two npx caches, with no backup, an mtime matching a monitor tick, while the published tarball has
4,553 bytes.

The lethal path is an **empty `.rsp-backup`**. Everything is rebuilt from pristine, so an empty
pristine means: no anchor matches → the "nothing applies, restore the original" branch runs →
`writeIfChanged(file, '')` → **the real file is truncated to zero and its backup deleted.** Measured:
a healthy 3,954-byte vendor file reduced to 0 by *one* monitor tick. It is now pinned as a regression
test (`R1a`), and verified to fail without the guard.

Guarding only the *on-disk file* misses this completely. With an empty backup, a perfectly healthy
file is what gets destroyed. So both patchers now reject an empty backup outright (discard it; if the
file is already patched, refuse to guess at a pristine and say so) **and** refuse to touch a
zero-byte target.

Honest limit: the destruction path is proven and closed, but *how* those backups came to be empty is
not fully reconstructable after the fact. A torn read of a file `npx` had created but not yet
written is the likeliest origin, and is guarded, but I can't prove that's what happened. A patcher
that eats the code it patches is worse than the bug it fixes, so both doors are shut regardless.

**`cwd/daemon-autostart` had silently stopped applying on 3.26.x.** Its anchor was the
`if (autostartDisabled())` line plus its exact reason string, and 3.26.0 changed both, so #2633
folder sprawl was quietly back on the version `npx` resolves as *latest*, with `cwd` reporting a
contented 13/15. Re-anchored on the function head of `ensureDaemonRunning()`, which is stable across
3.25.1 / 3.26.0 / 3.26.1 and is also *more* correct: 3.26 reads a project-local
`claude-flow.config.json` inside `autostartDisabled(projectRoot)`, so the root has to be resolved
**before** that check, not one line after it.

## `cleanup`

De-sprawls a single project: removes its daemon and folder sprawl, the mess that accumulated
*before* the `cwd`/`daemon` patches were applied. Those prevent new sprawl; this clears the old.
([#2633](https://github.com/ruvnet/ruflo/issues/2633))

```bash
npx github:sparkling/ruflo-source-patch cleanup [dir]              # default: cwd
npx github:sparkling/ruflo-source-patch cleanup [dir] --dry-run    # preview, change nothing
npx github:sparkling/ruflo-source-patch cleanup [dir] --all-daemons  # also kill the root daemon
```

Scoped strictly to the project root (nearest ancestor `.git`):

- **Stray state dirs.** Removes any `.claude-flow` / `.swarm` in a *subdirectory*. The root's
  own are kept; they're the project's real state.
- **Daemons.** Keeps one daemon anchored at the exact root (the legit one) and kills every
  other daemon whose cwd is inside the project tree: subdirectory-anchored strays and root
  duplicates. `--all-daemons` kills the root one too (it respawns on next use).

**Hard safety:** a process is killed only if its resolved cwd is the project root or beneath it.
A daemon belonging to any other project is never touched, even by name. It also refuses to run
against `$HOME` or `/`. (This is not idle caution: an earlier ad-hoc cleanup on this machine, with
looser scoping, nearly killed unrelated sessions' daemons.)

## How it works

Each library file is rebuilt from a **pristine backup** on every apply:

```
pristine (.rsp-backup)  →  prelude(fragments the active targets need)  →  edits
```

That's what makes independent install/uninstall possible. `memory-initializer.js` is patched by
**two** targets, `cwd` (`getMemoryRoot`, config paths) and `memory` (the write lock), so
uninstalling one must un-apply *its* edits and leave the other's intact. Rebuilding from pristine
means the file is always exactly *pristine + the entries currently requested*: correct for any
subset, idempotent by construction.

Injected code is composed from **fragments with dependencies** (`req` → `resolveRoot` /
`walCheckpoint` / `memLock` / `daemonLock`), each emitted at most once. The shared `req` base
matters: installing `memory` *without* `cwd` would otherwise inject a lock referencing an
undeclared `__rufloReq`.

`~/.ruflo-source-patch/state.json` records which targets are installed: `patchTargets` (CLI) and
`pluginTargets` (`ruflo-adr`). The `SessionStart` hook and the monitor both read it and re-apply
exactly that set, never a target you uninstalled.

**A backup is not pristine forever.** Rebuilding from `.rsp-backup` is only correct while the vendor
file is the one we backed up. When upstream rewrites it **in place** (a `/plugin update`, or an
`npm update -g` on a global CLI install, both of which land at a *fixed* path rather than a fresh
versioned one), treating a stale backup as truth means writing old code over the new file, and the
monitor would do it every five minutes: a watchdog turned into a downgrade machine.

So a file on disk is read as exactly one of three states: **ours** (already patched, nothing to do),
**the backup** (pristine, apply), or **neither**, which means upstream replaced it, so its bytes
become the new pristine and the patches are re-derived on top. Reality outranks our snapshot, always.
If the new file no longer matches the anchors, you get `INCOMPLETE` rather than a lie, and a
`REBASELINE` line in the monitor log, which is your cue to check whether the anchors still hold.

### One install, every repo

You install this **once per machine**, not per project. `npx ruflo` doesn't put a copy of
`@claude-flow/cli` in each repo. Every repo runs the *same* binary out of the shared npx cache
(`~/.npm/_npx/`), plus any global `npm i -g` install. That shared binary is what gets patched, so
there's one `state.json`, one pair of hooks (`SessionStart` to re-apply, `UserPromptSubmit` to warn),
and one monitor job covering all of them.

The patch is global, but its **behaviour is per-repo**, decided at call time: the injected code
calls `__rufloResolveRoot(process.cwd())` on every invocation, so the same binary run from repo A
resolves A's project root and locks A's `.swarm/memory.db`, while run from repo B it resolves B's.
One patch, per-repo effect. Which is why the data each repo stores (`.swarm/`, `.claude-flow/`,
the daemon PID and locks) stays cleanly separated even though the code fixing it is shared.

That's also why the monitor is a single machine-wide job: it has nothing per-repo to track. Its
only job is "keep the shared binary patched," so when *any* repo pulls a new `ruflo` version into
a fresh cache dir, one tick re-patches it and every repo is covered again.

**Safety.** Writes are atomic (temp → `fsync` → rename), because the monitor rewrites these files
while Claude Code sessions are importing them. Backups are the untouched vendor files, so a full
uninstall restores **byte-identical** originals. Version drift is safe-failed **per entry**: an
anchor that no longer matches is skipped individually. Never a partial write, never blocking its
neighbours.

## Tested

`npm test` runs a property fuzzer: 60 random sequences × 8 steps over
`{cwd, daemon, memory} × {install, uninstall, status}`, with a monitor tick after **every** step,
asserting after every step:

| | Invariant |
|---|---|
| **I1** | an entry is applied ⟺ its target is installed, checked **per entry**, so it catches a target missing from a file *shared* with another target |
| **I2** | every patched file still parses as valid ESM |
| **I3** | empty state ⇒ every file byte-identical to pristine, no backups left |
| **I4** | no stray temp files, ever |
| **I5** | `monitor check`'s exit code matches actual drift |
| **I6** | installing twice is a no-op the second time |
| **I7** | no vendor file is **ever** truncated to zero bytes |

Plus deterministic regressions for the two bugs that actually shipped. Random sequences never
generate either, because both need the **vendor file to change underneath us**, which no sequence of
our own commands can do:

| | Regression |
|---|---|
| **R1a** | an empty `.rsp-backup` never destroys the real file *(without the guard: 3954 → 0 bytes)* |
| **R1b** | a zero-byte target is never patched, and never adopted as pristine |
| **R1c** | **`uninstall`** never destroys the file from an empty backup *(without the guard: 3954 → 0)* |
| **R2** | an in-place vendor update is **re-baselined**, not reverted to a stale backup *(without the guard: "CLOBBERED an upstream update")* |

A second suite covers the **plugin patches, the notifier, and the monitor's own liveness**: 30
sequences × 6 steps over `{adr-template, adr-index} × {install, uninstall, status}`, plus:

| | |
|---|---|
| **P1 to P5** | applied ⟺ installed · pristine restore · still parses · never truncated · idempotent |
| **R3** | an in-place `/plugin update` is re-baselined, not reverted *(without the guard: "CLOBBERED")* |
| **R4** | an empty backup never destroys the plugin file, on **`monitor run` and `uninstall`** *(without the guard: 13337 → 0)* |
| **R5** | a broken anchor is reported as `INCOMPLETE` and **names the edit that failed**, never silently skipped |
| **N1 to N4** | the notifier: silent when healthy · announces the break · rate-limits · self-clears when fixed |
| **H1 to H4** | monitor liveness: silent when no monitor installed · stale heartbeat · dead interpreter · missing script |

The remaining five suites cover **every path where a failure could be mistaken for success**, which,
for a package that is almost entirely notification paths, is the only thing that matters. They exist
because the first two stayed green through a round of fixes they were green *before*: they pinned the old
invariants, and an untested notification path rots without anyone noticing.

| | |
|---|---|
| **S1 to S9** | the **stable copy**, the code the hook and the monitor actually *run*. `~/.ruflo-source-patch/lib` is not a cache, it is the **executable**, and only an `install` ever wrote it: upgrading the package changed nothing about what either of them did. Found live at **nine modules behind**. Now: provenance recorded · a stale module **fails `monitor check`** · a mutating command heals it · **the monitor heals itself with no CLI invocation** (nobody re-runs `install` after `npm i -g`) · non-`.mjs` assets reach the copy too |
| **E1 to E3** | the **error path**. A patch that **throws** is counted, summarised, exits nonzero, and reaches the notifier. Before: logged, counted nowhere, matched by none of *three divergent* regexes, and summarised as `nothing to do` |
| **A1 to A2** | an **ambiguous anchor** is refused, never guessed at. Uniqueness is a property of *upstream's* code (a measurement, not a promise), so it is checked on every apply |
| **RB1 to RB5** | a **re-baseline hands over instructions**, not just a warning: the real `diff` command, what to look for in the new code, and how to back the patch out. And an *ordinary* problem does **not** print the essay |
| **V1 to V7** | **`verify-interface`**, behavioural rather than textual. The unpatched fixture really does block (else all of it is vacuous, and V1 caught exactly that on its first run) · the false positives are gone · **an unread interface still blocks** · and a **partial apply writes nothing**, because these five edits are interdependent |
| **CC · ML** | **concurrency.** Three simultaneous installs lost a target in **12 runs out of 12** before `state.json` got a lock. And **ML executes the injected memory write lock** rather than grepping for it: two processes × 40 read-modify-writes. With the lock: 80. Stubbed out: **38**, the exact shape of the "50 acked, 25 on disk" bug it exists to prevent |
| **CL · K** | **`cleanup`**, the only command that removes directories and signals processes. `--dry-run` deletes nothing · the project's own state **survives** · `$HOME` is refused · and **K3: another project's daemon survives.** Real processes, real `pgrep`/`lsof`/`ps` |
| **SS · MI · SC** | the **SessionStart hook** actually re-applying to a fresh npx copy (never executed before) · the plist, cron spec and interval clamp · and the `dual` scripts really producing an `AGENTS.md` that `CLAUDE.md` imports |

**Every regression is mutation-tested**: the guard is removed and the test confirmed to fail. That
discipline has now caught **six vacuous tests**, ones that passed with the guard deleted, and were
therefore proving nothing.

The worst was the **fuzzer itself**. Its oracle was `state.json`, so 480 steps a run asserted *"the files
agree with the bookkeeping"* and **nothing ever asserted that either agrees with the commands you typed**.
A CLI mutated to uninstall targets the user never named passed all 60 sequences. It also caught
`restore()` bypassing every guard (making **`uninstall` the most destructive command in the tool**), and
`monitor check` **healing the drift on its way to checking for it**, a gate that could only ever say *ok*.

A test that cannot fail is worth nothing, and you only find out by making it fail on purpose.

## Upstream issues

Every target here is a local workaround for an **open** (or closed-but-with-open-follow-ups) upstream
issue, almost all in `ruvnet/ruflo`, and one in `stuinfla/ruvnet-brain`. Most we filed ourselves while
building this tool; one we contributed a reproduction and fix to. The tool doesn't *fix* upstream. It
works around these locally until they land, and reports `skip:no-anchor-matched` (loudly) when a fix
does land and the anchors stop matching.

**One target adds rather than fixes:** `adr-reindex` installs an `/adr-reindex` command. `ruflo-adr` 0.4.0
now ships one too, [#2666](https://github.com/ruvnet/ruflo/issues/2666) is **closed**, and the `memory purge`
it needs shipped in `@claude-flow/cli` **3.29.0**. On that CLI, ours is redundant and `apply()` says so.
On an older one it is not, because the plugin and the CLI ship on separate tracks.

**"Fixed upstream" is a claim about a VERSION, not about a repo.** The tool reports what is *runnable on
this machine*, which is the only form of the question that can be acted on.

**Filed by us:**

| Issue | What's wrong upstream | Worked around by |
|-------|-----------------------|------------------|
| [#2666](https://github.com/ruvnet/ruflo/issues/2666) **fixed in CLI 3.29.0** | `ruflo-adr` had **no way to reconcile a deleted ADR**. The orphan row survived every import, and `adr-verify` certified it as healthy (an orphan has no dangling ref and forms no cycle). Upsert converges; it can never reap. Fixed by `ruflo-adr` 0.4.0's `/adr-reindex` plus the `memory purge` hard-delete in `@claude-flow/cli` 3.29.0. **On a pre-3.29.0 CLI the command is absent, the unknown subcommand exits 0, and their reindex reports `purged` having purged nothing** | `adr-reindex` (superseded on 3.29.0+) |
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) **closed, not fully fixed** | Whole-file read-modify-write on `memory.db`: a daemon or MCP server holding a stale in-memory image flushes it back and resurrects deleted rows. `dc01598` adds a `withMemoryDbLock`, but **only `purgeNamespace` calls it**, and upstream's own comment says so: *"This does NOT fully close #2621 … that requires every memory.db writer to respect the same lock."* Every other writer is still unlocked | `memory` |
| [ruvnet-brain#12](https://github.com/stuinfla/ruvnet-brain/issues/12) | `verify-interface.sh`'s PreToolUse gate is **unopenable**: its tool regex swallows any hyphenated binary name (`ruflo-source-patch …` → `ruflo …`) and matches inside plain English prose (`another ruflo process is writing` → `ruflo process is`), while the documented `RUVNET_SKIP_INTERFACE_CHECK=1` override is read from the hook's own environment, where a caller can never set it. **Upstream adopted v1 of our patch into 2.7.x but left the issue open**, and the prose false positive shipped with it | `verify-interface` |
| [ruvnet-brain#13](https://github.com/stuinfla/ruvnet-brain/issues/13) | The same hook parses its JSON payload with a **regex**, and `[^"]*` cannot cross a quote, so a command containing an escaped `"` is **truncated at the first one**. `bash -c "ruflo memory search"` reaches the gate as `bash -c \` and runs unchecked. It also *hides* false positives, so a `MATCH_RE` fix verified with a quoted test command looks like it works whatever it does. **Not patched here**: it is upstream's payload parsing, not the match | (none: reported, not worked around) |
| [#2633](https://github.com/ruvnet/ruflo/issues/2633) | Unbounded daemon proliferation. `.claude-flow`/`.swarm` state and the daemon dedup lock anchored to raw `process.cwd()` | `cwd`, `daemon`, `cleanup` |
| [#2640](https://github.com/ruvnet/ruflo/issues/2640) | `ruflo init` bundle duplicates plugin-provided skills/commands/agents (100% / 97% overlap) | `dedupe-bundle` |
| [#2638](https://github.com/ruvnet/ruflo/issues/2638) | `ruflo init` (CLAUDE.md) and `codex init` (AGENTS.md) generate divergent instruction files | `dual-codex-claude` |
| [#2637](https://github.com/ruvnet/ruflo/issues/2637) | `ruflo init` gitignores only a nested `.claude-flow/.gitignore`; root `.env` is left tracked | `dual-codex-claude` (its `.gitignore` step) |
| [#2636](https://github.com/ruvnet/ruflo/issues/2636) | `ruflo init --dual` produces a Codex-primary layout (thin CLAUDE.md stub) | `dual-codex-claude` |
| [#2635](https://github.com/ruvnet/ruflo/issues/2635) | `ruflo init --dual/--codex` aborts the whole init when `@claude-flow/codex` isn't installed | `dual-codex-claude` (uses `npx --yes`) |
| [#2634](https://github.com/ruvnet/ruflo/issues/2634) | `codex init --template full` generates ~100 placeholder stub skills | `dual-codex-claude` (default template only) |
| [#2659](https://github.com/ruvnet/ruflo/issues/2659) | `ruflo-adr`'s own `adr-create` template writes bullet-list metadata that `adr-index`'s parser can't read (Status/Date/Tags silently come back empty/Unknown) | `adr-template` |
| [#2660](https://github.com/ruvnet/ruflo/issues/2660) | `adr-index` **cannot update a changed ADR**, the one thing its own SKILL.md advertises. Both namespaces are insert-only: deterministic keys collide so records stay **frozen**; random edge keys never collide so edges **duplicate** every run (3 → 6 → 9). A `UNIQUE` failure (exit 1) is counted as a stored record, so both are reported as success | `adr-index`, `adr-reindex` |

**Contributed a reproduction + fix (filed by someone else):**

| Issue | What's wrong upstream | Worked around by |
|-------|-----------------------|------------------|
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) | daemon ↔ MCP last-writer-wins **silently drops writes**. We posted a 30-line repro and the lock implementation | `memory` write lock |
| [#2594](https://github.com/ruvnet/ruflo/issues/2594) | `memory store --help` advertises `-u, --upsert [default: true]`, but that default is **declared and not honored**: an unpassed flag still does a strict INSERT (exit 1, `UNIQUE constraint failed`, no write). We measured it and posted the finding; it is the root cause of #2660 | `adr-index` (passes `--upsert` explicitly rather than trusting the documented default) |

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
double-counting). Its residual note on Nygard-style `## Status` sections and non-English
status words is still open but distinct from the bullet-prefix bug this target fixes.
[#2651](https://github.com/ruvnet/ruflo/issues/2651) (open) is a separate `adr-create` defect,
step 4's `agentdb_hierarchical-store` param/key-charset mismatch, left unpatched here.

## Limits

- Covers the **npx cache** and **global installs** (`npm i -g`, the root reported by `npm
  root -g`). If `@claude-flow/cli` isn't installed in one of those, that location is simply
  skipped. A custom npm prefix can be pointed at with `RUFLO_GLOBAL_ROOT`.
- The scheduled job records an absolute `node` path. Version managers pin that per version
  (mise: `.../installs/node/24.14.1/bin/node`), so upgrading node breaks it. `monitor status`
  detects this and reports `BROKEN`; re-run `monitor install` to re-pin.
- A copy fetched mid-session runs unpatched until the next monitor tick (≤ 5 min).
- **The one failure mode with no automated guard.** Anchors are exact literal strings, never line
  numbers, so nothing drifts by offset. An anchor that stops matching is `skip:anchor-not-found`; one that
  matches *twice* is `skip:ambiguous-anchor`; a partial apply is `INCOMPLETE`. But an anchor can still
  match, still match **uniquely**, still produce a file that parses, and no longer **mean** the same
  thing. Upstream can move the line we anchor on into a different function, add an early return above it,
  or restructure the call so our injected code sits in a path that never runs. **No textual check can see
  that.** It is announced rather than swallowed: a re-baseline prints the `diff` command, says what
  re-applying does *not* prove, and tells you what to look for. Re-evaluating it is a human's (or an
  agent's) job.
- `adr-template` is scoped to the `ruflo` marketplace only. A fork installed under a
  different marketplace name is out of scope by design, not a gap. It is also not covered by the
  `npm test` property fuzzer, which only exercises `{cwd, daemon, memory}`.
- `adr-template` fixes the bullet-prefix parsing gap only ([#2659](https://github.com/ruvnet/ruflo/issues/2659));
  it does not touch the separate `agentdb_hierarchical-store` defect in `adr-create` step 4
  ([#2651](https://github.com/ruvnet/ruflo/issues/2651)).

These are **workarounds**, not substitutes for the upstream fixes. Remove a target with its own
`uninstall`; when the last one goes, the `SessionStart` hook is removed. Then delete
`~/.ruflo-source-patch/` to clean up completely.

## License

MIT © sparkling
