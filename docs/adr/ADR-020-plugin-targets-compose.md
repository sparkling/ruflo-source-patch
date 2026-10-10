# ADR-020: Plugin patch targets compose on a shared file, from one pristine

**Status**: Implemented
**Date**: 2026-07-15
**Updated**: 2026-10-10. Operator instruction supersedes the #423/#425 completion
parser and diagnostic workarounds: `brain-codex-completion` now disables the
completion-claim feature at its existing Stop audit boundary. The audit produces
no completion authority and cannot contribute a blocking correction or automatic
promise closure. Other Stop gates are unchanged. Earlier installed overlays are
restored from the shared pristine composition; historical transformations are deleted after fleet migration. The unreleased once-per-turn workaround is discarded. There is
no replacement correction ledger or advisory. Re-enablement requires explicit
review of an upstream replacement, not merely a new release number.
The `ruflo-policy-ledger` target composes the native
policy runtime and security engine as one exact-anchor bundle for #3164.
Installation does not migrate policy data. A separately authorized first native
transaction enables bounded working state and immutable content-addressed receipt
segments, with file/directory sync before publication and an authenticated prefix
boundary. Native audit/export still returns complete history, and full verification
checks every archived receipt outside the writer lock. Older readers refuse rather
than overwrite migrated state. Receipt segments and the native trust key must be
preserved; source uninstall cannot convert data. Native retirement needs an import
and preservation proof, not a version or merged-PR check. The implementation is
independent of PR #3892; fault injection and concurrent native-process tests govern
qualification. On 2026-10-08, the authorized fleet rollout migrated 53 project/user
policy ledgers across seven machines, preserving all 1,281,493 receipts with native
full verification and exact expanded-state comparisons. Private state/trust backups
were retained, actual MCP workers restarted, and live calls checked separately from
source installation. GCP programmes were resumed with their original provider/model.

2026-10-05: `ruflo-flywheel-evidence` resolves the remaining #3229
number-domain defect in native receipt evidence: the existing recursive scale-12
encoder runs before receipt identity and signing. Strict signature, number-domain,
unknown-field and statistical verification stay unchanged. No historical receipt is
rewritten and no promotion gate is relaxed. Exact pristine composition owns install,
reapplication and uninstall; retirement requires marker-free native execution proving
nested fractional evidence, deterministic identity, valid signatures and tamper refusal.

`ruflo-champion-authority` protects ADR-322A's authoritative local promotion state from
Ruflo 3.52.0's framework `applyChampion` startup path. Ruflo #2579 documents that
framework auto-apply mechanism; it is source context, not a defect-specific report.
The synchronous guard holds the existing `flywheel-v1/transaction-state.lock` across
the ownership check and native write, using the native lock format and no stale-lock
removal. Busy, malformed, committed or pending authority defers framework application.
Absent state or the native empty-owner state retains ordinary framework adoption and
updates. `applyChampionParams`, receipts, promotion gates and state files stay unchanged.
The guard composes after project-root normalization. Behavioral proofs cover nested
working directories, either installation/removal order, concurrent lock refusal and
preservation of foreign or replaced locks. Retirement requires equivalent marker-free
native behavior; the installed overlay cannot serve as its own retirement proof.

