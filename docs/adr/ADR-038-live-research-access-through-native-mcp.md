# ADR-038: Live research access through native MCP methods

**Status**: Accepted; native access deployed, source-authority and coverage corrections pending
**Date**: 2026-11-04
**Updated**: 2026-11-04. Owner authorized native MCP implementation and required
appropriate original-document methods in addition to memory search/retrieval.
Native access is active. The subsequent source-class audit found a BA authority
freshness gap and omitted research inputs; the complete sharing decision is not
yet implemented.
**Deciders**: Henrik Pettersen
**Tags**: ruflo, mcp, research, source-authority, native-configuration

## Context

AI Strategy Business Architecture needs research from BA, SA, EA research,
Product and its own research. Other established consumers use the same sources.
The owner requires live access without RVF export/import synchronization or a
replicated common store, and prefers supported Ruflo configuration to building
another retrieval system.

Our current source interfaces combine native reads with document loading,
namespace enumeration/export, additional candidate retrieval, body admission and
ranking. A retained Product request took 124.887 seconds: 29.525 seconds in the
document phase, 94.261 seconds in ordinary memory and approximately one second
in learning/final fusion. One native call took 55.026 seconds. These measurements
do not attribute all latency to the wrapper.

Bounded native MCP searches and exact reads returned useful research without
inventory/export orchestration. BA/SA wrapper checks also withheld useful native
records. These findings support simplifying the access path; they do not prove
complete original-document coverage or equivalent retrieval quality. Some stored
records are summaries, chunks, historical proposals or imported foreign evidence.

The initial RVF portability recommendation is superseded by the owner's live-only
direction. Its experiments remain evidence, not an implementation requirement.

## Decision

Use named, source-bound native Ruflo MCP connections to the existing authoritative
research owners. Let the research agent choose relevant sources and native
operations, retrieve selected evidence and synthesize a source-attributed answer.
Prefer existing registrations, owner connections and configuration. Do not write
mirrors of methods that Ruflo already exposes.

### Source authority and access

- Record each logical source's actual host, canonical project, ordinary research
  store and any distinct native controller/graph authority. Do not infer identity
  from a similar project name, filename or tool alias.
- Preserve EA's research-only boundary; its operational database is excluded.
- Reuse existing managed owners. An MCP connection must not open a competing
  database driver merely to provide read tools.
- Preserve authentication, native authorization, source restrictions and sensitive
  record safeguards. Advertised tool selection is not authorization enforcement.
- Preserve existing managed data, originals and provenance. No database migration,
  export/import cycle, replicated common store or new synchronization service.

### Methods and evidence

| Need | Approach |
|---|---|
| Find stored research | Native search with relevant source/namespace selection and documented arguments. |
| Read a known stored record | Native exact retrieval, preserving value, identity and metadata. |
| Discover/read original documents or artefacts | Reuse existing source/document search and exact document/resource readers. Verify their actual coverage and references. |
| Inspect relationships | Expose relevant existing native graph read methods where configured and authorized. |
| Consult learned patterns or other learning state | Use the appropriate existing native controller reads; preserve their distinct semantics. |

Discover the installed methods and schemas before registration; this table defines
responsibilities, not invented API names. A verified exposure gap may justify a
thin method binding to an existing supported operation, not a replacement index,
ranker or framework. Report a genuine unavailable capability instead of inventing
a successful substitute.

Exact memory retrieval returns the stored record. If it contains only a summary or
reference, follow the existing original-document reader when the task requires
the original. Label summaries, imported evidence, withdrawn decisions and missing
originals truthfully. A current read does not make a historical record current.

### Agent behaviour and failure semantics

Search the sources required by the question, using bounded independent calls and
the existing connection lifecycle. Combine evidence by its meaning and provenance;
do not compare raw similarity scores from different sources as a global ranking.
No common ranking engine is required for this agent workflow.

