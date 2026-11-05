# Fleet S3 implementation and restore plan

**Status**: Proposed, 2026-11-05
**Decision**: [ADR-039](../adr/ADR-039-fleet-s3-recovery.md)
**Evidence and costing**: [Inventory](fleet-s3-inventory-20261105.md)

## Responsibilities

Henrik accepts retention, recovery objectives, backup account/region and any
stronger compliance retention. A fleet recovery owner maintains enrollment,
coverage and restore readiness. Each native store owner supplies capture,
flush/pause semantics and restore validation. A separate verifier controls
restore credentials. A retention owner controls pruning; producers cannot.

Use the existing project on main. This plan does not create another service
until the reuse review identifies its existing operational owner. Reuse
the existing HZ migration uploader's whole-file hash reuse and checksum/version
receipts, launchd/systemd, native capture interfaces, the SA Artalk packaging
pattern, existing monitoring and native RuVector snapshot facilities.
Do not reuse Artalk's direct SQLite code for managed Ruflo stores.

## Phase 1: Complete enrollment

1. Reconcile SSH aliases, native memory owners, source roots, cloud account
   inventories, scheduler registrations and container mounts into one host list.
   Deduplicate aliases using verified host identity, never a matching hostname
   alone. Resolve the named gaps in the inventory without bypassing SSH identity
   checks or initiating an unrequested login.
2. Inspect every enrolled host's users, global services, project roots, external
   mounts, containers, volumes and explicit path overrides through metadata and
   supported owner APIs. Current discovery depth four is a starting point,
   not an exclusion rule. Identify subdirectory sprawl and dormant copies without
   deleting or merging them.
3. Record canonical realpath, device/inode, scope, registered owner, actual
   writer/service, relaunchers, byte count, store type, dependency group, sensitivity,
   capture method, restore method and freshness target. Registered ownership
   is not proof that every current writer is known.
4. Mark each candidate authoritative, shared alias, recovery-only historical
   copy, reproducible cache, transient process artifact or unresolved. Rebuildable
   status requires a reproducibility proof and an RTO measurement. Preserve
   unknown nonempty state until classified.
5. Enroll the two global stores independently: user-pattern memory and Brain
   global-learning memory. Preserve Mac research populations separately from
   canonical HZ research. EA operational stores receive metadata inventory only;
   their owner must supply any later capture.
6. Track inaccessible host, missing path, unsupported backend and denied scope
   as different outcomes. Reconcile observed candidate roots to approved
   exclusions; a count of zero from a narrow scan never proves absence.
7. Enroll the existing Stockholm migration archive and its exact-version
   manifests separately from current source stores. Reconcile historical RVF
   payloads with corpus/ID metadata retained outside that selected set. Source
   deletion makes archive custody a recovery dependency. Later authorized
   read-only cloud qualification must establish present versions, bytes, costs,
   ownership and protection before choosing reuse, extension or a new boundary.

Exit evidence: signed-off host register, store-to-owner map, all known gaps
assigned, and a finite first pilot group. Fleet-wide completion waits for every
host or a specific owner-approved exclusion. The existing proposal remains
useful while coverage is incomplete.

## Phase 2: Qualify capture

Discover live schemas/help again for the exact installed owner generation.
No imported diagnostic module may initialize learning on a source host.

| Type | Qualification and failure tests |
| --- | --- |
| SQLite | Invoke native backup with explicit source, unique destination and native-only requirement; verify the actual per-store method, expected source identity, nonzero destination and full schema/data coverage |
| Encrypted or unsupported SQLite | Require an owner-supported consistent encrypted capture and key recovery; native-only refusal is a gap, not permission for image copying |
| RVF | Verify independent restore including every segment type, string IDs, mappings, metadata/filter behavior, tombstones, graph/witness data, dimensions and parent lineage |
| Neural JSON/EWC | Establish all writers, flush acknowledgments and a stable generation barrier; prove incomplete/truncated writes and stale in-memory banks cannot yield a complete manifest |
| LoRA/SONA | Verify checkpoints actually persist the required weights, optimizer/adaptation state, Fisher information, configuration and trajectory boundaries; separately report volatile state |
| Journals and sessions | Use closed/rotated segments or a documented committed-prefix read; store segment order, byte boundary, last complete record and chain/index identities |
| Config/originals | Preserve permissions, symlink identity and mapping, tracked revision plus dirty/private originals; separate secret material and its recovery authority |

Native Ruflo backup currently rotates destination snapshots by basename and
timestamp. Use a separate staging directory per canonical store/group to prevent
same-basename collisions across projects. Keep staging rotation independent of
S3 retention and never let a failed upload delete the sole verified local copy.

