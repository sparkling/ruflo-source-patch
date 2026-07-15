# ADR-004: cwd: anchor durable state to the project root, not a drifted working directory

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: patch-target, data-loss, cwd

## Context

Stray `.claude-flow` folders are the symptom. The bug is **silent data loss**.

`.claude-flow/` holds the learning state: `autopilot-state.json`, `neural/` checkpoints, `metrics/`,
`learning.json`, `vectors.json`, `agentdb/`, `hnsw/`, and `.swarm/memory.db`. All of it is anchored to raw
`process.cwd()`.

Under an agent, `process.cwd()` is not the project. Claude Code's Bash tool working directory is STICKY
across tool calls: an agent runs `cd src/website && npm test` for an unrelated reason, and from that moment
every `ruflo` command, `npx` invocation and MCP spawn in the session is anchored in `src/website/`. The user
never left the repo root.

So state is written where nothing will ever read it again. And it does not error: `loadState()` finds no
file at the drifted cwd, RETURNS DEFAULTS, and writes a fresh one. The self-learning system quietly resets
to zero, and it looks exactly like normal operation.

Measured on one 12-repo working set: 109 `.claude-flow` directories, 97 of them stray.

cwd-dependence takes three syntactic forms, and only one is greppable: 62 explicit
`path.join(process.cwd(), '.claude-flow', ...)`; 11 implicit (a one-arg `resolve()` is ALREADY
cwd-relative, so there is no `process.cwd()` token to find); and 87 argument-passing, where the callee
builds the path from a parameter.

## Decision

Resolve the project root and anchor every durable-state path to it. Ported from `sparkling/ruflo`'s ADR-0100
and ADR-0137, which triaged all 91 sites (70 fixed, 21 kept as deliberate `intentional-cwd`).

**The resolver**, by marker priority: `.ruflo-project` sentinel, then `CLAUDE.md` AND `.claude/` (both
required, so a `docs/CLAUDE.md` is not mistaken for a project), then `.git`, then the start dir unchanged.
`.git` alone is not enough: a monorepo package has its own `.claude/` and no `.git`, so a bare `.git` walk
sails past it and pools every package's state into one store. Memoised per RESOLVED start dir, never at
module load, because a module-level cache goes stale precisely when the cwd drifts.

**Anchored at the callee, not the call site**, so one edit fixes every caller, present and future. The
implicit-relative case is fixed by patching the CONSTANT (`STATE_DIR`), since `resolve(<absolute>)` returns
it unchanged.

**`commands/init.js` is deliberately NOT patched.** `init` legitimately targets the invocation directory,
so resolving it would initialise a nested project at the outer repo root.

**And a leak detector**, because completeness cannot be PROVEN: a `.claude-flow` in a subdirectory IS an
anchor that leaked, whatever form it took. The SessionStart hook reports them, and only reports.

## Consequences

### Positive

- Durable state stops silently resetting. Verified end to end: from `src/deep/nested`, state lands at the
  project root with zero stray directories.
- Daemon proliferation collapses as a side effect, because a stray folder is the daemon spawn gate.
- A monorepo package keeps its own store instead of pooling into the outer repo.

### Negative

- A grep-driven patch CANNOT be complete, and an incomplete one is WORSE THAN NONE: it splits writers from
  readers. We shipped exactly that, and it is the reason the leak detector exists. `getProjectCwd` (the
  READER of `harness-active-policy.json`) was anchored while `applyChampion` (its WRITER) still followed the
  drifted cwd, so the reader looked at the project root for a file the writer had put elsewhere and silently
  found nothing. Unpatched, both sides at least AGREED on the drifted directory.
- 29 anchors in vendor `dist` output is a real maintenance surface.

### Neutral

- Overriding `process.cwd()` was rejected: it produces a split brain, because `path.*` follows the override
  while `fs` resolves relative paths against the real OS cwd via libuv and ignores it.
- `process.chdir()` at the entry point was rejected: it is consistent, but it breaks the 21 legitimately
  cwd-anchored sites (`init`, user `--output`, generated scripts).

## Links

- Upstream: [ruvnet/ruflo#2633](https://github.com/ruvnet/ruflo/issues/2633)
- Prior art: `sparkling/ruflo` ADR-0100 (`bb9e56dec`), ADR-0137 (`627b6cf14`)
- [ADR-005](ADR-005-daemon-dedup-at-the-project-root.md)
- [ADR-017](ADR-017-optional-anchors-and-the-hidden-alias-layout.md): the paired `.claude-flow` / `.swarm` anchors are optional per build, and the hidden-alias package layout is covered
