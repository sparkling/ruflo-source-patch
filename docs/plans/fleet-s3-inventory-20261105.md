# Fleet recovery inventory and cost evidence

**Status**: Observed inventory and proposed cost model, 2026-11-05
**Decision**: [ADR-039](../adr/ADR-039-fleet-s3-recovery.md)
**Execution**: [Implementation plan](fleet-s3-plan-20261105.md)

## Coverage

The metadata pass used directory entries and lstat only. It did not open
managed SQLite/RVF contents, hash live databases, copy WAL files, import runtime
modules, train models or initiate backup/restore. Native research searches may
update their own access metadata. Byte sizes below are logical file lengths,
not compressed backup sizes, allocated disk usage or accepted source authority.

| Host or service | Observed coverage | Limit |
| --- | --- | --- |
| Mac | 259 candidate roots; 47,176 distinct regular-file identities; 56.638 GiB | Includes dormant/test roots, historical worktrees, journals, logs and backups |
| HZ | 1,140 candidate roots; 322,575 distinct regular-file identities; 128.735 GiB | Same qualification; root count is not a count of live projects |
| hm-ec2 | Eight files, 2,139,242 bytes in the selected user/global trees; no project roots discovered in selected bases | Graph/database installations under /opt observed but not inventoried internally; no evidence of zero application data |
| hm | SSH timed out | No current inventory |
| ai | SSH host identity changed; strict verification refused connection | No bypass or host-key change |
| hz-public | SSH timed out | Candidate alias of HZ; identity equivalence not proven |
| builder, plm, fabric, oxigraph, query | SSH timed out from Mac and from HZ | May be distinct hosts, aliases or inactive environments; unresolved |
| orb | SSH returned exit 1 without identity/output | No current inventory |
| railway-artalk | Agent path temporarily unavailable | No current inventory; historical migration status does not prove deletion |
| sa-artalk Lightsail | Historical SA native record describes live London service and hourly S3 backup | Current AWS enumeration blocked by expired SSO token; no live qualification |
| HZ Docker workloads | Running PostgreSQL/Kafka/product-design and buildkit containers observed | Volume/application ownership and native capture remain to be inventoried |

Cloud account/region enumeration is incomplete. Read-only EC2 and Lightsail
enumeration through the configured profile returned: **Token has expired and
refresh failed**. No login was attempted. Other AWS profiles/accounts/regions,
other users, arbitrary mounts, managed cloud databases and unregistered hosts
remain unknown. The HZ LXC client could not list instances because its installed
launcher reported unavailable LXD access; it supplied no inventory.

Discovery walked the known source bases to depth four, following owner context
roots and recognizable project/state markers. Dependency/build/cache trees were
pruned and directory symlinks were recorded without traversal. Distinct files
were counted by device/inode. Aliased root labels can overlap; do not add root
subtotals as if each represented independent authority. The full metadata
contains mode, UID/GID, mtime, path and inode for classification.

A supplementary Brain metadata pass covers its user configuration, installed
host scripts and selected cache subtrees, including retained learning/scratch
state. KB, model assets and installed generation trees are excluded from
recursive traversal. This pass is additional to the totals above: Mac has
5,655 file identities / 3,071,983,404 bytes; HZ has 27,926 / 36,831,247,633 bytes.
It includes 1,228 Mac and 15,544 HZ .db paths, whose authority is unclassified.
One HZ scratch directory disappeared during traversal; the exact ENOENT is
retained privately. This live metadata scan is not a consistent snapshot.

## Registered owner coverage

These are registered ownership claims, not proof of all active writers.

| Scope | Mac | HZ |
| --- | --- | --- |
| User-patterns | Separate owner pinned to ~/.claude-flow/user-memory.db | Separate owner pinned to ~/.claude-flow/user-memory.db |
| Brain global learning | Separate owner pinned to ~/.claude/global-memory/.swarm/memory.db | Separate owner pinned to the equivalent HZ user path |
| Research/project owners | AI-BA, BA, EA research, SA, OPDA, OPDA browser, Product and this repository | AI-BA, BA, EA research, SA, Product, semantic-builder, five /data/source projects, two historical author contexts and OPDA inbox |
| Other discovered roots | Owner unresolved until enrollment review | Owner unresolved until enrollment review |

User-pattern DB lengths are 5,525,504 bytes on Mac and 7,548,928 on HZ.
Brain global-learning DB lengths are 9,162,752 and 64,892,928 bytes respectively.
Their physical identities and recovery roles must remain separate.