The installed adapter returns `native-online-backup`; an aggregate success can
exclude absent stores. Compare the expected inventory to every per-store result,
so `no-db` cannot silently omit a required store. No GCS offsite result is
treated as S3 delivery. The existing GCS path is best-effort and is not reused
as an assurance signal.

SQLite online backup can coexist with WAL writers; it does not require a manual
checkpoint. Cross-file consistency is separate. Prefer a native shared generation
or snapshot barrier. Otherwise the store owner must supply a supported bounded
pause/drain/flush/resume procedure for the connected group. This proposal
authorizes no pause, process kill, checkpoint, sidecar cleanup or runtime change.

For RuVector, assess the existing edge-snapshot manifest, streamed RVF export,
import and restore validation before designing anything new. It uses a specific
row schema and runtime format; prove whether it covers the local native RVF
segments and existing AgentDB sidecar contract. It is not automatically a
drop-in whole-store backup. If coverage is missing, request that precise upstream
capability or a thin supported binding; do not reconstruct the algorithm.

Exit evidence: each member of the pilot group has a complete reproducible capture
and restore contract. Unsupported members remain failed/unprotected. No synthetic
capture or restore runs under a production source tree.

## Phase 3: Prove a local recovery set

Use a disposable VM or separate host whose filesystem has no production source
mounts. Empty HOME/CWD alone is insufficient. Remove production network routes,
credential mounts, MCP registrations, scheduled hooks and automatic learning
before importing executable code. Resolve all effective paths first and verify
they stay within the disposable boundary.

Generate synthetic data only there. Test concurrent native writes, partial
capture, process failure, disk full, non-atomic JSON, wrong store resolution,
missing companion files, format mismatch and truncated journals. Assert that
each failure prevents a complete generation receipt.

Then restore a legitimately captured pilot dataset there, with no production
write credentials. Use a new destination identity and inactive schedules.
The restore must succeed after removal of the original capture source and
without access to the original RVF parent paths.

Exit evidence: independently restorable local set, manifest dependency closure,
source unchanged by verification, and measured capture/restore time and resources.

## Phase 4: Qualify reused S3 delivery and recovery controls

Adapt the existing migration uploader only after native artifacts are sealed.
Its changing-file checks are not native capture barriers. Its original identity
both uploaded and verified; split those privileges and qualify resume reconciliation
against exact remote versions. Preserve its explicit denial/error handling and
checksums while adding manifest dependency closure and retention verification.
Do not rerun the historical candidate/deletion workflow as a fleet backup job.

1. Use infrastructure as code in the existing infrastructure owner. Configure
   private access, TLS, versioning, encryption, bounded Object Lock retention,
   least-privilege producer/verifier/retention roles and failure alarms.
2. Package only sealed artifacts. Stream compression with bounded memory and
   concurrency. Do not recompress already compressed media/checkpoints without
   measuring a benefit. Aggregate small files into moderate packs; begin with
   a 16-64 MiB pack target and measure network, restore amplification and memory.
3. Upload immutable artifacts, preserving checksum and VersionId. A retry uses
   the same logical generation and asks the verifier/controller to reconcile
   unknown outcomes through exact-version HEAD/GetObjectAttributes. A producer's
   denied HEAD is never interpreted as absence. Avoid silent replacement or
   duplicate generations.
4. The verifier checks expected objects, version IDs, size/checksum, encryption
   and retention. ETags are not a universal file checksum. Publish a complete
   manifest only when every dependency is accounted for; remote verification
   and restore-test receipts have separate statuses.
5. Store the manifest, restore catalog and dependency map in hot storage with
   redundant recoverable access. An independent verifier attests success so a
   compromised producer cannot claim an upload was tested.
6. Keep recent local verified recovery sets on encrypted storage with a quota.
   Offline upload queues preserve order and report increasing RPO. Disk pressure
   fails visibly; it does not delete the sole good copy or skip a store.
7. Test denied producer reads/deletes and retention changes; test verifier read
   access, KMS recovery, missing-key alarms and audit delivery. Restore roles
   cannot activate production workloads or bypass governance retention.
8. Abort incomplete multipart uploads after seven days. Configure explicit
   noncurrent-version expiration and delete-marker cleanup. Never rely on
   current-version expiration alone in a versioned bucket. Apply these rules
   only to the newly qualified policy scope; the existing migration archive had
   no expiry. Preserve it until dependencies and owner-approved retention are
   established, including payloads no longer present locally.

Exit evidence: actual remote readback by another identity, successful isolated
S3 restore, denied destructive producer operations and demonstrated stale-backup
alerts. A local backup or an uploaded archive alone does not complete this phase.

