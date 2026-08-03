# `lib/`

[← ruflo-source-patch](../README.md)

The engine.

## Contents

- [The three kinds of target](#the-three-kinds-of-target)
- [Two files to read before writing a patcher](#two-files-to-read-before-writing-a-patcher)
- [The rule this whole package exists to enforce](#the-rule-this-whole-package-exists-to-enforce)
- [The anchor rules](#the-anchor-rules)
- [Interdependent edits are atomic](#interdependent-edits-are-atomic)
- [What none of this can catch](#what-none-of-this-can-catch)

## The three kinds of target

Every target is one of **three kinds**, and the kind determines what re-applies it. Getting this wrong is
how a fix silently stops existing.

| Dir | Kind | Patches what | Re-applied by |
|---|---|---|---|
| `cwd/` | **patch targets** (`cwd`, `daemon`, `memory`, `init`, `plugin-hosts`) plus shared machinery | installed `@claude-flow/cli` bytes | SessionStart hook + monitor |
| `adr-*`, `ruflo-hooks-schema/`, `mcp-prefix/` | **Ruflo plugin patches** | installed `ruflo-*` plugin bytes | SessionStart hook + monitor |
| `verify-interface/`, `design-wall/`, `flywheel-daily/`, `codex-hooks/`, `codex-skills/`, `brain-console-lifecycle/`, `brain-console-provider-keys/`, `brain-release-lockstep/`, `brain-memory-doctor-roots/`, `brain-managed-memory-boundary/` | **Brain/Codex package and plugin patches** | installed npm/npx, persistent runtime, plugin, and cache bytes | SessionStart hook + monitor |
| `dual/` | **script targets** (`dual`, `plugin-only`, `ruflo-codex-hooks`) | *nothing*. They set up or repair **your projects/host registration** | nobody; you run them by hand |

## Two files to read before writing a patcher

`plugin-registry.mjs` is the one place plugin targets are declared. Add a patcher there and the hook, the
monitor, `status` and `monitor check` all pick it up for free.

`pristine.mjs` is the safety floor for every patcher that **edits** a vendor file: resolve the pristine
bytes, re-baseline when upstream replaces the file, and **never** truncate or destroy on a poisoned
backup. Read it before writing a new patcher.

`brain-managed-memory-boundary/` owns an atomic cross-surface transaction rather than one composed
plugin file. It preflights the active native generation, matching host copies, and the persistent MCP
shell before writing any of them; a missing anchor leaves every surface untouched.

## The rule this whole package exists to enforce

**A failure must never look like success.**

Every patcher reports `INCOMPLETE` on a partial apply, `skip:no-anchor-matched` when upstream re-words an
anchor, and counts (not merely logs) an error. Those strings are not cosmetic. `problems.mjs` defines
the single predicate that the SessionStart hook, the monitor log, and the prompt notifier all match on.
It used to be three divergent regexes, and none of them matched `error `.

## The anchor rules

Every patcher matches with `src.includes(find)` on an **exact literal string**, and applies with
`split(find).join(replace)`. **No line numbers, no offsets, no fuzzy or context matching**, so there is
no position to drift. Upstream inserting lines above an anchor changes nothing.

Three things are checked on every apply, because each is a way to be silently wrong:

| Count | Meaning | What happens |
|---|---|---|
| exactly 1 | unambiguous | apply |
| 0 | upstream re-worded it | `skip:anchor-not-found`, reported and never guessed at |
| more than 1 | upstream restructured | **`skip:ambiguous-anchor`**. Refuse: `split().join()` would patch *every* occurrence, and `.replace()` would silently take the *first*. Both are guesses, in someone else's code |
| more than 1, `all: true` | deliberate | apply to all. `process.cwd()` legitimately appears at several call sites and each must be root-resolved |

Anchor uniqueness is a property of **upstream's** code. All of them are unique today; that is a
*measurement*, not a promise, so it is checked rather than assumed.

### Interdependent edits are atomic

`patch-library`'s `rebuild()` drops an entry unless *every* edit matches. `verify-interface` does the
same, and must: its regex edit shifts the capture-group indices its readers use, so a partial apply would
leave the gate blocking on garbage. On a partial match it writes **nothing** and leaves the vendor file
exactly as upstream shipped it.

### What none of this can catch

See the root README's *Limits*. An anchor that still matches, matches uniquely, and now **means**
something different is announced (`re-baselined`, with instructions) rather than guarded.
