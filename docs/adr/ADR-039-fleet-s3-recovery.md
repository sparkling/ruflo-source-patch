# ADR-039: Fleet S3 recovery

**Status**: Proposed
**Date**: 2026-11-05
**Decider**: Henrik Pettersen
**Scope**: Every enrolled host and its global, user and project state
**Related**: [ADR-006](ADR-006-memory-write-lock-and-wal-coherent-reads.md), [ADR-028](ADR-028-managed-agentdb-interface-boundary.md), [ADR-037](ADR-037-coordinated-rvf-upgrade.md)

## Context

The 5 November learning incident demonstrates that persistent learning can be
damaged independently of SQLite. No pre-incident backup of the affected neural/EWC
state has been established; this proposal cannot recover that missing baseline.
Changing HOME/CWD inside a repository did not isolate a diagnostic from the live
root resolver.

An existing S3 archive supported the October HZ migration: historical receipts
record 37,495 files / 351.37 GiB verified, including 503 generated RVF retrieval
indexes. Managed memory and neural directories were excluded. This is a reusable
delivery implementation and a retained recovery dependency, not current fleet
protection or a baseline for the affected laptop learning state.

The discovery in the [inventory](../plans/fleet-s3-inventory-20261105.md)
covers metadata on Mac, HZ and hm-ec2, plus configured but unresolved hosts.
It does not establish a complete fleet register. Mac and HZ contain separate
user-pattern and Brain global-learning stores, many project stores and dormant
state outside the currently registered owner set.

Native Ruflo backup currently covers selected SQLite stores. It does not prove
capture of neural JSON, EWC, SONA, LoRA, RVF companions, policy journals or host
session histories. A successful file upload is not proof of recoverability.

## Decision

Adopt an owner-consistent, versioned backup service with S3 as the off-host
destination. Capture immutable local recovery artifacts using each store owner's
supported interface, then upload and independently verify them. Never synchronize
live database files into S3. Never implement a replacement RuVector algorithm.

Use a finite fleet register and an inherited policy:
global defaults, host/user overrides and explicit project exceptions. Each
physical store has a stable identity and one capture owner; aliases refer to it.
Every expected store receives a success, failure, unavailable or approved-exclusion
receipt. A newly discovered unclassified state root makes coverage incomplete.

The existing migration archive is in **eu-north-1 (Stockholm)**. Requalify its
ownership and recovery dependencies before choosing a destination; **eu-west-2
(London)** remains a provisional cost comparison, not a migration decision.
Use a dedicated backup security boundary, preferably a
separate AWS account, with private versioned buckets, TLS and encryption.
Use customer-managed SSE-KMS with S3 Bucket Keys where key-recovery and IAM
requirements justify it; isolate sensitive credential recovery material using
an independently recoverable encrypted secret archive. Reuse the migration
uploader's whole-file hash deduplication, checksums, version receipts and bounded
transfer machinery, plus the existing Artalk packaging/scheduling pattern.
Neither implementation establishes the final fleet capture/security contract.
Preserve existing archive versions and manifests: their source payloads were
subsequently deleted under separate historical owner authorization. No new
lifecycle policy may silently expire that recovery dependency.

Use unique generation keys, SHA-256 content identities and exact S3 version IDs.
A complete manifest is written last and names every artifact, capture boundary,
dependency, source owner, schema/package version, encryption/key identifier and
restore procedure. A separate verifier records remote readback and restore
results. Capture, upload and restore-tested states remain distinct.

Use Object Lock with seven-day fixed retention for frequent recovery artifacts
and 35-day retention for daily recovery points. Governance bypass is absent
from producer and routine operator roles. A separately controlled break-glass
role is audited; compliance mode is an optional stronger owner decision.
Long-retention archive sets receive their own retention. Versioning alone is
insufficient protection against a privileged version deletion.

The producer can write only its host prefix and perform necessary multipart
operations; it cannot delete versions, weaken retention, change lifecycle or
administer KMS. The independent verifier reads specific versions and decrypts.
A separate retention owner deletes only expired, unreferenced objects. Reused
packs must remain locked through the latest referring manifest's retention:
a narrowly scoped controller extends retention and verifies it, or creates a
separately locked recovery copy. Producer success alone cannot prove that lock
closure. Account
administrators and KMS destruction remain threats requiring separation and
alerts. Do not store the only recovery key inside the backup it decrypts.

## Capture contract

| State | Required method |
| --- | --- |
| Managed SQLite | Supported native online backup for each explicit canonical store; require successful per-store receipt and verify destination integrity through supported tooling |
| RVF and RuVector | Native capture/export with complete ID, metadata, graph, deletion, manifest and parent dependencies; qualify exact installed consumer and format |
| Neural JSON, EWC and LoRA | Owner flush/barrier or supported generation snapshot covering the complete related set; in-memory learned state is an explicit gap until export is proved |
| Append-only sessions and receipts | Owner-sealed segment or bounded committed prefix, including indexes, final complete record and chaining metadata |
| Configuration and originals | Version-controlled source plus encrypted protection for uncommitted/private originals and nonreproducible configuration |