ADR I/O safety includes the shared memory-safe edge helper in its four-file bundle.
Brain 4.5.6/4.5.7 native replacements are recognized by reviewed executable boundaries and
behavioral regression proofs. Unchanged native implementations are satisfied without local
ownership markers; unknown drift remains a visible refusal. Probes cover the shared native
redactor, grouped omission evidence, physical JSONL line diagnostics, modular generation
dispatch and the relocated private transition builder. Native suspension migration preserves
operator containment through the official persisted control before retiring overlays;
it does not claim bounded-history recovery.
Mutating application may prepare this handoff before preflight; status and pure
composition never write policy. Failed preparation protects all claimed bundle files.
The 2026-10-04 source-patch #5 change adds a composed Node preload to installed
Ruflo/Brain hook manifests. The existing stable runtime owns private bounded failure receipts;
native commands, stdin/stdout, exit codes and update ownership remain unchanged. Payloads,
environment values and arbitrary output are excluded. Native hook retirement checks unwrap only
this exact owned preload before proving the underlying command. Retirement requires equivalent
native attributed diagnostics.
Native Codex trust migration uses compare-and-swap only for the exact previously trusted
command preimage and the owned wrapper, symmetrically on removal; unrelated settings and
unapproved hooks cannot inherit trust. Metadata-only verification is not execution acceptance.
Brain #390 adds operator-authorized, reversible suspension of
automatic full-snapshot progression capture/replay/restore. Existing records and queues remain;
search, grounding, native updates, independent material events and explicit checkpoints are not
replaced. Managed CLI retains authorization and truthful command results, with explicit suspension
notice and no invented persistence receipt. Retirement requires a behaviorally proven native
scoped opt-out or mature-history correction; a version change alone cannot re-enable the defect.
Brain #389 adds bounded observations and grouped conflict metadata
with exact goal/action, immutable heads and omission digests; full canonical records remain intact. New policy serialization and terminal-diagnostic targets retain native
authorization, ledger verification, redaction and receipt ownership. The progression-outbox reader
is extended incrementally so retained journals can exceed Node's whole-string limit without history
truncation. All three fixes use exact composition, behavioral retirement and existing native writers.
Retirement reconciles only files claimed by the removed targets and their
remaining shared-file owners. Unrelated preflight failures remain visible to full apply/status/check,
but cannot block exact restoration of independent native targets. Every composed retirement callback
uses the complete batch removal set. Regression tests prove shared-owner preservation, orphan
restoration and continued reporting of an unrelated failure.
Installed-file proof now scopes composition to descriptors that claim the same physical file,
including logical/physical HOME aliases. All-mode selection alone cannot apply a Claude-only
importer transform to Codex bytes during native retirement verification.
ADR-index post-reconciliation proof also accounts for the interval before its retirement state is
committed: absent own markers exclude only that target, while every remaining sibling must still
match the exact physical-file composition.
Files shared by the CLI and plugin engines now delegate to this same composition owner. CLI
contributions reuse their existing anchor, applicability and native replacement rules; selective
removal preserves every remaining claimant. Repeated installation leaves protected system files
and their true vendor backups unchanged. Unproved marked edits retain both files and fail visibly.
Brain #380 adds an atomic three-script transition-notice bundle using the native bounded notice
ledger. Pending capture is still recorded at every boundary; only duplicate notices are suppressed.
Ruflo #3688 projects verified Claude-only module metadata from Swarm and 26 newly affected
plugins into strict Codex manifests using an exact shipped-manifest catalogue,
preserving module source and Claude copies. Neither target changes Brain's update plane or creates
a replacement hook engine; exact pristine proof and visible anchor failures remain mandatory.
Brain #382's `brain-managed-cli-capture` is a two-script atomic bundle. The producer uses the
writer's existing action projection, redacted before meaning comparison, so a new managed CLI
request/result cannot be mistaken for an unchanged lifecycle boundary. The returned producer state
stays unenriched: the native writer adds the observation exactly once and remains responsible for
the canonical store and exact readback receipt. No-op lifecycle retention, real failure/unknown
outcomes, provenance, and paused programme state remain intact. No capture flag or receipt is invented.
Retire only after marker-free native producer/writer behavior passes the same action/no-op and
redaction replay; missing or partial members block the whole bundle. Brain's updater is untouched.
Brain #383's `brain-progression-collision` atomically composes the producer, immutable store,
and capture boundary across the active generation, matching hosts, and native persistent MCP shell.
Future frozen identities bind redacted source/state/time and stable native event inputs; the old
event-key contract remains valid. A typed collision requires a validated independent exact read of
the existing canonical value. Recovery preserves that row and all conflicting outbox records,
then captures the frozen source, state, parents, sequence, and occurrence time as a deterministic
sibling with explicit non-authoritative diagnostics. Only exact new-key readback permits queue
consumption; unavailable or invalid reads, diagnostic-field conflicts, and failed writes retain debt.
Retirement requires marker-free native behavior proving immutable preservation, deterministic
retries, rejected recovery, later queue advancement, and distinct future event identities.
Neither the patch nor its fixture probes touch Brain's updater or managed database bytes directly.
Brain #384's `brain-managed-cli-generation` makes the stable MCP shell dispatch managed help,
execution and registry calls to the actual module under native `active.codeRoot`. It validates
physical containment, regular module/manifest files and exact Brain name/version, rather than
fabricating a missing persistent-shell manifest. Successful help authorizes only that selected
module in process memory; promotion requires current help and failed or old in-flight help grants
no authority. Native literal arguments, stamp behavior, capture and execution remain native-owned.
The shared composition includes the independent #102/#103 managed-memory diagnostic contribution;
its pristine backup remains true vendor source. Removing either target preserves its remaining
sibling. Retirement requires marker-free
protocol behavior proving manifest/path refusal, promotion, successful-help binding and exact
argument preservation. No update identity, updater asset, KB or managed database is changed.
`brain-grounding-code` narrows the #46 recency scan to added JS/Python
code, excluding comments and standalone Python docstrings in complete Write/Codex Add payloads.
Partial Edit/Update fragments retain their conservative requirement. Herdr exposed an unrelated application
backup refused solely for its warning against touching AgentDB. The exact vendor anchor composes
from pristine; real executable strings, imports, paths, uncertain syntax and unsupported languages
retain grounding requirements. Parser failure retains the original scan. The substance detector,
managed-memory guard, stamps and update plane remain unchanged. Retire after marker-free upstream
passes the same prose/import/expiry/dependency-failure replay; anchor drift is incomplete, not proof.

