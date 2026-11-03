# ADR-006: memory: path identity, fail-closed serialization, and WAL refusal

**Status**: Implemented
**Date**: 2026-07-14
**Updated**: 2026-11-03. Release 4.46.115 adds negotiated one-call lifecycle
retirement on native handler completion, plus bounded abandoned-handshake expiry.
Persistent callers, in-flight operations and unknown-write outcomes remain intact.
The reviewed HZ 20-second recall profile is retained in the shared patch target;
Codex SessionEnd limits remain native. Actual killed-client and lost-response tests
extend the prior happy-path session qualification.
2026-11-03. Release 4.46.114 reuses fully authenticated anchor bytes
within the native locked transaction, verifying a single-use SHA-256 digest before
atomic publication. Full initial authentication, native format/fallback, receipts
and uncertain-write recovery remain intact. Admission scans now retry normal
owner-retirement ENOENT within their existing bound. All 10 Mac and 15 HZ native
owners activated 4.46.113; reported-project fresh Stop/checkpoint checks pass.
2026-11-03. Owner requested temporary larger finite budgets while
latency is diagnosed: recall 10s, capture 30s, policy-lock acquisition 15s;
native checks and SessionEnd host caps remain authoritative (release 4.46.113).
2026-11-03. Release 4.46.112 adds bounded private phase/lock-owner
diagnostics to native policy transactions; authorization, deadlines and storage
remain unchanged. All owner HTTP tool authorizations now share its per-root
queue; previously non-memory hooks bypassed it and could contend with memory
authorization in the same process. Cross-process contention remains under investigation.
2026-11-03. Release 4.46.111 parses complete bounded anchor lines
with native JSON.parse, preserving the streaming fallback and all hash checks;
policy batches yield to HTTP work between native transactions.
2026-11-03. Release 4.46.110 serializes native owner memory
authorization per policy root, including writes, to prevent overlapping batches
from contending with their own policy lock. Each native decision and receipt is
retained. Monitor inspection verifies the exact composed write guard.
2026-11-03. Release 4.46.109 preserves originating caller policy and
batches concurrent read authorization with individual native receipts; negotiated
protocol controls remove downstream overhead without changing hook deadlines.
Historical incident reconstruction is not a release gate.
2026-11-03. Native owner routing is active on both hosts; full fleet
convergence remains incomplete. Release 4.46.108 adds native completed-client
session retirement for Ruflo #4674, with Mac/Linux 105-client concurrent proof.
Uncertain writes and unrelated sessions remain untouched; capacity and expiry stay native.
2026-11-03. Reject conflicting explicit MCP paths before dispatch;
the former downstream binding silently substituted its configured store. Matching
and omitted paths retain their authority, and historical overlays upgrade from
their preserved pristine source. This correction does not resolve #4654.
2026-11-03. Matched pristine/current-patch and same/different-directory
controls distinguish the 3.71 native failure from our withdrawn vector-path policy.
That older policy remained loaded in five processes despite clean installed source;
native owner refreshes now retire those handles, with exact record/inventory checks
and all former index files preserved. The old 3.66 shared-directory success uses
native RVF fallback and is not shared RuVector ownership proof. Upgrade remains held.
2026-11-03. Requalified published Ruflo 3.71.0 without downstream
patches: a persistent native RuVector owner still prevents a second process from
opening the same store. The first owner and a later fresh process read the exact
record successfully; the concurrent contender fails. This is the separate native
ownership defect tracked by Ruflo #4654, not evidence to restore our withdrawn
vector-path policy. Production upgrade remains held until a compatible native
owner/client path is qualified. Current working runtimes and managed data are preserved.
2026-11-02. Withdraw the downstream AgentDB vector-storage path policy:
its forced shared companion caused concurrent-owner lock failures. Restore only
exactly proven old source compositions; preserve all indexes and retain upstream
storage defaults, including newer explicit-path implementations. This is a
withdrawal of our incorrect policy, not a claim that upstream provides shared ANN ownership.
The dependent capture/recall adapters and both HZ checkpoint overrides are withdrawn;
full native registry initialization is restored. Retain only the independent
retrieve-error propagation fix. Concurrent native owner/CLI store, exact readback
and ordinary search passed on an isolated store before deployment.
2026-10-31. Shared user memory uses the native authenticated
loopback HTTP transport, one owner per host; project stores retain their own
bindings. Concurrent HZ inventory, exact retrieval and search passed without
sidecar manipulation. Per-process path identity does not coordinate exclusive
RuVector companions across processes.
2026-10-19. Restore upstream's separate default AgentDB owner, retain explicit
source/user bindings, qualify native-only recovery snapshots and report global alias clients.
Explicit retained-graph reads and encryption checks also honor the selected file
(#4291); synthetic fresh-MCP checks verify source isolation and refusal behavior.
2026-10-18. Implicit native controllers now honour the configured canonical store;
the legacy encrypted sql.js exception cannot silently override an explicit native binding.
2026-10-10. Raw WAL refusal checks both the supplied path and its canonical symlink
target; unresolved existing aliases are refused (source-patch #7). This corrects a guard bypass,
not database recovery.
2026-10-04. Native auxiliary handles resolve the actual AgentDB SQLite dependency
(#3693); fallback pattern receipts require successful storage and exact readback (#3691).
2026-09-21. MCP memory operations now carry the configured `CLAUDE_FLOW_DB_PATH`
through to the existing memory API (#2105/#3196); initialization alone previously honored it.
2026-09-15. Ruflo 3.41.2+ keys registry instances by `path.resolve()` natively (#3196)
but still latches availability and failure reason process-wide and splits symlink aliases; the
`memory/path-keyed-bridge-maps` entry applies the same canonical state to that shape. 2026-08-31. Exact published Ruflo 3.38.12 routes ordinary sql.js mutators and native
purge through shared `withMemoryDbLock()`, delivering the basic #2878 lost-update baseline. Ruflo
3.38.20 still caches one process-global native registry despite accepting an explicit database path
(#3143). The local target keys that state by canonical database identity and retains its stronger
outer bridge/fallback serialization, fail-closed token/inode ownership, no mtime-only lock theft,
raw WAL-sidecar refusal, integrity gate, and stale-writer enforcement. Closed #2621 remains the
historical lost-update report.
**Deciders**: Henrik Pettersen
**Tags**: patch-target, durability, data-loss

## Context

`.swarm/memory.db` silently drops writes. Ruflo's fallback memory functions perform a whole-file
read-modify-write (`sql.js` export followed by atomic rename). Two processes can each read image
v1 and each publish a valid image v2; the second rename clobbers the first. Atomic publication
prevents a torn file but cannot prevent this lost update.

The clean 3.33.0 reproducer forced the documented fallback with
`CLAUDE_FLOW_DISABLE_BRIDGE=1`: all 12 `storeEntry` calls returned success, only 2 rows remained,
and `integrity_check` still passed. That historical implementation used `withMemoryDbLock()` only
for purge. Ruflo 3.38.12 now makes the ordinary sql.js writers participate too, so the local overlay
is no longer the first or only serialization layer.

There is a separate engine-boundary hazard. The AgentDB bridge uses native SQLite in WAL mode;
the fallback reads and replaces the main file as a complete image. `sql.js` cannot see frames in
`-wal`. Reading that main file while a native holder is attached can therefore produce a stale
image and replacing it can detach or mispair the holder's WAL. A helper must not "repair" that
state by checkpointing or removing another connection's sidecars.

There is also a separate identity hazard inside the native bridge. `getRegistry(dbPath)` accepts an
explicit project or user database, but Ruflo 3.38.20 caches one module-global promise, instance,
availability state, and failure reason. The first database opened wins for the process. Project-first
made a later user request return no user rows; user-first made a later project request return all 212
user rows, including a user-only key. That is an authority-boundary failure, not a WAL or search
quality failure.

## Decision

### Route concurrent callers through the native owner

Ruflo 3.71's native persistent RuVector index permits one process owner. The
issue-backed `ruflo-memory-owner` target routes explicitly configured CLI and stdio
clients through the native authenticated HTTP server and SDK. It preserves the
existing project controller registry, ordinary store paths, retained-graph roles,
immutable write predicates and canonical public/CLI output. Native daemon trajectory
embeddings use the same public boundary; workers and their configured lifetime remain
unchanged. No database migration, new
storage adapter, Brain hook replacement or alternate vector path is introduced.

Owner identity is checked before dispatch. Bindings, private credentials and literal
loopback endpoints are validated; missing authority and uncertain write outcomes
refuse without fallback or replay. Routed initialization is an explicit administrative
refusal. Public forwarding wraps existing export guards, avoiding a client-held lock
while the native owner writes. Actual daemon trajectory and enabled harness tests
prove no managed database/index opens in the worker. Both hosts passed disposable
real CLI/stdio/HTTP tests including distinct graph roles and final public-boundary
composition;
production rollout is in progress. Completed SDK sessions use explicit UUID-bound
retirement at the next valid native initialization (#4674); native session capacity,
expiry and uncertain in-flight execution remain unchanged. This is not the broader
request-local authority repair proposed by upstream PR #3268. Retire on equivalent upstream behavioral proof, not
on a diagnostic change or issue closure alone. See Ruflo #4654 and the README's
3 November qualification for evidence and deployment status.

### Preserve the configured MCP store

The `memory/mcp-configured-store` entry binds the existing MCP memory API functions to
`resolveDbPath(CLAUDE_FLOW_DB_PATH)` when that environment setting is nonempty. Without it,
project behavior is unchanged. The same path reaches initialization, list, retrieval, search,
store and delete; callers cannot override a configured connection's store. An explicit
conflicting path now refuses before native dispatch instead of silently selecting another
store. Matching normalized paths and omitted paths retain the configured identity. No new database
driver is introduced. Initialization status uses the same explicit path. Explicit-store
connections disable legacy migration so project entries cannot leak into shared memory.
Existing bridge, locking and WAL refusal remain authoritative.

Retire this entry only when the native MCP handlers pass the configured identity through all
six operations, refuses a conflicting explicit caller path, and a two-store test proves that project and user results stay separate.
`test/memory-mcp-path.mjs` checks that handoff and the pristine missing-path failure.

### Key native bridge state by canonical database identity

The `memory/controller-configured-store` entry retires on upstream's independent
controller resolution. `CLAUDE_FLOW_DB_PATH` binds ordinary MCP memory operations;
implicit trajectory, ReasoningBank, graph and hierarchy controllers derive their
`agentdb-memory.db` sibling independently. Explicit public bridge `dbPath` arguments
remain database authority boundaries. This removes both the one-file default and
the explicit environment override introduced downstream. Exact historical
composition proof withdraws both known revisions, including shared-file upgrades;
it must never reinstall them during a later monitor cycle.

The native probe covers ordinary path overrides, both encryption settings,
nondefault memory roots and the in-memory sentinel. No database is moved, merged
or deleted by installation. Existing combined stores and aliases require a
separately verified migration and fresh host processes; code installation must
not claim that migration happened. The owner authorized a bounded native SQLite
migration exception for this bugfix on 2026-10-19; ordinary operations continue
through their native interfaces.

Pattern get/delete validates the intended native operation's canonical path and
actual registry, independently of the CLI/sql.js filename. Its guards must not
turn a legitimate two-store default into `native-registry-resolver-mismatch`.

`memory/native-online-backup` and its command entry provide explicit
`memory backup --native-only` recovery (#4287). Native-only failures return a
refusal before any image-copy fallback; successful online snapshots include their
method. The backup uses the existing shared SQLite owner. The default encrypted
compatibility route is preserved. Retirement requires equivalent upstream native
failure refusal, receipt and CLI-forwarding behavior; ordinary JSON exports do
not establish complete vector/controller preservation.

Replace the process-global registry lifecycle with a map keyed by `path.resolve(dbPath)` and the
`realpath` of an existing file or existing parent. Each database owns its initialization promise, registry instance,
availability state, failure reason, and shutdown lifecycle. Relative, absolute, and symlink aliases
of one existing store therefore share one state, while the user store and every project store remain
independent.

First initialization is queued because upstream temporarily replaces process-global `console.log`
while `ControllerRegistry` starts. Once initialized, operations on independent registries remain
concurrent. A failed A initialization cannot disable B. `shutdownBridge(path)` closes only that
canonical store; `shutdownBridge()` closes every unique registry exactly once.

### Serialize every exported writer, and fail closed

Inject one outer `<db>.rsp-lock` protocol around `initializeMemoryDatabase`, `storeEntry`, `getEntry`,
`deleteEntry`, `applyTemporalDecay`, `ensureSchemaColumns`, and native `purgeNamespace`.

- `O_EXCL` creation provides cross-process exclusion across the complete read-modify-write.
- `AsyncLocalStorage` makes a genuinely nested call reentrant without treating unrelated sibling
  Promise chains in the same process as owners. Reentry also verifies that the inherited claim is
  still active, so a detached continuation cannot reuse permission after its ancestor releases.
- An unresolved path, filesystem error, or five-second timeout throws
  `RSP_MEMORY_LOCK_UNAVAILABLE` before the operation runs. An unavailable lock never becomes an
  acknowledged unlocked mutation.
- Each claim records a unique token. Release verifies both the open file's inode and its token,
  so a late cleanup cannot unlink another writer's successor claim.
- The patch deliberately does not steal a lock by age. Age is not proof that a large write died,
  and filesystem unlink is not compare-and-delete. A hard crash may leave a lock that requires
  guarded recovery under ADR-023: positive proof that the recorded owner exited, unchanged
  identity and contents, and preservation of the abandoned claim as evidence. Ambiguity refuses recovery.

The EOF wrapper serializes both native bridge and fallback paths so they cannot race each other,
but the image-safety checks below run only when Ruflo actually crosses its raw `fs-secure` boundary.
A successful transactional AgentDB bridge call is not falsely rejected as a whole-image rewrite.
Ruflo's native `<db>.lock` remains nested and byte-for-byte upstream-owned. It coordinates patched
and unpatched current writers; the outer lock adds the stronger ownership and failure semantics that
native 3.38.12 does not yet provide.

### Use one native SQLite library identity

`ruflo-sqlite-owner` resolves `better-sqlite3` through the actual
`@claude-flow/memory` → `agentdb` dependency owner. The graph writer, bridge attestation,
and native repair/recovery constructor sites use that same library. Auxiliary handles remain
separately owned and close only themselves; no registry handle is borrowed and closed.
Missing authoritative dependencies fail through the existing error paths.

Ruflo 3.51.1 can load CLI SQLite 12.11.1 and nested AgentDB SQLite 11.10.0 in one process.
The executable regression reproduces detached WAL/SHM after the original graph writer closes
against an independently held AgentDB handle. With shared library identity, repeated graph
release preserves the holder's sidecar identity, existing records and integrity. This test uses
an isolated synthetic database; the patch performs no database or sidecar repair.

### Acknowledge fallback patterns only after exact readback

`ruflo-pattern-receipt` preserves unsuccessful native bridge writes before their wrapper can
rewrite them as success, and checks the registry-null
fallback's `storeEntry` result. Only an explicit successful store followed by successful exact
`getEntry` readback of the same key, singular `pattern` namespace and serialized content may
return a verified receipt. A failed or ambiguous store cannot be rescued by an older matching
record. Healthy native ReasoningBank behavior remains unchanged.

Both targets retire only after executable tests prove the installed upstream behavior; versions
and issue closure alone are insufficient.

### Refuse raw access while WAL sidecars exist

At `readFileMaybeEncrypted` and `writeFileAtomic`, fail with
`RSP_UNSAFE_WAL_SIDECARS` whenever the target is a `.db` and either `-wal` or `-shm` exists.
Sidecar presence is the signal, including a zero-byte WAL held by a live connection. A stat error
also fails closed because absence could not be proven.

The patch never checkpoints, truncates, unlinks, renames, or otherwise mutates another
connection's WAL state. `initializeMemoryDatabase({force:true})` is checked before upstream
unlinks the main database, and `checkMemoryInitialization` is guarded outside its catch block so
a live WAL cannot be misreported as an ordinary "not initialized" result.

This is the narrow policy from #2735 applied at the actual whole-image boundary. The upstream
per-function gates remain useful, but the boundary also covers `ensureSchemaColumns`,
`applyTemporalDecay`, purge fallback, and any future caller of the shared helpers.

## Explicit auxiliary ownership: 30 October 2026

Ruflo 3.65.0's primary bridge write accepts an explicit database, but the following
`addToHNSWIndex` call and its `bridgeAddEmbedding` delegate omitted that identity.
The delegate performs another native SQL upsert; it does not construct HNSW.
Thus an otherwise correctly targeted write could copy a full record to the ambient
native store. Brain's scratch cwd made that copy vulnerable to unrelated cleanup.

The existing memory target forwards the optional path through ordinary and pattern
auxiliary calls. Explicit requests never fall back to the unscoped HNSW singleton
or mutate its key/namespace entries during store, delete or purge. A failed auxiliary
sync leaves the committed primary receipt intact and does not replay the primary write.
Calls without a path retain native behavior; native controller initialization keeps
its independent default. No data migration, merge or cleanup follows from installing
this source correction. Source fixtures must reproduce the wrong-store copy before
patching and test explicit failure, native/raw writes, delete/purge, implicit defaults
and sibling patch composition afterwards. Related upstream issue: [#3196](https://github.com/ruvnet/ruflo/issues/3196).

## Consequences

### Positive

- Concurrent cross-process and same-process sibling writes serialize; the executable regression
  keeps all 80/80 cross-process updates and 40/40 sibling updates.
- An explicit project or user path remains authoritative in either call order; a first-opened store
  cannot capture later requests in the same MCP process.
- Availability, degraded-path diagnostics, and shutdown are scoped to the database that owns them.
- Lock acquisition failure aborts before the callback, so failure cannot look like success.
- A raw fallback cannot read or replace the main database while native WAL state exists.
- The patch no longer mutates a live database merely because a helper attempted a read.
- Native purge and ordinary sql.js writers now share the upstream protocol. The executable retirement
  probe for #2666 accepts that complete native set without requiring local `.rsp-lock` bytes.

### Negative

- A lock adds latency to every exported memory operation.
- A process killed without running its exit cleanup can leave `<db>.rsp-lock`. Guarded recovery must
  prove the recorded owner exited and preserve the unchanged claim; it refuses ambiguous owners.
- Fallback access is unavailable while a native connection keeps WAL sidecars present. The native
  bridge must succeed, or the holder must close before retrying.
- One process can now hold several native registries. Their resources remain live until a scoped or
  all-registry shutdown; initialization is deliberately serialized around upstream's global logger.

### Neutral

- Upstream's `<db>.lock` remains nested and is left byte-for-byte intact. It now covers ordinary
  sql.js writers as well as purge, but still uses mtime-based stale takeover and lacks this target's
  token/inode-safe release and outer bridge/fallback boundary.
- The historical #2621 evidence remains relevant. #2878 now establishes the native serialization
  baseline; the local target tracks the stronger fail-closed durability policy above.

## Links

- Upstream: [#2878](https://github.com/ruvnet/ruflo/issues/2878),
  [#3143](https://github.com/ruvnet/ruflo/issues/3143),
  [#2735](https://github.com/ruvnet/ruflo/issues/2735),
  [#2621](https://github.com/ruvnet/ruflo/issues/2621),
  [#2584](https://github.com/ruvnet/ruflo/issues/2584)
- `lib/cwd/patch-library.mjs` (`bridgeRegistryMap`, `memLock`, `walRefusal`, `integrityGate` fragments)
- `test/memory-bridge-paths.mjs` (first-open defect, two-store identity, aliases, diagnostics, shutdown)
- `test/concurrency.mjs` (cross-process, sibling, reentrancy, fail-closed, ownership, WAL tests)
