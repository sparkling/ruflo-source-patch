# ADR-032: ADR graph I/O must prove reads and writes before success

**Status**: Accepted
**Date**: 2026-08-31
**Updated**: 2026-10-08. Preserve the managed I/O contract across native 0.5.4 dispatch and edge-key changes.
**Deciders**: Henrik Pettersen
**Tags**: ruflo-adr, agentdb, verification, import, reindex, atomicity

## Context

The installed `ruflo-adr` 0.4.1 verifier, importer, and reindexer each turn an I/O failure into a
plausible success at a different boundary.

`verify.mjs` converts a failed, signalled, or malformed `memory list` call to `[]`, omits an explicit
limit while the managed CLI defaults to 20 rows, and silently skips malformed edge keys. It can certify
an unreadable or truncated graph as healthy.

`import.mjs` gives `ADR_ROOT` two incompatible meanings: the directory to scan and the cwd from which
the managed CLI infers `memory.db`. It starts one serial `npx` process per record/edge, has no timeout or
preflight, trusts a successful-looking store response without independent readback, and exits zero after
failed writes. A real dry run contained 107 records plus 460 edges, so the healthy path requires 567
cold process starts. The 718 MB AgentDB observed during diagnosis existed before that importer run; the
importer did not create it.

A live hz reproduction exposed a second identity split even at the same semantic version. Installed
`ruflo` 3.38.20 loaded native `better-sqlite3`; `npx @claude-flow/cli@latest` also reported 3.38.20 but
loaded sql.js. Against the same explicit healthy database and live WAL, installed Ruflo returned all 95
ADR rows while the npx child was correctly refused as unsafe whole-image access. Package/version identity
therefore does not prove storage-driver identity.

`reindex.mjs` purges both live namespaces and then performs the same independent writes. Ruflo 3.38.12's
shared writer lock prevents concurrency races, which was enough to retire the legacy #2666 compatibility
target. It does not make the purge and later rebuild one transaction. A failure after purge can leave the
derived graph empty or partial.

## Decision

Add the issue-backed `adr-io-safety` target for
[#3147](https://github.com/ruvnet/ruflo/issues/3147) and
[#3097](https://github.com/ruvnet/ruflo/issues/3097).

The target owns `verify.mjs`, `import.mjs`, `reindex.mjs`, and `lib/index-records.mjs` as one composed bundle across every active
Claude Code and Codex `ruflo-adr` marketplace/cache root. Before any write, a descriptor-level preflight
requires all four regular, non-symlink files and all exact anchors. A missing or drifted member blocks
the entire bundle. Status counts expected members before reading them.

All runtime operations separate scan scope from store identity. A canonical project root must be proven
from an explicit project marker unless `ADR_DB_PATH` or `ADR_DB_ROOT` supplies authority. Ruflo's existing
managed path variables/configuration remain supported. Every managed call receives the same absolute
`--path`; an existing database must be a regular non-symlink file. Calls use the installed `ruflo`
executable so verification and writes share the host's live native driver. An optional `RUFLO_ADR_CLI`
override must be absolute and resolve to a regular file. Absence is fatal; there is no npx fallback.

Verifier reads are discriminated and complete-or-failed. Each namespace request has a bounded timeout,
buffer, and explicit cap-plus-one. The whole stdout must parse as one JSON array; every row must have a
nonempty string key and the expected namespace. Spawn error, signal, timeout, nonzero exit, malformed or
non-array JSON, cap overflow, or malformed edge key prevents graph-health computation and exits nonzero.
A successfully read empty graph remains valid.

The shared record helper emits the deterministic memory-safe `relation:FROM:TO` key. Ruflo's
shared MCP/CLI key validation (#3570) rejects the former arrow separator; this patch does not weaken
that guard. Reads accept existing arrow/timestamp keys and unambiguous historical
`relation-ADR-NNN-to-ADR-NNN` keys and native 0.5.4 `relation:FROM__TO` keys without rewriting
the database. Exact 0.5.4 `spawnCliSync` source forms normalize into this same managed owner;
the verifier and importer retain no npx fallback. The verifier retrieves every
full edge value through the managed CLI and requires its relation and endpoints to match the key.
Missing, malformed or conflicting values fail verification. Native retirement must prove these
identity contracts as well as the existing I/O guarantees. This is graph verification, not a
claim that the installed verifier implements the skill's separately advertised status check.

Importer compatibility remains serial until a native proven batch writer exists. Before the first store,
both namespaces must be readable through the exact path. Each store must return a positive managed receipt
and then survive exact raw-byte retrieval by a fresh managed process. The first failure stops further
writes. A final complete list must contain exactly the intended deterministic keys; JSON and Markdown
share nonzero failure semantics and report scan root, database path, requested, attempted, and verified
writes.

Live non-dry-run reindex is refused before any managed call or purge. Dry-run remains an inspection-only
scan. Native retirement requires either one managed transaction that combines stale-key removal, upserts,
and final invariant proof, or a complete staging namespace/database followed by one atomic pointer/swap.
A strict batch launched after a separately committed purge does not satisfy the decision.

Retirement is executable. Candidate scripts run only in a temporary project with a fake `npx`; no probe
opens a real AgentDB. It checks malformed/incomplete reads, corruption after row 20, false-success and
receipt-without-readback writes, exact path propagation, bounded process startup, and an atomic non-purge
reindex route whose final fake-store key set exactly matches the source corpus. A marker-free no-op cannot
retire the patch; marker or issue state alone is likewise insufficient.

## Consequences

### Positive

- An unreadable store cannot become a healthy empty graph.
- Scan scope cannot silently redirect writes to another database.
- Same-version npx cache drift cannot silently switch ADR I/O to a different storage driver.
- A successful import means a fresh managed process read back every exact submitted value and the final
  deterministic key sets match.
- The destructive purge-first path is unavailable instead of relying on recovery after partial failure.
- One drifted bundle member leaves all four vendor files untouched and reports the complete denominator.

### Negative

- Current imports remain slow because durable proof requires one store plus one fresh readback process per
  row. Correct serial compatibility is not presented as the performance fix.
- Live ADR reindex is unavailable until upstream supplies an atomic managed reconcile. Users may still run
  dry-run to inspect the intended source set.

### Neutral

- ADR files remain the source of truth; the AgentDB namespaces remain derived state.
- The target never reads or mutates AgentDB directly, never checkpoints/unlinks WAL files, and never treats
  a process exit or textual receipt alone as persistence proof.

## Links

- [ADR-001](ADR-001-source-patch-by-literal-anchors.md)
- [ADR-006](ADR-006-memory-write-lock-and-wal-coherent-reads.md)
- [ADR-009](ADR-009-adr-reindex-reconcile-a-deleted-adr.md)
- [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md)
- [ADR-016](ADR-016-tests-are-behavioural-and-mutation-tested.md)
- [ADR-020](ADR-020-plugin-targets-compose.md)
- [ADR-023](ADR-023-memory-integrity-gate-and-stale-writer-guard.md)