Preserve the distinction between no matches, a valid summary, limited coverage,
native degradation and an operational error. Do not silently return an empty
success after failure. Existing owner halt instructions remain authoritative;
this ADR does not grant permission to ignore failed operations or replay uncertain
writes. Session recovery is a separate shared runtime repair.

### Retire redundant default search behaviour

Remove mandatory exhaustive enumeration/export, custom cross-source ranking and
full-corpus complement loading from the default native research path. Retain
genuine source binding, authorization, provenance, failure reporting and original
document access. Do not remove an existing method until its required consumers
and evidence access have a verified replacement.

Native indexing/query implementation stays with Ruflo/RuVector. Verify the actual
source corpus and supported configuration; an MCP transport cannot repair missing
data, wrong source bindings or incompatible index/query settings. Diagnose a
specific native defect centrally instead of adding a project-specific workaround.

## Implementation and verification

1. Record the five logical source bindings and existing supported methods. Resolve
   the local AI-BA alias versus canonical HZ source explicitly.
2. Configure native access and the needed original-document methods, preserving
   policy and source restrictions. Keep ordinary and controller store roles clear.
3. Use a small set of real research questions and known records to verify source
   identity, relevant results, exact values, original-document access and truthful
   errors. No new benchmark framework or exhaustive corpus audit is required.
4. Activate through supported host controls; verify actual consumer connections.
   Reconcile affected source-project ADRs and instructions, then retire redundant
   default orchestration. Preserve unrelated work and rollback configuration.

The existing native probes are narrower than the comprehensive facade searches;
their timings are not an equivalent-coverage performance claim. Deployment is
complete only when the intended consumer uses the configured route successfully.

### Observed interface and coverage boundary

The implemented interface advertises 15 tools with descriptions and argument
schemas: eleven source-bound native memory/controller reads, two original-document
methods and two retained compatibility methods. It registers tools, not MCP
resources or prompts. Method discovery documents invocation; it is not a corpus
coverage guarantee.

The 2026-11-04 retained-consumer check passed all fifteen exact reads across five
sources and three HZ parent sessions. Original-document checks also verified full
selected bodies and hashes. These checks establish the exercised identities and
operations, not exhaustive search recall or access to every repository file.

The live document reader covers selected tracked Markdown/JSON, including AI-BA
authoring inputs. Runtime files, secrets and generated outputs are deliberately
excluded. Private originals and other file formats require their existing
source-owned reader; do not assume that a memory summary replaces them. In
particular, AI-BA's existing private management-book projection retains 144 page
originals from a recorded source cut, with page 1 unavailable. The new document
methods now reuse that projection alongside live tracked originals. An actual
configured Mac MCP consumer read all 144 exposed pages (391,597 UTF-8 bytes),
matching every page hash. Preserve the original hash, cut and extraction gap;
this is not verification of the PDF's images, layout or missing page.

Product's existing retained projection also contains attributed memory and
learning records alongside original files. The document methods must identify
those record kinds and historical cuts; returning their exact text does not turn
them into underlying originals. Tool descriptions must explain that distinction.

The implementation must report source scope, exclusions and historical cuts
honestly. Neither advertising a controller nor succeeding on one known key proves
that all controller data or all original research is accessible.

Fresh Mac-to-HZ source checks passed after owner Tailscale authorization. Actual
retained HZ AI-BA and Product connections also passed their first exact read after
a graceful source-service restart, without caller retry or host reload and with
their client process identities unchanged. The source-bound configuration and
retained-client evidence live in
`.local/federated-research-20261104/native-live-activation/`.

A normal source refresh and unchanged-configuration host reload initially left
old tool descriptions cached. A controlled native disable/drain/restore cycle of
the five user-level source registrations resolved this on HZ: all fifteen
source/session combinations now advertise corrected descriptions, with the parsed
configuration exactly restored and database owners unchanged. This verifies the
three retained HZ consumers; it does not certify every dormant session.

### Source-class audit and remaining work