Brain #316's `brain-grounding-evidence` composes two atomic exact edits in
the native active generation's `grounding-stamp.sh` and matching host copies. Successful search
evidence is independent of the narrower product-write allowlist; existing failure rejection remains
unchanged. Cited FAST LANE cards produce turn-level evidence only, not product write stamps.
It uses the shared native discovery and pristine restoration, never the update plane.
Retire only after marker-free upstream behavior passes successful Brain-only searches, rejected
non-answers, and unchanged product-write authorization. Anchor drift is incomplete, not retirement.

Ruflo #3153's `ruflo-instruction-contract` joins composition as one atomic
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
Ruflo #3147/#3097's `adr-io-safety` adds a descriptor-level preflight for its four-file plugin bundle.
All active `verify.mjs`, `import.mjs`, `reindex.mjs`, and `lib/index-records.mjs` members and exact anchors must pass before any
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

### Brain host recovery (#391), 2026-10-04

`brain-host-recovery` composes a read-only doctor check with the existing Console and
release-lockstep installer patches. A saved Codex restart requirement is replaced in the
current diagnostic projection only after a fresh native host lists the exact installed
version's complete hook declarations, enabled and trusted. Concurrent version/source
changes, missing declarations and unknown trust refuse recovery. Existing windows remain
explicitly outside this fresh-host proof. No update receipt, scheduler, trust configuration,
active generation or memory is changed. The failed nightly run remains a failure.

The same target corrects the refresh reader to report the first required failed phase and
its error, rather than a later optional skipped cleanup. Retirement requires native behavior
proof of both recovery and refusal cases, not an issue closure or version number.

Retained generations bearing #382/#383 ownership must remain discoverable as composition
claimants after native activation changes the current generation. Otherwise #386 discovers
a shared old file alone and cannot prove its complete existing composition. Unowned older
generations remain excluded; the native updater continues to own their lifecycle.

- [ADR-001](ADR-001-source-patch-by-literal-anchors.md), [ADR-016](ADR-016-tests-are-behavioural-and-mutation-tested.md), [ADR-018](ADR-018-mcp-prefix-plugin-namespaced-tools.md), [ADR-025](ADR-025-brain-console-owned-runtime.md), [ADR-026](ADR-026-brain-memory-doctor-shared-roots.md), [ADR-027](ADR-027-brain-console-provider-catalog-fallback.md), [ADR-028](ADR-028-managed-agentdb-interface-boundary.md), [ADR-029](ADR-029-metaharness-codex-project-hooks.md), [ADR-031](ADR-031-brain-search-failure-is-not-repair-authority.md)
- `lib/plugin-compose.mjs`, `lib/plugin-command.mjs`, `lib/pristine.mjs` (`isOurs`), `lib/plugin-registry.mjs`
