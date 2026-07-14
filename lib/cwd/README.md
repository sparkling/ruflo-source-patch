# `lib/cwd/` — the CLI patch targets, and all the shared machinery

Named for the first target (`cwd`), but it now holds the engine everything else stands on.

## The targets

| Target | Fixes |
|---|---|
| `cwd` | `.claude-flow`/`.swarm` follow a drifted `process.cwd()` — a state dir per visited subdirectory |
| `daemon` | dedup keyed per-cwd, so a `daemon start` from any subdirectory forks its own daemon |
| `memory` | `memory.db` durability — a cross-process **write lock**, and **WAL-coherent reads** |

`patch-library.mjs` holds the entry table (7 entries across the 3 targets) and the engine that composes
them. Several entries share a file, so the rebuild is **from pristine + the desired entry set** — never a
sequence of in-place edits. That is what makes `memory uninstall` able to remove the write lock while
leaving `cwd`'s anchoring in the same file untouched.

## The machinery (used by every target, not just these)

| File | Job |
|---|---|
| `stable.mjs` | `~/.ruflo-source-patch/lib` is **not a cache — it is the executable**. The hook and the monitor run *that* copy. Provenance is recorded at sync time, so "is it stale?" has an answer. |
| `hooks.mjs` | Registers the SessionStart + UserPromptSubmit hooks. Also reaps our own **unmarked** legacy hooks — which install and uninstall could both see straight past, so they outlived `uninstall` itself. |
| `monitor.mjs` | The scheduled re-apply. **Not a daemon** — this project exists partly *because* ruflo daemons multiply. launchd/cron runs a short-lived check and exits. |
| `problems.mjs` | **One** definition of "a line a human must see." Used by the hook, the monitor log, and the notifier. It was three copies, and they had all drifted the same way. |
| `health.mjs` | Watches the watchman. A dead monitor is indistinguishable from a healthy system — the most dangerous state a watchdog can be in, and one it cannot report on itself. |
| `notify.mjs` | UserPromptSubmit. SessionStart is too late: a new ruflo version can land in the npx cache **mid-session**. |
| `state.mjs` | What is installed. Every mutation is a read-modify-write, and it now holds a **cross-process lock** — see below. |
| `cleanup.mjs` | Repairs a project already sprawled — stray daemons, subdirectory state dirs. The only code here that **signals processes and removes directories**. |

## The one that bites

`stable.mjs` exists because the package could upgrade and **nothing it does would upgrade with it**. The
hook and the monitor kept executing the old lib forever, and every reporting surface was *also* the old
code, so it was silent. Found live at nine modules behind.

The invariant is **provenance, not location**. Diffing against the globally-installed package is the
obvious answer and it is wrong: develop from a clone and the global is *older*, so the CLI would sync your
clone in and the monitor would heal it **backward** to the stale release — two writers fighting on a
timer. The fuzz suite caught exactly that.


## We had ruflo's own bug, in our own state file

`state.json` had **no lock** around its read-modify-write. Three concurrent `install`s lost a target in
**12 runs out of 12** — not a rare race, the *default* outcome.

And that is not a bookkeeping slip. `state.json` is what the hook and the monitor re-apply **from**:
`apply(state.patchTargets)` makes the library match that list *exactly*. So a target dropped from the file
is one the next monitor tick **actively un-patches**. A concurrent install didn't merely fail to record —
it silently reverted a patch that was already applied.

That is precisely [#2621](https://github.com/ruvnet/ruflo/issues/2621) — last-writer-wins silently
dropping writes — the bug this package exists to fix in `memory.db`. It now takes the same lock we inject
into ruflo: `O_EXCL` create, steal after 15s, proceed unlocked after 5s rather than refuse to run. 12/12
lost → 0/12.

## `cleanup` was silently broken on macOS

`isInside()` — the containment guard, **the only thing standing between us and SIGTERM-ing another
project's daemon** — compared paths with `path.resolve()`, which does not follow symlinks. But `/var` and
`/tmp` **are** symlinks on macOS, and `lsof` (how we read a pid's cwd) always reports the *resolved* path.

So a project under `/var` or `/tmp` yielded `root=/var/x` while its daemon's cwd read back as
`/private/var/x`. Containment matched nothing: cleanup found **zero daemons** and reported *"nothing to
clean"* — on a project full of them. Announcing success while doing nothing, in our own cleanup command.

It surfaced only when the kill path finally got a test (`K1–K5`, real processes and real `pgrep`/`lsof`).
Both `isInside()` and the `atRoot` check now compare **real** paths.
