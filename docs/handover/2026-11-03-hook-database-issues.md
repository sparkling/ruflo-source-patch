# Hook and database repair register

Updated: 2026-11-03. Owner: ruflo-source-patch. Project sessions retain their
own work and report failures in their own Herdr sessions. No console injections,
worker resumes, database resets or uncertain-write replays are authorized by this register.

## Shared failures and current evidence

| Issue | Affected evidence | Current finding and next proof |
|---|---|---|
| Policy-state lock timeouts | AI-BA, BA; Fabric attribution pending | Live locks belong to active native MCP owners, migration-runtime MCP clients and CLI hooks. Our owner queue covered memory but omitted hook authorization; corrected in 4.46.112. Private bounded phase logging added. Activation and mixed live-hook qualification still required. |
| Turn/checkpoint store timeout and readback failure | AI-BA, BA, Query, Fabric report | A timeout can precede successful persistence. Read original keys; do not replay. Preserve retrieval error/timing instead of treating null as content mismatch. |
| Prompt recall deadline | AI-BA, Product/PLM | Native 1.9s budget expires during enumeration or later exact/search phases. Reader startup was tens of milliseconds. Temporary larger finite budgets requested; provider/policy phase timings still needed. |
| Learning shedding | Query, BA; Fabric attribution pending | Native two-slot admission can drop observations. More time does not create capacity and can prolong occupied slots. Separate admission diagnosis and original-record reconciliation required. |
| Admission-lock ENOENT | Query | Missing directory during admission scan; retain original error. Not a database corruption verdict. Reproduce native race separately. |
| MCP session exhaustion/retirement | Query historical reports | Earlier 105-client retirement qualification exists. Correlate failure timestamps to loaded release; do not conflate session capacity with model quotas or claim later reads recover original failed writes. |
| WAL/whole-image refusal | AI-BA and Query historical reports | Safety refusal is not corruption. AI-BA original MCP exact retrieval succeeded on 3 November; broader original-operation recovery remains separately qualified. |
| AutoMemory package resolution/readback | AI-BA ST01/ST03 worktrees | Resolver repaired through native package-path record. ST01 import reports seven entries. Helper's JSON backend is separate from Ruflo MCP SQLite memory; no verified public exact-value export yet. Do not substitute a different store as proof. |
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
unchanged. Existing long-running memory owners have not been restarted, so their
in-memory queue/diagnostic code must not be described as upgraded. A controlled
handoff awaits the owner's decision under the no-interruption instruction.

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
The no-interruption instruction prevents replacing the currently loaded old readers
during this repair. Installing new writers alongside them would be unsafe.

Receipts: `.local/rvf-upgrade-20261103/audit-summary.json`,
`mac-compat-smoke.json`, `hz-compat-smoke.json`; HZ copies under
`/data/programme-state/rvf-upgrade-20261103`. Tests used disposable synthetic files,
not managed memory. The broader production upgrade remains unfinished.
