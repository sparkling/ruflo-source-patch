# ruflo-source-patch

[![npm](https://img.shields.io/npm/v/@sparkleideas/ruflo-source-patch.svg)](https://www.npmjs.com/package/@sparkleideas/ruflo-source-patch)

Local workarounds for [ruflo](https://github.com/ruvnet/ruflo) / `@claude-flow/cli` rough
edges. The **first argument is the target**, the second the action:

```bash
npx @sparkleideas/ruflo-source-patch <target> <action>
```

**Every target installs and uninstalls on its own.** Take the daemon fix without the SQLite
write lock, drop one later, keep the rest — they don't entangle.

## Targets

**Patch targets** — source patches to the installed `@claude-flow/cli`.
Actions: `install`\|`init` · `uninstall`\|`remove` · `patch` · `revert` · `status`

| Target | Fixes | Upstream |
|--------|-------|----------|
| **`cwd`** | `.claude-flow`/`.swarm` stop following a drifted cwd — one state dir at the project root, not one per visited subdirectory | [#2633](https://github.com/ruvnet/ruflo/issues/2633) |
| **`daemon`** | One daemon per project **root** — dedup was keyed per-cwd, so a start from any subdir forked its own daemon | [#2633](https://github.com/ruvnet/ruflo/issues/2633) · [#2407](https://github.com/ruvnet/ruflo/issues/2407) · [#2484](https://github.com/ruvnet/ruflo/issues/2484) |
| **`memory`** | `.swarm/memory.db` durability — cross-process **write lock** (concurrent writers silently *drop* writes) and **WAL-coherent reads** (sql.js reads a stale image) | [#2621](https://github.com/ruvnet/ruflo/issues/2621) · [#2584](https://github.com/ruvnet/ruflo/issues/2584) · [#2646](https://github.com/ruvnet/ruflo/issues/2646) · [#2652](https://github.com/ruvnet/ruflo/issues/2652) |
| **`all`** | every patch target above | |

**Script targets** — materialize shell scripts at a stable path. No patching, no hook.
Actions: `install`\|`init` · `uninstall`\|`remove` · `status`

| Target | What it gives you |
|--------|-------------------|
| **`dual-codex-claude`** *(alias `dual`)* | Create or convert a **single-source dual** Claude Code + Codex project: `AGENTS.md` is canonical, `CLAUDE.md` is `@AGENTS.md`. No symlink, no duplication, no drift. |
| **`dedupe-bundle`** *(alias `dedupe`)* | **Clean up an existing Claude project** left bloated by `ruflo init --full`: remove the `.claude/{skills,commands,agents}` entries the installed `ruflo/*` plugins already provide, and optionally the `settings.json` hooks that double-fire against the plugin hooks. ([#2640](https://github.com/ruvnet/ruflo/issues/2640)) |

```bash
npx @sparkleideas/ruflo-source-patch all install          # everything
npx @sparkleideas/ruflo-source-patch daemon install       # just the daemon fix
npx @sparkleideas/ruflo-source-patch memory uninstall     # drop the write lock, keep the rest
npx @sparkleideas/ruflo-source-patch all status
npx @sparkleideas/ruflo-source-patch dedupe-bundle install
```

> A bare action with no target (`npx … install`) applies to **`all`** — what a pre-2.0
> `install` did.

Requirements: Node.js ≥ 18, Claude Code with ruflo / `@claude-flow/cli` used via `npx`.

---

## How the patching works

`@claude-flow/cli` anchors state to raw `process.cwd()`. Under Claude Code's working-directory
drift (sub-agents, worktrees, `cd` inside Bash steps), `cwd` is frequently a subdirectory
rather than the project root. Caller-side interception can't reach every path — ruflo's own
bundled plugin hooks invoke the CLI with a drifted cwd — so this patches the **callee**, which
fixes every caller at once.

Each library file is rebuilt from its **pristine backup** on every apply:

```
pristine (.rsp-backup)  →  prelude(fragments the active targets need)  →  edits
```

That is what makes independent install/uninstall possible. `memory/memory-initializer.js` is
patched by **two** targets — `cwd` (`getMemoryRoot`, config paths) and `memory` (the write
lock) — so uninstalling one must un-apply *its* edits and leave the other's intact. Rebuilding
from pristine means the file is always exactly *pristine + the entries currently requested*,
which is correct for any subset and idempotent by construction.

**Safety:** reversible (backup = the untouched vendor file; restore is byte-identical),
idempotent, and safe-fail on version drift — an entry whose anchor no longer matches is skipped
**individually**, never a partial write and never blocking the other entries.

`install` also copies the runtime to `~/.ruflo-source-patch/lib` and registers a Claude Code
`SessionStart` hook that re-applies **the installed set** to any `npx` copy fetched later (same
reapply model as `patch-package`). Uninstalling the last patch target removes the hook.

---

## `cwd` — folder sprawl

| Function | File |
|----------|------|
| `ensureDaemonRunning` | `@claude-flow/cli` · `services/daemon-autostart.js` |
| `getMemoryRoot` + config paths | `@claude-flow/cli` · `memory/memory-initializer.js` |
| `getProjectCwd` | `@claude-flow/cli-core` · `mcp-tools/types.js` |

Resolves the nearest ancestor `.git` (worktree-safe) before using cwd.

## `daemon` — one daemon per project root

Two distinct bugs, one target.

**1. Dedup is keyed per-CWD (live in current upstream).** `commands/daemon.js` anchors its own
state — `.claude-flow/`, `daemon.pid`, and the #2484 dedup lockfile itself — to raw
`process.cwd()`. So the lock dedups against starts *in the same directory* and not at all
against starts elsewhere in the repo. Patching `daemon-autostart.js` doesn't cover it; the CLI
command does its own resolution.

Measured on **3.25.6** (which already *has* the #2484 lock), 6 concurrent `daemon start`:

| | Before | After |
|---|---|---|
| all 6 from the repo **root** | 1 daemon | 1 daemon |
| 6 from 6 different **subdirs** | **6 daemons, 6 stray `.claude-flow` dirs** | **1 daemon, 1 `.claude-flow`** |

`daemon status`/`stop` from a subdirectory now find the root daemon instead of reporting "not
running". The `const cwd = process.cwd();` path-validation guard is **deliberately not patched**
— it's a security boundary, not state anchoring.

**2. Old/forked builds have no spawn lock at all.** Builds predating
[#2407](https://github.com/ruvnet/ruflo/issues/2407)/[#2484](https://github.com/ruvnet/ruflo/issues/2484)
dedup like this: read `daemon.pid` → not running → `killStaleDaemons` → spawn, **with no lock**.
N concurrent starts all see an empty PID file in the same instant and each fork a daemon. The
patch injects the same `O_EXCL` lockfile upstream uses, at the same path
(`<root>/.claude-flow/daemon.lock`), so a patched old build and a modern build dedup against
*each other*. Upstream ≥ 3.25 already has it, so the anchor doesn't match there and it is
safe-skipped — never double-locked.

## `memory` — `.swarm/memory.db` durability

`.swarm/memory.db` is written by two different SQLite engines: the AgentDB bridge
(**better-sqlite3, WAL mode**) and a fallback that does a whole-file read-modify-write
(**sql.js**: `db.export()` → atomic rename). ruflo 3.25.2 made those flushes atomic
([#2585](https://github.com/ruvnet/ruflo/pull/2585)), closing the *torn-write* class. The two
failure modes named as follow-ups in the [#2584](https://github.com/ruvnet/ruflo/issues/2584)
close-out are still open upstream; this target patches both.

**Write lock** ([#2621](https://github.com/ruvnet/ruflo/issues/2621)). `storeEntry`, `getEntry`,
`deleteEntry`, `applyTemporalDecay` and `ensureSchemaColumns` each do a whole-file
read-modify-write, so two processes can each read image *v1* and each rename — the second
silently clobbers the first. Per-write atomicity cannot fix this; only mutual exclusion spanning
read..write can. Uses the same `O_EXCL` primitive ruflo already ships in `commands/daemon.js`.
Reentrant (`storeEntry` calls `getEntry`), steals stale locks (>15 s), and **never hard-fails**:
if the lock can't be taken within 5 s it proceeds unlocked, degrading to current behaviour rather
than breaking memory.

Measured, two processes × 25 concurrent `storeEntry` on one DB:

```
UNPATCHED   acked: 50/50   on disk: 25/50   SILENTLY LOST: 25   integrity_check: ok
PATCHED     acked: 50/50   on disk: 50/50   SILENTLY LOST:  0   integrity_check: ok
```

Every lost write returned `success: true` and the DB stays `integrity_check: ok` — nothing
errors, the data is simply gone.

**WAL-coherent reads.** sql.js reads the main DB file only; it cannot see frames sitting in
`-wal`. With an uncheckpointed WAL it can read a database in which the table does not even exist
(measured: `no such table: memory_entries` while 500 rows sat in a 2.3 MB WAL), then write that
fiction back over the image. `PRAGMA wal_checkpoint(TRUNCATE)` runs before any `*.db` read so the
image is complete.

> Deliberately **not** done: unlinking `-wal`/`-shm` after a swap. `-shm` is SQLite's
> shared-memory *lock index*; unlinking it while another process holds a connection splits the two
> onto different lock state — manufacturing the unsynchronised writers this exists to prevent.
> After a `TRUNCATE` checkpoint the WAL is zero-length and replays nothing, so it's redundant anyway.

**Cost, stated plainly:** `getEntry` rewrites the entire DB image just to bump `access_count`, and
it now takes the lock — so reads serialise too. On a large DB that's a real throughput hit.
Correct-and-slower beats fast-and-lossy, but the actual fix is upstream follow-up #3 (native
better-sqlite3 + WAL for the primary flush), which deletes this problem class instead of guarding
it. If you don't want the trade: `memory uninstall`.

---

## Script targets

```bash
npx @sparkleideas/ruflo-source-patch dual install            # -> ~/.ruflo-source-patch/dual/
npx @sparkleideas/ruflo-source-patch dedupe-bundle install   # -> ~/.ruflo-source-patch/dedupe-bundle/
```

| Script | Purpose |
|--------|---------|
| `dual/ruflo-add-codex.sh <project>` | Convert an existing ruflo (Claude Code) project into single-source dual |
| `dual/ruflo-new-dual.sh <project>` | Create a fresh single-source dual project |
| `dedupe-bundle/ruflo-dedupe-bundle.sh <project> [--strip-dup-hooks] [--dry-run]` | Slim a `.claude` bundle left by `ruflo init --full` |

`ruflo init --full` bundles ~260 skill/command/agent files, of which ~100 % of agents/commands and
97 % of skills are **also** provided by the installed `ruflo/*` plugins, and the project
`settings.json` registers lifecycle hooks that duplicate the plugin hooks (post-edit/session-end
run twice). `ruflo-dedupe-bundle.sh` defers to the plugins: it only removes an item when a plugin
actually provides it, backs everything up first, keeps project-only items, and prunes nothing if no
plugins are found. Related: ruvnet/ruflo
[#2634](https://github.com/ruvnet/ruflo/issues/2634)–[#2638](https://github.com/ruvnet/ruflo/issues/2638),
[#2640](https://github.com/ruvnet/ruflo/issues/2640).

---

## Caveat

These are **workarounds**, not substitutes for the upstream fixes. A copy fetched by `npx`
mid-session stays unpatched until the next session start. Remove a target with its own
`uninstall`; when the last patch target goes, the hook is removed — then delete
`~/.ruflo-source-patch/` to fully clean up.

## License

MIT © sparkling
