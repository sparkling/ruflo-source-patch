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
| `ruflo-instruction-contract/` | **Ruflo instruction contract patch** | installed Claude/Codex root generators, platform-skill generators, and packaged Codex task skills | SessionStart hook + monitor |
| `verify-interface/`, `design-wall/`, `flywheel-daily/`, `codex-hooks/`, `codex-skills/`, `brain-console-lifecycle/`, `brain-console-provider-keys/`, `brain-release-lockstep/`, `brain-memory-doctor-roots/`, `brain-managed-memory-boundary/`, `brain-search-safety/`, `brain-native/` | **Brain/Codex package, plugin, and retirement logic** | installed npm/npx, persistent runtime, plugin, and cache bytes | SessionStart hook + monitor |
| `metaharness-codex-hooks/` | **MetaHarness Codex host patch** | authenticated installed `metaharness` and `@metaharness/host-codex` runtime bytes | SessionStart hook + monitor |
| `dual/` | **script targets** (`dual`, `plugin-only`, `ruflo-codex-hooks`, `codex-switch`) | *nothing*. They set up or repair **your projects/host registration**, or move your own Codex session between accounts | nobody; you run them by hand |

## Two files to read before writing a patcher

`plugin-registry.mjs` is the one place plugin targets are declared. Add a patcher there and the hook, the
monitor, `status` and `monitor check` all pick it up for free.

CLI entries have a fourth state besides patched, absent, and drifted: **behaviorally native**. A
`nativeSatisfied()` predicate proves the upstream replacement while preserving pristine vendor bytes.
Install, target status, monitor status/check, and `all status` all consume the same `satisfied` count;
zero discovered files, an unsatisfied entry, or an uncovered runnable build is a nonzero result.
`lib/daemon/supersede.mjs` adds an executable mutation proof before terminally retiring #2877, so older
Ruflo installations remain patchable while current ones stay untouched.

`pristine.mjs` is the safety floor for every patcher that **edits** a vendor file: resolve the pristine
bytes, re-baseline when upstream replaces the file, and **never** truncate or destroy on a poisoned
backup. Read it before writing a new patcher.

Runtime fragments need their own revision proof in addition to the shared patch marker. The marker
only says that some local patch ran; an entry-level `proof` says the executable body required by the
current target is present. `plugin-hosts` uses this to rebuild obsolete injected command/discovery
bodies from the pristine backup instead of reporting old runtime bytes as current.

`brain-managed-memory-boundary/` owns an atomic cross-surface transaction rather than one composed
plugin file. It preflights the active native generation, matching host copies, and the persistent MCP
shell before writing any of them; a missing anchor leaves every surface untouched.

`brain-search-safety/` owns only the three executable search files in the already-active shared Brain
KB. It validates `symbolRoute()` by executing the exact installed function against inherited, own, and
malformed entries; generic outage guidance must remain nonzero/loud without prescribing mutation. It
does not discover or alter stores, sidecars, models, updater receipts, versions, or host caches (ADR-031).

`adr-io-safety/` owns `verify.mjs`, `import.mjs`, and `reindex.mjs` as one interdependent bundle in
every active `ruflo-adr` root. Its descriptor-level preflight proves all expected files, exact anchors,
and regular-file boundaries before composition writes any member. The runtime uses one explicit managed
database path through the installed Ruflo executable, fails closed rather than falling back to an npx
cache with a different AgentDB driver, rejects incomplete reads and unproved writes, and refuses
purge-first live reindex until upstream supplies an atomic managed reconcile (ADR-032).

`brain-native/` contains fail-closed executable retirement probes. They copy the active persistent
runtime to a temporary directory, restore locally owned vendor bytes only in that copy, and prove the
replacement plus a deliberate mutation before terminally retiring #81 or #86. #76 uses the same rule
against its active immutable Codex payload. These probes never alter Brain's update or selection plane.

`metaharness-codex-hooks/` is a composed, exact-anchor package target. It does not invent default
hooks: only a non-empty declaration produces `.codex/hooks.json` and its project-local bridge. The
bridge preserves inner matcher policy, rejects unsupported declarations, and leaves Codex trust to
the user's `/hooks` review.

`ruflo-instruction-contract/` composes across every Claude generator, generated Ruflo platform skill,
and nested or standalone authenticated Codex package present on the host. Codex coverage includes its
generator and every present packaged task skill; a standalone CLI cache legitimately contributes only
its Claude/platform surfaces. The target executes every available root template, validates task/platform
contracts and current core schemas, and retires only when marker-free upstream bytes pass the complete
proof with both hosts represented overall. Its separate exact-revision migrator has no Ruflo, Brain,
npm, process, or database dependency. Managed Ruflo CLI-only gaps explicitly select the installed
`ruflo` executable in both Brain bridge calls; exact v1 roots and skills upgrade to that v2 contract,
including a narrow marker-and-sentence migration for roots with deliberate project-specific additions.

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

The composition engine also supports a descriptor-level `preflight()` for bundles spanning several
files. If any bundle member is missing, unreadable, non-regular, or anchor-drifted, every file claimed by
that descriptor is skipped. Status counts expected members before attempting reads, so missing files
remain visible in the denominator.

### What none of this can catch

See the root README's *Limits*. An anchor that still matches, matches uniquely, and now **means**
something different is announced (`re-baselined`, with instructions) rather than guarded.
