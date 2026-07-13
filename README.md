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

# or clone + one command for the full setup (all patches + the monitor)
git clone https://github.com/sparkling/ruflo-source-patch && cd ruflo-source-patch
make install          # global-install, apply cwd+daemon+memory, schedule the monitor
make uninstall        # revert everything and remove the package
```

`make install` is the whole thing in one line. To pick targets individually instead:

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

**Plugin template patch** — a source patch to the installed `ruflo-adr` plugin
(not `@claude-flow/cli`), same shape as the patch targets above.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`adr-template`** | `adr-create`'s own template writes ADR metadata as a bullet list (`- **Status**: proposed`); `adr-index`'s parser only recognises an unprefixed `**Status**:` line or YAML frontmatter, so Status/Date/Tags silently come back empty/Unknown for every ADR authored via `adr-create`'s documented template. Strips the leading `- ` from those four lines so the two skills in the same plugin agree | [#2659](https://github.com/ruvnet/ruflo/issues/2659) |

**`monitor`** — re-applies the patches when something overwrites them.
Actions: `install` · `uninstall` · `status` · `run` · `check`

**Script targets** — shell scripts materialized at a stable path. No patching, no hook.
Actions: `install` · `uninstall` · `status`

| Target | What it gives you |
|--------|-------------------|
| **`dual-codex-claude`** *(alias `dual`)* | Create or convert a **single-source dual** Claude Code + Codex project: `AGENTS.md` is canonical, `CLAUDE.md` is `@AGENTS.md`. No symlink, no duplication, no drift. ([#2634](https://github.com/ruvnet/ruflo/issues/2634) · [#2635](https://github.com/ruvnet/ruflo/issues/2635) · [#2636](https://github.com/ruvnet/ruflo/issues/2636) · [#2637](https://github.com/ruvnet/ruflo/issues/2637) · [#2638](https://github.com/ruvnet/ruflo/issues/2638)) |
| **`dedupe-bundle`** *(alias `dedupe`)* | **Clean up an existing project** bloated by `ruflo init --full`: drop the `.claude/{skills,commands,agents}` entries the installed `ruflo/*` plugins already provide, and optionally the `settings.json` hooks that double-fire against the plugin hooks. ([#2640](https://github.com/ruvnet/ruflo/issues/2640)) |

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
pristine-backup + atomic-write discipline as the JS patches above. Not wired into `monitor` —
plugin files don't get silently replaced by a background `npx` fetch the way the CLI does; they
only change via an explicit `/plugin update`.

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

`~/.ruflo-source-patch/state.json` records which targets are installed. The `SessionStart` hook
and the monitor both read it and re-apply exactly that set — never a target you uninstalled.

### One install, every repo

You install this **once per machine**, not per project. `npx ruflo` doesn't put a copy of
`@claude-flow/cli` in each repo — every repo runs the *same* binary out of the shared npx cache
(`~/.npm/_npx/`), plus any global `npm i -g` install. That shared binary is what gets patched,
so there's one `state.json`, one `SessionStart` hook, and one monitor job covering all of them.

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

## Upstream issues

Every target here is a local workaround for an open (or closed-but-with-open-follow-ups)
`ruvnet/ruflo` issue. Several we filed ourselves while building this tool; one we contributed a
reproduction and fix to. The tool doesn't *fix* upstream — it works around these locally until
they land.

**Filed by us:**

| Issue | What's wrong upstream | Worked around by |
|-------|-----------------------|------------------|
| [#2633](https://github.com/ruvnet/ruflo/issues/2633) | Unbounded daemon proliferation — `.claude-flow`/`.swarm` state and the daemon dedup lock anchored to raw `process.cwd()` | `cwd`, `daemon`, `cleanup` |
| [#2640](https://github.com/ruvnet/ruflo/issues/2640) | `ruflo init` bundle duplicates plugin-provided skills/commands/agents (100% / 97% overlap) | `dedupe-bundle` |
| [#2638](https://github.com/ruvnet/ruflo/issues/2638) | `ruflo init` (CLAUDE.md) and `codex init` (AGENTS.md) generate divergent instruction files | `dual-codex-claude` |
| [#2637](https://github.com/ruvnet/ruflo/issues/2637) | `ruflo init` gitignores only a nested `.claude-flow/.gitignore`; root `.env` is left tracked | `dual-codex-claude` (its `.gitignore` step) |
| [#2636](https://github.com/ruvnet/ruflo/issues/2636) | `ruflo init --dual` produces a Codex-primary layout (thin CLAUDE.md stub) | `dual-codex-claude` |
| [#2635](https://github.com/ruvnet/ruflo/issues/2635) | `ruflo init --dual/--codex` aborts the whole init when `@claude-flow/codex` isn't installed | `dual-codex-claude` (uses `npx --yes`) |
| [#2634](https://github.com/ruvnet/ruflo/issues/2634) | `codex init --template full` generates ~100 placeholder stub skills | `dual-codex-claude` (default template only) |
| [#2659](https://github.com/ruvnet/ruflo/issues/2659) | `ruflo-adr`'s own `adr-create` template writes bullet-list metadata that `adr-index`'s parser can't read (Status/Date/Tags silently come back empty/Unknown) | `adr-template` |

**Contributed a reproduction + fix (filed by someone else):**

| Issue | What's wrong upstream | Worked around by |
|-------|-----------------------|------------------|
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) | daemon ↔ MCP last-writer-wins **silently drops writes** — we posted a 30-line repro and the lock implementation | `memory` write lock |

**Referenced (upstream, not ours):** the `daemon` spawn-lock builds on
[#2407](https://github.com/ruvnet/ruflo/issues/2407) / [#2484](https://github.com/ruvnet/ruflo/issues/2484);
the `memory` write lock is ruvnet's own follow-up from the [#2584](https://github.com/ruvnet/ruflo/issues/2584)
corruption close-out, and its atomic-write baseline is [#2585](https://github.com/ruvnet/ruflo/pull/2585);
the WAL-coherent-reads half addresses the visibility symptom reported in
[#2646](https://github.com/ruvnet/ruflo/issues/2646) and [#2652](https://github.com/ruvnet/ruflo/issues/2652).

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
