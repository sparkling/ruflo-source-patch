# ADR-033: Generated Ruflo instructions use the live structured interface

**Status**: Implemented
**Date**: 2026-09-01
**Deciders**: Henrik Pettersen
**Tags**: ruflo, init, instructions, mcp, codex, claude-code, migration

## Context

Ruflo 3.38.20's six Claude instruction templates and four Codex templates describe Ruflo MCP as the
coordination plane, then direct routine swarm, memory, hook, worker, benchmark, workflow, session, and
status operations through raw `npx @claude-flow/cli...` commands. Several examples name tools or flags
that the same release does not expose. The generated files also conflate source-grounded product claims
with local runtime discovery and describe native host agents as Ruflo-coordinated before Ruflo records
exist.

The active RuvNet Brain contract requires structured Ruflo MCP first. A real CLI-only gap goes through
the managed help/run bridge with literal argv when available; direct shell remains valid for bootstrap,
diagnostics, and explicitly chosen process administration. Upstream issue
[#3153](https://github.com/ruvnet/ruflo/issues/3153) records the source locations, reproduction, proposed
shared renderer, and all-template acceptance criteria. Open issue
[#2638](https://github.com/ruvnet/ruflo/issues/2638) separately tracks Claude/Codex source divergence.

Existing project files are user-owned. This fleet contains project-specific instruction blocks, so
re-running init or rendering a complete template would erase valid policy. Runtime databases, hooks,
settings, registries, caches, and processes are outside an instruction migration.

## Decision

Add the issue-backed `ruflo-instruction-contract` target. It patches only installed compiled instruction
generators. A fleet preflight proves every present file is regular and non-symlinked and that every exact
anchor matches before the first write. Every authenticated `@claude-flow/cli` installation must expose
its Claude generator. When an authenticated `@claude-flow/codex` adapter is present, its Codex generator
is required too; a legitimate standalone CLI cache is not rejected for lacking that separate package.
One generated-output transformer:

- distinguishes `search_ruvnet` source truth from `guidance_brain`/live-registry runtime truth;
- selects structured MCP for MCP-capable runtime work;
- uses managed help then literal-argv run only for genuine CLI gaps;
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

Existing files use a separate text-only migration. It accepts only configured canonical Git roots and
root `AGENTS.md`/`CLAUDE.md`; requires `@AGENTS.md` as the first nonblank Claude line; replaces only exact
known generated blocks; preserves every other byte, line ending, and file mode; preflights before any
write; writes atomically; and refuses ambiguous or edited blocks. It never invokes Ruflo, Brain, MCP,
Codex, Claude, or npm and never reads or mutates database/WAL/runtime state. Legacy/custom-only projects
without a proven generated block are reported, not rewritten automatically. Each reported project in the
deployed fleet received an explicit review; only the shared precedence contract and demonstrably stale
runtime guidance were changed, while repository-specific policy and deliberate package-surface tests were
preserved.

The existing single-source model remains authoritative: shared policy lives in `AGENTS.md`; `CLAUDE.md`
contains only Claude-specific syntax and native-agent behavior. The old Claude instruction to stop after
spawning is removed: the executor continues independent work and waits only on an actual dependency.

## Implementation proof

- macOS: 15/15 installed generator files are tracked across ten authenticated CLI bundles. Ten Claude
  surfaces rendered six templates each and five Codex surfaces rendered four templates each: 80/80
  generated outputs passed the contract.
- Hetzner Linux: 13/13 installed generator files are tracked across seven authenticated CLI bundles.
  Seven Claude surfaces and six Codex surfaces rendered 66/66 passing outputs.
- Existing-file migration converged idempotently for 14 local and 11 Hetzner dual-host projects. Six
  local and one Hetzner custom/legacy projects were reviewed rather than blanket-rewritten. Both hosts'
  user-level instruction files use their native user-memory path and MCP-first fallback policy.
- A second exact-block migration reports zero changes on both fleets. No migration operation starts or
  stops a process or reads, repairs, checkpoints, replaces, deletes, or renames a database or sidecar.

## Consequences

### Positive

- Fresh instructions no longer send routine MCP-capable work through another npx-resolved process or
  storage driver.
- Generated examples match current structured names and schemas, and absent interfaces are not invented.
- Native host execution and Ruflo tracking are described truthfully.
- Enterprise boilerplate cannot masquerade as deployed security, compliance, availability, or recovery.
- Existing project-specific policy survives exact-block migration byte for byte.

### Negative

- Current upstream headings and public generator returns are exact anchors; a generator refactor blocks
  the complete discovered generator set until the target is reviewed.
- Legacy/custom instruction files cannot be migrated automatically without an attributable generated
  block and require an explicit project review.

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
