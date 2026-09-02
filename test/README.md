# `test/`

[← ruflo-source-patch](../README.md)

`npm test` runs **thirty-six suites** plus the shared `fixtures.mjs` helper. No framework, no dependencies.

## Contents

- [The suites](#the-suites)
- [Three rules, all learned the hard way](#three-rules-all-learned-the-hard-way)
- [The tests that pin the two things that DELETE](#the-tests-that-pin-the-two-things-that-delete)

## The suites

| Suite | Covers |
|---|---|
| `sequence-fuzz.mjs` | **Any** sequence of `<target> <action>` leaves the library exactly "pristine + the installed entry set". 60 random sequences × 8 steps, invariants after **every** step. |
| `plugin-notify.mjs` | The plugin patches, the notifier, and the monitor's own liveness. |
| `reporting.mjs` | **Every path where a failure could be mistaken for success.** For a package that is almost entirely notification paths, that is the only thing that matters. |
| `hooks-migration.mjs` | User-level hook reconciliation across host/home migrations: stale unmarked paths and duplicate marked entries collapse to one current hook per event while unrelated hooks survive install and uninstall. |
| `untested.mjs` | The SessionStart hook body, `cleanup`'s directory half, the script targets, the shell scripts. All of them had *zero* coverage until it was measured rather than assumed. |
| `concurrency.mjs` | Concurrent installs; the **injected fail-closed memory lock actually executing** across processes and sibling Promises, nested reentrancy, owner-safe release, native purge, torn-image and WAL-sidecar refusal; plus plugin-throw handling, uncovered-build and zero-file failure, and status/check/all-status parity. |
| `memory-bridge-paths.mjs` | Ruflo #3143's process-global registry defect and its path-keyed replacement: pristine first-open-wins proof, project/user A -> B and B -> A isolation, canonical symlink identity, per-path availability/diagnostics, scoped shutdown, all-registry shutdown, and source/status proof. |
| `cwd-current.mjs` | Exact Ruflo 3.38.12 residual cwd coverage: permission state, permission audit, swarm state, neural-weft defaults, generated helpers, and byte-safe uninstall. |
| `daemon-native.mjs` | Native #2877 structural and executable root-resolution proof, deliberate resolver/route mutations, mixed legacy/native fleets, terminal retirement, and pristine preservation. |
| `cleanup-procs.mjs` | `cleanup`'s **kill** half. Real processes, real `pgrep`/`lsof`/`ps`. |
| `stale-writer.mjs` | The machine-wide stale daemon/MCP writer guard, including direct, `.bin/cli`, verified `.bin/ruflo`, and custom-prefix launcher shapes; dry-run/kill-switch boundaries; and rejection of older fail-open or same-named impostor wrappers. |
| `monitor-internals.mjs` | The plist, the cron spec, interval clamping, uninstall's cleanup, and `adr-reindex`'s reporting branches. |
| `dual-host.mjs` | The `dual` shell scripts against deterministic adapter/Codex fakes: policy rollback, MCP ownership, legacy migration, failure and signal cleanup. |
| `mcp-prefix.mjs` | MCP prefix rewriting, composed-target independence, re-baselining, and poisoned-backup recovery. |
| `adr-template-retirement.mjs` | Active Claude/Codex parser discovery plus executable creator/parser proof, orphaned project handling, byte-exact restore, and terminal retirement. |
| `adr-index-retirement.mjs` | Active Claude/Codex native convergence, honest importer counting, poisoned-backup refusal, runnable reindex routing, byte-exact restore, and terminal retirement. |
| `adr-io-safety.mjs` | Ruflo #3147/#3097's three-script bundle: installed-runtime/no-npx-fallback selection, complete fail-closed reads, exact managed-store identity, fresh-process byte readback, fail-fast/nonzero import, zero-op live-reindex refusal, legacy-target composition, missing/ambiguous bundle guards, exact-state native retirement probes, and byte-exact restoration without opening a real database. |
| `adr-reindex-native.mjs` | Native #2666 retirement only when purge and all ordinary sql.js mutators share one proven `withMemoryDbLock()`; one unlocked-writer mutation and nested global Ruflo discovery fail closed. |
| `design-wall.mjs` | The real hook behavior and fail-closed retirement of the legacy design-wall patch. |
| `flywheel-daily.mjs` | The flywheel advisory's daily/project scope, concurrent atomic claim, fail-silent path, and byte-safe lifecycle. |
| `codex-hooks.mjs` | Brain's additive Codex lifecycle plugin, adapter protocol, registration, and exact-owned uninstall. |
| `codex-hooks-native.mjs` | Mixed upstream #52 rollout: source-only stays unhealthy; complete native wiring is preserved. |
| `codex-skills.mjs` | Cache-local Ruflo/Brain skill parity: exact ownership, literal replacement-metacharacter handling, executable #76 native retirement with a missing-asset mutation, byte-perfect restoration, collision refusal, active-version updates, and no Brain update-plane mutation. |
| `ruflo-codex-hooks.mjs` | Ruflo's canonical Codex plugin repair: idempotency, disabled-state preservation, collision refusal, loud failures, and zero MCP mutation. |
| `plugin-hosts-discovery.mjs` | Cross-host executable and package-root boundaries: migrated `HOME` versus effective account home, narrow monitor PATH, bounded npm/pnpm/Volta/Bun/mise/asdf/Homebrew roots, persisted identity checks, Windows PATHEXT candidates, validated npm `.cmd` ownership, and forged-wrapper refusal. |
| `plugin-hosts-codex-init.mjs` | The bundled Codex initializer under a narrow PATH: exact source anchors, shared executable discovery, literal MCP/plugin argv, no `which codex` or shell-string calls, pristine backup, and byte-perfect uninstall. |
| `plugin-hosts.mjs` | Ruflo's issue-backed dual-host marketplace commands against fake host CLIs: install/sync/uninstall, dry-run, disabled state, exact scope ownership, noninteractive user-bin discovery, stale canonical marketplace repair through supported CLIs, noncanonical-source refusal, fragment-revision migration, idempotence, injection refusal, partial failure, bounded same-version refresh with cache-byte proof, and byte-perfect patch removal. |
| `brain-release-lockstep.mjs` | Brain #77's read-only fail-closed version guard: bounded npm/npx/persistent-runtime discovery, bundle/package/Spine/Claude/Codex comparison, atomic anchor refusal, mutation proof, and byte-perfect removal without touching the updater. |
| `brain-console-lifecycle.mjs` | Brain #79's detached Console contract plus partial-native rollout: native whole-runtime launcher recognition, the remaining live-doctor overlay, stale unowned-cache exclusion, composition with #77, mutation proof, and byte-perfect removal without touching the updater. |
| `brain-console-provider-keys.mjs` | Brain #86's packaged-catalog fallback: bounded Console discovery, native OpenAI/Google/Gemini key detection, composition with #79, mutation proof, no secret leakage, and byte-perfect removal. |
| `brain-memory-doctor-roots.mjs` | Brain #81's standalone AgentDB fleet discovery: common/configured roots, explicit-root compatibility, bounded installed-copy discovery, atomic drift refusal, mutation proof, and byte-perfect removal without touching Brain data or its updater. |
| `brain-native-retirement.mjs` | Executable #81/#86 delivery proof: copied active runtime, positive and degraded provider states, staging refusal, UI truth state, common/configured/exact-root discovery, deliberate regressions, and simultaneous terminal retirement. |
| `brain-managed-memory-boundary.mjs` | Brain #102/#103's managed AgentDB boundary: SQLite option parsing, structural host denial, negative prose/unmanaged-store cases, audited content-free diagnostic, atomic multi-surface install, native-generation flip including published 4.0.36's detector/setting shape, and exact removal without changing `active.json`, KB, or updater bytes. |
| `brain-search-safety.mjs` | Brain #224/#225's shared-KB search boundary: inherited `constructor`, own-array and malformed symbol routing, non-mutating outage guidance, exact-anchor drift refusal, composition lifecycle, native mutation proof, terminal retirement, and no updater/store mutation. |
| `metaharness-codex-hooks.mjs` | MetaHarness #168's Codex renderer: authenticated package discovery, exact two-surface transforms, strict manifest schema, tool/inner matcher translation, nested-cwd helper execution, unsupported-declaration refusal, mutation proof, public CLI lifecycle, and byte-exact uninstall. |
| `ruflo-instruction-contract.mjs` | Ruflo #3153's generated instruction contract: authenticated nested/standalone Claude/Codex bundles, every root template, platform and packaged task skills, MCP-first runtime examples, explicit managed `ruflo` executable selection, prior-patch upgrade from proven pristine, valid schemas, enterprise evidence labels, DB/WAL non-interference, public CLI lifecycle, and byte-exact uninstall. |
| `ruflo-instruction-migration.mjs` | Ruflo #3153's existing-project migration: exact root-block and built-in-skill revision attribution, contract-v1 to v2 executable-selection upgrade, shared-policy/Claude-overlay/custom-root preservation, allowlisted legacy skill upgrade, full-fleet preflight, symlink refusal, CRLF/mode retention, idempotence, and proof that databases/WAL/runtime processes are never touched. |
| `fixtures.mjs` | Where the suites get their **pristine** vendor bytes. |

## Three rules, all learned the hard way

### 1. A test that cannot fail is worth nothing

Every regression is **mutation-tested**: the guard is removed and the test *confirmed to fail*. That has
now caught **six vacuous tests**, ones that passed with the guard deleted and were therefore proving
nothing.

The worst was the fuzzer itself. Its oracle was `state.json`, so 480 steps a run asserted *"the files
agree with the bookkeeping"* and **nothing ever asserted that either agrees with the commands you typed**.
A CLI mutated to uninstall targets the user never named passed all 60 sequences. The oracle is now derived
from the typed commands, and `state.json` became a thing *under* test.

Others it caught:

- `restore()` bypassed every guard, making **`uninstall` the most destructive command in the tool**.
- `monitor check` **healed the drift on its way to checking for it**, so the CI gate could only ever say *ok*.
- `V1` passed because the gate exits early with no model-router profile. The sandbox was allowing
  everything, and every assertion below it was green for the wrong reason.
- `N4` wiped its own problem record before asserting it had been cleared.

### 2. Never fabricate a baseline

`fixtures.mjs` **refuses** a patched vendor file that has no `.rsp-backup`. The old fallback
(`exists(backup) ? backup : file`) quietly adopted a *patched* file as the pristine baseline on any machine
where the patch was installed and the backup cleaned away. The two central invariants then asserted the
patch **against itself**, and passed.

Paths, npx cache hashes and plugin versions are **discovered, never written down**: the npx hash is
content-addressed and changes whenever the dependency set does.

### 3. A test must never reach outside its sandbox

It happened twice, and both times invisibly: the suite mangled the real machine while every assertion it
made probed only sandbox paths.

#### No suite sandboxed `GLOBAL_ROOTS`

`RUFLO_NPX_ROOT` covers only the npx half. So on any machine with a global `@claude-flow/cli`, the suite
would patch, restore and re-baseline **the real install**, *poisoning its backups*, 480 times a run.

#### `monitor-internals.mjs` deleted the real monitor

`paths.mjs` reads the sandbox env at *module load*, ESM modules are singletons, and static imports **hoist
above any assignment**. So importing `fixtures.mjs` pinned the real home before the file's first statement
ran, and `MI4` (which calls `uninstallMonitor()`) removed the actual `monitor.json`, heartbeat and launchd
plist. **It destroyed the monitor it was testing.**

Both fixed. The second file carries the reason at the top, so nobody re-imports `fixtures.mjs` there and
re-arms it.

## The tests that pin the two things that DELETE

`cleanup` signals processes and removes directories; `dedupe` removes files from a project. Both were
untested for most of this package's life, which is exactly the wrong way round.

| Tests | What they pin |
|---|---|
| `CL1` through `CL4` | `--dry-run` deletes nothing; strays go; **the project's own `.claude-flow`/`.swarm` survive** (a real `memory.db` is planted and its contents asserted afterwards); `$HOME` is refused. |
| `K1` through `K5` | Real daemons, real signals. The assertion that matters is **K3: another project's daemon survives.** Remove the containment filter and it fails with exactly that. |
| `SH2` | `dedupe --dry-run` touches nothing in a real project tree. |
