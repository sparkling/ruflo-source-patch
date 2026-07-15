# ADR-017: Optional anchors, and covering npm's hidden-alias package layout

**Status**: accepted
**Date**: 2026-07-15
**Deciders**: Henrik Pettersen
**Tags**: patching, safety, cwd

## Context

One bug report surfaced two independent ways the patcher could miss real cwd drift while every
reporting surface looked healthy. A `cwd status` showed `skip:anchor-not-found` for
`commands/neural.js` and `ruvector/lora-adapter.js`, and the anchors for the real work were present.

First, the paired anchors. Four entries (`commands-agent`, `commands-hooks`, `commands-neural`,
`ruvector-lora-adapter`) each anchor TWO independent state directories in one file,
`process.cwd(), '.claude-flow'` and `process.cwd(), '.swarm'`, both `all: true`. A given upstream
build writes only the directories that file happens to use: `neural.js` was measured at four
`.claude-flow` sites and zero `.swarm` sites in one release, five and ten in another. ADR-001's rule
dropped the WHOLE entry if any `all` edit found zero occurrences, so the absent sibling took the
present one down with it. The four `.claude-flow` sites shipped unpatched, under the label
`skip:anchor-not-found`, which means "upstream moved a known anchor, come look". Here the anchor for
the real work was present and unique. The failure did not look like success; it looked like a
DIFFERENT failure, and the drift hid beneath it. These two edits were never interdependent, so
bundling them under one atomicity unit was the mismodeling.

Second, the hidden-alias layout. `discover()` locates a file by joining its suffix onto
`@claude-flow/cli` literally. But npm and npx install a full second copy of a package under a
content-addressed hidden-alias directory, `@claude-flow/.cli-YaBvWJZO`, whenever more than one
version must coexist in one tree. A literal join never finds it, so that copy, `commands/daemon.js`
and all, shipped UNPATCHED. `scanUncoveredBuilds()` correctly flagged it, because the alias
directory basename is not in `KNOWN_CLI_PKGS`. Measured live: a `.cli-core-<hash>` copy with
`types.js` at zero markers beside a fully patched `cli-core`. The obvious fix, matching the
directory name against a known list to silence the warning, would have made a genuinely unpatched
daemon-spawner look covered: the exact failure-as-success this package exists to refuse.

## Decision

Add `optional: true` to an edit. It relaxes ONLY the zero case, and only for an `all` edit: an
optional anchor that is absent is a deliberate no-op, never a skip. It never excuses an ambiguous
anchor, so an optional non-`all` edit that matches more than once is still refused. An entry made
entirely of optional edits must still anchor AT LEAST ONE of them (require-any): a file we patch
because it writes durable state that now anchors none of it is real drift, reported with the same
loud `skip:anchor-not-found` a moved required anchor gets. The four paired entries carry
`optional: true` on both directory edits. Every single-anchor entry is unchanged and still strict,
because a lone anchor that vanishes genuinely warrants a look.

The byte-check surface (`entryApplied`, read by `status` and `monitor check`) mirrors this exactly,
so the two corroborating surfaces cannot disagree. An edit is satisfied if its replacement is
present, or, for an optional edit, if its anchor is genuinely absent; and a wholly-optional entry
that anchored nothing is drift, not a clean apply.

Cover the hidden-alias layout in `discover()` via `scopedAliasPaths()`: for a scoped suffix, also
look for sibling directories matching `.<pkg>-*` and include those whose own `package.json` name
equals the scoped package. Disambiguation is by name, never the prefix, because `.cli-core-<hash>`
also starts with `.cli-`. With the alias copy now genuinely patched, `scanUncoveredBuilds()`
identifies a build by its `package.json` name rather than its directory basename, so the
now-covered alias stops being flagged while a genuinely foreign daemon-spawning CLI still is.

## Consequences

### Positive

- The present state-directory anchor is always patched, whether or not its sibling exists in a
  given build. The unpatched drift the report found is closed, and it was latent in two more entries
  than the report named.
- Silencing is honest. An absent optional sibling is quiet, but a paired file anchoring NEITHER
  directory is as loud as any moved anchor. Require-any is the guard that stops `optional` from
  hiding drift.
- The alias copy is actually patched, not merely un-warned. The daemon it can spawn is now
  root-anchored like every other copy, which is the whole reason the `cwd` and `daemon` targets
  exist.
- `status` / `monitor check` and the apply log agree on every state, by construction.

### Negative

- `optional` narrows detection for the paired files only: if upstream removes BOTH directories from
  one of them, require-any reports `skip:anchor-not-found` though the drift may have been fixed
  upstream. This is the false-alarm profile a single-anchor entry already has, applied at the pair
  level, and it errs toward looking rather than toward silence.
- `discover()` now reads each scope directory and parses a `package.json` per candidate alias. That
  is more I/O per apply, bounded by the number of `.pkg-*` siblings and gated behind a cheap prefix
  check.

### Neutral

- `optional` is a property of the EDIT, like `all`. It composes with `all` and changes nothing about
  any non-optional entry.
- The distinction the report asked for, "nothing to patch" versus "anchor moved", is only decidable
  for a paired entry where one anchor is present and one is absent. For a single anchor, zero
  occurrences is genuinely ambiguous, so the strict, louder default stands; this ADR adds no benign
  no-op state for lone anchors.

## Links

- [ADR-001](ADR-001-source-patch-by-literal-anchors.md)
- [ADR-004](ADR-004-cwd-anchor-state-to-project-root.md)
- [ADR-016](ADR-016-tests-are-behavioural-and-mutation-tested.md)
- `lib/cwd/patch-library.mjs`
