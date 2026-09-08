# ADR-035: Dual-host receipts use the caller's MCP boundary

**Status**: Implemented

**Date**: 2026-09-08

**Authors**: ruflo-source-patch maintainers

**Related**: ADR-006, ADR-020, ADR-028, ADR-033

## Context

RuvNet Brain 4.3.11 requires hard architecture and security work to use its installed
`dual-host-deliberation.mjs` coordinator. That coordinator correctly runs independent Claude Code and
Codex subscription proposals, cross-critiques, synthesis, verification, and at most one revision.

After a successful verification, however, `persistDeliberationReceipt()` directly spawns
`ruflo memory store --path .swarm/memory.db`. The same Brain playbook tells callers to prefer the live
structured `memory_store` interface and to use the managed CLI bridge only for a genuine CLI-only gap.
Receipt storage is not such a gap. A child CLI may also become a second AgentDB driver while the MCP
server owns a live WAL or policy lock.

[Brain issue #272](https://github.com/stuinfla/ruvnet-brain/issues/272) records the reproduction and
upstream acceptance contract.

## Decision

Add the monitored `brain-dual-host-receipt` target. After Brain's native updater activates a generation,
the target patches only these two executable copies when present:

- the persistent Console-runtime source helper; and
- the deployed user-level model-router helper.

The patch removes `spawnSync` and converts the receipt into a stable request:

```json
{
  "tool": "memory_store",
  "arguments": {
    "namespace": "ruvnet-brain",
    "key": "dual-deliberation-…",
    "value": "{…}"
  }
}
```

An MCP-aware caller may inject a persistence callback. The helper reports `learningPersisted: true`
only when the callback returns `stored: true`, `verified: true`, and the exact requested key. Without a
callback, the completed duel includes `learningPersistenceRequest`, reports persistence false, and never
starts another Ruflo, npx, SQLite, or sql.js process.

The four edits are exact literal anchors and atomic per file. Missing or ambiguous anchors write nothing.
Pristine backups allow byte-exact uninstall and safe reapplication after a native Brain refresh.

## Consequences

- The full two-subscription deliberation remains available; agents need not hand-orchestrate a weaker
  substitute merely to avoid a direct CLI call.
- Receipt persistence uses the already-live structured owner and cannot create WAL contention from a
  second helper process.
- Learning status remains honest when the caller cannot persist or verify the receipt.
- The target does not read or modify AgentDB stores, sidecars, Brain versions, `active.json`, updater
  receipts, authentication, or model selection.

## Verification and retirement

The regression suite proves exact transformation and reversal, absence of Ruflo/`spawnSync`, request
schema, verified-key success, wrong-key refusal, completed-duel output, two-copy composition, CLI status,
and byte-exact restoration.

Retire the target only when a marker-free active upstream helper passes the same executable behavior,
including a locked/live-WAL mutation showing that no second memory process starts.
