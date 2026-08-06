# ADR-028: Managed AgentDB stores refuse raw SQLite and expose one audited diagnostic

**Status**: Implemented
**Date**: 2026-08-03
**Updated**: 2026-08-06. #102 is fixed on `main` at `12c29c1`, and #103 is closed with the opt-in
`managedMemoryBoundary` setting at `af373f0`; neither change is in active Brain 4.0.12. The maintainer's
final #103 measurement explicitly says host non-execution is asserted but unproved. The default remains
`advise`, and the finite audited diagnostic plus truthful doctor/Console state did not land. The patch now
accepts the forthcoming native detector shape, preserves it, and adds only the still-missing default
refusal and diagnostic boundary.
**Deciders**: Henrik Pettersen
**Tags**: brain, agentdb, hooks, mcp, enforcement, patch-target

## Context

Brain #48 correctly moved ordinary AgentDB work toward structured Ruflo CLI/MCP interfaces. Brain
4.0.12's shipped raw-command advisory still contains two separate residual problems:

- its flat Category 4 payload matcher misses valid `sqlite3` invocations when flags precede the database
  and fires on prose, searches, comments, and other non-executable text (#102); and
- direct `sqlite3` access to managed `.swarm/memory.db` and user-memory stores remains possible, while
  switching Brain retrieval off also silences the whole advisory (#103).

The earlier project rule against modifying Brain versions was written after manual version pinning left
the KB stale. Its intended boundary is the native updater and KB plane, not exact issue-backed source
patches to the executable generation that `active.json` has already selected.

## Decision

Add the `brain-managed-memory-boundary` target, backed by
[stuinfla/ruvnet-brain#102](https://github.com/stuinfla/ruvnet-brain/issues/102) and
[stuinfla/ruvnet-brain#103](https://github.com/stuinfla/ruvnet-brain/issues/103).

- Reuse Brain's existing `commandOf()` / `findInvocations()` structural parser. Remove only the flat
  Category 4 payload regex. Leave native Categories 1, 2, and 3 unchanged.
- Parse the actual `sqlite3` executable and its documented flag arities before classifying the database
  operand. Unknown/dynamic operands do not become guessed denials.
- Deny only exact managed stores: `~/.claude-flow/user-memory.db` and `.swarm/memory.db`. Enforcement
  remains active when optional Brain retrieval and advisory guidance are off.
- Emit each host's native PreToolUse deny envelope. An unconditional allow remains empty stdout.
- Add the MCP-only `agentdb_diagnostic_read` escape hatch. It accepts a canonical managed path plus an
  exact namespace/key and a reason, generates fixed read-only SQL itself, returns only a row count, and
  never accepts SQL or returns memory content.
- Open a checkpointed WAL-mode image through SQLite's read-only immutable URI only when no WAL/SHM
  sidecars exist. Refuse live sidecars without opening or deleting them, then compare file identity,
  ctime, mtime, and size before and after the query.
- Record private content-free audit receipts before refusal and around diagnostics. Hash paths and reasons;
  preserve and compare DB/WAL/SHM metadata around the read.
- Preflight and apply the active native generation, matching Claude/Codex copies, and persistent MCP shell
  as one transaction. A later native generation flip is authoritative and is rediscovered on re-apply.

The patch may change only exact executable hook/MCP bytes after native activation. It never downloads,
selects, promotes, pins, or relabels a Brain generation and never modifies `active.json`, updater receipts,
KB/cache/model data, or the updater itself.

## Verification

The regression suite exercises the real current Brain parser, positive flag/nesting/substitution cases,
negative prose/search/heredoc/comment cases, both host envelopes, a sentinel that proves denial prevents
execution, Brain-off enforcement, non-Bash silence, exact SQLite flag parsing, canonical store identity,
checkpointed WAL-mode diagnostics, live-sidecar refusal, content-free private receipts, SQL-literal injection, atomic
anchor refusal, rollback, idempotency, exact uninstall, and a native `active.json` generation flip. A
second fixture uses the unreleased #102/#103 source shape to prove the upstream structural detector remains
in place while the local boundary adds its missing default enforcement and diagnostic behavior.

## Limits

This is an executable-boundary guard, not an operating-system sandbox. It identifies direct `sqlite3`
invocations visible to Brain's structural parser; it cannot prove that arbitrary interpreters, aliases, or
opaque binaries do not open SQLite internally. Upstream should still own a native managed-store policy,
doctor/Console reporting, telemetry, and packaged host contract tests.

## Retirement

Do not guess a version predicate. Retire only after one published active candidate passes the same direct
denial and negative matrix in Claude and Codex, proves the proposed command does not execute, keeps
enforcement active with retrieval off, exposes the audited structured diagnostic without content leakage
or mutation, reports truthful doctor/Console state, and survives a native generation flip. #102/#103 issue
closure and source-only code are insufficient under ADR-014.

## Links

- Upstream: [#102](https://github.com/stuinfla/ruvnet-brain/issues/102), [#103](https://github.com/stuinfla/ruvnet-brain/issues/103)
- Follow-up boundary: [#48](https://github.com/stuinfla/ruvnet-brain/issues/48#issuecomment-5169487947)
- [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md)
- [ADR-016](ADR-016-tests-are-behavioural-and-mutation-tested.md)
- [ADR-020](ADR-020-plugin-targets-compose.md)
- `lib/brain-managed-memory-boundary/`
- `test/brain-managed-memory-boundary.mjs`
