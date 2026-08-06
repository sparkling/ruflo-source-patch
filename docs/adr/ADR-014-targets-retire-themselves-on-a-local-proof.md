# ADR-014: Targets retire themselves on a local proof, never on a published verdict

**Status**: accepted
**Date**: 2026-07-14
**Updated**: 2026-08-06. Brain 4.0.12 supplied three executable replacements: #76 now runs curated
exact-version notes from one immutable installed payload and fails closed when that asset is missing;
#81 shares common/configured-root discovery between standalone doctor and Console; and #86 stages and
validates the provider catalog while exposing an explicit unverified state when it is unavailable.
Positive probes plus deliberate missing-asset/root/catalog mutations authorize terminal retirement of
those three targets. A simultaneous-retirement set prevents one superseded composed target from being
re-applied while its sibling is being removed. #79 is different: the native launcher passes whole-runtime
identity, receipt, shutdown, and replacement proof, but the released doctor still does not compare the
candidate, persistent runtime, receipt, live endpoint, PID, and API identity required by the issue. Its
target is therefore narrowed, not retired. #77 still sees a real package/KB/release identity split.
#102's source fix and #103's opt-in boundary are unreleased; #103 also lacks host non-execution proof and
the audited diagnostic, so `brain-managed-memory-boundary` remains live (ADR-028). The
MetaHarness #168 `metaharness-codex-hooks` target likewise has no guessed version predicate: a
published candidate must execute adapter, CLI, and Studio generation, strict Codex parsing, matcher
preservation, packaged handler resolution, and trust messaging before retirement (ADR-029). The
`adr-reindex` predicate requires the current fail-closed #2878 lock markers, so the older
fail-open wrapper cannot falsely authorize retirement. `adr-index` retires only after every active
Claude/Codex copy executes native convergence, its pristine importer reports stores honestly, and
the native deletion route passes that same reindex lock proof.
**Deciders**: Henrik Pettersen
**Tags**: lifecycle, safety, core

## Context

Every target here is temporary by design: upstream is supposed to fix these, and when it does the patch
should get out of the way. Left installed, a superseded patch is at best dead weight and at worst actively
wrong once upstream restructures around it.

The obvious mechanism is a published list of "fixed" issues that the tool reads and acts on. It is the wrong
mechanism, and one week proved it twice:

- **#2621** was CLOSED and NOT FIXED. Its focused ordinary-writer residual is now open as #2878.
- **#2666** was CLOSED with both a skill and `memory purge`, but its first acceptance point was not
  complete: purge takes `<db>.lock` while ordinary writers take no lock. The plugin/CLI release split
  also left an earlier window where the skill existed and its command did not.
- **Brain #52** showed the reverse ordering: the installed 4.0.1 artifact passed the full native
  lifecycle/stable-wrapper predicate before the issue closed with the 4.0.2 release. Issue state is
  neither necessary nor sufficient evidence.

`closed` is not `fixed`, and `fixed` is not `runnable here`. A retirement list keyed on either would have
uninstalled a WORKING reconcile on everyone still on an older CLI, unattended.

## Decision

Publish a PREDICATE, not a verdict. Each target declares the condition under which it is obsolete, as CODE,
evaluated LOCALLY against the software actually installed. Retirement becomes a measurement, the same
discipline as the anchors: never trust a version number, check that the thing is really there.

The predicate SHIPS IN THE PACKAGE and is never fetched at runtime. A remote file that an unattended job
parses and acts on DESTRUCTIVELY is a live channel into every user's machine, where one typo is a mass
uninstall with no review at the moment it happens.

Every unknown biases toward KEEPING the patch. Replacement present but not runnable: keep. Replacement
absent: keep, never retire into a hole. Probe throws: keep. The cost of wrongly keeping a patch is a
redundant command; the cost of wrongly retiring one is an index that reports a successful reconcile and
reconciles nothing.

Retirement is TERMINAL and AUDITED (reason, evidence, issue, timestamp in `state.json`), because the hook
re-applies everything in that file and `make install` installs every target, so a retirement with no memory
of itself would flip-flop forever. `install` on a retired target refuses and prints the evidence. There is
deliberately NO `unretire` and no `pin`: if the predicate is right the answer is right, and every override is
another surface to get wrong.

## Consequences

### Positive

- `adr-index` and `adr-reindex` retired themselves on this machine, on proof, and the audit record
  says exactly why.
- Announced ONCE, then silence. The old behaviour was a warning that fired every session and could never
  resolve itself, and a banner that always cries wolf is a banner people stop reading.
- A retirement is explicitly NOT reported as a problem, because crying wolf over good news is how the
  warning that matters gets ignored.

### Negative

- A predicate is only as good as the person who writes it, and writing one for a fix that does not
  exist yet is guessing at the shape of someone else's future patch. They are written when a candidate
  fix lands and must exercise its real boundary, not merely search for a version or marker.

### Neutral

- Read-only actions report supersession; mutating actions act on it.

## Links

- [ADR-001](ADR-001-source-patch-by-literal-anchors.md), [ADR-015](ADR-015-self-update-from-immutable-tags.md), [ADR-026](ADR-026-brain-memory-doctor-shared-roots.md), [ADR-027](ADR-027-brain-console-provider-catalog-fallback.md), [ADR-028](ADR-028-managed-agentdb-interface-boundary.md), [ADR-029](ADR-029-metaharness-codex-project-hooks.md)
- `lib/supersede.mjs`