The installed SQLite receipt spells its method `native-online-backup`.
ADR-037's earlier `sqlite-online-backup` wording must not become a guessed
acceptance string. Qualify the actual installed contract. Encrypted-image
fallback, absent databases and mixed-method results never count as native
capture success. Cross-store snapshots require a shared barrier or a documented
application-level recovery cut; sequential online backups are individually
consistent, not automatically a coherent group.

The local RVF adapter's `save(_path)` ignores the destination and flushes/compacts;
it is not a backup API. The SDK persists string ID maps separately and can
swallow persistence failures. Do not infer that a single RVF file or COW child
is independent or complete. Reuse RuVector's existing edge-snapshot capability
where qualified; local owner integration and format compatibility remain open.

## Recovery objectives

| Class | Proposed capture target | Retention | Initial restore target |
| --- | --- | --- | --- |
| Critical user/project memory and learning | 15 minutes while host is online, only after native consistency qualification | All complete generations 7 days; daily 35 days | One selected group within 4 hours |
| Active session continuity and configuration | Hourly sealed capture; pre-mutation capture | Hourly 7 days; daily 35 days | Within 4 hours |
| Dormant projects and private research originals | Daily or on change | Daily 35 days; weekly 12 weeks | Within 24 hours |
| Independent archive sets | Monthly | At least 13 sets, at least 400 days; budget for 14 during overlap | Within 72 hours, including archive retrieval |

These are proposed targets, not achieved guarantees. RPO is measured from the
last accepted owner capture included in a remotely verified complete generation.
Offline laptop periods accumulate recovery exposure; catch-up does not erase it.
A blocked native capture keeps that store explicitly unprotected.

## Cost policy

Compress sealed artifacts, reuse unchanged artifact hashes and pack small files
by owner/generation. Preserve independently restorable monthly archive sets.
Initially keep hot recovery data in S3 Standard. Do not send short-lived
generations to IA or Glacier or put entire mutable journals into every generation.

Use an existing qualified backup engine for block deduplication if measured full
snapshot churn breaches the budget. Prefer native RuVector chunk/snapshot
interfaces for RuVector data. Do not build a custom chunking, compaction or delta
algorithm. An unqualified deduplication path cannot justify a low cost forecast.

Keep catalogs and restore manifests hot. Archive only closed, self-contained
sets with no dependencies from a hot restore point. Expiration must respect the
maximum retention of all referring manifests; an age-only lifecycle over shared
chunks would destroy later backups. Object Lock may postpone reclamation after
logical retention expires; the forecast must include those bytes.

No default cross-region copy: a separate account and multi-AZ S3 already address
different failure modes. Add a second region only for an explicit regional-outage
RTO or residency requirement and price its storage, replication requests,
transfer and key recovery.

## Execution and acceptance

Follow the [implementation and restore plan](../plans/fleet-s3-plan-20261105.md).
Acceptance requires a complete enrolled-host coverage ledger, measured costs,
staleness alerts and independent restoration on a disposable host with no
production mounts, routes, credentials or owner endpoints. No restore test runs
under a live checkout. Restored hooks, timers, outboxes and policy receipts remain
inactive until explicitly reconciled; restoration must not replay authority.

Before a migration, upgrade, repair, bulk training or destructive maintenance,
capture and verify a complete pre-mutation recovery set and prove its restore
procedure. This complements ADR-037; it does not authorize an RVF upgrade or
repair incident data.

## Consultation

Brain searches located native SQLite/learning distinctions and RuVector's
edge-snapshot manifest/export implementation. Installed source was inspected
without imports. Hosted Seraphina advised owner captures, generation barriers,
manifest-last publication, separate verifier and isolated drills. Its response
reported `anthropic/claude-sonnet-5.5`, `cognitum-auto`, a shared budget with
199 calls remaining and an empty roster/claims/message context. This was design
advice, not fleet observation or native capability certification.

Local BA, SA, EA research and Product searches completed. SA's historical Artalk
record led to an existing hourly S3 backup implementation and restore tests;
it does not prove its present live schedule. Exact source and consultation
coverage are recorded in the inventory.

## Alternatives and consequences

Blind file sync, live DB/WAL copies, SQLite-only coverage and versioning without
deletion protection are rejected. They cannot establish the required recovery
boundary. A single full archive every 15 minutes is simple but can amplify
storage and upload costs severely; the plan measures that baseline before
promising deduplication savings.

The service adds capture coordination, key custody, restore testing and retention
ownership. Those responsibilities are necessary for a useful backup. This ADR
remains Proposed until accepted. This change creates documents only: no S3
resources, IAM changes, uploads, scheduler deployment, live capture or restoration.
