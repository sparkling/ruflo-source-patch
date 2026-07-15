# ADR-003: The stable copy is the executable; trust provenance, not location

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: runtime, safety, self-update

## Context

The SessionStart hook and the monitor must run code that does not vanish. The npx cache is volatile: it is
content-addressed, re-fetched on version change, and garbage-collected. Pointing a persistent hook at a
path inside it is pointing it at something that will disappear.

Worse, the first version of this had a silent failure: the package could upgrade and NOTHING it does would
upgrade with it. The hook and the monitor kept executing the old library forever, and because every
reporting surface was ALSO the old code, it never said so. Found live at nine modules behind.

## Decision

`~/.ruflo-source-patch/lib` is **not a cache. It is the executable.** The hook and the monitor run that
copy, mirrored from the package at install time with the full directory shape preserved (a flat copy breaks
the cross-directory imports at exactly the moment they matter: inside the hook, where the failure is
invisible).

The freshness invariant is **provenance, not location**: the source path is recorded at sync time, and
drift is measured against THAT source.

Diffing against the globally-installed package is the obvious answer and it is wrong. Develop from a clone
and the global install is OLDER, so the CLI would sync the clone in and the monitor would heal it BACKWARD
to the stale release: two writers fighting on a timer. The fuzz suite caught exactly that.

## Consequences

### Positive

- The hook and the monitor cannot be broken by npm garbage-collecting a cache directory.
- "Is the running code current?" has an answer, and the monitor self-heals when it is not.
- A clone stays pinned to the clone; a released install stays pinned to the release. One rule, both correct.

### Negative

- The stable copy is a second place the code lives, which must be kept in step (it is, by the monitor).
- Under npx-only usage there is no durable package to compare against, so drift returns `unknown` rather
  than `healthy`. That is deliberate: unknown must never be dressed up as fine.

### Neutral

- Self-update writes into this directory, so new code lands on the NEXT tick, never mid-run.

## Links

- [ADR-015](ADR-015-self-update-from-immutable-tags.md)
- `lib/cwd/stable.mjs`
