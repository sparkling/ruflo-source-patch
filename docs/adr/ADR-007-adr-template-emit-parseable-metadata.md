# ADR-007: adr-template: make adr-create emit metadata adr-index can parse

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: patch-target, plugin, adr

## Context

`ruflo-adr`'s two skills disagree about the file format. `/adr-create` writes ADR metadata in one shape, and
`/adr-index`'s importer parses another. The result is an ADR that is created successfully and then indexed
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

- If upstream aligns the two skills, the anchor stops matching, the target reports `skip:anchor-not-found`,
  and the supersession machinery (ADR-014) can retire it.

## Links

- Upstream: [ruvnet/ruflo#2659](https://github.com/ruvnet/ruflo/issues/2659)
- `lib/adr-template/`
