# ruflo-source-patch

Install with `npx github:sparkling/ruflo-source-patch`. Zero dependencies, no registry required.

Local fixes for [ruflo](https://github.com/ruvnet/ruflo) / `@claude-flow/cli` and its plugins
that are still absent from the installed host surface: folder sprawl, stronger memory safety,
dual-host plugin drift, and release/cache gaps in plugin fixes. Historical daemon compatibility
remains available for older Ruflo builds but retires itself on current native behavior.
Closed issue labels are never treated as proof; each retirement is gated on runnable local behavior.

**Catalog review history:** the [target tables](#targets) cover all registered patch
targets, including the recent memory, managed-CLI, progression and hook-diagnostic repairs.
Their presence in the catalog does not mean they are active in every installed copy.
Use `all status` and `monitor check` for installed source state; verify live MCP calls and
the owning host's hook trust separately after activation. A version bump or successful
installation alone does not prove a native replacement or a healthy running session.

`ruflo-memory-owner` preserves bounded native plain-text validation failures
instead of masking them as missing diagnostics ([source-patch #10](https://github.com/sparkling/ruflo-source-patch/issues/10)).
Errors remain refusals; structured failures retain their existing behavior. Unknown
objects and malformed JSON-like payloads are not printed as diagnostics. This
changes neither caller arguments nor authorization and never retries a rejected call.
The owner patch also recognizes the native 3.74 store anchor and preserves its
validated metadata in both canonical and ordinary results.
Release **4.46.181** is installed in both Mac prefixes and HZ: all 365 packaged
files per prefix and 54 Mac / 72 HZ owner source surfaces are verified. Fresh
native clients on both hosts preserve the validation diagnostic; HZ's corrected
read matches the complete original value. Existing cached clients and historical
lifecycle effects are not declared recovered. Owner regressions pass; 143/145
full-suite cases pass, with the two failures reproduced on unchanged `main` and
seven existing private-evidence Markdown findings retained.

`ruflo-tier-value-schema` publishes the existing hierarchical-store value limit:
non-empty and at most 10,000 UTF-16 code units. It adds the schema bound and
replaces the misleading later “100KB” message while retaining native validation,
storage, temporal validity and supersedes behavior. No values are truncated or
retried. The schema distinguishes Unicode code points from the additional native
UTF-16 limit ([Ruflo #4892](https://github.com/ruvnet/ruflo/issues/4892)).
Release **4.46.182** verifies all 367 packaged files in three prefixes and the
six Mac / eight HZ tool-source copies. Fresh native `tools/list` responses on both
hosts advertise the bound; no production memory write or original-client restart
was used. Focused tests pass on both hosts. The full suite passes 144/146 cases,
with the same two baseline failures and seven private-evidence lint findings.

The [incident021 mitigation](https://github.com/stuinfla/ruvnet-brain/issues/523)
in 4.46.159 extends `brain-hook-timeouts` with a 10-second
SessionStart restore budget, 16-second host registrations and a 15.5-second
Codex launcher limit. The native stage sum plus boot allowance is 13.4 seconds;
the Codex derived envelope is 15.25 seconds. Inherited deadlines, cancellation,
native authorization, checkpoint selection and exact reads remain required.
This is an operator-requested finite mitigation for concurrent restore latency,
not a root-cause fix. Remove the temporary profile when upstream default budgets
pass representative concurrent registered restores with complete exact values.

Version 4.46.162 adds `brain-turn-status` for
[Brain #524](https://github.com/stuinfla/ruvnet-brain/issues/524). SessionStart
shows a live, bounded capture attempt as pending exact readback, while dead,
expired or unknown owners remain unconfirmed. It reads bounded current and
rotated receipt tails, orders evidence before deduplication, and distinguishes
project or unscoped historical failures from an unproven current-session failure.
Only a later exact receipt for the same key clears a scoped ledger failure;
malformed or unreadable evidence remains visible. This repairs the composition
between our pending-capture receipts and the native status consumer. It does not
increase worker capacity, replay missing captures, or erase historical failures.
Release 4.46.168 corrects a retained-receipt window defect: an older pending row
in the rotated file could outlive its confirmation near the start of the current
file, outside the former 128 KiB tail. Both files are now read through 512 KiB
(native rotation is 256 KiB); larger files explicitly report incomplete coverage.
Regression tests reproduce the false warning, preserve same-key confirmation,
and verify exact upgrade/restoration of the previous patch. Deployment verified
4/4 files and 13 trusted hooks per host. Builder's installed status changed from
the stale pending warning to 20/20 exact readbacks within bounded coverage. Its
record was read through the explicit producer database; default MCP binding was
not changed. The laptop's unrelated historical failure remains visible.

## Native learning persistence: 8 November 2026

Version 4.46.175 adds `ruflo-learning-persistence` for
[Ruflo #4880](https://github.com/ruvnet/ruflo/issues/4880): a failed native
ReasoningBank flush must not become a successful trajectory or pattern receipt.
It preserves native writes, locking, merge behavior and dirty in-memory learning.
The flush returns an explicit failure without throwing from its timer; trajectory
and native-pattern bridge callers propagate that failure. Four MCP consumers now
honor the trajectory result instead of inferring success from counter changes.
Command execution/storage and learning remain distinct outcomes.

The existing intelligence/persistence status reports process-scoped dirty state
and the last flush outcome; `hooks_intelligence_stats` exposes it under
`ruvllm.patternPersistence`. A fresh process reports no historical flush proof.
In-memory pattern counts are not durable-record counts. This target does not
repair an earlier disk-full write, reconstruct counters, replay learning, restart
an owner, or replace the storage algorithm. Older direct-write packages retain
that upstream behavior; newer native locked merges remain intact. Retirement
requires executable pristine-native failure propagation, timer safety and status
proof, not an issue closure or a package version alone.

Release qualification passed the full regression suite and focused Linux tests.
Installation verified 18 laptop and 24 HZ source files against the qualified
composition, with immutable source and monitor tracking. Native stats reads on
two existing owners succeeded but lacked the new field: those processes still
use cached modules. The original ENOSPC owner is preserved because its pending
learning is unknown. Full live activation and historical recovery remain open;
installation is not permission to replay learning or restart that owner.

## Ruflo 3.71.4 patch review: 5 November 2026

Version 4.46.145 qualifies the published Ruflo/CLI 3.71.4 security release while
preserving its new MCP file-path validation and local-CLI capability boundary.
The owner schema adapter and retained retrieval-error guard accept the new
context-aware handlers; memory statistics continue through that same native path
resolver. The patches preserve upstream SQLite-file, symlink and caller-context
checks. Live installation of 4.46.144 correctly refused the old retrieval-guard
anchor; 4.46.145 adds its exact current signature and mixed-signature refusal.

- Native daemon stop/ownership changes in 3.71.3 are recognized by executable
  retirement proof. Current daemon source remains unmodified by the legacy patch.
  [#4654](https://github.com/ruvnet/ruflo/issues/4654) is closed for the native
  health diagnostics and persistent daemon-stop fix. The opt-in memory-owner
  target remains a downstream forwarding adaptation: pristine 3.71.4 dispatch
  still invokes its local handler rather than the configured persistent owner.
- The selective-learning guard retires on the exact published native refusal for
  unsupported `trajectoryIds` ([#4693](https://github.com/ruvnet/ruflo/issues/4693)).
  Ordinary learning remains upstream-owned; explicit selection cannot become a global cycle.
- Native context guidance and row-identity pagination fixes remain recognized.
  The remaining pagination schema guard, native-owner routing, HTTP session repair,
  pattern-result handling, controller inventory and AIDefence configuration patches
  still cover verified gaps; issue closure alone does not retire these different responsibilities.
- Brain's new publication updates the corpus, not executable source: runtime 4.7.28
  is unchanged. All 16 active Brain targets remain satisfied on Mac and HZ; the
  review of 41 linked issues found no new executable fix requiring retirement.

Qualification includes fresh published-package composition, exact restoration,
native path-security negative tests, daemon ownership, selected-learning refusal,
and the repository regression suite. Package installation and live activation are
recorded separately; no database migration or Brain updater replacement is involved.

Upgrade sequencing must preserve the owner integration: qualify the new package
against every physical claimant, including Brain's resolved CLI, before replacing
live bytes. For each owner, complete the package upgrade, required native dependency
checks, immediate patch reapplication and installed composition proof, then refresh
and verify its clients before proceeding to another owner. Batch replacement during
this rollout left an unpatched interval and caused hook failures; a package version
or an owner restart alone is not proof that the original clients have recovered.

## Research API retirement and hourly probe: 5 November 2026

All five authoritative HZ research MCPs expose 22 methods after Product commit
`4d13f5c`: `search_knowledge` and `read_evidence` have no registration, dispatch or
compatibility alias. Use native memory/controller methods, `search_documents` /
`read_document`, and separate artefact methods. All 60 source connections in 12
loaded Mac/HZ parent sessions were refreshed and verified, along with installed
retrieval instructions. See [ADR-038](docs/adr/ADR-038-live-research-access-through-native-mcp.md).

The hourly source check uses `search_documents`, replacing the retired combined-search
dependency. Its receipt proves fresh document discovery for the configured authority,
with explicit coverage failures; it does not claim a native-memory census or exact
document-body verification. The four existing native health/list/exact-memory checks
are unchanged. The configured HZ AI-BA source probe passed in 1.52 seconds; focused
Python and scheduler tests pass. The existing hourly job reads this checkout directly.

## Shared HTTP session recovery and cleanup: 4 November 2026

Version 4.46.135 removes a redundant release notification in our
`ruflo-memory-owner` patch. The server already marks a negotiated one-call session
complete after its handler settles; a successor initialization can remove that
session before its client sends the additional release, producing HTTP 404/-32002.
This is a downstream cleanup race, not proof of an upstream memory failure or
lost data. Only a received response on a negotiated one-call connection permits
omitting the redundant notification. Transport closure, handshake-failure cleanup,
persistent/legacy release and uncertain-operation protection remain required.

It also fixes a separate persistent-client failure: the shared owner client kept
an expired native HTTP session and failed its next call before evicting the cache.
The native SDK propagates HTTP 404 without reinitializing. The authenticated
server now identifies a missing session with a matching-request receipt that
proves no dispatch occurred. Only that receipt permits one fresh handshake with
the same configured authority. Concurrent callers share the replacement, and
native owner identity, policy and authentication are verified again. Principal
mismatch, ordinary 404, authorization refusal and uncertain execution never
authorize replay. A late old-client failure cannot evict its replacement.

The [deployed repair and retained-client verification](https://github.com/ruvnet/ruflo/issues/3294#issuecomment-6642102681)
are reported upstream under #3294. The affected AIDefence call failed at the
shared session boundary; this is not a scanner defect or an upstream closure claim.

The released 4.46.134 client reproduces expiry failure against native MCP 3.1.6.
The candidate passes expiry, real server replacement, twelve concurrent calls
with one replacement handshake, authorization/identity/cancellation refusals and
lost-response tests. The complete suite passes against the qualified CLI 3.71.1
fixture; default discovery also exposes a separate CLI 3.71.2 pagination anchor
failure reproduced by released 4.46.134.

The immutable `v4.46.135` artifact is installed byte-for-byte in both Mac prefixes
and the HZ global prefix. The five research-project owners on each host and this
repository's Mac owner were gracefully refreshed; native host reloads succeeded.
All 16 Mac and 32 HZ shared session source files qualify, including the affected
project's retained CLI 3.71.0 runtime. HZ monitoring passes. At this activation,
Mac monitoring reports only the separate 3.71.2 pagination compatibility gap.

A retained verification stdio client using the affected project's exact runtime
and preserved scan input succeeded on its first call after a real owner restart,
with the same client process and no harness retry. Native expiry is separately
covered by the regression fixture. The original author connection could not be
called through the host API: it rejects direct input into multi-agent child
threads. This live proof does not claim that original thread was exercised.
The preserved scan returned `safe: false`; transport recovery does not admit its
research content or resume authors. Source-connector refresh and source-specific
read verification remain separately owned activation checks.

## Native alignment and backend readiness: 4 November 2026

Version 4.46.134 adds the plain-search backend reporting fix below and the separate
`brain-grounding-multifile` recurrence repair. The original single-file grounding
target remains retired; its recorded retirement is not reset.

`ruflo-memory-search-report` completes the remaining plain-search response fix
from [#2922](https://github.com/ruvnet/ruflo/issues/2922). CLI 3.71.1 still labels
that response `HNSW + sql.js` even when its native bridge used brute-force cosine.
The target calls the existing upstream `describeBackend()` helper, preserving
native bridge-disabled diagnostics and the separate `smartFallback` warning.
It changes no storage, embeddings, matching, ranking or fallback policy. Tests
execute the published reporter and response block for native cosine, HNSW,
disabled-bridge and unavailable-status cases, plus exact rollback and a corrected
upstream source. Unknown source shapes refuse. A backend label still does not
prove corpus coverage, index freshness or original-resource custody.

Version 4.46.133 withdraws custom behaviour that exceeds bug repair. Qualified CLI 3.71.1 already preserves genuine context outcomes and awaits
both recall interfaces, so `ruflo-context-contract` restores that native function.
`ruflo-tier-consolidation` restores native explicit unsupported consolidation.
The two restorations compose together: the removed local context algorithm had
called the removed tier-copy extension. Historical rows, copies and patterns stay
intact; native synthesis may count separately recalled historical copies separately.
There is no data migration, replay or new deduplication algorithm.

`ruflo-selective-learning` is narrowed to
[#4693](https://github.com/ruvnet/ruflo/issues/4693): the native schema advertises
`trajectoryIds`, but the handler ignores it and runs global learning. A supplied
selection now refuses before mutation; omitted selection keeps native SONA
behaviour. The former ReasoningBank retention algorithm is withdrawn. Known
released overlays remain reversible; unknown sources refuse rather than claiming
native qualification. The guidance-only correction below remains separate.

The npm 12 installation failure matches open
[#2639](https://github.com/ruvnet/ruflo/issues/2639#issuecomment-6636055319).
With npm 12.2.1, a successful install left AgentDB's resolved `better-sqlite3`
without its native binary. AgentDB then failed initialization and attempted
fallbacks; a responding MCP did not establish the intended backend was working.
The scoped global-prefix recovery was:

```sh
npm rebuild --global --prefix <affected-prefix> --allow-scripts=better-sqlite3 better-sqlite3
```

Verify the dependency resolved from its actual owner with an isolated in-memory
native open, then gracefully refresh the owner and verify native health plus the
original operation. This is a global-install command, not blanket script approval
or a project-install policy. No permanent npm setting or database/sidecar changes
were needed. Other optional native features remain separately qualified.
The existing hourly check now rejects initialization errors, unavailable AgentDB
and local ReasoningBank fallback before list/exact reads. Native durable SQLite
tier composition and optional disabled controllers remain valid; SQLite itself
is not a failure. A degraded path is never evidence of equivalent completeness.

## Research synthesis guidance: 4 November 2026

Version 4.46.131 adds `ruflo-context-guidance` for
[#4691](https://github.com/ruvnet/ruflo/issues/4691). The native MCP description,
research-synthesize skill and researcher agent now distinguish ordinary source
evidence from validated task episodes. Only guidance changes: the native handler,
matching, eligibility and no-match outcomes remain unchanged. The full regression
suite passes, including exact rollback and corrected-upstream retirement checks.
Source compatibility covers CLI 3.71.0 and 3.71.1; installation and live host
activation remain separate checks. See the target description below for scope.

Version 4.46.132 completes its public CLI registration, which was missing from
4.46.131. The added regression exercises named install/status/uninstall and
actual `all install` adoption, including installed bytes and tracking state.
Use 4.46.132 or later to activate this target; the earlier composition tests
alone did not establish CLI installation.

## Native HTTP session identity: 4 November 2026

Version 4.46.130 adds `ruflo-http-sessions` for [Ruflo #3294](https://github.com/ruvnet/ruflo/issues/3294)
using the request-local session design in the still-unmerged
[PR #3268](https://github.com/ruvnet/ruflo/pull/3268). Published MCP 3.1.5 and 3.1.6
use one mutable `currentSession` for HTTP clients and omit the session response
header. A retained SDK client therefore receives HTTP 200 with JSON-RPC
`Server not initialized` after server replacement; another client's initialization
can make that first client work again under the wrong shared session.

The patch retains the published 2025-11-25 protocol and native SessionManager.
HTTP requests carry their own native session and authenticated-principal identity;
unknown or expired session IDs return HTTP 404 before dispatch. Missing IDs and
cross-principal reuse are refused. Initialization returns `Mcp-Session-Id`, and
legacy SSE retains its own connection binding. Stdio behavior and existing
completion-aware owner retirement remain unchanged. This is not a protocol-version
upgrade or automatic replay of memory writes.

Existing clients initialized before this correction have no session ID. They need
their owning host's supported reconnect once after activation; installing the
patch alone cannot retroactively give them an ID. Native SDK tests cover separate
principals, interleaved calls, server replacement, fresh initialization and the
existing 105 lost-response retirement cases on both published MCP versions.

Patch mutation waiters also now inspect an existing owner before publishing a
candidate. An isolated one-second wait previously performed 60 needless candidate
writes/fsyncs; it now performs zero. Atomic ownership, dead-owner recovery and
timeout refusal remain unchanged. SessionStart also reuses the existing transforms
and dependency checks for a fresh exact observation of installed composition.
Healthy followers need no mutation claim; changed or unknown bytes still require
the normal exclusive repair. Six concurrent followers are covered by the shared
composition regression suite. This is not a cached health verdict or a change to
monitor/install behavior. Sustained turn-capture capacity remains unresolved.

## Upstream review: 4 November 2026

The 4.46.129 audit retrieved all 136 then-tracked issue states without errors: 107 closed and
29 open. Published Ruflo/CLI 3.71.1 and MCP 3.1.6 were checked against their npm
integrities; Brain remains at the natively selected 4.7.28 generation. Issue
closure and source compatibility are separate from live activation.

- [Ruflo #4674](https://github.com/ruvnet/ruflo/issues/4674) is closed. MCP 3.1.6
  admits new clients at capacity by evicting the oldest non-current session.
  Actual native tests retain the older 3.1.5 refusal check and verify the new
  bounded eviction behavior. This does not supply one-call disposal tokens or
  completion-aware retirement. Under capacity pressure it can evict an older
  persistent allocation or one belonging to a held handler; that handler still
  completes once. The owner protocol remains necessary, without a claim that it
  overrides native capacity eviction.
- At this 4 November review, [Ruflo #4654](https://github.com/ruvnet/ruflo/issues/4654)
  remained open; the 5 November review above records its closure and native fix.
  Native `agentdb_health` now exposes initialization failure and a lock hint;
  this diagnostic does not replace explicit owner routing or resolve daemon
  respawn. All eight owner-patched source files pass exact composition,
  restoration and reapplication checks against pristine CLI 3.71.1.
- The 3.71.1 same-ReasoningBank substring search is retained as native behavior.
  Pattern receipts and guidance remain distinct from the native context and
  consolidation restoration and the selected-learning refusal described above. The entries-only adapter remains
  withdrawn. The published wrapper is already accepted unchanged after its
  executable incomplete-installation refusal passes.
- [Brain #391](https://github.com/stuinfla/ruvnet-brain/issues/391) remains retired
  on native path-specific boot recovery and dependency proof. Closed
  [#425](https://github.com/stuinfla/ruvnet-brain/issues/425) does not revoke the
  operator's completion-feature suspension. No Brain updater or generation
  selection was changed by this audit.

Version 4.46.129 also corrects a gap in the current `ruflo-pattern-receipt`
composition: the native bridge can return a persistence warning after writing,
but the pattern consumer discarded it. The patch now refuses that result before
readback; a readable row does not establish a durable write. The tested native
producer/consumer functions are identical in 3.71.0 and 3.71.1, so this is not a
new upstream release regression. Native success fields, controller behavior and
unknown-write handling remain unchanged. No failed operation is replayed.
Published-source fixtures prove the warning path, exact readback, refusal and
migration from the previous deployed composition.

## Bounded native inventory reads: 4 November 2026

Version 4.46.128 exposes a read-only inventory client through the existing native
owner implementation for `memory_list`, `memory_stats`, and `memory_export`.
The fixed source root/store, native policy, trust and one-call session retirement
remain enforced. Up to four independent reads may run together; closing stops
admission and drains started client calls. Cancellation does not claim that a
server-side handler has finished, and inventory remains non-atomic.

The Product source adapter uses this seam to remove its per-read serialization
while retaining whole-request ordering, complete-corpus admission, byte bounds,
coverage errors and existing timeouts. All settled reads in a started group are
accounted for. Independent native policy/lifecycle tests, 42 Product tests,
23 distinct AI engine tests and three source-integration tests passed. Live
activation completed on Mac/HZ; all 312 packaged files match the immutable artifact,
both patch monitors pass, and the AI BA facade loaded the new reader. Fresh original
A took 52.8 seconds cold, versus 81.1 before batching. Three concurrent original
R1/R5/R7 requests took 23.3/48.1/71.5 seconds including queueing, all with 69 verified
namespaces, no coverage gaps and no cached-response reuse. Native policy receipts
confirm batches of up to four. The expanded hourly source suite passes 53 tests.
These measurements do not clear historical lifecycle failures or research acceptance.

## Composition proof performance: 4 November 2026

Version 4.46.127 checks exact equality with the complete current patch composition
before exploring historical subsets. Historical and unknown compositions still
use the existing exhaustive proof. File discovery, native preflights, mutation
locking and updater behavior are unchanged; there is no cached health verdict.
One sequential HZ diagnostic pair reduced lock-held time from 20.9 to 12.0 seconds,
with 797 unchanged files and no errors in either run. That reduces repeated work
but does not establish that concurrent SessionStart calls can never time out.

## Native inventory pagination: 4 November 2026

Version 4.46.136 recognizes CLI 3.71.2's native row-identity pagination and keeps
its SQL, filters, bindings, embedding cap and row mapping unchanged. Full patch
retirement is premature: the published function reports `total: 3` but returns
an empty page when a nullable user column shadows `_rowid_`. Nonunique shadowing
can also overselect rows. The target reuses its existing schema guard around the
native query and preserves native failure results instead of retrying unrelated
execution errors through the fallback. Older releases retain their exact patch.
Both implementations pass 126 native/sql.js cases, complete static enumeration,
composition and real CLI install/status/uninstall tests. Unknown source changes
still refuse. The complete suite passes with normal 3.71.2 discovery, and the
legacy fixture also passes on 3.71.0 and 3.71.1. The immutable artifact is verified
across all 322 packaged files in both Mac prefixes and HZ's global prefix; all
eight Mac and sixteen HZ pagination files qualify and both monitors pass.
Only two Mac 3.71.2 source files changed at installation. Active HTTP owners retain
their identical, qualified 3.71.1 query bytes, so no further owner restart was
needed. A bounded actual MCP offset-page read passed. The residual upstream
schema gap is recorded on [#4686](https://github.com/ruvnet/ruflo/issues/4686#issuecomment-6641811516).

Version 4.46.126 exposes `ruflo-memory-list-pagination` through the public CLI for
[Ruflo #4686](https://github.com/ruvnet/ruflo/issues/4686). Native listing sorted
large content and embedding payloads before discarding earlier pages. The patch
pages native row identifiers first, then returns the same fields through the same
connection. Filters, counts, limits, metadata and errors retain native semantics.
Views, WITHOUT ROWID tables, shadowed row identifiers and unknown schema metadata
keep the original query. It adds no index, schema change or alternate database driver.

Independent tests exercised 126 native/sql.js cases on both 3.71.0 and 3.71.1.
An isolated 50,000-row fixture reduced a late-page read from 922 to 149 ms;
this is not a live source-search measurement or an atomic pagination guarantee.
Existing native owners require a graceful refresh to load the query correction.
The 4.46.125 tag omitted the public command registration; 4.46.126 corrects that
packaging omission and tests actual CLI install, status and uninstall. It also
recognizes the exact published 3.71.1 wrapper and verifies its
new missing-installation refusal while leaving that upstream wrapper unchanged.

Release 4.46.126 is installed on Mac and HZ, with matching package artifacts and
both monitors passing. The affected HZ AI BA owner was gracefully refreshed; other
long-running owners are not claimed to have reloaded this query correction.
Its live late-page read fell from 4.02 to 1.05 seconds. Concurrent original R5/R7/R1
source requests completed in 34/59/89 seconds including queue time, each with all
69 namespaces accounted for and no coverage gaps. The hourly Sol medium check
also passed its source and four memory checks. Its cold source call took 81 seconds;
a separate request joined that in-flight result, so its shorter wait is not a
second cold-search benchmark. Full-request serialization and cold exports still
cost time; these results do not establish unrestricted concurrency or recovery of
historical hook failures.

## Explicit-store inventory policy: 4 November 2026

Version 4.46.124 corrects duplicate authorization work in our native-owner forwarding
patch. A fixed-store source client and an unpinned owner in the same project previously
evaluated the same request twice: measured policy work was about 1.2 seconds per read.
Only `memory_list`, `memory_stats`, and `memory_export` now qualify when their original,
own enumerable `dbPath` exactly equals the caller's absolute pin and the owner advertises
that selector. Native request reconstruction, trust, identity, approvals, evidence and
full authorization remain unchanged. Other pin mismatches retain their prior path.
Native HTTP tests cover single-use approval and negative routing cases; exact previous
release reconstruction preserves uninstall and upgrade. No timeout or store is changed.
This removed one measured contributor; subsequent pagination and bounded-read
qualifications are recorded above. Already-loaded source clients still require refresh.

## ADR envelope repair: updated 4 November 2026

Release 4.46.167 adds `brain-policy-input` for a separate read-cost defect
([Brain #526](https://github.com/stuinfla/ruvnet-brain/issues/526)). Three shell policies
consume a whole JSON line before truncating to their native inspection limits.
A 900 KB event exhausts their 2-second decision budget on HZ. Count-bounded Bash
reads preserve the same inspected prefix, timeout, policy bodies and refusals;
they bound input consumption using that prefix limit and maximum UTF-8 width.
Mac and Linux regressions cover
open pipes, Unicode and protected-settings refusal. Deployment verified 12/12 files
and 13 trusted Brain hooks on each host. Installed decision-gate probes completed
the ordinary event in 181 ms on Mac and 948 ms on HZ without missing verdicts;
protected-settings events correctly refused in 148/821 ms. These probes dispatched
no application writes. The unrelated Mac npx AIDefence configuration drift remains.
The independent 32/64 KiB inspection limits remain; this does not establish
complete inspection of large content or resolve every historical missing verdict.

The larger envelope exposed a second native defect: `decision-gate` touches
`process.stdin`, then synchronously reads its nonblocking pipe. A caught `EAGAIN`
can become empty policy input; larger inputs also produce `EPIPE` in the parent.
The 4 November correction reuses native `readStdinBounded` asynchronously at the
existing 1 MiB bound. Executable regressions compare complete payload digests and
tail fields through every policy, preserve refusal code 2, and retain explicit
missing-verdict diagnostics for policy errors/timeouts. Native fail-open policy
semantics are unchanged. This repairs input loss; it does not suppress pipe errors
or claim that every historical unattributed `EPIPE` has the same cause.

Checkpoint diagnostics now preserve the store/retrieve stage, attempted and actual
launch, child PID, deadline/elapsed time, terminal code/signal and sanitized failure
category in the existing private bounded capture ring. They do not retain values,
arguments or raw stderr, alter native results, extend deadlines or replay writes.
The 4 November Strategy checkpoint is currently absent at its original exact key;
its complete original value cannot be reconstructed from retained evidence.
Instrumentation makes future failures diagnosable; it does not recover that record.

Version 4.46.122 also qualifies the previous recall and checkpoint contributions
in the shared installer's forward composition proof. Direct in-place tests had
missed that upgrade path; the installer correctly preserved both files when it
could not prove them. New complete-bundle regressions reproduce the refusal,
verify exact migration without rebaselining and retain refusal of unknown edits.
Version 4.46.123 recognizes the same exact diagnostic composition in the retired
native-owner health check. Its inverse/native/forward proof preserves the retired
adapter boundary; runtime executable bytes are unchanged from 4.46.122.

Release 4.46.123 is activated on Mac and HZ: all 309 packaged files match the
immutable artifact, active hook hashes agree, both monitors pass, and the existing
10/16 native owners remain healthy. New native checkpoint checks completed in
1.00/2.08 seconds with exact readback; the original Strategy checkpoint above
remains unrecovered. [Checkpoint diagnostic evidence](https://github.com/stuinfla/ruvnet-brain/issues/518#issuecomment-6628092623)
and [recall qualification](https://github.com/stuinfla/ruvnet-brain/issues/429#issuecomment-6628092258)
are recorded upstream with these limits.

`brain-adr-envelope` repairs the reproduced HZ semantic-ai inspection failure
([Brain #515](https://github.com/stuinfla/ruvnet-brain/issues/515)). The native
shim cut a 112,446-byte edit envelope at 65,536 bytes. ADR's JSON parser then
reported owning-checkout inspection unavailable. The decision transport now
accepts complete envelopes up to 1 MiB, matching the existing child I/O ceiling.
This is a bounded compatibility repair, not arbitrary-size transport support.
Individual shell policies retain their independent content limits; this does not
claim complete security inspection of large edit bodies.

The same large event changed from an ADR skipped-policy warning to code 0.
The owning worktree resolves correctly, its actual `package.json` inspection
returns no stale governors, and an injected stale-governor case still refuses.
The H&M report is a documentation path, which upstream intentionally excludes
from this edit gate. This is not acceptance of the report or its 313 inputs.
Receipts on HZ: `/data/programme-state/memory-recovery-20261102/adr-envelope-before.json`,
`adr-envelope-after.json`, `adr-owning-checkout-verification.json` and
`adr-envelope-trust-hz.json`. Publication workers and project files were untouched.

Version 4.46.89 fixes a downstream installation conflict in 4.46.88: the ADR
shim and managed-memory boundary now share the existing composition owner and
one pristine backup. Exact legacy boundary-only backups are recovered by inverse
and forward composition proof, with their old bytes retained. Regression tests
cover reapplication, drift refusal and independent removal of either patch.

The separate HZ AI policy-runtime mismatch was an existing local lock-wait
change from 5 to 30 seconds, otherwise byte-identical to a previously qualified
native artifact. Version 4.46.90 recognises only its exact SHA-256 after the
existing 5,000-receipt conversion, full audit, append/prune and lock tests passed.
It does not change that runtime, policy state or the timeout. Qualification:
`/data/programme-state/memory-recovery-20261102/policy-qualification/result.log`.

## Learning capture ownership: 2 November 2026

Version 4.46.95 withdraws our AgentDB vector-path policy and the compensating
capture/recall adapters. The patch system repairs upstream bugs; it must not
introduce a different storage or initialization architecture to compensate for
its own mistakes. Exact saved-pristine restoration preserves all existing
SQLite stores, vector indexes, sidecars and unrelated patch contributions.
Unknown or incomplete source provenance refuses restoration.
Version 4.46.183 also recognizes the exact published AgentDB 3.7.2 core. Its
constructor retains native companion/private-temp selection; the only source
change from the previously qualified core awaits asynchronous backend close.
Constructor and shutdown tests cover that version without changing installed
AgentDB code, storage paths or existing data. Unknown source hashes remain refused.
Activation verifies all 367 package files per prefix, no stable-engine drift on
Mac/HZ, and 28 unchanged native source files. All 146 code suites now pass;
seven unchanged Markdown findings in private evidence files remain separate.
The 4.46.95 follow-up distinguishes a sibling capture edit from the old recall
rendition when proving the existing shared bridge before restoration.

The causal control reproduced the problem in our vector-path override. A second
isolated integration control restored upstream AgentDB storage defaults and full
ControllerRegistry initialization: a long-lived native bridge owner and a fresh
CLI writer shared one synthetic SQLite store successfully, persisted a
384-dimensional embedding, and retrieved/searched the new row in 821 ms. An
actual turn capture with that restored code also passed exact readback. This is
ordinary-memory integration evidence, not proof of shared ANN index semantics.

`ruflo-memory-entries-only` retains its old name for rollback compatibility but
no longer creates an alternate database/embedder adapter or disables controllers.
Its only surviving runtime change propagates an existing `memory_retrieve`
failure instead of returning a healthy absence. `brain-learning-native-owner`
and `brain-recall-runtime` now restore native learning/checkpoint/recall code;
their old transforms exist only for exact historical reconstruction. Both known
HZ checkpoint modifications are removed, never reapplied. This also removes
the scoped-to-full-registry re-entry inconsistency after embedded writes.

The independently reproduced bounded ADR-envelope repair and native capture
budget override remain; explicit operator timeout settings remain authoritative.
WAL refusal, database identity, scratch preservation and exact-readback safeguards
remain in place. No historical observations are replayed and no programme is
resumed by this release.

Monitor/status now use installation's exact composition check for shared CLI
files and transaction-owned files. This proves derivation from a saved baseline;
it does not authenticate that baseline against upstream. ADR-001,
ADR-006 and ADR-016 record these decisions. Ruflo issue
[#4666](https://github.com/ruvnet/ruflo/issues/4666) carries the corrected downstream
attribution. Private evidence is under `.local/memory-recovery-20261102/review/`,
including `native-concurrent-capture.json`, `native-hook-before-deploy.json` and
`final-review.json`. Previous containment receipts are historical evidence, not
acceptance of this release.

After v4.46.95 activation, fresh native turn capture and exact readback passed
in all 25 enumerated Mac and 21 HZ canonical checkouts. AI Strategy also passed
fresh native checkpoint, configured user-learning capture/readback and ordinary
recall on both hosts. These probes establish those operations, not recovery of
historical failed writes or universal absence of intermittent failures. Receipts:
`v495-fleet-capture.json` and `ai-native-v495.json` in each host's recovery directory.

Version 4.46.96 adds `brain-capture-diagnostics` for independently reproduced
[Brain #518](https://github.com/stuinfla/ruvnet-brain/issues/518). The existing
failure ledger retains bounded project/store/session/expected-key hashes in
deduplication and repeated rows. Existing checkpoint and capture callers supply
the identities they actually know, including across detached children; unknown
identity stays absent. Checkpoint stderr uses the native capture redactor while
cancellation, timeout and terminal status remain visible. There is no new memory
driver, queue or replay. Native observation shedding at two occupied slots and
the ledger's 64-window/256-KiB bounds remain unchanged. Existing unattributed
historical rows cannot acquire identity retroactively. Retire this target when
the native scope, repeat, terminal-diagnostic and privacy behaviour is verified.

Version 4.46.97 repairs three downstream CLI defects from the one-by-one audit.
The root resolver cached a relative argument across working-directory changes;
its cache now uses the resolved absolute path. The plain SQLite integrity check
rejected Ruflo's native `RFE1` encrypted format; native format detection and
authentication now retain ownership, while WAL and corrupt-plaintext refusal
remain. Finally, the native parser normalizes `--native-only` to `nativeOnly`,
but our forwarding read the kebab-case spelling. Tests now use the actual parser,
native encryption functions, real cwd changes and exact historical compositions.

The fresh HZ hook timeout exposed another downstream source deviation: four
`session-snapshot-hook.mjs` copies and their saved baselines selected inline
learning (`detach: false`). The published Brain 4.7.28 tag, current upstream
source, Mac and HZ's Console copy all select `detach: true`. Inline execution
puts the six-second capture budget inside Codex's four-second wrapper; it is
not evidence that Ruflo needs a new initialization or a larger timeout.
The exact altered baseline and live composition are archived before restoring
the verified native route and its uninstall baseline. Unknown bytes refuse
repair. Transcript evidence identifies the initial BA repair command at
13:28:10 UTC on 2 November: it edited the installed shared descriptor and applied
`detach: false` to four Brain surfaces, completing at 13:28:15. Product later
restored that row at 13:39:53 under explicit BA delegation. This was an in-place
package edit, not an evidenced Git change. The verified native route is restored;
this recovery changes no timeouts, consent, admission limits, databases or updates.

After 4.46.97 activation, the actual Codex PostToolUse entry point returned in
174 ms in the affected HZ worktree, followed by detached acknowledgement and
exact native readback in 3,117 ms overall. The HZ canonical user-scope path
passed in 3,044 ms (142 ms foreground); Mac also passed. Both monitors and the
full regression suite pass. These bounded probes do not establish that every
historical or intermittent timeout has the same cause. Receipts:
`posttool-v497-affected-worktree.json`, `posttool-v497-canonical.json` and
`native-route-v497.json` in the HZ recovery directory above.

Version 4.46.98's follow-up audit distinguishes residual defects from previously
authorized policy. The plugin-only `init` policy remains as explicitly decided
in ADR-022; it is not evidence that every native initialization path is broken.
Context eligibility and verified consolidation lineage remain because native
input still accepts conflicting representations and duplicate outcome keys.
The empty-recall path now retains native failure semantics and skips synthesis.

Modern ADR scripts retain their upstream resolver and read verifier. Native
Codex selectors retire only the unused projections they supersede: eight
reviewed surfaces per host, with 46 other projections still required. Generated
instructions defer workspace isolation and release authority to the caller.
The managed-memory refusal covers both project store names without expanding
the legacy diagnostic exception to native controller stores. Brain 4.7.28's
grounding helper and its shared entrypoint passed 44 isolated native cases;
the grounding patch remains retired.

Version 4.46.99 retires the blanket release-equality overlay on qualified
modern Brain doctors. Current native ADR-089/098 distinguish installed
search/runtime integrity from advisory currency and proven open-session lag.
The proof executes reviewed native classifiers, their actual check adapter and
complete check expressions, and the native verdict reducer against bounded
46 identity and host-state assertions. Damaged or stale identity still fails; coherent
ahead versions and supported advisory states retain native behavior. Mutation
tests reject an always-successful adapter or an identity failure downgraded to
a warning. Exact historical restoration preserves sibling patches and pristine
sources. Unknown helper bytes refuse qualification, and legacy sources retain
their issue-specific repair. No updater, KB, host-state or version data changes.

Version 4.46.98 activation passed on Mac and HZ: both monitors reported no drift
and native hook trust had no pending approvals. Doctor qualification remains
separate from live host activation and does not reload long-lived MCP sessions.
Version 4.46.99 activation then removed the equality overlay from all three
current Brain installers on each host, preserving the Console sibling repair.
HZ's separate legacy installer retains its original repair. Both installed
preflights and monitors passed, with no pending native hook approvals. The full
regression suite passed; all 278 packaged files matched the immutable release
tag. Live receipts are `native-doctor-active-v499.json` in each recovery directory.

Version 4.46.100 distinguishes a failed or unavailable exact read from
readable conflicting content ([Brain #518](https://github.com/stuinfla/ruvnet-brain/issues/518)).
One append-only attempt and strict exact-value readback remain unchanged. Missing
one half of the ADR shim/decoder pair now makes preflight incomplete before edits.

The new `brain-capture-launch` target addresses
[Brain #519](https://github.com/stuinfla/ruvnet-brain/issues/519): failed child launches
could consume both native observation slots and leave later healthy observations
shed. Only proven pre-spawn failures release demonstrably owned admission. An
exclusive ephemeral pending token distinguishes overlapping attempts; existing or
ambiguous markers retain native expiry. Spawned children and uncertain writes are
preserved. Native two-slot admission, shedding, consent, exact acknowledgement and
no-replay behavior remain. Tests cover synchronous launch exceptions, real asynchronous
ENOENT, both same-key overlap orders, replaced files and post-spawn errors.

Release 4.46.169 extends the existing capture diagnostics for
[Brain #521](https://github.com/stuinfla/ruvnet-brain/issues/521): preliminary-read,
store and confirmation-read timing, effective step budget, terminal status and
exact-match booleans share the existing bounded private snapshot. Observation and
response text are excluded. Consent, limits, call order and failure outcomes are
unchanged. This is diagnostic coverage, not an admission-timeout fix. Both hosts
verify all eight intended files and 13 trusted Brain hooks. The first natural HZ
capture measured a 2.304 s preliminary-read timeout, 4.310 s duplicate-store
refusal and 1.522 s successful exact confirmation: 8.156 s total slot occupancy.
Two pre-existing suite fixture failures and unrelated Mac npx AIDefence
configuration drift remain; neither is represented as repaired.

Version 4.46.101 adds `brain-capture-idempotency` for
[Brain #520](https://github.com/stuinfla/ruvnet-brain/issues/520). The native turn key
excludes capture time, while its value includes the current timestamp. A retry of
the unchanged transcript can therefore conflict with its own earlier committed
record. After a native append-only duplicate and one successful exact read, the
repair reuses the original committed timestamp only if the unchanged native record
constructor reproduces both requested and stored values completely. It preserves
raw piped readback bytes, including whitespace, and reports `alreadyRecorded`,
`committedAt` and the committed value's SHA-256. Original content is never overwritten;
changed rendered actions or other fields still fail. No queue or history replay is
added. Constructor mutation, failed reads, altered content, overlapping attempts,
composition and exact restoration have regression coverage.

Release 4.46.119 adds the lifecycle correction for [Brain #513](https://github.com/stuinfla/ruvnet-brain/issues/513)
reuses one bounded process for the native store and exact readback, preserving
both authorization decisions, all append controls and full readback bytes. It
retains terminal read errors and phase timings. With less than 2.6 seconds left,
a fresh first attempt uses one of two independent metadata-only worker leases,
stdin handoff and an absolute 30-second deadline. The parent reports pending;
only the child's exact receipt proves persistence. Native consent, canonical root,
privacy and encryption checks run again before dispatch. Prior attempts
with retained receipts or same-turn state are reconciled by reading only. Fresh
synchronous writes publish pending metadata before dispatch. Native evidence is
bounded, and concurrent first attempts retain native append-only collision checks. Capacity
exhaustion and unavailable evidence still fail explicitly. This addresses the
Claude SessionEnd 1.2-second budget without increasing that host deadline.

Release 4.46.163 corrects that handoff's shutdown-burst refusal: up to eight
first-attempt children may hold payload-free pending leases, while only two
execute native store/read operations. Children wait in admission order for at
most 60 seconds; native execution remains capped at 30 seconds and the whole
handoff at 90 seconds. The parent still returns promptly. Turn bodies travel
only over stdin and stay in child memory. Existing execution leases, live or
unknown owners, consent, exact readback and read-only reconciliation remain
authoritative. Excess admission, expired waits and process failures are visible;
this is not a durable queue or a historical replay facility. Eight-child burst,
two-write concurrency, old-worker coexistence, deadline, crash, composition and
exact reversal tests cover the change. Upstream: [Brain #513](https://github.com/stuinfla/ruvnet-brain/issues/513).

Activated on Mac and HZ on 7 November 2026: four capture copies per host are
patched and all 344 stable library files match release 4.46.163. The deployed
helper passes the eight-child test on both hosts with an inert persistence seam;
separate natural HZ captures retain successful native store/exact-read receipts.
Historical missing records remain missing and were not replayed. The full suite
retains its pre-existing tier-consolidation and cwd-session-current fixture
failures; Mac also retains its unrelated AIDefence configuration anchor drift.

The accompanying [Brain #521](https://github.com/stuinfla/ruvnet-brain/issues/521)
repair retains two observation workers while at most eight existing hooks wait
for admission. Seven seconds is the upper bound; native Codex and inherited
budgets, process age and cleanup reserve can shorten it. Actual overload remains
an explicit refusal. A budget-qualified native exact read now skips the store for
a durable duplicate. Fresh observations may incur one extra read; short inline
budgets skip that optimization. Waiting metadata contains no observation payload,
and there is no durable queue or uncertain-write replay.

Version 4.46.120 additionally recognizes the exact read-first composition in the
retired learning-adapter health check. Unknown edits remain drift, and the retired
adapter is never reinstalled. This follow-up changes no capture executable bytes.

Activation on 3 November: immutable `v4.46.120`, commit `4f22132`, is live on
Mac/HZ. All 307 installed package files match the release artifact; both monitors
report no drift and all 10/16 owners remain healthy without restart. Actual installed
SessionEnd entrypoints returned in 73/103 ms under controlled 350 ms response
pressure, followed by exact turn receipts. The original BA value remains unchanged.
Full tests and independent reviews passed. [Upstream evidence](https://github.com/stuinfla/ruvnet-brain/issues/513#issuecomment-6615446798).

Version 4.46.101 is published and activated on both hosts; all 280 packaged files
matched its immutable tag. The actual failed BA turn then passed the installed
shared writer in 1,736 ms: one append-only duplicate refusal, one exact read,
`alreadyRecorded: true`, and the original timestamp and complete 1,876-byte value
preserved. Stop dispatch exercised that writer without launching SessionEnd
distillation. Both monitors passed and native hook trust had no pending approvals.
The full test run passed every suite except one inherited-cwd isolation case; that
test was corrected to use its own sandbox, and the affected suite passed in full.
No diagnostic stores were removed to make a test pass. Private activation proof is
`release-v4.46.101/activation.json` under the recovery directory.

The loaded-session follow-up verified all three local and nine HZ parent sessions:
each returned a one-entry inventory and exact retrieval. HZ's native host refresh
changed only an inert user-level Ruflo registration stamp, preserving project
bindings. BA's existing connection moved from 3.65 to 3.66 and retrieved the original
failed turn's full 1,876-byte value with the same digest as the native backup. Query's
existing connection also reproduced its producer's exact 167-byte checkpoint.
These are bounded read proofs, not replay or application-delivery acceptance.
The runtime inventory is mixed: two local sessions and the home HZ Builder report
3.71; the remaining one local and eight HZ sessions report 3.66. No uniform-upgrade
claim is made. Private receipts are in `release-v4.46.100/` under the recovery directory.

Version 4.46.102 extends `brain-capture-launch` for
[Brain #521](https://github.com/stuinfla/ruvnet-brain/issues/521). Two simultaneous
calls for the same observation could pass the in-flight check, occupy both slots
and shed a distinct observation. A caller that loses exclusive pending-marker
creation to a fresh owner now coalesces and releases its redundant slot. It does
not acknowledge persistence. Native child execution, consent, exact readback,
failed-launch cleanup and the two-slot limit remain unchanged. The released #519
composition still upgrades and uninstalls through exact byte reconstruction.

Fifty controlled interleavings and 15 parallel worker-thread trials exercised
the actual capture functions with disposable marker files and inert child
launches. The distinct observation was admitted in all five candidate trials,
versus none of ten native/previous-patch controls; every over-capacity case still
refused. These are admission tests, not production throughput or database-write
proof. The repair covers fresh-marker contention and preserves stale renewal;
it does not eliminate every simultaneous stale-renewal race or shedding during
bursts of distinct observations. Private receipts are `capture-coalescing-race.json`
and `capture-coalescing-parallel.json` under the recovery review directory.

Version 4.46.102 is published and activated on Mac and HZ. All 280 packaged files
match the immutable tag, and all four discovered capture surfaces on each host
pass exact patch recognition. Both monitors pass, with no pending native hook
approvals, including HZ Semantic AI. Brain remains on its native 4.7.28 generation.
The release passed all 108 regression suites and Markdown validation of 57 files.
One fresh diagnostic PostToolUse observation passed detached acknowledgement and
exact readback from the consented user store on each host: Mac's source-patch
checkout returned in 172 ms (1,767 ms overall); HZ Semantic AI returned in 224 ms
(4,039 ms overall). The initial HZ source-patch probe stopped before hook execution
because learning consent was disabled; that consent was preserved.

Credential files, active-generation selection and unrelated Codex settings matched
their pre-activation evidence. The local model catalog cache refreshed during the
observation window; its writer was not attributed, and no model selection changed.
No historical turn was retried. These bounded probes do not resolve the separate
Ruflo 3.71 ownership or automatic-recall investigations. Private receipts are under
`release-v4.46.102/` in each host's recovery directory, including `activation.json`.

## Capture ownership: 3 November 2026

The `brain-capture-launch` extension for
[Brain #521](https://github.com/stuinfla/ruvnet-brain/issues/521) addresses three
independently reproduced races in native 4.7.28: stale pending renewal could
admit the same observation twice, stale slot takeover could replace a fresh
owner, and acknowledgement pruning could delete a renewed pending marker.
These findings do not establish that a particular historical warning lost data.

One capture-private gate serializes metadata changes. It uses populated-directory
publication and exclusive takeover claims adapted from native ownership code,
without importing or changing the updater. Reclamation requires a proven dead
owner; time alone cannot evict a live or unknown owner. Admission tokens protect
pending records, slot handoff and cleanup. Detached children must adopt the
matching token before writing. The gate is released before spawn and persistence;
contended or unverified ownership fails visibly within a bounded attempt.

The two slots bound authorized observation work. A parent-death race can briefly
leave an unadopted child process alive, but a replaced token cannot authorize its
write. Native consent, fixed observation vocabulary, immutable writes and exact
readback remain unchanged. Distinct observations can still be refused at capacity.
There is no queue, replay, capacity increase or change to Brain's update plane.

The earlier #519 and #521 transforms remain available solely to reconstruct and
upgrade or remove their exact released compositions. Unknown edits remain refused.
Release 4.46.166 gives the optional duplicate read up to
2 seconds of the existing 14-second child budget, while reserving both original
6-second store/readback steps. The former 1-second cap could time out during CLI
startup and make an already durable observation consume another store/readback
cycle. Only an exact complete-value match avoids the write. Missing, conflicting
or unavailable evidence retains the strict native insert and verification path.
This does not increase admission capacity or recover historical missing values.
Activation requires old capture executables to drain naturally; patch installation
alone does not prove that every process is using the new ownership protocol.

Version 4.46.105 qualification passed 111 regression suites and an independent
review of the three original real-process races. Focused checks also cover killed
reclaimers, delayed handoff, lost tokens, consent withdrawal and partial metadata
writes without truncating the previous owner. The current repair passed its
lifecycle and real-process suites on both Mac and HZ. Linux exposed a timestamp
assumption in the retained legacy test; that fixture now deliberately changes
identity, while a new current-version regression freezes inode/timestamp observations
and proves that token ownership still preserves a replacement. Historical patch
bytes remain unchanged. These tests qualify the repair, not production throughput.

Release 4.46.105 is activated on Mac and HZ. All 284 packaged files per host
match the immutable tag; all four discovered capture surfaces per host match the
independently reviewed source. No old hook/capture processes remained at the
post-install drain check. Fresh native captures returned in 5 ms locally and
4 ms on HZ, acknowledged in 1,216 ms and 2,008 ms respectively; exact MCP reads
then verified both complete values from their configured learning stores.
Both monitor checks passed and native hook trust had no pending approvals.
Credentials, active Brain selection and unrelated configuration were unchanged.
The local Codex model catalog cache changed during the observation window; its
writer was not attributed. No historical observation was replayed or existing
coordinator/MCP transport stopped. Private proof is in
`release-v4.46.105/activation.json` under the 3 November recovery directory.

## Recall owner reuse: updated 4 November 2026

The 4 November repair bounds the `turns` namespace list to one entry when recall
uses it only to establish presence. Namespaces used for checkpoint selection
remain complete, including a project whose checkpoint namespace is `turns`.
Native authorization, initialization, ranking and exact reads are unchanged.
The Product fixture returned the same selected evidence while the live turns
response fell from 1,275 rows / 379,921 bytes to one row / 326 bytes. Actual stdin
hook runs returned identical output and confirmed reader retirement. Their
4,689 ms and 3,444 ms timings were observed under varying load, not a controlled
speedup. The temporary 20-second deadline remains; the original 1,900 ms deadline
still failed under diagnostic concurrency. This reduces unnecessary enumeration;
it does not resolve every source-facade or lifecycle timeout.

`brain-recall-owner-reuse` extends the existing Brain reader for
[Brain #429](https://github.com/stuinfla/ruvnet-brain/issues/429). The native hook
starts a reader and a separate semantic-search CLI; both initialize the native
registry and embedding/vector runtime. The HTML-request incident reproduced
search deadline misses both before result emission and during CLI retirement.
Tracing itself increased latency, so untraced controls are retained separately.

Release 4.46.170 also reuses that reader for exact `workflow-*` observation reads
in `learning-observations` ([Brain #521](https://github.com/stuinfla/ruvnet-brain/issues/521)).
It calls the installed public `getEntry` with the same explicit database, key and
namespace. The reader drains accepted requests and flushes responses before EOF
exit. Strict stores remain on the original CLI; consent, step deadlines, native
authorization and exact comparison remain unchanged. A failed native read returns
to the original capture logic without an extra CLI retry. Unsupported executable
qualification or reader capability retains the CLI before dispatch, within the
original deadline. Isolated tests reproduce the old premature EOF
exit and verify delayed/large responses, refusal, timeout, composition and unchanged
writes. Deployment verified all 16 bundle files and 13 trusted Brain hooks on
each host. Natural HZ duplicate captures took 1.01 to 1.76 seconds with whole-value
confirmation; sampled new writes took 2.82 to 3.53 seconds including confirmation.
Two sampled preliminary reads still hit their two-second deadline, then confirmed
the existing value through the unchanged strict-store path in 3.90/4.52 seconds.
These are observations under varying load, not a controlled benchmark or proof
that all admission failures are resolved. A subsequent native reconciliation found
nine reported logical observations exactly present: seven in their project stores
and two in the configured user-learning store. Complete raw values matched the
unchanged native deterministic constructor; creation/update metadata predated the
reported failures. No writes were replayed or hook acknowledgements changed.
This resolves persistence uncertainty for those nine records, not the original
failed invocations or every historical key. Scoped evidence was delivered to the
responsible roots; the admission investigation remains open.
Release 4.46.172 qualified the Mac npx native AIDefence configuration and refreshed
the observed Mac clients. Its full suite retained two failures, addressed in
4.46.173: an unsupported historical owner source shape threw during exact sibling
composition proof ([source-patch #4](https://github.com/sparkling/ruflo-source-patch/issues/4)),
and the session-hook fixture omitted the native `realpath-containment.js` dependency.
The owner matcher now returns its existing unsupported-shape diagnostic; exact
sibling provenance can still be proved, while foreign bytes remain refused.
This changes patch qualification, not the emitted memory-owner runtime or capture
admission behavior. The full protected suite passes. Deployment exercised the
installed matcher on both hosts and verified unchanged owner source bytes across
54 Mac and 72 HZ files; composition reapplication changed zero vendor files.

A further admission expiry at 23:03 UTC on 7 November confirms recurrence remains
open. Its logical observation also matched an exact native user-store read; the
owning root received that scoped evidence without a write replay. A separate
digest-correlated probe measured 1.44 ms in the memory handler and 418.98 ms in
authorization. Pristine 3.72.2 anchor components reproduce the remaining scaling:
at 100,000 anchors, full assessment took 186 to 193 ms and append/fsync 236 to 245 ms,
revalidating every prior entry. These are component measurements, not a lifecycle
benchmark. [Ruflo #4883](https://github.com/ruvnet/ruflo/issues/4883) tracks this
remaining history cost separately from the closed receipt-retention issue; no
authentication bypass or new history format has been deployed.

The patch secures curated exact reads first, then calls the same published
`searchEntries` function through that reader for its exact store. Native
initialization, database authority, embeddings, scoring, the 1,900 ms ceiling,
search allocation and retirement reserve remain unchanged. Missing search
capability and different-store requests retain the native CLI route. A timed-out
shared search retires the whole owned process group; verified curated evidence
remains available and unconfirmed retirement is reported as unavailable.

The 3 November follow-up adds private lifecycle diagnostics for intermittent
`Search unavailable child retirement` warnings. Receipts record invocation and
hashed project/store/session identity, reader PID/process group, phase timings,
operation deadlines, exit/close events, termination attempts and the retirement
check's observed result. They contain no prompts, queries, keys, memory values,
raw stderr or environment. Storage is bounded to 64 failure slots plus one latest
success under `~/.ruflo-source-patch/hook-failures/recall`, with private permissions
and bounded events/bytes. Diagnostics do not enter the shared warning ledger or
change the recall deadline, search allocation, retry policy or retirement verdict.
A warning records an unconfirmed deadline-bound check, not proof of a surviving
reader. Deterministic refusal and delayed-close tests must retain that distinction. Release **4.46.107**
is installed on Mac and HZ with both monitor checks passing. Actual Strategy hook
runs completed in 998 ms and 1,105 ms with observed reader closure and absent
process groups. Private proof is in `release-v4.46.107/activation.json` and
`recall-diagnostics/strategy-live-receipt.json` under the 3 November upgrade
directory. The intermittent historical cause remains unproven; these receipts
verify instrumentation and successful current calls, not a root-cause repair.

This is not the withdrawn entries-only adapter: no controller, vector-path or
backend policy is introduced. The three source files compose atomically with
scratch preservation and retain exact reversal. Uninstall explicitly includes
removed owners in provenance, with exact saved-to-live proof, so a surviving
retired target cannot adopt removed edits as upstream source. Private qualification established
identical four-row CLI/API results and a full-hook HTML recall in 1,235 ms with
one confirmed-retired reader. These bounded checks do not guarantee that any
finite deadline can succeed under arbitrary host load.

Version 4.46.103 was installed on both hosts. The exact HTML request passed through
the installed HZ hook in 1,153 ms; a separate structured call passed in 1,055 ms,
with one reader and confirmed process-group retirement. Local checks also passed.
The monitor then exposed a retired #514 health check that did not recognize the
new exact sibling composition. Version 4.46.104 adds that composition proof in the
shared owner, preserving the retired adapter's markers and historical reversal.
Both hosts now run 4.46.104 from the immutable tag, with all 281 packaged files
verified against it. All 12 recall files per host remain byte-identical to the
qualified 4.46.103 runtime. Both monitor checks pass with no drift, and native
hook trust has no pending approvals. A fresh HZ call with the exact HTML prompt
passed in 980 ms without a search warning. Credentials, active-generation
selection and unrelated settings matched their pre-activation snapshots.

The initial full test run exposed the new uninstall regression; after repair,
all 37 affected composition suites and the focused lifecycle, withdrawal and
combined-health checks passed. Private activation evidence is in
`release-v4.46.104/activation.json` in each host's recovery directory; the
byte-identical runtime's structured one-reader proof remains in the 4.46.103
receipt. No historical observations were replayed.

## Patch review: 3 November 2026

The fresh review covers all 10 CLI and 60 plugin targets. It classifies all 75
current CLI contributions: 54 apply, nine are
native-satisfied and 12 are inactive historical variants. Two withdrawn entries
are tracked separately. All 44 composed files parse. The Brain matrix covers 39
targets: 25 retired, nine still needed, one native-qualified compatibility target,
two owner-policy exceptions and two restoration-only targets. Fourteen active
Brain targets pass on both hosts. No new upstream fix justified another retirement.
Native satisfaction of one contribution does not retire a multi-contribution target.

Version 4.46.106 repairs two stale verification assumptions. Native hook-schema
proof accepts the current nine-handler event/command structure, while the old
invalid-header transformation still requires its exact seven-handler shape.
The isolated hook proof waits a bounded interval for detached telemetry. Codex
plugin discovery retains its deadline and JSON validation but permits up to
16 MiB of output: the measured current registry is 4,643,961 bytes, exceeding the
previous 4 MiB bound. These changes do not alter native hooks or reopen retired
targets. All 113 regression suites pass; the two new suites and actual native
retirement proofs also pass on HZ. All 259 executable source files parse.
An inactive historical `ruflo-agent/0.3.4` copy still lacks pristine
provenance for a fresh MCP-prefix proof; it was neither deleted nor reactivated.

Private review matrices are retained in
`.local/memory-recovery-20261102/review/ruflo371/cli-patch-review-20261103.json`
plus `.local/memory-recovery-20261103/review/patch-audit-brain.json` and
`.local/memory-recovery-20261102/review/ruflo371/patch-audit-plugins-current.json`.
The registry-to-review coverage check is `.local/ruflo-upgrade-20261103/review-coverage.json`.
Release 4.46.106 is installed and activated on Mac and HZ. All 284 packaged files
per host match immutable tag `v4.46.106`; both monitors report no drift, and the
actual installed-plugin retirement proofs pass. Activation preserved the existing
native executable composition (501 local and 558 HZ files already correct).
Existing MCP processes were not restarted; stale loaded sessions reported by the
monitor remain a separate controlled-reconnect task. Credentials, Brain active
selection and unrelated configuration were unchanged. The local Codex model
catalog cache changed concurrently; its writer was not attributed.
The activation receipt is `.local/ruflo-upgrade-20261103/release-v4.46.106/activation.json`,
mirrored under `/data/programme-state/ruflo-upgrade-20261103/release-v4.46.106/` on HZ.
Source compatibility and patch health are separate from the blocked Ruflo upgrade
below.

### Causal review and withdrawal activation: 3 November

The follow-up also corrects our own MCP binding overlay: a caller's explicit
`dbPath` that conflicts with `CLAUDE_FLOW_DB_PATH` must fail before dispatch,
instead of silently returning or changing the configured store. Matching normalized
paths and omitted paths retain their existing behavior. The regression covers all
six bound operations, initialization status, both released overlay migrations,
pristine preservation and repeat installation. This is a downstream authority fix,
not a resolution of the separate native concurrent-owner failure in #4654.

A matched eight-run control separates our earlier defect from the pending upgrade.
CLI 3.66 / memory 3.1.0 / AgentDB 3.0.0-alpha.20 and CLI 3.71 / memory 3.2.2 /
AgentDB 3.3.0 were each tested with pristine npm package source and current CLI
patch contributions, using both shared and separate caller working directories.
Both 3.66 compositions retrieved the exact record; its shared-directory contender
used native RVF fallback, so this is not shared RuVector-index ownership proof.
Both 3.71 compositions refused the concurrent contender; each first owner and
post-exit reader retrieved the same value. Current CLI patches did not flip that
result. The former backend-only control used separate working directories and
therefore proved separate native indexes, not concurrent ownership of one index.

Our withdrawn vector-path policy nevertheless remained loaded in five processes.
Installed source was clean, but their open descriptors retained its exact
`.db.ruvector.db` companions. This was an incomplete activation of our withdrawal.
The Mac and HZ user-memory services, Mac OPDA Browser transport and HZ Product
knowledge owner were refreshed through their native owners. User-memory HTTP
clients required native host reconnection after `Server not initialized`; only
transport-generation metadata changed. OPDA Browser's project configuration was
restored byte-for-byte. Product's parent drained before its native children exited.

Exact user/project records remained unchanged. Product's exact evidence and all
ten native namespace inventory checksums match their pre-refresh values. All six
former index files remain present and nonempty; zero withdrawn-path descriptors
remain among 53 inspectable Ruflo MCP processes. One independently owned HZ
container process denies descriptor inspection and is outside this verification.
No direct database/index access, sidecar manipulation or historical replay was used.
The initial Product health probe used its former unauthenticated route and received
401; authenticated health passed without another restart. Expired source references
were re-established through the facade's normal search/read contract.

Private evidence: `.local/ruflo-upgrade-20261103/attribution/matrix.json`,
`causal-vector-refresh-final.json` and `reconnect/product-proof.json` under the same
upgrade directory. The matched result and its qualifications are also recorded in
[Ruflo #4654](https://github.com/ruvnet/ruflo/issues/4654#issuecomment-6583536255).
This closes the confirmed stale-policy activation defect; it does not qualify the
still-failing 3.71 upgrade or prove arbitrary cross-backend index consistency. The
independent follow-up found no verified narrow patch enabling unchanged native
MCP and Brain CLI callers to share the persistent owner. That review identified explicit CLI/Brain owner selection and lossless immutable-write
semantics as the remaining integration gap. The following native-owner qualification
addresses that gap; alternate fallback files or bypassed vector initialization remain
unqualified.

### Native owner routing qualification: 3 November

Release 4.46.118 corrects duplicate policy evaluation in eligible MCP forwarding.
The caller uses native request construction without consuming an approval; the
owner independently reconstructs and compares that request before its one native
policy decision. Eligibility requires the same canonical working directory,
database pin and native policy/trust roots, the default legacy principal, and
native default server/environment. Metadata supplies consistency evidence and
approval/evidence inputs to native verifiers; it cannot grant identity or select
a different policy environment. An old or incompatible owner refuses before
accounting or operation dispatch. Refresh owners before persistent clients.

Constrained identities/envelopes, distinct roots, nondefault environments and
provenance alias normalization retain the prior authorization path; their double
evaluation is not claimed fixed. Ordinary public-memory CLI calls already have
one owner decision. Native receipt retention, full anchor authentication, audit,
unknown-outcome handling and temporary timeouts remain unchanged. Retire this
correction only when native forwarding passes the same authority-equivalence,
single-decision and adversarial audit proofs. The native
monetary/token budget refusal for missing meters remains; no cost is invented.
Qualified HTTP/SDK tests cover single-use approval, concurrent context isolation,
forged authority/evidence, policy denials, old-peer refusal and full ledger audit.

Policy diagnostic snapshots now distinguish `owner` and `owner-coalesced` and
report bounded `queueWaitMs`. Capture admission adds bounded private timing
snapshots in `~/.ruflo-source-patch/capture-diagnostics`: 128 routine overwrite slots
and, from 4.46.174, 32 separate failure slots, at most 32 events and 16 KiB per
snapshot. Terminal failure metadata survives the event cap. Routine traffic cannot
overwrite failure samples; failures can still collide with other failures, so this
is bounded diagnostic evidence rather than a complete incident ledger.
`RSP_CAPTURE_DIAGNOSTICS=off` disables
emission. Timings cover existing admission waiting/holding, adoption, pruning,
slot operations and native exact/duplicate outcomes. They do not add a queue or
change native two-slot capacity; overwritten samples and killed invocations
cannot establish loss counts. Logging is observational and contains no payload.
The separate failure slots address the lost diagnostic evidence from the
7 November 23:17 admission-expiry burst; they do not repair or replay that burst.
Retire this extension when native diagnostics provide the same bounded failure
retention and terminal-reason proof. Exact previous compositions remain reversible.
Release 4.46.174 passed the full protected suite and focused Linux checks. Both
hosts verified eight exact installed capture/learning files and all 13 trusted
Brain hooks. Isolated execution of the installed scripts retained a failure across
140 colliding healthy samples; fresh natural captures also completed exact reads.
No natural post-deployment failure was observed in that bounded sample, so the
underlying admission-expiry investigation remains open.

The 5 November R5 restore trace reproduced a separate interaction with this
forwarder: parallel namespace reads establish separate one-call MCP connections.
The former 5 ms policy collection window started synchronous native anchor
verification before all handshakes completed, splitting the reads into redundant
transactions and exhausting Brain's unchanged 3,500 ms restore budget before
exact retrieval. The collection window is now 50 ms, with the same 32-request
cap, per-request authorization and receipts, authenticated history and session
retirement. This is a correction to our forwarding composition, not evidence
that upstream SessionStart itself always fails.

An isolated test using the real native policy engine groups requests arriving
at 0/15/18 ms into one transaction instead of two, preserving allowed/denied
decisions, single-use approvals and full ledger audit. It adds approximately
46 ms to a solitary request. The small test ledger proves grouping and policy
semantics, not production throughput; live restore verification is separate.
The original R5 failure discarded its exception, so that individual occurrence
cannot be assigned a proven cause retrospectively. Brain #522 diagnostics retain
future outcomes without increasing the deadline or changing advisory behavior.
The restore body loads the existing private logger itself: the native Claude
shim starts a child without inheriting its parent's Node preload. A two-process
regression covers that boundary, successful and failed restore records, and an
unavailable logger leaving the native outcome unchanged. No global `NODE_OPTIONS`
or subprocess behavior is changed.

Failed restores now preserve a private snapshot of overlapping native policy
transactions beside the hook result, before the shared 128-slot timing ring
can rotate. The snapshot retains only allowlisted phase/queue timings, process
and project identities, tool names and request digests; no memory values,
arguments, credentials or raw errors. Reads are bounded by fixed slot, byte and
elapsed limits; unavailable or unsafe diagnostics never change restoration.
Overlap is evidence for investigation, not automatic attribution. Successful
restores do not scan the policy ring. This closes the diagnostic gap exposed by
R2 and ST03; it is not a latency fix or proof that those failures recovered.

The later release-150 R5 recurrence was still unresolved at that release: a bounded three-hook
burst plus two native list reads reproduced all three 3,500 ms expirations.
Initialization responses arrived around 2,670 ms and fast-list responses around
3,317 ms; no fallback page or exact retrieval began before expiry. This does not
establish a database failure or isolate the original invocation's missing time.
Restore diagnostics now retain bounded list/get starts and outcomes, including
operations still pending at expiry. Owner diagnostics distinguish initialization,
policy, handler and forwarding phases in 128 private overwrite slots under
`~/.ruflo-source-patch/mcp-operation-diagnostics`. CPU and event-loop metrics
describe the whole process interval, including overlapping calls; initialization
timing starts when JavaScript dispatches the handler, not at network arrival.
No inputs, memory values, raw keys, credentials or raw errors are recorded.
`RSP_OPERATION_DIAGNOSTICS=off` disables owner observations. These traces change
neither deadlines nor session retirement and are diagnostic, not recovery proof.

Version 4.46.153 repairs the owner starvation reproduced in incident 020.
Native unified search first materialized up to 100,000 full memory rows just to
discover namespaces, then ran sequential native corpus calculations without
serving pending owner I/O. The same real search reproduced R5's 3,500 ms restore
expiry before any initialization response. Internal namespace discovery now
projects only namespace values through the existing native list query, retaining
its selected rows, filters and cap. Native tokenization, term-frequency and
scoring loops yield between documents after approximately 8 ms; namespace fan-out
also yields between searches. Native calculations, ranking, authorization,
receipts and the restore deadline remain unchanged. No alternative memory driver,
index or cache is introduced. Retirement requires equivalent native scheduling
and namespace projection with the same result and contention proofs.

The registered R5 hook recovered its exact checkpoint during the original real
search at three offsets: 1,995, 2,764 and 2,487 ms while the searches took 21 to 26
seconds. The six returned search results matched the baseline exactly. Native
selection limits remain explicit: two restores used a 5,000-row fallback page;
the early restore reported `fast-unverified`, which does not prove the newest
checkpoint. A single SQL operation or very large document can still block until
it returns. Inert regressions reproduce the original I/O starvation and verify
unchanged SQL selection, scores, ranking, failures and exact patch reversal.

The 4.46.153 release still timed out during early search overlap after activation.
Version 4.46.154 also removes duplicate namespace rows inside SQLite, after the
same native selected-row subquery and its limit. This keeps namespace discovery
from materializing 100,000 repeated JavaScript objects to find 79 distinct names.
The 4.46.153 failure receipts remain retained. The additional correction recovered
the exact checkpoint in 2,999 and 2,470 ms at early overlap and 2,076 ms at the
original incident timing; all six search results remained identical. Native
fallback schemas retain the same row cap before deduplication. The deadline and
checkpoint-selection qualifications above still apply.

The final release-154 early-overlap check still expired at 3,505 ms; its later
original-phase sibling restored in 1,823 ms. Warm and fresh-owner repeats restored
in 2,281 and 2,434 ms, so these successes do not erase the failed contention case.
Bounded profiles identify synchronous namespace selection before initialization
dispatch and full-payload search sorting before restore reads. The next correction
reuses the original thin namespace SELECT directly and the existing guarded
row-identity projection for the native search window. Filters, expiry evaluation,
row limits, scoring, authorization and deadlines stay unchanged. Disposable native
SQLite fixtures verify exact selected rows and fallback schemas; installed
contention evidence is a separate requirement from these source checks.
Release 4.46.155 correctly refused the combined historical bridge bytes during
installation; no owner was refreshed. Version 4.46.156 adds the exact historical
forward proof for the owner/list composition, with a regression that reproduces
the refusal and still rejects unowned edits.

Activation on 3 November: commit `7c86823`, tag `v4.46.118`, active on Mac/HZ.
All 10/16 owners respectively passed health after native graceful refresh, and
both monitors reported no drift. Fresh native reads each produced one completed
`owner-coalesced` operation (287/871 ms, individual observations). Already-loaded
stdio clients retain their previous sender until normal host refresh.

At 100,000 synthetic anchors, three warm native HTTP samples gave median times
of 311→171 ms for one call and 2,671→176 ms for 16 concurrent calls. The latter
used 17 to 19 transactions before correction and 1 or 2 afterward and retained one native receipt per corrected call.
Both sides share one test process/event loop; these are not production throughput
guarantees. Full audit passed; native anchor complexity remains unchanged.

Passive HZ capture measurements after refresh recorded 20 gates with waits up
to 3.330 ms and holds up to 4.049 ms, while three native exact-duplicate paths
spent 1.406 to 2.511 seconds in storage/readback. One two-slot refusal remains, with
unknown durability. No historical capture was replayed. The HZ runtime parent
was tightened from 0775 to 0700 to satisfy private logging; unsafe directories
suppress emission. The remaining capacity issue is distinct from gate contention.

Release 4.46.117 corrects our owner client's failure decoding. Native public-memory
`{success:false,error:"…"}` results now reach their callers unchanged instead of
becoming a pretty-printed exception whose first line hides the reason. This lets
Brain's existing append-only duplicate/readback handling run. Other MCP refusals
retain only their diagnostic error field, on one bounded line; malformed payloads
cannot leak echoed values through JSON parser errors. No failure becomes success,
no write is replayed, and no timeout or database binding changes. Fresh hook CLI
processes load the correction; persistent clients need their normal host refresh.

Release 4.46.116 completes exact historical timeout-composition migration on Mac;
it retains the 4.46.115 session repair described below. Unknown source bytes still
refuse installation.

Release 4.46.115 closes abandoned short-lived owner sessions after native request
completion, even when the caller timed out or was killed. Each one-call client
negotiates an opaque disposal token; persistent clients keep their existing reuse.
Never-dispatched handshakes expire after 30 seconds. Retirement uses native session
APIs before the next initialization; in-flight requests remain protected and
uncertain writes are never replayed. Capability discovery now precedes tools/list,
so a failed tool-list handshake can also retire its allocated session.

Isolated native HTTP/SDK tests cover actual killed clients during reads/writes,
105 lost responses with one execution each, abandoned handshakes, invalid/late
identities and persistent clients. The existing 100-session cap remains unchanged.
These tests improve the earlier happy-path-only session qualification.

The release also preserves the reviewed HZ timeout repair in the shared target:
20-second recall, 40-second outer prompt/Stop/PreCompact handlers and Claude's
SessionEnd registration. Codex SessionEnd remains capped at 3 seconds; the native
Claude host budget remains separately authoritative. Exact previous profiles
upgrade reversibly. This does not increase the separate learning subprocess cap.

Release 4.46.114 adds `ruflo-policy-anchor-copy` for the remaining history cost
in [Ruflo #3164](https://github.com/ruvnet/ruflo/issues/3164). Native code still
authenticates every existing anchor under the policy lock. Its single-use
assessment now binds the source bytes with SHA-256; publication streams those
bytes and verifies the digest before the existing atomic writer can commit.
This avoids a second parse/authenticate/serialize traversal without changing
the file format, per-request decisions, mirror checks or receipt history.
Noncanonical layouts retain the native fallback. Tampering, truncation, append
and crash tests preserve refusal and native recovery. A disposable 105,000-anchor
benchmark improved median transaction time from 364.6 to 229.8 ms; this is not
a production latency claim. First verification still grows with history.

The 5 November follow-up reuses one process-local summary of a successfully
published, authenticated anchor file. A later transaction may reuse that summary
only after rereading and hashing the entire file and matching its exact length,
canonical project/trust/state context and current mirror tip. A changed file,
foreign writer, different context or missing/older mirror takes the native parser
path. Every request still receives a new native authorization decision and receipt;
state, mirror and archive checks remain fresh. The newly serialized append is
validated before reuse is offered, and only successful native anchor and mirror
publication can seed it. Nothing is persisted as a cache or removed from history.
This avoids repeated JSON parsing and per-entry hash computation for unchanged,
previously authenticated bytes; the complete byte scan still grows with history.
An isolated read-only copy of 178,756 production anchor entries (73.1 MB) measured
238.45 ms for native full parsing versus 26.61 ms for complete-byte digest reuse.
These are component timings, not a live hook or concurrency claim. Native 3.71.4
tests cover exact released-composition migration, tampering, serialization edges,
failed publication, crash recovery and full audit; live activation is separate.

Version 4.46.177 removes duplicate SHA-256 work from that copy operation
([#4883](https://github.com/ruvnet/ruflo/issues/4883)). It hashes the copied prefix
once, forks the native hash state, and authenticates the actual original footer
separately from the newly serialized append. Every input byte is still read and
authenticated; native locking, atomic publication, receipts and audit history
remain unchanged. Exact earlier overlays upgrade and uninstall reversibly.
An isolated 76.6 MB synthetic copy including fsync measured median 65.0 to
40.9 ms on macOS and 145.7 to 110.5 ms on Linux. Both hosts passed 33 component
boundary/tamper cases. These are component measurements, not live capture
latencies. Full-history work remains linear; this does not close #4883 or prove
capture-admission failures resolved. Installation and cached-owner activation
must be verified separately; the original ENOSPC owner remains preserved.
The hash-fork change passed all 142 regression suites; the migration follow-up
also passes the anchor, composition and plugin-notification suites. Aggregate
commands still report seven pre-existing Markdown errors in private KB issue
drafts. The changed README and isolated native transaction tests on both hosts pass.
Release 4.46.176's installer refused the previous summary-copy composition on
six laptop files without changing them. Version 4.46.177 registers that exact
historical variant with the existing composition verifier; modified bytes remain
refused. The installer-level regression covers both earlier revisions.
Installation is verified on 12 macOS and 16 Linux policy files, with pristine
backups retained and both stable copies matching immutable source. All 358 files
in each global package match the release artifact. No owners were restarted;
cached-process activation and actual capture-latency recovery remain unverified.

The 5 November follow-up also fixes our capture-admission race: normal owner retirement
could remove `admission.lock` just before our claims scan, outside its existing
ENOENT retry. The scan now participates in that bounded retry. Ownership checks,
the 100 ms admission deadline and native two-slot shedding remain unchanged.

After 4.46.113 activation, 19 Mac and 31 HZ native store reads passed. Fresh Stop
and exact checkpoint readback passed for Strategy, BA, Product, Query and Fabric.
Historical uncertain writes remain separate from fresh operation verification.

Release 4.46.113 adds the operator-requested temporary timeout mitigation:
`brain-hook-timeouts` gives recall 10 seconds and capture/checkpoint work
30 seconds, with matching 20/40-second outer hook registrations. Codex's native
SessionEnd cap remains unchanged; its existing detached checkpoint receives the
longer budget. Native policy-lock acquisition may wait 15 seconds instead of five.
These are finite budgets, not disabled checks or proof of a latency fix. Exact
readback, cancellation and native policy decisions remain required. The target
must be removed when the underlying latency qualifies at upstream defaults.
The prior installed policy composition is also recognized during upgrade;
4.46.112's preflight incorrectly rejected that exact older rendition.

Release 4.46.112 adds private native-policy transaction diagnostics after live
AI-BA and BA lock contention recurred. It also corrects our incomplete queue:
HTTP hook and other tool authorizations now share the same per-root queue as
memory calls. Previously `hooks_post-command` could contend with the owner's
own active memory authorization. Every native decision remains distinct; caller
authorization is unchanged. The fixed 128-slot ring at
`~/.ruflo-source-patch/policy-diagnostics/` records process/project identity,
lock-owner PID, elapsed time and transaction phases, including failures and
incomplete transactions. It excludes input values and credentials; malformed or
unsafe logging destinations cannot change authorization. Set
`RSP_POLICY_DIAGNOSTICS=off` to disable these observations. This is diagnostic
coverage, not a claim that mature-history latency or hook timeouts are resolved.

Release 4.46.111 reduces the measured anchor-parser hot spot using native
`JSON.parse` for complete bounded entry lines. Other representations retain the
original streaming parser; every entry still receives native hash-chain checks.
On one 169,033-entry history, parsing plus identical-output hashing fell from
916 ms to 524 ms. This is a parsing improvement, not bounded-history storage.
Queued authorization batches yield between transactions so HTTP work can run.
Exact composition inspection also recognizes the retained retrieve-error fix.

Release 4.46.110 fixes downstream policy-lock self-contention: native owner
memory authorization now drains one FIFO queue per policy root, in batches of
at most 32 individual native decisions. Writes join reads instead of competing
with their policy lock. No decision is returned before durable native commit;
budgets, approvals, denials and caller authorization remain intact. The monitor
also recognizes the exact owner/write-lock composition without relaxing any guard.

Release 4.46.109 corrects downstream adapter overhead and originating-caller
policy handling. Owner identity and completed-client release use authenticated
native protocol extensions; 4.46.108 clients remain compatible. Concurrent owner
memory reads share a bounded native policy transaction, while each request keeps
its own authorization decision and receipt. Originating MCP authorization and
result screening execute before and after forwarding respectively. No hook deadline,
policy rule, memory algorithm or stored history is relaxed.

An isolated 43 MB native policy-history fixture passed unchanged Brain recall
(1.19 and 1.66 seconds within 1.9 seconds), checkpoint and turn capture, exact readback,
and full ledger audit. Native allow, denial, budget and approval equivalence passed.
Historical failed-record reconstruction and application acceptance are separate
incident work, not prerequisites for releasing this compatible upgrade.

Release 4.46.108 adds bounded client-session retirement for
[Ruflo #4674](https://github.com/ruvnet/ruflo/issues/4674). Native HTTP 3.1.5 retains
short-lived SDK clients after close and can exhaust its 100-session capacity.
Completed clients now nominate their opaque UUID identity for native retirement
at the next valid initialization. Persistent and uncertain in-flight clients remain;
unknown writes are never replayed. Cleanup failure cannot replace an acknowledged
write result. A closing connection refuses queued handshake waiters before dispatch.
This uses native `getSessions()` and `terminateSession()` and preserves capacity and
expiry. It does not claim request isolation; upstream
[PR #3268](https://github.com/ruvnet/ruflo/pull/3268) addresses that broader responsibility.
Explicit tool allowlists must include `memory_owner_release` as well as identity.

Both hosts passed 105 unpaced short-lived clients with concurrent persistent calls,
ending with only the persistent client and final observer. Tests cover retirement
handover, invalid initialization, pooled handshake races, uncertain writes and
acknowledged results despite cleanup failure. Full repository tests passed; native
CLI/public/stdio/graph bootstrap passed on Mac and Linux with the existing core guards.
The shared authenticated loopback services use native bounded rate configuration:
`--rate-limit-per-ip 600 --rate-limit-per-session 500 --rate-limit-global-burst 1000`.
This accommodates the shared workload; it does not raise session capacity or expiry.
Private evidence is `session-release-full-suite.log`, `session-release-linux.log`,
`session-release-shared-profile-mac.log` and `native-session-stress-profile-mac.log`
under `.local/ruflo-upgrade-20261103/`.

Global Ruflo 3.71 and configured native owners are active on both hosts. Fleet
convergence is still in progress: active project dependencies, retained loaded callers
and the original failed checkpoint/capture receipts require separate verification.
A successful fresh probe does not clear an earlier uncertain write.

The new issue-backed `ruflo-memory-owner` target uses Ruflo's authenticated native
HTTP MCP transport and SDK client to give each project one persistent controller
owner. It does not replace storage, algorithms, indexes or Brain hooks. Explicit
ordinary and retained-graph store bindings remain distinct from implicit project
controllers. Public memory functions also route through that owner, including
Brain batch recall and native daemon trajectory embeddings. Existing daemon workers
and their configured lifetime remain unchanged.

Release 4.46.171 corrects the forwarded `memory_store` upsert default
([source-patch #9](https://github.com/sparkling/ruflo-source-patch/issues/9),
upstream context [#4654](https://github.com/ruvnet/ruflo/issues/4654)). Before
policy projection, MCP calls normalize omitted `upsert` to true, including calls
requesting `nativeResult`; public native calls normalize it to false. Explicit
values follow each entry point's existing predicate. The owner-side canonical
contract stays unchanged so older strict clients remain safe during rollout.
Append-only conditions, exact store selection and uncertain-write handling remain
native. This affects refreshed forwarding clients; a package install alone does
not prove existing processes loaded it. Direct canonical HTTP calls that bypass
the forwarding client retain their native defaults and should specify `upsert`.
Installation verified 54 owner-bundle files on Mac and 72 on HZ. The HZ native
client rollout produced fresh Builder, Query, Product, Fabric and Oxigraph clients;
the affected Builder session passed an exact read of its existing record. The
disposable mixed-version test separately proves update and strict-refusal behavior.
Release 4.46.172 qualified the Mac `npx` Ruflo 3.72.2 entrypoint against the unchanged
3.71.4 owner in disposable stores, then refreshed six Mac clients through native
configuration reload. Five use the qualified npx copy; one retains its configured
global entrypoint. An existing source-patch checkpoint read back exactly unchanged.
This does not claim freshness for every project override, standalone Claude client
or direct HTTP connection; the existing HTTP owners were not restarted.

Routing is operator-configured in `~/.config/ruflo/memory-owners.json` (or the explicit
`RUFLO_MEMORY_OWNER_CONFIG` path). Version 1 declares `owners` keyed by identity,
`contexts` mapping exact cwd/pin pairs, and `stores` mapping exact database paths.
Each owner declares absolute `cwd`, nullable `pin`, literal loopback `url`, private
`tokenFile` and optional `requestTimeoutMs` (180,000 ms default). No configuration
means unchanged native behavior. With configuration, missing or ambiguous bindings,
identity mismatch, unavailable owner and uncertain writes fail without local fallback
or automatic replay. Server mode is process-local; child CLI invocations stay clients.

The client setting does not override Ruflo's separate native HTTP server deadline
(30,000 ms by default in 3.71.4). Unified search can exceed that deadline while
visiting many namespaces sequentially. Use the server's supported
`--request-timeout-ms` setting, with margin below the caller's budget; this repair
qualifies 120,000 ms server / 180,000 ms client for the affected HZ owner. This is
a timeout mitigation, not a search-speed improvement. Namespace scope, native
ranking, authentication and storage bindings stay unchanged. A successful retry
does not fix the cause; the current `searchTime` field is an epoch timestamp,
not elapsed time. Detailed latency and suppressed namespace errors are tracked in
[Ruflo #4876](https://github.com/ruvnet/ruflo/issues/4876).

The affected HZ owner is activated with that configuration. Both original queries
completed concurrently across 74 namespaces in 36.43 and 38.02 seconds, beyond
the former 30-second cutoff. Its canonical storage binding is unchanged. Native
HTTP qualification also returned success for a 31-second fixture request.

Fresh real-process Mac and HZ checks pass: CLI immutable store/exact raw readback;
two stdio clients sharing live records; separate retained graph roles with no result
leakage; healthy implicit AgentDB; smart search, HNSW rebuild, stats, deletion and
purge. The final Mac proof also exercises public list/get/search from an unmapped
Brain-style scratch directory, preserved canonical options, and the actual native
daemon trajectory and enabled harness worker with concurrent writes on both hosts. The worker
opens no managed database or vector index; native embedding values and backend
metadata are preserved.
Native `memory init` deliberately refuses routed execution before creating storage;
it remains an exclusive administrative operation. These checks use disposable stores,
not production data. Private evidence is under `.local/ruflo-upgrade-20261103/` in
`linux-six-surface-bootstrap.log` and `linux-six-surface-contract.log`; Mac
receipts are under `.local/memory-recovery-20261102/review/ruflo371/`: the
`owner-bootstrap-data-kxrCx0`, `native-http-owner-data-XIRzYY` and
`daemon-owner-client-data-q2Nn99` directories.

The source surfaces have exact-anchor preflight, idempotent composition and
byte-for-byte reversal, including composition with the existing memory write guards.
Client forwarding occurs outside those guards so the client never holds a local
write lock while waiting for the owner. Retire this target when upstream provides
equivalent owner routing with immutable public/CLI contracts, graph-role isolation
and enabled daemon workload proof. Initial owner provisioning and supported host
reconnections are active; full fleet and incident verification remain incomplete.

## Historical Ruflo 3.71 qualification: 2 November 2026

Rechecked on **3 November** for the requested Mac-then-HZ upgrade: the public
registry still names Ruflo and CLI 3.71.0 as latest. All seven qualified CLI/native
dependency integrities and the Ruflo, AgentDB and RuVector source heads are unchanged.
At that historical review, issue #4654 remained open and related PR #4667 remained
unmerged; its health reporting changes did not provide store-owner forwarding.
The 5 November review above records the later native fix and issue closure.

The existing disposable concurrency test was rerun against source bytes verified
identical to the published package. Its owner stored and retrieved the expected
value; the concurrent process failed with `Database already open. Cannot acquire lock.`;
a fresh process after owner exit retrieved the same row and value. The test opens
only newly created disposable data. No existing managed store or sidecar was altered.
The checked user-global launchers on both hosts, and the current Mac mise global
prefix, remain on 3.66.0. Existing loaded sessions were not reconnected or downgraded.
The requested production upgrade has therefore **not been activated**. Patch
4.46.106 is now active on both hosts, and both monitor checks pass without drift.
Fresh qualification evidence is retained under `.local/ruflo-upgrade-20261103/`.

Published CLI 3.71 source passes the fresh 44-file composition/parse review. Its new
AgentDB dependencies, however, fail a pristine native concurrency test: process A
can store and retrieve an ordinary row, but process B opening the same database
cannot acquire its persistent RuVector index lock. Ordinary retrieval then fails.
After A exits, a fresh process reads the same row successfully. The native SQLite
schemas are unchanged; this is an ownership conflict, not demonstrated corruption.
Disabling a vector controller does not skip AgentDB's earlier core initialization.
No alternate backend, adapter, lock deletion or topology change was introduced.

The exact resolved dependency versions, source analysis and disposable reproduction
are recorded on [Ruflo #4654](https://github.com/ruvnet/ruflo/issues/4654#issuecomment-6583536255).
The reusable private command is `node .local/memory-recovery-20261102/review/ruflo371/native-concurrency-check.mjs`.
Further rollout is held pending a native resolution compatible with simultaneous
MCP and hook/CLI access. Already-running versions are reported above; this repair
does not claim that every existing 3.71 process was newly installed or fails.

## Ruflo 3.66 qualification: 31 October 2026

This section retains the 31 October qualification and its later owner-preservation
note. The 2 November loaded-session proof above supersedes its deferred activation
status, and the 4.46.102 test result supersedes its historical Markdown failure.
The current loaded inventory is mixed; these earlier counts are not a current fleet census.

Ruflo and `@claude-flow/cli` **3.66.0** are installed in all ten discovered
launcher locations across Mac and HZ, including the dedicated HZ AI Strategy
runtime. Retained patches were reapplied with **4.46.86**; both monitors report
no drift. The source review covered 52 CLI contributions across 42 files with
no missing anchors, plus the remaining registered package/plugin checks.
Upstream's new verified-learning helper and ingestion behaviour are preserved.

An npm upgrade can succeed while its script policy skips native SQLite binding
installation. This happened on both hosts: an unbuilt `better-sqlite3` 12.11.1
caused native initialization to fail and an inventory to misleadingly report
zero. The reviewed package's own install script restored the binding; global
script policy was not weakened. Verify native ABI and actual memory reads after
an upgrade, not just npm's exit status or an advertised package version.

The shared user-memory services were gracefully restarted. Two concurrent clients
returned matching inventories (Mac 342; HZ 654), and exact reads and searches
passed. HZ `system_status` reports 3.66.0; the local restricted service handshake
uses upstream's generic 3.0.0 label, so its package/version and restart evidence
are recorded separately. All four loaded local Codex project sessions report
3.66.0 through their native `system_status` tool.

HZ's loaded project sessions remain on their previous runtime. Its app-server
refused scoped project writes with `configLayerReadonly`; a broad reconnect was
not attempted because the protected old Builder owner retains deleted stores
whose full recovery is unproven. On 2 November that historical process was found
absent; its exit time and cause remain unknown. Updated files and successful patch
installation are not presented as fresh loaded-module proof.
Archived project dependency trees are not counted as active launcher locations.

Every code regression suite passed against the updated installation. The overall
`npm test` exit remains nonzero because its final broad Markdown scan reports
191 formatting problems in ignored working/downloaded material. Changed README
and ADR files pass their scoped Markdown validation.

## Upstream alignment: 31 October 2026

Release **4.46.86** retires the three verified native replacements below.

Brain 4.7.28 supplies the native replacement for `brain-learning-receipts`.
The retirement probe executes installed producer and child bodies with inert
persistence: detached submission never acknowledges capture; failed exact
readback and withdrawn consent cannot acknowledge; successful synchronous and
child writes acknowledge only after readback. Pending state is cleared on child
failure. Mutated regressions fail the probe. Retirement uses the existing shared
composition engine and never changes Brain's update selection or stored memories.

Native wrapper ownership and host recovery also retire through their existing
behaviour and complete dependency checks. Existing sessions are not claimed
refreshed by that source proof.

The local and HZ user-memory connections now use one authenticated native HTTP
owner per host, bound to loopback. Concurrent client inventory, exact retrieval
and search passed on HZ; local native inventory returned 342 records. HZ returned
654. These counts describe current ordinary entries, not full corpus integrity.
BA and Builder project overrides were removed so they inherit the shared owner.
Claude Code user registrations on both hosts also use that service. This local
session passed a real `ruflo_user.memory_search` after the configuration change.
No database path changed and no database or sidecar was deleted. The separate HZ
recovery process remains alive. New sessions inherit the service; loaded project
overrides still require the owning host to reconcile their configuration.

The residual error-attribution and incompatible-backend fallback is reported in
[Ruflo #4622](https://github.com/ruvnet/ruflo/issues/4622). The existing authorised
repository-owner login was used without changing the active GitHub account.
No new source patch was added for that gap; native transport fixes the observed contention.

The full test run found one missing 3.66 fixture dependency (`verified-lessons.js`);
the corrected fixture passes without relaxing assertions. The retirement suites
and changed documentation pass. The broad Markdown scan also traverses ignored
downloads under `.local` and reports their formatting failures; those are not
claimed clean or silently suppressed.

These are scoped retirements, not a claim that every patch or project is qualified.
Ruflo 3.66.0's published `memory-bridge.js` is byte-identical to the pristine
3.65.0 copy checked here. Native path-keyed registry identity already supersedes
our old bridge overlay; competing processes opening one RuVector companion are
a separate unresolved transport/configuration problem. The raw-WAL safeguard
must not be removed merely to conceal that native initialization failure.

## Explicit embedding ownership: 30 October 2026

Release **4.46.84** is pushed and installed on Mac and HZ. Both patch monitors
report no drift, and scratch preservation covers **48/48 files on each host**.
The full regression suite passes. The existing HZ memory owner was deliberately
not reconnected: it still holds deleted stores whose complete recovery is unproven.
Fresh CLI/hook processes use the installed correction; existing loaded MCP code is
not represented as refreshed. The native stuck transaction remains unresolved.


Ruflo **3.65.0** still drops an explicit database path between a successful primary
write and its auxiliary embedding sync. Brain uses the correct `memory store --path`
argument; the subsequent `addToHNSWIndex` call omitted the path supported by
`bridgeAddEmbedding`, which copied the row into the ambient native controller store.
This residual of [#3196](https://github.com/ruvnet/ruflo/issues/3196#issuecomment-5849260721)
explains why real records can appear under Brain's scratch working directories.
It does not establish that any retained scratch row is redundant.

The existing `memory` target now carries the explicit path through ordinary and
pattern embedding calls. Explicit operations cannot fall through to the ambient
HNSW singleton or remove entries from its index during store, delete or purge.
Primary native writes already persist their embedding; auxiliary failure preserves
that primary receipt without replaying the write or claiming a new index guarantee.
Implicit controller defaults and the intentional two-store design remain unchanged.
Tests execute installed native function bodies and patch composition with isolated
driver doubles; they do not claim a refreshed live MCP or a complete retrieval benchmark.
The historical HZ owner was found absent on 2 November; deleted-store preservation
gaps remain unresolved despite the ordinary-record preservation described below.

## Native host proof: 30 October 2026

Brain's native lifecycle activated **4.7.22** on both hosts. Its doctor now adds
isolated boot probes for changed shim, MCP and skill surfaces to fresh declaration
proof. `brain-host-recovery` accepts that stronger native implementation only with
its reviewed installer and complete helper dependency set. Executable tests reject
missing, altered, linked, hanging and unsuccessful helpers, partial path evidence and
claims that existing open windows were proven refreshed. No updater or host state is
rewritten by this compatibility acceptance.

## Scratch preservation: 30 October 2026

`brain-scratch-preservation` addresses Brain
[#335](https://github.com/stuinfla/ruvnet-brain/issues/335#issuecomment-6523577872).
A scratch directory name and age do not establish that its contents are disposable.
One shared helper protects pre-call cleanup, post-call cleanup and the native footprint
sweep. The extension covers learning, decision capture, durability probes and both
recall cleanup callers, including executable npm and Console installer payloads. It removes only an empty directory through atomic `rmdir`; files, links,
nonempty directories, unknown contents and concurrent changes are retained and reported.
Independent native KB-copy archive verification remains unchanged. This protects existing
records without merging ordinary `memory.db` and native `agentdb-memory.db` stores.
It neither changes native update selection nor resolves an interrupted KB transaction.
The initial **4.46.82** deployment covered **12/12** files on each host. Further
caller and installed-payload auditing found the additional boundaries described above. The full regression suite passed; real 4.7.21/4.7.22
modules also passed against disposable sentinel stores and an independent KB archive.

The latest bounded native read found **60 entries** across the nine HZ scratch AgentDB
stores (59 `turns`, one `repo`), up from 34 at the earlier inspection. This is an
ordinary-entry inventory, not all-table, vector or duplicate coverage. Ten RuVector
files remain unclassified. Full backup/restore proof is required before any later
disposal decision; the guard does not itself authorize cleanup of retained content.

Subsequent inspection found that seven original SQLite files had been unlinked while
the existing HZ MCP still held them open. That owner was preserved. Native exports
saved **75 ordinary entries** from all nine cached stores; seven fresh-path native
SQLite backups exposed 19 entries, all verified by exact reads, including 14 additional
source-scoped entries. These preservation sets therefore represent **89 source-scoped
ordinary records**. They do not prove preservation of deleted-store controller tables
or RuVector data. Those were the 30 October findings, not current owner status.

The 2 November native verification found the historical owner absent. Ten native-only
backups and 30 exact derived-copy reads preserved all 19 historical snapshot values
and three additional identities: **92 source-scoped ordinary records** are now
represented. All ten source files retained their metadata. No live import or restore
was performed. Seven historical deleted identities still lack qualified all-table
snapshots, and complete RuVector recovery is unproved. Preserved exports, snapshots
and receipts remain intact; no missing records are inferred from absent pathnames.
The private final receipt is
`.local/memory-recovery-20261102/hz-recovery-final-20261102.json`.

The old KB transaction had already reached native `DISPOSED` on 1 November, with
`operator-kept-live` and its candidate retained under `.kb.recovered`. Two later
native transactions committed successfully. This resolves that transaction blocker;
it does not resolve the independent deleted-store recovery gaps.

## Capture and lock recovery: 30 October 2026

`brain-learning-receipts` addresses a residual capture acknowledgement defect
related to Brain [#377](https://github.com/stuinfla/ruvnet-brain/issues/377): detached
submission must not mark an observation as captured. The child marks it only after
exact native readback. This does not remove load shedding or change stores,
transport, historical data or the native update plane. Unknown upstream anchors
refuse application. Version 4.46.81 was installed on Mac and HZ. Controlled native
MCP reloads and exact reads verified activation; the affected writer also passed a
new write and complete-value readback. The wider upgrade remains a separate check.

The memory lock now recovers a provably abandoned owned recovery fence through
the existing exclusive recovery helper. Live or ambiguous owners still refuse.
A bounded inventory of 149 Mac and 385 HZ store directories found no further
recovery fences. The remaining inactive worktree's dead writer claim was subsequently
archived by a bounded native exact read, leaving no active lock or recovery fence.
That read is lock-recovery evidence, not a corpus-completeness check. No database or SQLite
sidecar was altered by fence recovery. Brain history stays in `memory.db`; native
controllers and research keep their independent `agentdb-memory.db`.

## Compatibility repairs: 30 October 2026

Version **4.46.81** preserves Ruflo **3.65.0**'s new verified-outcome fields in
both returned and atomically saved session state. Its plugin-host projection
preserves the newer native verify/paths commands and the older command surface.
Package discovery now also covers identified CLI dependencies nested by npm;
it does not recursively search unrelated directories. One shared tiered-memory
contribution covers both layouts, preventing duplicate edits on nested copies.
The Codex manifest repair
accepts the exact MetaHarness **0.4.0** mixed command/module rendition, preserves
its command hook, and retains the original Claude module source. Changed or
unknown manifests still refuse application. Status and preflight recognize only
the existing logger's exact reversible wrapper around those command hooks;
selective removal preserves the other owner and restores the original bytes.

The fresh upstream review retrieved all **122 linked references**: **98 closed,
23 open and one merged**. Seven Brain issues closed since the prior review;
no Ruflo issue changed state. That review covered Brain **4.7.21**;
the native lifecycle subsequently activated **4.7.22** on Mac and HZ. Native ownership and host-recovery
bytes are accepted unchanged. The capture acknowledgement and boolean dual-host
persistence-proof defects remain, despite related issue closures. Operator-disabled
completion stays disabled. Issue #425 has since closed; that closure does not
revoke the operator-directed suspension.

OPDA's `receipt-chain-mismatch` was a legacy policy-format mismatch, not damaged
history. The existing `scripts/policy-native-restoration.mjs` converted its verified
segmented history through the retained compatibility reader and native owner:
all 47,748 original receipts and trust records were preserved, live MCP status,
inventory and exact reads passed, and full verification then accepted 47,751
receipts including those three real calls. No policy decisions or signatures were
reset. A bounded 139-state inventory found other archived legacy histories only
outside the observed current MCP working directories; these remain preserved.
Native policy format must be qualified separately from source-patch retirement.

Owner-approved native Brain `--clean --archive` removed the Mac's two redundant
KB copies after archiving their unique metadata. Both archived files matched their
pre-cleanup hashes; one live KB remains and the native footprint check passes.
This cleared the copy blocker, not the stale corpus: a successful subsequent native
lifecycle refresh is not yet verified. No manual update or promotion was performed.

At the 30 October inspection, HZ was blocked by a retained `RECOVERY_REQUIRED`
transaction. Native disposition subsequently resolved it as documented above.
Whole-footprint cleanup was withheld: nine paths classified
as scratch contain real memory entries (60 in the later bounded read above), and ten
RuVector files remain unclassified.
The native cleanup has no per-copy selector. The evidence and requested safe recovery
route are recorded in [Brain #335](https://github.com/stuinfla/ruvnet-brain/issues/335#issuecomment-6523577872).
No HZ cleanup was performed by that operation. The later recovery section records
current preservation evidence and limits; the historical inventory is not proof
that every original store remains available.

## Previous compatibility review: 27 October 2026

Version **4.46.75** qualifies Brain **4.7.21** against the installed native helper
and adopted-user-learning boundaries. Ruflo and `@claude-flow/cli` remain qualified
at **3.61.1**, preserving 3.59.17, 3.59.1 and older compatibility renditions.
The 25 October review checked all **59 registered patch targets** (10 CLI targets and 49
plugin/package targets), correcting the previous count of 55. It refreshed all
**122 previously linked GitHub issues and pull requests: 91 closed, one merged,
30 open**, with no changes since the 23 October review. These dated counts
are discovery evidence; executable installed-source checks determine retirement.
Historical compatibility and fleet tables below retain their original dates.

The 3.61.1 upgrade passed patch installation and monitor drift checks on Mac and
HZ without a patch-source change. Its policy runtime and engine match the
previously qualified bytes and again passed the 5,000-receipt audit. The pristine
3.61.1 memory bridge passed 19 checks covering CRUD/search, source isolation,
aliases, fresh-process visibility, restart and native backup; this does not
measure retrieval quality. Controlled host reloads returned 3.61.1 plus an
inventory and exact-key read from the three loaded Mac primary sessions and HZ's
builder session. Native hook review found no pending approvals in the checked
contexts. Brain learning writes and exact readbacks passed in both user stores;
Brain's separately reported KB rollback/update failure remains unresolved.

Brain **4.7.21** changes the native Codex declaration/content comparison and
refreshes the shared host through a version-checked, no-edit configuration reload.
The `brain-host-recovery` check now qualifies the exact complete helper set,
including its new transitive plugin entrypoint; older reviewed sets remain supported.
Behaviour tests cover native approval, unchanged repeats, content drift and altered
helper refusal, reload deadlines and error redaction. Mixed helper sets still fail.
The source compatibility check grants no hook approval and performs no host reload.
Native shell-gate probes also stage the parser's required entrypoint dependency;
a missing or linked helper refuses qualification instead of silently allowing an
empty parser result.

Brain **4.7.21** also supplies the native adopted-user-learning fix for
[#377](https://github.com/stuinfla/ruvnet-brain/issues/377), now closed upstream.
`brain-user-learning-root` retires only after source-bound native tests prove fixed
user ownership under a Git-managed parent, consent and unsafe-path refusal, and
exact capture/readback handling with an inert owner. Retirement restores only
owned legacy overlays. It does not initialize, migrate or replay memory, and these
compatibility changes do not repair the separately reported Brain KB/update failure.

| Surface | Current disposition |
|---------|---------------------|
| Policy serialization and ledger | The pristine 3.59.17 runtime passes the existing 5,000-receipt conversion, complete-history audit, new-write/pruning and missing-history rejection proof. Its exact bytes are accepted without either older overlay; the engine is unchanged. Native [#4343](https://github.com/ruvnet/ruflo/pull/4343) path-error reporting passes missing-directory, nonregular-path, symlink-preservation and live-owner serialization probes. |
| [Backup #4287](https://github.com/ruvnet/ruflo/issues/4287) | Closed upstream. Preserve its native ordinary-source refusal, encrypted/WAL checks and method receipt. Retain only shared SQLite loading and the explicit `--native-only` refusal, which the pristine release still lacks. Older packages keep their separately applicable compatibility rendition. |
| [Graph binding #4291](https://github.com/ruvnet/ruflo/issues/4291) | Closed upstream. Remove the old file-binding replacement on 3.59.1. Retain only the explicit `:memory:` guard: its native file resolver otherwise converts that sentinel into a filesystem path. Both sniff and open retain the same selection. |
| Memory statistics #3311 | The 3.59.17 caller-path helper is preserved. The remaining overlay reads complete aggregates through the existing registry handle, without capped enumeration, a second driver or unmeasured HNSW readiness claims. |
| Wrapper #3306 | Importing the shared selector through `node --input-type=module -` no longer tries to resolve the pseudo filename `-`. The exact 3.59.17 native wrapper is now accepted unchanged after version, CLI/MCP delegation, mismatch warning and native teardown probes ([#3226](https://github.com/ruvnet/ruflo/issues/3226)). Older wrapper compatibility remains recognizable for upgrade and rollback. |
| Test execution | Run at most four suites concurrently by default. `RSP_TEST_JOBS=1..16` selects explicit suite parallelism; invalid values fail before dispatch. Each suite retains its isolated fixture and failure result. |
| Installed versus live | Package installation and patch verification do not reload existing MCP modules. Use the owning host's native reconnect, preserving source bindings, hooks and permissions; never kill MCP transports to impersonate activation. |

Upstream [#3450](https://github.com/ruvnet/ruflo/issues/3450) is now closed:
native ordinary-memory deletion removes its mirror and tombstones. This does not
replace `ruflo-pattern-withdrawal`'s separate exact ReasoningBank get/delete and
body-hash approval contract, which remains required. No native-history migration
or historical learning replay is performed by patch installation.

Hook approval and source compatibility are separate checks. A changed upstream
hook definition or plugin fingerprint can require native host review even when
all source patches pass. The logger may inherit existing trust only across its
exact reversible preload wrapper; it never approves unrelated upstream changes.
Stale host hook metadata must be refreshed before exact reconciliation, rather
than treating mismatched metadata as permission to broaden approval.

The owner confirms that the former GCP projects now live on **HZ under
`/data/source`**. Current upgrade coverage is Mac plus HZ, including runnable npx
caches; the seven-host table below describes the historical 15 October deployment.
No GCP authentication or deployment is required for those retired hosts.

### Opt-in npm and npx maintenance

`monitor maintenance` explicitly enables and immediately runs package hygiene.
The existing five-minute monitor checks the opt-in configuration; the work runs
at most once per 24 hours, using the same mutation lock as patch installation.
`monitor maintenance-status` reads its configuration and last receipt;
`monitor maintenance-disable` stops it. It is off by default on other installs.

The native npm installer updates npm and its bundled npx with `--engine-strict`,
so an incompatible Node release cannot be silently forced. The owner-authorised
Node 24 patch upgrade permits the current npm 12 train. `prefer-online=true`
checks registry freshness during npm/npx resolution. Version-pinned requests
retain their meaning; this does not rewrite project dependencies or lockfiles.

Cleanup uses `npm cache npx rm` for obsolete Ruflo/source-patch packages and
unused cache entries older than 30 days, followed by `npm cache verify` for native
content garbage collection. Fresh process and open-file inventories protect live
entries; user configuration and stable-source references are retained. Symlinks,
unclassified entries, Brain-owned installers and caches with root runtime state
are excluded. A failed inventory forbids deletion. A second live check immediately
precedes each removal; this is best-effort coordination with independent launchers,
not a system-wide lock on every possible npm caller. Every actual removal and
failure is recorded under the existing stable-runtime directory. No MCP is killed,
no database or sidecar is opened, and no new daemon or updater schedule is added.

Historical releases 4.46.68 through 4.46.70 introduced a custom tier-copy path,
verified-copy context counting and selected-trajectory ReasoningBank retention.
The 4 November upstream-intent review withdraws those algorithms. Their original
receipts and stored copies/patterns remain preserved; the current contracts are
native context synthesis, native unsupported consolidation, and explicit refusal
of unsupported selected learning. Installation never replays old trajectories.

Release 4.46.67 adds `brain-user-learning-root` for the remaining user-store
adoption gap in [Brain#377](https://github.com/stuinfla/ruvnet-brain/issues/377).
After explicit native store initialization, user learning works beneath a
Git-managed `.claude` parent without resolving into its project store. Consent,
regular-file ownership and symlink/hardlink refusals remain enforced. Installation
does not create a database or change the selected learning scope.

Release 4.46.66 recognizes Brain 4.7.14's native published-wrapper history proof
for [Brain#420](https://github.com/stuinfla/ruvnet-brain/issues/420). An exact-source
executable probe verifies retained/pruned release acceptance and rejects edited
bytes, malformed history and foreign ownership. No Brain runtime bytes, update
assets or generation pointers change when this native replacement satisfies the target.

Release 4.46.65 fixes [source-patch#8](https://github.com/sparkling/ruflo-source-patch/issues/8):
withdrawal preflight remains atomic within each installed bridge/tool pair. An
unsupported older cache stays visibly incomplete while independently proven
packages receive their complete patches. Invalid preflight file scopes fail closed.

## AIDefence server configuration

`ruflo-pii-policy` is withdrawn by the owner's 6 November 2026 correction.
The project/global workflow treats PII-only findings as informational, preserves
sources and raw verdicts, and requires no PII false-positive learning. Optional
native CLI, federation, intelligence and Console guards keep upstream behavior;
research does not need a PII source bypass. The retained target only restores
its exact historical contribution and never reapplies it, including through
`all install` or the monitor ([#4861](https://github.com/ruvnet/ruflo/issues/4861)).
Release 4.46.184 reports this target as WITHDRAWN with native-restoration counts,
never as an active policy patch or an instruction to reinstall it. Read-only
status fails when restoration is unproved, including when no files are discovered.
A native known-miss wrongly recorded by PII feedback remains evidence of that
feedback artifact, not proof that a contextually reviewed document is malicious.
No supported exact retraction was found ([#4862](https://github.com/ruvnet/ruflo/issues/4862));
no raw registry/store edit, feedback replay or mandatory clean rescan is required
for the owner's reviewed admission decision. Actual non-PII threats and genuine
operational errors retain their controls.

`ruflo-atomic-write` fixes the native `fs-secure.writeFileAtomic` short-write
publication gap ([#4888](https://github.com/ruvnet/ruflo/issues/4888)). It reuses
Node's `writeFileSync` on the helper's exclusively opened temporary descriptor,
so the complete buffer is written before native fsync and rename. The native
temporary naming, mode, cleanup, directory sync, WAL and integrity guards remain.
It changes no encryption, lock, merge, owner or storage-binding rules.

Tests reproduce the native truncated replacement under an injected short write,
then exercise real Node write-all behavior and old-file preservation on partial
ENOSPC, fsync and rename failures. No managed database or learning initializer is
used. Retire on equivalent pristine native behavior. This helper correction does
not retrofit cached owners or recover historical learning; older learning saves
that bypass this helper remain a separate concern.

Release 4.46.180 installed on six Mac and eight HZ copies. Fresh native helper
calls on owned inert files verified complete short writes and old-file retention
after partial ENOSPC on both hosts. All 145 code suites and Linux focused tests
passed; seven existing private Markdown findings remain. Existing processes may
retain cached helper code. The original learning owner was not restarted.

`ruflo-hook-id-schema` advertises the existing `hooks_post-task` identifier
contract for [#4887](https://github.com/ruvnet/ruflo/issues/4887). Task, agent and
parent IDs expose the native character pattern, 128-character bound and reserved
names. Optional IDs stay optional, including the native empty-agent behavior.
Descriptions distinguish registered native IDs from slash-separated host paths.
No ID is renamed, normalized or inferred, and the complete handler is unchanged.

Installation qualifies both the CLI reserved-name wrapper and its actual
cli-core validator. Unknown validation changes refuse installation. Tests compare
schema acceptance with the native validation prefix before persistence, including
reserved names, invalid paths, length boundaries and native newline behavior.
Retire only after equivalent pristine native schemas pass that same proof.
Cached tool registrations need refresh before the metadata is visible; this
patch does not replay completion hooks or prove historical persistence.

Release 4.46.179 installed on six Mac and eight HZ copies. Fresh native MCP
`tools/list` responses expose the new constraints on both hosts; existing cached
registrations are not claimed refreshed. The focused Mac/Linux schema proofs
pass. The full run passed 143 of 144 code suites; the unchanged capture-timing
assertion failed once and passed its focused rerun. Seven existing Markdown
findings in private issue drafts remain. No owner restart or hook replay occurred.

`ruflo-aidefence-schema` exposes the existing `aidefence_scan` input bound for
[#4886](https://github.com/ruvnet/ruflo/issues/4886). Its input description states
the maximum of 10,000 UTF-16 code units (`JavaScript string.length`), and its
schema adds `maxLength: 10000`. JSON Schema counts Unicode code points, so native
validation remains authoritative: supplementary Unicode can pass the schema
bound but exceed the UTF-16 limit. The patch checks the exact native validator
before installation and refuses an unqualified change to that bound.

This changes schema metadata only. The handler, detector, native refusal, PII
results and supplied text remain unchanged. It neither truncates nor splits
input; separate scans do not establish a whole-document verdict. Focused tests
exercise BMP and supplementary Unicode boundaries, exact detector input,
unchanged threat/PII results and composition with the configuration patch.
Retirement requires a qualified native schema that accurately advertises the
same bound. Existing clients must refresh their tool registrations to see it;
installation alone is not proof that a cached client exposes the new metadata.

Release 4.46.178 is installed in six laptop and eight HZ copies. Fresh native
MCP `tools/list` checks on both hosts expose the bound, and the owned check clients
exited. Cached client refresh and unrelated owner activation are not claimed.
All 143 code suites passed; the full command still reports seven existing
Markdown findings in private issue drafts. The changed README and Linux focused
suites pass. No live detector call, learning write or owner restart was needed.

`ruflo-aidefence-config` repairs the MCP configuration gap in
[#4785](https://github.com/ruvnet/ruflo/issues/4785). Set
`RUFLO_AIDEFENCE_PACKS=false` in the environment of the Ruflo process that executes
security tools to select upstream's built-ins-only mode. `true` enables the native
packs; omission preserves the upstream default. The legacy patch refuses other
values, including an empty string. Restart the executing server after changing it.

Release 4.46.172 recognizes the qualified native Ruflo 3.72.2 selector and complete
loader without modifying them. Native selection also accepts empty/whitespace
as omission, case-insensitive booleans and validated comma-separated pack names.
It reads configuration at lazy construction and caches the successful instance;
the legacy patch captures configuration at module evaluation. Exact source-boundary
checks and tests cover all three factory paths, invalid values and unchanged
install/uninstall. Older packages retain the legacy patch; unknown source refuses
qualification. This does not change any deployed detector configuration.

This selects the existing `createAIDefence({ packs })` option consistently in all
three initialisation/retry paths. It leaves built-in detection, PII and learning
enabled, and changes no caller arguments, regexes, thresholds or tool schemas.
Disabling packs removes their additional obfuscation, encoded-input and other
pack detections; it does not promise that every remaining false positive disappears.
Where clients forward tools to a shared native owner, configure that owner rather
than only the client. The mod's `guard` option controls learning-sample admission,
not AIMDS packs. Retire this patch when upstream exposes equivalent validated
server configuration and passes the same initialisation and native scan tests.

## Native controller inventories

`ruflo-controller-inventory` binds existing public AgentDB methods through the
current Ruflo owner for [#4707](https://github.com/ruvnet/ruflo/issues/4707):
`agentdb_pattern-list`, `agentdb_skill-list`, `agentdb_skill-get`, and explicitly
count-only `agentdb_hierarchical-stats`. [#4712](https://github.com/ruvnet/ruflo/issues/4712)
adds `agentdb_hierarchical-list` and `agentdb_hierarchical-get` inside the existing
native TieredMemoryStore owner. Native pages retain their records, totals,
limit and offset; concurrent pages are not a transactional snapshot. Skill reads
preserve native backend refusals. Tier statistics describe runtime representations
and retain native durability/fallback qualifiers; statistics alone are not a
persisted-record census. The patch uses the canonical registry and native
operation lease, creates no driver or storage, and exposes no mutations.

Tier inventory defaults to `state: all`, including persisted expired, future and
superseded history; it preserves original IDs, keys, values, tier, timestamps and
temporal fields. It reads the durable table through that store's existing handle,
so bounded recall maps, duplicate keys and archive caps cannot hide persisted rows.
`limit` (1 to 500), `offset`, optional `tier` and `state` filter pages in descending
timestamp/ID order. State filters overlap: expired/future follow native date parsing,
superseded requires actual `supersededBy`, and active means nonarchived, nonsuperseded
and temporally valid; it does not mean a recall-map winner. Archive and temporal
flags remain separate. Exact reads accept stable `id` only and return historical
records too; confirmed absence differs from unsupported or failed reads.

Each list call scans all matching metadata in batches of 500 and fetches only the
requested page's payloads. `asOf` (epoch milliseconds) fixes temporal evaluation
across pages, not concurrent data: records, totals and offsets remain live reads,
not a snapshot. Volatile stores refuse inventory. Recall semantics are unchanged.

Retire only after equivalent upstream methods pass native owner identity,
pagination, exact read, failure and actual-consumer checks. A matching method name
alone is not retirement evidence. Installation does not reload an already running
MCP owner; activate through its normal graceful lifecycle and verify new schemas.

## Selective native pattern withdrawal (v4.46.61)

The new `ruflo-pattern-withdrawal` target exposes administrative exact
`agentdb_pattern-get` and hash-guarded `agentdb_pattern-delete` through the native
MCP owner. It reuses the public ReasoningBank controller API, canonical store and
operation lease, with no ordinary-memory or SQL fallback. Exact reads and deletes
refuse a registry whose actual bound path differs from the configured canonical
path (before opening it), or whose implicit and explicit lookups return different instances. Deletion refuses an
optional vector backend whose public removal behavior is unqualified. The exact
body check and synchronous controller calls do not establish cross-process CAS.
Fresh native identity and absence checks remain necessary before source cleanup.
The standard read/destructive annotations are retained on the descriptors; the
current Ruflo tool catalogue does not forward them. These administrative tools
do not belong in a read-only business knowledge facade.

This newly observed gap relates to [#3450](https://github.com/ruvnet/ruflo/issues/3450)
and [#829](https://github.com/ruvnet/ruflo/issues/829); it does not claim either whole
issue fixed. Retire this target after upstream exact get and guarded deletion are
qualified against the intended native controller and its consumers. Explicit
source bindings remain supported; default ownership follows upstream as described below.

## Native controller storage ownership

The `memory` target preserves upstream's default native `agentdb-memory.db`
owner alongside the distinct CLI/sql.js `memory.db` owner (#2786/#3155).
`CLAUDE_FLOW_DB_PATH` binds the ordinary memory API and user memory
(#2105/#3196). It does not select the implicit controller store: upstream derives
that sibling from its memory root independently. Public bridge calls with an
explicit `dbPath` still preserve that exact authority. Ordinary memory records
can live in AgentDB too.

Explicit graph reads and their encryption check follow that configured path too
([#4291](https://github.com/ruvnet/ruflo/issues/4291)); an omitted binding retains
the native `memory.db` graph default. This does not redirect implicit controllers.

Version 4.46.58 changed the unencrypted default to memory.db. The replacement
recognizes the historical default and explicit one-file overrides and withdraws
both through native behavioral proof, without moving data. Existing combined corpora, aliases and long-running clients require
separate reconciliation and controlled activation. Installation is not migration.
The stale-client detector recognizes global `bin/ruflo` aliases and changes to
bridge/controller/MCP modules, reports affected clients and never kills them.

For migration recovery, `ruflo memory backup --native-only` requires an online
snapshot. Older patched releases return `method: sqlite-online-backup`; native
3.59.1 returns `method: native-online-backup`. A native failure refuses
image-copy fallback (#4287). Legacy encrypted-image backup behavior remains available
without that explicit option. Qualify preservation and actual readers before cutover.

[#3143 is closed as completed](https://github.com/ruvnet/ruflo/issues/3143#issuecomment-6264174018)
after native 3.57.0 multi-store acceptance and isolated lifecycle proof. That closes
the registry-identity defect; fleet reconciliation and activation remain separate.
[The native-backup fallback defect is now closed upstream](https://github.com/ruvnet/ruflo/issues/4287).
The explicit native-only extension remains separately required as recorded above.
Its forwarding is tested against the native command parser, including the
normalized `flags.nativeOnly` property.

## Compatibility qualification of 2026-10-15 (v4.46.57)

Source-patch **4.46.57** repairs compatibility with the installed global Ruflo/CLI
**3.56.9**, npx CLI **3.56.10**, Ruflo Core **0.2.11**, ADR plugin **0.5.8**,
and Brain **4.7.6**. The dated audits below remain historical evidence.
GitHub reports **113 linked issues: 85 closed, 28 open**; states and latest comments
were fetched for every linked issue. Issue closure is not a retirement proof.

| Target | Qualified disposition | Upstream mapping |
|--------|-----------------------|------------------|
| `memory` | Keep the native 3.56.10 bridge untouched. The isolated retirement harness now supplies its new `search-defaults.js` dependency; canonical paths, aliases, isolated failures, retry and draining shutdown pass. Other memory safety components remain separately required. | [#3143](https://github.com/ruvnet/ruflo/issues/3143), open |
| `cwd` | Support neural persistence's `getProjectCwd()` call and both modern claims-config paths through the existing project-root resolver. Nested-directory regression covers both stores. | [#2633](https://github.com/ruvnet/ruflo/issues/2633), open |
| `ruflo-learning-stats` | Accept Ruflo 3.57's proven native cooperating counter lock; older overlays use the same canonical lock path. Failed flushes retain increments; retries do not duplicate them. Incomplete future counter composition reports `unavailable` rather than throwing `ReferenceError`. The exact previous health-line composition remains recognized for safe upgrade. | [#4217](https://github.com/ruvnet/ruflo/issues/4217), closed native counter-race fix; [#2245](https://github.com/ruvnet/ruflo/issues/2245), closed historical reporting scope |
| `ruflo-wrapper-guard` | Preserve native detached-execution/concurrency options while retaining direct installed CLI selection. Old hook formats remain reversible. The native CLI branding wrapper remains unchanged. | [#3306](https://github.com/ruvnet/ruflo/issues/3306), closed for native wrapper scope |
| `adr-io-safety` | Historical 4.46.57 normalized 0.5.8 imports. The subsequent audit withdraws that normalization: modern scripts retain their native shared resolver and verifier, with residual exact store binding, write readback and unsafe-reindex refusal. | [#3097](https://github.com/ruvnet/ruflo/issues/3097), [#3147](https://github.com/ruvnet/ruflo/issues/3147), open |
| `brain-wrapper-ownership` | Accept reviewed native 4.7.6 ownership behavior without overlaying its installer. The source-bound isolated proof covers current/prior wrapper acceptance and edited, foreign-owner/path, hardlink, symlink, directory and indirect-namespace refusal. Legacy published-hash compatibility remains for older installer copies. | [#420](https://github.com/stuinfla/ruvnet-brain/issues/420), closed in 4.7.21; native ownership retained |

The first 4.46.56 installation exposed an additional upgrade-path defect: the old
partial statistics rendition was not classified as owned before backup selection.
4.46.57 recognizes that exact historical health line and tests a real sandboxed
install over the old partial state, requiring the pristine backup to stay identical.
The affected idle local npx package was preserved as source evidence and refreshed
through npm at the same 3.56.10 version before reapplication. No project memory was
part of that package refresh.

The counter defect was real: native 3.56.10 uses atomic rename but performs an
unlocked read/merge/write. A deterministic isolated two-writer interleaving retained
one of two increments; the dedicated upstream report is
[#4217](https://github.com/ruvnet/ruflo/issues/4217). Before this release, our partial composition also referenced
undefined `counterPersistenceError`; this release covers both boundaries.

Ruflo 3.57.0 now supplies a native cooperating counter lock. Release 4.46.63
accepts that writer after behavioral proof and makes older patched writers use
the same canonical `.lock` path. A separate real-helper test runs six concurrent
native/legacy writers, including directory aliases and held-lock retry. Historical
overlays remain exactly reconstructible for pristine restoration. The new native
session-directory containment guard also follows the helper's project root when
launched from a nested directory, retaining its symlink refusal.

Release 4.46.64 accepts the exactly qualified Ruflo 3.57.0 native bounded
policy runtime and security 3.0.5 engine. The opt-in native proof preserves 5,000
original receipts through legacy expansion, verifies the complete native audit,
checks a subsequent native write/prune, and rejects missing history. Existing
local segmented policy data requires explicit `scripts/policy-native-restoration.mjs`
conversion through its legacy native transaction owner, with private originals
and trust backups. Installation never performs this data conversion.

Additional upstream dispositions:

- [#3688](https://github.com/ruvnet/ruflo/issues/3688) is closed via
  [#4050](https://github.com/ruvnet/ruflo/pull/4050). Swarm 0.3.7 has a native
  Codex-specific empty-hook declaration. Whole-target retirement is still refused:
  only 2 of 54 discovered plugin copies have that reviewed native declaration;
  the target also covers other plugins and legacy copies.
- [#4040](https://github.com/ruvnet/ruflo/issues/4040) is closed via
  [#4044](https://github.com/ruvnet/ruflo/pull/4044). Native child-process header
  recognition already exists in our patch release; retain the two-process
  regression and legacy-only compatibility.
- [#3164](https://github.com/ruvnet/ruflo/issues/3164) remains open. Its October 13
  report describes a 75 MB policy ledger, lock timeouts and abandoned temporary
  files on unmitigated installs. The ledger components remain necessary.

The legacy initialization fixture now finds the supported `maybeInstallSkillsSh`
function rather than requiring a removed opt-out spelling. It still tests native
bounded skill materialization and old external-import suppression, rather than
skipping those assertions. `current-compatibility` adds current-shape counter,
composition-upgrade and nested-root checks. Tests use disposable files and native
API/fake-driver boundaries; no live database, lock or sidecar repair is involved.
`npm test` passed all **87 suites**, including the previously failing initialization
fixture. Markdown validation passed. Installed-source application and live
consumer checks are reported separately from these fixture results.

Verified local installation of the immutable **v4.46.57** tag completed with no
incomplete targets; the pinned-tag `monitor check` reports **live, no drift**.
Fresh native MCP owners for global 3.56.9 and cached 3.56.10 both returned unified
learning statistics with `counterWriter.contract = delta-lock-v1` and no writer
error. Semantic-product's new memory value survived exact readback from a second
fresh MCP owner; native Codex metadata reports all **28 hooks enabled/trusted**.
This verifies those fresh consumer paths and the local installed source set;
existing conversations and remote hosts were not restarted or qualified by this run.

## Fleet activation of 2026-10-15

Live registry recheck at 11:40 UTC: **Ruflo/CLI 3.56.10**, **Brain 4.7.6**.
All seven hosts now select those versions and source-patch **4.46.57**. Brain's
native active generation was already current on every host; no manual Brain
promotion, KB replacement or update-plane modification was needed.
Both Mac npm prefixes were updated, including the executable actually selected by
project MCP configurations. Global patch CLIs and the scheduled stable copies
also select 4.46.57. Each host's pinned-tag `monitor check` reports no drift.

| Host | Native root MCP consumers reporting 3.56.10 | Project memory write/exact-readback | Enabled/trusted hooks |
|------|------------------------------------------:|-----------------------------------:|----------------------:|
| Mac | 7 | 7 | 196 |
| HZ | 1 | 1 | 27 |
| GCP Builder | 1 | 1 | 28 |
| GCP PLM | 1 | 1 | 27 |
| GCP Fabric | 1 | 1 | 27 |
| GCP Oxigraph | 1 | 1 | 27 |
| GCP Query | 1 | 1 | 27 |

Native Brain source searches and allowed exact-key shared user-memory reads passed
on every host. All 13 project consumers returned the serialized counter contract
without a writer error. These are bounded runtime checks, not acceptance tests for
every research programme or learning controller.

Activation used the existing Codex daemon's native queued MCP refresh, with no
programme stop/resume, process suspension or daemon restart commands. The user-level
rollout stamp is authoritative. Five obsolete Mac project stamp overrides were
removed after verifying other configuration was unchanged, preventing those projects
from silently retaining older MCP owners on the next global upgrade. Provider/model
and permission settings were preserved; unrelated OPDA working-tree edits remain.

**Verification boundary:** 25 loaded child threads received the queued refresh but
reject direct app-server tool input under the native multi-agent v2 policy. Their
individual execution versions were not independently verified, and no child turn
was forced to obtain a check. Successful root checks do not erase that limitation.
Private receipts are retained under
`~/.ruflo-source-patch/diagnostics/fleet-upgrade-20261015/`, including `summary.json`.

## Upstream audit of 2026-10-10

**Career qualification (v4.46.55):** Ruflo 3.56.9 names its Codex marketplace/install deadlines. The existing #2854 host-discovery patch now matches that rendition and preserves its 180/60-second deadlines.

**OPDA qualification (v4.46.54):** Ruflo 3.56.6 includes the #4040 child-process header fix; exact native-source recognition and the two-process WAL regression accept it without local edits. Core 0.2.8 still needs #3306 hook selection; its new `npx --prefix` isolation is preserved by the patch.

**Recurrence follow-up:** [Ruflo #4040](https://github.com/ruvnet/ruflo/issues/4040)
reproduces graph encryption header sniffing dropping a live native owner's POSIX
locks. The `memory/graph-header-process` patch runs the bounded header read in a
fresh exec process, retaining encryption detection without closing a raw database
descriptor in the SQLite owner. A two-process native regression proves the original
WAL deletion and patched WAL identity plus exact cross-process readback. Retire only
after the upstream header path passes that regression. This prevents the reproduced
trigger; it does not repair an already-detached live connection or prove data loss.

Reviewed the 109 distinct issue links in this README, their current state and available
comments: **83 closed, 26 open**. Issue labels in the target tables are this dated
snapshot, not retirement decisions. CLI qualification uses published **Ruflo and
@claude-flow/cli 3.56.3**; Brain executable qualification now includes published
**4.6.2**, with old-generation compatibility retained. Live selected-generation,
KB and host-convergence checks remain separate from source qualification.

- **Native components accepted:** #3306's exact wrapper dependency pin and native
  version-mismatch warning; #3143's canonical per-store identity, isolated failures
  and draining shutdown. The wrapper and bridge components stay native. Other
  lifecycle-wrapper and memory-safety components remain independently qualified.
- **Still needed:** project-root defaults (#2633), plugin/host reconciliation
  (#2640/#2854/#2870), model/instruction contracts (#3215/#3153), ADR safe I/O
  (#3097/#3147), and the segmented policy ledger (#3164). Native 3.56.3 does not
  provide a proven importer for our already-migrated receipt segments.
- **Closed issues with residual scope:** #3691 rejects failed writes natively but
  still needs exact pattern readback; #3693 has native binding fixes but remaining
  distillation/other opens need the shared SQLite owner. #3229's candidate-policy
  repair does not encode nested fractional evidence. Learning/statistics/context
  patches retain their separate reporting and evidence contracts.
- **Brain:** native replacement proofs pass for grounding evidence/code, router
  imports, transition notices/validation, managed CLI capture/diagnostics/generation,
  progression collision, streaming, continuity summaries and operator suspension.
  At that audit #390 remained open. It closed in October after upstream removed
  full-history progression in 4.7; this does not authorize replaying old queues. The
  #425 completion feature remains deliberately wired off; unrelated gates remain.
- **Historical retirement limits:** the old Console provider/root probes expect a
  removed KB Console directory, and the original Codex lifecycle predicate does
  not qualify the current declaration shape. These historically retired targets
  are not re-enabled and are not counted as newly verified native replacements.
- **Compatibility repairs:** extracted memory-root caller, append-condition import
  in the native bridge probe, native secondary policy anchors, immutable anchor
  snapshots, and the previous ADR edge-parser overlay. Old finite-number receipt
  implementations are verified unchanged; they predate the scale-12 contract.
  Brain installer discovery follows native generation selection and target-specific
  ownership, without changing the updater or its assets. MCP-prefix retirement
  distinguishes the known upstream legacy-prefix assertion from executable calls.

Qualification covers source composition, reversible fixtures and native contract
probes. Fleet installation and live MCP activation are separate checks; source
qualification alone does not certify a running process or a project programme.

## Brain automatic-update repair (#420)

Release 4.46.164 adds `brain-codex-input` for
[Brain #525](https://github.com/stuinfla/ruvnet-brain/issues/525). Brain's native
Codex wrapper consumes split stdin chunks twice, corrupting full-document hook
payloads even when the search itself succeeds. Small one-chunk results can still
renew grounding, masking the defect. The patch removes the redundant `data`
subscription and retains the native readable/polling path, input cap and deadlines.
It changes no grounding rules or stamps. Installation requires an exact qualified
reader and preserves the stable executable's exact retained-generation owner;
native updates, selection and KB assets remain untouched. Unknown bytes refuse.
Run `npx github:sparkling/ruflo-source-patch brain-codex-input install`.
Regression coverage includes the original split-pipe failure, unchanged UTF-8,
complete JSON without EOF, polling, malformed/oversized input, exact reversal and
stable ownership. Windows pipe behavior has not been exercised on Windows.
Installed bytes and live full-document search/write admission are verified separately.

**Live verification, 7 November 2026:** v4.46.164 is installed on Mac and HZ,
with six wrapper copies patched per host, exact stable/retained ownership, 346
matching stable library files, and all 13 Brain hooks trusted. The same native
12,453-byte full-document search that previously left grounding unchanged renewed
the HZ MetaHarness stamp at 08:58:23.746753 UTC. Evaluating the registered write
gate with the original refused Query payload then returned exit 0; no application
write was dispatched. Project owners retain continuation and runtime custody.
Focused Mac/Linux and affected composition regressions pass. The full run retains
two existing fixture failures (`ruflo-tier-consolidation`, `cwd-session-current`);
Mac's unrelated AIDefence configuration drift remains outside this repair.

`brain-wrapper-ownership` accepts reviewed Brain 4.7.6 native ownership without
modification. For older installers, it repairs rejection of their own older Codex bridge. It accepts only exact SHA-256 hashes independently verified
against published v4.5.16 and v4.5.17/v4.6.0/v4.6.1/v4.6.2 wrapper bytes. The existing
path, owner, regular-file, hardlink and symlink checks remain mandatory; an edited
bridge remains a conflict. The patch does not replace the bridge itself, select a
generation, change KB data, alter update schedules or forge convergence receipts.
Brain's native updater performs those operations. The target covers installed
installer copies, including the newer installer needed to upgrade an older active
generation; the normal patch monitor maintains it.

Retire this target only after pristine upstream code accepts a genuine previous
release's wrapper and still refuses edited/foreign/indirect bridges. A closed
issue alone is insufficient. Regression fixtures reproduce the native failure,
exercise both published hashes and negative ownership cases, and prove exact
reversal and source-drift refusal. Live fleet update results are verified
separately from these fixtures. Native 4.6.1/4.6.2 suspension/collision/capture proofs
retain the upstream implementation; their isolated test dependency graph and
reviewed deadline-aware source boundaries were updated. Grounding qualification
now tests native session/turn/nonce-bound search evidence and rejects unrelated
product claims, matching the stronger upstream contract.

Live rollout on 2026-10-10 selected Brain **4.6.2** on Mac, HZ and all five GCP
hosts, using source-patch **v4.46.51** and Ruflo **3.56.3**. Native Codex hook
trust was verified for all 19 declared Brain hooks; standing operator consent is
recorded through Brain's `automaticHookTrustUpdates` setting. Native MCP reload
and root-thread searches are checked separately; inactive child threads are not
claimed as verified consumers. Existing programmes were not paused.
All seven hosts subsequently produced **SUCCEEDED nightly** receipts through their
registered native runner; Brain doctor returned `ok: true` on all seven. Patch
monitor checks passed. This verifies the current update path, not future releases
or each project's database integrity. Oxigraph's two abandoned empty temporary
receipts were archived intact with explicit operator authorization before native
cleanup; PLM's GitHub rate-limit failure cleared on a later native retry.

Remaining upstream update observations are tracked separately:

- [Brain #401](https://github.com/stuinfla/ruvnet-brain/issues/401): stale cached
  corpus evidence can call an older release newer than the installed corpus.
  This advisory does not negate a successful signed upgrade/nightly receipt.
- [Brain #434](https://github.com/stuinfla/ruvnet-brain/issues/434): abandoned
  native receipt temporary files block lifecycle retention; native `--clean`
  refuses them too. Update/cache-plane code is not patched by this repository.

The nightly registration remains Brain-only, using the native scheduler's
`developerSuite: false` option to preserve the previous scope. Native updater
receipts, not the presence of a scheduled job, establish successful execution.

## Historical audit from 2026-09-19

The following records that audit's artifacts and findings, not today's fleet state.

The 2026-09-19 audit used the installed Ruflo 3.42.4, ruflo-core 0.2.6,
MetaHarness 0.10.2, and Brain's natively activated 4.3.10 generation. The
existing retired targets remain retired on their per-target behavior proofs;
no additional target passed its native-replacement proof. Ruflo's partial
`memory_stats` repair, ruflo-core's renamed hook lookup, and Brain's added
`ruvnet_registry_latest` dispatcher route changed exact source shapes without
closing their respective residual gaps. The three active patch transforms were extended to
recognize those shapes. A newer Brain registry version is not treated as an
activated generation or as evidence that an installed patch may retire.
Brain 4.3.10 also deliberately ships an empty Codex lifecycle-hook registry;
the legacy `codex-hooks` target retires on that exact declaration and does not
recreate implicit hooks that Brain has withdrawn.
On the Mac host, a later native Brain KB refresh also fixed the `symbolRoute`
inherited-key crash and moved MCP/CLI outage guidance to a shared diagnosis-first
helper. `brain-search-safety`'s retirement contract requires executing the route probe and
proving both callers use that safe helper; a missing or permissive helper fails closed.

```bash
npx github:sparkling/ruflo-source-patch <target> <action>
```

The **first argument is the target**, the second the action. Every target installs and
uninstalls **on its own**. Take the daemon fix without the SQLite write lock, drop one later,
keep the rest.

## Learning-statistics repair

`node bin/cli.mjs ruflo-learning-stats install` applies the remaining
[#2245](https://github.com/ruvnet/ruflo/issues/2245) reporting repair: it reads the
coordinator's real buffer fields, distinguishes persisted counters from process
snapshots, reads retained ReasoningBank patterns independently, names `models.json`
correctly, reports unreadable stores as unavailable, and includes singular `pattern`
in the memory summary. It never trains, deletes or moves learning records.

Counter persistence now commits each process's pending increments against the
latest file under a bounded lock and an atomic rename, rather than overwriting
newer totals with a stale process snapshot. Repeated flushes do not double count.
Malformed data, path changes and a busy lock refuse the write and retain pending
increments; `counterWriter.lastError` exposes that process's failure. Locks are
never stolen and old sessions are never killed. A process that exits before a
successful flush can still lose pending increments; this is not a durable event
ledger. Legacy writers must reconnect, and previously overwritten historical
totals cannot be reconstructed by this repair. The counter-writer test exercises
six concurrent processes, retries and refusal paths.

The old `sona.patternsLearned` field remains a labelled compatibility alias for
retained ReasoningBank count. Cross-scope equality fields return `null`, not a
false health verdict. `reportingContract: store-scoped-learning-stats-v1` identifies
the repaired result. Existing host-owned stdio MCP sessions must reconnect to load
changed modules; installation does not kill them. Retirement requires the installed
native source to pass `test/ruflo-learning-stats.mjs`'s persistence, scope, source
and error scenarios without the patch; unknown changed anchors fail visibly.

## Live-WAL memory statistics

`ruflo-memory-stats` fixes [Ruflo #3311](https://github.com/ruvnet/ruflo/issues/3311):
retrieval/search can work through AgentDB while `memory_stats` fails at an unrelated
raw sql.js initialization probe. The patch reuses the CRUD registry's existing
database handle and aggregates all active/legacy-NULL entries in one statement.
It does not open another driver, initialize schema, checkpoint, close the borrowed
handle, or alter the raw-WAL protection. Counts are no longer capped at 100,000;
arbitrary namespace names are safe. Failures return explicit errors and null counts,
not a falsely empty/uninitialized database. Embedding presence is not HNSW readiness.

```bash
npx github:sparkling/ruflo-source-patch ruflo-memory-stats install
```

`reportingContract: registry-memory-stats-v1` proves the repaired handler is loaded.
Existing host-owned MCPs need a supported reconnect; installation never kills them.
Retirement requires equivalent native behavior for the scenarios in
`test/ruflo-memory-stats.mjs`, not issue closure alone. Unknown source changes fail
visibly instead of being rewritten speculatively.

In the 2026-09-19 audit, Ruflo 3.42.4 included a partial native #3311 fix: a working listing
was no longer overruled by the raw initialization probe. It still enumerated the store for
statistics and supplied unproved fallback feature/version labels, so this target
remained active on that artifact. Its exact handler is supported alongside older source shapes;
current installed behavior must pass the retirement probe independently.

## Native graph work withdrawn

At the user's request, v4.45.0 removes `ruflo-graph-persistence` and
`ruflo-graph-retrieval` from the release and monitor target set. Their implementations
and tests are preserved on [archive/native-graph-20260913](https://github.com/sparkling/ruflo-source-patch/tree/archive/native-graph-20260913).
This is a user-directed rollback, not an upstream-fixed retirement:
[Ruflo #3313](https://github.com/ruvnet/ruflo/issues/3313),
[#3315](https://github.com/ruvnet/ruflo/issues/3315),
[#3202](https://github.com/ruvnet/ruflo/issues/3202), and
[RuVector #984](https://github.com/ruvnet/RuVector/issues/984) remain relevant.

Reapplication reconstructs the affected files from their pristine backups while
preserving unrelated targets, including project-root anchoring and context synthesis.
Upstream native-first k-hop routing and its original graph constructor return;
this does not disable Ruflo's own native graph feature or repair its known limitations.
No graph/SQL store, sidecar, retained relationship or diagnostic record is deleted,
migrated or replayed. Running MCP modules need an owner-controlled reconnect to
load the rollback; the installer and monitor do not kill them.

## Context synthesis contract

`ruflo-context-contract` retires on qualified current native code for
[Ruflo #3314](https://github.com/ruvnet/ruflo/issues/3314). Pristine CLI 3.71.1
passes real task/success/reward/critique values to AgentDB's ContextSynthesizer,
awaits both recall interfaces, and distinguishes no matches from no eligible
outcomes without inventing episodes from prose. Twenty isolated native cases
cover outcomes, zero reward, empty/fact/malformed inputs, partial eligibility and
errors using the actual pure controller.

The former downstream JSON arbitration and semantic-copy lineage algorithm are
withdrawn with `ruflo-tier-consolidation`. Native consolidation remains explicitly
unsupported. Historical semantic copies and selected-learning patterns are not
deleted or rewritten; separately recalled copies may count separately under
native synthesis. Current qualification does not silently backport new behaviour
to unqualified old sources. Exact reverse transforms preserve safe removal of
known released overlays, and unknown source changes fail visibly.

Installation changes source files, not modules already held by host-owned MCPs.
Those owners need a supported reconnect to activate changed modules; closing the
Codex TUI alone is not proof of reconnection. No MCP is killed by these targets.

The separate `ruflo-context-guidance` target fixes
[#4691](https://github.com/ruvnet/ruflo/issues/4691): the MCP description,
`ruflo-goals` research-synthesize skill and `ruflo-core` researcher agent still
direct ordinary documents and graph findings to episode-outcome synthesis.
It routes research to source-owned search and exact namespace/key readback, and
reserves `agentdb_context-synthesize` for validated task, reward and success data.
The executable handler, matching, eligibility, limits and result shapes stay
unchanged. An original episode query may still correctly return no matching or
eligible episodes; a consumer expecting document synthesis must adopt the corrected
contract rather than treating the patch as a promise of a successful synthesis.

```bash
npx github:sparkling/ruflo-source-patch ruflo-context-guidance install
```

The existing composition engine preserves pristine bytes and exact uninstall.
Both host marketplaces and their selected plugin caches are covered. Unknown
anchors refuse the target. It retires only when all three discovered native
surfaces carry the verified corrected guidance without local markers; different
upstream wording requires review. Existing MCPs and already-loaded skills need
their normal host refresh before the changed guidance becomes visible.

## Wrapper/runtime mismatch guard

Tracked upstream in [Ruflo #3306](https://github.com/ruvnet/ruflo/issues/3306).
The historical reproduction documented on 2026-09-12 reported `ruflo@3.41.2` while its wrapper
executed `@claude-flow/cli@3.33.0`. The published wrapper dependency, `^3.33.0`, permits
that combination; the wrapper's version output alone does not identify the
implementation running an MCP server. This is an observed installation, not a
claim that every fresh install resolves the older runtime.

`ruflo-wrapper-guard` now restores the `ruflo` command instead of refusing it.
For older affected wrappers, each invocation compares installed stable `@claude-flow/cli` package versions
numerically and delegates to the newest implementation's native `bin/cli.js`.
This includes `--version`: it reports the implementation's version, not the
branding package's version. The old refusal patch upgrades in place; pristine
upstream bytes remain available for uninstall. Unknown vendor source is reported
incomplete and left untouched.

Ruflo 3.56.3 instead retains its verified native wrapper unchanged: its manifest
pins the matching CLI exactly and its mismatch warning names both versions. Native
argument forwarding, MCP dispatch and version reporting are fixture-tested. This
is component retirement; older cached wrappers and lifecycle shims remain covered.

Ruflo-core 0.2.6 renamed the hook's lookup to `resolveCommandPath` without
changing its wrapper-first selection. The guard recognizes that exact source
and restores its original bytes on uninstall.

```bash
npx github:sparkling/ruflo-source-patch ruflo-wrapper-guard install
npx -y ruflo@latest --version
```

No global Ruflo or CLI installation is required. The native MCP launcher remains
`npx -y ruflo@latest mcp start`. Explicit `ruflo-wrapper-guard install` (including
`all install`) and dual initialization repair only the known old #3306 global
launcher signatures when their target is missing. They restore npx with at least
the upstream 120-second startup timeout and save a private, mode-0600 config backup.
Healthy, custom, and disabled registrations and unrelated settings are preserved;
ambiguous configurations and linked config files are refused. Ordinary monitor and
SessionStart patch reapplication does not perform this migration or start MCP servers.

**Newest installed is not an automatic npm update.** The wrapper examines its
own installation, effective-account user prefixes, the Node prefix, absolute
npm prefixes on PATH, and an explicit npm prefix. It does not consult project
cwd or project `node_modules/.bin`, scan unrelated npx caches, download packages,
or opt into prereleases. Normal npx package resolution supplies the implementation;
the next wrapper invocation selects installed versions without another patch.
Equal versions use a deterministic top-level-first tie break. Package name/type/bin
and regular in-package entrypoints are checked. Malformed candidates or a broken
selected newest installation fail visibly instead of silently choosing an older CLI.

Delegation uses the same Node process and literal arguments: no shell, subprocess
proxy, branding interception, or extra stdout. Native CLI code owns stdin, MCP
framing, signals and exit status. CLI-only instructions naming `ruflo` work again;
normal memory/coordination work remains MCP-first. Healthy direct CLI/MCP launch
configurations are preserved; only the missing legacy launchers described above are
repaired. Known lifecycle shims call the
implementation package through `npx --prefer-offline --yes @claude-flow/cli@latest`,
the way ruflo-core's MCP launcher does; they never run the `ruflo` wrapper or a PATH
binary, and they keep upstream's exit-0 best-effort contract.

The target covers identity-checked global/npx wrapper packages and known
Claude/Codex Ruflo hook copies through SessionStart and the monitor. It does not
modify databases, kill processes, or replace modules already loaded by an MCP.
New wrapper launches activate immediately; existing MCP transports are untouched.
Retirement requires verified upstream behavior preventing misleading runtime
selection and hook fallback, not merely closure of the issue. Regression coverage:
`test/ruflo-wrapper-guard.mjs` and `test/ruflo-wrapper-runtime.mjs`.

## Contents

- [Historical audit from 2026-09-19](#historical-audit-from-2026-09-19)
- [Install](#install)
- [Targets](#targets)
  - [Patch targets](#patch-targets)
  - [Plugin patches](#plugin-patches)
    - [Hook failure diagnostics](#hook-failure-diagnostics)
    - [Ruflo persistence and policy](#ruflo-persistence-and-policy)
    - [ruflo-adr](#ruflo-adr)
    - [Ruflo plugins under Codex](#ruflo-plugins-under-codex)
    - [Ruflo instruction generators](#ruflo-instruction-generators)
    - [ruvnet-brain](#ruvnet-brain)
    - [MetaHarness under Codex](#metaharness-under-codex)
    - [all ruflo plugins](#all-ruflo-plugins)
  - [Script targets](#script-targets)
  - [Monitor](#monitor)
- [The patches in detail](#the-patches-in-detail)
  - [cwd](#cwd)
  - [daemon](#daemon)
  - [memory](#memory)
  - [adr-template](#adr-template)
  - [adr-index](#adr-index)
  - [adr-io-safety](#adr-io-safety)
  - [adr-reindex](#adr-reindex)
  - [verify-interface](#verify-interface)
- [The script targets in detail](#the-script-targets-in-detail)
  - [dual](#dual)
  - [plugin-only (dedupe)](#plugin-only-dedupe)
  - [codex-switch](#codex-switch)
- [The monitor](#the-monitor)
- [How you find out when a patch stops working](#how-you-find-out-when-a-patch-stops-working)
- [How a patch retires itself](#how-a-patch-retires-itself)
  - [Publish a predicate, not a verdict](#publish-a-predicate-not-a-verdict)
  - [The failure direction](#the-failure-direction)
  - [What you see, and what you can do about it](#what-you-see-and-what-you-can-do-about-it)
- [How the update reaches you](#how-the-update-reaches-you)
  - [The tick pulls it, not the hook](#the-tick-pulls-it-not-the-hook)
  - [Tags, never the branch](#tags-never-the-branch)
- [How you find out when a patch stops working](#how-you-find-out-when-a-patch-stops-working)
  - [Anchors are literal, and they will break](#anchors-are-literal-and-they-will-break)
  - [Two hooks, and the honest reason for each](#two-hooks-and-the-honest-reason-for-each)
  - [Watching the watchman](#watching-the-watchman)
  - [It found two real bugs on its first run](#it-found-two-real-bugs-on-its-first-run)
- [cleanup](#cleanup)
- [How it works](#how-it-works)
  - [One install, every repo](#one-install-every-repo)
- [Tested](#tested)
- [Upstream issues](#upstream-issues)
  - [Recent repair coverage reviewed 2026-10-05](#recent-repair-coverage-reviewed-2026-10-05)
  - [Historical upstream audits](#historical-upstream-audits)
- [Limits](#limits)
- [License](#license)

## Install

The package has **zero dependencies**, so it installs from anywhere with no npm registry
involved. No npmjs.org account, no local Verdaccio, nothing to stand up. Pick one:

```bash
# straight from GitHub (recommended; nothing to clone, always current)
npx github:sparkling/ruflo-source-patch all install       # every patch + plugin target + the monitor

# or clone (identical result — `make install` just calls `all install`)
git clone https://github.com/sparkling/ruflo-source-patch && cd ruflo-source-patch
make install
make uninstall        # revert everything and remove the package
```

`all install` applies every declared **patch** target (the CLI-composed ones and the `ruflo-adr` /
`ruvnet-brain` plugin ones) and schedules the monitor that keeps them live. It is the one-shot the
`Makefile` used to own alone; now the npx path has it too, and `make install` delegates to it so the
two can never list a different set. A behaviorally superseded target such as current Ruflo's `daemon`
target terminally retires without editing pristine vendor bytes. `all uninstall` / `all status` do the
reverse and the readout.

Ordinary composing targets install as one batch under the existing mutation lock.
The full Brain boundary and additive installers keep their lifecycle; wrapper-guard
still repairs legacy MCP registration, and hook-failure-log reconciles trust after
the final ordinary composition. For the 37 composing installs observed on HZ in
4.46.145, version 4.46.146 reduced dispatch to three full sweeps instead of 37. Retirement,
preflight refusals and incomplete/error reporting remain; standalone commands are
unchanged. The 5 November 2026 live 4.46.146 installs took 21.3 seconds on Mac and
34.1 seconds on HZ, with three complete sweeps and no changed discovered vendor or pristine
backup bytes. Concurrent SessionStart tests begun immediately after lock acquisition
still reached the unchanged 30-second wait limit: HZ waited for the installer;
Mac waited for the newly scheduled monitor after the installer released. That
release reduced installation work but did not resolve the startup-contention case.

The follow-on installer reuses the existing registration and trust helpers around
one shared composition. The monitor now shares SessionStart's fresh exact
state/file/pristine/dependency proof instead of taking another writer lock over
unchanged bytes. Retirement candidates, positive stable-copy drift and failed
composition proof retain exclusive repair. Mutable or unavailable stable sources
keep their existing no-auto-heal classification; observation does not certify
stable-source provenance. Lock ownership and the 30-second wait are unchanged.
Live 4.46.147 installation on the same hosts took 11.7 seconds on Mac and 21.2
seconds on HZ, with one shared composition and unchanged discovered vendor/pristine
bytes. Actual SessionStart processes launched within 44 milliseconds of installer
lock acquisition passed without a mutation claim or timeout. Their total durations
were 16.6 and 31.8 seconds respectively, including verification after the lock was
released; the 30-second limit applies to waiting for that lock. A subsequent actual
SessionStart from the original Strategy project also passed. The monitor's separate
protected package-maintenance step can still claim the lock. These are measured
runs, not a guarantee for arbitrary machine load or future source drift.

The **script targets stay opt-in**, because they change *your projects or user-level integrations*
rather than the patched library.
They are also the most immediately useful thing here, so don't skip past them, and `run` executes
one directly, no separate install step:

```bash
npx github:sparkling/ruflo-source-patch dual run <project>       # one instruction file for Code + Codex
npx github:sparkling/ruflo-source-patch plugin-only run . --dry-run   # strip the ~260 duplicated files + hooks + MCP registration
npx github:sparkling/ruflo-source-patch ruflo-codex-hooks run     # add canonical Ruflo hooks to an existing Codex install
npx github:sparkling/ruflo-source-patch codex-switch run copilot   # continue THIS Codex thread on the Copilot proxy
```

See [The script targets in detail](#the-script-targets-in-detail).

To pick patch targets individually instead of `all`:

```bash
npx github:sparkling/ruflo-source-patch cwd install
npx github:sparkling/ruflo-source-patch daemon install
npx github:sparkling/ruflo-source-patch memory install
npx github:sparkling/ruflo-source-patch init install
npx github:sparkling/ruflo-source-patch plugin-hosts install
npx github:sparkling/ruflo-source-patch ruflo-instruction-contract install
npx github:sparkling/ruflo-source-patch ruflo-model-contract install
npx github:sparkling/ruflo-source-patch ruflo-selective-learning install # refuse unsupported explicit selection before global learning
npx github:sparkling/ruflo-source-patch monitor install   # keeps them applied

npx github:sparkling/ruflo-source-patch all status        # what's live, everything at once
npx github:sparkling/ruflo-source-patch memory uninstall  # drop one, keep the rest
```

Requirements: Node.js ≥ 18, Claude Code with ruflo / `@claude-flow/cli` used via `npx`.

## Targets

### Patch targets

Source patches to the installed `@claude-flow/cli`.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`ruflo-learning-stats`** | Reports store-scoped learning counters honestly, reads retained patterns independently, and commits concurrent counter increments under the existing bounded lock without stale-snapshot overwrite. Pending increments remain process-local until a successful flush. | [#2245 · closed](https://github.com/ruvnet/ruflo/issues/2245) · [#4217 · closed](https://github.com/ruvnet/ruflo/issues/4217) |
| **`ruflo-selective-learning`** | Refuses supplied `hooks_intelligence_learn.trajectoryIds` before mutation because native learning ignores the selection. Omitted selection retains the native SONA path. The former custom ReasoningBank retention algorithm is withdrawn; historical patterns remain intact. | [#4693 · open](https://github.com/ruvnet/ruflo/issues/4693) |
| **`ruflo-sqlite-owner`** | Resolves native SQLite through ControllerRegistry's actual dependency owner for graph and repair/initializer handles, preventing competing native SQLite libraries from managing the same file. It neither borrows and closes the registry handle nor replaces the database. | [#3693 · closed](https://github.com/ruvnet/ruflo/issues/3693) |
| **`ruflo-context-contract`** | Retired on qualified current native outcome preservation and async recall. Restores the native function together with withdrawal of custom tier-copy lineage; historical rows remain untouched. Unknown or unqualified native sources refuse. | [#3314 · closed](https://github.com/ruvnet/ruflo/issues/3314) |
| **`ruflo-context-guidance`** | Correct the native MCP description and central research skill/agent guidance: synthesize documents from exact source evidence, reserve ContextSynthesizer for validated episode outcomes, and preserve native matching and result semantics. | [#4691 · open](https://github.com/ruvnet/ruflo/issues/4691) |
| **`ruflo-memory-stats`** | Uses the existing AgentDB registry connection instead of a raw sql.js probe; complete active/legacy-NULL and embedding-presence counts, safe arbitrary namespaces, explicit unavailable state. No WAL manipulation or competing driver. | [#3311 · closed](https://github.com/ruvnet/ruflo/issues/3311) |
| **`ruflo-memory-search-report`** | Plain search uses the existing native backend reporter instead of a hardcoded HNSW label; native bridge-disabled diagnostics, SmartRetrieval fallback warnings and search results remain intact. No retrieval algorithm or storage change. | [#2922 · open](https://github.com/ruvnet/ruflo/issues/2922) |
| **`ruflo-wrapper-guard`** | Restores `ruflo`, selects the newest installed stable CLI instead of the first older nested dependency, and delegates version/CLI/MCP behavior to that implementation. No launch-time downloads or process kills; malformed/broken selection fails visibly. Known lifecycle shims retain direct installed CLI execution. | [#3306 · closed](https://github.com/ruvnet/ruflo/issues/3306) |
| **`cwd`** | **Silent data loss and stray state.** Residual `.claude-flow` / `.swarm` state in current Ruflo still follows raw or implicit cwd in permission state/audit, swarm state, neural-weft defaults, generated helpers, hook-session state, and other durable-state paths. The target anchors the resolver, callees, and implicit-relative constants; cache identity uses the resolved absolute starting path. AgentDB vector-storage overrides were withdrawn in 4.46.95: native AgentDB storage owns those paths. Ruflo 3.38.16's native daemon resolver is recognized as satisfied and left pristine. Legacy and 3.38.16 session-end shapes atomically write the snapshot they advertise, and unknown future shapes fail loudly. A leak detector remains because textual coverage cannot prove completeness | [#2633 · open](https://github.com/ruvnet/ruflo/issues/2633) |
| **`daemon`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** **Retired on executable proof in Ruflo 3.38.11+.** Older releases need direct start/stop/status/supervisor paths normalized to one project-root lock/PID identity. Current releases export and use `resolveDaemonProjectRoot()` throughout; retirement executes nested, nested-project, `.git` stop, and no-marker behavior and rejects route/resolver mutations | [#2877 · closed](https://github.com/ruvnet/ruflo/issues/2877) · [#2633 · open](https://github.com/ruvnet/ruflo/issues/2633) |
| **`memory`** | Keeps an explicit project/user database path an authority boundary: one long-lived bridge process gets one canonical registry state per database instead of silently reusing whichever store opened first. Above Ruflo 3.38.12's native #2878 shared-lock baseline it also retains stricter token/inode-safe fail-closed lock ownership and outer fallback/bridge serialization, **WAL-sidecar refusal**, an **integrity gate**, and a **stale-writer guard**. The monitor restarts only positively resolved pre-patch daemons. It detects and reports stale MCP clients but never kills them because only their owning host can reconnect the stdio transport; `RSP_NO_STALE_WRITER_KILL` disables daemon restarts | [#3143 · closed](https://github.com/ruvnet/ruflo/issues/3143) · [#2878 · closed](https://github.com/ruvnet/ruflo/issues/2878) · [#2735 · closed](https://github.com/ruvnet/ruflo/issues/2735) · [#2584 · closed](https://github.com/ruvnet/ruflo/issues/2584) · historical [#2621 · closed](https://github.com/ruvnet/ruflo/issues/2621) |
| **`init`** | **Stops `ruflo init`/`doctor` regenerating what the plugins provide.** The durable complement to [`plugin-only`](#plugin-only-dedupe). Disables the standalone `claude-flow` `.mcp.json` emission and the `.claude/{skills,commands,agents}` bundle gates (helpers kept). **Plugin-always deployments only:** the CLI hardcodes `mcp.claudeFlow: true` with no plugin-off flag, so on a plugin machine the standalone + bundle are pure duplicates (ADR-022). The legacy #2777 edit now applies only to builds that still shell out to the whole-repository `npx skills add`; Ruflo 3.32.10+'s bounded in-process `SKILL.md` materialization is left untouched | [#2640 · open](https://github.com/ruvnet/ruflo/issues/2640) · [#2685 · closed](https://github.com/ruvnet/ruflo/issues/2685) · [#2777 · closed](https://github.com/ruvnet/ruflo/issues/2777) |
| **`plugin-hosts`** | Adds Ruflo-owned `plugins host-install`, `host-uninstall`, additive Claude-to-Codex `host-sync`, `host-update`, and bounded `host-refresh` commands. Installing or self-updating this patch automatically runs the all-installed update once through those injected commands. Normal version changes use each host's supported update/reinstall path; exact tree comparison also repairs same-version collisions. Claude user and active project/local scopes plus Codex are covered; disabled, managed, and orphaned-project registrations are preserved. Host CLIs are resolved through validated PATH/PATHEXT, effective-account and configured user roots (npm/pnpm/Volta/Bun/mise/asdf/Homebrew), plus revalidated persisted package roots, so a narrow PATH or migrated `HOME` cannot silently skip reconciliation. Stale canonical marketplace paths are repaired only through host CLIs; foreign same-named sources are refused. The bundled Codex initializer uses the same literal-argv boundary. Revision-specific fragment proof prevents an older injected body from reporting current. The patch never copies or directly edits host caches and reports partial completion as nonzero | [#2854 · open](https://github.com/ruvnet/ruflo/issues/2854) · [#2870 · open](https://github.com/ruvnet/ruflo/issues/2870) |
| **`ruflo-model-contract`** | Opens `agent_spawn.model` to an exact host-native ID while preserving Ruflo's existing non-alias `modelId` path. It keeps `hooks_model-route` as the legacy Haiku/Sonnet/Opus tier recommender, labels both router paths with `routingTier`, and declares allocation caller-owned. Astra/Fable selection therefore remains with the native executor or customised harness; a Ruflo tracking record cannot masquerade as execution proof. It uses the CLI composition engine so the routing edit and the existing `cwd` edit share one pristine `hooks-tools.js`; marker-free retirement requires schemas to accept both representative IDs and preserve the tier/allocation boundary | [#3215 · open](https://github.com/ruvnet/ruflo/issues/3215) · related [#2357 · open](https://github.com/ruvnet/ruflo/issues/2357) |

After installing the plugin-hosts target, reconcile an existing dual-host setup with:

```bash
npx ruflo@latest plugins host-sync --dry-run
npx ruflo@latest plugins host-sync
npx ruflo@latest plugins host-update              # update every installed Ruflo plugin in both hosts
npx ruflo@latest plugins host-update -n ruflo-adr # update one

# Explicit #2870 recovery remains available; ordinary installs/self-updates run the all-plugin updater
npx ruflo@latest plugins host-refresh --name ruflo-adr
npx ruflo@latest plugins host-refresh --name ruflo-metaharness
npx ruflo@latest plugins host-refresh --name ruflo-graph-intelligence
```

The `memory` target also refreshes durable tier views through their existing native
connection so long-lived readers see another writer's replacements and deletions;
failed refreshes preserve the last complete view and report failure. This repairs
residual cache visibility above the fallback introduced for [#2887](https://github.com/ruvnet/ruflo/issues/2887)
and [PR #2966](https://github.com/ruvnet/ruflo/pull/2966), without claiming the original
lost-write bug remains open or opening a second database owner.

### Plugin patches

Installed plugin copies get patched, not just `@claude-flow/cli`. Same shape as the patch targets
above, same actions, and the same fail-closed ownership/pristine discipline.

#### Hook failure diagnostics

| Target | What it fixes | Issue |
|--------|---------------|-------|
| **`hook-failure-log`** | Attributes installed Node hook failures to their script and process while preserving native output, exceptions and exit behavior. Private receipts exclude stdin/payloads and raw stderr; retention prunes old completed records without deleting live invocation evidence. | [sparkling/ruflo-source-patch #5 · open](https://github.com/sparkling/ruflo-source-patch/issues/5) |

Receipts live under `~/.ruflo-source-patch/hook-failures` with private directory/file modes.
They contain execution metadata, stderr byte counts/digests and known failure classifications,
not the user prompt or tool payload. Successful completed receipts are removed. This target
changes command declarations, so host-owned hook trust and live activation must be checked;
install/uninstall transfers trust only from the exact previously approved command hash to
its owned logger wrapper or back. Native compare-and-swap writes preserve unrelated settings;
new, untrusted, disabled or unexplained modified hooks still require native review. An existing
control server receives a reload request; the metadata-only fallback verifies disk state and
does not claim an existing standalone session refreshed or a hook ran. It does not repair the
underlying failure.

Codex 0.164 checks a whole-plugin content fingerprint in addition to each hook
command. Native updates can replace a plugin's installed files during restart;
reapplying our patches then changes that fingerprint again. Review and approve
only after patching finishes. The legacy command-only logger trust migration
cannot approve a changed bundle and leaves these cases for native review. Updated
unwrapped declarations are counted as pending too; installation exits nonzero
rather than claiming zero blocked hooks. A successful `hooks/list` is discovery
and trust evidence, not proof that a subsequent runtime hook executed. Never
suppress the native check or grant approval to future, unknown plugin contents.

No native retirement predicate is
registered yet; equivalent attributed native diagnostics remain the upstream acceptance goal.

#### Ruflo persistence and policy

These targets use the plugin composition framework but patch installed CLI runtime modules.
They preserve the native store and policy owners. Actions: `install` · `uninstall` · `status`.

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`ruflo-pattern-receipt`** | Requires a successful delegated pattern store and exact namespace/key/content readback before acknowledging fallback persistence. Covers the MCP handler and memory bridge; a failed native controller cannot acquire a misleading persisted note. | [#3691 · closed](https://github.com/ruvnet/ruflo/issues/3691) |
| **`ruflo-learning-persistence`** | Propagates failed native ReasoningBank flushes through trajectory/pattern/MCP callers and exposes process-local dirty/last-flush status. No replay or replacement storage algorithm. | [#4880](https://github.com/ruvnet/ruflo/issues/4880) |
| **`ruflo-pattern-search-result`** | Preserves native and legacy pattern lookup while separating verified empty results from controller/read failures. Missing handles, malformed results and failed legacy reads remain explicit. Retire when upstream preserves both healthy no-match and failed-read distinctions through native tests. | [#4714](https://github.com/ruvnet/ruflo/issues/4714) |
| **`ruflo-aidefence-config`** | Passes validated server-level pack selection to native AIDefence in all three loading paths. Omitted configuration preserves defaults; invalid values refuse. Built-in detection and PII remain. | [#4785](https://github.com/ruvnet/ruflo/issues/4785) |
| **`ruflo-aidefence-schema`** | Advertises the native scan limit of 10,000 UTF-16 code units while retaining the exact validator, detector and original input. | [#4886](https://github.com/ruvnet/ruflo/issues/4886) |
| **`ruflo-tier-value-schema`** | Advertises the native hierarchical-store nonempty/10,000 UTF-16-unit value contract and corrects the misleading empty-value message; preserves storage and supersedes behavior. | [#4892](https://github.com/ruvnet/ruflo/issues/4892) |
| **`ruflo-worktree-memory`** | Prepares external memory-package bindings through the native resolver before invoking the unchanged signed AutoMemory helper. Exact generated hook forms migrate during native init upgrade; custom commands remain intact. `ruflo hooks auto-memory-hook --action prepare --scope project` prepares and verifies without importing memory, so managed launchers can require success before starting an author. User helpers remain pinned to HOME and data roots remain separate. Retire on proven equivalent native startup, migration and failure behavior. | [#4851](https://github.com/ruvnet/ruflo/issues/4851) |
| **`ruflo-tier-consolidation`** | Withdrawn: restores native explicit unsupported consolidation instead of supplying a custom tier-copy algorithm. Exact reversal composes with native context restoration and preserves every historical record. | [#2977](https://github.com/ruvnet/ruflo/issues/2977) |
| **`ruflo-policy-serialization`** | Serializes one complete verified policy state and reuses that immutable representation for authentication and atomic writes, with an independent small projection. Preserves full ledger validation, receipts, authorization, locking and HMAC. It reduces duplicate work, not the ledger's cumulative growth. | [#3164 · open](https://github.com/ruvnet/ruflo/issues/3164) |
| **`ruflo-policy-ledger`** | Separates immutable receipt segments from a bounded working state after an explicit first migration. Native authorization and receipt verification remain authoritative. Archive contents and directories are synced before state publication; the prefix boundary is authenticated. Complete `policy audit`/verification retain all history. Installing alone does not migrate a project. | [#3164 · open](https://github.com/ruvnet/ruflo/issues/3164); [review of #3892](https://github.com/ruvnet/ruflo/pull/3892#issuecomment-6059183467) |
| **`ruflo-flywheel-evidence`** | Reuses the native scale-12 encoder for nested verification/canary evidence before receipt identity and signing. Keeps strict verification and historical receipts unchanged. | [#3229 residual · closed](https://github.com/ruvnet/ruflo/issues/3229) |
| **`ruflo-champion-authority`** | Protects a modern locally promoted champion from framework auto-application at CLI startup, using the native transaction lock. Busy, invalid, committed or pending ownership defers application; unowned framework baseline and updates remain enabled. Explicit promotion stays unchanged. | [#2579 source context · open](https://github.com/ruvnet/ruflo/issues/2579); ADR-322A authority contract |

`ruflo-policy-ledger` is an independently developed repair, not PR #3892. Its exact
anchors qualify the native persistent-anchor runtime in CLI 3.54.1 and
the secondary-anchor runtime in CLI 3.56.3, with their published security engines; pre-3.54.1 caches are outside this target's scope. Later source
shapes must pass an explicit reviewed variant before any bundled file changes.
For 3.56.3, the native secondary anchor sees the complete logical receipt sequence
through validated segment reads; anchor decisions and native rejection remain intact.
Tests include upgrading an already-segmented 3.54.1 ledger with exact expanded-state
preservation, concurrent writers, preserved receipts, missing/rolled-back secondary
anchors, crash ordering and signature verification on both supported runtimes. Source installation
and migration are separate: an administrator must first qualify/reload the actual
writers, then invoke the patched native `withPolicyTransaction` with
`{ compactLedger: true }`. Subsequent transactions maintain the migrated ledger.
The opt-in persists even for a small ledger, so future growth is bounded without
another migration call.
Older workers refuse the retained nonzero sequence/total-length mismatch rather
than overwrite it. No model route, AgentDB store or Brain update asset is changed.

Keep `.claude-flow/policy/receipt-segments/` with `state.json` and the project's
native user-level `policy-trust` key. The immutable files are part of the complete
policy history, not disposable caches. Native `loadPolicyState()` reconstructs the
complete original-format state for audit/export consumers; internal transactions
request the compact representation. Full verification streams one segment at a
time outside the writer lock. Initial migration verifies all existing receipts;
ordinary migrated calls verify the bounded tail and authenticated archive boundary.
Unreferenced segments after an interrupted commit are retained; they do not become
authoritative merely by existing. Uninstall restores source bytes only: export and
qualify a native-format state before withdrawing its segment reader. Automatic
retirement remains blocked until an upstream reader/import passes preservation,
crash, tamper and concurrency proof. This is an on-disk format change and requires
an explicit controlled migration; installation tests are not live activation evidence.

Fleet qualification on 2026-10-08 completed 53 project/user policy-ledger migrations
across macOS and six Linux machines, preserving 1,281,493 receipts. Native full
verification and exact expanded-state comparisons passed for every migration;
private pre-migration state and trust backups remain on each owning machine.
The combined working states decreased from 1,277,837,565 to 38,685,896 bytes;
the archived receipts remain part of each live ledger. Actual MCP workers were
restarted and checked separately: Codex's configuration-reload acknowledgement
alone did not replace unchanged stdio workers. Future project migrations still
require the same controlled writer qualification and preservation checks.

#### ruflo-adr

Changes to the installed `ruflo-adr` plugin. Together they cover the whole ADR round-trip: what
`adr-create` **writes**, what `adr-index` **reads back in**, and what neither can **reap**.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`adr-template`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Legacy compatibility for stale `ruflo-adr` copies: strips the four list markers old parsers cannot read. After `plugin-hosts` refreshes installed libraries, it executes the creator/parser round trip against both hosts' marketplace and active cache copies and retires itself only when all four pass | [#2659 · closed](https://github.com/ruvnet/ruflo/issues/2659) · [#2870 · open](https://github.com/ruvnet/ruflo/issues/2870) |
| **`adr-index`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** **Retired on executable active-copy proof.** All active Claude/Codex copies execute native stable-key upsert and edge de-duplication, their pristine importers report failed stores honestly, and native `adr-index` routes deletions to a runnable native `adr-reindex`. #2870 remains independent delivery hygiene | [#2660 · closed](https://github.com/ruvnet/ruflo/issues/2660) · [#2594 · closed](https://github.com/ruvnet/ruflo/issues/2594) · [#2870 · open](https://github.com/ruvnet/ruflo/issues/2870) |
| **`adr-io-safety`** | Preserves modern native CLI dispatch and fail-closed verifier reads. Adds one explicit store binding, exact write/edge readback and refusal of live purge-first reindex. Legacy versions retain their separately applicable read/dispatch repairs. The script/helper bundle preflights together; unknown foreign edits refuse installation | [#3147 · open](https://github.com/ruvnet/ruflo/issues/3147) · [#3097 · open](https://github.com/ruvnet/ruflo/issues/3097) |
| **`adr-reindex`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Legacy additive reconcile for installations without a runnable native replacement. It retired after proving the native skill, purge command, and shared writer lock in Ruflo 3.38.12. That proof prevents concurrent lost updates but does **not** make purge plus rebuild atomic; `adr-io-safety` now refuses the residual destructive path until #3097 supplies one managed transaction or staging/swap | [#2666 · closed](https://github.com/ruvnet/ruflo/issues/2666) · [#2878 · closed](https://github.com/ruvnet/ruflo/issues/2878) · [#3097 · open](https://github.com/ruvnet/ruflo/issues/3097) |

#### Ruflo plugins under Codex

Codex loads its own Ruflo marketplace snapshot and versioned caches. These targets change only those
Codex copies; Claude Code and Cursor plugin copies are left alone.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`ruflo-hooks-schema`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** **Retired on proof in Ruflo 3.32.39 / `ruflo-core` 0.2.6.** The compatibility edit removed unsupported manifest fields and Cursor-only PreToolUse output only from Codex copies. PR #2857 version-bumped the plugins and fixed both branches; retirement executes both real handlers before standing down | [#2801 · closed](https://github.com/ruvnet/ruflo/issues/2801) · [#2816 · closed](https://github.com/ruvnet/ruflo/issues/2816) · [PR #2857](https://github.com/ruvnet/ruflo/pull/2857) |
| **`ruflo-codex-skills`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** **Retired on proof in Ruflo 3.32.39.** Older copies needed one read-only `ruflo-core:ruflo-status` skill. The native replacement's default doctor/status path is now read-only and `doctor --fix` requires explicit repair intent | [#2821 · closed](https://github.com/ruvnet/ruflo/issues/2821) |
| **`ruflo-swarm-codex-hooks`** | Projects verified Claude-only modules only where the Codex host still selects that manifest. A verified native Codex selector restores the unused historical projection while preserving its selected commands and logger. Current audit: eight native surfaces and 46 remaining projections per host; whole-target retirement is not justified. Unfamiliar declarations fail visibly | [#3688 · closed](https://github.com/ruvnet/ruflo/issues/3688) |

#### Ruflo instruction generators

Ruflo generates both Claude Code and Codex instruction files from installed package code. Actions:
`install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`ruflo-instruction-contract`** | Rewrites all six Claude and four Codex root templates, the generated Ruflo platform skill, and every packaged Codex task skill so routine swarm, agent, memory, hook, worker, workflow, session, claims, status, benchmark, and security work uses discovered structured MCP interfaces. It covers nested and standalone Codex packages, separates source truth from runtime health, corrects tool names and schemas, reserves direct shell for bootstrap/diagnostics, distinguishes native agents from Ruflo records, labels enterprise text as unconfigured scaffolding, and keeps memory failure non-blocking without raw database fallbacks. A genuine Ruflo CLI-only gap must use the Brain's managed bridge with `executable: "ruflo"`; it may not guess the absent legacy `claude-flow` binary. Existing roots and known installer skills migrate only through attributable exact revisions; custom policy survives. A poisoned pristine is recovered only when reversing and reapplying the exact recognized patch revision reproduces the live file byte-for-byte | [#3153 · open](https://github.com/ruvnet/ruflo/issues/3153) |

#### ruvnet-brain

A different package/plugin surface, the same machinery, and the same reason to be a target: an npx
re-fetch, Brain bundle refresh, or `/plugin update` reverts a hand-edit silently.
Actions: `install` · `uninstall` · `status`

Version-specific findings in the legacy rows record the artifact on which the original gap or
replacement was proved. The current host's `status` and native replacement probe determine its
installed disposition; those historical version numbers are not a fresh fleet audit.

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`ruflo-policy-anchor-copy`** | Reuse fully authenticated history only with a single-use exact-byte digest checked during atomic publication; preserve native fallback and all receipts. | [#3164](https://github.com/ruvnet/ruflo/issues/3164) |
| **`brain-capture-budget`** | Aligns Stop/PreCompact's native override with their existing launcher budget. Preserves SessionEnd, wrapper ownership and exact readback. | [#513 · open](https://github.com/stuinfla/ruvnet-brain/issues/513) |
| **`brain-hook-timeouts`** | Operator-requested temporary 10s restore / 20s recall / 30s capture budgets with matching outer limits; preserves native checks and SessionEnd host cap. Remove after latency repair qualifies upstream defaults. | [#429](https://github.com/stuinfla/ruvnet-brain/issues/429), [#513](https://github.com/stuinfla/ruvnet-brain/issues/513), [#523](https://github.com/stuinfla/ruvnet-brain/issues/523) |
| **`brain-capture-diagnostics`** | Keep hashed failure scope through deduplication and detached callers; retain redacted checkpoint stderr and terminal state. Native admission and persistence remain unchanged. | [#518 · open](https://github.com/stuinfla/ruvnet-brain/issues/518) |
| **`brain-capture-launch`** | Serialize capture metadata across admission, dead-owner reclamation, handoff, pruning and token-matched cleanup. Preserve two native writers and at most eight metadata-only waiters within the original host deadline, truthful overload and exact acknowledgement. No payload queue or replay. | [#519 · open](https://github.com/stuinfla/ruvnet-brain/issues/519) · [#521 · open](https://github.com/stuinfla/ruvnet-brain/issues/521) |
| **`brain-capture-idempotency`** | Native store/read process reuse, bounded fresh lifecycle handoff and read-only reconciliation through the unchanged complete turn constructor. | [#520](https://github.com/stuinfla/ruvnet-brain/issues/520), [#513](https://github.com/stuinfla/ruvnet-brain/issues/513) |
| **`brain-turn-status`** | Distinguish live pending capture, unconfirmed ownership and scoped historical warnings using bounded current/rotated receipts. | [#524](https://github.com/stuinfla/ruvnet-brain/issues/524) |
| **`brain-recall-runtime`** | Adapter withdrawn; restore native recall execution and retain exact historical reversal. | [#514 · closed: downstream-confounded report](https://github.com/stuinfla/ruvnet-brain/issues/514) |
| **`brain-recall-owner-reuse`** | Reuse the existing native reader for same-store semantic search; retain curated evidence and confirm child retirement. | [#429](https://github.com/stuinfla/ruvnet-brain/issues/429) |
| **`ruflo-memory-owner`** | Opt-in downstream owner forwarding, exact path authority, immutable public/CLI results and native daemon client reuse; separate from the completed native daemon-stop fix. | [#4654 · closed: native health and daemon stop](https://github.com/ruvnet/ruflo/issues/4654) |
| **`ruflo-http-sessions`** | Bind native HTTP requests to their own session and authenticated principal; return session IDs and pre-dispatch expiry responses so clients can reinitialize after replacement. Preserve native completion retirement and legacy SSE binding. | [#3294 · open](https://github.com/ruvnet/ruflo/issues/3294) |
| **`ruflo-memory-entries-only`** | Adapter withdrawn; retain only native retrieve failure propagation and exact historical reversal. | [#4666 · closed: downstream cause](https://github.com/ruvnet/ruflo/issues/4666) |
| **`ruflo-controller-inventory`** | Native pattern/skill inventories, exact skills, persisted tier list/get and count-only tier statistics through the existing owner. | [#4707](https://github.com/ruvnet/ruflo/issues/4707), [#4712](https://github.com/ruvnet/ruflo/issues/4712) |
| **`ruflo-pattern-withdrawal`** | Expose exact native ReasoningBank get and hash-guarded delete for explicit correction. Preserve unrelated patterns and refuse changed identities; no cross-process compare-and-swap guarantee. | Related [#3450](https://github.com/ruvnet/ruflo/issues/3450) and [#829](https://github.com/ruvnet/ruflo/issues/829), not complete repairs of those issues |
| **`brain-learning-receipts`** | **Retired on native 4.7.28 behavior proof; older compatibility only.** Native exact readback, consent and child-result handling establish capture before marking an observation complete. | [#377 · closed](https://github.com/stuinfla/ruvnet-brain/issues/377) |
| **`brain-adr-envelope`** | Preserve the complete decision envelope through native asynchronous bounded stdin reading up to 1 MiB, including tail fields. Native verdict and fail-open policy semantics remain unchanged. | [#515 · open](https://github.com/stuinfla/ruvnet-brain/issues/515) |
| **`brain-policy-input`** | Bound shell input consumption before native prefix inspection; preserve content limits, timeouts and refusal decisions. | [#526 · open](https://github.com/stuinfla/ruvnet-brain/issues/526) |
| **`ruflo-memory-list-pagination`** | Page native row identifiers before hydrating payloads; preserve original queries for unknown or incompatible schemas. | [#4686 · open](https://github.com/ruvnet/ruflo/issues/4686) |
| **`brain-learning-native-owner`** | Withdrawn adapter selection; restore upstream learning/checkpoint code. | [#4666 · closed: downstream cause](https://github.com/ruvnet/ruflo/issues/4666) |
| **`verify-interface`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** **Retired.** The predicate accepts either Brain's fixed command gate or its newer advisory-only raw-Bash hook backed by structured `ruvnet_cli_help` / `ruvnet_cli_run`, and rejects a partial blocking replacement | [stuinfla/ruvnet-brain#12 · closed](https://github.com/stuinfla/ruvnet-brain/issues/12) · [#48 · closed](https://github.com/stuinfla/ruvnet-brain/issues/48) |
| **`brain-grounding-evidence`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Records successful source searches independently from product-specific write stamps, so generic evidence can satisfy Stop without authorizing unrelated product writes. Native retirement requires the installed search/stamp/Stop behavior and failure cases to pass. | [#316 · closed](https://github.com/stuinfla/ruvnet-brain/issues/316) |
| **`brain-codex-completion`** | **Completion-claim feature disabled by operator instruction.** Replaces the former Codex evidence/diagnostic workarounds with one exact upstream audit bypass. No completion-based blocking, automatic completion authority, correction ledger or replacement warning. Other Stop gates remain unchanged. Superseded parser and diagnostic implementations are deleted; old installations must first restore their recorded pristine source. Re-enable only after an explicitly reviewed upstream replacement. | [#425 · closed; operator suspension retained](https://github.com/stuinfla/ruvnet-brain/issues/425), related [#423 · closed](https://github.com/stuinfla/ruvnet-brain/issues/423) |
| **`brain-grounding-code`** | **Retired on native single-file behavior proof; older compatibility only.** Native executable, product-path, managed-memory and uncertain-context refusals remain intact. Its terminal retirement record is preserved; the later multi-file recurrence has a separate target below | [#373 · closed](https://github.com/stuinfla/ruvnet-brain/issues/373) · related substance gate [#46 · closed](https://github.com/stuinfla/ruvnet-brain/issues/46) |
| **`brain-grounding-multifile`** | Select the guarded operation from a validated all-Add patch before reusing native projection. Brain 4.7.28's adapter retains the full patch for every file, causing sibling JSON text to be scanned as code. True code and uncertain input retain grounding requirements. Retirement includes the reproduced multi-file case | [#373 · recurrence](https://github.com/stuinfla/ruvnet-brain/issues/373#issuecomment-6637800032) |
| **`brain-router-imports`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Resolves omitted flat router imports through their existing native Console helpers; does not substitute a new router implementation. | [#341 · closed](https://github.com/stuinfla/ruvnet-brain/issues/341) |
| **`brain-transition-notice`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Deduplicates repeated pending-transition warnings through the native session ledger, preserving the first warning, distinct failures, durable capture and exact readback requirements. | [#380 · closed](https://github.com/stuinfla/ruvnet-brain/issues/380) |
| **`brain-managed-cli-capture`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Reuses the native redacted action projection before progression no-op comparison so a real managed command is captured while unchanged lifecycle events remain no-op. | [#382 · closed](https://github.com/stuinfla/ruvnet-brain/issues/382) |
| **`brain-progression-collision`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Binds frozen deferred events to content and preserves historical collisions as independently verified sibling snapshots. Existing rows/conflict evidence survive; failed readback retains pending work. | [#383 · closed](https://github.com/stuinfla/ruvnet-brain/issues/383) |
| **`brain-managed-cli-generation`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Uses the validated native-selected generation's actual manifest and managed-CLI adapter. Successful help authorizes only that generation; a promotion requires fresh help before execution. | [#384 · closed](https://github.com/stuinfla/ruvnet-brain/issues/384) |
| **`brain-transition-validation`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Reuses one verified native restore within a normalized transition. The public builder still restores independently; complete history, ancestry and persistence validation are retained. | [#385 · closed](https://github.com/stuinfla/ruvnet-brain/issues/385) |
| **`brain-managed-cli-diagnostics`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Keeps terminal errors/signals beside nonempty command output and in redacted native observations, instead of masking a timeout or exit failure with stdout. | [#386 · closed](https://github.com/stuinfla/ruvnet-brain/issues/386) |
| **`brain-user-learning-root`** | Retires on Brain 4.7.21 after exact native ownership and inert capture/readback behaviour passes parent-Git, consent, missing-path, directory, symlink and hardlink cases. Restores only owned legacy bytes; never initializes, redirects, merges or replays memory. | [#377 · closed](https://github.com/stuinfla/ruvnet-brain/issues/377) |
| **`brain-outbox-streaming`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Reads the complete append-only journal incrementally beyond Node's whole-string limit, preserving record order, conflict evidence and native final-tail semantics. This alone does not bound all historical object memory or restore work. | [#387 · closed](https://github.com/stuinfla/ruvnet-brain/issues/387) |
| **`brain-continuity-summary`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Bounds optional displayed observations and repeated conflict summaries with omission/digest evidence. Exact goals/actions and canonical snapshots remain intact; mandatory oversized state still fails honestly. | [#389 · closed](https://github.com/stuinfla/ruvnet-brain/issues/389) |
| **`brain-progression-suspension`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Reversible, operator-authorized containment of automatic full-snapshot capture, replay and restore. Retains existing memory/pending work, keeps native updates and ordinary memory available, and reports continuity unavailable without fabricating receipts. | [#390 · closed](https://github.com/stuinfla/ruvnet-brain/issues/390) |
| **`brain-wrapper-ownership`** | Accepts behaviorally proven native prior-generation ownership without edits; older installers retain exact published historical-wrapper compatibility and ownership guards. No manual wrapper replacement or generation promotion. | [#420 · closed](https://github.com/stuinfla/ruvnet-brain/issues/420) |
| **`brain-host-recovery`** | **Retired on native behavior proof; older compatibility only.** Native path-specific boot recovery, complete helper dependencies and causal refresh attribution supersede the local repair. Existing sessions are not claimed refreshed. | [#391 · closed](https://github.com/stuinfla/ruvnet-brain/issues/391) |
| **`brain-restore-diagnostics`** | Preserve native restored/partial context in quiet SessionStart output and keep the deadline/unexpected-failure explanation with its header. The existing private logger retains status, route, timing, error classification/digest and code-location frames; never memory values or raw exception text. Deadlines, advisory behavior and updater remain unchanged. This is a reporting repair, not proof that intermittent restore latency is fixed. | [#522 · open](https://github.com/stuinfla/ruvnet-brain/issues/522) |
| **`flywheel-daily`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** **Retired.** Upstream's atomic per-project/local-day claim passes repeat/day/project/enabled/eight-way-concurrency probes | [stuinfla/ruvnet-brain#53 · closed](https://github.com/stuinfla/ruvnet-brain/issues/53) |
| **`codex-hooks`** | **Retired.** Brain 4.0.2 replaced the legacy bridge with a native six-event lifecycle. Brain 4.3.10 subsequently withdrew automatic host hooks and ships an explicit schema-valid empty Codex registry. The target accepts either proven native state and never recreates hooks Brain deliberately removed; `/hooks` trust remains user-owned | [stuinfla/ruvnet-brain#52 · closed](https://github.com/stuinfla/ruvnet-brain/issues/52) |
| **`brain-codex-skills`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** **Retired on executable proof in Brain 4.0.12.** The active immutable plugin payload contains the skill, manifest, curated notes, and `scripts/whats-new.mjs`; the installed executable returns its exact version and fails nonzero when the notes are removed. The retirement restores only locally owned legacy bytes and preserves the native workflow | [stuinfla/ruvnet-brain#76 · closed](https://github.com/stuinfla/ruvnet-brain/issues/76) · [PR #110](https://github.com/stuinfla/ruvnet-brain/pull/110) |
| **`brain-console-lifecycle`** | **Still live, narrowed to the doctor delta.** Brain 4.7.21 retains native ownership of the whole-runtime digest, receipt, `/api/runtime`, token-bound shutdown, stale/foreign classification, and process replacement, so the patch preserves that launcher. The issue's acceptance contract also requires doctor to compare candidate bytes, persistent runtime, receipt, live endpoint, PID, and API identity; current pristine doctor still relies on `host-convergence.json`. The target adds that read-only live comparison and leaves Brain's updater and activation plane untouched | [stuinfla/ruvnet-brain#79 · closed](https://github.com/stuinfla/ruvnet-brain/issues/79) · [PR #110](https://github.com/stuinfla/ruvnet-brain/pull/110) |
| **`brain-console-provider-keys`** | **Retired on executable proof in Brain 4.0.12.** A copied active runtime stages and validates `model-catalog.json`, detects synthetic OpenAI/Google keys, refuses activation with the catalog missing, and renders the explicit `keysVerified: false` “Not checked” state instead of a false credential negative | [stuinfla/ruvnet-brain#86 · closed](https://github.com/stuinfla/ruvnet-brain/issues/86) · [PR #110](https://github.com/stuinfla/ruvnet-brain/pull/110) |
| **`brain-release-lockstep`** | Historical read-only version-drift repair; current native ADR-089/098 doctors retire the equality overlay after exact helper, check-assembly and verdict proof. Legacy sources retain the original repair. Historical restoration preserves sibling patches; unknown native code refuses qualification. No updater, downloads, versions, `active.json`, KB or host caches are changed | [stuinfla/ruvnet-brain#77 · closed](https://github.com/stuinfla/ruvnet-brain/issues/77) |
| **`brain-memory-doctor-roots`** | **Retired on executable proof in Brain 4.0.12.** The active standalone doctor finds common and configured roots without `~/Code`, preserves explicit-root scope, fails an all-invalid configured set, falls back safely from malformed configuration, and shares `candidateRoots()` / `findStores()` with the Console | [stuinfla/ruvnet-brain#81 · closed](https://github.com/stuinfla/ruvnet-brain/issues/81) · [PR #93](https://github.com/stuinfla/ruvnet-brain/pull/93) |
| **`brain-scratch-preservation`** | Protects pre-call, post-call and footprint cleanup through one empty-directory-only removal helper. Nonempty stores, sidecars, unknown files, links and races are retained without raw database access. Independent KB archive proof and native update authority are preserved. Retirement requires the same native preservation behavior at all three call sites. | [stuinfla/ruvnet-brain#335](https://github.com/stuinfla/ruvnet-brain/issues/335#issuecomment-6523577872) |
| **`brain-managed-memory-boundary`** | Retains the owner-required default raw-SQL refusal for both `.swarm/memory.db` and `.swarm/agentdb-memory.db`, plus the configured user store. Native detector/settings are preserved; the current native Brain-off route does not enforce this owner policy. The legacy exact diagnostic remains limited to ordinary stores and cannot inspect native controller stores. Brain's update plane is untouched | [stuinfla/ruvnet-brain#102 · closed](https://github.com/stuinfla/ruvnet-brain/issues/102) · [#103 · closed](https://github.com/stuinfla/ruvnet-brain/issues/103) · owner policy [ADR-028](docs/adr/ADR-028-managed-agentdb-interface-boundary.md) |
| **`brain-search-safety`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** **Retires on native active-KB proof.** Older KB copies need an own-array `symbolRoute` guard and non-mutating outage guidance. The historical Mac audit found a safe route and shared diagnosis-first guidance; retirement executes the installed route and checks both callers plus the helper. A missing or permissive helper cannot retire the patch. The target never changes stores, sidecars, models, updater state, version identity, or release selection | [stuinfla/ruvnet-brain#224 · closed](https://github.com/stuinfla/ruvnet-brain/issues/224) · [#225 · closed](https://github.com/stuinfla/ruvnet-brain/issues/225) |
| **`brain-dual-host-receipt`** | Preserves Brain's complete subscription-only dual-host deliberation while removing its direct `ruflo memory store` child process. The coordinator emits an exact `memory_store` request for its MCP-aware caller and reports learning persisted only when an injected callback proves the same key was stored and read back. It patches the already-active persistent runtime and deployed helper after native activation; it does not touch Brain releases, updater state, AgentDB files, WAL sidecars, host authentication, or model execution | [stuinfla/ruvnet-brain#272 · closed](https://github.com/stuinfla/ruvnet-brain/issues/272) |
| **`brain-dual-host-stdin`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** Keeps complete cross-host proposals and critiques off argv, where Linux caps a single argument at roughly 128 KiB on common 4 KiB-page systems. It pipes the prompt to both native subscription CLIs over stdin without truncation or plaintext temporary files, while retaining Claude's plan/tool boundary and Codex's ephemeral read-only boundary | [stuinfla/ruvnet-brain#273 · closed](https://github.com/stuinfla/ruvnet-brain/issues/273) |

**Native KB recovery verified 2026-11-08:** An owner-authorized Brain 4.7.28
`--clean --archive --json` cleared two retained full-KB copies on each host.
Native proof identified one unique historical `SOURCE.json` per copy; all four
archived values matched their original SHA256. The updater's read-only retained-copy
preflight then returned `updateMayProceed:true` on Mac and HZ. All previously
inventoried scratch roots remained present (308 Mac, 3,244 HZ). This was a native
administrative recovery, not a new patch or memory-losslessness proof. The later
owner-authorized native refresh failed on both hosts at 10:29 UTC: all three
download attempts returned HTTP 504 from the published bundle endpoint
([Brain #527](https://github.com/stuinfla/ruvnet-brain/issues/527)). The endpoint later
returned HTTP 200. HZ's native update reported success at 12:59 UTC, with upstream
freshness unknown and a host restart pending; the laptop's 14:33 UTC attempt rolled
back on guard validation. Read-only diagnosis reproduced the validation fault on
both hosts: Node 24.22's line reader splits a valid Unicode separator inside one
JSON string, reporting 18,986 passages instead of the 18,985 valid JSONL records.
An isolated LF-framing prototype passes eight parser regression cases and matches
the unchanged corpus to its metadata. The native guard still fails; this is not a
deployed fix or full refresh clearance. [Brain #528](https://github.com/stuinfla/ruvnet-brain/issues/528)
tracks the parser correction and the differing update receipts. No updater, corpus,
guard, version selection or receipt was changed locally. Retained learning-state
size still exceeds the aggregate footprint budget. See the
[scoped recovery evidence in Brain #335](https://github.com/stuinfla/ruvnet-brain/issues/335#issuecomment-6719910202).

**Upstream status reviewed 2026-10-05:** Brain 4.5.7 includes native outbox containment and
operator suspension for [#390](https://github.com/stuinfla/ruvnet-brain/issues/390#issuecomment-5990955062).
The later [4.5.8 release](https://github.com/stuinfla/ruvnet-brain/compare/v4.5.7...v4.5.8)
retains those sources and reduces validation allocation; it does not implement a bounded frontier.
Its native host-declaration reconciliation is accepted only with exact installer boundaries and
verified installed dependencies. The public 4.5.9 installer and helper boundaries retain the same
accepted proof; its grounding projection passed the single-file retirement checks.
The later multi-file recurrence has a separate target below. Hook metadata cannot clear executable/MCP restart uncertainty;
the older overlay now applies the same restriction and migrates only exact prior patch bytes.
The [frontier proposal](https://github.com/stuinfla/ruvnet-brain/blob/v4.5.7/docs/proposals/0390-progression-frontier-proposal.md)
remains proposed; mature-history capture and restore within host deadlines are not established.
Native suspension passes our tagged-source behavioral checks and can replace the overlay
after the installed copies pass and the official persisted setting is written and read back.
Status never changes that setting; failed preparation protects the complete bundle. This is
not proof of restored continuity. Other native replacements remain subject to installed,
marker-free behavioral retirement checks. Publication of 4.5.7 alone does not
retire a target or establish that a host has activated it. None of these targets drives Brain's
updater, selects/promotes a release, rewrites version identity or alters its KB/cache data.

The [4.5.10 source](https://github.com/stuinfla/ruvnet-brain/tree/v4.5.10) adds capture privacy
checks and repairs the grounding helper's alias entrypoint. Framework 4.46.32 accepts the exact
reviewed replacements for grounding, action capture, diagnostics, transition validation,
collision recovery and suspension. Shared isolated proofs execute the native privacy helper,
preserve outcomes and source identity, propagate policy refusal, and retain frozen evidence
when current exclusions would change it. Policy lookup and durable storage are inert test
boundaries; these checks do not establish universal explicit consent or retroactive filtering.
Older compatible versions remain covered. Source acceptance does not activate a Brain release.
The complete [4.5.11 published package](https://github.com/stuinfla/ruvnet-brain/tree/v4.5.11)
retains these six native replacements. Framework 4.46.33 fixes our collision proof's false
ownership refusal: the full upstream `hook-input.mjs` mentions our binary in documentation.
Only that exact reviewed file digest receives the exception; changed bytes, local ownership
markers and symlinks still fail. Regression fixtures now include the entire native parser.
This repaired our checker, not Brain's 4.5.11 progression runtime. The 30 October
review found #390 closed after full-history progression was removed in 4.7;
the legacy suspension target is no longer selected on current hosts. The
installer-help discrepancy [#400](https://github.com/stuinfla/ruvnet-brain/issues/400)
and stale corpus reporting [#401](https://github.com/stuinfla/ruvnet-brain/issues/401)
are now closed too. These later changes do not alter the earlier test evidence.

The outbox target also accepts exact public 4.5.6 bytes after the ordered streaming proof;
that version does not include 4.5.7's lazy replay containment. Console promotion can copy
an already patched installer without its adjacent patch backup. Recovery requires a healthy
peer with the same package, version and executable identity, one unique marker-free pristine,
and exact reproduction of both installed compositions. Missing, foreign or ambiguous evidence
fails visibly and preserves the executable; this recovery does not select or promote a Brain release.

On native Brain 4.5.2, `brain-grounding-evidence` retires after all installed stamp/Stop pairs
pass executable ordinary/card, failed/empty/forged, stale-evidence and unrelated-write checks.
`brain-dual-host-stdin` similarly requires every installed coordinator to load and deliver byte-exact
300 KiB prompts to both fake host CLIs. A missing dependency blocks retirement.

`brain-router-imports install` fixes [Brain #341](https://github.com/stuinfla/ruvnet-brain/issues/341)
in flat deployed router executables. It preserves correctly packaged local imports; when the native
installer omitted a helper, the exact import site reads the existing native Console helper instead.
Native model and runtime policy values stay owned by Brain. No helper is copied or substituted,
and no updater, cache data, installer, release identity or version selection is changed. Missing or
unsafe native owners fail visibly. The target retires only after the original imports load locally.

On older installations, `brain-grounding-evidence install` fixes [Brain #316](https://github.com/stuinfla/ruvnet-brain/issues/316)
in active Brain 4.3.28: the Stop gate recognizes more product names than the successful-search stamper.
A successful Brain-only query therefore previously produced no evidence and was falsely blocked.
The exact-anchor patch records a non-product `search_ruvnet` stamp after the existing failure/query
checks, accepting both the ordinary search banner and the cited FAST LANE card response. Cards
satisfy only the turn-level check; named product stamps and write authorization are unchanged.
It patches the native active
generation and matching host copies, with pristine restoration and monitor reapplication. No updater,
release selection, KB data, or hook registrations are changed. The regression executes the native
mark → stamp → Stop chain, proves the pristine failure, rejects failed/empty searches and stale
evidence, and verifies that generic evidence cannot authorize unrelated product writes. Retire only
when marker-free upstream code passes those same checks; anchor drift fails visibly, never counts as
a fix. Install with `npx github:sparkling/ruflo-source-patch brain-grounding-evidence install`.

`brain-grounding-code install` addresses [Brain #373](https://github.com/stuinfla/ruvnet-brain/issues/373)'s
false-positive recency scan by projecting added JS/Python code. Comments and standalone Python docstrings warning against
AgentDB access do not require a product stamp. Complete Write/Codex Add payloads support docstrings;
partial Edit/Update payloads keep their conservative requirement. Executable strings/imports, product-bearing paths,
uncertain syntax and unsupported languages retain the requirement; parser failure retains the
vendor scan. The substance detector and managed-memory guard are unchanged. It patches the native
active generation and matching hosts through exact anchors, pristine restoration and monitor
reapplication. Brain 4.5.9 replaces the original overlay with its conservative native projection (#373).
The earlier retirement proof required reviewed guard/helper bytes in every discovered copy and 43 isolated native
replays, including the original warning-docstring incident, executable/path/managed-memory refusals,
missing-helper fallback and product-specific stamp expiry. Function docstrings and uncertain edits
retain the stricter native policy. A version number or a nearby helper alone cannot retire the patch;
missing, altered or symlinked helpers fail without changing installed source.
Brain 4.5.10 adds a 44th replay proving that a CLI alias executes the same native projection.
Mixed installed versions each receive their own behavior replay.

`brain-grounding-multifile` addresses the 4 November 2026 recurrence with a 45th native case: a complete patch adding Python code and
sibling JSON that mentions AIDefence. Brain 4.7.28's Codex adapter checks every touched file with
the complete patch; its single-file projector falls back to scanning unrelated sibling text.
The exact registered HZ hook reproduced the rejection without executing the patch. The repair
selects the unique guarded operation from a fully validated all-Add patch, then reuses native
validation and projection. Duplicate paths, unsupported operations, moves, truncated input and
uncertain edits retain the original scan. Native adapter-chain tests accept the original input
while refusing actual ungrounded imports in either code file. Grounding stamps, substance policy,
permissions and the updater remain unchanged. Marker-free upstream code must pass the expanded
matrix before the new target retires; the original single-file proof is insufficient for this
separate recurrence. The old target's terminal retirement record is preserved. Public install
and all-install tests start with that record present and verify the new target applies.

`brain-transition-notice install` fixes [Brain #380](https://github.com/stuinfla/ruvnet-brain/issues/380)
by sharing the native bounded session notice ledger across both transition entrypoints. The first
pending warning remains truthful; repeats for that session are deduplicated. Capture, durable replay,
exact receipt verification, degraded warnings and separate continuity conditions remain intact.
This controls notices; an abandoned writer claim still requires ownership diagnosis and repair.

The `memory` target recovers a positively proved dead writer claim under an exclusive recovery
fence, preserving its exact metadata as evidence. It refuses live, malformed or ambiguous claims.
SIGKILL cannot run process cleanup. On the next acquisition, the patched caller attempts the
existing guarded recovery once for that exact database path. Only a positively dead, identified
recovery owner qualifies; live/reused PIDs, unknown ownership and missing helpers remain refused.
This adds no inventory scan, background process or alternative locking implementation.
Database files and SQLite sidecars are not changed by claim recovery.

New recovery fences carry atomically published ownership ([source-patch#6](https://github.com/sparkling/ruflo-source-patch/issues/6)).
`memory inspect-fence /absolute/path/memory.db` and `memory recover-fence /absolute/path/reviewed-expectation.json`
support a provably dead **recovery owner** on macOS/Linux without requiring another boot;
automatic acquisition recovery reuses this owner and excludes all legacy anonymous directories.
Live/reused PIDs and ambiguous evidence remain refused. The exact fence is archived durably;
the writer claim, database and SQLite sidecars remain untouched. A missing writer claim after
native archival is supported. Ordinary live-writer contention no longer creates recovery fences.
Legacy empty same-boot directories still need independent proof of quiescence; this release does
not invent a recovery owner for them. Fresh memory read/write/readback is a separate check.

Checked 30 October against published Ruflo 3.65.0 and main
[`d000e27`](https://github.com/ruvnet/ruflo/blob/d000e27e82c783a5a188abb01d89b8ccbc12b271/v3/%40claude-flow/cli/src/memory/memory-initializer.ts):
the original [#2878](https://github.com/ruvnet/ruflo/issues/2878) writer serialization is present,
but native stale takeover still uses age alone. The stronger ownership patch remains necessary.
The SIGKILL regression now proves automatic recovery with eight competing callers, one durable
fence archive and unchanged synthetic database/sidecar sentinels (ADR-023).
Already-patched path diagnostics remain recognizable after their edit; this preserves exact
historical-composition proof when a migrated runtime has lost its pristine source backup.

For an interrupted **preboot** recovery on macOS, the memory owner provides an explicit operator
path: `memory inspect-fence /absolute/path/memory.db` emits exact reviewable identity metadata;
after reviewing that output, `memory recover-fence /absolute/path/expected.json` archives only
the unchanged empty fence and retains intent/result receipts. Same-boot, active, nonempty,
symlinked or changed ownership is refused. The unchanged dead writer claim remains for the native
lock owner to recover. This does not prove memory health; verify the requested native operation
afterward. Neither command installs patches or opens a database (ADR-023).

`brain-managed-cli-capture install` fixes [Brain #382](https://github.com/stuinfla/ruvnet-brain/issues/382)
by reusing the native redacted action projection before no-op comparison. The existing writer still
records the action once and supplies its exact readback receipt; unchanged lifecycle events stay no-op.

`brain-progression-collision install` fixes [Brain #383](https://github.com/stuinfla/ruvnet-brain/issues/383)
by binding deferred identities to their frozen content. A historical collision requires a validated
independent read of the existing row before recording the conflicting snapshot under a deterministic
sibling identity. Existing rows and conflicting outbox evidence remain intact; a failed new readback
retains the queued job. It does not rewrite the historical event-key contract.

`brain-managed-cli-generation install` fixes [Brain #384](https://github.com/stuinfla/ruvnet-brain/issues/384)
by dispatching managed CLI calls through the validated generation selected by Brain's native
`active.json`. The generation owns its real manifest and adapter. Successful help is required
for that generation before execution; promotion requires fresh help. The updater and KB stay native.

`ruflo-sqlite-owner install` fixes [Ruflo #3693](https://github.com/ruvnet/ruflo/issues/3693)
by resolving native SQLite through the actual ControllerRegistry dependency owner. Graph, repair
and registry-related handles share that library identity; no registry handle is borrowed and closed.

`ruflo-pattern-receipt install` fixes [Ruflo #3691](https://github.com/ruvnet/ruflo/issues/3691)
by checking the delegated store result and exact namespace/key/value readback before acknowledging
a fallback pattern write. Failed controller results also retain their failure without a persisted note.

`brain-transition-validation install` fixes [Brain #385](https://github.com/stuinfla/ruvnet-brain/issues/385)
by reusing one verified native restore result within each normalized transition. The public builder
still validates its callers independently. Complete history, ancestry, redaction, deduplication and
exact readback remain required; no snapshots are dropped and no persistent validation cache is added.

Codex does not turn third-party plugin commands into root slash commands like Claude Code does. Browse
these through `/skills`, or invoke them explicitly as `$ruflo-core:ruflo-status`,
`$ruvnet-brain:brain-console`, `$ruvnet-brain:rvbc`, and `$ruvnet-brain:whats-new`.
A new Codex session may be required for changed boot-loaded skill declarations; source installation
does not prove that an existing session has refreshed its catalog or MCP modules.
The 2026-08-31 audit of Brain 4.3.3 reproduced the Codex half of the live-update edge tracked in
[#223](https://github.com/stuinfla/ruvnet-brain/issues/223): fresh sessions must discover only the
registry generation, while an already-open session must retain a readable catalog path until its
lease/grace period ends. [#128](https://github.com/stuinfla/ruvnet-brain/issues/128) fixed stale
fresh-session discovery, and [#153](https://github.com/stuinfla/ruvnet-brain/issues/153) added
PID-incarnation leases for Claude's cache. The shipped pruning path and `.in_use` leases remain
Claude-only in that artifact; Codex's host-native refresh could therefore delete the absolute
versioned skill path held by a live boot catalogue. This is a historical finding, not a declaration
that every later release retains it. There is deliberately no downstream cache/updater shim.
If a current session holds a missing path, save work and use its supported same-conversation
restart to rebuild the catalog; assess current host recovery separately from this older audit.

#### MetaHarness under Codex

MetaHarness declares lifecycle hooks in its host-neutral `HarnessSpec`, but the exact published
`metaharness@0.4.7` and `@metaharness/host-codex@0.1.2` Codex renderers still discard them. This package
target patches only authenticated installed runtime files. Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`metaharness-codex-hooks`** | Converts non-empty declared hooks into a strict project `.codex/hooks.json` and a project-local Node bridge. It translates the outer tool matcher to Codex's regex surface, enforces any inner command/path glob against event input, resolves helpers from nested working directories, rejects unsupported events and non-command handler kinds, and leaves hook-free harnesses unchanged. It never edits Codex trust; users still review generated hooks with `/hooks`. The local patch repairs the runtime renderers only. Template, CLI-model, and Studio declaration plumbing remains part of the upstream fix | [ruvnet/metaharness#168 · open](https://github.com/ruvnet/metaharness/issues/168) |

#### all ruflo plugins

This source-sweep target spans every installed `ruflo-*` plugin rather than a single file.
Actions: `install` · `uninstall` · `status`

| Target | What it fixes | Upstream |
|--------|---------------|----------|
| **`mcp-prefix`** | **Legacy compatibility, now retired on proof.** The plugins' bundled `mcp__claude-flow__*` names were dead under plugin loading, which exposes `mcp__plugin_ruflo-core_ruflo__*`. Upstream migrated the fleet in stable 3.32.2 and current HEAD also fixes the two missed `ruflo-core` files. Because upstream's bytes are identical to this patch's output, token presence is not accepted as provenance: the retirement predicate reads the installed marketplace's Git `HEAD`, permits only metaharness smoke assertions to retain the bare token, and proves all 828 local files are exact before/after compositions. It then rebases stale backups to HEAD, preserves sibling patches, restores over-broad standalone/test edits, and retires terminally | [#2685 · closed](https://github.com/ruvnet/ruflo/issues/2685) |
| **`design-wall`** | **Native replacement proved in the 2026-10-10 audit; retained only for older copies.** **Retired when the active upstream fix is verified.** Older `ruvnet-brain` copies applied their README/explainer/console wall to every repository. The historical patch scoped it by origin. Current upstream versions ship a stronger plugin-manifest identity gate; this target requires its anchors and valid shell syntax, then executes the real hook against staged README commits in unrelated and ruvnet-brain fixture repos. Only `allow` outside plus `block` inside permits byte-safe cleanup and terminal retirement. Unknown or old copies keep the patch | [stuinfla/ruvnet-brain#17 · closed](https://github.com/stuinfla/ruvnet-brain/issues/17) |

### Script targets

One-shot *toolkits*, not patches. They fix nothing in the library; they set up or repair **your
projects and user-level integrations**. Nothing is source-patched and no patch-framework hook is
registered. `install` just materializes the scripts at a stable path so you can run them.
Actions: `install` · `uninstall` · `status` · `run`

| Target | What it gives you |
|--------|-------------------|
| **`dual-codex-claude`** *(alias `dual`)* | **Start or convert** a project so Claude Code and Codex share **one** instruction file. Two scripts: build a fresh dual project, or convert an existing one. ([#2634 · closed](https://github.com/ruvnet/ruflo/issues/2634) · [#2635 · closed](https://github.com/ruvnet/ruflo/issues/2635) · [#2636 · closed](https://github.com/ruvnet/ruflo/issues/2636) · [#2637 · closed](https://github.com/ruvnet/ruflo/issues/2637) · [#2638 · open](https://github.com/ruvnet/ruflo/issues/2638)) |
| **`dedupe-bundle`** *(alias `dedupe`)* | **Slim a bloated project.** *Every* `ruflo init` bundles ~196 to 260 `.claude/{skills,commands,agents}` files (default preset, not just `--full`) that ~100% duplicate the installed plugins. Removes the bundle and, event-aware, the genuinely double-firing hooks (`PreToolUse`/`PostToolUse`/`PreCompact`), plus the standalone `.mcp.json` ruflo server the plugin already provides (a second writer on `memory.db`, [#2621 · closed](https://github.com/ruvnet/ruflo/issues/2621)) and, by default, its running process. Keeps `helpers/`, project-only hooks, and non-ruflo servers. ([#2640 · open](https://github.com/ruvnet/ruflo/issues/2640)) |
| **`ruflo-codex-hooks`** | **Repair an existing Codex installation created before Ruflo v3.32.24.** Registers the canonical `ruvnet/ruflo` marketplace and `ruflo-core@ruflo` plugin through Codex's public plugin CLI, preserves a disabled plugin and unrelated state, and never edits or re-registers MCP. Current init is handled upstream. ([#2801 · closed](https://github.com/ruvnet/ruflo/issues/2801)) |
| **`codex-switch`** | **Continue one Codex thread on a different account.** Keeps the resume UUID and all visible conversation/tool history while moving between the ChatGPT subscription (`openai`) and a GitHub Copilot seat behind a local Responses proxy (`copilot`). Removes only provider-private encrypted replay state, at a boundary, against a SHA-256-verified backup; refuses an active session, an unrecognised encrypted location, and an undefined Copilot profile. ([ADR-030](docs/adr/ADR-030-codex-switch-one-resume-id-across-providers.md)) |

[**What each script does, and how to run it →**](#the-script-targets-in-detail)

### Monitor

Re-applies the patches when something overwrites them.
Actions: `install` · `uninstall` · `status` · `run` · `check`

[**Why it exists, and what it caught →**](#the-monitor)


## The patches in detail

### `cwd`

Stray folders are the symptom. **The bug is silent data loss.**

`.claude-flow/` holds the *learning* state: `autopilot-state.json`, `neural/` checkpoints, `metrics/`,
`learning.json`, `vectors.json`, `agentdb/`, `hnsw/`, and `.swarm/memory.db`. All of it is anchored to raw
`process.cwd()`, and under an agent `process.cwd()` is not the project. It is wherever the agent last ran
`cd`, and **it stays there**:

```text
tool call 1:   cd docs && pwd      ->  /repo/docs
tool call 2:   pwd                 ->  /repo/docs     # a separate call, no cd. It never goes back.
```

The user is at the repo root and never leaves it. The agent runs `cd src/website && npm test` for an
unrelated reason, and from that moment every `ruflo` command, `npx` invocation and MCP spawn in the
session is anchored in `src/website/`.

So state is written to a directory nothing will ever read again. And it does not error:

```js
export function loadState() {
  const filePath = resolve(STATE_FILE);      // relative to the DRIFTED cwd
  try { if (existsSync(filePath)) { … } } catch { }
  return defaults;                            // not found => start over, silently
}
```

Nothing is corrupted. The self-learning system quietly resets to zero, and it looks exactly like normal
operation. That is the worst shape a data bug can have.

#### Three forms, and only one is greppable

| Form | Findable by a raw-cwd search? |
|------|-------------------------------|
| `path.join(process.cwd(), '.claude-flow', …)` | yes |
| `resolve('.claude-flow/data')` | **no**. A one-arg `resolve()` is *already* cwd-relative, so there is no `process.cwd()` token to find |
| `applyChampion(process.cwd())` | not at the state path. The callee builds it from a parameter |

A grep-driven patch therefore cannot be complete. And **an incomplete one is worse than none**, because it
splits writers from readers. We shipped exactly that: `getProjectCwd` (the **reader** of
`harness-active-policy.json`) was anchored while `applyChampion` (its **writer**) still followed the
drifted cwd, so the reader looked at the project root for a file the writer had put elsewhere and silently
found nothing. Unpatched, both sides at least agreed on the drifted directory. Fixed in 4.16.0.

#### What it does

Ported from [`sparkling/ruflo`](https://github.com/sparkling/ruflo)'s ADR-0100 and ADR-0137. The original
fork audit triaged every then-known call site, but release validation now measures the declared entry
set and scans every discovered runnable build rather than preserving stale grep totals.

**The resolver**, by marker priority: `.ruflo-project` sentinel, then `CLAUDE.md` **and** `.claude/` (both
required, so a `docs/CLAUDE.md` is not mistaken for a project), then `.git`, then the start dir unchanged.
`.git` alone is not enough: a monorepo package has its own `.claude/` and no `.git`, so a bare `.git` walk
sails past it and pools every package's state into one store. Memoised per **resolved start dir**, never at
module load, because a module-level cache goes stale precisely when the cwd drifts.

**Anchored at the callee, not the call site.** One edit fixes every caller, present and future:

| Anchored | Where |
|----------|-------|
| `ensureDaemonRunning`, `getDaemon`, `startDaemon` | `services/daemon-autostart.js`, `services/worker-daemon.js`; current native `resolveDaemonProjectRoot()` is accepted without an edit |
| `getMemoryRoot` + config paths | `memory/memory-initializer.js` |
| `getProjectCwd` | `@claude-flow/cli-core` · `mcp-tools/types.js` |
| `applyChampion`, `applyChampionParams`, `rollbackActivePolicy` | `config/harness-feedback-applier.js` |
| `getDataDir` (neural), `defaultMemoryDbPath`, `defaultTunedConfigPath`, `createClaimService`, `runHarnessLoopWorker` | `memory/`, `services/` |
| `STATE_DIR` (the implicit-relative case) | `autopilot-state.js`. Patching the **constant** fixes all five `resolve()` sites, since `resolve(<absolute>)` returns it unchanged |
| Permission state and audit paths | `security/permission-manager.js`, `security/permission-audit.js` |
| Swarm state reads | `commands/swarm.js` |
| Neural-weft export defaults and generated helpers | current `commands/neural.js` plus authenticated generated helper copies |
| Session snapshots and pending-insight reads | release-shaped entries in `mcp-tools/hooks-tools.js`; snapshots are atomically written before their absolute `statePath` is returned |
| Semantic-router RuVector storage | `mcp-tools/hooks-tools.js`; the constructor receives project rooted `.swarm/ruvector-router.db` instead of falling back to `./ruvector.db` |
| AgentDB RuVector storage | `agentdb` derives a persistent vector sidecar from its configured database path and its RuVector backend supplies an absolute OS-temporary fallback for every other caller; the native constructor never receives an omitted `storagePath` |

**`commands/init.js` is deliberately left alone.** `init` legitimately targets the invocation directory, so
resolving it would initialise a nested project at the outer repo root. That is the fork's
`adr-0100-allow: intentional-cwd` triage, and it is also why a blanket `chdir` at the entry point cannot
work.

#### And a leak detector, because completeness cannot be proven

A `.claude-flow`/`.swarm` in a subdirectory **is** an anchor that leaked, whatever syntactic form it took.
The SessionStart hook reports them, and only reports: those directories hold orphaned neural checkpoints and
split `memory.db` files, and discarding the only copy of someone's learning state is not a hook's decision.

Upstream: [#2633](https://github.com/ruvnet/ruflo/issues/2633).

### `daemon`

Legacy compatibility for daemon multiplication: one daemon per project **root**, not one per directory
you happen to start it from. It is terminally retired on current Ruflo after executable proof.

#### Historical failure and current native replacement

In clean `@claude-flow/cli` **3.33.0**, `commands/daemon.js` anchored its own state
(`.claude-flow/`, `daemon.pid`, and the native dedup lockfile itself) to raw `process.cwd()`.
The #2407/#2484 lock correctly serializes starts in the **same directory**, but starts elsewhere
in the same project use different lock and PID paths. Direct `daemon` commands skip autostart,
so the `cwd` patch's normalization of `daemon-autostart.js` cannot cover them.

Measured with four concurrent foreground starts from four subdirectories:

| | Before | After |
|---|---|---|
| 4 from 4 different **subdirs** | **4 live daemons, 4 subdirectory PID files** | **1 daemon, 1 root PID file** |

Ruflo 3.38.11+ exports `resolveDaemonProjectRoot()` and routes autostart plus direct
start/stop/status/trigger/supervisor identities through it. This package accepts those vendor bytes as
**native-satisfied**, not patched. Retirement executes the installed resolver: a nested cwd resolves to
the nearest Ruflo root, an independently initialized nested project wins, `.git` stops upward escape,
and a directory with no marker stays itself. It also rejects any old raw-cwd identity sink. A resolver
or route mutation keeps the target live; mixed old/new installations are patched or preserved per copy
and do not retire prematurely.

Older releases still receive the exact #2877 compatibility transform. The patch leaves Ruflo's native
lock algorithm byte-for-byte unchanged and canonicalizes only its project identity. The
`const cwd = process.cwd();` path-validation guard remains deliberate security policy. Broader durable
state rooting remains tracked by [#2633](https://github.com/ruvnet/ruflo/issues/2633).

### `memory`

Fixes three distinct memory authority failures: a long-lived bridge silently reusing the wrong
database, concurrent writers silently dropping acknowledged writes, and raw whole-image access that
is unsafe while a native WAL connection is attached.

`memory.db` is written by **two different SQLite engines**: the AgentDB bridge
(better-sqlite3, **WAL mode**) and a fallback that does a whole-file read-modify-write
(sql.js: `db.export()` → atomic rename). Ruflo 3.25.2 made those flushes atomic
([#2585](https://github.com/ruvnet/ruflo/pull/2585)), closing the *torn-write* class. The distinct
durability failures reproduced in 3.33.0 were cross-process lost updates
([#2878](https://github.com/ruvnet/ruflo/issues/2878), focused follow-up to closed #2621) and
WAL-incoherent sql.js access. Ruflo 3.38.12 now routes ordinary sql.js writers through native
`withMemoryDbLock()`. This target retains the stronger fail-closed ownership/outer-serialization delta,
WAL refusal, integrity gate, and stale-writer recovery. Native bridge identity now passes
the scoped [#3143](https://github.com/ruvnet/ruflo/issues/3143) replacement proof, so its
obsolete overlay remains off on qualified native versions.

#### The database path is an authority boundary

The `memory/graph-configured-store` entry fixes a separate retained graph read
gap ([#4291](https://github.com/ruvnet/ruflo/issues/4291)): fresh 3.57.0 MCP k-hop
queries ignored an explicit research-store binding and returned the default
store's synthetic edge. Both encryption sniffing and native graph opening now
reuse `resolveDbPath()` precedence, preserving an explicit custom path first.
Native checks cover explicit/default selection and missing/encrypted-source
refusal. Behavioral retirement preserves upstream's independent controller owner.

The `memory/mcp-configured-store` entry also carries `CLAUDE_FLOW_DB_PATH` through
the MCP memory handlers (#2105/#3196). Previously, initialization honored it while
list/search/retrieve could silently use project memory. A separately configured
Ruflo MCP connection can now target the existing user store using its normal
structured memory tools; the default connection retains project scope. Native
bridge and WAL safety checks remain in force. Initialization checks use that same
store, and explicit-store connections do not migrate project legacy data. Verified
through MCP on `hz` (221 shared `user-patterns` entries) and the laptop (301), with
exact-key retrieval and semantic search. A laptop key found in the shared store
was absent from project memory. Register a separate `ruflo_user` connection using
`npx -y ruflo@latest mcp start` and `CLAUDE_FLOW_DB_PATH` set to the user's absolute
database path; expose `memory_list`, `memory_retrieve`, `memory_search`, and
`memory_store`. Existing sessions need MCP reload/restart to discover it.

`memory-bridge.js` accepts an explicit `dbPath`, but Ruflo 3.38.20 stores `registryPromise`,
`registryInstance`, availability, and failure reason in four module-global variables. After the first
successful open, every later call returns that same registry without comparing the requested path.
Measured in one process against two populated stores:

```text
project A -> user B    6,462 project rows -> 0 user rows
user B -> project A      212 user rows    -> 212 user rows, including a user-only key
```

The reverse-order result proves this is wrong-store reuse, not search quality or corruption. A live
WAL only makes the downstream fallback refusal visible; refusing raw access is correct and must not
be removed to hide this symptom.

The patch keys the complete bridge state by a canonical database identity: absolute path, plus
`realpath` for an existing file or its existing parent. Initialisation promises deduplicate one path, while project and user
stores retain independent instances, availability, failure reasons, and shutdown lifecycles. First
initialisations are queued because upstream temporarily replaces process-global `console.log`; after
initialisation, operations remain independent. The regression suite proves A -> B, B -> A, concurrent
reads, symlink identity, path-scoped availability and diagnostics, scoped shutdown, and all-registry
shutdown. Retirement requires upstream #3143 to pass those behaviors through the shipped bridge API.

Ruflo 3.41.2 and 3.42.0 (#3196) key the registry instance and promise by `path.resolve(dbPath)`
natively, but `bridgeAvailable` and `bridgeFailureReason` remain one process-wide latch and a
symlink alias is still a second registry. A second entry, `memory/path-keyed-bridge-maps`, applies the
same canonical state to that shape; the pristine fixture proves both residual defects before it runs.

#### The write lock

`storeEntry`, `getEntry`, `deleteEntry`, `applyTemporalDecay`, `ensureSchemaColumns`,
`initializeMemoryDatabase`, and purge fallback can perform whole-file read-modify-write. Two
processes can each read image *v1* and each rename; the second silently clobbers the first.
Per-write atomicity cannot fix this. Only mutual exclusion spanning read..write can.

The local `<db>.rsp-lock` uses `O_EXCL`, is reentrant only within the current async call
context, and serializes unrelated sibling Promises in the same process. It **fails closed**:
an unresolved path, filesystem error, or five-second timeout throws
`RSP_MEMORY_LOCK_UNAVAILABLE` before the operation runs. A unique claim token plus inode check
prevents a late release from deleting a successor's lock. It never steals by age; a crash may
leave a lock requiring explicit inspection/removal, because age is not proof of death and
`unlink` is not compare-and-delete.

Historical measurement on clean 3.33.0 with the fallback forced:

```
UNPATCHED   acked: 12/12   on disk:  2/12   SILENTLY LOST: 10   integrity_check: ok
PATCH TEST  cross-process updates: 80/80; same-process siblings: 40/40; lock failure: callback did not run
```

Every lost write returned `success: true`, and the database stays `integrity_check: ok`. Nothing
errors. The data is simply gone.

#### WAL-sidecar refusal

sql.js reads the main DB file only; it cannot see frames sitting in `-wal`. With an uncheckpointed
WAL it can read a database in which the table does not even exist (measured: `no such table:
memory_entries` while 500 rows sat in a 2.3 MB WAL) and then write that fiction back over the
image. At Ruflo's shared `fs-secure` raw read/write boundary, the patch refuses any `.db` access
while `-wal` or `-shm` exists, including a zero-byte sidecar, and fails closed if absence cannot
be proved. `checkMemoryInitialization` is guarded outside its catch, and force initialization is
checked before upstream unlinks the main DB.

The patch deliberately does **not** checkpoint, truncate, unlink, or rename another connection's
WAL state. The former `wal_checkpoint(TRUNCATE)` helper was removed: a read helper mutating a live
database could cement a mismatched main/WAL pair and contradicted the policy upstream established
in [#2735](https://github.com/ruvnet/ruflo/issues/2735).

#### The integrity gate (ADR-023)

The lock stops two *cooperating, patched* writers from clobbering each other, and the atomic flush
([#2584](https://github.com/ruvnet/ruflo/issues/2584)) stops a reader seeing a torn image. Neither
covers a flush landing on a DB that is **already** torn: sql.js opens a truncated image without
error, loses the missing pages, and the mutator re-exports the shrunken image over the original, an
acked write that has silently destroyed the store (`no such table: memory_entries` on a
multi-megabyte file is the measured symptom). This is what corrupted `semantic-product-mock`. So
at the actual `writeFileAtomic` boundary, a pure-buffer check reads the 100-byte SQLite header
and verifies it is self-consistent (magic, a power-of-two page size, and `page_size * page_count`
equal to the file size when the header's page count is authoritative). A torn image is **refused**
(the write throws) rather than overwritten. Missing and zero-byte files remain valid initialization
inputs. Plain SQLite images, including `ensureSchemaColumns` output, must be verifiable.
Native `RFE1` encrypted images remain owned by Ruflo's format parser and
authentication; the SQLite-header check does not reinterpret their ciphertext.
Successful native AgentDB bridge calls never cross this raw boundary and are not falsely rejected.

#### The stale-writer guard (ADR-023)

The lock and the gate live *inside* the patched module, so they protect only a process that actually
loaded it. A long-running ruflo MCP client or daemon that started before the patch, or that runs an
npx cache copy the patch never reached, keeps flushing the old way from memory. No source edit can
reach it. That stale image, flushed back over a healthy file, is the corruption mechanism. So
`stale-writer.mjs` detects such a writer, resolving its `@claude-flow/cli` root from the daemon's
direct path, the plugin MCP client's `.bin/cli` symlink, the public `.bin/ruflo` thin wrapper, or an
authenticated `ruflo` / `claude-flow` launcher under a custom PATH prefix that contains no npm binary.
The public wrapper is what `npx ruflo@latest mcp start` actually leaves running; discovery validates
package identities before following Ruflo's bounded nested/hoisted-dependency walk. What the guard *does* depends on
whether the on-disk copy is actually patched:

- **A `pre-patch` daemon** (copy patched, process older) is killed and restarts on current bytes at
  next use. A `pre-patch` MCP client is detected and reported but never signalled: the detached
  monitor cannot reconnect the owning Codex/Claude stdio transport. The host performs a controlled
  `/mcp` reconnect when the user is ready. This prevents a scheduled repair from turning a safe
  source update into machine-wide `Transport closed` failures.
- **An `unpatched` writer** (copy lacks the current fail-closed lock, either because the patch could
  not apply or because the older fail-open wrapper remains): **never auto-killed**, because a respawn
  would reload the same unsafe bytes. That's patch drift; the fix is re-anchoring (the drift
  machinery already flags it).

`RSP_NO_STALE_WRITER_KILL` keeps detection but disables daemon restarts; `monitor run` triggers the
same bounded recovery and reports MCP clients that still need their host to reconnect them.

#### The cost, stated plainly

`getEntry` rewrites the entire DB image just to bump `access_count`, and it now takes the lock, so
reads serialise too. On a large DB that's a real throughput hit. Correct-and-slower beats
fast-and-lossy, but the honest fix is upstream follow-up #3 (native better-sqlite3 + WAL for the
primary flush), which deletes this problem class instead of guarding it. Don't want the trade?
`memory uninstall`.

### `adr-template`

Fixes `adr-create`'s own template, whose output its sibling `adr-index` cannot parse.

`ruflo-adr`'s two skills disagree with each other on ADR metadata format. `adr-create`'s own
template (`SKILL.md` step 3) writes:

```
- **Status**: proposed
- **Date**: 2026-07-13
- **Tags**: golden-corpus, ddd, microservices
```

`adr-index`'s parser (`scripts/import.mjs`) reads these fields with `^`-anchored regexes
(`/^\*\*Status\*\*:.../m`, same shape for `Date`/`Tags`) that require the field marker at the
*start* of the line. Per its own doc comment, it recognises exactly two formats: "v3-style"
(an unprefixed `**Status**:` line) or YAML frontmatter. The bullet list `adr-create` itself
emits is neither, so the leading `- ` breaks the `^` anchor and `parseStatus`/`parseDate`/
`parseTags` silently return `Unknown`/`''`/`[]` for every ADR authored by following
`adr-create`'s documented template to the letter. Confirmed against a real ADR
(`docs/adr/ADR-001-*.md`) produced exactly that way ([#2659](https://github.com/ruvnet/ruflo/issues/2659)).

**Fix:** strip the leading `- ` from those four template lines, so `adr-create`'s own output
matches the "v3-style" format `adr-index`, its sibling skill in the SAME plugin, already parses.
One plugin, one format; both skills agree once patched.

Current `ruflo-adr` includes the broader native parser fix. This target therefore has a local,
behavior-based retirement gate: it executes a creator-shaped ADR containing list-prefixed status,
date, tags, and all four relationship forms through the active Claude and Codex marketplace/cache
parsers. Stale users keep the compatibility edit; once `plugin-hosts` has refreshed all four copies
and the round trip passes, the target restores the vendor template and records terminal retirement.
The still-open immutable-version defect remains tracked separately by #2870.

Unlike `cwd`/`daemon`/`memory`, this patches an installed **Claude Code plugin** (`ruflo-adr`'s
`adr-create/SKILL.md`), not `@claude-flow/cli`. It is scoped to the **upstream `ruflo` marketplace
only** (`~/.claude/plugins/cache/ruflo/ruflo-adr/*/skills/adr-create/SKILL.md` and
`~/.claude/plugins/marketplaces/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md`), with the same
pristine-backup + atomic-write discipline as the JS patches above, and, like them, it is re-applied
by the SessionStart hook and the [monitor](#the-monitor).

### `adr-index`

> **RETIRED on active native proof.** Every active Claude Code and Codex marketplace/cache copy now
> executes stable-key upsert and edge de-duplication, the pristine importers report failed stores
> honestly, and native `adr-index` documents its deletion limit and routes to a runnable native
> `adr-reindex`. The predicate proves this again after restoring vendor bytes. #2870 remains open for
> reused-version release hygiene, but does not keep redundant runtime code installed.

Historically fixed an index that could be created but never updated.

`adr-template` fixes what `adr-create` **writes**. This fixes what `adr-index` **reads back in**,
and it is the more consequential half, because it breaks the ADR lifecycle itself.

An ADR's life *is* mutation: `proposed` → `accepted` → `superseded`, a new `Amends:`, a corrected
date. The affected importer could not reflect any of it. Ratify an ADR, re-run the indexer, and the
graph still said `proposed`, while printing `Records stored: 1/1`.

Both namespaces are insert-only, and that single choice fails in **opposite directions** depending
on whether the key is deterministic:

| Namespace | Key | Re-run | Failure |
|---|---|---|---|
| `adr-patterns` | `ADR-001::<basename>`, deterministic | collides → INSERT rejected | **frozen** at the first value ever indexed |
| `adr-edges` | `<rel>:<from>-><to>:${Date.now()}-${rand}` | never collides | **duplicates**. 3 → 6 → 9 edges, one set per run |

Measured on a 2-ADR repo with nothing changed on disk between runs. Duplicate edges silently weight
an ADR by *how many times someone ran the indexer*, and `verify` reports the inflated graph as
healthy, because every duplicate is individually valid.

The failure is invisible because a `UNIQUE constraint` failure (exit **1**) is mapped to an
`'exists'` sentinel and then **counted as a stored record**, so `errors` stays empty and the summary
reports full success.

Three compatibility edits fixed it: pass `--upsert`, stop counting `'exists'` as stored, and make the edge key
deterministic (`<rel>:<from>-><to>`, since `capturedAt` already lives in the value, where identity
has no business).

> **The `--upsert` twist ([#2594](https://github.com/ruvnet/ruflo/issues/2594)).** Older CLIs
> advertised `-u, --upsert [default: true]` but performed a strict insert unless the flag was
> explicit. Ruflo 3.32.36 fixed that default. The importer still passes `--upsert` explicitly so
> an active older plugin/CLI pair cannot silently regress to frozen records.

The legacy target patched non-identical copies. The marketplace checkout carried local #2474
fixes and passes args as `` `--key=${key}` `` (npm rejects an argv token starting with a U+2014
em-dash, which ADR titles contain). Each edit therefore carries *variants* plus a `done()` predicate
that reports whether the fix is present independently of which anchor produced it. That is what makes
a **partial** patch visible: matching on anchor-absence alone would call a file "patched" when an
anchor simply never existed, which is exactly how a missing `--upsert` could pass green while
leaving the bug fully intact. `install` prints `INCOMPLETE` and `status` names the missing edits.

#### What convergence does not fix

Deletions. With upsert and deterministic keys a re-import *converges*: status, metadata and changed
relations all land. What it can never do is **reap**. A removed ADR file, or a
deleted `Depends-on:` line, leaves an orphan row that no future import touches, and the index goes on
asserting a decision that no longer exists on disk.

Reaping needs a rebuild ([`adr-reindex`](#adr-reindex)). Native `adr-index` now says this explicitly
and routes the user to the native sibling skill. The retired compatibility patch additionally printed
this exact orphan count:

```
#### Issues found
- ORPHANS: 0 record(s) + 1 edge(s) in the index have no source on disk
  (an ADR file or a relation line was deleted; an import can add and update, but never reap)
  reconcile with a rebuild:  ~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh
```

The count is **exact, not a heuristic.** The CLI can't enumerate keys (`memory list` truncates them
and caps at `--limit`, with no `--json`), so a key-by-key diff is impossible. But the *total* is
reported and excludes soft-deleted rows. Every desired record is written before we look, so the
namespace then holds exactly `desired ∪ orphans`, making `count − desired` the precise orphan count.
It even catches a same-size swap: delete ADR-003 and add ADR-004 in one go, and the index lands at 4
against a desired 3.

The tempting alternative, having the importer keep a manifest of what it wrote and prune the
difference, was rejected. It trades a stateless one-second rebuild for persistent state that can
drift, a new "manifest is wrong" failure mode, and a much larger patch surface. The files are the
truth; nothing else should have to be.

### `adr-io-safety`

Keeps an unreadable or partially written ADR graph from looking healthy.

The 2026-08-31 audit of `ruflo-adr` 0.4.1 found three coupled I/O defects:

- `verify.mjs` maps spawn failures, nonzero exits, and malformed JSON to `[]`, omits `--limit`, and
  can certify an unreadable or truncated graph as a healthy `0/0` graph.
- `import.mjs` uses `ADR_ROOT` as both scan scope and database cwd, launches one serial `npx` process
  per row, accepts a successful-looking receipt without proving persistence, and exits zero in both
  output modes after failed writes.
- `reindex.mjs` purges the live namespaces before rebuilding. A shared lock prevents concurrent
  writers, but a later failure can still leave the graph empty or partial; the purge and rebuild are
  not one transaction.

The patch treats `verify.mjs`, `import.mjs`, and `reindex.mjs` as one bundle. Every active Claude and
Codex marketplace/cache copy must contain all three regular files and every exact anchor before any
file is written. Status counts expected files before reading them, so a missing member reports `0/3`,
not the false comfort of `0/2`.

Those are historical defects, not a description of every current native script.
Modern 0.5.8 already ships a shared `spawnCliSync` resolver and a fail-closed
verifier. The current patch keeps both, including native failure checks,
the 10,000-row cap and `ADR_VERIFY_TIMEOUT_MS`. Its former normalization into
older implementations exists only to recognize exact historical patched bytes
during upgrade and removal.

At runtime, the ADR scan directory and managed store identity are separate. The patch resolves a
canonical project root from an explicit marker, honors `ADR_DB_PATH` / `ADR_DB_ROOT` and Ruflo's
managed-memory configuration, rejects a symlink/non-regular database, and passes one absolute
`--path` to every managed CLI call. Modern calls use the native shared CLI helper;
the residual guard refuses its npx fallback when no installed CLI resolves. In the
original HZ diagnosis, installed Ruflo and npx both reported 3.38.20, yet npx loaded sql.js and could not see a live WAL while installed Ruflo
loaded native `better-sqlite3` and returned all 95 ADR rows. Older builds without
the native helper retain the legacy installed driver and `RUFLO_ADR_CLI` absolute
executable override. That legacy selector does not replace the modern resolver.

The verifier requests a bounded complete namespace with an explicit cap-plus-one, parses the whole
stdout as JSON, validates every row and namespace, and treats spawn, signal, timeout, nonzero,
malformed output, a bad edge key, or an unproved cap as fatal. A successfully read empty graph remains
valid.

The importer keeps the serial compatibility path because current `memory import` cannot yet prove
durable writes. It preflights both namespaces before storing, fails on the first bad write, and accepts
a write only after a fresh managed process retrieves the exact raw bytes. A final complete key-set
comparison rejects missing and extra rows; JSON and Markdown share nonzero failure semantics.

Live reindex is intentionally unavailable under this patch. Non-dry-run execution exits nonzero before
calling purge or any writer and explains the missing atomic contract. Dry-run remains a read-only scan.
Upstream can retire the target by providing either one managed transaction covering stale-row removal,
upserts, and invariant proof, or a staging namespace/database followed by one atomic pointer/swap. A
strict batch that runs **after** a separate purge is still unsafe.

### `adr-reindex`

> **RETIRED for compatibility, but not a complete safety proof.** `ruflo-adr` 0.4.0+ ships `/adr-reindex`
> and `@claude-flow/cli` 3.29.0+ ships `memory purge`, but #2666's first acceptance point
> is not native: purge takes `<db>.lock` while ordinary writers do not. On this installation
> the `memory` target wraps native purge with their `<db>.rsp-lock`, making the replacement safe.
>
> **On an older CLI it still matters, and the failure is quiet.** The plugin ships from the marketplace
> the instant it lands; the CLI ships on npm separately, so for a window the skill was installed and the
> command it needs was not. Their `reindex.mjs` gates on `status !== 0`, and an unknown subcommand prints
> the help text and **exits 0**, so against a pre-3.29.0 CLI it reports `adr-patterns: purged` having
> purged nothing. (Its post-condition catches the mismatch and exits 1, but blames a concurrent writer.)
>
> So the legacy retirement asks all three compatibility questions: **does this machine have the native skill,
> `memory purge`, and one lock shared with ordinary writers?** Only all three permit retirement.
> Otherwise it keeps our raw-SQL script and never overwrites upstream's skill file. That closes the
> concurrent-writer gap; it does not make purge and rebuild all-or-nothing. `adr-io-safety` owns that
> newer residual and refuses live reindex until [#3097](https://github.com/ruvnet/ruflo/issues/3097)
> has an atomic managed replacement.

Rebuilds the graph from the ADR files, for a CLI that cannot yet do it itself.

The ADR files are the source of truth; `adr-patterns` / `adr-edges` are a derived cache. For a derived
cache the correct reconcile is a **rebuild**, and at ADR scale it's instant.

```bash
npx github:sparkling/ruflo-source-patch memory install       # REQUIRED, see below
npx github:sparkling/ruflo-source-patch adr-reindex install
~/.ruflo-source-patch/adr-reindex/ruflo-adr-reindex.sh [project-dir] [--dry-run]
```

Drop both namespaces, re-import, verify. Reach for it after **deleting** an ADR or a relation line
(the one case upsert cannot reap), after moving from a legacy random-edge-key importer (including the
historical `adr-index` compatibility install), or any time you want certainty. For an ordinary edit,
the native importer handles it. Just run `/adr-index`.

#### It requires the `memory` target

Not a suggestion. `adr-reindex install` refuses without it, and so does the script. This is the one
operation in the whole package whose entire job is to **delete rows**, and ruflo writes `memory.db` as
a whole-file read-modify-write image: a daemon or MCP server holding a *pre-delete* image flushes it
back and resurrects everything you just removed. That is [#2621](https://github.com/ruvnet/ruflo/issues/2621),
the historical lost-update report, with the current ordinary-writer residual tracked by
[#2878](https://github.com/ruvnet/ruflo/issues/2878), aimed squarely at the reconcile itself.

The `memory` target already solves both halves, so this **depends on it rather than reimplementing a
weaker copy**. `memory/write-lock` makes `<db>.rsp-lock` mean something (a lock nothing else takes
protects nothing), and `memory/wal-sidecar-refusal` stops raw access while a native connection owns
WAL state. The guard checks both the supplied path and its resolved symlink target and refuses
unresolved existing aliases ([source-patch #7](https://github.com/sparkling/ruflo-source-patch/issues/7)).
This closes a demonstrated bypass; it does not repair existing data.
The script takes that same lock around its `DELETE`, which is *participation* in the
protocol, not duplication of it: the CLI's lock lives inside node and can't cover a `sqlite3`
subprocess. It releases before the re-import because every patched store takes the same lock and now
fails closed on contention.

An earlier version carried its own `PRAGMA wal_checkpoint` as "belt-and-braces" and *warned* instead
of refusing when `memory` was absent. Both were wrong: a raw helper must not mutate another
connection's WAL, and warning-then-deleting gambles your index on a race the warning has just
finished explaining it cannot win.

#### Three things it has to get right, each learned the hard way

- **Both namespaces, together.** Clearing only `adr-patterns` fixes stale statuses and leaves the
  duplicate edges behind. A partial rebuild is its own trap.
- **Run from the project root.** `import.mjs` takes `ADR_ROOT` to find the ADR *files*, but the CLI it
  shells out to resolves *which `memory.db` to write* from its **cwd**. Invoked from anywhere else it
  reads the right ADRs and writes them to the wrong database, after this script has already emptied
  the real one. This is what an early version did, and it is what an empty index looks like.
- **A post-condition that can see a reconcile that didn't happen.** It used to check `records != 0`,
  which is blind to the exact failure it exists to prevent: if the delete is clobbered, the re-import
  upserts *cleanly on top of the resurrected rows*, every store reports ok, `records` is nonzero, and
  the script exits 0 having reconciled nothing, orphans intact. It now asserts **`records` == the
  number of ADR files**, which catches both directions: too many (the delete didn't stick) and too few
  (stores are failing). It names the likely cause of each.

Because the delete precedes the rebuild, a failed rebuild can leave an **empty or partial** graph. The
files remain the source of truth, but "re-run it" is recovery after an avoidable destructive gap, not
an atomicity guarantee. The current `adr-io-safety` target therefore blocks this live path before purge.

### `verify-interface`

Historical compatibility target, now **retired** after an installed behavior proof.

`ruvnet-brain` ships a PreToolUse hook that blocks a Bash command naming a rUv CLI until you have read
that command's `--help`. **The idea is sound and this target does not disable it.** It exists because
someone once called `ruflo memory search "query"` positionally, got nothing back, and declared AgentDB
broken three times over. Keep the gate. It simply cannot be *opened*.

#### It fires on things that are not the tool

```bash
MATCH_RE="($TOOLS)[@a-z0-9.-]*[[:space:]]+([a-z][a-z-]*)…"
```

The character class exists to absorb `@latest`. It also absorbs a hyphenated **binary name**, so
`ruflo-source-patch adr-index status`, an entirely different tool with its own CLI, is read as the
`ruflo` CLI, and the gate demands you first run `ruflo adr-index status --help`. That command does not
exist; `ruflo` has no `adr-index` subcommand. It asks for something impossible, then blocks until you
provide it.

There is no command-position anchor either, so the regex is applied to the **whole command string,
quoted text included**. A `git commit` whose message contained the sentence *"…the installed
`ruflo-adr-reindex.sh` **was the** pre-71be214 copy"* matched as `ruflo … was the`, and the gate
demanded the help output for a command called **`was the`**. Ordinary English prose is enough.

#### The documented override cannot work

The block message ends:

> *(Deliberate override, say why out loud: `RUVNET_SKIP_INTERFACE_CHECK=1`)*

But the check reads that variable from the **hook's own environment**, and a PreToolUse hook is handed
the proposed command as JSON on stdin and **never executes it**. Setting the variable on the command,
which is precisely what the message instructs, cannot reach the hook. The one documented escape hatch is
unreachable from the only side that is told to use it.

Together: a false-positive match with no working override. In one session it blocked **five** unrelated
commands, including a `git commit`, in a repo whose name begins `ruflo-`. There is no way round it
except to not name the tool.

#### The fix

The patch absorbs only a `@version`, anchors the tool to command position, and honours the override where
the message says to write it. The regex necessarily gains capture groups (bash ERE has no non-capturing
`(?:…)`), so its `BASH_REMATCH` readers move with it. That means **five edits, each with its own `done()`
predicate**, because a *partial* apply here is worse than none: land the regex without its readers and the
gate blocks on garbage.

Tested **behaviourally, not textually**. Asserting "the regex string changed" would pass on a patch that
broke the gate outright. The suite proves the unpatched fixture really does block (else everything below
is vacuous), that all three commands which actually blocked us now pass, that the override finally works,
and, the one that matters, **that an unread interface still blocks.**

Brain first fixed #12/#13 with a JSON parser and command-position gate, then moved raw-Bash
classification to advisory-only output while structured `ruvnet_cli_help` / `ruvnet_cli_run`
own enforcement (#48). Retirement accepts either complete replacement and rejects any partial
advisory that can still exit nonzero. Issue #41's broadened body was not fixed by its earlier
closure; #44 was superseded rather than implemented as a blocking parser. Brain 4.0.2 closed #48
after publishing the structured managed CLI/MCP boundary and its focused interface tests.

## The script targets in detail

Everything else in this package fixes **the library**. These fix **your projects**, and they're the
part people miss, because they're not patches and nothing re-applies them. `install` materializes the
scripts; you run them by hand, on a project, when you want them.

```bash
npx github:sparkling/ruflo-source-patch dual install      # or: dual-codex-claude
npx github:sparkling/ruflo-source-patch plugin-only install   # aliases: dedupe, dedupe-bundle
npx github:sparkling/ruflo-source-patch ruflo-codex-hooks run
```

They land in `~/.ruflo-source-patch/<target>/` and stay there. `status` byte-compares them against the
packaged versions, so an upgraded package with a stale materialized script says **`STALE`** rather than
`installed`.

### `dual`

Gives Claude Code and Codex one instruction file instead of two that drift apart.

`ruflo init` writes `CLAUDE.md`. `codex init` writes `AGENTS.md`. Ruflo 3.32.37 now runs both
native initializers in dual mode (#2636), but the two instruction sources still **diverge
immediately** (#2638). Keeping them synchronized by hand is a losing game.

The model here is **one canonical file, no symlinks, no duplication**:

- **`AGENTS.md`** is the single source of truth. Codex reads it directly.
- **`CLAUDE.md`** is literally `@AGENTS.md` (Claude Code imports it) plus a short Claude-only overlay.

Edit the shared bulk **once**, in `AGENTS.md`; both platforms see it. Each platform's unique bits live
only in the file that platform reads. Nothing to keep in sync, so nothing drifts.

**Two scripts, depending on where you're starting:**

```bash
# a NEW dual project, from scratch
~/.ruflo-source-patch/dual/ruflo-new-dual.sh <project-dir> [--no-start-all] [--no-dedupe] [--template <t>] [--force]

# convert an EXISTING ruflo/Claude Code project
~/.ruflo-source-patch/dual/ruflo-add-codex.sh [project-dir] [--template <t>] [--force]
```

`ruflo-new-dual.sh` runs `ruflo init` with the **default** preset (`--with-embeddings`), not `--full`. The
default **still** bundles the plugin-duplicated `.claude/{skills,commands,agents}` (~196 files; `--full`
just adds more), so the fresh-project script runs the plugin-only sweep by default (`--no-dedupe`
opts out). The conversion deliberately retains the exact audited
`@claude-flow/codex@3.0.1` transaction because its side effects are fully bounded here; native
Ruflo 3.32.36 separately fixed #2635 for ordinary `--codex`/`--dual` initialization.

The adapter runs behind a failing private `codex` shim, so it cannot overwrite the user's MCP registry.
Afterward, the wrapper queries Codex's **user-global** registry and adds `ruflo` only when that exact
entry is absent. `-C <project>` selects the CLI invocation cwd; it does not make the entry
project-scoped or store a fixed server `cwd`. Existing `.agents/config.toml`, `.codex/AGENTS.override.md`,
`.codex/config.toml`, and `.gitignore` bytes are restored; adapter-created copies are removed.
`AGENTS.md` and `CLAUDE.md` are also restored on failure or interruption. After stripping the adapter's
ignore edits, the wrapper preserves existing rules and appends only its marker-owned `.env`, runtime,
and `*.bak` rules. It does not
install inferred `.codex/skills/*/skill.toml` manifests, and Claude uses the plugin-owned MCP server
rather than a duplicate standalone registration.

### `ruflo-codex-hooks`

Repairs the user-global Codex plugin registry on a machine initialized before Ruflo v3.32.24 /
`@claude-flow/codex` 3.0.2 learned to install Ruflo's lifecycle hooks:

```bash
npx github:sparkling/ruflo-source-patch ruflo-codex-hooks run
```

It adds the canonical `ruvnet/ruflo` marketplace at `main` only when absent, installs
`ruflo-core@ruflo` only when absent, preserves an installed-but-disabled plugin, and refuses to
overwrite a different source using the `ruflo` marketplace name. It does not run any `codex mcp`
command. After a successful install, start a new Codex session and review `/hooks`; Codex owns that
trust decision.

### `codex-switch`

Continues **one** Codex resume ID while changing which account pays for it. Run it from the project
directory; the session is pinned after the first use:

```bash
npx github:sparkling/ruflo-source-patch codex-switch run status
npx github:sparkling/ruflo-source-patch codex-switch run copilot
npx github:sparkling/ruflo-source-patch codex-switch run openai
```

The UUID and every visible message, tool call and protected assistant-message block are retained. Only
provider-private encrypted replay items (`reasoning`, `compaction`, `context_compaction`) are removed,
and only at a boundary. The other provider rejects those items, and the symptom is a stream that closes
before `response.completed` rather than an error you can read. The retained content is hashed before
and after; a mismatch restores the original. The pre-switch bytes are kept as a SHA-256-verified
backup under `~/.local/state/codex-switch/backups/<uuid>/`.

It refuses, changing nothing, when: another writer holds the session lock (exit Codex first), the
rollout carries encrypted content in a location it does not recognise, or the `copilot` profile is not
defined. That last one matters more than it looks. Codex does **not** error on an unknown `--profile`,
it silently uses the default provider, so without the check a "Copilot" switch would quietly bill the
subscription.

`copilot` needs a Codex profile pointing at a Copilot-compatible Responses proxy. The template is
materialized beside the script as `codex-switch-profile.toml`; copy it to `~/.codex/copilot.config.toml`
(user-level, because project config cannot redirect providers) and run the proxy, pinned to an exact
version:

```bash
npx @jeffreycao/copilot-api@1.15.0 auth        # once
npx @jeffreycao/copilot-api@1.15.0 start --port 4141
```

Verify a switch actually reached the proxy: it must log `POST /responses 200`. Never pin the proxy to
`@latest`. It holds credentials and sits between every request and response, so every version bump is a
security review.

Flags: `--session UUID` (pin explicitly), `--force-boundary`, `--prepare-only`, `--dry-run`, and
`--safe`, which drops the default `--yolo`. Everything after a bare double-dash separator is forwarded
to Codex, except `--profile`, which is refused; the provider is chosen by the subcommand.

### plugin-only (dedupe)

Makes a project defer entirely to the installed plugins. **Renamed from `dedupe` / `dedupe-bundle`** (both
still work as aliases) because it now does more than slim the bundle: it also strips the duplicate MCP
registration in both channels and stops the redundant server. Deletes what the installed plugins already
give you.

**Every** `ruflo init` bundles the `.claude/{skills,commands,agents}` files, default preset included, not
just `--full` (~**196** on default: 30 skills + 148 commands + 18 agents; ~**260** on `--full`). Of those,
~**100%** of the agents and commands, and ~**97%** of the skills, are *already provided* by the installed
`ruflo/*` plugins ([#2640](https://github.com/ruvnet/ruflo/issues/2640)). The project's `settings.json` also
registers lifecycle hooks. The ones for events the plugin `hooks.json` also defines (`PreToolUse`,
`PostToolUse`, `PreCompact`) **fire twice** on POSIX ([#2132](https://github.com/ruvnet/ruflo/issues/2132)).

It also reaps a **duplicate MCP registration**. `ruflo init` writes a project-local `.mcp.json` that
registers a *standalone* ruflo server (keyed `claude-flow` or `ruflo`), but the `ruflo-core` plugin already
provides that server (namespaced `mcp__plugin_ruflo-core_ruflo__*`). Under plugin loading the project copy is
a second server on the same root: **two writers on one `.swarm/memory.db`**
([#2621](https://github.com/ruvnet/ruflo/issues/2621)). dedupe removes it (matched by command *signature*, so
`ruv-swarm` / `flow-nexus` and any unrelated server are **kept**; the file is deleted if it empties) from
**both** places it can live. That means the project's `.mcp.json` **and** `~/.claude.json`'s
`projects[<dir>].mcpServers` (Claude Code's per-project MCP config in the global file, where a **remote**
`ssh` server is a real capability, not a duplicate, and is kept). When a host migration leaves the same
local standalone under an absolute project root that no longer exists, the sweep removes only that dead
Ruflo entry; entries for other live projects and every unrelated/remote server remain untouched. By
**default** it also **SIGTERMs the
now-orphaned server process** so the second writer is gone immediately, not just after a restart.

```bash
~/.ruflo-source-patch/dedupe-bundle/ruflo-dedupe-bundle.sh <project-dir> [--keep-dup-hooks|--keep-dup-mcp|--keep-server|--bundle-only] [--dry-run]
```

**Start with `--dry-run`.** It prints exactly what it would remove and stop, and touches nothing.

By **default** it removes the bundle, strips the duplicate hooks, removes the standalone MCP registration and
stops its server. It is conservative by construction:

- a bundle item is removed **only when a plugin actually provides it** (project-unique items kept);
- a hook is stripped **only for events the plugin `hooks.json` also defines** (`UserPromptSubmit` routing,
  `SessionStart/End`, `Subagent*`, `Notification`, and auto-memory are **kept**, since no plugin replaces them);
- the MCP server is removed **only when the plugin actually provides one**, and the process is SIGTERMed
  **only** if its real cwd is inside the project **and** its env carries the removed entry's `CLAUDE_FLOW_*`
  marker, so the **plugin server (same command) is never touched**; if it can't be told apart, nothing is
  killed and it says so (the same containment discipline as [`cleanup`](#cleanup));
- **`.claude/helpers/` is never touched** (init writes all ~43; no plugin replaces them);
- removals are backed up first. `--keep-dup-hooks` skips the hook step, `--keep-dup-mcp` leaves `.mcp.json`
  alone, `--keep-server` leaves the process running, and `--bundle-only` does the `.claude` bundle only.

## The monitor

Keeps the patches applied when something overwrites them.

```bash
npx github:sparkling/ruflo-source-patch monitor install     # every 5 min (RSP_MONITOR_INTERVAL=secs)
npx github:sparkling/ruflo-source-patch monitor status      # scheduled? drifting? last repair?
npx github:sparkling/ruflo-source-patch monitor check       # dry-run; exit 1 on drift
```

The `SessionStart` hook only fires when a session **starts**. But `npx -y ruflo@latest` fetches a
**new** cache directory the moment a version changes, and a `ruflo update` can land mid-session,
so a fresh, unpatched copy can run for hours until you restart Claude Code. The monitor closes
that window.

**It covers plugin patches too**, not just CLI targets. Before `adr-template` and `adr-index` retired,
a `/plugin update` could fetch fresh `ruflo-adr` bytes and silently drop their compatibility edits.
Both the hook and monitor therefore re-apply everything still recorded in `state.json`, across
`patchTargets` (CLI) and `pluginTargets` (plugins). Terminally retired targets are removed from that
state and are not re-applied. A historical repair looked like:

```
2026-07-13T18:38:05.742Z REPAIRED 1 plugin file(s) [adr-template,adr-index] — adr-index: patched …/scripts/import.mjs (4/4 edits)
```

**It keeps *itself* current, too, and this was the sharpest bug in the package.**
`~/.ruflo-source-patch/lib` is not a cache, it's the **executable**: the hook and the scheduled job
both run modules from *there*, never from the npm package. But only an `install` action ever wrote it.
So `npm i -g …@next`, a version that adds an entry for an anchor upstream re-worded, changed
**nothing** about what the hook and the monitor actually did. They kept applying the old entry set,
forever, and every reporting surface was *also* the old code, so it was silent. The package upgraded
and nothing it does upgraded with it. Found live at nine modules behind.

The invariant is **immutable provenance**, not location. For a package/cache source, the stable copy
must match the exact source it was synced from, recorded at sync time. For a mutable Git checkout,
an explicit mutating command is the review/deployment boundary: the timer never follows later edits.
(Diffing against the globally-installed package is the obvious answer and it's wrong. Develop from a
clone and the global is *older*, so the CLI would sync your clone in and the monitor would dutifully
heal it **backward** to the stale release, the two writers fighting on a timer. The fuzz suite caught
exactly that.) Immutable package drift self-heals on a monitor tick; mutating commands refresh either
source. `monitor status` discloses a checkout as manual, while immutable drift remains a failing gate:

```
[monitor] STALE LIB: 9 module(s) behind the installed package — the hook and monitor are running OLD code
[monitor] stable: manual — source is a mutable Git checkout; timer auto-heal is disabled until an explicit install
```

**It is not a daemon.** This project exists partly *because* ruflo daemons multiply; shipping
another resident watcher would be poor taste. The OS scheduler runs a short-lived check instead
(**launchd** on macOS, **cron** on Linux) which re-applies the installed target set and exits.

There's no drift heuristic and no timestamp comparison: it recomputes what each file *should* be
and compares bytes. Files are written **only when the bytes differ**, so a steady-state tick is a
few `stat`s and no I/O. It logs only when it *repairs* something:

```
2026-07-13T10:38:04.222Z REPAIRED 1 file(s) [cwd,daemon,memory] — patched daemon.js <- daemon/command-root
```

`monitor check` exits **1** on drift, so it doubles as a CI or pre-flight gate. It also surfaces
**uncovered builds**: patch discovery is package-name-driven, so a ruflo CLI published under a
name we don't list gets *zero* protection, silently. Which is how 38 daemons piled up on one cwd
from a differently-named build while `daemon status --all` reported "6 daemons, all within TTL".
Target `status`, `monitor status`, `monitor check`, and `all status` now use the same outcome contract:
patched and behaviorally native files are satisfied; a tracked zero-file target, partial target, or
uncovered runnable build prints a failure glyph and exits nonzero.

## How a patch retires itself

Every target here is temporary by design: upstream is supposed to fix these, and when it does, the
patch should get out of the way. It should not need me to notice, or you to run anything.

### Publish a predicate, not a verdict

The obvious mechanism is a list of *fixed* issues that the monitor reads and acts on. It is the wrong
mechanism, and this week showed why twice:

| Issue | Closed? | Fixed? | Runnable on your machine? |
|---|---|---|---|
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) | yes | historical partial fix; [#2878](https://github.com/ruvnet/ruflo/issues/2878) supplied the focused ordinary-writer lock | only after the installed writer set is proved, not from either label |
| [#2666](https://github.com/ruvnet/ruflo/issues/2666) | yes | current Ruflo has the complete native pieces | yes only after executing the installed skill/purge route and proving every ordinary writer shares its lock |

`closed` is not `fixed`, and `fixed` is not `runnable here`. `ruflo-adr` ships from the marketplace the
instant it lands; the `memory purge` its `/adr-reindex` calls shipped on npm **separately**. For a window
the skill was installed and the command it invokes did not exist. An unknown subcommand exits 0, so
it reported `adr-patterns: purged` having purged nothing. Later builds had a purge-only lock. Ruflo
3.38.12 finally routes purge and every ordinary sql.js writer through `withMemoryDbLock()`. This
repository retires the legacy command only after it proves that complete installed set. The stronger
local `.rsp-lock` overlay is also accepted; the version alone is not.

A retirement list keyed on "fixed" would have uninstalled a **working** reconcile on everyone still
running 3.28.0, unattended, via cron. That is this tool manufacturing its own founding failure mode on
other people's machines.

So [`lib/supersede.mjs`](lib/supersede.mjs) holds **predicates, not verdicts**. Each target declares the
condition under which it is obsolete, as code, and that code is evaluated **locally against the software
actually installed**. Retirement is a measurement, the same way the anchors are: we never trust a version
number, we check that the string is really there.

The predicate **ships in the package**. It is not fetched at runtime, deliberately: a remote file that an
unattended launchd job parses and acts on destructively is a live channel into every user's machine, where
one typo is a mass uninstall with no review at the moment it happens. Shipped in-repo, publishing a
supersession means committing a predicate and cutting a release. That is the trust boundary you already accepted,
and no new one.

### The failure direction

Every unknown biases toward **keeping** the patch:

| Situation | Verdict | Result |
|---|---|---|
| Replacement present **and** runnable here | `superseded` | retire |
| Replacement present, but cannot run (no `memory purge`) | `live` | **keep** |
| Replacement absent | `live` | **keep**. Never retire into a hole |
| CLI not found, or the probe throws | `unknown` | **keep** |

The cost of wrongly keeping a patch is a redundant slash command and a banner. The cost of wrongly retiring
one is an index that reports a successful reconcile and reconciles nothing. Those are not symmetric.

### What you see, and what you can do about it

Retiring is not uninstalling. It is recorded, with its evidence, and it **sticks**. It has to, because the
SessionStart hook re-applies everything in `state.json` and `make install` installs every target, so a
retirement with no memory of itself would be undone within the hour and redone on the next tick, forever.

```console
$ npx github:sparkling/ruflo-source-patch monitor run
RETIRED retired adr-reindex — ruflo-adr ships its own /adr-reindex AND the installed
  @claude-flow/cli registers `memory purge`, so the replacement is present and runnable.
  This is not a failure: upstream now does this job. (#2666)
```

Announced **once**, then silence. The old behaviour was a `skip:upstream-owns-it` warning that fired every
session and could never resolve itself, and a banner that always cries wolf is a banner people stop reading.
A retirement is explicitly **not** a problem, so it never triggers the *"a patch may no longer be doing
anything"* alarm. That would be crying wolf over good news.

`install` on a retired target refuses, prints the evidence, and stops. That refusal is the entire retirement
interface. **There is no `unretire` and no `pin`**, deliberately: a target retires only when its replacement
is proven present *and* runnable on that machine, so "I disagree" is not a state worth modelling, and every
override is another surface to test, document and get wrong. If the predicate is right, the answer is right.
If the predicate is wrong, fix the predicate.

Read-only actions never retire anything. `status` and `monitor check` observe; `install` and `monitor run`
repair. A `check` that quietly uninstalled things would be the worst possible violation of that rule.

## How the update reaches you

A predicate is worthless if it never arrives. Retirement only works if a machine actually *gets* the code
that knows a patch is obsolete, and nothing about a patched `node_modules` updates itself.

### The tick pulls it, not the hook

The monitor tick ends by asking GitHub for the repo's tags. If a newer **semver tag** than the running
version exists, it runs the package's own installer at that exact tag:

```bash
npx -y github:sparkling/ruflo-source-patch#v4.15.0 monitor install
```

The running version comes from the package that owns the provenance-recorded `lib/` directory. A former
off-by-one path lookup searched for `package.json` *inside* `lib/`, resolved no version, and silently
disabled this entire comparison; the real stable-copy layout is now a regression fixture.

That re-syncs the stable copy, re-registers the hook and the schedule. The new code takes effect on the
**next tick**: the child rewrites `~/.ruflo-source-patch/lib` while the current process already holds its
modules in memory, which is the same "effective next tick" rule `healStableLib()` follows.

**New targets adopt themselves, if you asked for everything.** `all install` records a "keep me on the
complete, current set" contract, and in that mode the tick runs `all install` at the new tag instead of
`monitor install`. So a target *introduced* in a later release records itself into `state.json` and applies
on its own, with no manual step (ADR-019). That is the whole premise: install once, stay patched, including
fixes that did not exist when you installed. A **cherry-picked** install is left exactly as it is: it runs
`monitor install`, its recorded set unchanged, and nothing it did not ask for is added. Any single-target
`uninstall` drops you out of the contract, because the moment you curate a subset you have stopped asking
for everything. (Retirement still applies: `all install` skips a target already superseded on your machine,
ADR-014.) One transition wrinkle: an `all` install that predates this flag adopts automatically only after
you run `all install` once more to set it, then never again.

**Not the SessionStart hook.** I built it there first, and it was the same mistake the monitor exists to
fix: the hook fires only when a session *starts*, and people leave Claude Code running for days. A patch
that upstream's restructuring has turned from redundant into actively **wrong** would keep re-applying
itself every five minutes until someone happened to restart. Bounded staleness is the entire reason there
is a scheduler, and the update is the thing that most needs bounding.

### Tags, never the branch

`github:sparkling/ruflo-source-patch` is a git **ref**, not a version: no semver, nothing immutable, and a
force-push retroactively changes what everyone already installed. Auto-pulling that is standing remote code
execution from a moving target.

A **tag** is immutable. `v4.15.0` is the same bytes forever, a bad commit on `main` reaches nobody until it
is tagged, and the version that ran is a version you can go back and read.

| Rule | Why |
|---|---|
| Immutable semver tags only (`v1.2.3`) | A branch or a moving `latest` is the live wire tags exist to avoid |
| **Forward** only | A downgrade reinstates patches upstream fixed, and un-retires what was retired on proof |
| Installs the **pinned** tag | `#v4.15.0`, never `#main` |
| Offline, or GitHub down | Keep the working version, silently. A tool that breaks itself upgrading is worse than a stale one |
| A failed install | Stay on the old version and **say so**. Half-upgraded and quiet is the failure this package hunts |
| End of the tick, never mid-apply | The child must not rewrite modules this tick is still using |
| `RSP_NO_SELF_UPDATE=1` | The kill switch. Pin your install, and keep the test suite off the network |

That last one is not hypothetical: several suites spawn `monitor run`, so without the switch running
`npm test` would reach the network and genuinely reinstall the developer's own tool.

## How you find out when a patch stops working

A patch that silently stops applying, while `status` still says *installed*, is the exact failure
this project exists to prevent. It must not be how the project itself fails, so nothing is allowed
to end its life in a log file.

### Anchors are literal, and they will break

Edits are exact string find/replace: no line numbers, no regex, no `sed`. That's deliberate. An
anchor that no longer matches is **skipped**, never guessed at. Each edit also carries alternative
anchors and a `done()` predicate that asks *"is the fix present?"* rather than *"is the anchor
absent?"*, because an anchor can be absent for two very different reasons, and only one of them
means success. (That distinction is not theoretical: it caught a copy taking 3 of 4 edits and
reporting it as fine.)

So when upstream reindents or renames, the patch degrades **loudly**:

```
adr-index: INCOMPLETE …/scripts/import.mjs — applied: upsert, edge-key;
           NOT APPLIED: records-miscount (upstream shape changed?)
```

### Two hooks, and the honest reason for each

| Hook | When | Job |
|---|---|---|
| `SessionStart` | session start | re-apply every installed target, and report anything broken |
| `UserPromptSubmit` | every prompt | **report only.** Reads one small file, usually absent (~28ms) |

The second exists because the first is too late. A new ruflo can land in the npx cache **while you
work**, which is precisely how 3.26.1 arrived and silently disabled `cwd/daemon-autostart`, and a
session-start-only warning would sit quiet for hours. The monitor detects it within one tick, but a
detached scheduled job can't reach your session; it can only leave a note. It now leaves that note
in `problems.json`, and the prompt hook reads it:

```
monitor tick (≤5 min)   →  writes ~/.ruflo-source-patch/problems.json
UserPromptSubmit hook   →  surfaces it on the very next thing you type
```

Worst case between *"patch broke"* and *"you know"* is **one tick plus one keystroke**, not one
session. It's rate-limited (an unchanged problem re-announces at most every 30 min; a new one at
once) and it **clears itself** when fixed. A stale warning is as bad as no warning.

### Watching the watchman

Every warning above is delivered by the monitor. So if the **monitor** is dead, the system goes
quiet, and quiet is exactly what healthy looks like. That's the one failure a watchdog can never
report on itself, and it voids every guarantee on this page.

The prompt hook therefore checks the monitor's own liveness. On a healthy prompt it costs an `existsSync`
and one `mtime`, no subprocess: `installMonitor` records what it scheduled in `monitor.json`. Three ways
it can be dead:

- **Its node interpreter is gone.** A version manager pinned a per-version path and a `node` upgrade
  deleted it (largely closed now: the schedule runs the manager's stable shim, ADR-021).
- **Its job script is missing.** The schedule points at a file we've since moved.
- **It simply isn't running.** An unloaded launchd job, a removed crontab line, a crash loop.

The heartbeat is a **cheap gate, not the verdict.** A stale heartbeat is ambiguous: the job dropped, OR
the machine merely idled/slept (the lunch break). The old design guessed with a generous 30-minute
threshold and still false-alarmed after lunch. Now, when (and only when) the heartbeat is older than
two intervals (10 min at the default; two consecutive missed ticks, since the hook only runs while you're
active and ticks are firing), it asks the scheduler **itself**, once: `launchctl list` / `crontab -l`.
That one authoritative question tells a dropped job (recover) from a slept one (stay silent), so the
sleep false alarm is gone and a real drop is caught in ~10 minutes rather than 30. A user who never
installed a monitor is never nagged about not having one.

**And it does not just warn: it brings the monitor back.** A dead tick cannot repair itself, so a
dropped launchd/cron job used to stay dead until someone restarted Claude Code. The prompt hook is the
one process that runs constantly, so when (and only when) its cheap liveness check finds the monitor
down, it re-registers it right there and says so. On a healthy prompt it still touches nothing. Two
further hardenings close the common causes (ADR-021): the schedule is registered against a
version-manager's **stable shim** (`mise/shims/node`, not `.../installs/node/24.14.1/bin/node`) so a node
upgrade no longer deletes the interpreter out from under it; and the job's stderr is captured to
`monitor-stderr.log`, so a crash that dies before it can log is recorded instead of vanishing.

### It found two real bugs on its first run

Not a hypothetical, so it is worth stating plainly what it caught within minutes of existing.

**The patcher could destroy the file it was patching.** Found `daemon-autostart.js` at **0 bytes** in
two npx caches, with no backup, an mtime matching a monitor tick, while the published tarball has
4,553 bytes.

The lethal path is an **empty `.rsp-backup`**. Everything is rebuilt from pristine, so an empty
pristine means: no anchor matches → the "nothing applies, restore the original" branch runs →
`writeIfChanged(file, '')` → **the real file is truncated to zero and its backup deleted.** Measured:
a healthy 3,954-byte vendor file reduced to 0 by *one* monitor tick. It is now pinned as a regression
test (`R1a`), and verified to fail without the guard.

Guarding only the *on-disk file* misses this completely. With an empty backup, a perfectly healthy
file is what gets destroyed. So both patchers now reject an empty backup outright (discard it; if the
file is already patched, refuse to guess at a pristine and say so) **and** refuse to touch a
zero-byte target.

Honest limit: the destruction path is proven and closed, but *how* those backups came to be empty is
not fully reconstructable after the fact. A torn read of a file `npx` had created but not yet
written is the likeliest origin, and is guarded, but I can't prove that's what happened. A patcher
that eats the code it patches is worse than the bug it fixes, so both doors are shut regardless.

**`cwd/daemon-autostart` had silently stopped applying on 3.26.x.** Its anchor was the
`if (autostartDisabled())` line plus its exact reason string, and 3.26.0 changed both, so #2633
folder sprawl was quietly back on the version `npx` resolves as *latest*, with `cwd` reporting a
contented 13/15. Re-anchored on the function head of `ensureDaemonRunning()`, which is stable across
3.25.1 / 3.26.0 / 3.26.1 and is also *more* correct: 3.26 reads a project-local
`claude-flow.config.json` inside `autostartDisabled(projectRoot)`, so the root has to be resolved
**before** that check, not one line after it.

## `cleanup`

De-sprawls a single project: removes its daemon and folder sprawl, the mess that accumulated
*before* the `cwd`/`daemon` patches were applied. Those prevent new sprawl; this clears the old.
([#2633](https://github.com/ruvnet/ruflo/issues/2633))

```bash
npx github:sparkling/ruflo-source-patch cleanup [dir]              # default: cwd
npx github:sparkling/ruflo-source-patch cleanup [dir] --dry-run    # preview, change nothing
npx github:sparkling/ruflo-source-patch cleanup [dir] --all-daemons  # also kill the root daemon
```

Scoped strictly to the project root (nearest ancestor `.git`):

- **Stray state dirs.** Removes any `.claude-flow` / `.swarm` in a *subdirectory*. The root's
  own are kept; they're the project's real state.
- **Daemons.** Keeps one daemon anchored at the exact root (the legit one) and kills every
  other daemon whose cwd is inside the project tree: subdirectory-anchored strays and root
  duplicates. `--all-daemons` kills the root one too (it respawns on next use).

**Hard safety:** a process is killed only if its resolved cwd is the project root or beneath it.
A daemon belonging to any other project is never touched, even by name. It also refuses to run
against `$HOME` or `/`. (This is not idle caution: an earlier ad-hoc cleanup on this machine, with
looser scoping, nearly killed unrelated sessions' daemons.)

## How it works

Each library file is rebuilt from a **pristine backup** on every apply:

```
pristine (.rsp-backup)  →  prelude(fragments the active targets need)  →  edits
```

That's what makes independent install/uninstall possible. `memory-initializer.js` is patched by
**two** targets, `cwd` (`getMemoryRoot`, config paths) and `memory` (the write lock), so
uninstalling one must un-apply *its* edits and leave the other's intact. Rebuilding from pristine
means the file is always exactly *pristine + the entries currently requested*: correct for any
subset, idempotent by construction.

Injected code is composed from **fragments with dependencies** (`req` → `resolveRoot` /
`walRefusal` / `memLock` / `integrityGate`), each emitted at most once. The shared `req` base
matters: installing `memory` *without* `cwd` would otherwise inject a lock referencing an
undeclared `__rufloReq`.

`~/.ruflo-source-patch/state.json` records which targets are installed: `patchTargets` (CLI) and
`pluginTargets` (`ruflo-adr`). The `SessionStart` hook and the monitor both read it and re-apply
exactly that set, never a target you uninstalled.

**A backup is not pristine forever.** Rebuilding from `.rsp-backup` is only correct while the vendor
file is the one we backed up. When upstream rewrites it **in place** (a `/plugin update`, or an
`npm update -g` on a global CLI install, both of which land at a *fixed* path rather than a fresh
versioned one), treating a stale backup as truth means writing old code over the new file, and the
monitor would do it every five minutes: a watchdog turned into a downgrade machine.

So a file on disk is read as exactly one of three states: **ours** (already patched, nothing to do),
**the backup** (pristine, apply), or **neither**, which means upstream replaced it, so its bytes
become the new pristine and the patches are re-derived on top. Reality outranks our snapshot, always.
If the new file no longer matches the anchors, you get `INCOMPLETE` rather than a lie, and a
`REBASELINE` line in the monitor log, which is your cue to check whether the anchors still hold.

### One install, every repo

You install this **once per machine**, not per project. `npx ruflo` doesn't put a copy of
`@claude-flow/cli` in each repo. Every repo runs the *same* binary out of the shared npx cache
(`~/.npm/_npx/`), plus any global `npm i -g` install. Global discovery follows authenticated
`ruflo`, `claude-flow`, and `claude-flow-mcp` launchers on PATH, so a custom prefix remains visible even
when its `bin` directory has no npm executable. That shared binary is what gets patched, so
there's one `state.json`, one pair of hooks (`SessionStart` to re-apply, `UserPromptSubmit` to warn),
and one monitor job covering all of them.

The patch is global, but its **behaviour is per-repo**, decided at call time: the injected code
calls `__rufloResolveRoot(process.cwd())` on every invocation, so the same binary run from repo A
resolves A's project root and locks A's `.swarm/memory.db`, while run from repo B it resolves B's.
One patch, per-repo effect. Which is why the data each repo stores (`.swarm/`, `.claude-flow/`,
the daemon PID and locks) stays cleanly separated even though the code fixing it is shared.

That's also why the monitor is a single machine-wide job: it has nothing per-repo to track. Its
only job is "keep the shared binary patched," so when *any* repo pulls a new `ruflo` version into
a fresh cache dir, one tick re-patches it and every repo is covered again.

**Safety.** Writes are atomic (temp → `fsync` → rename), because the monitor rewrites these files
while Claude Code sessions are importing them. Backups are the untouched vendor files, so a full
uninstall restores **byte-identical** originals. Version drift is safe-failed **per entry**: an
anchor that no longer matches is skipped individually. Never a partial write, never blocking its
neighbours.

## Tested

The owner-requested hourly job uses `scripts/hourly-regression.mjs`, 26 focused
fixture families, the canonical Product source fixtures, bounded read-only calls
through existing Mac/HZ MCP sessions, one HZ source search, and a native OpenAI
`gpt-6.1-sol` review at medium effort. Memory checks first discover and verify native
AgentDB health, so successful list/exact reads through an unavailable backend or
local ReasoningBank fallback cannot pass. Optional disabled controllers and durable
SQLite tier composition remain valid. Source checks distinguish cached response
proof from fresh inventory observations. It has one
owner lock, finite runtime/output/memory limits and private bounded receipts under
`~/.local/state/ruflo-source-patch/hourly-regression`; it does not control projects
or send console prompts. The latest release-4.46.128 qualification passed on
4 November at 12:58 UTC: 53 source fixtures, all patch fixture families, four
memory checks, a fresh 20.323-second Strategy source search and the Sol Medium
review. The earlier 10:47 UTC run passed 41 Product tests and a 46.9-second search;
those timings preceded bounded native read groups.
Forced background CPU/I/O policy reproduced fixture admission failures; Standard
scheduling fixed that runner defect without changing production or test deadlines.
Fixture success, live read success and historical record recovery remain distinct.
The shared source-facade repair belongs to Product rather than an installed-package
patch: [inventory correction](https://github.com/sparkling/semantic-product/commit/ef35842)
and [incomplete-result cache correction](https://github.com/sparkling/semantic-product/commit/b36bd72).
Before pagination and bounded-read activation, cold concurrent R5/R7 searches
passed at 125.5/172.8 seconds with no coverage gaps;
the 180-second deadline is unchanged and queue capacity remains finite.

The runner also includes focused suites for the recent targets: native SQLite dependency ownership,
exact fallback pattern receipts, immutable verified policy serialization, hook failure attribution,
transition notice/validation, managed CLI capture/generation/terminal diagnostics, progression
collisions, streaming outbox reads, bounded continuity summaries, explicit operator suspension and
fresh host recovery. These exercise isolated fixtures, anchor drift, exact composition/removal and
the relevant native behavioral boundaries. They do not establish that an existing host process has
reloaded or that automatic continuity works on a mature live history. Verify those separately.

`npm test` runs a property fuzzer: 60 random sequences × 8 steps over
`{cwd, daemon, memory} × {install, uninstall, status}`, with a monitor tick after **every** step,
asserting after every step:

| | Invariant |
|---|---|
| **I1** | an entry is applied ⟺ its target is installed, checked **per entry**, so it catches a target missing from a file *shared* with another target |
| **I2** | every patched file still parses as valid ESM |
| **I3** | empty state ⇒ every file byte-identical to pristine, no backups left |
| **I4** | no stray temp files, ever |
| **I5** | `monitor check`'s exit code matches actual drift |
| **I6** | installing twice is a no-op the second time |
| **I7** | no vendor file is **ever** truncated to zero bytes |

Plus deterministic regressions for the two bugs that actually shipped. Random sequences never
generate either, because both need the **vendor file to change underneath us**, which no sequence of
our own commands can do:

| | Regression |
|---|---|
| **R1a** | an empty `.rsp-backup` never destroys the real file *(without the guard: 3954 → 0 bytes)* |
| **R1b** | a zero-byte target is never patched, and never adopted as pristine |
| **R1c** | **`uninstall`** never destroys the file from an empty backup *(without the guard: 3954 → 0)* |
| **R2** | an in-place vendor update is **re-baselined**, not reverted to a stale backup *(without the guard: "CLOBBERED an upstream update")* |

A second suite covers the **plugin patches, the notifier, and the monitor's own liveness**: 30
sequences × 6 steps over `{adr-template, adr-index} × {install, uninstall, status}`, plus:

| | |
|---|---|
| **P1 to P5** | applied ⟺ installed · pristine restore · still parses · never truncated · idempotent |
| **R3** | an in-place `/plugin update` is re-baselined, not reverted *(without the guard: "CLOBBERED")* |
| **R4** | an empty backup never destroys the plugin file, on **`monitor run` and `uninstall`** *(without the guard: 13337 → 0)* |
| **R5** | a broken anchor is reported as `INCOMPLETE` and **names the edit that failed**, never silently skipped |
| **N1 to N4** | the notifier: silent when healthy · announces the break · rate-limits · self-clears when fixed |
| **H1 to H4** | monitor liveness: silent when no monitor installed · stale heartbeat · dead interpreter · missing script |

The remaining suites cover **every path where a failure could be mistaken for success**, which,
for a package that is almost entirely notification paths, is the only thing that matters. They exist
because the first two stayed green through a round of fixes they were green *before*: they pinned the old
invariants, and an untested notification path rots without anyone noticing.

| | |
|---|---|
| **S1 to S9** | the **stable copy**, the code the hook and monitor actually *run*. `~/.ruflo-source-patch/lib` is an executable, not a cache. Provenance is recorded · immutable package drift **fails `monitor check`** and self-heals · mutable Git checkout edits remain manual and are never timer-deployed · an explicit mutating command refreshes either source · non-`.mjs` assets reach the copy too |
| **E1 to E3** | the **error path**. A patch that **throws** is counted, summarised, exits nonzero, and reaches the notifier. Before: logged, counted nowhere, matched by none of *three divergent* regexes, and summarised as `nothing to do` |
| **A1 to A2** | an **ambiguous anchor** is refused, never guessed at. Uniqueness is a property of *upstream's* code (a measurement, not a promise), so it is checked on every apply |
| **RB1 to RB5** | a **re-baseline hands over instructions**, not just a warning: the real `diff` command, what to look for in the new code, and how to back the patch out. And an *ordinary* problem does **not** print the essay |
| **V1 to V7** | **`verify-interface`**, behavioural rather than textual. The unpatched fixture really does block (else all of it is vacuous, and V1 caught exactly that on its first run) · the false positives are gone · **an unread interface still blocks** · and a **partial apply writes nothing**, because these five edits are interdependent |
| **CC · ML · IG/WG** | **concurrency and memory safety.** Three simultaneous installs lost a target in **12 runs out of 12** before `state.json` got a lock; one fail-closed transaction now covers state + disk. ML executes the injected lock across two processes (80/80 updates), unrelated sibling Promises (40/40), nested reentry, acquisition failure, and late-release ownership. IG/WG execute the real image guards: healthy/fresh files pass, torn or unverifiable files fail, live WAL sidecars refuse without mutation, and the former checkpoint shim is absent |
| **CL · K** | **`cleanup`**, the only command that removes directories and signals processes. `--dry-run` deletes nothing · the project's own state **survives** · `$HOME` is refused · and **K3: another project's daemon survives.** Real processes, real `pgrep`/`lsof`/`ps` |
| **SS · MI · DH** | the **SessionStart hook** actually re-applying to a fresh npx copy · the plist, cron spec and interval clamp · and the offline `dual` host-boundary harness proving policy/MCP preservation, rollback, migration, and symlink refusal |
| **CW · DN · AR-N** | exact Ruflo 3.38.16 residual cwd/session shapes · native daemon resolver execution plus route/resolver mutations and terminal retirement · native reindex writer-lock proof plus an unlocked-writer mutation and nested public-wrapper discovery |
| **CS** | **Codex skill rendering, ownership, and #76 retirement.** JavaScript replacement tokens remain literal · active immutable notes execute with their exact version · a missing-notes mutation fails closed · an owned malformed render migrates from verified pristine · retirement restores only vendor bytes |
| **BNR** | **Brain native retirement.** #81 common/configured/scoped/invalid discovery · #86 packed/staged catalog, synthetic provider keys, missing-catalog refusal, and UI truth state · deliberate regressions fail · simultaneous composed retirement does not re-apply a sibling |
| **BL1 onward** | **Brain release lockstep.** Bounded npm/npx/persistent-runtime discovery · all five release-bearing components compared · `v` prefixes normalized · split releases fail health · partial/ambiguous anchors write nothing · deleting the doctor gate invalidates patch evidence · public install/status/uninstall round-trips every byte · current native identity/convergence/check/verdict qualification · exact modern overlay retirement with sibling preservation · helper/wiring mutation refusal |

**Every regression is mutation-tested**: the guard is removed and the test confirmed to fail. That
discipline has now caught **six vacuous tests**, ones that passed with the guard deleted, and were
therefore proving nothing.

The worst was the **fuzzer itself**. Its oracle was `state.json`, so 480 steps a run asserted *"the files
agree with the bookkeeping"* and **nothing ever asserted that either agrees with the commands you typed**.
A CLI mutated to uninstall targets the user never named passed all 60 sequences. It also caught
`restore()` bypassing every guard (making **`uninstall` the most destructive command in the tool**), and
`monitor check` **healing the drift on its way to checking for it**, a gate that could only ever say *ok*.

A test that cannot fail is worth nothing, and you only find out by making it fail on purpose.

## Upstream issues

Issue state is evidence to inspect, never the retirement signal. A source fix or closed issue becomes
a retirement only after the installed native artifact passes the relevant behavior proof.

### Live issue review of 2026-10-19

All 120 distinct issues linked here were read through GitHub's live API: 88 closed,
32 open. This records issue state, not a fresh behavior qualification of every
native replacement. Earlier dated audits below remain historical evidence.

| Issue | Current state and latest evidence |
|-------|-----------------------------------|
| [Ruflo #2977](https://github.com/ruvnet/ruflo/issues/2977#issuecomment-6274075319) | Open. Dead imports were removed upstream; native consolidation still reports unsupported. The update records 4.46.68's bounded native-owner tier preservation and 4.46.69's verified-copy consumer correction. |
| [Ruflo #3314](https://github.com/ruvnet/ruflo/issues/3314#issuecomment-6274080012) | Closed for the original field mapper. The update distinguishes strict downstream eligibility and verified-copy counting from that original correction; it does not request reopening the completed mapper defect. |
| [Brain #377](https://github.com/stuinfla/ruvnet-brain/issues/377#issuecomment-6274079996) | Closed in 4.7.21; native ownership verified. The earlier update records Brain 4.7.14's adopted-user-store rejection beneath a parent Git checkout, consent/path safeguards, both hook-entry checks and automatic Codex capture/readback evidence. |
| [Ruflo #2946](https://github.com/ruvnet/ruflo/issues/2946#issuecomment-6274079944) | Open. The update records an explicit two-package npx launch and fresh scanner verification, including the project-local bootstrap caveat. Manually side-loading an npx cache is still unsupported. |
| [Ruflo #3143](https://github.com/ruvnet/ruflo/issues/3143#issuecomment-6267441004) | Closed after native identity qualification. The latest existing update already records the restored two-store ownership and exact producer-store trajectory readback without replay. |
| [Ruflo #4287](https://github.com/ruvnet/ruflo/issues/4287#issuecomment-6267440939), [#4291](https://github.com/ruvnet/ruflo/issues/4291#issuecomment-6267440938) | Open. Existing October 19 updates distinguish deployed downstream backup/graph-binding mitigations from upstream fixes. |

### Recent repair coverage reviewed 2026-10-05

This table links the recent registered repairs to their acceptance boundary. It is not an assertion
that every host has activated the patch, or that the issue remains open today. The target catalog
above includes the older repairs and their issue mappings too.

| Issue | Registered target | Acceptance and current limitation |
|-------|-------------------|-----------------------------------|
| [Ruflo #3693](https://github.com/ruvnet/ruflo/issues/3693) | `ruflo-sqlite-owner` | One native dependency owner across graph/repair and registry paths; no competing library or closed borrowed handle. |
| [Ruflo #3691](https://github.com/ruvnet/ruflo/issues/3691) | `ruflo-pattern-receipt` | Successful native store plus exact namespace/key/content readback; failed persistence must remain a failure in both MCP and bridge handlers. |
| [Ruflo #3164](https://github.com/ruvnet/ruflo/issues/3164), [anchor follow-up #4883](https://github.com/ruvnet/ruflo/issues/4883) | `ruflo-policy-serialization`, `ruflo-policy-ledger`, `ruflo-memory-owner`, `ruflo-policy-anchor-copy` | Qualified native 3.71 receipt retention supersedes the older local ledger overlays. Pristine 3.72.2 still traverses and rewrites the separate anchor history. Owner-side queuing, bounded native JSON parsing and authenticated copy reduce cost without changing history or authorization; bounded transaction cost remains unresolved. |
| [Ruflo #3229](https://github.com/ruvnet/ruflo/issues/3229) | `ruflo-flywheel-evidence` | Residual 3.52.0 evidence encoding; retirement requires native nested-fraction signing and strict tamper refusal. No historical migration or gate weakening. |
| [Ruflo #2579, source context](https://github.com/ruvnet/ruflo/issues/2579) | `ruflo-champion-authority` | Reproduced 3.52.0 startup conflict with ADR-322A promotion authority; no defect-specific upstream issue found. Retirement requires unpatched native authority/lock behavior, normal framework updates, and preservation of foreign locks. |
| [Ruflo #3688](https://github.com/ruvnet/ruflo/issues/3688) | `ruflo-swarm-codex-hooks` | Declared command hooks must reach a strict Codex manifest without changing Claude modules or granting hook trust. |
| [Brain #380](https://github.com/stuinfla/ruvnet-brain/issues/380) | `brain-transition-notice` | Same-session pending notices may deduplicate; distinct failures and exact persistence requirements must remain visible. Native release changes require behavior proof. |
| [Brain #382](https://github.com/stuinfla/ruvnet-brain/issues/382) | `brain-managed-cli-capture` | Real actions must enter native capture before no-op comparison, with redaction and accurate receipts. |
| [Brain #383](https://github.com/stuinfla/ruvnet-brain/issues/383) | `brain-progression-collision` | Frozen collisions must preserve both immutable histories and conflict evidence; a new sibling requires independent exact readback before consuming work. |
| [Brain #384](https://github.com/stuinfla/ruvnet-brain/issues/384) | `brain-managed-cli-generation` | Dispatch and successful-help authorization must bind to the validated native-selected generation, including promotion races and missing/unsafe manifests. |
| [Brain #385](https://github.com/stuinfla/ruvnet-brain/issues/385) | `brain-transition-validation` | One verified restore per capture, with independent public-builder validation and unchanged invalid-history/dedup/ancestry behavior. This does not bound cumulative history. |
| [Brain #386](https://github.com/stuinfla/ruvnet-brain/issues/386) | `brain-managed-cli-diagnostics` | Nonempty stdout must not hide timeout/signal/error evidence; durable observations must preserve the real terminal outcome. |
| [Brain #387](https://github.com/stuinfla/ruvnet-brain/issues/387) | `brain-outbox-streaming` | Exact native 4.5.6 and 4.5.7 pass complete ordered journal reads beyond the whole-string limit; unknown drift and malformed records fail closed. Only 4.5.7 supplies the separately tested lazy replay containment. |
| [Brain #389](https://github.com/stuinfla/ruvnet-brain/issues/389) | `brain-continuity-summary` | Display bounds preserve exact goals/actions and canonical evidence. A fitting summary is not proof of successful persistence or bounded restoration. |
| [Brain #390](https://github.com/stuinfla/ruvnet-brain/issues/390#issuecomment-5990955062) | `brain-progression-suspension` | **Partially addressed upstream in 4.5.7:** native outbox containment and operator suspension are replacement candidates. Bounded mature-history capture/restore remains unproved; retain explicit suspension and pending evidence until behavior and migration preservation are verified. |
| [Brain #391](https://github.com/stuinfla/ruvnet-brain/issues/391) | `brain-host-recovery` | Native causal attribution and exact 4.5.8/4.5.9 declaration reconciliation are accepted with dependency proof. Older overlays stay restricted to known hook-manifest changes; executable/MCP readiness and historical failures require separate evidence. |
| [Local #5](https://github.com/sparkling/ruflo-source-patch/issues/5) | `hook-failure-log` | Attributed private hook failure receipts without payload logging or execution changes. No automatic native retirement predicate is registered. |

The [4.5.7 #390 assessment](https://github.com/stuinfla/ruvnet-brain/issues/390#issuecomment-5990955062)
separates tested outbox containment and native suspension from the still-proposed verified frontier.
It does not relabel earlier 4.5.4/4.5.5 timings as 4.5.7 results. Publication is distinct from native
host activation, and equivalent native behavior is distinct from successful downstream installation.

### Historical upstream audits

The remainder records the 2026-08-15 and 2026-08-31 audits, with subsequent explicitly versioned
findings. Its open/closed labels and references to “current” code describe those audit artifacts,
not a 2026-10-05 recheck of every issue. Preserve this evidence when assessing a newer replacement.

The full audit was refreshed on
2026-08-15 against exact published Ruflo 3.38.12, `ruflo-core` 0.2.6, active Claude/Codex caches,
published Brain 4.0.36, current upstream issue threads, and exact installed behavior. A focused
2026-08-31 revalidation reproduced Ruflo #3143 on 3.38.20 and the Codex cache-lifecycle gap in active
Brain 4.3.3. It also reproduced the `ruflo-adr` verifier/import/reindex boundary in current main and
active 0.4.1 host copies. #2877 and the legacy #2666 compatibility target retire on executable native
proof; #2878 supplies the native ordinary-writer baseline, while #3097 records the still-non-atomic
purge/rebuild and #3147 records incomplete fail-open reads. Brain #76, #81, and #86 remain retired after
executable replacement and mutation proof.
#79 remains narrowed despite closure; #77's legacy doctor repair is retained, while the
qualified current native doctor retires its blanket equality overlay; #223 tracks the missing Codex live-generation lease after #128/#153; and #129/#130
track native update-plane defects that this downstream package must not replace. MetaHarness #168
remains reproducible in `metaharness@0.4.7` and `@metaharness/host-codex@0.1.2`.

**"Fixed upstream" is a claim about a runnable artifact, not a branch, version string, or
closed label.** The historical table records acceptance results within the stated audit scope.

| Issue | Verified verdict | Local result |
|-------|------------------|--------------|
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) | **Closed historical/incomplete.** Its quoted-sequence fix did not make ordinary writers share a lock | Superseded as the active acceptance target by focused #2878 |
| [#2878](https://github.com/ruvnet/ruflo/issues/2878) | **Closed and delivered for the ordinary-writer baseline in 3.38.12.** `ensureSchemaColumns`, temporal decay, store, get, delete, and purge share native `withMemoryDbLock()` | Keep `memory` only for its stronger fail-closed ownership/outer serialization, WAL refusal, integrity gate, and stale-writer recovery |
| [#3143](https://github.com/ruvnet/ruflo/issues/3143) | **Closed as completed on 2026-10-19. Native replacement verified.** The identity/lifecycle proof passes pristine 3.56.10; pristine published 3.57.0 also passes native CRUD/list/search/purge, project/user isolation, aliases, initialization-failure isolation and fresh-process visibility in disposable stores | Native identity overlay stays off; default two-store ownership is distinct from explicit source binding and unrelated memory safety overlays |
| [#2633](https://github.com/ruvnet/ruflo/issues/2633) | **Open, residual live in 3.38.16.** Durable permission/swarm/neural/helper/hook-session state still has raw or implicit cwd paths; daemon identity is fixed separately by #2877 | Keep `cwd` and `cleanup`; release-shaped session repairs fail closed on drift, and `daemon` retires on native proof |
| [#2634](https://github.com/ruvnet/ruflo/issues/2634), [#2635](https://github.com/ruvnet/ruflo/issues/2635), [#2636](https://github.com/ruvnet/ruflo/issues/2636), [#2637](https://github.com/ruvnet/ruflo/issues/2637) | **Fixed completely** in 3.32.36/3.32.37: backed skills, adapter fallback, both native scaffolds, root secret ignores | `dual` remains for #2638 and its stricter transaction, not these defects |
| [#2638](https://github.com/ruvnet/ruflo/issues/2638) | **Open.** Claude and Codex instructions still have separate generators | Keep `dual` |
| [#2640](https://github.com/ruvnet/ruflo/issues/2640) | **Open, partial.** Atomic event claims prevent duplicate side effects, but init still emits the duplicate bundle/hooks/MCP | Keep `init`, `plugin-only` |
| [#2651](https://github.com/ruvnet/ruflo/issues/2651) | **Fixed completely** in 3.32.37 | No patch |
| [#2659](https://github.com/ruvnet/ruflo/issues/2659) | **Fixed completely for active hosts.** The automatic plugin refresh delivered current parser bytes and all four active Claude/Codex marketplace/cache copies pass the creator/indexer round trip | `adr-template` retires locally on executable proof; #2870 independently tracks the reused identity |
| [#2660](https://github.com/ruvnet/ruflo/issues/2660) | **Fixed completely for active hosts.** All active Claude/Codex copies execute native convergence and honest counting, and native `adr-index` routes deletions to native `adr-reindex` | `adr-index` retired on local proof; #2870 remains a separate release-identity issue |
| [#2666](https://github.com/ruvnet/ruflo/issues/2666) | **Closed and complete for its compatibility/locking scope in the exact 3.38.12 installation.** Native reindex/purge exist and purge shares `withMemoryDbLock()` with every ordinary sql.js writer. That does not prove the later purge-plus-rebuild sequence is atomic | `adr-reindex` remains retired; `adr-io-safety` separately refuses the residual destructive path tracked in #3097 |
| [#3097](https://github.com/ruvnet/ruflo/issues/3097) | **Open and reproduced in current main / active `ruflo-adr` 0.4.1.** Scan root and database identity are conflated; failed stores can exit zero; serial per-row startup has no timeout; the plugin's npx child can select a different storage driver from installed Ruflo; and purge-first reindex can erase the live graph before a later failure | Keep `adr-io-safety`: installed-Ruflo runtime, exact store path, managed preflight, fresh-process byte readback, fail-fast/nonzero import, and zero-mutation live-reindex refusal until one atomic managed reconcile exists |
| [#3147](https://github.com/ruvnet/ruflo/issues/3147) | **Open and reproduced in current main / active `ruflo-adr` 0.4.1.** Verifier failures become `[]`, the default 20-row page is treated as complete, malformed edges are silently skipped, and same-version npx/installed Ruflo can read through different drivers | Keep `adr-io-safety` until the installed verifier uses the live managed runtime, proves complete namespace reads, and fails every spawn/signal/timeout/nonzero/parse/schema/cap error while preserving a genuine empty graph |
| [#2672](https://github.com/ruvnet/ruflo/issues/2672) | **Correctly retracted / not planned.** Its premise was false | No patch |
| [#2685](https://github.com/ruvnet/ruflo/issues/2685), [#2706](https://github.com/ruvnet/ruflo/issues/2706) | **Fixed completely.** Fleet and missed core references are native | `mcp-prefix` retired |
| [#2765](https://github.com/ruvnet/ruflo/issues/2765) | **Fixed completely** in 3.32.36 | No patch |
| [#2777](https://github.com/ruvnet/ruflo/issues/2777) | **Fixed completely** in 3.32.10 | `init` retains shape-gated legacy compatibility only |
| [#2801](https://github.com/ruvnet/ruflo/issues/2801) | **Fixed completely** after registration plus the 3.32.39 version-bumped strict manifest | One-shot repair only for old installs; schema target retired |
| [#2816](https://github.com/ruvnet/ruflo/issues/2816) | **Fixed completely** in 3.32.39 / PR #2857; both real PreToolUse branches emit Codex-valid output | `ruflo-hooks-schema` retired |
| [#2821](https://github.com/ruvnet/ruflo/issues/2821) | **Fixed completely.** Native status is read-only by default; repair requires explicit intent | `ruflo-codex-skills` retired |
| [#2854](https://github.com/ruvnet/ruflo/issues/2854) | **Open; revalidated on published 3.38.12 and main `fa13ee4`.** No native dual-host marketplace reconciliation; the bundled Codex initializer still uses `which codex` and shell strings, and host registry presence does not prove a live marketplace root | Keep `plugin-hosts`; exact fragment revision, bounded cross-host executable discovery, supported-CLI stale-root repair, and initializer execution tests cover the downstream delta |
| [#2870](https://github.com/ruvnet/ruflo/issues/2870) | **Open.** Three current plugin versions identify multiple source trees; all 35 current identities were audited | `plugin-hosts host-refresh` repaired the three local host pairs through supported CLIs; wait for bumped versions plus a fleet-wide release guard |
| [#2877](https://github.com/ruvnet/ruflo/issues/2877) | **Closed/fixed and released in 3.38.11+.** The installed resolver routes autostart and every direct daemon identity to the nearest project root; executable nested-root, nested-project, `.git` stop, and no-marker tests pass | `daemon` terminally retires on that proof and remains available only for legacy releases |
| [MetaHarness #168](https://github.com/ruvnet/metaharness/issues/168) | **Open; source gap rechecked in exact published `metaharness@0.4.19` and `@metaharness/host-codex@0.1.3` on 30 October.** `HarnessSpec.hooks` exists, Claude consumes it, but the Codex adapter, CLI scaffold, and Studio path omit native project hooks while ADR-004 still says Codex has none | Keep `metaharness-codex-hooks` for supplied declarations; upstream must complete all generator paths, packaged handlers, trust messaging, tests, and the listed documentation updates |
| [Brain #12](https://github.com/stuinfla/ruvnet-brain/issues/12), [#13](https://github.com/stuinfla/ruvnet-brain/issues/13), [#17](https://github.com/stuinfla/ruvnet-brain/issues/17) | **Fixed completely** and behaviorally proved | `verify-interface`, `design-wall` retired |
| [Brain #41](https://github.com/stuinfla/ruvnet-brain/issues/41) | **Closure not sound after its body was broadened.** The closing comment proves the earlier quote fix, not the edited nested-invocation acceptance | Superseded by #44/#48; no new patch |
| [Brain #42](https://github.com/stuinfla/ruvnet-brain/issues/42), [#43](https://github.com/stuinfla/ruvnet-brain/issues/43) | **Fixed completely.** Codex MCP/plugin packaging is present without the retracted `skill.toml` proposal | No patch |
| [Brain #44](https://github.com/stuinfla/ruvnet-brain/issues/44) | **Superseded, not completed as written.** Raw Bash is now advisory rather than a blocking recursively parsed authority | Covered by the #48 replacement proof |
| [Brain #48](https://github.com/stuinfla/ruvnet-brain/issues/48) | **Its managed CLI/MCP replacement remains fixed and released.** The residual direct-SQLite detector and enforcement gaps are now isolated in #102/#103 rather than reopening #48's completed interface work | `verify-interface` remains retired; keep `brain-managed-memory-boundary` for the residual store boundary |
| [Brain #52](https://github.com/stuinfla/ruvnet-brain/issues/52) | **Fixed in 4.0.2; automatic hooks intentionally withdrawn by installed Brain 4.3.10.** Native 4.3.10 ships an explicit empty Codex hook registry instead of the former six-event wrapper | `codex-hooks` retires on either exact native behavior and never reinstates withdrawn hooks |
| [Brain #53](https://github.com/stuinfla/ruvnet-brain/issues/53) | **Fixed completely.** Atomic daily/project cadence passes concurrency behavior | `flywheel-daily` retired |
| [Brain #54](https://github.com/stuinfla/ruvnet-brain/issues/54) | **Fixed and released in 4.0.2.** A clean public install returned cited RVF results inside the published timeout evidence | No patch |
| [Brain #56](https://github.com/stuinfla/ruvnet-brain/issues/56) | **Fixed for its discovery scope.** Native Console/what's-new skills and self-contained aliases are published | The separate installed release-note defect is #76 |
| [Brain #64](https://github.com/stuinfla/ruvnet-brain/issues/64) | **Fixed and released in 4.0.2.** This machine auto-flipped 4.0.1→4.0.2 and recorded both Claude and Codex `ready` | No downstream updater patch was added |
| [Brain #66](https://github.com/stuinfla/ruvnet-brain/issues/66) | **Fixed and released in 4.0.2.** The focused newest-store memory detection suite passes upstream | No patch |
| [Brain #76](https://github.com/stuinfla/ruvnet-brain/issues/76) | **Closed and delivered in active 4.0.12.** PR #110 binds the executable and every asset it reads to one runtime surface and validates the staged workflow before activation | `brain-codex-skills` retires terminally after positive exact-version execution and a missing-notes mutation |
| [Brain #77](https://github.com/stuinfla/ruvnet-brain/issues/77) | **Closed; current native doctor qualified on 2 November.** Accepted ADR-089/098 distinguish coherent search/runtime integrity and host convergence from blanket version equality | Modern overlay retires on executable native classifier/check/verdict and exact restoration proof. Legacy repair remains; unknown native bytes refuse qualification. Historical issue scope is not imposed as current doctor policy |
| [Brain #78](https://github.com/stuinfla/ruvnet-brain/issues/78) | **Closed and delivered in published 4.0.36.** The persistent server answers `tools/list` from its static fallback and handles managed CLI tools without awaiting worker warmup | No local runtime patch |
| [Brain #79](https://github.com/stuinfla/ruvnet-brain/issues/79) | **Closed, but incomplete against its own doctor acceptance criterion.** PR #110 fixes whole-runtime identity and detached-process replacement; the released doctor still does not re-probe candidate/runtime/receipt/live/PID/API convergence | Keep the narrowed `brain-console-lifecycle` doctor overlay; native launcher bytes are accepted and preserved |
| [Brain #81](https://github.com/stuinfla/ruvnet-brain/issues/81) | **Closed and delivered in active 4.0.12.** The shared root implementation passes common/configured, exact-root, invalid-config, malformed-config, and Console-convergence probes | `brain-memory-doctor-roots` retires terminally on that local executable proof |
| [Brain #86](https://github.com/stuinfla/ruvnet-brain/issues/86) | **Closed and delivered in active 4.0.12.** The catalog is packed/staged/validated and missing data produces an explicit unverified UI state | `brain-console-provider-keys` retires terminally on positive, degraded, staging-refusal, and UI behavior |
| [Brain #102](https://github.com/stuinfla/ruvnet-brain/issues/102) | **Closed and published in 4.0.36.** The structural invocation classifier fixes flag misses, grep variance, and prose false positives | Keep `brain-managed-memory-boundary` only for #103's remaining default-enforcement/diagnostic delta; preserve the native detector |
| [Brain #103](https://github.com/stuinfla/ruvnet-brain/issues/103) | **Closed but behaviorally incomplete in published 4.0.36.** The opt-in `managedMemoryBoundary` setting supplies `read-only` / `block`, but defaults to `advise`; the maintainer explicitly records that host non-execution is unproved, and no audited diagnostic or truthful doctor/Console state landed | Keep `brain-managed-memory-boundary` until the complete published boundary passes both hosts and the diagnostic/mutation matrix |
| [Brain #128](https://github.com/stuinfla/ruvnet-brain/issues/128) | **Closed after fixing stale-generation discovery, but its recorded live-session counterexample was not covered by immediate pruning.** A fresh session must see only the registry generation; an open session must keep its boot-catalog paths readable | Fresh discovery remains native. Live-generation retention moved to #153 for Claude and now #223 for the missing Codex half |
| [Brain #153](https://github.com/stuinfla/ruvnet-brain/issues/153) | **Closed and delivered for Claude in active 4.3.3.** Exact PID-incarnation `.in_use` leases protect Claude cache generations, registry bytes are re-read at deletion, and ambiguous state fails closed. The shipped pruner still reads only Claude's registry and Codex has no equivalent lease | Preserve the native Claude fix. Do not claim its “dual-host integration” test proves a live Codex boot catalogue; #223 supplies that real-host acceptance matrix |
| [Brain #223](https://github.com/stuinfla/ruvnet-brain/issues/223) | **Open and reproduced in active 4.3.3.** A Codex session catalogued 4.2.2-dev; native convergence replaced its cache with 4.3.3, leaving the absolute `SKILL.md` path dangling. Claude has `.in_use` leases; Codex does not | No downstream cache, updater, stable-path, delay, or pin. Upstream must add an exact Codex session/app-server generation lease and lease-aware host GC; the current session recovers only by restart after saving work |
| [Brain #224](https://github.com/stuinfla/ruvnet-brain/issues/224) | **Fixed in this Mac's active shared KB.** The exported `symbolRoute()` checks own array-valued entries; executable inherited, malformed, and own-array probes pass | Retire `brain-search-safety` only with the #225 guidance proof too |
| [Brain #225](https://github.com/stuinfla/ruvnet-brain/issues/225) | **Fixed in this Mac's active shared KB.** MCP and CLI total-failure paths call one shared diagnosis-first helper; neither prescribes an unproved install or download | Retire only after checking both call sites and executing the helper; a missing or permissive helper blocks retirement |
| [Brain #272](https://github.com/stuinfla/ruvnet-brain/issues/272) | **Closed upstream; residual verified in 4.7.21 on 30 October.** The native helper now emits an MCP persistence request, but still accepts `proof === true` without exact-key persistence evidence | Keep `brain-dual-host-receipt` only for structured exact namespace/key/value verification; no second memory driver |
| [Brain #273](https://github.com/stuinfla/ruvnet-brain/issues/273) | **Open and reproduced on active 4.3.11/Linux.** Cross-critique serializes the other host's complete proposal into one positional argument; proposals above `MAX_ARG_STRLEN` fail in `spawn()` with `E2BIG` before synthesis | Keep `brain-dual-host-stdin`: retain all host flags, stream complete prompts over stdin, and prove >256 KiB payloads byte-for-byte without temp files |
| [Brain #129](https://github.com/stuinfla/ruvnet-brain/issues/129) | **Open on published 4.0.36.** Non-Darwin `--enable-nightly` exits successfully after printing a KB-only cron recipe; the installed macOS LaunchAgent invokes that same `forge-update.mjs --apply` path. Neither scheduled route runs full host convergence | Keep the one native SessionStart coordinator; do not add a downstream updater. Upstream should make every platform scheduler call one stable full coordinator, install/verify a systemd-or-cron Linux job, give Windows a real scheduler or explicit nonzero unsupported result, and add a coordinator-wide lock |
| [Brain #130](https://github.com/stuinfla/ruvnet-brain/issues/130) | **Open on published 4.0.36.** One failed run created 23 full snapshots (~43 GiB) and downloaded the same combined bundle 23 times; four older copies made 27/~50 GiB cumulative. The internal reclaimer then refused every backup because `node_modules/.bin/semver` made its recursive inventory “incomplete” | No raw deletion or replacement reclaimer. Preserve the backups until upstream downloads/applies once per transaction, retains at most one full-copy-equivalent rollback, scopes inventory to governed stores, distinguishes pre-existing guard failure, and exposes a supported dry-run reclaim command; #131 is the duplicate macOS report |
| [Brain #133](https://github.com/stuinfla/ruvnet-brain/issues/133) | **Open on published 4.0.36.** #122 intentionally exits an idle worker after 15 minutes, but the stable parent records that clean retirement as unexpected. Every live shell also overwrites one user-global readiness receipt, making multi-session health last-writer-wins | No downstream lifecycle shim. Upstream should add a structured worker-retirement handshake, per-shell readiness with PID-reuse-safe aggregation, healthy-idle/next-search respawn semantics, and multi-shell crash/idle/ready regression proof |

**Contributed a reproduction + fix (filed by someone else):**

| Issue | What's wrong upstream | Worked around by |
|-------|-----------------------|------------------|
| [#2621](https://github.com/ruvnet/ruflo/issues/2621) | daemon ↔ MCP last-writer-wins **silently drops writes**. We posted a 30-line repro and the lock implementation | `memory` write lock |
| [#2594](https://github.com/ruvnet/ruflo/issues/2594) | **Fixed in 3.32.36.** Before that release, `memory store --help` declared upsert as the default while an omitted flag still performed a strict INSERT. We measured it and posted the reproducer | The native importer now passes `--upsert` explicitly; the compatibility target is retired |

**Referenced (upstream, not ours):** the legacy `daemon` transform retains the native lock from
[#2407](https://github.com/ruvnet/ruflo/issues/2407) / [#2484](https://github.com/ruvnet/ruflo/issues/2484)
unchanged; [#2877](https://github.com/ruvnet/ruflo/issues/2877) now supplies the current native root identity;
the `memory` write lock builds on the [#2584](https://github.com/ruvnet/ruflo/issues/2584)
corruption close-out, and its atomic-write baseline is [#2585](https://github.com/ruvnet/ruflo/pull/2585);
the WAL-sidecar-refusal half follows [#2735](https://github.com/ruvnet/ruflo/issues/2735) and
addresses the historical visibility symptom reported in
[#2646](https://github.com/ruvnet/ruflo/issues/2646) and [#2652](https://github.com/ruvnet/ruflo/issues/2652),
both now fixed in their stated scope. #2652 also explains why the legacy `adr-reindex` used raw SQL:
`memory delete` was soft and its tombstone still collided on re-store. Current Ruflo supplies
`memory purge`; current Ruflo 3.38.12 closes #2666's writer-sharing gap through native
`withMemoryDbLock()`, which the retirement predicate proves per writer before standing down.

**Related but NOT addressed by `adr-template`:**
[#2474](https://github.com/ruvnet/ruflo/issues/2474) (closed) fixed a different `adr-index`
parsing gap (`**Status**:` vs `**Status:**` placement, em-dash titles, worktree
double-counting). Its residual note on Nygard-style `## Status` sections and non-English
status words is still open but distinct from the bullet-prefix bug this target fixes.
[#2651](https://github.com/ruvnet/ruflo/issues/2651) was a separate `adr-create` step-4
`agentdb_hierarchical-store` parameter/key-charset defect; it is fixed in 3.32.37 and never needed
an `adr-template` patch.

## Limits

- Covers the **npx cache** and **global installs**. Global discovery combines the running Node prefix,
  npm-on-PATH prefixes, and authenticated `ruflo` / `claude-flow` / `claude-flow-mcp` launchers, including
  custom prefixes with no npm binary and nested public-wrapper dependencies. If a nonstandard layout is
  still outside those proofs, point `RUFLO_GLOBAL_ROOT` at it explicitly.
- The scheduled job runs a **version-stable** `node` where one exists: under a version manager it is
  registered against the shim (`mise/shims/node`, `.volta/bin/node`), which survives a node upgrade
  (ADR-021). Only a manager without a standalone shim (nvm) still records a per-version path, and there
  the liveness check reports the interpreter as gone and the prompt hook re-registers with the current
  node on the next prompt.
- A copy fetched mid-session runs unpatched until the next monitor tick (≤ 5 min).
- **The one failure mode with no automated guard.** Anchors are exact literal strings, never line
  numbers, so nothing drifts by offset. An anchor that stops matching is `skip:anchor-not-found`; one that
  matches *twice* is `skip:ambiguous-anchor`; a partial apply is `INCOMPLETE`. But an anchor can still
  match, still match **uniquely**, still produce a file that parses, and no longer **mean** the same
  thing. Upstream can move the line we anchor on into a different function, add an early return above it,
  or restructure the call so our injected code sits in a path that never runs. **No textual check can see
  that.** It is announced rather than swallowed: a re-baseline prints the `diff` command, says what
  re-applying does *not* prove, and tells you what to look for. Re-evaluating it is a human's (or an
  agent's) job.
- `adr-template` is scoped to the `ruflo` marketplace only. A fork installed under a
  different marketplace name is out of scope by design, not a gap. It is also not covered by the
  `npm test` property fuzzer, which only exercises `{cwd, daemon, memory}`.
- `adr-template` fixes the bullet-prefix parsing gap only ([#2659](https://github.com/ruvnet/ruflo/issues/2659));
  the separate `adr-create` step-4 defect ([#2651](https://github.com/ruvnet/ruflo/issues/2651))
  was fixed upstream in 3.32.37.

These are **workarounds**, not substitutes for the upstream fixes. Remove a target with its own
`uninstall`; when the last one goes, the `SessionStart` hook is removed. Then delete
`~/.ruflo-source-patch/` to clean up completely.

## License

MIT © sparkling
