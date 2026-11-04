# Hook and database repair register

Updated: 2026-11-04. Owner: ruflo-source-patch. Project sessions retain their
own work and report failures in their own Herdr sessions. No console injections,
worker resumes, database resets or uncertain-write replays are authorized by this register.

4 November update: the failures have multiple demonstrated mechanisms. The
larger envelope exposed a native nonblocking-stdin `EAGAIN`/`EPIPE` defect; the
shared correction reuses native asynchronous bounded input. Recall enumerated
all `turns` rows for presence; the correction requests one while preserving
complete checkpoint namespaces. Both have executable regressions. The source
facade repeated full namespace exports and serialized callers. Native metadata now
accelerates unchanged namespaces; incomplete results cannot hide recovery for five
minutes. Release 4.46.124 removes duplicate inventory authorization; 4.46.126 pages
native row identities before payloads. After the AI owner refresh, concurrent
R5/R7/R1 passed in 34/59/89 seconds, with complete coverage and no gaps; the hourly
cold source read took 81 seconds. Serial request delay and cold export cost remain.
Release 4.46.127 shortens current-composition proof without skipping preflights or
changing locks; it does not eliminate concurrent SessionStart timeout risk.

Strategy's 08:51:07Z checkpoint store timed out. The original exact key is absent;
the complete expected value is not reconstructible, so no replay occurred.
Shared checkpoint diagnostics now retain stage, launch and sanitized terminal
details in the existing private ring. Release 4.46.123 is active on both hosts;
new native checkpoint/readback checks passed in 1.00/2.08 seconds. This does not
recover the original missing record. ST01/ST03's 14 imported values are verified;
their coordinator repaired the local launch checks and launched each author once.
ST01 completed at 10:04:38Z; ST03's retained running receipt is not a liveness check.
The helper's independent false-success persistence bugs are reported in
[Ruflo #4685](https://github.com/ruvnet/ruflo/issues/4685). Its tested upstream
candidate is not installed because the helper requires an upstream signature.

## Shared failures and current evidence

For the original lifecycle failures, a measured factor was native policy history. Each
authorization authenticates the full anchor history, then publication traverses
and serializes it again under the same project lock. Originating CLI calls and
the native owner each preserve their authorization boundary. Our omitted
non-memory authorization queue compounded this contention.

This directly explains observed lock waits and delayed writes/readbacks. Longer
capture occupancy can also exhaust the native two-slot limit. The forwarding
client deliberately retains sessions for uncertain operations until native expiry;
repeated deadline failures can therefore add session pressure. These latter links
are source-supported mechanisms, not a reconstruction of every historical warning.
The admission-directory race is a separately reproduced downstream defect. WAL
refusals and stale bindings remain distinct safety/activation issues, not evidence
of corruption caused by policy latency.

| Issue | Affected evidence | Current finding and next proof |
|---|---|---|
| Policy-state lock timeouts | AI-BA, BA; Fabric attribution pending | Live locks belong to active native MCP owners, migration-runtime MCP clients and CLI hooks. Our owner queue covered memory but omitted hook authorization; corrected in 4.46.112. Private bounded phase logging added. Activated on 10 Mac and 15 HZ owners; fresh Stop/checkpoint verification passes in all five reported HZ projects. History-dependent transaction cost remains. |
| Turn/checkpoint store timeout and readback failure | AI-BA, BA, Query, Fabric report | A timeout can precede successful persistence. Read original keys; do not replay. Preserve retrieval error/timing instead of treating null as content mismatch. |
| Prompt recall deadline | AI-BA, Product/PLM | Native 1.9s budget expires during enumeration or later exact/search phases. Reader startup was tens of milliseconds. Temporary larger finite budgets requested; provider/policy phase timings still needed. |
| Learning shedding | Query, BA; Fabric attribution pending | Deployed 4.46.119/120 retains two writers while at most eight existing hooks wait within their bounded budget; durable duplicates use native read-first verification. Burst tests pass, but sustained overload still refuses. Historical admission analysis below predates that correction. |
| Admission-lock ENOENT | Query | Reproduced downstream ownership race: normal owner retirement removes the directory before our claims scan, outside its ENOENT retry. Narrow correction and historical migration tests pass; deployed and activated in 4.46.114 on both hosts. |
| MCP session exhaustion/retirement | Query historical reports | Earlier 105-client retirement qualification exists. Correlate failure timestamps to loaded release; do not conflate session capacity with model quotas or claim later reads recover original failed writes. |
| WAL/whole-image refusal | AI-BA and Query historical reports | Safety refusal is not corruption. AI-BA original MCP exact retrieval succeeded on 3 November; broader original-operation recovery remains separately qualified. |
| AutoMemory package resolution/readback | AI-BA ST01/ST03 worktrees | Resolved through native createDatabase(provider:json).getByKey: ST01 and ST03 each have 7/7 exact matches to current retained Markdown. No replay or writes; this is the actual helper backend, not a substitute SQLite store. |
| Older RVF SDK/native dependencies | Registered Mac/HZ projects and runtimes | AgentDB 3.3.0 requests SDK `^0.2.3`; other consumers require different ranges. Synthetic tests on both hosts prove new readers open old data, but old readers reject new-version writes with `InvalidChecksum`. Production upgrade requires coordinated reader replacement before new writers; no production dependency or memory changes made. |

## Original-record evidence

- Fable SessionEnd failure at 14:54:22.962Z: original key
  `project-state-auto-1793717654932-81503d2a` recovered from the retained key hash.
  AI-BA's existing MCP returned it at 15:39Z, with session
  `2e10c18d-c43d-4d3b-9fed-076fb8b1e0c5`, event `SessionEnd`, timestamp
  `14:54:14.932Z`, branch `research/adr091-next-steps-20261103`, head `8374aaff`.
  Worktree reflog independently supports that branch/head. Creation timestamp
  `1793717662987` is 25ms after the reported timeout. No original write replay.
  Root receipt: `/data/programme-state/ruflo-upgrade-20261103/ai-ba-analysis/fable-original-mcp-readback.json`.
  The project subsequently recorded a separate recovered retirement checkpoint;
  that does not turn all lifecycle invocations into verified successes.
- Query PreCompact at 15:30:22.060Z: key
  `project-state-auto-1793719814093-452bb45e` currently found through native MCP.
  Project reports SHA256 `db3f56b0d4803e226df77882e98f41f526e5ac4d677134394cf7a5ac24e80b16`.
  `cacheHit:true` qualifies the read: it is not independent uncached disk proof.

## Retained project receipts

- Fabric: `/data/programme-state/fabric/local/state/fleet-repair/console-handoff-20261030/owner-hook-routing-20261103.json`.
  Latest reported observation: 15:38:35Z. Shared-log rows need exact project/session attribution.
- Product/PLM: `/data/programme-state/plm/repairs/bff-physical-model-build-repair-20261103-v1/hook-prompt-recall-recovery-20261103-r1.json`
  and `hook-prompt-recall-recovery-20261103-r2.json`; both enumeration timeouts.
  Separate traces `own-recall-33d59c1ec117a54f451f95d7.json` and
  `own-recall-139731a1c165f0527fc0d9b7.json` show enumeration consuming 1295/1603ms,
  followed by exact/search deadline exhaustion. They are not traces of those two retries.
- Query: `/data/programme-state/query/local/state/fleet-repair/console-followthrough-20261030/hook-memory-debug-20261103T1547Z.json`.
  Reported 123 rows/139 attempts include repeats, not 139 distinct lost records.
- Central lock observation:
  `/data/programme-state/ruflo-upgrade-20261103/ai-ba-analysis/policy-lock-observation.jsonl`.
  Bounded 90-second, 100ms sampler; observed hold durations are approximate, not request wait times.

## Temporary mitigation and removal condition

Owner requested longer finite timeouts while the underlying latency is repaired.
Installed release 4.46.113: recall 10s, capture/checkpoint 30s, native policy-lock
acquisition 15s; matching outer hook budgets. SessionEnd host caps, native consent,
authorization, cancellation and exact readback remain intact. No historical replay.

This reduces deadline failures; it does not fix admission shedding, missing
executables, wrong stores, stale clients or actual content mismatches. Remove the
temporary profile after actual lifecycle calls qualify under upstream defaults.
Successful ordinary MCP writes alone are insufficient qualification.

### Deployment verification

Release 4.46.113 is committed and pushed (`68e168c`), installed on Mac and HZ.
The full regression suite and both installation monitors pass. Native hook trust
reports all 13 enabled Brain hooks trusted on each host; unrelated settings were
unchanged. After the owner instructed “fix it all”, 10 Mac and 15 HZ memory services were
refreshed through native graceful shutdown. All health checks passed; app servers,
user terminals and delivery workers were untouched. Native list reads passed for
19/19 Mac and 31/31 HZ configured stores.

Fresh native checks after installation:

- Mac recall: `ok-with-results`, 709 ms.
- HZ Product recall: `ok-with-results`, 2069 ms; diagnostic prompt, not a replay
  of the original failed invocation.
- HZ Strategy recall: `timed-out`, 9679 ms, one retained result. Larger budgets
  alone have not resolved this loaded path.
- HZ Strategy native checkpoint helper: `stored:true`, `verified:true`, 3459 ms,
  new key `project-state-auto-1793722133112-e341f1e5`. This qualifies the helper's
  fresh store/readback, not a complete registered lifecycle or historical replay.

Fresh CLI processes emit the new policy diagnostics. An observed Strategy
transaction waited 2043 ms, then spent 566 ms verifying anchors and 693 ms
publishing state; its policy operation itself took 1 ms. This isolates a material
policy-history cost and contention, without claiming it explains every recall
phase. Snapshot: HZ release receipt `policy-phase-snapshot.json` (38 transactions).
All release receipts live under `.local/ruflo-upgrade-20261103/release-v4.46.113`
on Mac and `/data/programme-state/ruflo-upgrade-20261103/release-v4.46.113` on HZ.

## RVF dependency investigation

Astra High inspected 46 Mac and 71 HZ dependency-resolution rows. Latest tested
SDK/native versions are 0.4.1/0.3.1. These are different package version sequences;
native 0.2.3 and SDK 0.2.3 must not be conflated. Upstream confirms the incompatible
format transition in [RuVector #1276](https://github.com/ruvnet/RuVector/issues/1276#issuecomment-6478722717).
Production reader replacement has not been performed. The memory-service refresh
above does not itself replace every loaded RVF consumer. Installing new writers
alongside old readers would be unsafe.

Receipts: `.local/rvf-upgrade-20261103/audit-summary.json`,
`mac-compat-smoke.json`, `hz-compat-smoke.json`; HZ copies under
`/data/programme-state/rvf-upgrade-20261103`. Tests used disposable synthetic files,
not managed memory. The broader production upgrade remains unfinished.

The owner subsequently authorized controlled pauses of affected projects.
[ADR-037](../adr/ADR-037-coordinated-rvf-upgrade.md) is the accepted execution
plan: native preservation and restore proof, coordinated reader replacement,
new-writer qualification, then restoration of only previously active work.
The audit's earlier non-interruption restriction is historical; its compatibility
findings remain valid. No production RVF cutover or pause has been performed.

### Verification after service activation

Strategy recall now returned `ok-with-results` in 6851 ms. Fresh actual native Stop
recording and checkpoint helper calls each verified exact readback for Strategy,
BA, Product, Query and Fabric. Strategy still needed 13.3s for Stop and 11.6s for
checkpoint; other tested projects needed 2 to 4.4s per operation. This is recovery
under the temporary profile, not proof of upstream-default latency.

Strategy and Query original root MCP connections retrieved their respective
original Fable/Query checkpoints, `found:true`, through native bridge reads at
16:34 UTC. No write replay or host connection reset. Receipts:
`original-connections-activated.json`, `lifecycle-activated.json`,
`strategy-recall-activated.json`, `activation-hz.json` and `activation-local.json`
under the release directory above.

AutoMemory readback uses installed `@claude-flow/memory@3.2.2` factory API with
Node filesystem writes denied. Both worktrees contain seven exact content matches
and no duplicate keys. ST01 import timestamps are 12:52:36 UTC; ST03 is already
imported at 15:46:05 UTC. Expected inputs are current retained Markdown, not an
import-time snapshot. No `shutdown()` was called because this backend persists on
shutdown. Private receipt: `.local/auto-memory-readback-20261103/native-readback.json`;
HZ counterpart `/data/programme-state/auto-memory-readback-20261103/native-readback.json`.

### Policy latency repair activated (4.46.114)

Commit `a7735d0`, tag `v4.46.114`, is pushed and installed on both hosts. All
10 Mac and 15 HZ native owners were gracefully refreshed; health checks and both
patch monitors passed. Hook approval review found no pending approvals.

The new policy-anchor-copy target preserves full initial history authentication,
then authenticates exact source bytes while copying them into native atomic
publication. It avoids a second full parse/serialization, rejects source mutation,
and preserves native crash recovery. Actual installed-source tamper, SIGKILL,
recovery and full-audit tests passed. Code regression suites passed; the aggregate
test command initially failed Markdown lint, which was corrected and passed.

Fresh native Stop recording and checkpoint helper exact readbacks passed for all
five affected HZ projects. Stop/checkpoint elapsed times in milliseconds:

| Project | Stop | Checkpoint |
|---|---:|---:|
| Strategy | 2904 | 3438 |
| BA | 3051 | 2332 |
| Product | 1448 | 1589 |
| Query | 2447 | 1666 |
| Fabric | 1716 | 1541 |

Strategy recall returned `ok-with-results` in 4082 ms. These fresh sequential
checks use the temporary finite budgets; they are not a controlled production
benchmark, a full PreCompact replay, or recovery of every historical failure.
Receipts: release-v4.46.114 `lifecycle.json`, `lifecycle-recall.json`,
`activation.json` on HZ; `activation-local.json` on Mac, under the existing
release receipt roots.

New native `shed observation (load)` rows remain at 16:50:18 through 16:50:19 UTC.
The admission-directory race is repaired, but native two-slot backpressure remains
an open capacity problem. These events are not proof of a failed policy repair
or database corruption. Historical shared summaries also do not establish a
current failure in the project that happens to display them.

Final bounded verification: 19/19 Mac and 31/31 HZ configured stores passed native
list reads. The retained post-activation policy snapshot contains 118 transactions
and no failed phase. The shared HZ failure log has four new shedding rows and no
other failure type in the inspected window starting 16:49:50 UTC.

All four shed keys subsequently gained native acknowledgement markers between
16:50:32 and 16:51:49 UTC. Native `markCaptured` follows successful exact store and
readback. This supports later native recovery, but retained markers omit original
store/content, so independent current exact-value proof was not attempted. No
occupied slots were observed in the subsequent 15-second passive sample.
Receipt: `.local/ruflo-upgrade-20261103/recall-diagnostics/capture-capacity-four-acks-20261103.json`.
Native two-slot drop-and-count semantics remain; there is no supported concurrency
setting. This is a known best-effort capacity limit, not evidence of stuck slots.

Upstream policy finding updated at
<https://github.com/ruvnet/ruflo/issues/3164#issuecomment-6610173872>.

## Session-cap recurrence investigation

At 17:02 UTC all 15 configured HZ owners reported 1 to 4 active sessions and zero
failed requests since their 16:49 activation. The cap is per service. Strategy,
BA and Oxigraph had the greatest request counts, not excessive current sessions.
The newest shared cap failure was BA at 15:49:05 UTC. Builder had read that foreign
row from the shared machine log; it was not proof of Builder session exhaustion.

The lifecycle gap is reproduced: initialized short-lived clients killed or timed
out before retirement can accumulate for native 30-minute expiry. Successful calls
retire, but earlier tests covered only that path. Release 4.46.115 adds negotiated
one-call identity and server-side completion retirement. A handshake-only lease
expires at 30 seconds; executing operations and persistent clients are preserved.
The client still reports uncertain writes as errors and never replays them.

The apparently new Builder binding refusal at 17:00:50/17:01:01 belongs to
`/home/claude/.local/share/opda-working-group-inbox/repo`, absent from the owner
registry. Its existing two stores were explicitly enrolled through the established
provisioner, with prior configuration preserved; both native list reads passed.
Builder's three timeout-status failures are historical, with later exact captures
verified. Strategy's 17:06 refusal came from a repair child's historical-record
resubmission, not a fresh delivery turn. Its full refusal body was truncated and
is not reconstructed as a proven duplicate error. No central replay was performed.

Receipts: `.local/mcp-session-cap-20261103/` and HZ
`/data/programme-state/mcp-session-cap-20261103/`; including live metrics,
transcript attribution, `builder-opda-strategy-attribution.json` and the OPDA
configuration preservation, enrollment and native readback receipts.

### Session cleanup activation complete

Release 4.46.116 is committed, tagged, pushed and active on 10 Mac/16 HZ owners.
The full 4.46.115 regression suite passed; the 4.46.116 migration correction passed
its timeout, actual installed composition and cross-engine regression tests.
Both installation monitors pass; both hook-trust reviews report no pending hooks.
The Mac installer initially preserved four unrecognized old recall compositions;
4.46.116 added exact historical provenance and completed installation with zero
skips or incomplete surfaces. No unverified overwrite was used.

Graceful service replacement cleared the old native session tables without
restarting user terminals or app servers. Post-activation metrics show 1 to 2 HZ
sessions per owner and zero failed requests at the observation. Native store
reads passed for 19 Mac and 33 HZ bindings. Fresh actual Stop/checkpoint readback
passed for Builder (2248/1365 ms), Strategy (2869/2056 ms) and OPDA inbox
(1350/844 ms). Builder recall returned results in 1759 ms. These are fresh
diagnostic keys, not replays or proof of every historical failure.

Final receipts: HZ `metrics-after.json`, `lifecycle-116.json`,
`store-health-116.json`, `activation-116.json`, `monitor-116.log` under the existing
session-cap directory; Mac counterparts under `release-v4.46.116/`.

## Focused Astra High investigations

### Strategy turn readback and owner diagnostics

At 18:22 UTC, the original turn ending `b624fbb195e7f28a8dd5f7312f0b7eb87fbc2798`
was retrieved through the native owner from the producer's explicit `memory.db`.
Its complete content matched the original reconstruction (SHA256
`227d9c486088da50d8ee1baed4480c31d9b8fc2b5b51d59f50d3ebe1a086774e`). The
default MCP binding and explicit AgentDB sibling both returned `found:false`.
This resolves that record's apparent absence, not every historical capture failure.
Private evidence is in HZ's existing `ai-ba-analysis/turn-refusal-exact-read-1812.json`
and the project's `foundation-review-capture-recovery-20261103.json` handoff.
There was no replay, database change, console message or session interruption.

The refusal-detail loss is downstream: our owner decoder threw pretty JSON for
native canonical failures. Brain's line-based diagnostic retained the opening
line and could not recognize an append-only duplicate. Release 4.46.117 preserves
the native failure object and extracts bounded diagnostic fields for noncanonical
refusals. Exact duplicate verification stays in the existing native hook. Regression
coverage includes malformed JSON, echoed private values, conflicting success flags,
one-dispatch behavior and exact upgrade/reversal of the prior installed runtime.
Historical generic refusals remain unattributed unless their own records prove more.

Activation: commit `6c35ab2`, immutable tag `v4.46.117`, deployed on Mac and HZ.
The full suite and pristine 3.71 source composition/reversal tests pass. Actual
native capture and deliberate duplicate readback pass on HZ (2359/2274 ms) and
Mac (836/707 ms). The Mac's initial deployment used npm's mise prefix while its
active launcher retained 4.46.116; installing into the active `.npm-global` prefix
corrected this. The failed diagnostic receipt and later exact recovery of that
same acknowledged test record are both preserved. Both installation monitors
report no drift. No service, user terminal or application worker was restarted.
Receipts are in the existing local `release-v4.46.117/` directory and HZ's matching
`/data/programme-state/ruflo-upgrade-20261103/release-v4.46.117/` directory.

### Policy history

The 3 November review confirms that the bounded receipt ledger and the anchor
history are different structures. The native receipt improvements do not bound
anchor authentication or publication. Current upstream still walks the complete
anchor chain, and the deployed copy optimization still reads that history twice
and writes it once per transaction. Do not restore a retired receipt-ledger patch
as a claimed fix for anchor growth.

Disposable Mac tests at 1,000, 10,000 and 100,000 synthetic anchors reproduced
linear cost. At 100,000 anchors, one actual native transaction read 60,977,710
anchor bytes and wrote 30,489,161 bytes. Interior tamper, valid-prefix rollback
and mutation after assessment were rejected; native full audits passed. This is
an isolated warm test, not a production latency or hook-deadline guarantee.

An additional single comparison of 32 native decisions took about 4,974 ms in
32 separate transactions versus 144 ms in one transaction; both retained all
33 receipts including the initial receipt. This demonstrates the existing native
batching capability, not an unimplemented universal speedup: the deployed owner
already batches same-project authorizations, including non-memory tools, and
sequential arrivals cannot be combined retrospectively. Any remaining opportunity must preserve caller
identity, per-decision receipts, ordering and exact outcomes.

A truly bounded history path needs an upstream authenticated history/checkpoint
contract. Moving full verification out of each call changes when historical
tampering is detected; no local cache or new trust format is approved by this
finding. Keep temporary budgets while measuring actual lifecycle latency.
No additional policy patch or timeout change was made by this investigation.
Reproducible benchmark, source hashes and implementation proposal:
`.local/ruflo-upgrade-20261103/policy-scalability/benchmark.mjs`, `result.json`
and `proposal.json`. The proposal specifies segmented history, external checkpoint
authority, migration/crash ordering and the explicit change to historical-tamper
detection timing. This remains an upstream design proposal, not a deployed fix.
Existing upstream tracking: [Ruflo #3164](https://github.com/ruvnet/ruflo/issues/3164)
and [accepted ADR-475](https://github.com/ruvnet/ruflo/blob/main/v3/docs/adr/ADR-475-policy-ledger-anchor.md).

Follow-up attribution used the published pristine 3.71.0 CLI against the same
installed dependency tree. At 100,000 anchors its median transaction was 388 ms
versus 157 ms patched; both performed the same whole-history I/O. The `already-fixed`
label on #3164 concerns receipt retention and does not prove anchor growth fixed.
Our routing nevertheless adds policy work: ordinary public CLI operations gain
one owner evaluation, while forwarded MCP calls typically evaluate at caller and
owner. A disposable enforce-mode reproduction consumed a single-use approval at
the caller, then failed at the owner because approval context was not forwarded.
This is a downstream compatibility defect, not proof of the historical timeouts.
Do not remove the caller check: authenticated identity/envelope/evidence must
reach the authority before accounting can safely happen once. The proposal and
qualified reproduction are `policy-scalability/attribution-summary.json` and
`route-attribution-result.json`; no authorization change has been deployed.

### Policy forwarding correction qualification

The 4.46.118 candidate fixes our duplicate evaluation only when native caller and
owner authority are equivalent: canonical cwd, pin, policy/trust root, default
legacy identity and default server/environment. It projects through the native
request constructor, compares independently at the owner, and then evaluates
once. Approval/evidence remain native inputs, not authorization claims. Missing
owner capability refuses before accounting/dispatch; unknown outcomes never replay.
Constrained identity/envelope and different-root/context/provenance paths retain
previous behavior and remain a limitation. Public CLI already has one owner check.

Actual native HTTP/SDK qualification passes one durable decision, single-use
approval once then denial, concurrent approval/digest isolation, forged metadata
rejection before accounting, native signed-evidence and missing-budget-meter
refusals, old-peer refusal and full audit. Final storage handlers are disposable
doubles; this is not a production database test. `test/ruflo-owner-policy.mjs`
records the boundary. Earlier results above are retained as the causal baseline.
Native O(anchor-history) work and the temporary timeouts are unchanged.

Capture timing snapshots observe native admission and exact/duplicate outcomes in
128 private overwrite slots, at most 32 events/16 KiB each. They contain no payload,
add no queue or capacity, and cannot count overwritten or killed invocations.
Policy snapshots add route and bounded queue wait. Activation and measured results
are recorded after the combined release qualifies.

Activation completed as commit `7c86823`, immutable `v4.46.118`, after independent
authorization review, full suite and native HTTP tests on Mac/HZ. Exact active
client/policy/capture hashes match across hosts; all 10 Mac/16 HZ owner PIDs changed
and passed health. Native graceful shutdown was used; HZ waited for native exit
before service start without systemd's forced-stop escalation. Both monitors
report no drift. Fresh native memory-list calls each emitted one completed
`owner-coalesced` operation (287/871 ms); loaded stdio clients still need their
normal host refresh. Private release evidence: `release-v4.46.118/release-proof.json`.

The isolated 100,000-anchor HTTP comparison used three warm samples per concurrency:
one request 311→171 ms; eight 1,403→176 ms; sixteen 2,671→176 ms. Sixteen requests
used 17 to 19 transactions before correction and 1 or 2 afterward, preserving one native receipt per corrected call and
full audit. Same test event loop/dependencies and disposable storage doubles limit
these results; they do not establish production throughput. Detailed receipts are
`policy-scalability/http-contention-{117,candidate}.json`.

Capture telemetry now runs on both hosts. HZ's owned runtime parent was tightened
0775→0700 after the logger correctly refused the unsafe directory. A subsequent
60-second window recorded 38 snapshots, 20 gates (wait max 3.330 ms, hold max
4.049 ms), three native exact-duplicate paths taking 1.406 to 2.511 seconds, and one
actual two-slot refusal. That shed key has no matching exact result in the window;
its durability remains unknown. No replay or capture-capacity change was made.
Upstream updates: [owner forwarding](https://github.com/ruvnet/ruflo/issues/4654#issuecomment-6613980564)
and [residual anchor scaling](https://github.com/ruvnet/ruflo/issues/3164#issuecomment-6613997483).

### Capture capacity

The separate Astra High review recommends retaining the native two-slot limit.
This is intentional best-effort admission across a shared Brain home, with no
retained queue for excess observations. Keys identify coarse deterministic
session/tool/action facts. A shed attempt does not establish a unique missing
record, and an admitted or pending-coalesced return is not persistence proof.

An actual installed-source synthetic burst admitted 2 of 32 distinct requests
and shed 30. Completing the two inert children freed both slots and launched no
additional work. Spawn and persistence were inert test seams, so this proves
admission semantics rather than production throughput. Ownership and real-process
race regressions passed. No new admission defect or capture patch was found.

Brain [PR #443](https://github.com/stuinfla/ruvnet-brain/pull/443) removed the old
queue/outbox/worker after excessive growth. The historical outbox patch is not
a reusable live ingress. Keep [Brain #521](https://github.com/stuinfla/ruvnet-brain/issues/521)
as the existing upstream issue. Reduce writer occupancy and measure distinct
shed keys before considering more concurrency. Distinguish already durable,
later acknowledged, confirmed absent and unknown through original target/value
evidence; do not replay uncertain operations.

If lossless delivery becomes required, the proposed solution is upstream bounded
durable ingress owned by the native memory service, with explicit durable
acceptance, exact verification, duplicate and capacity-refusal outcomes. It is
not available in the inspected capture path and is not installed here. A finite
queue cannot guarantee acceptance under unlimited arrivals. Evidence, source
hash, consultation and recommendation:
`.local/ruflo-upgrade-20261103/recall-diagnostics/capture-capacity-astra-review.json`.

The upstream history distinguishes queue removal in 4.7.0 / PR #443 from the
later two-slot shedding in 4.7.17 / [PR #485](https://github.com/stuinfla/ruvnet-brain/pull/485).
The latter addressed hundreds of unbounded children; native tests deliberately
expect two admissions and two refusals. Our ownership patch adds up to 100 ms
admission waiting, stricter uncertain-owner refusal and serialized pruning. Its
earlier admission-directory ENOENT race was downstream and fixed in 4.46.114.
These costs must not be described as zero, although individual historical shed
events are not thereby attributed. Exact source composition/reversal and upstream
history are retained in `recall-diagnostics/capture-history-astra-review.json`,
`capture-history-upstream-evidence.json` and `capture-history-composition-proof.json`.


### BA lifecycle timeout correction, 3 November

The original BA SessionEnd record was committed at 15:50:04.280Z before readback
failed at 15:50:07.236Z and the caller timed out at 15:50:09.029Z. Its complete
value was already verified; this repair never replays that operation. Historical
phase occupancy and the original caller's inherited budget remain unavailable.
Current native Claude SessionEnd defaults leave 1.2 seconds for capture. A read-only
comparison on that exact BA record took a median 1,688 ms for two fresh CLI reads
versus 1,190 ms in one native module process. Bootstrap reduction alone is insufficient.

The shared `brain-capture-idempotency` target now reuses one bounded stdin process
for canonical native store/read calls and preserves read terminal errors/timings.
A fresh first attempt with less than 2.6 seconds remaining may enter one of two
independent turn-worker leases with a 30-second absolute deadline. Pending metadata
precedes every store; it is never a success receipt. The worker repeats native
consent, root, privacy and encryption checks. Retained receipt or same-turn state
makes a subsequent boundary read-only. Both evidence stores remain bounded;
concurrent first attempts retain native append-only collision semantics.

The prior release reproduced a committed-but-unverified SessionEnd under 350 ms
of deliberate native HTTP response pressure (1,205 ms parent duration). The new
exact source passed actual Stop/PreCompact/SessionEnd hook entries on disposable
native stores on both hosts; SessionEnd returned in 63/64 ms, with later exact turn
readback. Two concurrent distinct turns succeeded. Killing the pair child or the
parent after commit then reconciling produced precisely store/read/read, never a
second store. All owned fixture children quiesced. This proves turn capture, not
checkpoint/distillation success or unlimited-load delivery. Receipts:
`ba-lifecycle/native-lifecycle-final-{mac,hz}.json` and
`ba-lifecycle/native-lifecycle-control-pressure-mac.json` under the existing private
upgrade directory. Final release activation is recorded separately below.

Activation completed as immutable `v4.46.120`, commit `4f22132`, on both hosts.
All 307 installed package files match the artifact and all three active capture
source hashes match qualification. Both monitors report no drift; all 10 Mac/16 HZ
native owners remain healthy without restart. Installed hook-entry tests returned
SessionEnd in 73/103 ms under controlled response pressure and later proved exact
turn content. The original BA record still matches its 2,021-byte value hash through
one native read (813 ms), without replay. Full tests and independent reviews passed.
Final private proof: `release-v4.46.120/release-proof.json`.
[Brain #513 follow-up](https://github.com/stuinfla/ruvnet-brain/issues/513#issuecomment-6615446798).
