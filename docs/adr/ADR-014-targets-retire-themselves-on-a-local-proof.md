# ADR-014: Targets retire themselves on a local proof, never on a published verdict

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: lifecycle, safety, core

## Context

Every target here is temporary by design: upstream is supposed to fix these, and when it does the patch
should get out of the way. Left installed, a superseded patch is at best dead weight and at worst actively
wrong once upstream restructures around it.

The obvious mechanism is a published list of "fixed" issues that the tool reads and acts on. It is the wrong
mechanism, and one week proved it twice:

- **#2621** was CLOSED and NOT FIXED. Upstream's own commit comment says so.
- **#2666** was CLOSED and genuinely fixed, and still did not RUN. The plugin ships from the marketplace the
  instant it lands; the `memory purge` its reindex calls shipped on npm separately, in 3.29.0. In between,
  the skill was installed and the command it invokes did not exist.

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

- `adr-reindex` retired itself on this machine, on proof, and the audit record says exactly why.
- Announced ONCE, then silence. The old behaviour was a warning that fired every session and could never
  resolve itself, and a banner that always cries wolf is a banner people stop reading.
- A retirement is explicitly NOT reported as a problem, because crying wolf over good news is how the
  warning that matters gets ignored.

### Negative

- A predicate is only as good as the person who writes it, and writing one for a fix that does not exist yet
  is guessing at the shape of someone else's future patch. So they are written when the fix lands, not
  before, and six of seven targets have none.

### Neutral

- Read-only actions report supersession; mutating actions act on it.

## Links

- [ADR-001](ADR-001-source-patch-by-literal-anchors.md), [ADR-015](ADR-015-self-update-from-immutable-tags.md)
- `lib/supersede.mjs`
