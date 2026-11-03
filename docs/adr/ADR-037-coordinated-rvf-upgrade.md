# ADR-037: Coordinated RVF upgrade

**Status**: Accepted

**Date**: 2026-11-03

**Updated**: 2026-11-03. Owner authorizes controlled pauses of affected projects
for this upgrade. Production execution has not started.

**Deciders**: Henrik Pettersen

**Owner**: ruflo-source-patch root session

**Related**: ADR-006, ADR-028, ADR-032

## Context

The dependency audit covers 46 Mac and 71 HZ resolution rows. AgentDB 3.3.0
requests optional SDK `@ruvector/rvf ^0.2.3`; other consumers request `^0.1.0`
or `^0.3.4`. These ranges exclude SDK 0.4.1. Ruflo's nested override does not
replace a consumer-root dependency. This explains the older installations;
updating Ruflo alone does not upgrade every RVF consumer.

The tested candidate is SDK 0.4.1 with native package 0.3.1. Package version
sequences differ. Synthetic tests on both hosts show newer readers opening old
stores and old readers rejecting newer writes with `InvalidChecksum`.
[Upstream confirms the format break](https://github.com/ruvnet/RuVector/issues/1276#issuecomment-6478722717).
This is compatibility evidence, not proof of production data preservation.

ADR-006 and ADR-028 are Implemented. Their storage ownership, native backup
and managed-access boundaries remain in force. This ADR supplies the missing
upgrade programme without merging stores or inventing a replacement backend.

## Decision

Upgrade each connected group of consumers together. A group contains every
reader, writer, helper and restart mechanism that can access the same store.
Enable new writers only after all readers in that group use the qualified
generation and old clients can no longer reconnect with old loaded code.

Prepare and rehearse while projects remain active. Use a short, explicit
maintenance pause for each affected group during the final backup and switch.
Shared user-memory consumers may require a host-wide pause of their dependent
work. Unrelated projects continue. Mac and HZ are separate groups unless the
inventory establishes shared storage or a replication dependency.

The owner's pause authorization removes the earlier non-interruption constraint
in the retained audit. No second blanket approval is required for supported
pause, drain, checkpoint, memory-service replacement and resume operations.
Creating this plan does not itself pause or restart any project.

## Execution plan

### 1. Refresh the consumer inventory

- Reuse the existing inventory, dependency resolver, process inventory and
  compatibility smoke scripts under `.local/rvf-upgrade-20261103/`.
- Record actual executable, resolved SDK/native package, loaded generation,
  canonical store, owning service and dependent clients. Include global/npm/npx,
  project dependencies, hooks, source facades, schedules and the HZ AI-BA private
  migration runtime. Do not infer the active runtime from shell `npm root`.
- Follow known project roots and owner registrations; do not scan the filesystem
  root or personal folders. Refresh the audit for newly registered owners.
- Record current upstream versions and consumer ranges. Prefer an upstream
  compatible release over a forced override. Any required downstream dependency
  adjustment needs a proven consumer test and an upstream issue; never rewrite
  arbitrary installed dependencies merely to make version numbers match.

Completion evidence: a finite store-to-consumer map with no unclassified active
consumer for the group selected for upgrade. Dormant launch paths are included
if they can reopen those stores.

### 2. Prove preservation and compatibility

- Discover the current native backup/export/restore interfaces from their help
  and implementation. Reuse the existing native-only SQLite backup route, with
  a `sqlite-online-backup` receipt, for each ordinary and controller store.
- Establish separate coverage for RVF content, string-ID maps, metadata,
  deletions, vector indexes and any parent/child dependencies. A SQLite snapshot
  or JSON memory export alone does not prove this coverage.
- Test the precise packages used by the actual consumers on disposable stores
  on Mac and Linux. Cover string IDs, metadata/filter queries, reopen, deletion
  persistence, existing query expectations and consumer initialization.
- Rehearse native restoration on an isolated destination. Compare complete
  native inventories/content where supported, plus controller/graph and vector
  counts and the existing query acceptance cases. Sampling is not proof that
  every record was preserved; record any coverage gap explicitly.
- Use the real read-only interface for reader qualification. SDK `open()` is
  read-write; `openReadonly()` exists in the inspected candidate. Opening a file
  successfully is insufficient because native recovery can select an earlier
  complete manifest. Verify expected counts, identities and completeness.

Completion evidence: a restorable backup method covering the entire selected
store group and a qualified consumer/package combination. If native coverage is
missing, resolve that specific gap before pausing production. Do not invent a
raw-copy migration, delete sidecars or infer that COW derivation is a backup.

### 3. Pause the affected group

- Save an operation receipt in the existing private upgrade directory. Record
  projects, worker/session IDs, in-flight calls, checkpoint references, service
  PIDs, enabled timers, relaunch settings and the exact prior pause state.
- Use the owning programmes' supported pause/drain controls. Suspend submission,
  preparers, learning schedules and automatic relaunch for the affected group.
  Keep unrelated services and user consoles running.
- Let active calls and final lifecycle capture finish before freezing writes.
  Verify their terminal receipts; an idle console or a pause request alone is
  not a drain. A timeout with unknown write effects stays unresolved, not replayed.
- Drain diagnostic and repair writers too. If one dependency has no supported
  pause control, report that specific limitation rather than killing its process
  or silently continuing a mixed-version cutover.
- Record that the pause is for this maintenance. Preserve all checkpoints and
  unfinished goals. Do not mark them complete or override an earlier user pause.

No Herdr prompt injections, cross-project relay messages, terminal keystrokes,
blanket process kills or Codex app-server restart are part of this plan.
Use supported owner controls and private receipts. A missing control is not
permission to resume the previously prohibited console messaging.

### 4. Take the final backup and switch the group

- After all writers drain, take the verified native backup set and record its
  complete coverage and restore receipt. Retain the old package resolutions and
  configuration alongside it. No new-format writes occur before this point.
- Replace the group’s dependencies using the qualified upstream-compatible
  package combination. Commit scoped manifest/lockfile changes on main where
  appropriate. Reuse the existing patch installer and qualification checks.
- Retire old loaded consumers through their supported lifecycle and activate
  the replacement native memory owner through launchd/systemd. Refresh only
  affected MCP connections through the owning host's supported controls.
- Verify actual loaded versions and native exact reads through each consumer
  class. Updated files on disk or service health alone do not prove activation.
- Keep background delivery paused while proving the first new diagnostic
  write, exact readback, fresh-process reopen and expected retrieval behaviour.
  Use a new diagnostic key; never replay an uncertain historical operation.

Start with the smallest representative dependency group, then repeat for the
remaining groups. A shared store's readers and writers switch together; do not
use a rolling mixed-version deployment against that store.

### 5. Resume and close

- Restore only the timers, programmes and workers recorded as active before
  this maintenance. Preserve prior user pauses and completed goals.
- Reuse existing coordinators and pending work. Do not create duplicate agents,
  replay historical learning, restart retired queens or resubmit unknown calls.
- Observe a bounded window containing actual work and a scheduled cycle where
  applicable. Verify current captures, exact reads, session counts, memory/CPU
  use and absence of new format/binding errors for the upgraded group.
- Publish a per-group result with versions, backup references, query checks,
  active/restored timers and any remaining exception. Retain backups; this
  programme authorizes no backup or memory deletion.

Mark this ADR Implemented only after every in-scope active group is upgraded
and resumed or has an explicit owner-approved exception. A partial rollout is
reported as partial.

## Recovery boundary

Before any new-format write, package rollback is allowed only after proving the
store group remained unchanged, including SDK open/close side effects.

After a new-format write, downgrading packages alone is unsafe. Pause that group
again and preserve both generations. Prefer a forward repair. Any restore must
account for every accepted post-backup write through supported native interfaces;
never discard later data by replacing it with the earlier snapshot. An uncertain
write is reconciled through exact original-key/value readback, not blind replay.

## Scope boundaries

Keep upstream's two-store roles: ordinary memory and native controller storage
remain separate where configured; explicit source/user bindings retain authority.
Do not change filenames, database pins or vector paths as part of this upgrade.

Brain's native updater, generation selection, KB, caches and release plane remain
untouched. Brain-owned dependencies are not silently overridden. If one is an
affected consumer requiring a native Brain update, report the exact dependency
and use the already-required owner session lifecycle, not manual promotion.

The two Astra High investigations into policy-history performance and capture
capacity run independently. Their recommendations are not additional RVF release
gates unless they demonstrate a concrete preservation or compatibility failure
in the selected group. Temporary timeouts remain unchanged by this plan.

## Progress and evidence

| Step | State on 3 November | Evidence or remaining work |
|---|---|---|
| Dependency cause | Proven for audited rows | AgentDB and consumer ranges in retained audit |
| Format compatibility | Synthetic proof complete | Mac/HZ newer-reader and old-reader controls |
| Pause authority | Granted | Owner explicitly permits pausing other projects |
| Current loaded consumers | Refresh required | Audit predates later owner enrollment |
| Complete native backup/restore | Not qualified for this upgrade | Prove RVF/ID-map coverage and native restoration |
| Consumer integration qualification | Pending | Current smoke results are not full AgentDB integration |
| Production switch and resume | Not started | Execute per group after preparation |

Retained evidence: `.local/rvf-upgrade-20261103/audit-summary.json`,
`mac-resolutions.json`, `hz-resolutions.json`, `mac-compat-smoke.json`,
`hz-compat-smoke.json` and `receipt-sha256.json`. HZ copies live under
`/data/programme-state/rvf-upgrade-20261103/`. Preserve original receipts; append
new stage receipts rather than rewriting earlier permission or test results.

Brain grounding identified `ruvector/npm/packages/rvf/package.json` and
`ruvector/npm/packages/rvf/scripts/smoke-idmap-durability.mjs`. The latter documents
atomic ID-map persistence and refusal on corrupt load. Installed candidate
`dist/database.d.ts` distinguishes read-write/read-only access and exposes
derive/branch/freeze; those exports do not establish complete backup semantics.
Seraphina's guidance supports the sequencing and restore drill, but explicitly
does not supply verified native backup commands or live ownership evidence.

## Links

- [Storage ownership and native backup](ADR-006-memory-write-lock-and-wal-coherent-reads.md)
- [Managed-store boundary](ADR-028-managed-agentdb-interface-boundary.md)
- [Native I/O evidence](ADR-032-adr-graph-io-must-prove-reads-and-writes.md)
- [Repair register](../handover/2026-11-03-hook-database-issues.md)
- [Upstream RVF compatibility finding](https://github.com/ruvnet/RuVector/issues/1276#issuecomment-6478722717)
