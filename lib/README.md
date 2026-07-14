# `lib/` — the engine

Every target is one of **three kinds**, and the kind determines what re-applies it. Getting this wrong is
how a fix silently stops existing.

| Dir | Kind | Patches what | Re-applied by |
|---|---|---|---|
| `cwd/` | **patch targets** (`cwd`, `daemon`, `memory`) + all shared machinery | the installed `@claude-flow/cli` | SessionStart hook + monitor |
| `adr-template/`, `adr-index/`, `adr-reindex/` | **plugin patches** | the installed `ruflo-adr` plugin | SessionStart hook + monitor |
| `verify-interface/` | **plugin patch** | the installed `ruvnet-brain` plugin | SessionStart hook + monitor |
| `dual/` | **script targets** (`dual`, `dedupe`) | *nothing* — they set up **your projects** | nobody; you run them by hand |

`plugin-registry.mjs` is the one place plugin targets are declared — add a patcher there and the hook, the
monitor, `status` and `monitor check` all pick it up for free.

`pristine.mjs` is the safety floor for every patcher that **edits** a vendor file: resolve the pristine
bytes, re-baseline when upstream replaces the file, and **never** truncate or destroy on a poisoned
backup. Read it before writing a new patcher.

## The rule this whole package exists to enforce

**A failure must never look like success.**

Every patcher reports `INCOMPLETE` on a partial apply, `skip:no-anchor-matched` when upstream re-words an
anchor, and counts (not merely logs) an error. Those strings are not cosmetic — `problems.mjs` defines
the single predicate that the SessionStart hook, the monitor log, and the prompt notifier all match on.
It used to be three divergent regexes, and none of them matched `error `.
