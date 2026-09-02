# ADR-033: Generated Ruflo instructions use the live structured interface

**Status**: Implemented
**Date**: 2026-09-01
**Last updated**: 2026-09-02
**Deciders**: Henrik Pettersen
**Tags**: ruflo, init, instructions, mcp, codex, claude-code, migration

## Context

Ruflo 3.38.20's six Claude instruction templates and four Codex templates describe Ruflo MCP as the
coordination plane, then direct routine swarm, memory, hook, worker, benchmark, workflow, session, and
status operations through raw `npx @claude-flow/cli...` commands. The installer also copies four core
Codex task skills (and a fifth performance skill in some published generations), while the CLI emits a
Ruflo platform skill. Those more-specific project instructions repeat the raw commands and therefore
override an MCP-first root policy whenever selected. Several examples name tools or flags that the same
release does not expose. The generated files also conflate source-grounded product claims with local
runtime discovery and describe native host agents as Ruflo-coordinated before Ruflo records exist.

The active RuvNet Brain contract requires structured Ruflo MCP first. A real CLI-only gap goes through
the managed help/run bridge with literal argv when available; direct shell remains valid for bootstrap,
diagnostics, and explicitly chosen process administration. On Hetzner, the installed command is
`ruflo` 3.38.21 while `claude-flow` is absent. The Brain bridge accepts both executable names, so generic
guidance caused an agent to choose `claude-flow` and fail with `ENOENT`. The live MCP memory schemas also
have no explicit database-path or user-scope argument, while `ruflo memory search --path ...` does. Thus
project memory remains MCP-first and a separately configured user database remains one narrow CLI-only
scope until MCP exposes it. Upstream issue
[#3153](https://github.com/ruvnet/ruflo/issues/3153) records the source locations, reproduction, proposed
shared renderer, and all-template acceptance criteria. Open issue
[#2638](https://github.com/ruvnet/ruflo/issues/2638) separately tracks Claude/Codex source divergence.

Existing project files are user-owned. This fleet contains project-specific instruction blocks, so
re-running init or rendering a complete template would erase valid policy. Runtime databases, hooks,
settings, registries, caches, and processes are outside an instruction migration.

## Decision

Add the issue-backed `ruflo-instruction-contract` target. It patches only installed compiled instruction
generators and packaged task-skill sources. A fleet preflight proves every present file is regular and
non-symlinked and that every exact anchor matches before the first write. Every authenticated
`@claude-flow/cli` installation must expose its Claude generator. When its platform-skill generator is
present, that is covered too. Every nested or standalone authenticated `@claude-flow/codex` package must
expose its Codex generator and four core task skills; an optional performance skill is covered when
present. A legitimate standalone CLI cache is not rejected for lacking the separate Codex package. One
contract governs root output, the platform skill, and task skills:

- distinguishes `search_ruvnet` source truth from `guidance_brain`/live-registry runtime truth;
- selects structured MCP for MCP-capable runtime work;
- uses managed help then literal-argv run only for genuine Ruflo CLI gaps and selects
  `executable: "ruflo"` for both calls instead of guessing the absent legacy binary;
- reserves direct shell for bootstrap, first MCP registration/start, doctor, and deliberate daemon work;
- distinguishes native executors from Ruflo-tracked agents;
- replaces stale tool names/schemas and removes nonexistent commands;
- labels enterprise governance, compliance, SLA, retention, backup, and monitoring text as unconfigured
  scaffolding rather than implemented controls.

The target composes from one pristine per file, is atomic across the complete discovered generator set,
restores exact vendor bytes on uninstall, and is re-applied by the existing hook/monitor. Retirement must
execute every template on every present surface from marker-free upstream bytes, with at least one Claude
and one Codex surface proved across the host. Tool examples must exist in that build's live registry and
validate against its schemas; no source marker, version, issue state, missing-host assumption, or single
default template is sufficient.

Existing files use a separate text-only migration. It accepts only configured canonical Git roots;
requires `@AGENTS.md` as the first nonblank Claude line; replaces only exact known generated root blocks
and built-in skill revisions; preserves every other byte, line ending, and file mode; preflights before
any write; writes atomically; and refuses ambiguous or edited blocks. A skill-only mode repairs known
installer skills while preserving fully custom root instructions. It never invokes Ruflo, Brain, MCP,
Codex, Claude, or npm and never reads or mutates database/WAL/runtime state. Legacy/custom files without
an exact generated revision are reported, not rewritten automatically. Each reported project in the
deployed fleet received an explicit review; only shared precedence and demonstrably stale runtime
guidance changed, while repository-specific policy and deliberate package-surface tests were preserved.
For an allowlisted older full skill, the migration also removes its exact generated helper-script table:
those references point at the wrong location and lead back to raw npx. The dormant scripts are not
deleted or rewritten.

The existing single-source model remains authoritative: shared policy lives in `AGENTS.md`; `CLAUDE.md`
contains only Claude-specific syntax and native-agent behavior. The old Claude instruction to stop after
spawning is removed: the executor continues independent work and waits only on an actual dependency.

An MCP `policy-state-lock-timeout` is not permission to start the CLI fallback. It is a separate Ruflo
runtime failure tracked in [#3164](https://github.com/ruvnet/ruflo/issues/3164): ADR-324 appends every
authorization receipt to one pretty-printed state file and verifies, clones, and rewrites its unbounded
history under a five-second lock. The instruction patch reports that MCP failure and continues safely
from repository evidence; it does not mutate, truncate, or replace the provenance ledger.

## Implementation proof

- macOS: 60/60 installed sources are tracked: ten Claude generators, five platform-skill generators,
  eight Codex generators, and 37 packaged task skills. This includes direct standalone Codex packages.
- Hetzner Linux: 54/54 installed sources are tracked: seven Claude generators, six platform-skill
  generators, seven Codex generators, and 34 packaged task skills.
- Existing-file migration converged idempotently for 14 local and 11 Hetzner dual-host projects. It
  repaired 77 local and 45 Hetzner higher-priority task skills after the root files had converged; four
  additional local custom-root projects used the skill-only path.
- Contract v2 migrates the exact contract-v1 root, security-skill, and platform-skill revisions. The
  generated templates and all managed CLI examples select `ruflo`; mutation tests reject
  `executable: "claude-flow"`. A prior installed patch revision is rebuilt only from its proven pristine;
  the exact v1 platform transform also has a round-trip-proved recovery when its old backup is poisoned.
- A second exact-block migration reports zero changes on both fleets. No migration operation starts or
  stops a process or reads, repairs, checkpoints, replaces, deletes, or renames a database or sidecar.

## Consequences

### Positive

- Fresh root instructions, the platform skill, and task-specific skills no longer send routine
  MCP-capable work through another npx-resolved process or storage driver.
- Generated examples match current structured names and schemas, and absent interfaces are not invented.
- Native host execution and Ruflo tracking are described truthfully.
- Enterprise boilerplate cannot masquerade as deployed security, compliance, availability, or recovery.
- Existing project-specific policy survives exact-block migration byte for byte.

### Negative

- Current upstream headings and public generator returns are exact anchors; a generator refactor blocks
  the complete discovered generator set until the target is reviewed.
- Legacy/custom instruction or skill files cannot be migrated automatically without an attributable
  generated revision and require an explicit project review.

### Neutral

- The patch changes generated documentation, not Ruflo runtime, Brain, hooks, MCP registration, memory,
  updater state, or project authorization.
- Direct bootstrap and diagnostics remain available because they establish or inspect the MCP plane.

## Links

- [ADR-011](ADR-011-dual-codex-claude-single-source.md)
- [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md)
- [ADR-016](ADR-016-tests-are-behavioural-and-mutation-tested.md)
- [ADR-019](ADR-019-all-mode-adopts-new-targets.md)
- [ADR-020](ADR-020-plugin-targets-compose.md)
- [Ruflo #3153](https://github.com/ruvnet/ruflo/issues/3153)
- [Ruflo #3164](https://github.com/ruvnet/ruflo/issues/3164)