Endpoint registration was not a complete data-source map. The follow-up audit
compared committed path/blob inventories, current source configuration, retained
manifest metadata and bounded native reads. No managed database was opened
directly, and no source binding or corpus was changed by that audit.

| Source | Established gap or qualification |
| --- | --- |
| BA | The configured Mac source lacks 13 added and 27 changed HZ research/configuration files, including current ADR-042 work. Authoring inputs and reviewed artefact graph assertions also sit outside the default live document roots. Most other omitted configuration JSON is evaluation material, not automatically missing research. |
| SA | Committed research documents match across hosts. The document reader omits 79 tracked text files, including acquired source extracts, and configured authoring/research selections. Native copies may exist but full original equivalence is not established. |
| EA | Committed research documents match across hosts. The Markdown/JSON reader omits 6,361 text files and five research CSVs, among other formats. Many text files are retained upstream source blobs. EA operational memory remains intentionally excluded. |
| Product | The current research catalogue and benefits coverage map are outside the live reader. Historical imported file/memory/learning records remain dated snapshots, not canonical live access to the originating projects. |
| AI-BA | 483 tracked Markdown authoring inputs, nine JSONL ledgers and 30 opportunity-spec files fall outside live admission. Some HTML has equivalent Markdown; a format exclusion alone does not prove unique-content loss. |

Eleven native read methods also do not census all controller populations. Native
episode listing exists but is not exposed by this source interface; top-K pattern,
episode and graph reads cannot establish completeness. Ordinary records, retained
SQL graphs and native controller representations must be mapped separately.
Published artefact catalogues, provider originals and private research holdings
need explicit access/custody mappings; they are not covered merely because a
document mentions their URLs.

Complete this decision by correcting authority after verifying the active source
owner, reusing existing readers for eligible omitted source classes, exposing
needed existing native inventory methods, and mapping artefact metadata to its
originals. Preserve intentional exclusions and qualify unavailable extraction.
Do not add a common store, synchronization pipeline or replacement search engine.

Private audit evidence: `coverage-audit-hz-summary.json` (24 source-class rows),
`coverage-audit-mac-paths.json`, `coverage-audit-authority.json`, and
`source-schema-refresh-hz.json` under the existing activation evidence directory.

## Consequences

The native engine owns retrieval and storage semantics; the agent owns evidence
synthesis. Source data stays at its authority and needs no sharing synchronization.
The agent must select sources and assess evidence; relevant original files still
need an accessible reader. Native engine defects remain possible and are handled
through the shared issue-backed patch process, not hidden by the interface.

## Related decisions and evidence

- [ADR-028: managed memory boundary](ADR-028-managed-agentdb-interface-boundary.md),
  Implemented: managed interfaces remain mandatory.
- [ADR-032: proven ADR graph I/O](ADR-032-adr-graph-io-must-prove-reads-and-writes.md),
  Implemented: registration outcomes must be reported truthfully.
- [ADR-033: live structured interfaces](ADR-033-generated-ruflo-instructions-use-the-live-interface.md),
  Implemented: reuse discovered structured native tools.
- Product ADR-027 (Accepted, mirror choice) and ADR-037 (Accepted, implemented
  comprehensive facade) require scoped reconciliation when their default access
  behaviour changes. AI-BA ADR-084's historical withdrawal remains authoritative.
- Native implementation: [memory MCP tools](https://github.com/ruvnet/ruflo/blob/main/v3/%40claude-flow/cli/src/mcp-tools/memory-tools.ts)
  and [MCP command configuration](https://github.com/ruvnet/ruflo/blob/main/v3/%40claude-flow/cli/src/commands/mcp.ts).
- Retained private evidence: `.local/federated-research-20261104/`, particularly
  `generation-scope-followup/configuration-first-decision.json`,
  `configuration-first-live-reads.json` in the same directory, and
  `product-incident-20261104/timing-analysis.json`.
- Seraphina's configuration advice is explicitly advisory: its gateway had no
  source/configuration access. Live probes and inspected source support this
  decision; the advice alone does not prove native capability or deployment.
