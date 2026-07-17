# ADR-020: Plugin patch targets compose on a shared file, from one pristine

**Status**: accepted
**Date**: 2026-07-15
**Updated**: 2026-07-17. The manual recovery this ADR's own Negative section describes (six poisoned
backups, reconstructed by hand) is now a permanent, automatic capability: `resolvePristine()` accepts
an optional `recoverPoisoned(current)` that offers a candidate pristine plus a scoped `verify` function,
and only ever accepts it if `verify(candidate)` reproduces `current` byte for byte. `mcp-prefix` exposes
a `reverse` (its substitution is a pure, invertible literal replace), so a poisoned backup on a file it
patched now self-heals on the next apply instead of requiring another one-off manual fix. See
`lib/pristine.mjs`, `lib/plugin-compose.mjs`.
**Deciders**: Henrik Pettersen

**Tags**: plugin, patching, core, safety

## Context

ADR-018 added `mcp-prefix`, a broad substitution sweep across every ruflo plugin file. It crossed files
that `adr-template` (adr-create/SKILL.md) and `adr-index` (scripts/import.mjs) already patch, and that
exposed a latent flaw in the plugin patchers: each owned its whole apply loop and called
`resolvePristine(file, ITS_OWN_transform)`. That function assumes ONE transform per file. When a second
target patched a file the first had already patched, the second's single-transform check did not recognise
the first's output as "ours", concluded "upstream replaced it", and RE-BASELINED, overwriting the shared
`.rsp-backup` (the vendor pristine) with the sibling's PATCHED bytes. The pristine was then lost and neither
target could cleanly uninstall. Observed live: `import.mjs.rsp-backup` and `adr-create/SKILL.md.rsp-backup`
holding the #2660 / status-stripped patched bytes instead of vendor, reported as a false "upstream replaced
it".

The CLI targets never had this problem: `patch-library.mjs` groups every file by the entries that touch it
and rebuilds it as `pristine + the entries currently requested`, so `memory-initializer.js` (patched by both
`cwd` and `memory`) composes correctly and each target uninstalls independently (ADR-001). The plugin side
simply never adopted that model; it was built as self-contained per-target patchers because they patch
heterogeneous artifacts (a markdown SKILL, a JS importer, a bash gate).

Two fixes were considered. Keeping the targets DISJOINT (exclude one target's files from another) is small,
but it leaves overlaps as something to avoid rather than support, and would leave adr-create/SKILL.md's own
tool references unpatched. COMPOSING overlaps properly is the model the CLI side already proves works. The
sweep-vs-surgical overlap here is exactly the trigger for doing it: a broad target now legitimately crosses
surgical ones.

## Decision

A shared composition engine (`lib/plugin-compose.mjs`) owns every plugin-patched file, mirroring
`patch-library.mjs`:

- One `.rsp-backup` per file = the true vendor pristine. The file on disk is always
  `compose(pristine, [transform of each INSTALLED target that claims it])`.
- Each of the four vendor-file targets (adr-template, adr-index, verify-interface, mcp-prefix) is reduced to
  a DESCRIPTOR: `{ name, atomic, editCount, discover(), patchSource(src)->{next,applied,missing},
  isPatched(src) }`. Their per-file loops are gone; the engine groups files by claimant, resolves the ONE
  pristine, applies each claimant in order, writes once, and renders each target's INCOMPLETE / ambiguous /
  skip reporting verbatim.
- `resolvePristine` gained an optional `isOurs(src)` hook. Re-baseline now fires only when the file is
  NEITHER the backup NOR recognisably ours under ANY combination of targets. So a file still carrying an
  UNINSTALLED target's edits is recognised as ours and re-derived with only the active targets, instead of
  being adopted as a corrupt pristine. This is the same `isOurs` disjunction the CLI patcher uses.
- `atomic` targets (verify-interface) contribute all-or-nothing: a partial match writes NOTHING and says so,
  because its regex edit shifts the capture indices its readers use.
- The hot path (SessionStart hook + every monitor tick) walks only the INSTALLED descriptors, so a machine
  without mcp-prefix never pays for its ruflo-tree scan. Uninstall re-derives shared files and restores
  orphaned ones.
- mcp-prefix's discovery is now a POSITIVE signal (a file carrying the bare or the plugin-form prefix), not
  "any file with a sibling `.rsp-backup`", which is what let it hijack the surgical targets' files.

`adr-reindex` is NOT part of this: it ADDS a skill file rather than patching a vendor one, so it keeps its
own patcher.

## Consequences

### Positive

- A file two targets patch is rebuilt from one vendor pristine; each uninstalls independently, byte-identical
  restore, no backup corruption. Verified: adr-template + mcp-prefix on one SKILL.md, remove either and the
  other survives from the same pristine.
- Overlap is first-class, not avoided: adr-create/SKILL.md gets BOTH its status fix and its tool-ref rewrite.
- The plugin side now shares the CLI side's proven composition discipline instead of a weaker parallel one.

### Negative

- It is a refactor of the tool's most safety-critical machinery (pristine / backup / re-baseline), guarded
  by the existing plugin suites plus a new composition test (uninstall-one-keeps-the-other, one-backup,
  byte-restore, no-hijack, re-baseline).
- The bug had already corrupted six ruflo-adr backups on the author's machine; those were reconstructed to
  true vendor (git HEAD for the current version, reverse-patch for a stale one) with a round-trip check.

### Neutral

- Descriptors expose `editCount` so the composed log keeps the "N/5 edits" wording status and tests read.

## Links

- [ADR-001](ADR-001-source-patch-by-literal-anchors.md), [ADR-016](ADR-016-tests-are-behavioural-and-mutation-tested.md), [ADR-018](ADR-018-mcp-prefix-plugin-namespaced-tools.md)
- `lib/plugin-compose.mjs`, `lib/plugin-command.mjs`, `lib/pristine.mjs` (`isOurs`), `lib/plugin-registry.mjs`