Source-bound research mappings retain BA/SA/AI-BA research in
`.swarm/agentdb-memory.db` and retained graphs in `.swarm/memory.db`.
Product has ordinary research in memory.db and learning in agentdb-memory.db.
EA access is limited to research; this work did not connect its operational DB.
Mac AI-BA is a different population from canonical HZ AI-BA.

## Required recovery families

Paths are discovery patterns, not universal defaults. Resolve each owner's
configured path and any external companions before capture.

| Family and path patterns | Recovery role and dependencies | Capture requirement |
| --- | --- | --- |
| ~/.claude-flow/user-memory.db | Reusable user lessons; distinct from Brain global learning | Native online snapshot and exact owner binding |
| ~/.claude/global-memory/.swarm/memory.db | Brain user-scoped learning observations and retained records | Native snapshot plus learning scope/adoption configuration |
| Project .swarm/memory.db | Ordinary memory, provenance/history and retained graphs according to owner | Snapshot full schema/data, not just memory_entries export |
| Project .swarm/agentdb-memory.db | Patterns, skills, episodes, hierarchy, controller state and other native tables | Same native capture; verify all retained types/history |
| .claude/memory.db and configured alternate stores | Legacy or retained scratch populations may be nonempty | Classify via owner APIs; never assume disposable |
| agentdb.rvf, memory.rvf, other *.rvf | Format-specific vectors, metadata, manifests, model/overlay, graph/witness segments | Qualified native whole dependency set; extension alone is insufficient |
| *.rvf.idmap.json and external .meta files | String/numeric identity, metadata and next-ID allocation | Same capture generation as RVF; validate bidirectional mappings |
| ruvector.db, HNSW index and metadata files | May contain unique embeddings/IDs or an acceleration index | Keep until deterministic rebuild and model/dimension compatibility are proven |
| .claude-flow/neural/patterns.json | Local ReasoningBank patterns, confidence, usage and provenance | Owner-consistent snapshot; independent of SQLite |
| .claude-flow/neural/stats.json, models.json | Learning statistics and separate neural model/pattern inventory | Capture with its corresponding pattern/model generation |
| .swarm/ewc-fisher.json | Fisher matrix, pattern state, consolidation history and EWC configuration | Preserve with matching patterns/weights, not as a cache |
| .swarm/sona-patterns.json; .claude-flow/ruvllm/sona-store.json | Persisted SONA learning in observed deployments | Identify actual owner/schema; do not infer full volatile engine coverage |
| .claude-flow/ruvllm/microlora-store.json; neural/lora-checkpoint-*.json | Adapter/checkpoint state and training continuity | Include architecture, rank, dimensions, base-model identity and optimizer state where persisted |
| Neural router, Q-learning, calibration and other training checkpoints | Learned routing and calibration | Discover configured paths through owner source/status, including nondefault outputs |
| .claude-flow/data/graph-state.json, ranked-context.json | Graph/context projections; some may be derivable | Preserve source provenance and rebuild proof before exclusion |
| .claude-flow/policy/, harness policy and receipt segment directories | Policy state, immutable decisions/receipts, hashes and authorization evidence | Full ledger closure; restore as inactive historical authority |
| .swarm/project-progression-outbox.jsonl and continuity records | Frozen captures, pending work, progression journal and acknowledgement state | Seal journal cut; preserve reconciliation state without automatic replay |
| .ruvnet-brain/checkpoint*.json, token-ledger.jsonl | Project checkpoints and accounting/continuity history | Owner-sealed capture; separate semantic state from optional cost history |
| ~/.config/ruvnet-brain/ | Learning/decision outcomes, pending decisions, work ledgers and operator suspension | Capture durable decisions/preferences; classify notification/cooldown artifacts separately |
| ~/.cache/ruvnet-brain/{learning-ruflo,ruflo-cwd,learn,learn-capture,turn-capture}/ | Potential retained records and captures inside directories named cache/scratch | Preserve nonempty state and classify ownership through native interfaces |
| .claude-flow/sessions, .claude/sessions, ~/.claude/projects, ~/.codex/sessions and archived_sessions | Conversations, subagent histories, resume identity and compaction continuity | Closed segments or committed-prefix capture; active file copies need owner consistency |
| Native host state SQLite, histories, session indexes and mappings | Links transcripts to resumable sessions | Owner-supported snapshot and version-compatible recovery; filename/version discovery required |
| ~/.config/ruflo memory owner registry and host MCP configuration | Canonical paths, service binding, source population and relaunch behavior | Preserve configuration separately from secret values; remap safely on restore |
| Project source, lockfiles, schemas, instructions, private research originals and manifests | Recreates compatible executable/schema/model context and nonpublic source evidence | Git alone does not cover dirty/ignored/private originals |
| Federated identity/channel keys and encrypted database keys | Access to otherwise unrecoverable encrypted data | Separate encrypted key custody and tested recovery; never print contents |
| launchd/systemd, containers and mounted application data | Recovery ordering and state outside source checkouts | Owner-specific capture plus service configuration; never restore PID/lock artifacts as live state |

