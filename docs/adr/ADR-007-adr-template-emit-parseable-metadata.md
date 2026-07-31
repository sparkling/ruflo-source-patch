# ADR-007: adr-template: make adr-create emit metadata adr-index can parse

**Status**: accepted
**Date**: 2026-07-14
**Updated**: 2026-07-31. #2659 is fixed in current marketplace source and Ruflo 3.32.37+.
`plugin-hosts` now refreshes stale Claude Code and Codex copies automatically, including same-version
content drift. The compatibility target retires locally only after all four active marketplace/cache
parsers execute the creator metadata/relationship round trip successfully. #2870 remains open for the
separate reused-version release defect; it no longer keeps a behaviorally redundant local patch alive.
**Deciders**: Henrik Pettersen
**Tags**: patch-target, plugin, adr

## Context

`ruflo-adr`'s two skills originally disagreed about the file format. `/adr-create` wrote ADR metadata in one shape, and
`/adr-index`'s importer parsed another. The result was an ADR that was created successfully and then indexed
as nothing: the importer reads it, extracts no id/status/date, and stores an empty or partial record while
reporting success.

Two tools shipped in the same plugin, and the output of one is not valid input to the other.

## Decision

Patch the packaged `/adr-create` skill so the template it writes emits metadata in the shape the importer
actually parses. The plugin lives under `~/.claude/plugins/`, so a `/plugin update` re-fetches it wholesale
and silently reverts a hand edit. It is therefore a tracked patch target, re-applied by the SessionStart
hook and the monitor, like every other.

## Consequences

### Positive

- An ADR created by `/adr-create` is indexable by `/adr-index` without hand-editing.
- The fix survives `/plugin update`.

### Negative

- We are patching a plugin's authored content, not just its code, so an upstream rewording of the template
  breaks the anchor and reports a skip.

### Neutral

- The target can retire after the active Claude and Codex marketplace/cache copies all execute the
  creator/indexer round trip successfully; a stale or missing copy keeps it live.
- Retirement is local behavior proof, not a claim that reused version 0.4.1 became immutable. #2870
  still requires a bumped identity and release guard for the wider fleet.
- The local target covers the original four template metadata fields. Upstream's later, broader
  parser fix also accepts list-prefixed relationship lines; that broader behavior is not claimed
  by this compatibility transform on an old cache.

## Links

- Upstream: [ruvnet/ruflo#2659](https://github.com/ruvnet/ruflo/issues/2659)
- `lib/adr-template/`
