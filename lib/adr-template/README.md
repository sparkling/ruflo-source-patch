# `adr-template`

[← ruflo-source-patch](../../README.md)

A plugin whose two skills disagree about their own format.

Patches `ruflo-adr`'s `skills/adr-create/SKILL.md`.
Upstream: [#2659](https://github.com/ruvnet/ruflo/issues/2659)

## The bug

`adr-create`'s own documented template writes ADR metadata as a **bullet list**:

```markdown
   - **Status**: proposed
   - **Date**: <today's date YYYY-MM-DD>
```

`adr-index`'s parser is its **sibling skill, in the same plugin**, and it only recognises an *unprefixed*
`**Status**:` line or YAML frontmatter. So Status/Date/Deciders/Tags come back **empty/Unknown for every
ADR authored via the documented template**. Silently.

The patch strips the leading `- ` from those four lines, so the two skills agree.

## The trap this file used to contain

`isPatched()` was `!EDITS.some(e => src.includes(e.find))`, meaning patched *iff the anchor is absent*.
Upstream re-indents one line, every anchor stops matching, and the file reads as **fixed**: `status` said
`1/1 patched`, `monitor check` reported no drift, and #2659 was fully live.

Two of the three reporting surfaces were green on a dead patch.

Its sibling [`../adr-index/patcher.mjs`](../adr-index/patcher.mjs) names this exact trap and solves it
with `done()` predicates: *"an anchor can be absent because the fix is in, or because the file never had
that shape; only `done()` tells those apart."* This file now has them, plus `INCOMPLETE` on a partial
apply, which it also lacked: it would patch whichever anchors matched and call it success.