Do not auto-exclude backups, nested .swarm directories or cache-named stores:
some are the sole retained recovery copy. Classify them first, then avoid
recursive backup-of-backup growth through an explicit retention policy.
Rebuildable package downloads, verified upstream KB/model caches, build products,
socket/PID/lock files and WAL/SHM process artifacts do not need independent
restoration. WAL data belongs in an owner-consistent database snapshot.

The Brain updater/KB plane remains native. Recording generation/configuration
identity is not authority to restore active.json, promote a generation, pin an
old release or replace update/cache assets. Recover executable compatibility
through the supported lifecycle; preserve unique user learning separately.

## Measured examples

These counts include every occurrence in the bounded metadata inventory,
including historical copies. They are not counts of authoritative stores.

| Filename | Mac count / bytes | HZ count / bytes |
| --- | --- | --- |
| patterns.json | 35 / 111,901,566 | 84 / 683,670,341 |
| ewc-fisher.json | 11 / 117,613 | 61 / 642,369 |
| sona-patterns.json | 10 / 145,320 | 12 / 163,109 |
| sona-store.json | 3 / 1,695 | 1 / 415 |
| microlora-store.json | 3 / 6,606 | 1 / 499 |
| agentdb.rvf.idmap.json | 11 / 495 | 32 / 1,440 |
| hnsw.index | 14 / 51,724,288 | 52 / 311,070,720 |
| hnsw.metadata.json | 10 / 21,421,010 | 12 / 90,356,903 |
| graph-state.json | 28 / 4,392,496 | 26 / 4,470,127 |

There are 48 stats.json occurrences on Mac and 101 on HZ; filename alone does
not assign all of them to the intelligence owner. The small ID-map lengths do
not prove the associated vectors are disposable or that the mapping is complete.

The coarse session-directory category is 24,541,486,278 bytes on Mac and
74,865,076,263 on HZ. Claude project transcript trees also appear in the broad
other category. This is a strong reason to measure segment reuse and compression;
it is not an authorization to delete historical conversations.

## Native capability evidence

Installed source inspected without importing it:

- Ruflo 3.71.4 `dist/src/services/memory-backup.js` selects configured ordinary
  and controller stores, or one explicit override. It uses the shared native
  SQLite library and returns `native-online-backup`. Its native-only refusal
  blocks image fallback. The GCS upload branch is best-effort. No S3 or complete
  learning/RVF backup contract was exposed by the inspected command help.
- `dist/src/memory/intelligence.js` resolves project or home neural directories.
  patterns.json is written directly; stats.json uses its separate lock and
  temp/rename path. The local SONA coordinator reports a bounded in-memory
  buffer that resets per process. No atomic set capture was demonstrated.
- `dist/src/memory/ewc-consolidation.js` directly writes Fisher/config/history
  JSON and suppresses write errors. A flush call alone is therefore not proof.
- AgentDB 3.3.0 `dist/src/backends/rvf/RvfBackend.js` has `save(_path)`
  that flushes and compacts the current database rather than exporting to the
  supplied destination. The separate SqlJsRvfBackend has different semantics.
- Installed SDK @ruvector/rvf 0.2.3, native wrapper 0.1.8, writes a separate
  .idmap.json through `dist/backend.js` and treats mapping persistence failure
  as nonfatal. Its README documents read-only open and COW derivation, neither
  of which proves an independent complete backup.
- @ruvector/sona 0.1.5 README/type declarations expose learning operations and
  flush, but the reviewed binding does not establish full persistent export.
  Higher-level checkpoints exist: installed @ruvector/ruvllm is 2.7.0 and
  Ruflo's lora-adapter discovers checkpoint JSON under the neural directory.
  These facts do not prove all SONA/EWC/optimizer state is captured.
