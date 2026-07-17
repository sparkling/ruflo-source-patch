# `verify-interface`

[← ruflo-source-patch](../../README.md)

**RETIRED 2026-07-17** (see ADR-010). `ruvnet-brain` v3.2.9 (commit `bfc2d36`) shipped its own complete
fix for both #12 and #13; `lib/supersede.mjs` retires this target automatically once the installed
copies carry it. Kept below for history and for anyone still on a pre-3.2.9 install.

A gate that cannot be opened.

Patches the **`ruvnet-brain`** plugin (not `ruflo-adr`), specifically its PreToolUse hook,
`scripts/verify-interface.sh`.
Upstream: [stuinfla/ruvnet-brain#12](https://github.com/stuinfla/ruvnet-brain/issues/12)

## Contents

- [The gate is a good idea, and this does not disable it](#the-gate-is-a-good-idea-and-this-does-not-disable-it)
- [The three bugs](#the-three-bugs)
- [It fires on things that are not the tool](#it-fires-on-things-that-are-not-the-tool)
- [It fires on English prose](#it-fires-on-english-prose)
- [The documented override cannot work](#the-documented-override-cannot-work)
- [Upstream adopted v1, so there are two shapes in the wild](#upstream-adopted-v1-so-there-are-two-shapes-in-the-wild)
- [Why five edits and not one](#why-five-edits-and-not-one)
- [Tested behaviourally, not textually](#tested-behaviourally-not-textually)
- [A limit worth knowing: the gate is blind to quoted text](#a-limit-worth-knowing-the-gate-is-blind-to-quoted-text)
- [When upstream fixes it](#when-upstream-fixes-it)

## The gate is a good idea, and this does not disable it

It blocks a Bash call naming a rUv CLI until you have read that command's `--help`. It exists because
someone once called `ruflo memory search "query"` positionally, got nothing back, and declared AgentDB
broken three times over. **Keep the gate.** It simply cannot be *opened*.

## The three bugs

Two false positives with no working override. Together they blocked **five** unrelated commands in one
session, in a repo whose name begins `ruflo-`.

### It fires on things that are not the tool

```bash
MATCH_RE="($TOOLS)[@a-z0-9.-]*[[:space:]]+([a-z][a-z-]*)…"
```

The class exists to absorb `@latest`. It also absorbs a hyphenated **binary name**. So
`ruflo-source-patch adr-index status`, a different tool with its own CLI, is read as the `ruflo` CLI, and
the gate demands `ruflo adr-index status --help`. **That command does not exist.** It asks for something
impossible, then blocks until you provide it.

### It fires on English prose

This is the one the first version of the patch did **not** fix, and it kept firing afterwards.

v1 anchored the tool name to *"after any whitespace"*. **Every English sentence satisfies that.** So

```bash
echo could not take the lock, another ruflo process is writing
```

parsed as `ruflo process is`, and the gate demanded the help output for a command called **`process is`**.
An `echo`, a commit message or a heredoc that merely *described* the tool was blocked.

The predicate was wrong, not the pattern. **A tool name in prose sits after an English word. A tool name
in a command sits at the start of one.** Whitespace cannot tell those apart; *command position* can:

| Position | Example | Verdict |
|----------|---------|---------|
| A boundary: line start, or `;` `&&` `\|` `(` | `cd /tmp && ruflo memory list` | invocation, gate it |
| A boundary, then a wrapper or `VAR=VAL` | `npx ruflo@latest memory list` | invocation, gate it |
| After an English word | `another ruflo process is writing` | prose, let it through |
| As an argument to another program | `grep ruflo memory ./notes.txt` | not an invocation, let it through |

## The documented override cannot work

The block message says *"Deliberate override: `RUVNET_SKIP_INTERFACE_CHECK=1`"*. But the check reads that
variable from the **hook's own environment**, and a PreToolUse hook is handed the command as JSON on
stdin and **never executes it**. Setting it on the command, which is exactly what the message instructs,
cannot reach the hook.

## Upstream adopted v1, so there are two shapes in the wild

`ruvnet-brain` **2.7.x ships v1 of this patch in its own vendor file**, regex, comments and reachable
override included, while [#12](https://github.com/stuinfla/ruvnet-brain/issues/12) remains open. The
prose false positive shipped with it.

So every edit carries **two anchors**: the original buggy line (still in older cached plugin versions),
and v1's own output (what upstream now ships). Variant B's `find` is literally v1's `replace`, which is
why it is a shared constant rather than retyped. A copy that drifted by one character would report
`skip:anchor-not-found` on the very file it exists to fix, and the target would go quiet while the bug
stayed live.

## Why five edits and not one

Bash ERE has no non-capturing `(?:…)`, so anchoring the regex **necessarily shifts the capture groups**:
tool 1→4, sub 2→6, sub-sub 4→8. The three `BASH_REMATCH` readers must move with it.

**A partial apply is worse than none here**, so it is **atomic: all of them land, or none do.**

Land the regex without its readers and the gate reads `BASH_REMATCH[1]`, which after the shift is the
boundary character rather than the tool. It then blocks on garbage, on every command, until you run
`uninstall`.

An earlier version *wrote* that. It reported `INCOMPLETE` and exited nonzero, so it was **loud**, and the
file was already corrupted. Loud-but-broken is not the bar, and upstream re-wording **one** anchored line
(an extra space is enough) is all it takes, which is exactly what a plugin update does. On a partial match
it now writes nothing and leaves the vendor file as upstream shipped it: the gate keeps its old (annoying)
behaviour instead of a broken one, and the notifier says so.

## Tested behaviourally, not textually

Asserting "the regex string changed" would pass on a patch that **broke the gate outright**. So the suite
drives the real script with the JSON payload Claude Code sends on stdin, and the assertion that matters is
**V4: an unread interface still blocks**, in every form a real invocation is written (bare, `npx`, behind
a separator, behind `VAR=VAL`). A regex tightened until it matches *nothing* would sail through the
false-positive tests; V4 is what stops that from looking like success.

**V1 proves the unpatched fixture really is buggy**, or every assertion below it is vacuous. It probes
with *prose*, because upstream now ships v1 and the older probe would report "fixture is not buggy" on a
fixture that is still buggy, just differently.

## A limit worth knowing: the gate is blind to quoted text

Upstream parses the hook's JSON payload with a **regex**, `"command"…"([^"]*)"`. A `[^"]*` class cannot
cross a quote, so a command containing an escaped `"` is **truncated at the first one**:

```text
{"command":"echo \"another ruflo process is writing\""}   ->   CMD = 'echo \'
```

The gate then sees no tool name at all and allows the command. This cuts both ways, and neither is good:

- **It hides false positives.** Three tests in this suite once passed for exactly this reason, asserting
  nothing.
- **It creates false negatives.** `bash -c "ruflo memory search -q x"` is invisible to the gate.

This patch does not fix it: it is a defect in upstream's payload parsing, not in the match. It is reported
on #12 and noted here so the next person does not mistake the blindness for a fix.

## When upstream fixes it

The anchors stop matching, `apply()` reports `skip:no-anchor-matched` loudly, and names #12 as the likely
reason. Then uninstall the target. It never guesses.
