# ruflo-source-patch

Install with `npx github:sparkling/ruflo-source-patch`. Zero dependencies, no registry required.

Local fixes for [ruflo](https://github.com/ruvnet/ruflo) / `@claude-flow/cli` and its plugins
that are still absent from the installed host surface: folder sprawl, multiplying daemons,
silently lost memory writes, dual-host plugin drift, and release/cache gaps in plugin fixes.
Closed issue labels are never treated as proof; each retirement is gated on runnable local behavior.

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
    - [Ruflo plugins under Codex](#ruflo-plugins-under-codex)
    - [ruvnet-brain](#ruvnet-brain)
    - [all ruflo plugins](#all-ruflo-plugins)
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
  - [plugin-only (dedupe)](#plugin-only-dedupe)
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
npx github:sparkling/ruflo-source-patch all install       # every patch + plugin target + the monitor

# or clone (identical result — `make install` just calls `all install`)
git clone https://github.com/sparkling/ruflo-source-patch && cd ruflo-source-patch
make install
make uninstall        # revert everything and remove the package
```

`all install` applies every **patch** target (the five CLI ones and the `ruflo-adr` /
`ruvnet-brain` plugin ones) and schedules the monitor that keeps them live. It is the one-shot the
`Makefile` used to own alone; now the npx path has it too, and `make install` delegates to it so the
two can never list a different set. `all uninstall` / `all status` do the reverse and the readout.

The **script targets stay opt-in**, because they change *your projects or user-level integrations*
rather than the patched library.
They are also the most immediately useful thing here, so don't skip past them, and `run` executes
one directly, no separate install step:

```bash
npx github:sparkling/ruflo-source-patch dual run <project>       # one instruction file for Code + Codex
npx github:sparkling/ruflo-source-patch plugin-only run . --dry-run   # strip the ~260 duplicated files + hooks + MCP registration
npx github:sparkling/ruflo-source-patch ruflo-codex-hooks run     # add canonical Ruflo hooks to an existing Codex install
```

See [The script targets in detail](#the-script-targets-in-detail).

To pick patch targets individually instead of `all`:

```bash
npx github:sparkling/ruflo-source-patch cwd install
npx github:sparkling/ruflo-source-patch daemon install
npx github:sparkling/ruflo-source-patch memory install
npx github:sparkling/ruflo-source-patch init install
npx github:sparkling/ruflo-source-patch plugin-hosts install
npx github:sparkling/ruflo-source-patch monitor install   # keeps them applied

npx github:sparkling/ruflo-source-patch all status        # what's live, everything at once
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
| **`daemon`** | One daemon per project **root**. Ruflo's native lock is sound but keyed to raw cwd; direct daemon commands bypass the root-normalized autostart path, so starts from different subdirectories still receive different lock/PID identities | [#2877](https://github.com/ruvnet/ruflo/issues/2877) · [#2633](https://github.com/ruvnet/ruflo/issues/2633) |
| **`memory`** | `.swarm/memory.db` durability. A fail-closed, async-context-aware **writer lock** (concurrent whole-image writers silently drop acknowledged updates), **WAL-sidecar refusal** at the raw file boundary, an **integrity gate** (refuse a whole-file flush over an already-torn image), and a **stale-writer guard** (the monitor forces every pre-patch daemon/MCP writer onto current bytes and loudly names the manual `/mcp` reconnect needed after an MCP kill; `RSP_NO_STALE_WRITER_KILL` disables the kill) | [#2878](https://github.com/ruvnet/ruflo/issues/2878) · [#2735](https://github.com/ruvnet/ruflo/issues/2735) · [#2584](https://github.com/ruvnet/ruflo/issues/2584) · historical [#2621](https://github.com/ruvnet/ruflo/issues/2621) |
| **`init`** | **Stops `ruflo init`/`doctor` regenerating what the plugins provide.** The durable complement to [`plugin-only`](#plugin-only-dedupe). Disables the standalone `claude-flow` `.mcp.json` emission and the `.claude/{skills,commands,agents}` bundle gates (helpers kept). **Plugin-always deployments only:** the CLI hardcodes `mcp.claudeFlow: true` with no plugin-off flag, so on a plugin machine the standalone + bundle are pure duplicates (ADR-022). The legacy #2777 edit now applies only to builds that still shell out to the whole-repository `npx skills add`; Ruflo 3.32.10+'s bounded in-process `SKILL.md` materialization is left untouched | [#2640](https://github.com/ruvnet/ruflo/issues/2640) · [#2685](https://github.com/ruvnet/ruflo/issues/2685) · [#2777](https://github.com/ruvnet/ruflo/issues/2777) |
| **`plugin-hosts`** | Adds Ruflo-owned `plugins host-install`, `host-uninstall`, additive Claude-to-Codex `host-sync`, `host-update`, and bounded `host-refresh` commands. Installing or self-updating this patch automatically runs the all-installed update once through those injected commands. Normal version changes use each host's supported update/reinstall path; exact tree comparison also repairs same-version collisions. Claude user and active project/local scopes plus Codex are covered; disabled, managed, and orphaned-project registrations are preserved. It never copies or directly edits host caches and reports partial completion as nonzero | [#2854](https://github.com/ruvnet/ruflo/issues/2854) · [#2870](https://github.com/ruvnet/ruflo/issues/2870) |

After installing the target, reconcile an existing dual-host setup with:

```bash
npx ruflo@latest plugins host-sync --dry-run
npx ruflo@latest plugins host-sync
npx ruflo@latest plugins host-update              # update every installed Ruflo plugin in both hosts
npx ruflo@latest plugins host-update -n ruflo-adr # update one

# Explicit #2870 recovery remains available; ordinary installs/self-updates run the all-plugin updater
npx ruflo@latest plugins host-refresh --name ruflo-adr
npx ruflo@latest plugins host-refresh --name ruflo-metaharness
npx ruflo@latest plugins host-refresh --name ruflo-graph-intelligence
```

### Plugin patches

Installed plugin copies get patched, not just `@claude-flow/cli`. Same shape as the patch targets
above, same actions, and the same fail-closed ownership/pristine discipline.

#### ruflo-adr

Changes to the installed `ruflo-adr` plugin. Together they cover the whole ADR round-trip: what
`adr-create` **writes**, what `adr-index` **reads back in**, and what neither can **reap**.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`adr-template`** | Legacy compatibility for stale `ruflo-adr` copies: strips the four list markers old parsers cannot read. After `plugin-hosts` refreshes installed libraries, it executes the creator/parser round trip against both hosts' marketplace and active cache copies and retires itself only when all four pass | [#2659](https://github.com/ruvnet/ruflo/issues/2659) · [#2870](https://github.com/ruvnet/ruflo/issues/2870) |
| **`adr-index`** | **Retired on executable active-copy proof.** All active Claude/Codex copies execute native stable-key upsert and edge de-duplication, their pristine importers report failed stores honestly, and native `adr-index` routes deletions to a runnable native `adr-reindex`. #2870 remains independent delivery hygiene | [#2660](https://github.com/ruvnet/ruflo/issues/2660) · [#2594](https://github.com/ruvnet/ruflo/issues/2594) · [#2870](https://github.com/ruvnet/ruflo/issues/2870) |
| **`adr-reindex`** | Legacy additive reconcile for installations without a runnable native replacement. Native `memory purge` exists, but #2666's closure is incomplete unless purge shares the ordinary writers' current fail-closed lock. Retirement requires the native skill, command, and the `memory` target's `.rsp-lock` wrapper; version presence alone is not enough | [#2666](https://github.com/ruvnet/ruflo/issues/2666) · [#2878](https://github.com/ruvnet/ruflo/issues/2878) |

#### Ruflo plugins under Codex

Codex loads its own Ruflo marketplace snapshot and versioned caches. These targets change only those
Codex copies; Claude Code and Cursor plugin copies are left alone.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`ruflo-hooks-schema`** | **Retired on proof in Ruflo 3.32.39 / `ruflo-core` 0.2.6.** The compatibility edit removed unsupported manifest fields and Cursor-only PreToolUse output only from Codex copies. PR #2857 version-bumped the plugins and fixed both branches; retirement executes both real handlers before standing down | [#2801](https://github.com/ruvnet/ruflo/issues/2801) · [#2816](https://github.com/ruvnet/ruflo/issues/2816) · [PR #2857](https://github.com/ruvnet/ruflo/pull/2857) |
| **`ruflo-codex-skills`** | **Retired on proof in Ruflo 3.32.39.** Older copies needed one read-only `ruflo-core:ruflo-status` skill. The native replacement's default doctor/status path is now read-only and `doctor --fix` requires explicit repair intent | [#2821](https://github.com/ruvnet/ruflo/issues/2821) |

#### ruvnet-brain

A different package/plugin surface, the same machinery, and the same reason to be a target: an npx
re-fetch, Brain bundle refresh, or `/plugin update` reverts a hand-edit silently.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`verify-interface`** | **Retired.** The predicate accepts either Brain's fixed command gate or its newer advisory-only raw-Bash hook backed by structured `ruvnet_cli_help` / `ruvnet_cli_run`, and rejects a partial blocking replacement | [stuinfla/ruvnet-brain#12](https://github.com/stuinfla/ruvnet-brain/issues/12) · [#48](https://github.com/stuinfla/ruvnet-brain/issues/48) |
| **`flywheel-daily`** | **Retired.** Upstream's atomic per-project/local-day claim passes repeat/day/project/enabled/eight-way-concurrency probes | [stuinfla/ruvnet-brain#53](https://github.com/stuinfla/ruvnet-brain/issues/53) |
| **`codex-hooks`** | **Retired and released natively in Brain 4.0.2.** Older Brain releases needed local Codex lifecycle packaging and a generation-stable adapter. The native manifest, six-event adapter, stable wrapper, installed/enabled plugin, and host-convergence receipt now pass as one replacement; `/hooks` trust remains user-owned | [stuinfla/ruvnet-brain#52](https://github.com/stuinfla/ruvnet-brain/issues/52) |
| **`brain-codex-skills`** | Still live, narrowed to one file. Brain 4.0.2 natively fixes the Console workflows and all three migrated aliases, but `ruvnet-brain:whats-new` still searches a checkout for `docs/RELEASE-NOTES-4.0.md`; the supported Stable Spine/plugin payload does not persist that asset. The patch changes only the active Codex `whats-new` skill, preferring future installed paths and otherwise reading the exact installed tag from official GitHub. Its literal renderer and structural readiness check reject duplicated or damaged generated instructions. It never uses `latest`, npm/npx, a checkout, or Brain's operating plane. Uninstall restores the upstream skill exactly | [stuinfla/ruvnet-brain#76](https://github.com/stuinfla/ruvnet-brain/issues/76) · discovery predecessor [#56](https://github.com/stuinfla/ruvnet-brain/issues/56) |
| **`brain-console-lifecycle`** | Gives each detached Console an immutable generation identity, private per-project receipt, and authenticated graceful-shutdown channel. It reuses only an exact live/receipt match, replaces only receipt-proven stale instances, preserves legacy or foreign listeners, and makes doctor fail on mixed generations. It patches executable Console and read-only doctor bytes only; Brain's updater, `.console-runtime` activation transaction, caches, Stable Spine, immutable versions, hooks, MCP, and learning runtime remain native and unchanged | [stuinfla/ruvnet-brain#79](https://github.com/stuinfla/ruvnet-brain/issues/79) |
| **`brain-console-provider-keys`** | Repairs one degraded Console path: when the packaged `data/model-catalog.json` asset is absent, reuse Brain's native boolean-only `detectSubscriptions()` result instead of reporting every provider key except OpenRouter as missing. It patches only installed `onboarding-console.mjs` copies, exposes no credential values, composes with the #79 lifecycle target, and leaves Brain's updater, assets, caches, immutable versions, hooks, MCP, and learning runtime untouched | [stuinfla/ruvnet-brain#86](https://github.com/stuinfla/ruvnet-brain/issues/86) |
| **`brain-release-lockstep`** | Makes Brain's read-only doctor and footprint reporting treat bundle/package/Stable-Spine/Claude/Codex version drift as incomplete convergence and fail health. It patches installed npm/npx and persistent Console-runtime installer bytes by exact anchors, but never invokes or changes Brain's updater, release downloads, immutable version store, `active.json`, host caches, hooks, MCP, or learning runtime. It cannot manufacture the missing upstream release; it prevents that failure from being reported as normal or healthy | [stuinfla/ruvnet-brain#77](https://github.com/stuinfla/ruvnet-brain/issues/77) |
| **`brain-memory-doctor-roots`** | Makes the shipped standalone AgentDB fleet doctor scan the same common and configured project roots as the Console instead of treating an empty `~/Code` as an empty machine. Explicit-root callers and `diagnose(db)` remain native; the target changes read-only discovery only and never touches AgentDB files or Brain's updater/runtime | [stuinfla/ruvnet-brain#81](https://github.com/stuinfla/ruvnet-brain/issues/81) |

Codex does not turn third-party plugin commands into root slash commands like Claude Code does. Browse
these through `/skills`, or invoke them explicitly as `$ruflo-core:ruflo-status`,
`$ruvnet-brain:brain-console`, `$ruvnet-brain:rvbc`, and `$ruvnet-brain:whats-new`.
A new Codex session is required after install
because the session loads its skill inventory at startup.

#### all ruflo plugins

This source-sweep target spans every installed `ruflo-*` plugin rather than a single file.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`mcp-prefix`** | **Legacy compatibility, now retired on proof.** The plugins' bundled `mcp__claude-flow__*` names were dead under plugin loading, which exposes `mcp__plugin_ruflo-core_ruflo__*`. Upstream migrated the fleet in stable 3.32.2 and current HEAD also fixes the two missed `ruflo-core` files. Because upstream's bytes are identical to this patch's output, token presence is not accepted as provenance: the retirement predicate reads the installed marketplace's Git `HEAD`, permits only metaharness smoke assertions to retain the bare token, and proves all 828 local files are exact before/after compositions. It then rebases stale backups to HEAD, preserves sibling patches, restores over-broad standalone/test edits, and retires terminally | [#2685](https://github.com/ruvnet/ruflo/issues/2685) |
| **`design-wall`** | **Retired when the active upstream fix is verified.** Older `ruvnet-brain` copies applied their README/explainer/console wall to every repository. The historical patch scoped it by origin. Current upstream versions ship a stronger plugin-manifest identity gate; this target requires its anchors and valid shell syntax, then executes the real hook against staged README commits in unrelated and ruvnet-brain fixture repos. Only `allow` outside plus `block` inside permits byte-safe cleanup and terminal retirement. Unknown or old copies keep the patch | [stuinfla/ruvnet-brain#17](https://github.com/stuinfla/ruvnet-brain/issues/17) |

### Script targets

One-shot *toolkits*, not patches. They fix nothing in the library; they set up or repair **your
projects and user-level integrations**. Nothing is source-patched and no patch-framework hook is
registered. `install` just materializes the scripts at a stable path so you can run them.
Actions: `install` · `uninstall` · `status` · `run`

| Target | What it gives you |
|--------|-------------------|
| **`dual-codex-claude`** *(alias `dual`)* | **Start or convert** a project so Claude Code and Codex share **one** instruction file. Two scripts: build a fresh dual project, or convert an existing one. ([#2634](https://github.com/ruvnet/ruflo/issues/2634) · [#2635](https://github.com/ruvnet/ruflo/issues/2635) · [#2636](https://github.com/ruvnet/ruflo/issues/2636) · [#2637](https://github.com/ruvnet/ruflo/issues/2637) · [#2638](https://github.com/ruvnet/ruflo/issues/2638)) |
| **`dedupe-bundle`** *(alias `dedupe`)* | **Slim a bloated project.** *Every* `ruflo init` bundles ~196 to 260 `.claude/{skills,commands,agents}` files (default preset, not just `--full`) that ~100% duplicate the installed plugins. Removes the bundle and, event-aware, the genuinely double-firing hooks (`PreToolUse`/`PostToolUse`/`PreCompact`), plus the standalone `.mcp.json` ruflo server the plugin already provides (a second writer on `memory.db`, [#2621](https://github.com/ruvnet/ruflo/issues/2621)) and, by default, its running process. Keeps `helpers/`, project-only hooks, and non-ruflo servers. ([#2640](https://github.com/ruvnet/ruflo/issues/2640)) |
| **`ruflo-codex-hooks`** | **Repair an existing Codex installation created before Ruflo v3.32.24.** Registers the canonical `ruvnet/ruflo` marketplace and `ruflo-core@ruflo` plugin through Codex's public plugin CLI, preserves a disabled plugin and unrelated state, and never edits or re-registers MCP. Current init is handled upstream. ([#2801](https://github.com/ruvnet/ruflo/issues/2801)) |

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

#### Native dedup is keyed per cwd

Live in clean `@claude-flow/cli` **3.33.0**. `commands/daemon.js` anchors its own state
(`.claude-flow/`, `daemon.pid`, and the native dedup lockfile itself) to raw `process.cwd()`.
The #2407/#2484 lock correctly serializes starts in the **same directory**, but starts elsewhere
in the same project use different lock and PID paths. Direct `daemon` commands skip autostart,
so the `cwd` patch's normalization of `daemon-autostart.js` cannot cover them.

Measured with four concurrent foreground starts from four subdirectories:

| | Before | After |
|---|---|---|
| 4 from 4 different **subdirs** | **4 live daemons, 4 subdirectory PID files** | **1 daemon, 1 root PID file** |

`daemon status`/`stop` from a subdirectory now find the root daemon instead of reporting "not
running". The `const cwd = process.cwd();` path-validation guard is **deliberately not patched**.
That's a security boundary, not state anchoring.

The patch leaves Ruflo's native lock algorithm byte-for-byte unchanged and only canonicalizes the
project identity supplied to direct start, stop, status, and supervisor paths. The former
`@sparkleideas/cli` legacy-lock shim is retired. The focused upstream residual is
[#2877](https://github.com/ruvnet/ruflo/issues/2877); [#2633](https://github.com/ruvnet/ruflo/issues/2633)
continues to track the broader project-root model.

### `memory`

Fixes `.swarm/memory.db` durability: concurrent writers that silently drop acknowledged writes,
and raw whole-image access that is unsafe while a native WAL connection is attached.

`memory.db` is written by **two different SQLite engines**: the AgentDB bridge
(better-sqlite3, **WAL mode**) and a fallback that does a whole-file read-modify-write
(sql.js: `db.export()` → atomic rename). Ruflo 3.25.2 made those flushes atomic
([#2585](https://github.com/ruvnet/ruflo/pull/2585)), closing the *torn-write* class. The two
distinct failure modes that remain in Ruflo 3.33.0 are cross-process lost updates
([#2878](https://github.com/ruvnet/ruflo/issues/2878), focused follow-up to closed #2621) and
WAL-incoherent sql.js access. This target patches both without altering the native bridge.

#### The write lock

`storeEntry`, `getEntry`, `deleteEntry`, `applyTemporalDecay`, `ensureSchemaColumns`,
`initializeMemoryDatabase`, and purge fallback can perform whole-file read-modify-write. Two
processes can each read image *v1* and each rename; the second silently clobbers the first.
Per-write atomicity cannot fix this. Only mutual exclusion spanning read..write can.

The injected `<db>.rsp-lock` uses `O_EXCL`, is reentrant only within the current async call
context, and serializes unrelated sibling Promises in the same process. It **fails closed**:
an unresolved path, filesystem error, or five-second timeout throws
`RSP_MEMORY_LOCK_UNAVAILABLE` before the operation runs. A unique claim token plus inode check
prevents a late release from deleting a successor's lock. It never steals by age; a crash may
leave a lock requiring explicit inspection/removal, because age is not proof of death and
`unlink` is not compare-and-delete.

Measured on clean 3.33.0 with the fallback forced:

```
UNPATCHED   acked: 12/12   on disk:  2/12   SILENTLY LOST: 10   integrity_check: ok
PATCH TEST  cross-process updates: 80/80; same-process siblings: 40/40; lock failure: callback did not run
```

Every lost write returned `success: true`, and the database stays `integrity_check: ok`. Nothing
errors. The data is simply gone.

#### WAL-sidecar refusal

sql.js reads the main DB file only; it cannot see frames sitting in `-wal`. With an uncheckpointed
WAL it can read a database in which the table does not even exist (measured: `no such table:
memory_entries` while 500 rows sat in a 2.3 MB WAL) and then write that fiction back over the
image. At Ruflo's shared `fs-secure` raw read/write boundary, the patch refuses any `.db` access
while `-wal` or `-shm` exists, including a zero-byte sidecar, and fails closed if absence cannot
be proved. `checkMemoryInitialization` is guarded outside its catch, and force initialization is
checked before upstream unlinks the main DB.

The patch deliberately does **not** checkpoint, truncate, unlink, or rename another connection's
WAL state. The former `wal_checkpoint(TRUNCATE)` helper was removed: a read helper mutating a live
database could cement a mismatched main/WAL pair and contradicted the policy upstream established
in [#2735](https://github.com/ruvnet/ruflo/issues/2735).

#### The integrity gate (ADR-023)

The lock stops two *cooperating, patched* writers from clobbering each other, and the atomic flush
([#2584](https://github.com/ruvnet/ruflo/issues/2584)) stops a reader seeing a torn image. Neither
covers a flush landing on a DB that is **already** torn: sql.js opens a truncated image without
error, loses the missing pages, and the mutator re-exports the shrunken image over the original, an
acked write that has silently destroyed the store (`no such table: memory_entries` on a
multi-megabyte file is the measured symptom). This is what corrupted `semantic-product-mock`. So
at the actual `writeFileAtomic` boundary, a pure-buffer check reads the 100-byte SQLite header
and verifies it is self-consistent (magic, a power-of-two page size, and `page_size * page_count`
equal to the file size when the header's page count is authoritative). A torn image is **refused**
(the write throws) rather than overwritten. Missing and zero-byte files remain valid initialization
inputs. Every existing non-empty `.db`, including `ensureSchemaColumns` output, must be verifiable.
Successful native AgentDB bridge calls never cross this raw boundary and are not falsely rejected.

#### The stale-writer guard (ADR-023)

The lock and the gate live *inside* the patched module, so they protect only a process that actually
loaded it. A long-running ruflo MCP client or daemon that started before the patch, or that runs an
npx cache copy the patch never reached, keeps flushing the old way from memory. No source edit can
reach it. That stale image, flushed back over a healthy file, is the corruption mechanism. So
`stale-writer.mjs` detects such a writer, resolving its `@claude-flow/cli` root from the daemon's
direct path, the plugin MCP client's `.bin/cli` symlink, **or the public `.bin/ruflo` thin wrapper**.
The last form is what `npx ruflo@latest mcp start` actually leaves running; it validates both package
identities before following Ruflo's bounded hoisted-dependency walk. What the guard *does* depends on
whether the on-disk copy is actually patched:

- **A `pre-patch` writer** (copy patched, process older) is **killed**, daemon or MCP client alike, to
  force it onto patched code. A daemon respawns invisibly on next use. An MCP client does not: Claude
  Code will not reconnect a killed stdio server on its own (validated live, see the fragment comment
  in `stale-writer.mjs`), so reloading one needs a SECOND, manual step in that exact session afterward:
  `/mcp` -> Reconnect, or `/reload-plugins`. Reconnect alone on a still-alive stale process is a no-op,
  which is why the kill has to happen first. **This is a deliberate trade the user chose**: forcing
  fresh code onto every writer, at the cost of an MCP outage in each affected session until the user
  notices and clears it. Every such kill is pushed into the shared problem feed (`addProblems`), so it
  surfaces on the user's very next prompt in *any* session, naming the killed pid(s) and the fix.
- **An `unpatched` writer** (copy lacks the current fail-closed lock, either because the patch could
  not apply or because the older fail-open wrapper remains): **never auto-killed**, because a respawn
  would reload the same unsafe bytes. That's patch drift; the fix is re-anchoring (the drift
  machinery already flags it).

`RSP_NO_STALE_WRITER_KILL` keeps detection but disables every kill; `monitor run` triggers a recovery
on demand, visible directly in that terminal.

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

Current `ruflo-adr` includes the broader native parser fix. This target therefore has a local,
behavior-based retirement gate: it executes a creator-shaped ADR containing list-prefixed status,
date, tags, and all four relationship forms through the active Claude and Codex marketplace/cache
parsers. Stale users keep the compatibility edit; once `plugin-hosts` has refreshed all four copies
and the round trip passes, the target restores the vendor template and records terminal retirement.
The still-open immutable-version defect remains tracked separately by #2870.

Unlike `cwd`/`daemon`/`memory`, this patches an installed **Claude Code plugin** (`ruflo-adr`'s
`adr-create/SKILL.md`), not `@claude-flow/cli`. It is scoped to the **upstream `ruflo` marketplace
only** (`~/.claude/plugins/cache/ruflo/ruflo-adr/*/skills/adr-create/SKILL.md` and
`~/.claude/plugins/marketplaces/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md`), with the same
pristine-backup + atomic-write discipline as the JS patches above, and, like them, it is re-applied
by the SessionStart hook and the [monitor](#the-monitor).

### `adr-index`

> **RETIRED on active native proof.** Every active Claude Code and Codex marketplace/cache copy now
> executes stable-key upsert and edge de-duplication, the pristine importers report failed stores
> honestly, and native `adr-index` documents its deletion limit and routes to a runnable native
> `adr-reindex`. The predicate proves this again after restoring vendor bytes. #2870 remains open for
> reused-version release hygiene, but does not keep redundant runtime code installed.

Historically fixed an index that could be created but never updated.

`adr-template` fixes what `adr-create` **writes**. This fixes what `adr-index` **reads back in**,
and it is the more consequential half, because it breaks the ADR lifecycle itself.

An ADR's life *is* mutation: `proposed` → `accepted` → `superseded`, a new `Amends:`, a corrected
date. The affected importer could not reflect any of it. Ratify an ADR, re-run the indexer, and the
graph still said `proposed`, while printing `Records stored: 1/1`.

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

Three compatibility edits fixed it: pass `--upsert`, stop counting `'exists'` as stored, and make the edge key
deterministic (`<rel>:<from>-><to>`, since `capturedAt` already lives in the value, where identity
has no business).

> **The `--upsert` twist ([#2594](https://github.com/ruvnet/ruflo/issues/2594)).** Older CLIs
> advertised `-u, --upsert [default: true]` but performed a strict insert unless the flag was
> explicit. Ruflo 3.32.36 fixed that default. The importer still passes `--upsert` explicitly so
> an active older plugin/CLI pair cannot silently regress to frozen records.

The legacy target patched non-identical copies. The marketplace checkout carried local #2474
fixes and passes args as `` `--key=${key}` `` (npm rejects an argv token starting with a U+2014
em-dash, which ADR titles contain). Each edit therefore carries *variants* plus a `done()` predicate
that reports whether the fix is present independently of which anchor produced it. That is what makes
a **partial** patch visible: matching on anchor-absence alone would call a file "patched" when an
anchor simply never existed, which is exactly how a missing `--upsert` could pass green while
leaving the bug fully intact. `install` prints `INCOMPLETE` and `status` names the missing edits.

#### What convergence does not fix

Deletions. With upsert and deterministic keys a re-import *converges*: status, metadata and changed
relations all land. What it can never do is **reap**. A removed ADR file, or a
deleted `Depends-on:` line, leaves an orphan row that no future import touches, and the index goes on
asserting a decision that no longer exists on disk.

Reaping needs a rebuild ([`adr-reindex`](#adr-reindex)). Native `adr-index` now says this explicitly
and routes the user to the native sibling skill. The retired compatibility patch additionally printed
this exact orphan count:

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

> **SUPERSEDED only with the shared-lock proof.** `ruflo-adr` 0.4.0+ ships `/adr-reindex`
> and `@claude-flow/cli` 3.29.0+ ships `memory purge`, but #2666's first acceptance point
> is not native: purge takes `<db>.lock` while ordinary writers do not. On this installation
> the `memory` target wraps native purge with their `<db>.rsp-lock`, making the replacement safe.
>
> **On an older CLI it still matters, and the failure is quiet.** The plugin ships from the marketplace
> the instant it lands; the CLI ships on npm separately, so for a window the skill was installed and the
> command it needs was not. Their `reindex.mjs` gates on `status !== 0`, and an unknown subcommand prints
> the help text and **exits 0**, so against a pre-3.29.0 CLI it reports `adr-patterns: purged` having
> purged nothing. (Its post-condition catches the mismatch and exits 1, but blames a concurrent writer.)
>
> So `apply()` asks all three questions that decide it: **does this machine have the native skill,
> `memory purge`, and one lock shared with ordinary writers?** Only all three permit retirement.
> Otherwise it keeps our raw-SQL script and never overwrites upstream's skill file.

Rebuilds the graph from the ADR files, for a CLI that cannot yet do it itself.

The ADR files are the source of truth; `adr-patterns` / `adr-edges` are a derived cache. For a derived
cache the correct reconcile is a **rebuild**, and at ADR scale it's instant.

```bash
npx github:sparkling/ruflo-source-patch memory install       # REQUIRED, see below
npx github:sparkling/ruflo-source-patch adr-reindex install
~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh [project-dir] [--dry-run]
```

Drop both namespaces, re-import, verify. Reach for it after **deleting** an ADR or a relation line
(the one case upsert cannot reap), after moving from a legacy random-edge-key importer (including the
historical `adr-index` compatibility install), or any time you want certainty. For an ordinary edit,
the native importer handles it. Just run `/adr-index`.

#### It requires the `memory` target

Not a suggestion. `adr-reindex install` refuses without it, and so does the script. This is the one
operation in the whole package whose entire job is to **delete rows**, and ruflo writes `memory.db` as
a whole-file read-modify-write image: a daemon or MCP server holding a *pre-delete* image flushes it
back and resurrects everything you just removed. That is [#2621](https://github.com/ruvnet/ruflo/issues/2621),
the historical lost-update report, with the current ordinary-writer residual tracked by
[#2878](https://github.com/ruvnet/ruflo/issues/2878), aimed squarely at the reconcile itself.

The `memory` target already solves both halves, so this **depends on it rather than reimplementing a
weaker copy**. `memory/write-lock` makes `<db>.rsp-lock` mean something (a lock nothing else takes
protects nothing), and `memory/wal-sidecar-refusal` stops raw access while a native connection owns
WAL state. The script takes that same lock around its `DELETE`, which is *participation* in the
protocol, not duplication of it: the CLI's lock lives inside node and can't cover a `sqlite3`
subprocess. It releases before the re-import because every patched store takes the same lock and now
fails closed on contention.

An earlier version carried its own `PRAGMA wal_checkpoint` as "belt-and-braces" and *warned* instead
of refusing when `memory` was absent. Both were wrong: a raw helper must not mutate another
connection's WAL, and warning-then-deleting gambles your index on a race the warning has just
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

Historical compatibility target, now **retired** after an installed behavior proof.

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

Brain first fixed #12/#13 with a JSON parser and command-position gate, then moved raw-Bash
classification to advisory-only output while structured `ruvnet_cli_help` / `ruvnet_cli_run`
own enforcement (#48). Retirement accepts either complete replacement and rejects any partial
advisory that can still exit nonzero. Issue #41's broadened body was not fixed by its earlier
closure; #44 was superseded rather than implemented as a blocking parser. Brain 4.0.2 closed #48
after publishing the structured managed CLI/MCP boundary and its focused interface tests.

## The script targets in detail

Everything else in this package fixes **the library**. These fix **your projects**, and they're the
part people miss, because they're not patches and nothing re-applies them. `install` materializes the
scripts; you run them by hand, on a project, when you want them.

```bash
npx github:sparkling/ruflo-source-patch dual install      # or: dual-codex-claude
npx github:sparkling/ruflo-source-patch plugin-only install   # aliases: dedupe, dedupe-bundle
npx github:sparkling/ruflo-source-patch ruflo-codex-hooks run
```

They land in `~/.ruflo-source-patch/<target>/` and stay there. `status` byte-compares them against the
packaged versions, so an upgraded package with a stale materialized script says **`STALE`** rather than
`installed`.

### `dual`

Gives Claude Code and Codex one instruction file instead of two that drift apart.

`ruflo init` writes `CLAUDE.md`. `codex init` writes `AGENTS.md`. Ruflo 3.32.37 now runs both
native initializers in dual mode (#2636), but the two instruction sources still **diverge
immediately** (#2638). Keeping them synchronized by hand is a losing game.

The model here is **one canonical file, no symlinks, no duplication**:

- **`AGENTS.md`** is the single source of truth. Codex reads it directly.
- **`CLAUDE.md`** is literally `@AGENTS.md` (Claude Code imports it) plus a short Claude-only overlay.

Edit the shared bulk **once**, in `AGENTS.md`; both platforms see it. Each platform's unique bits live
only in the file that platform reads. Nothing to keep in sync, so nothing drifts.

**Two scripts, depending on where you're starting:**

```bash
# a NEW dual project, from scratch
~/.ruflo-source-patch/dual/ruflo-new-dual.sh <project-dir> [--no-start-all] [--no-dedupe] [--template <t>] [--force]

# convert an EXISTING ruflo/Claude Code project
~/.ruflo-source-patch/dual/ruflo-add-codex.sh [project-dir] [--template <t>] [--force]
```

`ruflo-new-dual.sh` runs `ruflo init` with the **default** preset (`--with-embeddings`), not `--full`. The
default **still** bundles the plugin-duplicated `.claude/{skills,commands,agents}` (~196 files; `--full`
just adds more), so the fresh-project script runs the plugin-only sweep by default (`--no-dedupe`
opts out). The conversion deliberately retains the exact audited
`@claude-flow/codex@3.0.1` transaction because its side effects are fully bounded here; native
Ruflo 3.32.36 separately fixed #2635 for ordinary `--codex`/`--dual` initialization.

The adapter runs behind a failing private `codex` shim, so it cannot overwrite the user's MCP registry.
Afterward, the wrapper queries Codex's **user-global** registry and adds `ruflo` only when that exact
entry is absent. `-C <project>` selects the CLI invocation cwd; it does not make the entry
project-scoped or store a fixed server `cwd`. Existing `.agents/config.toml`, `.codex/AGENTS.override.md`,
`.codex/config.toml`, and `.gitignore` bytes are restored; adapter-created copies are removed.
`AGENTS.md` and `CLAUDE.md` are also restored on failure or interruption. After stripping the adapter's
ignore edits, the wrapper preserves existing rules and appends only its marker-owned `.env`, runtime,
and `*.bak` rules. It does not
install inferred `.codex/skills/*/skill.toml` manifests, and Claude uses the plugin-owned MCP server
rather than a duplicate standalone registration.

### `ruflo-codex-hooks`

Repairs the user-global Codex plugin registry on a machine initialized before Ruflo v3.32.24 /
`@claude-flow/codex` 3.0.2 learned to install Ruflo's lifecycle hooks:

```bash
npx github:sparkling/ruflo-source-patch ruflo-codex-hooks run
```

It adds the canonical `ruvnet/ruflo` marketplace at `main` only when absent, installs
`ruflo-core@ruflo` only when absent, preserves an installed-but-disabled plugin, and refuses to
overwrite a different source using the `ruflo` marketplace name. It does not run any `codex mcp`
command. After a successful install, start a new Codex session and review `/hooks`; Codex owns that
trust decision.

### plugin-only (dedupe)

Makes a project defer entirely to the installed plugins. **Renamed from `dedupe` / `dedupe-bundle`** (both
still work as aliases) because it now does more than slim the bundle: it also strips the duplicate MCP
registration in both channels and stops the redundant server. Deletes what the installed plugins already
give you.

**Every** `ruflo init` bundles the `.claude/{skills,commands,agents}` files, default preset included, not
just `--full` (~**196** on default: 30 skills + 148 commands + 18 agents; ~**260** on `--full`). Of those,
~**100%** of the agents and commands, and ~**97%** of the skills, are *already provided* by the installed
`ruflo/*` plugins ([#2640](https://github.com/ruvnet/ruflo/issues/2640)). The project's `settings.json` also
registers lifecycle hooks. The ones for events the plugin `hooks.json` also defines (`PreToolUse`,
`PostToolUse`, `PreCompact`) **fire twice** on POSIX ([#2132](https://github.com/ruvnet/ruflo/issues/2132)).

It also reaps a **duplicate MCP registration**. `ruflo init` writes a project-local `.mcp.json` that
registers a *standalone* ruflo server (keyed `claude-flow` or `ruflo`), but the `ruflo-core` plugin already
provides that server (namespaced `mcp__plugin_ruflo-core_ruflo__*`). Under plugin loading the project copy is
a second server on the same root: **two writers on one `.swarm/memory.db`**
([#2621](https://github.com/ruvnet/ruflo/issues/2621)). dedupe removes it (matched by command *signature*, so
`ruv-swarm` / `flow-nexus` and any unrelated server are **kept**; the file is deleted if it empties) from
**both** places it can live. That means the project's `.mcp.json` **and** `~/.claude.json`'s
`projects[<dir>].mcpServers` (Claude Code's per-project MCP config in the global file, where a **remote**
`ssh` server is a real capability, not a duplicate, and is kept). By **default** it also **SIGTERMs the
now-orphaned server process** so the second writer is gone immediately, not just after a restart.

```bash
~/.ruflo-source-patch/dedupe-bundle/ruflo-dedupe-bundle.sh <project-dir> [--keep-dup-hooks|--keep-dup-mcp|--keep-server|--bundle-only] [--dry-run]
```

**Start with `--dry-run`.** It prints exactly what it would remove and stop, and touches nothing.

By **default** it removes the bundle, strips the duplicate hooks, removes the standalone MCP registration and
stops its server. It is conservative by construction:

- a bundle item is removed **only when a plugin actually provides it** (project-unique items kept);
- a hook is stripped **only for events the plugin `hooks.json` also defines** (`UserPromptSubmit` routing,
  `SessionStart/End`, `Subagent*`, `Notification`, and auto-memory are **kept**, since no plugin replaces them);
- the MCP server is removed **only when the plugin actually provides one**, and the process is SIGTERMed
  **only** if its real cwd is inside the project **and** its env carries the removed entry's `CLAUDE_FLOW_*`
  marker, so the **plugin server (same command) is never touched**; if it can't be told apart, nothing is
  killed and it says so (the same containment discipline as [`cleanup`](#cleanup));
- **`.claude/helpers/` is never touched** (init writes all ~43; no plugin replaces them);
- removals are backed up first. `--keep-dup-hooks` skips the hook step, `--keep-dup-mcp` leaves `.mcp.json`
  alone, `--keep-server` leaves the process running, and `--bundle-only` does the `.claude` bundle only.

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

**It covers plugin patches too**, not just CLI targets. Before `adr-template` and `adr-index` retired,
a `/plugin update` could fetch fresh `ruflo-adr` bytes and silently drop their compatibility edits.
Both the hook and monitor therefore re-apply everything still recorded in `state.json`, across
`patchTargets` (CLI) and `pluginTargets` (plugins). Terminally retired targets are removed from that
state and are not re-applied. A historical repair looked like:

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
| [#2666](https://github.com/ruvnet/ruflo/issues/2666) | yes | **not as written**. Native purge has a private lock | only after `memory` makes purge share the ordinary-writer lock |

`closed` is not `fixed`, and `fixed` is not `runnable here`. `ruflo-adr` ships from the marketplace the
instant it lands; the `memory purge` its `/adr-reindex` calls shipped on npm **separately**. For a window
the skill was installed and the command it invokes did not exist. An unknown subcommand exits 0, so
it reported `adr-patterns: purged` having purged nothing. Current purge also takes `<db>.lock`, while
ordinary writers take no native lock. This repository can retire its legacy command only after the
`memory` target proves purge and ordinary writers all take the same `<db>.rsp-lock`.

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

**New targets adopt themselves, if you asked for everything.** `all install` records a "keep me on the
complete, current set" contract, and in that mode the tick runs `all install` at the new tag instead of
`monitor install`. So a target *introduced* in a later release records itself into `state.json` and applies
on its own, with no manual step (ADR-019). That is the whole premise: install once, stay patched, including
fixes that did not exist when you installed. A **cherry-picked** install is left exactly as it is: it runs
`monitor install`, its recorded set unchanged, and nothing it did not ask for is added. Any single-target
`uninstall` drops you out of the contract, because the moment you curate a subset you have stopped asking
for everything. (Retirement still applies: `all install` skips a target already superseded on your machine,
ADR-014.) One transition wrinkle: an `all` install that predates this flag adopts automatically only after
you run `all install` once more to set it, then never again.

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

The prompt hook therefore checks the monitor's own liveness. On a healthy prompt it costs an `existsSync`
and one `mtime`, no subprocess: `installMonitor` records what it scheduled in `monitor.json`. Three ways
it can be dead:

- **Its node interpreter is gone.** A version manager pinned a per-version path and a `node` upgrade
  deleted it (largely closed now: the schedule runs the manager's stable shim, ADR-021).
- **Its job script is missing.** The schedule points at a file we've since moved.
- **It simply isn't running.** An unloaded launchd job, a removed crontab line, a crash loop.

The heartbeat is a **cheap gate, not the verdict.** A stale heartbeat is ambiguous: the job dropped, OR
the machine merely idled/slept (the lunch break). The old design guessed with a generous 30-minute
threshold and still false-alarmed after lunch. Now, when (and only when) the heartbeat is older than
two intervals (10 min at the default; two consecutive missed ticks, since the hook only runs while you're
active and ticks are firing), it asks the scheduler **itself**, once: `launchctl list` / `crontab -l`.
That one authoritative question tells a dropped job (recover) from a slept one (stay silent), so the
sleep false alarm is gone and a real drop is caught in ~10 minutes rather than 30. A user who never
installed a monitor is never nagged about not having one.

**And it does not just warn: it brings the monitor back.** A dead tick cannot repair itself, so a
dropped launchd/cron job used to stay dead until someone restarted Claude Code. The prompt hook is the
one process that runs constantly, so when (and only when) its cheap liveness check finds the monitor
down, it re-registers it right there and says so. On a healthy prompt it still touches nothing. Two
further hardenings close the common causes (ADR-021): the schedule is registered against a
version-manager's **stable shim** (`mise/shims/node`, not `.../installs/node/24.14.1/bin/node`) so a node
upgrade no longer deletes the interpreter out from under it; and the job's stderr is captured to
`monitor-stderr.log`, so a crash that dies before it can log is recorded instead of vanishing.

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
`walRefusal` / `memLock` / `integrityGate`), each emitted at most once. The shared `req` base
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

The remaining suites cover **every path where a failure could be mistaken for success**, which,
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
| **CC · ML · IG/WG** | **concurrency and memory safety.** Three simultaneous installs lost a target in **12 runs out of 12** before `state.json` got a lock; one fail-closed transaction now covers state + disk. ML executes the injected lock across two processes (80/80 updates), unrelated sibling Promises (40/40), nested reentry, acquisition failure, and late-release ownership. IG/WG execute the real image guards: healthy/fresh files pass, torn or unverifiable files fail, live WAL sidecars refuse without mutation, and the former checkpoint shim is absent |
| **CL · K** | **`cleanup`**, the only command that removes directories and signals processes. `--dry-run` deletes nothing · the project's own state **survives** · `$HOME` is refused · and **K3: another project's daemon survives.** Real processes, real `pgrep`/`lsof`/`ps` |
| **SS · MI · DH** | the **SessionStart hook** actually re-applying to a fresh npx copy · the plist, cron spec and interval clamp · and the offline `dual` host-boundary harness proving policy/MCP preservation, rollback, migration, and symlink refusal |
| **CS** | **Codex skill rendering and ownership.** JavaScript replacement tokens remain literal · Brain #76's exact-version regex stays intact · headings/lookups occur once · an owned malformed render migrates from verified pristine · uninstall restores vendor bytes |
| **BL1 to BL23** | **Brain release lockstep.** Bounded npm/npx/persistent-runtime discovery · all five release-bearing components compared · `v` prefixes normalized · split releases fail health · partial/ambiguous anchors write nothing · deleting the doctor gate invalidates patch evidence · public install/status/uninstall round-trips every byte |

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

Issue state is evidence to inspect, never the retirement signal. This audit was rerun on
2026-07-31 against Ruflo 3.33.0, `ruflo-core` 0.2.6, the active Claude/Codex caches, Brain
4.0.2, and exact published behavior. The ordinary-writer residual was filed as focused #2878;
closed #2621 received one cross-link rather than a rewritten scope. Brain's remaining installed
release-note boundary was split cleanly from #56 into focused #76.

**"Fixed upstream" is a claim about a runnable artifact, not a branch, version string, or
closed label.** The table records the full acceptance result.

| Issue | Verified verdict | Local result |
|-------|------------------|--------------|
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) | **Closed historical/incomplete.** Its quoted-sequence fix did not make ordinary writers share a lock | Superseded as the active acceptance target by focused #2878 |
| [#2878](https://github.com/ruvnet/ruflo/issues/2878) | **Open, reproduced on clean 3.33.0.** All 12 fallback stores acknowledged success; only 2 rows persisted. Locking must fail closed and cover every whole-image writer | Keep `memory` |
| [#2633](https://github.com/ruvnet/ruflo/issues/2633) | **Open, live.** Durable state and daemon identity still follow raw cwd | Keep `cwd`, `daemon`, `cleanup` |
| [#2634](https://github.com/ruvnet/ruflo/issues/2634), [#2635](https://github.com/ruvnet/ruflo/issues/2635), [#2636](https://github.com/ruvnet/ruflo/issues/2636), [#2637](https://github.com/ruvnet/ruflo/issues/2637) | **Fixed completely** in 3.32.36/3.32.37: backed skills, adapter fallback, both native scaffolds, root secret ignores | `dual` remains for #2638 and its stricter transaction, not these defects |
| [#2638](https://github.com/ruvnet/ruflo/issues/2638) | **Open.** Claude and Codex instructions still have separate generators | Keep `dual` |
| [#2640](https://github.com/ruvnet/ruflo/issues/2640) | **Open, partial.** Atomic event claims prevent duplicate side effects, but init still emits the duplicate bundle/hooks/MCP | Keep `init`, `plugin-only` |
| [#2651](https://github.com/ruvnet/ruflo/issues/2651) | **Fixed completely** in 3.32.37 | No patch |
| [#2659](https://github.com/ruvnet/ruflo/issues/2659) | **Fixed completely for active hosts.** The automatic plugin refresh delivered current parser bytes and all four active Claude/Codex marketplace/cache copies pass the creator/indexer round trip | `adr-template` retires locally on executable proof; #2870 independently tracks the reused identity |
| [#2660](https://github.com/ruvnet/ruflo/issues/2660) | **Fixed completely for active hosts.** All active Claude/Codex copies execute native convergence and honest counting, and native `adr-index` routes deletions to native `adr-reindex` | `adr-index` retired on local proof; #2870 remains a separate release-identity issue |
| [#2666](https://github.com/ruvnet/ruflo/issues/2666) | **Closed incomplete as written.** Native reindex/purge exist, but purge's private lock is not shared with ordinary writers | `memory` supplies the shared wrapper; only then is `adr-reindex` retired |
| [#2672](https://github.com/ruvnet/ruflo/issues/2672) | **Correctly retracted / not planned.** Its premise was false | No patch |
| [#2685](https://github.com/ruvnet/ruflo/issues/2685), [#2706](https://github.com/ruvnet/ruflo/issues/2706) | **Fixed completely.** Fleet and missed core references are native | `mcp-prefix` retired |
| [#2765](https://github.com/ruvnet/ruflo/issues/2765) | **Fixed completely** in 3.32.36 | No patch |
| [#2777](https://github.com/ruvnet/ruflo/issues/2777) | **Fixed completely** in 3.32.10 | `init` retains shape-gated legacy compatibility only |
| [#2801](https://github.com/ruvnet/ruflo/issues/2801) | **Fixed completely** after registration plus the 3.32.39 version-bumped strict manifest | One-shot repair only for old installs; schema target retired |
| [#2816](https://github.com/ruvnet/ruflo/issues/2816) | **Fixed completely** in 3.32.39 / PR #2857; both real PreToolUse branches emit Codex-valid output | `ruflo-hooks-schema` retired |
| [#2821](https://github.com/ruvnet/ruflo/issues/2821) | **Fixed completely.** Native status is read-only by default; repair requires explicit intent | `ruflo-codex-skills` retired |
| [#2854](https://github.com/ruvnet/ruflo/issues/2854) | **Open.** No native dual-host marketplace reconciliation | Keep `plugin-hosts` |
| [#2870](https://github.com/ruvnet/ruflo/issues/2870) | **Open.** Three current plugin versions identify multiple source trees; all 35 current identities were audited | `plugin-hosts host-refresh` repaired the three local host pairs through supported CLIs; wait for bumped versions plus a fleet-wide release guard |
| [#2877](https://github.com/ruvnet/ruflo/issues/2877) | **Open, live.** Clean 3.33.0 produced four live daemons and four PID files from four subdirectories because direct daemon commands key the native lock to raw cwd | Keep the narrowed `daemon` command-root patch |
| [Brain #12](https://github.com/stuinfla/ruvnet-brain/issues/12), [#13](https://github.com/stuinfla/ruvnet-brain/issues/13), [#17](https://github.com/stuinfla/ruvnet-brain/issues/17) | **Fixed completely** and behaviorally proved | `verify-interface`, `design-wall` retired |
| [Brain #41](https://github.com/stuinfla/ruvnet-brain/issues/41) | **Closure not sound after its body was broadened.** The closing comment proves the earlier quote fix, not the edited nested-invocation acceptance | Superseded by #44/#48; no new patch |
| [Brain #42](https://github.com/stuinfla/ruvnet-brain/issues/42), [#43](https://github.com/stuinfla/ruvnet-brain/issues/43) | **Fixed completely.** Codex MCP/plugin packaging is present without the retracted `skill.toml` proposal | No patch |
| [Brain #44](https://github.com/stuinfla/ruvnet-brain/issues/44) | **Superseded, not completed as written.** Raw Bash is now advisory rather than a blocking recursively parsed authority | Covered by the #48 replacement proof |
| [Brain #48](https://github.com/stuinfla/ruvnet-brain/issues/48) | **Fixed and released in 4.0.2.** The structured managed CLI/MCP boundary and focused interface tests are published | `verify-interface` remains retired |
| [Brain #52](https://github.com/stuinfla/ruvnet-brain/issues/52) | **Fixed and released in 4.0.2.** Native six-event hooks, adapter, generation-stable wrapper, npm assets, and host wiring are published | `codex-hooks` remains retired; trust remains user-owned |
| [Brain #53](https://github.com/stuinfla/ruvnet-brain/issues/53) | **Fixed completely.** Atomic daily/project cadence passes concurrency behavior | `flywheel-daily` retired |
| [Brain #54](https://github.com/stuinfla/ruvnet-brain/issues/54) | **Fixed and released in 4.0.2.** A clean public install returned cited RVF results inside the published timeout evidence | No patch |
| [Brain #56](https://github.com/stuinfla/ruvnet-brain/issues/56) | **Fixed for its discovery scope.** Native Console/what's-new skills and self-contained aliases are published | The separate installed release-note defect is #76 |
| [Brain #64](https://github.com/stuinfla/ruvnet-brain/issues/64) | **Fixed and released in 4.0.2.** This machine auto-flipped 4.0.1→4.0.2 and recorded both Claude and Codex `ready` | No downstream updater patch was added |
| [Brain #66](https://github.com/stuinfla/ruvnet-brain/issues/66) | **Fixed and released in 4.0.2.** The focused newest-store memory detection suite passes upstream | No patch |
| [Brain #76](https://github.com/stuinfla/ruvnet-brain/issues/76) | **Open, reproduced on 4.0.2.** The native Codex skill is discoverable but its curated release-note asset is absent from every persistent installed root | Keep the narrowed `brain-codex-skills` patch until the exact installed workflow runs natively |
| [Brain #77](https://github.com/stuinfla/ruvnet-brain/issues/77) | **Open, reproduced by the v4.0.3 public release.** Its signed bundle says 4.0.3 while npm, both host manifests, Stable Spine, and active host caches still identify 4.0.2 | Keep `brain-release-lockstep` as a read-only fail-closed reporting guard; never relabel or copy Brain assets downstream |
| [Brain #78](https://github.com/stuinfla/ruvnet-brain/issues/78) | **Open, reproduced after a Codex restart.** Brain's MCP server works directly, but `tools/list` waits on model warmup beyond Codex's default startup budget, so Codex omits `search_ruvnet` while SessionStart calls it live | No local runtime patch; upstream should return static tool declarations immediately, persist warmup failure, and report registered versus ready honestly |
| [Brain #79](https://github.com/stuinfla/ruvnet-brain/issues/79) | **Open; maintainer verified both causes.** A detached pre-update Console survives host restarts and passes the branded-root probe; native `runUpdate()` also omits persistent Console-runtime activation | Keep `brain-console-lifecycle` for owned process identity/replacement and read-only diagnosis. Upstream must add `.console-runtime` to its native update transaction; this patch deliberately does not |
| [Brain #81](https://github.com/stuinfla/ruvnet-brain/issues/81) | **Open; reproduced on published 4.0.2 and current main.** The Console's #19 root fix was not shared with the standalone `memory-doctor.mjs` CLI, whose default still scans only `~/Code` plus two extras | Keep `brain-memory-doctor-roots` until active native bytes execute one shared common/configured-root discovery policy without a false zero |
| [Brain #86](https://github.com/stuinfla/ruvnet-brain/issues/86) | **Open; reproduced on published 4.0.2 and current main.** The npm allow-list and persistent-runtime transaction omit `data/model-catalog.json`; the Console catches the load failure and reports false provider-key negatives | Keep `brain-console-provider-keys` as a one-anchor fallback to Brain's native detector until a packed artifact and staged runtime both carry and validate the catalog |

**Contributed a reproduction + fix (filed by someone else):**

| Issue | What's wrong upstream | Worked around by |
|-------|-----------------------|------------------|
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) | daemon ↔ MCP last-writer-wins **silently drops writes**. We posted a 30-line repro and the lock implementation | `memory` write lock |
| [#2594](https://github.com/ruvnet/ruflo/issues/2594) | **Fixed in 3.32.36.** Before that release, `memory store --help` declared upsert as the default while an omitted flag still performed a strict INSERT. We measured it and posted the reproducer | The native importer now passes `--upsert` explicitly; the compatibility target is retired |

**Referenced (upstream, not ours):** the `daemon` target retains the native lock from
[#2407](https://github.com/ruvnet/ruflo/issues/2407) / [#2484](https://github.com/ruvnet/ruflo/issues/2484)
unchanged; [#2877](https://github.com/ruvnet/ruflo/issues/2877) tracks only its remaining raw-cwd identity;
the `memory` write lock builds on the [#2584](https://github.com/ruvnet/ruflo/issues/2584)
corruption close-out, and its atomic-write baseline is [#2585](https://github.com/ruvnet/ruflo/pull/2585);
the WAL-sidecar-refusal half follows [#2735](https://github.com/ruvnet/ruflo/issues/2735) and
addresses the historical visibility symptom reported in
[#2646](https://github.com/ruvnet/ruflo/issues/2646) and [#2652](https://github.com/ruvnet/ruflo/issues/2652),
both now fixed in their stated scope. #2652 also explains why the legacy `adr-reindex` used raw SQL:
`memory delete` was soft and its tombstone still collided on re-store. Current Ruflo supplies
`memory purge`; the remaining #2666 gap is that purge's private lock is not shared by ordinary writers.

**Related but NOT addressed by `adr-template`:**
[#2474](https://github.com/ruvnet/ruflo/issues/2474) (closed) fixed a different `adr-index`
parsing gap (`**Status**:` vs `**Status:**` placement, em-dash titles, worktree
double-counting). Its residual note on Nygard-style `## Status` sections and non-English
status words is still open but distinct from the bullet-prefix bug this target fixes.
[#2651](https://github.com/ruvnet/ruflo/issues/2651) was a separate `adr-create` step-4
`agentdb_hierarchical-store` parameter/key-charset defect; it is fixed in 3.32.37 and never needed
an `adr-template` patch.

## Limits

- Covers the **npx cache** and **global installs** (`npm i -g`, the root reported by `npm
  root -g`). If `@claude-flow/cli` isn't installed in one of those, that location is simply
  skipped. A custom npm prefix can be pointed at with `RUFLO_GLOBAL_ROOT`.
- The scheduled job runs a **version-stable** `node` where one exists: under a version manager it is
  registered against the shim (`mise/shims/node`, `.volta/bin/node`), which survives a node upgrade
  (ADR-021). Only a manager without a standalone shim (nvm) still records a per-version path, and there
  the liveness check reports the interpreter as gone and the prompt hook re-registers with the current
  node on the next prompt.
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
  the separate `adr-create` step-4 defect ([#2651](https://github.com/ruvnet/ruflo/issues/2651))
  was fixed upstream in 3.32.37.

These are **workarounds**, not substitutes for the upstream fixes. Remove a target with its own
`uninstall`; when the last one goes, the `SessionStart` hook is removed. Then delete
`~/.ruflo-source-patch/` to clean up completely.

## License

MIT © sparkling