- Brain located RuVector's native edge-snapshot crate. The fetched
  [manifest implementation](https://github.com/ruvnet/ruvector/blob/main/crates/ruvector-edge-snapshot/src/manifest.rs)
  defines epoch, dimensions, row count, audit head, chunk sizes/hashes and optional
  signature; the
  [streamed exporter](https://github.com/ruvnet/ruvector/blob/main/crates/ruvector-edge-snapshot/src/rvf_export.rs)
  includes IDs and metadata in PROFILE companions. Its row/runtime format and
  local owner exposure require qualification. Do not build a parallel algorithm.
- Existing SA `src/programme/backup-comments.py` uses Artalk's native SQLite
  backup, archive compression, S3 checksum/VersionId and an atomic success
  receipt; its timer is hourly. Its own docstring explicitly excludes Ruflo and
  AgentDB. Reuse the packaging/delivery pattern and tests, not its managed-store
  access or its application-specific secret bundle.

ADR-037 is Accepted (3 November), with production upgrade not started in that
record. ADR-006 and ADR-028 are Implemented. None of those statuses establishes
that the proposed fleet service already exists.

## S3 prices

USD list prices, London eu-west-2, retrieved 5 November 2026; taxes, discounts
and free-tier eligibility excluded. S3 source publication: 4 November 2026.
Deep Archive source publication: 11 September 2026. Data transfer source:
3 November 2026. Storage uses AWS's billed GB-month unit; do not mix it with
decimal byte totals without conversion.

| Item | London rate |
| --- | --- |
| Standard, first 50 TB | $0.024 / GB-month |
| Standard-IA | $0.0131 / GB-month; $0.01 / GB retrieval |
| Glacier Instant Retrieval | $0.005 / GB-month; $0.03 / GB retrieval |
| Glacier Flexible Retrieval | $0.00405 / GB-month; standard retrieval $0.0105 / GB; bulk bytes/requests free |
| Deep Archive | $0.0018 / GB-month; standard $0.021 / GB and $0.106 / 1,000 requests; bulk $0.005 / GB and $0.026 / 1,000 |
| Standard PUT/COPY/POST/LIST | $0.0053 / 1,000 requests |
| Standard GET and other requests | $0.00042 / 1,000 |
| Lifecycle to IA / Intelligent-Tiering | $0.01 / 1,000 transitions |
| Lifecycle to GIR / GFR / Deep Archive | $0.02 / $0.0318 / $0.06 per 1,000 |
| Intelligent-Tiering monitoring | $0.0025 / 1,000 eligible objects-month |
| Internet egress, first paid 10 TB | $0.09 / GB beyond the shared global free allowance |
| Customer-managed KMS key | $1/month initially; first two rotations each add $1/month |
| KMS symmetric operations model | $0.03 / 10,000 requests before allowance; confirm regional key/operation quote at implementation |

Primary sources: [London S3 price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/eu-west-2/index.json),
[London Deep Archive price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3GlacierDeepArchive/current/eu-west-2/index.json),
[London data transfer price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/eu-west-2/index.json)
and [KMS pricing](https://aws.amazon.com/kms/pricing/).
The KMS operation example is AWS's published example, not an observed regional bill.

IA has a 128 KB minimum billable size and 30-day minimum duration; GIR has
128 KB and 90 days. GFR requires 90 days; Deep Archive 180 days. GFR and
Deep Archive add 40 KB per object: 8 KB billed at Standard and 32 KB at the
archive rate. Early deletion, overwrite or transition can incur remaining
minimum-duration charges. [AWS storage pricing](https://aws.amazon.com/s3/pricing/)

New lifecycle configurations normally do not transition objects below 128 KB.
Versioning requires explicit noncurrent-version rules; current expiration can
leave billable versions and delete markers.
[AWS lifecycle rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)

Intelligent-Tiering leaves objects below 128 KB in Frequent Access without
monitoring charges. Automatic tiers move at 30 and 90 days; optional archive
tiers introduce asynchronous access. Frequent restore drills can move data
back to the frequent tier.
[Intelligent-Tiering](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intelligent-tiering-overview.html)

Deep Archive standard retrieval is typically within 12 hours, bulk within
48; GFR standard is typically 3-5 hours and bulk 5-12. Add staging storage,
GET, download and validation time/cost.
[Retrieval options](https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html)

Object Lock protects particular versions, while new versions and delete markers
remain possible. Manifest version IDs must therefore be explicit.
[Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)
Bucket Keys can reduce KMS request cost by up to 99%, but savings depend on
requester/activity patterns and change the encryption context to the bucket ARN.
[Bucket Keys](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-key.html)

## Cost formulas

Let D be the compressed baseline GB, U the measured new unique artifact GB/day
after the selected qualified reuse method, N the retained object count, and T
the effective hot retention horizon. A conservative all-unique upper model is
`hotGB = D + U*T`; selected weekly points may retain fewer intermediate objects,
but the worst case uses T=84 days. Full snapshot copying instead uses
`hotGB = sum(snapshot size for every retained generation)`.

Monthly cost is:

`sum(classGB * classRate) + PUT/1000*0.0053 + GET/1000*0.00042
+ transitionRequests/1000*transitionRate + KMS + retrievalGB*retrievalRate
+ restoreRequests + temporaryRestoreStorage + paidEgressGB*0.09
+ monitoring + replication + minimumDurationAndMetadataCharges`.

For S3 versioning, classGB includes noncurrent versions and Object-Locked
unreferenced bytes. Deduplication manifests and packs must not be lifecycle
expired while referenced. Archive sets use an additional independent baseline;
do not pretend moving a shared pack cold leaves hot recovery unchanged.

Illustrative steady-state scenarios, not measured compression/change rates:

| Scenario | Assumptions and storage estimate |
| --- | --- |
| Small qualified reusable set | D=10 GB, U=1 GB/day, hot T=84: 94 GB Standard = $2.26/month; budget 14 monthly independent 10 GB archives = $0.25/month, plus roughly $0.06/month Standard transition staging |
| Larger qualified reusable set | D=100 GB, U=5 GB/day: 520 GB Standard = $12.48/month; budget 14 monthly 100 GB archives = $2.52/month, plus roughly $0.56/month Standard transition staging |
| Full copies every 15 minutes | D=10 GB, 96/day, seven days = 6,720 GB Standard = $161.28/month, before older daily/weekly/archive sets and requests |
| One initial copy of observed state | About 185.38 GiB across Mac/HZ/hm-ec2, before supplementary Brain state, compression, authority exclusions or additional hosts; at Standard about $4.45/month for one copy only |

The small/larger cases require a proved reuse method and measured U. Frequent
full SQLite snapshots that change throughout can behave like the full-copy case.
Neither the observed file count nor native RuVector chunk capability establishes
a dedup ratio. A 400-day retention period can overlap 14 monthly sets; the
archive estimates conservatively budget that overlap. Shared pack reuse also
requires verified Object Lock extension or a separately locked copy, which can
increase retained bytes above the ideal reuse model.

At 100,000 monthly PUTs, requests cost $0.53; 100,000 KMS operations at the model
rate add $0.30 before Bucket Key savings/free allowance, plus the key charge.
A million eligible Intelligent-Tiering objects add $2.50/month monitoring.
A million 4 KiB archived objects add about 38.1 GiB metadata, and 128 KB
minimum-sized classes would bill about 122.1 GiB for roughly 3.8 GiB payload.
Packing materially changes this tradeoff.

A 100 GB Deep Archive restore costs $0.50 in bulk retrieval bytes or $2.10
standard, plus request/staging/GET/egress costs. If the shared allowance is
already consumed, 100 GB internet egress adds $9. Restoring in-region on an
isolated verifier may avoid internet egress, but compute, networking and any
cross-region transfer still need pricing. Do not assume the free allowance is
available or that monthly drills are free.

## Evidence custody and gaps

Private evidence is retained under `.local/fleet-backup-20261105/`:
host metadata JSON, owner summaries, SSH probe outcomes, original fetched
AWS/source bytes, raw Brain/Seraphina results, exact native memory reads,
backup help and AIDefence verdicts. It includes private path metadata and is
not a publication artifact. Durable documentation intentionally summarizes it.

Project memory retrieved ADR-037; user-pattern recall supplied
`ruflo-lossless-recovery-all-table-proof` and
`ruflo-live-memory-cross-host-migration-wal-safe-2026-08-21`.
The selected exact records were read and screened. SA's exact native record
`project-setup/artalk-lightsail-migration-20261003` is historical evidence.
BA/EA/Product search results were not treated as accepted backup architecture.

Brain's initial oversized scan returned an input-limit error. The unchanged
response was preserved and then completely screened in overlapping chunks.
All Brain chunks and selected exact memory/Seraphina reads admitted for this
proposal returned safe=true. Unused search snippets with piiFound flags remain
private and are not source authority for this decision. Fetched source admission
and hashes are recorded separately from capability proof.

No host was declared fully protected, no existing backup was certified by this
research, and no historical learning repair was attempted.
