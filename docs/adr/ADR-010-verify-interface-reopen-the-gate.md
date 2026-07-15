# ADR-010: verify-interface: reopen ruvnet-brain's unopenable PreToolUse gate

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: patch-target, plugin, ruvnet-brain

## Context

`ruvnet-brain` ships a PreToolUse hook that blocks a Bash call naming a rUv CLI until you have read that
command's `--help`. The idea is sound and worth keeping. The implementation cannot be OPENED.

Three defects, and they compound:

1. The tool regex absorbs a hyphenated BINARY NAME, so `ruflo-source-patch adr-index status` (a different
   tool, with its own CLI) parses as the `ruflo` CLI, and the gate demands `ruflo adr-index status --help`.
   That command does not exist. It asks for something impossible, then blocks until you provide it.
2. It matches inside ENGLISH PROSE. A tool name in prose sits after an English word; a tool name in a
   command sits at the start of one. Anchoring to "after any whitespace" cannot tell those apart, so
   `another ruflo process is writing` parses as `ruflo process is`.
3. The documented override cannot work. The block message says to set `RUVNET_SKIP_INTERFACE_CHECK=1`, but
   the check reads that variable from the HOOK's own environment, and a PreToolUse hook is handed the
   proposed command as JSON on stdin and never executes it. The one documented escape hatch is unreachable
   from the only side that is told to use it.

In one session this blocked five unrelated commands, including a git commit, in a repo whose name begins
`ruflo-`.

## Decision

Absorb only a `@version`, not a hyphenated binary name. Require the tool to be in COMMAND POSITION: at a
boundary (line start or a shell separator), after any number of wrappers (`npx`, `sudo`, `VAR=VAL`), then
the tool. Honour the override where the message tells you to write it: on the command.

The five edits are ATOMIC. Bash ERE has no non-capturing group, so the regex fix necessarily shifts every
`BASH_REMATCH` index its readers use. A partial apply would leave the gate reading the boundary character as
the tool name and blocking on garbage, on every command. On a partial match, write NOTHING.

Upstream ADOPTED v1 of this patch into `ruvnet-brain` 2.7.x, comments and all, while leaving the issue open,
so every edit carries TWO anchors: the original buggy line, and v1's own output.

## Consequences

### Positive

- The gate still blocks an unread interface, in every form a real invocation is written. It is FIXED, not
  disabled.
- Ordinary English prose, commit messages and heredocs stop being blocked.
- The documented override finally works.

### Negative

- A partial anchor match leaves the vendor file untouched rather than half-patched, which means an upstream
  rewording of ONE line disables the whole fix until the anchors are updated.

### Neutral

- A separate upstream defect was found and reported but NOT patched: the hook parses its JSON payload with a
  regex, so any command containing an escaped quote is truncated at the first one. The gate is blind to
  quoted text, which both hides false positives and misses real invocations.

## Links

- Upstream: [stuinfla/ruvnet-brain#12](https://github.com/stuinfla/ruvnet-brain/issues/12), [#13](https://github.com/stuinfla/ruvnet-brain/issues/13)
- `lib/verify-interface/`
