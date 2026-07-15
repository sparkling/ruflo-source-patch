# ADR-015: Self-update from immutable tags, on the monitor tick

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: lifecycle, security, self-update

## Context

A supersession predicate (ADR-014), or a fix to the patcher itself, is worthless if it never arrives.
Nothing about a patched `node_modules` updates itself, and a predicate published today reaches a machine
only when that machine next runs the tool.

Putting the update on the SessionStart hook is the same mistake the monitor exists to fix: the hook fires
only when a session STARTS, and people leave Claude Code running for days. A patch that upstream's
restructuring has turned from redundant into actively WRONG would keep re-applying itself every five
minutes, for a week.

But auto-updating from `github:sparkling/ruflo-source-patch` is not "fetch the newest release". That is a
GIT REF: no semver, nothing immutable, and a force-push retroactively changes what everyone already
installed. It would be standing remote code execution from a moving target.

## Decision

The MONITOR TICK checks for a newer **immutable semver TAG** and installs it. Not the hook, because staleness
must be bounded by the scheduler, not by how long someone leaves an editor open.

Tags only, never a branch. `v4.16.0` is the same bytes forever, a bad commit on `main` reaches nobody until
it is tagged, and the version that ran is one you can go back and read.

Every rule is load-bearing and tested:

- immutable semver tags only; a branch or a moving `latest` is refused
- FORWARD only. A downgrade would reinstate patches upstream already fixed and un-retire what was retired on
  proof
- installs the PINNED tag, never `#main`
- offline, or GitHub down: keep the working version, silently. A tool that breaks itself upgrading is worse
  than a stale one
- a FAILED install stays on the old version and SAYS SO
- runs at the END of the tick: the child rewrites the stable copy while this process holds its modules in
  memory, so new code lands on the NEXT tick, never mid-run
- `RSP_NO_SELF_UPDATE=1` kills it

## Consequences

### Positive

- A fix, or a retirement, reaches every machine within one interval, with no user action.
- The rebuild-from-pristine design (ADR-001) means the old, possibly broken, patch is REPLACED wholesale
  rather than layered on. Verified on the real upgrade path.

### Negative

- It executes fetched code, unattended. That is a real trust surface, and the only thing making it defensible
  is that tags are immutable and the package is the user's own choice to install.
- Commits reach nobody until they are tagged, so an untagged fix is an undelivered fix.

### Neutral

- The kill switch is not a nicety: without it, running the test suite would reach the network and genuinely
  reinstall the developer's own tool.

## Links

- [ADR-003](ADR-003-the-stable-copy-is-the-executable.md), [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md)
- `lib/cwd/update-check.mjs`
