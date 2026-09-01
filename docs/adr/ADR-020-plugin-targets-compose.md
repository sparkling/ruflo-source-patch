# ADR-020: Plugin patch targets compose on a shared file, from one pristine

**Status**: Implemented
**Date**: 2026-07-15
**Updated**: 2026-09-01. Ruflo #3153's `ruflo-instruction-contract` joins composition as one atomic
discovered generator set. It patches every present Claude surface and each authenticated Codex adapter,
validates every rendered template plus current core schemas, exposes an exact inverse, and retires only
after marker-free executable native behavior proves both hosts overall (ADR-033).
`brain-search-safety` now distinguishes native satisfaction from local
ownership during reconciliation; the engine prefers a descriptor's explicit `hasPatch` predicate so
marker-free upstream bytes are preserved. The manual recovery this ADR's own Negative section describes (six poisoned
backups, reconstructed by hand) is now a permanent, automatic capability: `resolvePristine()` accepts
an optional `recoverPoisoned(current)` that offers a candidate pristine plus a scoped `verify` function,
and only ever accepts it if `verify(candidate)` reproduces `current` byte for byte. `mcp-prefix` exposes
a `reverse` (its substitution is a pure, invertible literal replace), so a poisoned backup on a file it
patched now self-heals on the next apply instead of requiring another one-off manual fix.
`adr-index` additionally recovers a non-empty, self-patched marketplace backup from the bounded
Git HEAD object and preserves the file's executable mode across atomic replacement. Cache-local
Codex skill targets remain outside composition: additive files use exact ownership. Brain #76's former
single-file edit now retires after executing the immutable installed workflow and a missing-notes
mutation. Brain #77's
`brain-release-lockstep` guard joins composition as an atomic eight-edit descriptor over installed
npm/npx and persistent Console-runtime `bin/install.mjs` copies. It changes only read-only version
reporting and doctor health; the native updater, Stable Spine, caches, hooks, MCP, and learning plane
remain untouched. It also exposes an exact reverse transform so a later target revision can prove and
recover the vendor baseline instead of adopting the earlier target's output as “new upstream” bytes.
Published 4.0.36 repairs the release rail but not that doctor boundary: all eight current literal
anchors still compose exactly, and the target remains live until component-by-component executable
mutation proves the native doctor fails on a split or pending generation.
Brain #79's `brain-console-lifecycle` target composes beside #77 on `bin/install.mjs`. Brain 4.0.12's
native whole-runtime launcher is recognized as ready and preserved; only the missing live-doctor
comparison remains an edit on current bytes. Owned older copies remain discoverable for exact restoration
(ADR-025). Brain #81 and #86 now retire together on executable installed behavior. Retirement computes
the full superseded set before reconciliation so neither composed target is accidentally re-applied while
the other is removed (ADR-026, ADR-027).
MetaHarness #168's `metaharness-codex-hooks` target also joins composition. It owns authenticated
installed `metaharness` and `@metaharness/host-codex` runtime files, adds no output when hooks are
absent, and keeps an exact reverse transform for safe npm/npx re-baselining and removal (ADR-029).
Brain #102/#103's `brain-managed-memory-boundary` intentionally stays outside per-file composition.
It must atomically coordinate vendor transforms and marker-owned additive modules across the native active
generation, matching host copies, and the persistent MCP shell. It therefore preflights one global
transaction and rolls every write back on failure, while still using exact pristine backups for vendor
bytes (ADR-028).
Brain #224/#225's `brain-search-safety` joins composition for the three executable files in the active
shared KB. Its `hasPatch` is deliberately narrower than `isPatched`: native-equivalent behavior satisfies
status, while only the local marker proves ownership during reconciliation. The composition engine now
prefers that explicit ownership predicate, preventing a marker-free upstream fix from being mistaken for
an orphaned local patch that requires a backup (ADR-031).
Ruflo #3147/#3097's `adr-io-safety` adds a descriptor-level preflight for its three-file plugin bundle.
All active `verify.mjs`, `import.mjs`, and `reindex.mjs` members and exact anchors must pass before any
member is written; one missing or drifted file protects every claimed file and remains visible in the
status denominator (ADR-032).
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
- Each composed vendor-file target is reduced to
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

`adr-reindex` and additive files created by `ruflo-codex-skills` / older
`brain-codex-skills` copies are NOT part of this: they keep exact ownership checks. Brain 4.0.12
natively replaces the final #76 `whats-new` file. Its retirement still uses the shared pristine helper
for exact restoration because no sibling target claims it.

## Consequences

### Positive

- A file two targets patch is rebuilt from one vendor pristine; each uninstalls independently, byte-identical
  restore, no backup corruption. Verified: adr-template + mcp-prefix on one SKILL.md, remove either and the
  other survives from the same pristine.
- Overlap is first-class, not avoided: adr-create/SKILL.md gets BOTH its status fix and its tool-ref rewrite.
- The plugin side now shares the CLI side's proven composition discipline instead of a weaker parallel one.
- The #77 guard cannot conceal a split release by relabelling or copying caches: it reports all
  resolved product versions and makes doctor fail until upstream artifacts genuinely converge.
- The #79 target can share the installer with #77 without either patch adopting the other's output as a
  vendor baseline. Native launcher bytes remain untouched while the read-only doctor delta stays live.
- Multiple superseded composed targets reconcile in one removal set; retirement order cannot cause a
  sibling target to be re-applied between proofs.
- Native-equivalent files can satisfy a target without becoming locally owned; retirement preserves those
  bytes and removes only exact local compositions/backups.

### Negative

- It is a refactor of the tool's most safety-critical machinery (pristine / backup / re-baseline), guarded
  by the existing plugin suites plus a new composition test (uninstall-one-keeps-the-other, one-backup,
  byte-restore, no-hijack, re-baseline).
- The bug had already corrupted six ruflo-adr backups on the author's machine; those were reconstructed to
  true vendor (git HEAD for the current version, reverse-patch for a stale one) with a round-trip check.

### Neutral

- Descriptors expose `editCount` so the composed log keeps the "N/5 edits" wording status and tests read.
- Additive/disjoint targets still share desired-state tracking, SessionStart re-apply, monitor coverage,
  atomic writes, and fail-closed restoration; only their per-file composition model differs.

## Links

- [ADR-001](ADR-001-source-patch-by-literal-anchors.md), [ADR-016](ADR-016-tests-are-behavioural-and-mutation-tested.md), [ADR-018](ADR-018-mcp-prefix-plugin-namespaced-tools.md), [ADR-025](ADR-025-brain-console-owned-runtime.md), [ADR-026](ADR-026-brain-memory-doctor-shared-roots.md), [ADR-027](ADR-027-brain-console-provider-catalog-fallback.md), [ADR-028](ADR-028-managed-agentdb-interface-boundary.md), [ADR-029](ADR-029-metaharness-codex-project-hooks.md), [ADR-031](ADR-031-brain-search-failure-is-not-repair-authority.md)
- `lib/plugin-compose.mjs`, `lib/plugin-command.mjs`, `lib/pristine.mjs` (`isOurs`), `lib/plugin-registry.mjs`
