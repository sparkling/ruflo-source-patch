# `test/`

`npm test` — **seven suites, 30 groups.** No framework, no dependencies.

| Suite | Covers |
|---|---|
| `sequence-fuzz.mjs` | **Any** sequence of `<target> <action>` leaves the library exactly "pristine + the installed entry set". 60 random sequences × 8 steps, invariants after **every** step. |
| `plugin-notify.mjs` | The plugin patches, the notifier, and the monitor's own liveness. |
| `reporting.mjs` | **Every path where a failure could be mistaken for success** — which, for a package that is almost entirely notification paths, is the only thing that matters. |
| `untested.mjs` | The SessionStart hook body, `cleanup`'s directory half, the script targets, the shell scripts — all of which had *zero* coverage until it was measured rather than assumed. |
| `concurrency.mjs` | Concurrent installs; the **injected memory write lock actually executing**; the plugin-throw guard; the uncovered-build detector; the legacy daemon entry. |
| `cleanup-procs.mjs` | `cleanup`'s **kill** half — real processes, real `pgrep`/`lsof`/`ps`. |
| `monitor-internals.mjs` | The plist, the cron spec, interval clamping, uninstall's cleanup; the `dual` shell scripts actually running; `adr-reindex`'s reporting branches. |
| `fixtures.mjs` | Where the suites get their **pristine** vendor bytes. |

## Three rules, all learned the hard way

### 1. A test that cannot fail is worth nothing

Every regression is **mutation-tested**: the guard is removed and the test *confirmed to fail*. That has
now caught **six vacuous tests** — ones that passed with the guard deleted, and were therefore proving
nothing.

The worst was the fuzzer itself. Its oracle was `state.json`, so 480 steps a run asserted *"the files
agree with the bookkeeping"* and **nothing ever asserted that either agrees with the commands you typed**.
A CLI mutated to uninstall targets the user never named passed all 60 sequences. The oracle is now derived
from the typed commands, and `state.json` became a thing *under* test.

Others it caught:

- `restore()` bypassed every guard, making **`uninstall` the most destructive command in the tool**.
- `monitor check` **healed the drift on its way to checking for it**, so the CI gate could only ever say *ok*.
- `V1` passed because the gate exits early with no model-router profile — the sandbox was allowing
  everything, and every assertion below it was green for the wrong reason.
- `N4` wiped its own problem record before asserting it had been cleared.

### 2. Never fabricate a baseline

`fixtures.mjs` **refuses** a patched vendor file that has no `.rsp-backup`. The old fallback
(`exists(backup) ? backup : file`) quietly adopted a *patched* file as the pristine baseline on any machine
where the patch was installed and the backup cleaned away — and then the two central invariants asserted
the patch **against itself**, and passed.

Paths, npx cache hashes and plugin versions are **discovered, never written down**: the npx hash is
content-addressed and changes whenever the dependency set does.

### 3. A test must not reach outside its sandbox — and must not lie about it

Twice, invisibly:

- **No suite sandboxed `GLOBAL_ROOTS`.** `RUFLO_NPX_ROOT` covers only the npx half, so on any machine with
  a global `@claude-flow/cli` the suite would patch, restore and re-baseline **the real install** — and
  *poison its backups* — 480 times a run, while every assertion probed only sandbox paths.
- **`monitor-internals.mjs` deleted the real monitor.** `paths.mjs` reads the sandbox env at *module load*,
  ESM modules are singletons, and static imports **hoist above any assignment** — so importing
  `fixtures.mjs` pinned the real home before the file's first statement ran, and `MI4` (which calls
  `uninstallMonitor()`) removed the actual `monitor.json`, heartbeat and launchd plist. **It destroyed the
  monitor it was testing.**

Both fixed. The second file carries the reason at the top, so nobody re-imports `fixtures.mjs` there and
re-arms it.

## The tests that pin the two things that DELETE

`cleanup` signals processes and removes directories; `dedupe` removes files from a project. Both were
untested for most of this package's life, which is exactly the wrong way round.

- **`CL1–CL4`** — `--dry-run` deletes nothing; strays go; **the project's own `.claude-flow`/`.swarm`
  survive** (a real `memory.db` is planted and its contents asserted afterwards); `$HOME` is refused.
- **`K1–K5`** — real daemons, real signals. The assertion that matters is **K3: another project's daemon
  survives.** Remove the containment filter and it fails with exactly that.
- **`SH2`** — `dedupe --dry-run` touches nothing in a real project tree.
