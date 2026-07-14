# `verify-interface`

[← ruflo-source-patch](../../README.md)

A gate that cannot be opened.

Patches the **`ruvnet-brain`** plugin (not `ruflo-adr`), specifically its PreToolUse hook,
`scripts/verify-interface.sh`.
Upstream: [stuinfla/ruvnet-brain#12](https://github.com/stuinfla/ruvnet-brain/issues/12)

## Contents

- [The gate is a good idea, and this does not disable it](#the-gate-is-a-good-idea-and-this-does-not-disable-it)
- [The two bugs](#the-two-bugs)
- [It fires on things that are not the tool](#it-fires-on-things-that-are-not-the-tool)
- [The documented override cannot work](#the-documented-override-cannot-work)
- [Why five edits and not one](#why-five-edits-and-not-one)
- [Tested behaviourally, not textually](#tested-behaviourally-not-textually)
- [When upstream fixes it](#when-upstream-fixes-it)

## The gate is a good idea, and this does not disable it

It blocks a Bash call naming a rUv CLI until you have read that command's `--help`. It exists because
someone once called `ruflo memory search "query"` positionally, got nothing back, and declared AgentDB
broken three times over. **Keep the gate.** It simply cannot be *opened*.

## The two bugs

A false positive with no working override. Together they blocked **five** unrelated commands in one
session, in a repo whose name begins `ruflo-`.

### It fires on things that are not the tool

```bash
MATCH_RE="($TOOLS)[@a-z0-9.-]*[[:space:]]+([a-z][a-z-]*)…"
```

The class exists to absorb `@latest`. It also absorbs a hyphenated **binary name**. So
`ruflo-source-patch adr-index status`, a different tool with its own CLI, is read as the `ruflo` CLI, and
the gate demands `ruflo adr-index status --help`. **That command does not exist.** It asks for something
impossible, then blocks until you provide it.

No command-position anchor either, so it matches inside **prose**. A `git commit` whose message read
*"…the installed `ruflo-adr-reindex.sh` **was the** pre-71be214 copy"* matched as `ruflo … was the`, and
it demanded help for a command called **`was the`**.

### The documented override cannot work

The block message says *"Deliberate override: `RUVNET_SKIP_INTERFACE_CHECK=1`"*. But the check reads that
variable from the **hook's own environment**, and a PreToolUse hook is handed the command as JSON on
stdin and **never executes it**. Setting it on the command, which is exactly what the message instructs,
cannot reach the hook.

## Why five edits and not one

Bash ERE has no non-capturing `(?:…)`, so anchoring the regex **necessarily shifts the capture groups**:
tool 1→2, sub 2→4, sub-sub 4→6. The three `BASH_REMATCH` readers must move with it.

**A partial apply is worse than none here**, so it is **atomic: all five land, or none do.**

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
**V4: an unread interface still blocks.** V1 proves the *unpatched* fixture really does block. Otherwise
every assertion below it is vacuous, which it caught itself doing on the first run.

## When upstream fixes it

The anchors stop matching, `apply()` reports `skip:no-anchor-matched` loudly, and names #12 as the likely
reason. Then uninstall the target. It never guesses.