## Phase 5: Control costs and roll out

Measure seven representative days: captured bytes, compressed bytes, new unique
artifact bytes, PUT/GET/LIST/KMS counts, upload duration, changed blocks and
source overhead. Do not infer change rate from file size or mtime.

Start one small group, then one representative large group per host/OS/backend.
Sequence shared user-memory groups by their consumer dependencies. Add one
store family at a time, preserving existing backups and pause state.

Reuse the migration uploader's exact artifact hash approach first. Its historical
19,917 reused file paths do not predict savings for changing databases.
For high-churn large snapshots, qualify an
existing deduplicating backup engine against immutable storage, encryption,
retention and full restore requirements. Assess native RuVector snapshot chunks
first for that workload. Selection of a library or algorithm is deferred until
these capabilities are verified; custom CDC is not part of this plan.

Keep at least seven days of full frequent-history coverage. For later points,
retain daily 35 days and weekly 12 weeks. To minimize full-copy expense, pack
only new immutable artifacts and reference unchanged ones. The independent
retention job calculates transitive reachability from all retained manifests.
It may delete only unreferenced versions whose lock and class minimum durations
have elapsed. Before admitting a manifest that reuses a pack, a narrowly scoped
controller extends and verifies that pack's retain-until date through the last
referring manifest's retention, or creates a separately locked recovery copy.
That controller cannot shorten locks or bypass retention. Producer receipts do
not prove lock closure. S3 age lifecycle rules alone cannot perform this calculation.

For monthly archives, assemble a closed independent set, verify it, retain its
manifest hot, then transition eligible packs to Deep Archive at day seven and
expire at day 400 or later. Maintain at least 13 monthly sets and budget for 14
during overlap; do not make recent points
depend on archived packs. Evaluate Glacier Flexible Retrieval instead when
72-hour historical RTO is unacceptable. Skip IA transitions for short-lived data.
Unknown access patterns may justify Intelligent-Tiering; predictable backup
retention usually does not need its per-object monitoring.

Set a provisional alert at $50/month and review threshold at $100/month for this
backup programme, excluding exceptional full-fleet disaster recovery. These are
proposal controls, not observed spend or purchase authority. Alert at 50%, 80%
and 100% of the approved budget; do not stop protection automatically. Change
retention/cadence only after the recovery owner accepts the effect.

## Phase 6: Restore drills

A daily automated verifier checks receipt completeness, dependency closure and
checksums using bounded readback. Every week restore one rotating store group;
every month cover each host/backend/scope and one archived monthly set. Every
quarter simulate loss of a host and its credentials. Tests remain isolated.

A complete drill checks:

- Exact source/restore identities, all native records and historical versions,
  embeddings, schema objects and sequences where the owner interface supports
  them. Counts and sampled queries alone cannot establish losslessness.
- Controller patterns, skills, episodes, hierarchy including archived/expired
  history and graph links; separate ordinary and controller stores.
- RVF external string IDs, metadata filters, vector/graph/index consistency,
  deletion persistence, lineage independence and fresh-process reopen.
- Pattern/stat/EWC and checkpoint compatibility; no initialization or training
  against production, and no replay of synthetic or historical learning.
- Transcript segment hashes, complete final records and resume pointers;
  pending outbox work remains pending and is reconciled before delivery.
- Configuration/path remapping, permissions and secret/key recovery; no
  production endpoints become reachable during the test.
- Measured RPO, restore elapsed time, downloaded bytes and cost. Archive retrieval
  delay and network transfer are included in RTO.
- Tampered/missing files, expired keys, old incompatible packages, denied IAM,
  interrupted restore and producer compromise. Failure stays explicit.

Where native enumeration omits types or truncates values, record the proof gap.
Do not use raw SQL against managed sources. A stronger destination-only validator
needs an explicitly permitted owner interface or separately approved diagnostic
exception; do not smuggle it into a backup script.

After verification, destroy only the disposable test environment through its
normal owner process. Production activation is a separate controlled recovery:
reconcile accepted writes since the selected point, preserve damaged/latest
state for evidence, fence old writers and enable only the originally intended
services. Never overwrite a live store as an automated drill.

## Reporting

Each host reports last attempted capture, last complete native capture, last
verified off-host generation and last passing restore independently. Report
missed RPO, inaccessible hosts, unsupported stores, corruption, checksum mismatch,
KMS refusal and excessive cost. Monitor from outside the source host.

Finish rollout only when every enrolled store meets its contract or has an
explicit accepted exception. Maintain the coverage ledger as projects, users,
packages and servers change. Review the first restore and monthly bill before
calling the system live.
