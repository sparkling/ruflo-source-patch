# ADR-019: `all` install tracks the evolving target set; new targets adopt themselves

**Status**: accepted
**Date**: 2026-07-15
**Deciders**: Henrik Pettersen

**Tags**: lifecycle, self-update, core

## Context

The framework's whole premise (ADR-002, ADR-015) is that you install once and the machine stays patched
with no manual step: the monitor pulls new tags and re-applies. But a target INTRODUCED in a later release
was an exception. The self-update re-ran `monitor install`, which re-applies only the set already recorded
in `state.json`, so a brand-new target sat dormant until someone manually ran `all install` (or
`<target> install`). ADR-018's `mcp-prefix` shipped exactly this way, and it contradicts the premise: a new
fix does not reach a running machine on its own.

The naive fix (self-update always runs `all install`) is wrong. It would install every target onto a machine
that deliberately cherry-picked one, which is the "installs things you didn't ask for" default the CLI
already refuses elsewhere. Adoption must apply only to someone who asked for the complete set.

## Decision

Record a single boolean, `state.all`, the "keep me on the COMPLETE, current set" contract:

- `all install` sets it true. `all uninstall`, and ANY single-target uninstall, set it false: the moment you
  curate a subset you have stopped asking for everything, so the tool stops tracking everything. A
  single-target INSTALL does not clear it (adding to a set you already track is not a deviation).
- The self-update reads it. In ALL MODE it re-runs `all install` at the new tag; otherwise `monitor install`
  as before. The child runs the NEW tag's code, so its `all install` knows the new target set, records any
  new target into `state.json`, and applies it. The SessionStart hook and the monitor then re-apply it like
  any other. No change to their apply logic: the recorded set stays complete because `all install` reruns on
  every upgrade.

This is the mirror of ADR-014 retirement. There, a target leaves the live set on a local proof; here, a new
target joins it for an `all` install. Both say the same thing: an `all` install tracks the maintained set as
it evolves, in and out.

Retirement still gates adoption: `all install` skips a retired target (it already refuses to resurrect one),
so a new target that is superseded on this machine is not adopted.

## Consequences

### Positive

- A fix shipped as a new target reaches every `all`-mode machine within one interval, with no manual step.
  The premise holds for additions, not just for changes to existing targets.
- Cherry-picked installs are untouched: `monitor install`, the exact recorded set, nothing added.
- Tiny surface: one boolean and one branch in the self-update. The hook and monitor are unchanged, and the
  heavy lifting reuses the already-tested `all install` path rather than a second installer.

### Negative

- A new target auto-applies unattended on `all`-mode machines, so a wide or costly target (ADR-018's
  `mcp-prefix` touches ~474 files) lands without a prompt. This is the same trust already granted to the
  self-update for CHANGES to existing targets (ADR-015 runs tagged code unattended); it now extends to
  additions, which raises the bar on a new target being correct before it is tagged.
- Existing `all`-mode installs predate the `state.all` flag, so their FIRST upgrade still runs
  `monitor install`. They adopt automatically only after `all install` is run once to set the flag. A
  one-time step for the transition, then never again. Auto-inferring the flag from the recorded set was
  rejected as a fuzzy heuristic that could mis-activate a wide target on a machine that merely happened to
  have most targets.

### Neutral

- The child's `all install` output is not surfaced to the user (the monitor tick is detached). A dedicated
  once-only "adopted <target>" notice through the UserPromptSubmit notifier, symmetric with the retirement
  announcement, is a deliberate follow-up rather than part of this change.

## Links

- [ADR-002](ADR-002-monitor-and-hooks-not-a-daemon.md), [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md), [ADR-015](ADR-015-self-update-from-immutable-tags.md), [ADR-018](ADR-018-mcp-prefix-plugin-namespaced-tools.md)
- `lib/cwd/state.mjs` (`setAllMode`, `isAllMode`), `lib/cwd/update-check.mjs`
