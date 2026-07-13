# ruflo-source-patch

[![npm](https://img.shields.io/npm/v/@sparkleideas/ruflo-source-patch.svg)](https://www.npmjs.com/package/@sparkleideas/ruflo-source-patch)

Local workarounds for [ruflo](https://github.com/ruvnet/ruflo) / `@claude-flow/cli`
rough edges, packaged as one CLI with per-**target** subcommands:

```bash
npx @sparkleideas/ruflo-source-patch <target> <action>
```

| Target | What it does | Actions |
|--------|--------------|---------|
| **`cwd`** | Source patches for the installed `@claude-flow/cli`. Two fix families: **(1)** `process.cwd()` anchoring ([#2633](https://github.com/ruvnet/ruflo/issues/2633)) so `.claude-flow`/`.swarm` folders and daemons stop proliferating; **(2)** `.swarm/memory.db` **durability** — a cross-process write lock ([#2621](https://github.com/ruvnet/ruflo/issues/2621)) and WAL-coherent reads ([#2584](https://github.com/ruvnet/ruflo/issues/2584) follow-ups). | `install`\|`init` · `uninstall`\|`remove` · `patch` · `revert` · `status` |
| **`dual-codex-claude`** | Installs the single-source dual (Claude Code + Codex) project toolkit — scripts that create/convert a project so `AGENTS.md` is canonical and `CLAUDE.md` = `@AGENTS.md` (no duplication or drift). | `install`\|`init` · `uninstall`\|`remove` · `status` |

> A bare action with no target (`npx … install`) defaults to the **`cwd`** target.

Requirements: Node.js ≥ 18, Claude Code with ruflo / `@claude-flow/cli` used via `npx`.

---

## Target: `cwd` — source patch for the folder/daemon sprawl

`@claude-flow/cli` anchors its state to raw `process.cwd()`. Under Claude Code's
working-directory drift (sub-agents, git worktrees, `cd` inside Bash steps), `cwd`
is frequently a subdirectory rather than the project root — so a fresh
`.claude-flow` folder (and its own background daemon) is created in every visited
directory, and memory is scattered across stray `.swarm/memory.db` files.

Caller-side interception can't reach every path — ruflo's own bundled plugin
hooks invoke the CLI with a drifted cwd. Patching the **callee** fixes every
caller at once. Three functions are rewritten to resolve the nearest ancestor
`.git` (worktree-safe) before using cwd:

| Function | File |
|----------|------|
| `ensureDaemonRunning` | `@claude-flow/cli/dist/src/services/daemon-autostart.js` |
| `getMemoryRoot` | `@claude-flow/cli/dist/src/memory/memory-initializer.js` |
| `getProjectCwd` | `@claude-flow/cli-core/dist/src/mcp-tools/types.js` |

```bash
npx @sparkleideas/ruflo-source-patch cwd install     # or: cwd init
npx @sparkleideas/ruflo-source-patch cwd uninstall   # or: cwd remove
npx @sparkleideas/ruflo-source-patch cwd patch | revert | status
```

`install` patches every `@claude-flow/cli` copy in the npx cache, copies its
runtime to `~/.ruflo-source-patch/lib`, and registers a Claude Code
`SessionStart` hook that re-applies the patch each session (so newly-`npx`-fetched
copies get patched too — same reapply model as `patch-package`).

**Safety:** reversible (per-file `.rsp-backup`, restored byte-for-byte on
`uninstall`/`revert`), idempotent (`/* ruflo-source-patch:patched */` marker),
and safe-fail on version drift (each anchor string is checked before any write;
a moved anchor is skipped, never a partial write).

### Memory durability (shipped with the `cwd` target)

`.swarm/memory.db` is written by two different SQLite engines: the AgentDB bridge
(**better-sqlite3, WAL mode**) and a fallback path that does a whole-file
read-modify-write (**sql.js**: `db.export()` → atomic rename). ruflo 3.25.2 made those
flushes atomic ([#2585](https://github.com/ruvnet/ruflo/pull/2585)), which closed the
*torn-write* class. Two failure modes named as follow-ups in the
[#2584](https://github.com/ruvnet/ruflo/issues/2584) close-out are still open upstream;
this target patches both.

| Patch | Fixes | Function |
|-------|-------|----------|
| **Cross-process write lock** | [#2621](https://github.com/ruvnet/ruflo/issues/2621) — daemon ↔ MCP last-writer-wins **silently drops writes** | `storeEntry`, `getEntry`, `deleteEntry`, `applyTemporalDecay`, `ensureSchemaColumns` |
| **WAL-coherent reads** | sql.js cannot read WAL frames, so it reads a **stale image** (see [#2646](https://github.com/ruvnet/ruflo/issues/2646), [#2652](https://github.com/ruvnet/ruflo/issues/2652)) | `readFileMaybeEncrypted` |

**The write lock.** Each of those five functions does a whole-file read-modify-write, so
two processes can each read image *v1* and each rename — the second silently clobbers the
first. Per-write atomicity cannot fix this; only mutual exclusion spanning read..write can.
The patch wraps them in an `O_CREAT|O_EXCL` advisory lockfile — the **same primitive ruflo
already ships** in `commands/daemon.js` ([#2484](https://github.com/ruvnet/ruflo/issues/2484)).
It is reentrant (`storeEntry` calls `getEntry` internally), recovers stale locks (>15s, holder
died mid-write), and **never hard-fails**: if the lock can't be taken within 5s it proceeds
unlocked, degrading to current behaviour rather than breaking memory.

Measured, two processes × 25 concurrent `storeEntry` calls on one DB:

```
UNPATCHED   writes ACKed: 50/50   rows on disk: 25/50   SILENTLY LOST: 25   integrity_check: ok
PATCHED     writes ACKed: 50/50   rows on disk: 50/50   SILENTLY LOST:  0   integrity_check: ok
```

Every lost write returned `success: true`, and the DB stays `integrity_check: ok` — nothing
errors, the data is simply gone.

**WAL-coherent reads.** sql.js reads the main DB file only; it cannot see frames sitting in
`-wal`. With an uncheckpointed WAL it can read a database in which the table does not even
exist (measured: `no such table: memory_entries` with 500 rows live in a 2.3 MB WAL), then
write that fiction back over the image. The patch runs `PRAGMA wal_checkpoint(TRUNCATE)`
before any `*.db` read, so the image is complete.

> Deliberately **not** done: unlinking `-wal`/`-shm` after a swap. `-shm` is SQLite's
> shared-memory lock index; unlinking it while another process holds a connection splits the
> two onto different lock state — manufacturing the unsynchronised writers this is meant to
> prevent. After a `TRUNCATE` checkpoint the WAL is zero-length and replays nothing, so the
> unlink buys nothing anyway.

**Cost, stated plainly:** `getEntry` rewrites the entire DB image just to bump `access_count`,
and it now takes the lock — so reads serialise too. On a large DB that is a real throughput
hit. Correct-and-slower beats fast-and-lossy, but the actual fix is upstream follow-up #3
(native better-sqlite3 + WAL for the primary flush), which deletes this problem class instead
of guarding it.

## Target: `dual-codex-claude` — single-source dual project toolkit

`ruflo init --dual`/`--codex` doesn't produce a working dual Claude Code + Codex
project. This target installs a small toolkit that does:

```bash
npx @sparkleideas/ruflo-source-patch dual-codex-claude install     # copies scripts to ~/.ruflo-source-patch/dual
npx @sparkleideas/ruflo-source-patch dual-codex-claude uninstall   # removes them
```

Installed scripts (run directly against a project):

| Script | Purpose |
|--------|---------|
| `ruflo-add-codex.sh <project>` | Convert an existing ruflo (Claude Code) project into single-source dual |
| `ruflo-new-dual.sh <project>` | Create a fresh single-source dual project |
| `ruflo-dedupe-bundle.sh <project>` | Strip the `.claude` bundle content the installed ruflo plugins already provide |

Design: `AGENTS.md` is the one canonical instruction file (shared content +
Codex-only overlay); `CLAUDE.md` is `@AGENTS.md` (Claude Code's memory import) +
a small Claude-only overlay — no symlink, no duplication, no drift. Related:
ruvnet/ruflo [#2634](https://github.com/ruvnet/ruflo/issues/2634)–[#2638](https://github.com/ruvnet/ruflo/issues/2638),
[#2640](https://github.com/ruvnet/ruflo/issues/2640).

`install` copies the scripts to `~/.ruflo-source-patch/dual/` (marked executable);
`uninstall` removes that directory. No Claude Code hook is registered for this
target — the scripts are run on demand.

---

## Caveat

These are **workarounds**, not substitutes for the upstream fixes. For `cwd`, a
copy fetched by `npx` mid-session is unpatched until the next session start.
Remove everything with the per-target `uninstall`, then delete
`~/.ruflo-source-patch/` to fully clean up.

## License

MIT © sparkling
