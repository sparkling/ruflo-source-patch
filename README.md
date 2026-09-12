# ruflo-source-patch

Install with `npx github:sparkling/ruflo-source-patch`. Zero dependencies, no registry required.

Local fixes for [ruflo](https://github.com/ruvnet/ruflo) / `@claude-flow/cli` and its plugins
that are still absent from the installed host surface: folder sprawl, stronger memory safety,
dual-host plugin drift, and release/cache gaps in plugin fixes. Historical daemon compatibility
remains available for older Ruflo builds but retires itself on current native behavior.
Closed issue labels are never treated as proof; each retirement is gated on runnable local behavior.

```bash
npx github:sparkling/ruflo-source-patch <target> <action>
```

The **first argument is the target**, the second the action. Every target installs and
uninstalls **on its own**. Take the daemon fix without the SQLite write lock, drop one later,
keep the rest.

## Learning-statistics repair

`node bin/cli.mjs ruflo-learning-stats install` applies the remaining
[#2245](https://github.com/ruvnet/ruflo/issues/2245) reporting repair: it reads the
coordinator's real buffer fields, distinguishes persisted counters from process
snapshots, reads retained ReasoningBank patterns independently, names `models.json`
correctly, reports unreadable stores as unavailable, and includes singular `pattern`
in the memory summary. It never trains, deletes or moves learning records.

Counter persistence now commits each process's pending increments against the
latest file under a bounded lock and an atomic rename, rather than overwriting
newer totals with a stale process snapshot. Repeated flushes do not double count.
Malformed data, path changes and a busy lock refuse the write and retain pending
increments; `counterWriter.lastError` exposes that process's failure. Locks are
never stolen and old sessions are never killed. A process that exits before a
successful flush can still lose pending increments; this is not a durable event
ledger. Legacy writers must reconnect, and previously overwritten historical
totals cannot be reconstructed by this repair. The counter-writer test exercises
six concurrent processes, retries and refusal paths.

The old `sona.patternsLearned` field remains a labelled compatibility alias for
retained ReasoningBank count. Cross-scope equality fields return `null`, not a
false health verdict. `reportingContract: store-scoped-learning-stats-v1` identifies
the repaired result. Existing host-owned stdio MCP sessions must reconnect to load
changed modules; installation does not kill them. Retirement requires the installed
native source to pass `test/ruflo-learning-stats.mjs`'s persistence, scope, source
and error scenarios without the patch; unknown changed anchors fail visibly.

## Live-WAL memory statistics

`ruflo-memory-stats` fixes [Ruflo #3311](https://github.com/ruvnet/ruflo/issues/3311):
retrieval/search can work through AgentDB while `memory_stats` fails at an unrelated
raw sql.js initialization probe. The patch reuses the CRUD registry's existing
database handle and aggregates all active/legacy-NULL entries in one statement.
It does not open another driver, initialize schema, checkpoint, close the borrowed
handle, or alter the raw-WAL protection. Counts are no longer capped at 100,000;
arbitrary namespace names are safe. Failures return explicit errors and null counts,
not a falsely empty/uninitialized database. Embedding presence is not HNSW readiness.

```bash
npx github:sparkling/ruflo-source-patch ruflo-memory-stats install
```

`reportingContract: registry-memory-stats-v1` proves the repaired handler is loaded.
Existing host-owned MCPs need a supported reconnect; installation never kills them.
Retirement requires equivalent native behavior for the scenarios in
`test/ruflo-memory-stats.mjs`, not issue closure alone. Unknown source changes fail
visibly instead of being rewritten speculatively.

## Wrapper/runtime mismatch guard

Tracked upstream in [Ruflo #3306](https://github.com/ruvnet/ruflo/issues/3306).
An inspected installation reports `ruflo@3.41.2` while its wrapper executes
`@claude-flow/cli@3.33.0`. The published wrapper dependency, `^3.33.0`, permits
that combination; the wrapper's version output alone does not identify the
implementation running an MCP server. This is an observed installation, not a
claim that every fresh install resolves the older runtime.

`ruflo-wrapper-guard` now restores the `ruflo` command instead of refusing it.
Every invocation compares installed stable `@claude-flow/cli` package versions
numerically and delegates to the newest implementation's native `bin/cli.js`.
This includes `--version`: it reports the implementation's version, not the
branding package's version. The old refusal patch upgrades in place; pristine
upstream bytes remain available for uninstall. Unknown vendor source is reported
incomplete and left untouched.

```bash
npm install --global @claude-flow/cli@latest
npx github:sparkling/ruflo-source-patch ruflo-wrapper-guard install
ruflo --version
```

**Newest installed is not an automatic npm update.** The wrapper examines its
own installation, effective-account user prefixes, the Node prefix, absolute
npm prefixes on PATH, and an explicit npm prefix. It does not consult project
cwd or project `node_modules/.bin`, scan unrelated npx caches, download packages,
or opt into prereleases. Install newer stable CLI releases through normal package
administration; the next wrapper invocation selects them without another patch.
Equal versions use a deterministic top-level-first tie break. Package name/type/bin
and regular in-package entrypoints are checked. Malformed candidates or a broken
selected newest installation fail visibly instead of silently choosing an older CLI.

Delegation uses the same Node process and literal arguments: no shell, subprocess
proxy, branding interception, or extra stdout. Native CLI code owns stdin, MCP
framing, signals and exit status. CLI-only instructions naming `ruflo` work again;
normal memory/coordination work remains MCP-first. Existing direct CLI/MCP launch
configurations remain valid and are not rewritten. Known lifecycle shims retain
their direct-installed-CLI-only behavior, without an npx fallback.

The target covers identity-checked global/npx wrapper packages and known
Claude/Codex Ruflo hook copies through SessionStart and the monitor. It does not
modify databases, kill processes, or replace modules already loaded by an MCP.
New wrapper launches activate immediately; existing MCP transports are untouched.
Retirement requires verified upstream behavior preventing misleading runtime
selection and hook fallback, not merely closure of the issue. Regression coverage:
`test/ruflo-wrapper-guard.mjs` and `test/ruflo-wrapper-runtime.mjs`.

## Contents

- [Install](#install)
- [Targets](#targets)
  - [Patch targets](#patch-targets)
  - [Plugin patches](#plugin-patches)
    - [ruflo-adr](#ruflo-adr)
    - [Ruflo plugins under Codex](#ruflo-plugins-under-codex)
    - [ruvnet-brain](#ruvnet-brain)
    - [MetaHarness under Codex](#metaharness-under-codex)
    - [all ruflo plugins](#all-ruflo-plugins)
  - [Script targets](#script-targets)
  - [Monitor](#monitor)
- [The patches in detail](#the-patches-in-detail)
  - [cwd](#cwd)
  - [daemon](#daemon)
  - [memory](#memory)
  - [adr-template](#adr-template)
  - [adr-index](#adr-index)
  - [adr-io-safety](#adr-io-safety)
  - [adr-reindex](#adr-reindex)
  - [verify-interface](#verify-interface)
- [The script targets in detail](#the-script-targets-in-detail)
  - [dual](#dual)
  - [plugin-only (dedupe)](#plugin-only-dedupe)
  - [codex-switch](#codex-switch)
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

`all install` applies every declared **patch** target (the CLI-composed ones and the `ruflo-adr` /
`ruvnet-brain` plugin ones) and schedules the monitor that keeps them live. It is the one-shot the
`Makefile` used to own alone; now the npx path has it too, and `make install` delegates to it so the
two can never list a different set. A behaviorally superseded target such as current Ruflo's `daemon`
target terminally retires without editing pristine vendor bytes. `all uninstall` / `all status` do the
reverse and the readout.

The **script targets stay opt-in**, because they change *your projects or user-level integrations*
rather than the patched library.
They are also the most immediately useful thing here, so don't skip past them, and `run` executes
one directly, no separate install step:

```bash
npx github:sparkling/ruflo-source-patch dual run <project>       # one instruction file for Code + Codex
npx github:sparkling/ruflo-source-patch plugin-only run . --dry-run   # strip the ~260 duplicated files + hooks + MCP registration
npx github:sparkling/ruflo-source-patch ruflo-codex-hooks run     # add canonical Ruflo hooks to an existing Codex install
npx github:sparkling/ruflo-source-patch codex-switch run copilot   # continue THIS Codex thread on the Copilot proxy
```

See [The script targets in detail](#the-script-targets-in-detail).

To pick patch targets individually instead of `all`:

```bash
npx github:sparkling/ruflo-source-patch cwd install
npx github:sparkling/ruflo-source-patch daemon install
npx github:sparkling/ruflo-source-patch memory install
npx github:sparkling/ruflo-source-patch init install
npx github:sparkling/ruflo-source-patch plugin-hosts install
npx github:sparkling/ruflo-source-patch ruflo-instruction-contract install
npx github:sparkling/ruflo-source-patch ruflo-model-contract install
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
| **`ruflo-memory-stats`** | Uses the existing AgentDB registry connection instead of a raw sql.js probe; complete active/legacy-NULL and embedding-presence counts, safe arbitrary namespaces, explicit unavailable state. No WAL manipulation or competing driver. | [#3311](https://github.com/ruvnet/ruflo/issues/3311) |
| **`ruflo-wrapper-guard`** | Restores `ruflo`, selects the newest installed stable CLI instead of the first older nested dependency, and delegates version/CLI/MCP behavior to that implementation. No launch-time downloads or process kills; malformed/broken selection fails visibly. Known lifecycle shims retain direct installed CLI execution. | [#3306](https://github.com/ruvnet/ruflo/issues/3306) |
| **`cwd`** | **Silent data loss.** Residual `.claude-flow` / `.swarm` state in current Ruflo still follows raw or implicit cwd in permission state/audit, swarm state, neural-weft defaults, generated helpers, hook-session state, and other durable-state paths. The target anchors the resolver, callees, and implicit-relative constants; Ruflo 3.38.16's native daemon resolver is recognized as satisfied and left pristine. Legacy and 3.38.16 session-end shapes atomically write the snapshot they advertise, and unknown future shapes fail loudly. A leak detector remains because textual coverage cannot prove completeness | [#2633](https://github.com/ruvnet/ruflo/issues/2633) |
| **`daemon`** | **Retired on executable proof in Ruflo 3.38.11+.** Older releases need direct start/stop/status/supervisor paths normalized to one project-root lock/PID identity. Current releases export and use `resolveDaemonProjectRoot()` throughout; retirement executes nested, nested-project, `.git` stop, and no-marker behavior and rejects route/resolver mutations | [#2877](https://github.com/ruvnet/ruflo/issues/2877) · [#2633](https://github.com/ruvnet/ruflo/issues/2633) |
| **`memory`** | Keeps an explicit project/user database path an authority boundary: one long-lived bridge process gets one canonical registry state per database instead of silently reusing whichever store opened first. Above Ruflo 3.38.12's native #2878 shared-lock baseline it also retains stricter token/inode-safe fail-closed lock ownership and outer fallback/bridge serialization, **WAL-sidecar refusal**, an **integrity gate**, and a **stale-writer guard**. The monitor restarts only positively resolved pre-patch daemons. It detects and reports stale MCP clients but never kills them because only their owning host can reconnect the stdio transport; `RSP_NO_STALE_WRITER_KILL` disables daemon restarts | [#3143](https://github.com/ruvnet/ruflo/issues/3143) · [#2878](https://github.com/ruvnet/ruflo/issues/2878) · [#2735](https://github.com/ruvnet/ruflo/issues/2735) · [#2584](https://github.com/ruvnet/ruflo/issues/2584) · historical [#2621](https://github.com/ruvnet/ruflo/issues/2621) |
| **`init`** | **Stops `ruflo init`/`doctor` regenerating what the plugins provide.** The durable complement to [`plugin-only`](#plugin-only-dedupe). Disables the standalone `claude-flow` `.mcp.json` emission and the `.claude/{skills,commands,agents}` bundle gates (helpers kept). **Plugin-always deployments only:** the CLI hardcodes `mcp.claudeFlow: true` with no plugin-off flag, so on a plugin machine the standalone + bundle are pure duplicates (ADR-022). The legacy #2777 edit now applies only to builds that still shell out to the whole-repository `npx skills add`; Ruflo 3.32.10+'s bounded in-process `SKILL.md` materialization is left untouched | [#2640](https://github.com/ruvnet/ruflo/issues/2640) · [#2685](https://github.com/ruvnet/ruflo/issues/2685) · [#2777](https://github.com/ruvnet/ruflo/issues/2777) |
| **`plugin-hosts`** | Adds Ruflo-owned `plugins host-install`, `host-uninstall`, additive Claude-to-Codex `host-sync`, `host-update`, and bounded `host-refresh` commands. Installing or self-updating this patch automatically runs the all-installed update once through those injected commands. Normal version changes use each host's supported update/reinstall path; exact tree comparison also repairs same-version collisions. Claude user and active project/local scopes plus Codex are covered; disabled, managed, and orphaned-project registrations are preserved. Host CLIs are resolved through validated PATH/PATHEXT, effective-account and configured user roots (npm/pnpm/Volta/Bun/mise/asdf/Homebrew), plus revalidated persisted package roots, so a narrow PATH or migrated `HOME` cannot silently skip reconciliation. Stale canonical marketplace paths are repaired only through host CLIs; foreign same-named sources are refused. The bundled Codex initializer uses the same literal-argv boundary. Revision-specific fragment proof prevents an older injected body from reporting current. The patch never copies or directly edits host caches and reports partial completion as nonzero | [#2854](https://github.com/ruvnet/ruflo/issues/2854) · [#2870](https://github.com/ruvnet/ruflo/issues/2870) |
| **`ruflo-model-contract`** | Opens `agent_spawn.model` to an exact host-native ID while preserving Ruflo's existing non-alias `modelId` path. It keeps `hooks_model-route` as the legacy Haiku/Sonnet/Opus tier recommender, labels both router paths with `routingTier`, and declares allocation caller-owned. Astra/Fable selection therefore remains with the native executor or customised harness; a Ruflo tracking record cannot masquerade as execution proof. It uses the CLI composition engine so the routing edit and the existing `cwd` edit share one pristine `hooks-tools.js`; marker-free retirement requires schemas to accept both representative IDs and preserve the tier/allocation boundary | [#3215](https://github.com/ruvnet/ruflo/issues/3215) · related [#2357](https://github.com/ruvnet/ruflo/issues/2357) |

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
| **`adr-io-safety`** | Uses the installed native Ruflo runtime; makes verifier reads complete and fail-closed; separates the ADR scan root from one explicit managed database path; requires each importer write to survive a fresh managed readback; and refuses live purge-first reindex before any mutation. All three scripts preflight as one bundle, so a missing or drifted member leaves every member untouched | [#3147](https://github.com/ruvnet/ruflo/issues/3147) · [#3097](https://github.com/ruvnet/ruflo/issues/3097) |
| **`adr-reindex`** | Legacy additive reconcile for installations without a runnable native replacement. It retired after proving the native skill, purge command, and shared writer lock in Ruflo 3.38.12. That proof prevents concurrent lost updates but does **not** make purge plus rebuild atomic; `adr-io-safety` now refuses the residual destructive path until #3097 supplies one managed transaction or staging/swap | [#2666](https://github.com/ruvnet/ruflo/issues/2666) · [#2878](https://github.com/ruvnet/ruflo/issues/2878) · [#3097](https://github.com/ruvnet/ruflo/issues/3097) |

#### Ruflo plugins under Codex

Codex loads its own Ruflo marketplace snapshot and versioned caches. These targets change only those
Codex copies; Claude Code and Cursor plugin copies are left alone.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`ruflo-hooks-schema`** | **Retired on proof in Ruflo 3.32.39 / `ruflo-core` 0.2.6.** The compatibility edit removed unsupported manifest fields and Cursor-only PreToolUse output only from Codex copies. PR #2857 version-bumped the plugins and fixed both branches; retirement executes both real handlers before standing down | [#2801](https://github.com/ruvnet/ruflo/issues/2801) · [#2816](https://github.com/ruvnet/ruflo/issues/2816) · [PR #2857](https://github.com/ruvnet/ruflo/pull/2857) |
| **`ruflo-codex-skills`** | **Retired on proof in Ruflo 3.32.39.** Older copies needed one read-only `ruflo-core:ruflo-status` skill. The native replacement's default doctor/status path is now read-only and `doctor --fix` requires explicit repair intent | [#2821](https://github.com/ruvnet/ruflo/issues/2821) |

#### Ruflo instruction generators

Ruflo generates both Claude Code and Codex instruction files from installed package code. Actions:
`install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`ruflo-instruction-contract`** | Rewrites all six Claude and four Codex root templates, the generated Ruflo platform skill, and every packaged Codex task skill so routine swarm, agent, memory, hook, worker, workflow, session, claims, status, benchmark, and security work uses discovered structured MCP interfaces. It covers nested and standalone Codex packages, separates source truth from runtime health, corrects tool names and schemas, reserves direct shell for bootstrap/diagnostics, distinguishes native agents from Ruflo records, labels enterprise text as unconfigured scaffolding, and keeps memory failure non-blocking without raw database fallbacks. A genuine Ruflo CLI-only gap must use the Brain's managed bridge with `executable: "ruflo"`; it may not guess the absent legacy `claude-flow` binary. Existing roots and known installer skills migrate only through attributable exact revisions; custom policy survives. A poisoned pristine is recovered only when reversing and reapplying the exact recognized patch revision reproduces the live file byte-for-byte | [#3153](https://github.com/ruvnet/ruflo/issues/3153) |

#### ruvnet-brain

A different package/plugin surface, the same machinery, and the same reason to be a target: an npx
re-fetch, Brain bundle refresh, or `/plugin update` reverts a hand-edit silently.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`verify-interface`** | **Retired.** The predicate accepts either Brain's fixed command gate or its newer advisory-only raw-Bash hook backed by structured `ruvnet_cli_help` / `ruvnet_cli_run`, and rejects a partial blocking replacement | [stuinfla/ruvnet-brain#12](https://github.com/stuinfla/ruvnet-brain/issues/12) · [#48](https://github.com/stuinfla/ruvnet-brain/issues/48) |
| **`flywheel-daily`** | **Retired.** Upstream's atomic per-project/local-day claim passes repeat/day/project/enabled/eight-way-concurrency probes | [stuinfla/ruvnet-brain#53](https://github.com/stuinfla/ruvnet-brain/issues/53) |
| **`codex-hooks`** | **Retired and released natively in Brain 4.0.2.** Older Brain releases needed local Codex lifecycle packaging and a generation-stable adapter. The native manifest, six-event adapter, stable wrapper, installed/enabled plugin, and host-convergence receipt now pass as one replacement; `/hooks` trust remains user-owned | [stuinfla/ruvnet-brain#52](https://github.com/stuinfla/ruvnet-brain/issues/52) |
| **`brain-codex-skills`** | **Retired on executable proof in Brain 4.0.12.** The active immutable plugin payload contains the skill, manifest, curated notes, and `scripts/whats-new.mjs`; the installed executable returns its exact version and fails nonzero when the notes are removed. The retirement restores only locally owned legacy bytes and preserves the native workflow | [stuinfla/ruvnet-brain#76](https://github.com/stuinfla/ruvnet-brain/issues/76) · [PR #110](https://github.com/stuinfla/ruvnet-brain/pull/110) |
| **`brain-console-lifecycle`** | **Still live, narrowed to the doctor delta.** Published Brain 4.0.36 natively owns the whole-runtime digest, receipt, `/api/runtime`, token-bound shutdown, stale/foreign classification, and process replacement, so the patch preserves that launcher. The issue's acceptance contract also requires doctor to compare candidate bytes, persistent runtime, receipt, live endpoint, PID, and API identity; pristine 4.0.36 doctor still reads only `host-convergence.json`. The target adds that read-only live comparison and leaves Brain's updater and activation plane untouched | [stuinfla/ruvnet-brain#79](https://github.com/stuinfla/ruvnet-brain/issues/79) · [PR #110](https://github.com/stuinfla/ruvnet-brain/pull/110) |
| **`brain-console-provider-keys`** | **Retired on executable proof in Brain 4.0.12.** A copied active runtime stages and validates `model-catalog.json`, detects synthetic OpenAI/Google keys, refuses activation with the catalog missing, and renders the explicit `keysVerified: false` “Not checked” state instead of a false credential negative | [stuinfla/ruvnet-brain#86](https://github.com/stuinfla/ruvnet-brain/issues/86) · [PR #110](https://github.com/stuinfla/ruvnet-brain/pull/110) |
| **`brain-release-lockstep`** | Keeps Brain's read-only doctor and footprint reporting fail-closed on bundle/package/Stable-Spine/Claude/Codex version drift. The protected release rail now publishes 4.0.36 coherently, but pristine 4.0.36 doctor still compares only bundle versus Claude wrapper, calls drift “normal,” and excludes it from `allGreen`; the issue's doctor acceptance criterion remains open in its body. All eight exact 4.0.36 anchors still apply. The patch never invokes or changes Brain's updater, downloads, immutable versions, `active.json`, host caches, hooks, MCP, or learning runtime | [stuinfla/ruvnet-brain#77](https://github.com/stuinfla/ruvnet-brain/issues/77) |
| **`brain-memory-doctor-roots`** | **Retired on executable proof in Brain 4.0.12.** The active standalone doctor finds common and configured roots without `~/Code`, preserves explicit-root scope, fails an all-invalid configured set, falls back safely from malformed configuration, and shares `candidateRoots()` / `findStores()` with the Console | [stuinfla/ruvnet-brain#81](https://github.com/stuinfla/ruvnet-brain/issues/81) · [PR #93](https://github.com/stuinfla/ruvnet-brain/pull/93) |
| **`brain-managed-memory-boundary`** | Keeps the direct managed-store boundary complete above published Brain 4.0.36. #102's structural detector and #103's opt-in `managedMemoryBoundary` setting are native and preserved. The default remains advisory, host non-execution is explicitly unproved, and the audited diagnostic plus truthful doctor/Console states are absent. The target adds only default refusal and the bounded diagnostic and never touches Brain's native update plane | [stuinfla/ruvnet-brain#102](https://github.com/stuinfla/ruvnet-brain/issues/102) · [#103](https://github.com/stuinfla/ruvnet-brain/issues/103) · follow-up to [#48](https://github.com/stuinfla/ruvnet-brain/issues/48#issuecomment-5169487947) |
| **`brain-search-safety`** | Fixes the active shared KB's deterministic `constructor` query crash by accepting only own array-valued symbol entries. It also keeps total retrieval failures loud while removing the unconditional `npm install` and GitHub-npx instructions that made a source defect trigger an unrelated live-runtime “repair.” The target patches only three executable KB files after native activation; it never changes stores, sidecars, models, updater state, version identity, or release selection | [stuinfla/ruvnet-brain#224](https://github.com/stuinfla/ruvnet-brain/issues/224) · [#225](https://github.com/stuinfla/ruvnet-brain/issues/225) |
| **`brain-dual-host-receipt`** | Preserves Brain's complete subscription-only dual-host deliberation while removing its direct `ruflo memory store` child process. The coordinator emits an exact `memory_store` request for its MCP-aware caller and reports learning persisted only when an injected callback proves the same key was stored and read back. It patches the already-active persistent runtime and deployed helper after native activation; it does not touch Brain releases, updater state, AgentDB files, WAL sidecars, host authentication, or model execution | [stuinfla/ruvnet-brain#272](https://github.com/stuinfla/ruvnet-brain/issues/272) |
| **`brain-dual-host-stdin`** | Keeps complete cross-host proposals and critiques off argv, where Linux caps a single argument at roughly 128 KiB on common 4 KiB-page systems. It pipes the prompt to both native subscription CLIs over stdin without truncation or plaintext temporary files, while retaining Claude's plan/tool boundary and Codex's ephemeral read-only boundary | [stuinfla/ruvnet-brain#273](https://github.com/stuinfla/ruvnet-brain/issues/273) |

Codex does not turn third-party plugin commands into root slash commands like Claude Code does. Browse
these through `/skills`, or invoke them explicitly as `$ruflo-core:ruflo-status`,
`$ruvnet-brain:brain-console`, `$ruvnet-brain:rvbc`, and `$ruvnet-brain:whats-new`.
A new Codex session is required after install because the session loads its skill inventory at
startup. Brain 4.3.3 still exposes the Codex half of the live-update edge now tracked in
[#223](https://github.com/stuinfla/ruvnet-brain/issues/223): fresh sessions must discover only the
registry generation, while an already-open session must retain a readable catalog path until its
lease/grace period ends. [#128](https://github.com/stuinfla/ruvnet-brain/issues/128) fixed stale
fresh-session discovery, and [#153](https://github.com/stuinfla/ruvnet-brain/issues/153) added
PID-incarnation leases for Claude's cache. The shipped pruning path and `.in_use` leases remain
Claude-only; Codex's host-native refresh can therefore delete the absolute versioned skill path held
by a live boot catalogue. There is deliberately no downstream cache/updater shim: save work and
restart the affected Codex session once to rebuild its catalogue, then wait for the upstream
dual-host lease/GC fix.

#### MetaHarness under Codex

MetaHarness declares lifecycle hooks in its host-neutral `HarnessSpec`, but the exact published
`metaharness@0.4.7` and `@metaharness/host-codex@0.1.2` Codex renderers still discard them. This package
target patches only authenticated installed runtime files. Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`metaharness-codex-hooks`** | Converts non-empty declared hooks into a strict project `.codex/hooks.json` and a project-local Node bridge. It translates the outer tool matcher to Codex's regex surface, enforces any inner command/path glob against event input, resolves helpers from nested working directories, rejects unsupported events and non-command handler kinds, and leaves hook-free harnesses unchanged. It never edits Codex trust; users still review generated hooks with `/hooks`. The local patch repairs the runtime renderers only. Template, CLI-model, and Studio declaration plumbing remains part of the upstream fix | [ruvnet/metaharness#168](https://github.com/ruvnet/metaharness/issues/168) |

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
| **`codex-switch`** | **Continue one Codex thread on a different account.** Keeps the resume UUID and all visible conversation/tool history while moving between the ChatGPT subscription (`openai`) and a GitHub Copilot seat behind a local Responses proxy (`copilot`). Removes only provider-private encrypted replay state, at a boundary, against a SHA-256-verified backup; refuses an active session, an unrecognised encrypted location, and an undefined Copilot profile. ([ADR-030](docs/adr/ADR-030-codex-switch-one-resume-id-across-providers.md)) |

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

| Form | Findable by a raw-cwd search? |
|------|-------------------------------|
| `path.join(process.cwd(), '.claude-flow', …)` | yes |
| `resolve('.claude-flow/data')` | **no**. A one-arg `resolve()` is *already* cwd-relative, so there is no `process.cwd()` token to find |
| `applyChampion(process.cwd())` | not at the state path. The callee builds it from a parameter |

A grep-driven patch therefore cannot be complete. And **an incomplete one is worse than none**, because it
splits writers from readers. We shipped exactly that: `getProjectCwd` (the **reader** of
`harness-active-policy.json`) was anchored while `applyChampion` (its **writer**) still followed the
drifted cwd, so the reader looked at the project root for a file the writer had put elsewhere and silently
found nothing. Unpatched, both sides at least agreed on the drifted directory. Fixed in 4.16.0.

#### What it does

Ported from [`sparkling/ruflo`](https://github.com/sparkling/ruflo)'s ADR-0100 and ADR-0137. The original
fork audit triaged every then-known call site, but release validation now measures the declared entry
set and scans every discovered runnable build rather than preserving stale grep totals.

**The resolver**, by marker priority: `.ruflo-project` sentinel, then `CLAUDE.md` **and** `.claude/` (both
required, so a `docs/CLAUDE.md` is not mistaken for a project), then `.git`, then the start dir unchanged.
`.git` alone is not enough: a monorepo package has its own `.claude/` and no `.git`, so a bare `.git` walk
sails past it and pools every package's state into one store. Memoised per **resolved start dir**, never at
module load, because a module-level cache goes stale precisely when the cwd drifts.

**Anchored at the callee, not the call site.** One edit fixes every caller, present and future:

| Anchored | Where |
|----------|-------|
| `ensureDaemonRunning`, `getDaemon`, `startDaemon` | `services/daemon-autostart.js`, `services/worker-daemon.js`; current native `resolveDaemonProjectRoot()` is accepted without an edit |
| `getMemoryRoot` + config paths | `memory/memory-initializer.js` |
| `getProjectCwd` | `@claude-flow/cli-core` · `mcp-tools/types.js` |
| `applyChampion`, `applyChampionParams`, `rollbackActivePolicy` | `config/harness-feedback-applier.js` |
| `getDataDir` (neural), `defaultMemoryDbPath`, `defaultTunedConfigPath`, `createClaimService`, `runHarnessLoopWorker` | `memory/`, `services/` |
| `STATE_DIR` (the implicit-relative case) | `autopilot-state.js`. Patching the **constant** fixes all five `resolve()` sites, since `resolve(<absolute>)` returns it unchanged |
| Permission state and audit paths | `security/permission-manager.js`, `security/permission-audit.js` |
| Swarm state reads | `commands/swarm.js` |
| Neural-weft export defaults and generated helpers | current `commands/neural.js` plus authenticated generated helper copies |
| Session snapshots and pending-insight reads | release-shaped entries in `mcp-tools/hooks-tools.js`; snapshots are atomically written before their absolute `statePath` is returned |

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

Legacy compatibility for daemon multiplication: one daemon per project **root**, not one per directory
you happen to start it from. It is terminally retired on current Ruflo after executable proof.

#### Historical failure and current native replacement

In clean `@claude-flow/cli` **3.33.0**, `commands/daemon.js` anchored its own state
(`.claude-flow/`, `daemon.pid`, and the native dedup lockfile itself) to raw `process.cwd()`.
The #2407/#2484 lock correctly serializes starts in the **same directory**, but starts elsewhere
in the same project use different lock and PID paths. Direct `daemon` commands skip autostart,
so the `cwd` patch's normalization of `daemon-autostart.js` cannot cover them.

Measured with four concurrent foreground starts from four subdirectories:

| | Before | After |
|---|---|---|
| 4 from 4 different **subdirs** | **4 live daemons, 4 subdirectory PID files** | **1 daemon, 1 root PID file** |

Ruflo 3.38.11+ exports `resolveDaemonProjectRoot()` and routes autostart plus direct
start/stop/status/trigger/supervisor identities through it. This package accepts those vendor bytes as
**native-satisfied**, not patched. Retirement executes the installed resolver: a nested cwd resolves to
the nearest Ruflo root, an independently initialized nested project wins, `.git` stops upward escape,
and a directory with no marker stays itself. It also rejects any old raw-cwd identity sink. A resolver
or route mutation keeps the target live; mixed old/new installations are patched or preserved per copy
and do not retire prematurely.

Older releases still receive the exact #2877 compatibility transform. The patch leaves Ruflo's native
lock algorithm byte-for-byte unchanged and canonicalizes only its project identity. The
`const cwd = process.cwd();` path-validation guard remains deliberate security policy. Broader durable
state rooting remains tracked by [#2633](https://github.com/ruvnet/ruflo/issues/2633).

### `memory`

Fixes three distinct memory authority failures: a long-lived bridge silently reusing the wrong
database, concurrent writers silently dropping acknowledged writes, and raw whole-image access that
is unsafe while a native WAL connection is attached.

`memory.db` is written by **two different SQLite engines**: the AgentDB bridge
(better-sqlite3, **WAL mode**) and a fallback that does a whole-file read-modify-write
(sql.js: `db.export()` → atomic rename). Ruflo 3.25.2 made those flushes atomic
([#2585](https://github.com/ruvnet/ruflo/pull/2585)), closing the *torn-write* class. The distinct
durability failures reproduced in 3.33.0 were cross-process lost updates
([#2878](https://github.com/ruvnet/ruflo/issues/2878), focused follow-up to closed #2621) and
WAL-incoherent sql.js access. Ruflo 3.38.12 now routes ordinary sql.js writers through native
`withMemoryDbLock()`. This target retains the stronger fail-closed ownership/outer-serialization delta,
WAL refusal, integrity gate, and stale-writer recovery. It separately repairs the bridge identity
defect tracked by [#3143](https://github.com/ruvnet/ruflo/issues/3143).

#### The database path is an authority boundary

`memory-bridge.js` accepts an explicit `dbPath`, but Ruflo 3.38.20 stores `registryPromise`,
`registryInstance`, availability, and failure reason in four module-global variables. After the first
successful open, every later call returns that same registry without comparing the requested path.
Measured in one process against two populated stores:

```text
project A -> user B    6,462 project rows -> 0 user rows
user B -> project A      212 user rows    -> 212 user rows, including a user-only key
```

The reverse-order result proves this is wrong-store reuse, not search quality or corruption. A live
WAL only makes the downstream fallback refusal visible; refusing raw access is correct and must not
be removed to hide this symptom.

The patch keys the complete bridge state by a canonical database identity: absolute path, plus
`realpath` for an existing file or its existing parent. Initialisation promises deduplicate one path, while project and user
stores retain independent instances, availability, failure reasons, and shutdown lifecycles. First
initialisations are queued because upstream temporarily replaces process-global `console.log`; after
initialisation, operations remain independent. The regression suite proves A -> B, B -> A, concurrent
reads, symlink identity, path-scoped availability and diagnostics, scoped shutdown, and all-registry
shutdown. Retirement requires upstream #3143 to pass those behaviors through the shipped bridge API.

#### The write lock

`storeEntry`, `getEntry`, `deleteEntry`, `applyTemporalDecay`, `ensureSchemaColumns`,
`initializeMemoryDatabase`, and purge fallback can perform whole-file read-modify-write. Two
processes can each read image *v1* and each rename; the second silently clobbers the first.
Per-write atomicity cannot fix this. Only mutual exclusion spanning read..write can.

The local `<db>.rsp-lock` uses `O_EXCL`, is reentrant only within the current async call
context, and serializes unrelated sibling Promises in the same process. It **fails closed**:
an unresolved path, filesystem error, or five-second timeout throws
`RSP_MEMORY_LOCK_UNAVAILABLE` before the operation runs. A unique claim token plus inode check
prevents a late release from deleting a successor's lock. It never steals by age; a crash may
leave a lock requiring explicit inspection/removal, because age is not proof of death and
`unlink` is not compare-and-delete.

Historical measurement on clean 3.33.0 with the fallback forced:

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
direct path, the plugin MCP client's `.bin/cli` symlink, the public `.bin/ruflo` thin wrapper, or an
authenticated `ruflo` / `claude-flow` launcher under a custom PATH prefix that contains no npm binary.
The public wrapper is what `npx ruflo@latest mcp start` actually leaves running; discovery validates
package identities before following Ruflo's bounded nested/hoisted-dependency walk. What the guard *does* depends on
whether the on-disk copy is actually patched:

- **A `pre-patch` daemon** (copy patched, process older) is killed and restarts on current bytes at
  next use. A `pre-patch` MCP client is detected and reported but never signalled: the detached
  monitor cannot reconnect the owning Codex/Claude stdio transport. The host performs a controlled
  `/mcp` reconnect when the user is ready. This prevents a scheduled repair from turning a safe
  source update into machine-wide `Transport closed` failures.
- **An `unpatched` writer** (copy lacks the current fail-closed lock, either because the patch could
  not apply or because the older fail-open wrapper remains): **never auto-killed**, because a respawn
  would reload the same unsafe bytes. That's patch drift; the fix is re-anchoring (the drift
  machinery already flags it).

`RSP_NO_STALE_WRITER_KILL` keeps detection but disables daemon restarts; `monitor run` triggers the
same bounded recovery and reports MCP clients that still need their host to reconnect them.

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

### `adr-io-safety`

Keeps an unreadable or partially written ADR graph from looking healthy.

Current `ruflo-adr` 0.4.1 has three coupled I/O defects:

- `verify.mjs` maps spawn failures, nonzero exits, and malformed JSON to `[]`, omits `--limit`, and
  can certify an unreadable or truncated graph as a healthy `0/0` graph.
- `import.mjs` uses `ADR_ROOT` as both scan scope and database cwd, launches one serial `npx` process
  per row, accepts a successful-looking receipt without proving persistence, and exits zero in both
  output modes after failed writes.
- `reindex.mjs` purges the live namespaces before rebuilding. A shared lock prevents concurrent
  writers, but a later failure can still leave the graph empty or partial; the purge and rebuild are
  not one transaction.

The patch treats `verify.mjs`, `import.mjs`, and `reindex.mjs` as one bundle. Every active Claude and
Codex marketplace/cache copy must contain all three regular files and every exact anchor before any
file is written. Status counts expected files before reading them, so a missing member reports `0/3`,
not the false comfort of `0/2`.

At runtime, the ADR scan directory and managed store identity are separate. The patch resolves a
canonical project root from an explicit marker, honors `ADR_DB_PATH` / `ADR_DB_ROOT` and Ruflo's
managed-memory configuration, rejects a symlink/non-regular database, and passes one absolute
`--path` to every managed CLI call. Those calls use the installed `ruflo` executable. Its doctor and MCP
own the live native AgentDB driver; they do not use a fresh `npx @claude-flow/cli@latest` cache. On hz,
both commands reported 3.38.20, yet npx loaded sql.js and could not see a live WAL while installed Ruflo
loaded native `better-sqlite3` and returned all 95 ADR rows. `RUFLO_ADR_CLI` permits only an explicit
absolute executable override; a missing installed CLI fails closed and never falls back to npx.

The verifier requests a bounded complete namespace with an explicit cap-plus-one, parses the whole
stdout as JSON, validates every row and namespace, and treats spawn, signal, timeout, nonzero,
malformed output, a bad edge key, or an unproved cap as fatal. A successfully read empty graph remains
valid.

The importer keeps the serial compatibility path because current `memory import` cannot yet prove
durable writes. It preflights both namespaces before storing, fails on the first bad write, and accepts
a write only after a fresh managed process retrieves the exact raw bytes. A final complete key-set
comparison rejects missing and extra rows; JSON and Markdown share nonzero failure semantics.

Live reindex is intentionally unavailable under this patch. Non-dry-run execution exits nonzero before
calling purge or any writer and explains the missing atomic contract. Dry-run remains a read-only scan.
Upstream can retire the target by providing either one managed transaction covering stale-row removal,
upserts, and invariant proof, or a staging namespace/database followed by one atomic pointer/swap. A
strict batch that runs **after** a separate purge is still unsafe.

### `adr-reindex`

> **RETIRED for compatibility, but not a complete safety proof.** `ruflo-adr` 0.4.0+ ships `/adr-reindex`
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
> So the legacy retirement asks all three compatibility questions: **does this machine have the native skill,
> `memory purge`, and one lock shared with ordinary writers?** Only all three permit retirement.
> Otherwise it keeps our raw-SQL script and never overwrites upstream's skill file. That closes the
> concurrent-writer gap; it does not make purge and rebuild all-or-nothing. `adr-io-safety` owns that
> newer residual and refuses live reindex until [#3097](https://github.com/ruvnet/ruflo/issues/3097)
> has an atomic managed replacement.

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

Because the delete precedes the rebuild, a failed rebuild can leave an **empty or partial** graph. The
files remain the source of truth, but "re-run it" is recovery after an avoidable destructive gap, not
an atomicity guarantee. The current `adr-io-safety` target therefore blocks this live path before purge.

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

### `codex-switch`

Continues **one** Codex resume ID while changing which account pays for it. Run it from the project
directory; the session is pinned after the first use:

```bash
npx github:sparkling/ruflo-source-patch codex-switch run status
npx github:sparkling/ruflo-source-patch codex-switch run copilot
npx github:sparkling/ruflo-source-patch codex-switch run openai
```

The UUID and every visible message, tool call and protected assistant-message block are retained. Only
provider-private encrypted replay items (`reasoning`, `compaction`, `context_compaction`) are removed,
and only at a boundary. The other provider rejects those items, and the symptom is a stream that closes
before `response.completed` rather than an error you can read. The retained content is hashed before
and after; a mismatch restores the original. The pre-switch bytes are kept as a SHA-256-verified
backup under `~/.local/state/codex-switch/backups/<uuid>/`.

It refuses, changing nothing, when: another writer holds the session lock (exit Codex first), the
rollout carries encrypted content in a location it does not recognise, or the `copilot` profile is not
defined. That last one matters more than it looks. Codex does **not** error on an unknown `--profile`,
it silently uses the default provider, so without the check a "Copilot" switch would quietly bill the
subscription.

`copilot` needs a Codex profile pointing at a Copilot-compatible Responses proxy. The template is
materialized beside the script as `codex-switch-profile.toml`; copy it to `~/.codex/copilot.config.toml`
(user-level, because project config cannot redirect providers) and run the proxy, pinned to an exact
version:

```bash
npx @jeffreycao/copilot-api@1.15.0 auth        # once
npx @jeffreycao/copilot-api@1.15.0 start --port 4141
```

Verify a switch actually reached the proxy: it must log `POST /responses 200`. Never pin the proxy to
`@latest`. It holds credentials and sits between every request and response, so every version bump is a
security review.

Flags: `--session UUID` (pin explicitly), `--force-boundary`, `--prepare-only`, `--dry-run`, and
`--safe`, which drops the default `--yolo`. Everything after a bare double-dash separator is forwarded
to Codex, except `--profile`, which is refused; the provider is chosen by the subcommand.

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
`ssh` server is a real capability, not a duplicate, and is kept). When a host migration leaves the same
local standalone under an absolute project root that no longer exists, the sweep removes only that dead
Ruflo entry; entries for other live projects and every unrelated/remote server remain untouched. By
**default** it also **SIGTERMs the
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

The invariant is **immutable provenance**, not location. For a package/cache source, the stable copy
must match the exact source it was synced from, recorded at sync time. For a mutable Git checkout,
an explicit mutating command is the review/deployment boundary: the timer never follows later edits.
(Diffing against the globally-installed package is the obvious answer and it's wrong. Develop from a
clone and the global is *older*, so the CLI would sync your clone in and the monitor would dutifully
heal it **backward** to the stale release, the two writers fighting on a timer. The fuzz suite caught
exactly that.) Immutable package drift self-heals on a monitor tick; mutating commands refresh either
source. `monitor status` discloses a checkout as manual, while immutable drift remains a failing gate:

```
[monitor] STALE LIB: 9 module(s) behind the installed package — the hook and monitor are running OLD code
[monitor] stable: manual — source is a mutable Git checkout; timer auto-heal is disabled until an explicit install
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
Target `status`, `monitor status`, `monitor check`, and `all status` now use the same outcome contract:
patched and behaviorally native files are satisfied; a tracked zero-file target, partial target, or
uncovered runnable build prints a failure glyph and exits nonzero.

## How a patch retires itself

Every target here is temporary by design: upstream is supposed to fix these, and when it does, the
patch should get out of the way. It should not need me to notice, or you to run anything.

### Publish a predicate, not a verdict

The obvious mechanism is a list of *fixed* issues that the monitor reads and acts on. It is the wrong
mechanism, and this week showed why twice:

| Issue | Closed? | Fixed? | Runnable on your machine? |
|---|---|---|---|
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) | yes | historical partial fix; [#2878](https://github.com/ruvnet/ruflo/issues/2878) supplied the focused ordinary-writer lock | only after the installed writer set is proved, not from either label |
| [#2666](https://github.com/ruvnet/ruflo/issues/2666) | yes | current Ruflo has the complete native pieces | yes only after executing the installed skill/purge route and proving every ordinary writer shares its lock |

`closed` is not `fixed`, and `fixed` is not `runnable here`. `ruflo-adr` ships from the marketplace the
instant it lands; the `memory purge` its `/adr-reindex` calls shipped on npm **separately**. For a window
the skill was installed and the command it invokes did not exist. An unknown subcommand exits 0, so
it reported `adr-patterns: purged` having purged nothing. Later builds had a purge-only lock. Ruflo
3.38.12 finally routes purge and every ordinary sql.js writer through `withMemoryDbLock()`. This
repository retires the legacy command only after it proves that complete installed set. The stronger
local `.rsp-lock` overlay is also accepted; the version alone is not.

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

The running version comes from the package that owns the provenance-recorded `lib/` directory. A former
off-by-one path lookup searched for `package.json` *inside* `lib/`, resolved no version, and silently
disabled this entire comparison; the real stable-copy layout is now a regression fixture.

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
(`~/.npm/_npx/`), plus any global `npm i -g` install. Global discovery follows authenticated
`ruflo`, `claude-flow`, and `claude-flow-mcp` launchers on PATH, so a custom prefix remains visible even
when its `bin` directory has no npm executable. That shared binary is what gets patched, so
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
| **S1 to S9** | the **stable copy**, the code the hook and monitor actually *run*. `~/.ruflo-source-patch/lib` is an executable, not a cache. Provenance is recorded · immutable package drift **fails `monitor check`** and self-heals · mutable Git checkout edits remain manual and are never timer-deployed · an explicit mutating command refreshes either source · non-`.mjs` assets reach the copy too |
| **E1 to E3** | the **error path**. A patch that **throws** is counted, summarised, exits nonzero, and reaches the notifier. Before: logged, counted nowhere, matched by none of *three divergent* regexes, and summarised as `nothing to do` |
| **A1 to A2** | an **ambiguous anchor** is refused, never guessed at. Uniqueness is a property of *upstream's* code (a measurement, not a promise), so it is checked on every apply |
| **RB1 to RB5** | a **re-baseline hands over instructions**, not just a warning: the real `diff` command, what to look for in the new code, and how to back the patch out. And an *ordinary* problem does **not** print the essay |
| **V1 to V7** | **`verify-interface`**, behavioural rather than textual. The unpatched fixture really does block (else all of it is vacuous, and V1 caught exactly that on its first run) · the false positives are gone · **an unread interface still blocks** · and a **partial apply writes nothing**, because these five edits are interdependent |
| **CC · ML · IG/WG** | **concurrency and memory safety.** Three simultaneous installs lost a target in **12 runs out of 12** before `state.json` got a lock; one fail-closed transaction now covers state + disk. ML executes the injected lock across two processes (80/80 updates), unrelated sibling Promises (40/40), nested reentry, acquisition failure, and late-release ownership. IG/WG execute the real image guards: healthy/fresh files pass, torn or unverifiable files fail, live WAL sidecars refuse without mutation, and the former checkpoint shim is absent |
| **CL · K** | **`cleanup`**, the only command that removes directories and signals processes. `--dry-run` deletes nothing · the project's own state **survives** · `$HOME` is refused · and **K3: another project's daemon survives.** Real processes, real `pgrep`/`lsof`/`ps` |
| **SS · MI · DH** | the **SessionStart hook** actually re-applying to a fresh npx copy · the plist, cron spec and interval clamp · and the offline `dual` host-boundary harness proving policy/MCP preservation, rollback, migration, and symlink refusal |
| **CW · DN · AR-N** | exact Ruflo 3.38.16 residual cwd/session shapes · native daemon resolver execution plus route/resolver mutations and terminal retirement · native reindex writer-lock proof plus an unlocked-writer mutation and nested public-wrapper discovery |
| **CS** | **Codex skill rendering, ownership, and #76 retirement.** JavaScript replacement tokens remain literal · active immutable notes execute with their exact version · a missing-notes mutation fails closed · an owned malformed render migrates from verified pristine · retirement restores only vendor bytes |
| **BNR** | **Brain native retirement.** #81 common/configured/scoped/invalid discovery · #86 packed/staged catalog, synthetic provider keys, missing-catalog refusal, and UI truth state · deliberate regressions fail · simultaneous composed retirement does not re-apply a sibling |
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

Issue state is evidence to inspect, never the retirement signal. The full audit was refreshed on
2026-08-15 against exact published Ruflo 3.38.12, `ruflo-core` 0.2.6, active Claude/Codex caches,
published Brain 4.0.36, current upstream issue threads, and exact installed behavior. A focused
2026-08-31 revalidation reproduced Ruflo #3143 on 3.38.20 and the Codex cache-lifecycle gap in active
Brain 4.3.3. It also reproduced the `ruflo-adr` verifier/import/reindex boundary in current main and
active 0.4.1 host copies. #2877 and the legacy #2666 compatibility target retire on executable native
proof; #2878 supplies the native ordinary-writer baseline, while #3097 records the still-non-atomic
purge/rebuild and #3147 records incomplete fail-open reads. Brain #76, #81, and #86 remain retired after
executable replacement and mutation proof.
#79 remains narrowed despite closure; #77's release rail is fixed but its doctor acceptance remains
incomplete; #223 tracks the missing Codex live-generation lease after #128/#153; and #129/#130
track native update-plane defects that this downstream package must not replace. MetaHarness #168
remains reproducible in `metaharness@0.4.7` and `@metaharness/host-codex@0.1.2`.

**"Fixed upstream" is a claim about a runnable artifact, not a branch, version string, or
closed label.** The table records the full acceptance result.

| Issue | Verified verdict | Local result |
|-------|------------------|--------------|
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) | **Closed historical/incomplete.** Its quoted-sequence fix did not make ordinary writers share a lock | Superseded as the active acceptance target by focused #2878 |
| [#2878](https://github.com/ruvnet/ruflo/issues/2878) | **Closed and delivered for the ordinary-writer baseline in 3.38.12.** `ensureSchemaColumns`, temporal decay, store, get, delete, and purge share native `withMemoryDbLock()` | Keep `memory` only for its stronger fail-closed ownership/outer serialization, WAL refusal, integrity gate, and stale-writer recovery |
| [#3143](https://github.com/ruvnet/ruflo/issues/3143) | **Open and reproduced in 3.38.20.** `getRegistry(dbPath)` accepts a path but returns one process-global registry after the first open; availability and failure state are global too. Project-first hides the user store, while user-first makes a project request return user rows | Keep the path-keyed `memory` bridge overlay. Retire only after executable A -> B, B -> A, concurrent-open, canonical-alias, per-path-failure, and scoped/all-shutdown proof |
| [#2633](https://github.com/ruvnet/ruflo/issues/2633) | **Open, residual live in 3.38.16.** Durable permission/swarm/neural/helper/hook-session state still has raw or implicit cwd paths; daemon identity is fixed separately by #2877 | Keep `cwd` and `cleanup`; release-shaped session repairs fail closed on drift, and `daemon` retires on native proof |
| [#2634](https://github.com/ruvnet/ruflo/issues/2634), [#2635](https://github.com/ruvnet/ruflo/issues/2635), [#2636](https://github.com/ruvnet/ruflo/issues/2636), [#2637](https://github.com/ruvnet/ruflo/issues/2637) | **Fixed completely** in 3.32.36/3.32.37: backed skills, adapter fallback, both native scaffolds, root secret ignores | `dual` remains for #2638 and its stricter transaction, not these defects |
| [#2638](https://github.com/ruvnet/ruflo/issues/2638) | **Open.** Claude and Codex instructions still have separate generators | Keep `dual` |
| [#2640](https://github.com/ruvnet/ruflo/issues/2640) | **Open, partial.** Atomic event claims prevent duplicate side effects, but init still emits the duplicate bundle/hooks/MCP | Keep `init`, `plugin-only` |
| [#2651](https://github.com/ruvnet/ruflo/issues/2651) | **Fixed completely** in 3.32.37 | No patch |
| [#2659](https://github.com/ruvnet/ruflo/issues/2659) | **Fixed completely for active hosts.** The automatic plugin refresh delivered current parser bytes and all four active Claude/Codex marketplace/cache copies pass the creator/indexer round trip | `adr-template` retires locally on executable proof; #2870 independently tracks the reused identity |
| [#2660](https://github.com/ruvnet/ruflo/issues/2660) | **Fixed completely for active hosts.** All active Claude/Codex copies execute native convergence and honest counting, and native `adr-index` routes deletions to native `adr-reindex` | `adr-index` retired on local proof; #2870 remains a separate release-identity issue |
| [#2666](https://github.com/ruvnet/ruflo/issues/2666) | **Closed and complete for its compatibility/locking scope in the exact 3.38.12 installation.** Native reindex/purge exist and purge shares `withMemoryDbLock()` with every ordinary sql.js writer. That does not prove the later purge-plus-rebuild sequence is atomic | `adr-reindex` remains retired; `adr-io-safety` separately refuses the residual destructive path tracked in #3097 |
| [#3097](https://github.com/ruvnet/ruflo/issues/3097) | **Open and reproduced in current main / active `ruflo-adr` 0.4.1.** Scan root and database identity are conflated; failed stores can exit zero; serial per-row startup has no timeout; the plugin's npx child can select a different storage driver from installed Ruflo; and purge-first reindex can erase the live graph before a later failure | Keep `adr-io-safety`: installed-Ruflo runtime, exact store path, managed preflight, fresh-process byte readback, fail-fast/nonzero import, and zero-mutation live-reindex refusal until one atomic managed reconcile exists |
| [#3147](https://github.com/ruvnet/ruflo/issues/3147) | **Open and reproduced in current main / active `ruflo-adr` 0.4.1.** Verifier failures become `[]`, the default 20-row page is treated as complete, malformed edges are silently skipped, and same-version npx/installed Ruflo can read through different drivers | Keep `adr-io-safety` until the installed verifier uses the live managed runtime, proves complete namespace reads, and fails every spawn/signal/timeout/nonzero/parse/schema/cap error while preserving a genuine empty graph |
| [#2672](https://github.com/ruvnet/ruflo/issues/2672) | **Correctly retracted / not planned.** Its premise was false | No patch |
| [#2685](https://github.com/ruvnet/ruflo/issues/2685), [#2706](https://github.com/ruvnet/ruflo/issues/2706) | **Fixed completely.** Fleet and missed core references are native | `mcp-prefix` retired |
| [#2765](https://github.com/ruvnet/ruflo/issues/2765) | **Fixed completely** in 3.32.36 | No patch |
| [#2777](https://github.com/ruvnet/ruflo/issues/2777) | **Fixed completely** in 3.32.10 | `init` retains shape-gated legacy compatibility only |
| [#2801](https://github.com/ruvnet/ruflo/issues/2801) | **Fixed completely** after registration plus the 3.32.39 version-bumped strict manifest | One-shot repair only for old installs; schema target retired |
| [#2816](https://github.com/ruvnet/ruflo/issues/2816) | **Fixed completely** in 3.32.39 / PR #2857; both real PreToolUse branches emit Codex-valid output | `ruflo-hooks-schema` retired |
| [#2821](https://github.com/ruvnet/ruflo/issues/2821) | **Fixed completely.** Native status is read-only by default; repair requires explicit intent | `ruflo-codex-skills` retired |
| [#2854](https://github.com/ruvnet/ruflo/issues/2854) | **Open; revalidated on published 3.38.12 and main `fa13ee4`.** No native dual-host marketplace reconciliation; the bundled Codex initializer still uses `which codex` and shell strings, and host registry presence does not prove a live marketplace root | Keep `plugin-hosts`; exact fragment revision, bounded cross-host executable discovery, supported-CLI stale-root repair, and initializer execution tests cover the downstream delta |
| [#2870](https://github.com/ruvnet/ruflo/issues/2870) | **Open.** Three current plugin versions identify multiple source trees; all 35 current identities were audited | `plugin-hosts host-refresh` repaired the three local host pairs through supported CLIs; wait for bumped versions plus a fleet-wide release guard |
| [#2877](https://github.com/ruvnet/ruflo/issues/2877) | **Closed/fixed and released in 3.38.11+.** The installed resolver routes autostart and every direct daemon identity to the nearest project root; executable nested-root, nested-project, `.git` stop, and no-marker tests pass | `daemon` terminally retires on that proof and remains available only for legacy releases |
| [MetaHarness #168](https://github.com/ruvnet/metaharness/issues/168) | **Open; reproduced in exact published `metaharness@0.4.7` and `@metaharness/host-codex@0.1.2`.** `HarnessSpec.hooks` exists, Claude consumes it, but the Codex adapter, CLI scaffold, and Studio path omit native project hooks while ADR-004 still says Codex has none | Keep `metaharness-codex-hooks` for supplied declarations; upstream must complete all generator paths, packaged handlers, trust messaging, tests, and the listed documentation updates |
| [Brain #12](https://github.com/stuinfla/ruvnet-brain/issues/12), [#13](https://github.com/stuinfla/ruvnet-brain/issues/13), [#17](https://github.com/stuinfla/ruvnet-brain/issues/17) | **Fixed completely** and behaviorally proved | `verify-interface`, `design-wall` retired |
| [Brain #41](https://github.com/stuinfla/ruvnet-brain/issues/41) | **Closure not sound after its body was broadened.** The closing comment proves the earlier quote fix, not the edited nested-invocation acceptance | Superseded by #44/#48; no new patch |
| [Brain #42](https://github.com/stuinfla/ruvnet-brain/issues/42), [#43](https://github.com/stuinfla/ruvnet-brain/issues/43) | **Fixed completely.** Codex MCP/plugin packaging is present without the retracted `skill.toml` proposal | No patch |
| [Brain #44](https://github.com/stuinfla/ruvnet-brain/issues/44) | **Superseded, not completed as written.** Raw Bash is now advisory rather than a blocking recursively parsed authority | Covered by the #48 replacement proof |
| [Brain #48](https://github.com/stuinfla/ruvnet-brain/issues/48) | **Its managed CLI/MCP replacement remains fixed and released.** The residual direct-SQLite detector and enforcement gaps are now isolated in #102/#103 rather than reopening #48's completed interface work | `verify-interface` remains retired; keep `brain-managed-memory-boundary` for the residual store boundary |
| [Brain #52](https://github.com/stuinfla/ruvnet-brain/issues/52) | **Fixed and released in 4.0.2.** Native six-event hooks, adapter, generation-stable wrapper, npm assets, and host wiring are published | `codex-hooks` remains retired; trust remains user-owned |
| [Brain #53](https://github.com/stuinfla/ruvnet-brain/issues/53) | **Fixed completely.** Atomic daily/project cadence passes concurrency behavior | `flywheel-daily` retired |
| [Brain #54](https://github.com/stuinfla/ruvnet-brain/issues/54) | **Fixed and released in 4.0.2.** A clean public install returned cited RVF results inside the published timeout evidence | No patch |
| [Brain #56](https://github.com/stuinfla/ruvnet-brain/issues/56) | **Fixed for its discovery scope.** Native Console/what's-new skills and self-contained aliases are published | The separate installed release-note defect is #76 |
| [Brain #64](https://github.com/stuinfla/ruvnet-brain/issues/64) | **Fixed and released in 4.0.2.** This machine auto-flipped 4.0.1→4.0.2 and recorded both Claude and Codex `ready` | No downstream updater patch was added |
| [Brain #66](https://github.com/stuinfla/ruvnet-brain/issues/66) | **Fixed and released in 4.0.2.** The focused newest-store memory detection suite passes upstream | No patch |
| [Brain #76](https://github.com/stuinfla/ruvnet-brain/issues/76) | **Closed and delivered in active 4.0.12.** PR #110 binds the executable and every asset it reads to one runtime surface and validates the staged workflow before activation | `brain-codex-skills` retires terminally after positive exact-version execution and a missing-notes mutation |
| [Brain #77](https://github.com/stuinfla/ruvnet-brain/issues/77) | **Closed for the release rail; still incomplete against its own doctor criterion.** Published 4.0.36 converges npm, GitHub, bundle, Spine, both hosts, and Console. Its pristine doctor still compares only bundle/Claude wrapper, describes drift as a normal cadence, and omits drift from `allGreen`; the issue body now records that exact residual, but the author account cannot reopen a maintainer-closed issue | Keep `brain-release-lockstep` as the read-only fail-closed reporting guard; all eight exact 4.0.36 anchors pass. Retire only after executable component-by-component mutation proof, never by issue state |
| [Brain #78](https://github.com/stuinfla/ruvnet-brain/issues/78) | **Closed and delivered in published 4.0.36.** The persistent server answers `tools/list` from its static fallback and handles managed CLI tools without awaiting worker warmup | No local runtime patch |
| [Brain #79](https://github.com/stuinfla/ruvnet-brain/issues/79) | **Closed, but incomplete against its own doctor acceptance criterion.** PR #110 fixes whole-runtime identity and detached-process replacement; the released doctor still does not re-probe candidate/runtime/receipt/live/PID/API convergence | Keep the narrowed `brain-console-lifecycle` doctor overlay; native launcher bytes are accepted and preserved |
| [Brain #81](https://github.com/stuinfla/ruvnet-brain/issues/81) | **Closed and delivered in active 4.0.12.** The shared root implementation passes common/configured, exact-root, invalid-config, malformed-config, and Console-convergence probes | `brain-memory-doctor-roots` retires terminally on that local executable proof |
| [Brain #86](https://github.com/stuinfla/ruvnet-brain/issues/86) | **Closed and delivered in active 4.0.12.** The catalog is packed/staged/validated and missing data produces an explicit unverified UI state | `brain-console-provider-keys` retires terminally on positive, degraded, staging-refusal, and UI behavior |
| [Brain #102](https://github.com/stuinfla/ruvnet-brain/issues/102) | **Closed and published in 4.0.36.** The structural invocation classifier fixes flag misses, grep variance, and prose false positives | Keep `brain-managed-memory-boundary` only for #103's remaining default-enforcement/diagnostic delta; preserve the native detector |
| [Brain #103](https://github.com/stuinfla/ruvnet-brain/issues/103) | **Closed but behaviorally incomplete in published 4.0.36.** The opt-in `managedMemoryBoundary` setting supplies `read-only` / `block`, but defaults to `advise`; the maintainer explicitly records that host non-execution is unproved, and no audited diagnostic or truthful doctor/Console state landed | Keep `brain-managed-memory-boundary` until the complete published boundary passes both hosts and the diagnostic/mutation matrix |
| [Brain #128](https://github.com/stuinfla/ruvnet-brain/issues/128) | **Closed after fixing stale-generation discovery, but its recorded live-session counterexample was not covered by immediate pruning.** A fresh session must see only the registry generation; an open session must keep its boot-catalog paths readable | Fresh discovery remains native. Live-generation retention moved to #153 for Claude and now #223 for the missing Codex half |
| [Brain #153](https://github.com/stuinfla/ruvnet-brain/issues/153) | **Closed and delivered for Claude in active 4.3.3.** Exact PID-incarnation `.in_use` leases protect Claude cache generations, registry bytes are re-read at deletion, and ambiguous state fails closed. The shipped pruner still reads only Claude's registry and Codex has no equivalent lease | Preserve the native Claude fix. Do not claim its “dual-host integration” test proves a live Codex boot catalogue; #223 supplies that real-host acceptance matrix |
| [Brain #223](https://github.com/stuinfla/ruvnet-brain/issues/223) | **Open and reproduced in active 4.3.3.** A Codex session catalogued 4.2.2-dev; native convergence replaced its cache with 4.3.3, leaving the absolute `SKILL.md` path dangling. Claude has `.in_use` leases; Codex does not | No downstream cache, updater, stable-path, delay, or pin. Upstream must add an exact Codex session/app-server generation lease and lease-aware host GC; the current session recovers only by restart after saving work |
| [Brain #224](https://github.com/stuinfla/ruvnet-brain/issues/224) | **Open and reproduced on current main / active 4.3.8-dev.** `symbolRoute()` directly indexes ordinary JSON objects, so the query token `constructor` resolves the inherited `Object` constructor and throws `m is not iterable` | Keep `brain-search-safety` until the active shared KB behaviorally ignores inherited/malformed values while preserving own-array routing |
| [Brain #225](https://github.com/stuinfla/ruvnet-brain/issues/225) | **Open and reproduced on active 4.3.8-dev.** Every total search failure prescribes `npm install` inside the live KB plus a GitHub npx download, even when the exact cause is a source `TypeError` | Keep the non-mutating failure-guidance half of `brain-search-safety` until MCP and CLI classify failures and generic exceptions never authorize automatic repair |
| [Brain #272](https://github.com/stuinfla/ruvnet-brain/issues/272) | **Open and reproduced on active 4.3.11.** The required dual-host helper directly spawns `ruflo memory store` even though Brain's own playbook requires the structured `memory_store` interface, allowing a second driver to contend with the live MCP owner | Keep `brain-dual-host-receipt`: preserve the duel, emit a schema-ready MCP request, and require exact-key verification before claiming learning persisted |
| [Brain #273](https://github.com/stuinfla/ruvnet-brain/issues/273) | **Open and reproduced on active 4.3.11/Linux.** Cross-critique serializes the other host's complete proposal into one positional argument; proposals above `MAX_ARG_STRLEN` fail in `spawn()` with `E2BIG` before synthesis | Keep `brain-dual-host-stdin`: retain all host flags, stream complete prompts over stdin, and prove >256 KiB payloads byte-for-byte without temp files |
| [Brain #129](https://github.com/stuinfla/ruvnet-brain/issues/129) | **Open on published 4.0.36.** Non-Darwin `--enable-nightly` exits successfully after printing a KB-only cron recipe; the installed macOS LaunchAgent invokes that same `forge-update.mjs --apply` path. Neither scheduled route runs full host convergence | Keep the one native SessionStart coordinator; do not add a downstream updater. Upstream should make every platform scheduler call one stable full coordinator, install/verify a systemd-or-cron Linux job, give Windows a real scheduler or explicit nonzero unsupported result, and add a coordinator-wide lock |
| [Brain #130](https://github.com/stuinfla/ruvnet-brain/issues/130) | **Open on published 4.0.36.** One failed run created 23 full snapshots (~43 GiB) and downloaded the same combined bundle 23 times; four older copies made 27/~50 GiB cumulative. The internal reclaimer then refused every backup because `node_modules/.bin/semver` made its recursive inventory “incomplete” | No raw deletion or replacement reclaimer. Preserve the backups until upstream downloads/applies once per transaction, retains at most one full-copy-equivalent rollback, scopes inventory to governed stores, distinguishes pre-existing guard failure, and exposes a supported dry-run reclaim command; #131 is the duplicate macOS report |
| [Brain #133](https://github.com/stuinfla/ruvnet-brain/issues/133) | **Open on published 4.0.36.** #122 intentionally exits an idle worker after 15 minutes, but the stable parent records that clean retirement as unexpected. Every live shell also overwrites one user-global readiness receipt, making multi-session health last-writer-wins | No downstream lifecycle shim. Upstream should add a structured worker-retirement handshake, per-shell readiness with PID-reuse-safe aggregation, healthy-idle/next-search respawn semantics, and multi-shell crash/idle/ready regression proof |

**Contributed a reproduction + fix (filed by someone else):**

| Issue | What's wrong upstream | Worked around by |
|-------|-----------------------|------------------|
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) | daemon ↔ MCP last-writer-wins **silently drops writes**. We posted a 30-line repro and the lock implementation | `memory` write lock |
| [#2594](https://github.com/ruvnet/ruflo/issues/2594) | **Fixed in 3.32.36.** Before that release, `memory store --help` declared upsert as the default while an omitted flag still performed a strict INSERT. We measured it and posted the reproducer | The native importer now passes `--upsert` explicitly; the compatibility target is retired |

**Referenced (upstream, not ours):** the legacy `daemon` transform retains the native lock from
[#2407](https://github.com/ruvnet/ruflo/issues/2407) / [#2484](https://github.com/ruvnet/ruflo/issues/2484)
unchanged; [#2877](https://github.com/ruvnet/ruflo/issues/2877) now supplies the current native root identity;
the `memory` write lock builds on the [#2584](https://github.com/ruvnet/ruflo/issues/2584)
corruption close-out, and its atomic-write baseline is [#2585](https://github.com/ruvnet/ruflo/pull/2585);
the WAL-sidecar-refusal half follows [#2735](https://github.com/ruvnet/ruflo/issues/2735) and
addresses the historical visibility symptom reported in
[#2646](https://github.com/ruvnet/ruflo/issues/2646) and [#2652](https://github.com/ruvnet/ruflo/issues/2652),
both now fixed in their stated scope. #2652 also explains why the legacy `adr-reindex` used raw SQL:
`memory delete` was soft and its tombstone still collided on re-store. Current Ruflo supplies
`memory purge`; current Ruflo 3.38.12 closes #2666's writer-sharing gap through native
`withMemoryDbLock()`, which the retirement predicate proves per writer before standing down.

**Related but NOT addressed by `adr-template`:**
[#2474](https://github.com/ruvnet/ruflo/issues/2474) (closed) fixed a different `adr-index`
parsing gap (`**Status**:` vs `**Status:**` placement, em-dash titles, worktree
double-counting). Its residual note on Nygard-style `## Status` sections and non-English
status words is still open but distinct from the bullet-prefix bug this target fixes.
[#2651](https://github.com/ruvnet/ruflo/issues/2651) was a separate `adr-create` step-4
`agentdb_hierarchical-store` parameter/key-charset defect; it is fixed in 3.32.37 and never needed
an `adr-template` patch.

## Limits

- Covers the **npx cache** and **global installs**. Global discovery combines the running Node prefix,
  npm-on-PATH prefixes, and authenticated `ruflo` / `claude-flow` / `claude-flow-mcp` launchers, including
  custom prefixes with no npm binary and nested public-wrapper dependencies. If a nonstandard layout is
  still outside those proofs, point `RUFLO_GLOBAL_ROOT` at it explicitly.
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
