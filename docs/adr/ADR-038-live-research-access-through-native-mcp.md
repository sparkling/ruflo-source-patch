# ADR-038: Live research access through native MCP methods

**Status**: Accepted; HZ access, declared private holdings and native inventories implemented; remaining capability limits explicit
**Date**: 2026-11-04
**Updated**: 2026-11-14. Routed hierarchical discovery uses the executing owner's contract (source-patch #12); storage and native inventory semantics remain unchanged.
On 2026-11-05 the owner retired combined-search compatibility: 22 native, document and artefact methods replace the former 24-tool interface.
Owner confirmed Hetzner as the authority for all five
research projects and requested a complete coverage plan plus removal of
overbroad content filters. Shared content admission and the document/native-inventory expansion are
verified, committed and activated on Hetzner. Native pattern/skill inventories,
100 declared private originals and shared cold initialization are implemented.
Actual consumer refresh is verified; remaining native and cold-cost limits stay
explicit. Laptop checkouts are not current authorities.
**Deciders**: Henrik Pettersen
**Tags**: ruflo, mcp, research, source-authority, native-configuration

## Context

AI Strategy Business Architecture needs research from BA, SA, EA research,
Product and its own research. Other established consumers use the same sources.
The owner requires live access without export/import synchronization or a common replica,
and prefers supported Ruflo configuration to another retrieval system.

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

The owner's live-only direction supersedes RVF portability; its experiments remain evidence.

## Decision

Use named, source-bound native Ruflo MCP connections to the existing authoritative
research owners. Let the research agent choose relevant sources and native
operations, retrieve selected evidence and synthesize a source-attributed answer.
Prefer existing registrations, owner connections and configuration. Do not write
mirrors of methods that Ruflo already exposes.

### Source authority and access

- All five authoritative repositories and their managed research owners live on
  Hetzner. Laptop MCPs are consumers of those owners, not independent research
  authorities. Do not synchronize laptop corpora to make them appear current.
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
- Separate access control from evidence classification. Authorized generated
  artefacts, catalogues, runtime records and quoted examples must remain
  discoverable with their provenance and limitations. A substantive-evidence
  heuristic must not silently deny retrieval. Keep credential protection,
  configured source boundaries and EA's operational-store exclusion.
  Retrieved instructions and code examples remain untrusted source content;
  making them readable never authorizes their execution.

### Methods and evidence

| Need | Approach |
|---|---|
| Find stored research | Native search with relevant source/namespace selection and documented arguments. |
| Read a known stored record | Native exact retrieval, preserving value, identity and metadata. |
| Discover/read research originals | Reuse existing `search_documents` / `read_document` and supported source readers; preserve format, hash and extraction coverage. |
| Discover/read published media metadata | Separate `search_artefacts` / `read_artefact`, reusing durable source publication catalogues and published original locations. |
| Inspect relationships | Expose relevant existing native graph read methods where configured and authorized. |
| Consult learned patterns or other learning state | Use the appropriate existing native controller reads; preserve their distinct semantics. |

`search_knowledge` and `read_evidence` are retired: no registration, dispatch or alias.
Discover current schemas; verified exposure gaps justify thin native bindings, not
replacement engines. Report unavailable capabilities without successful substitutes.

Exact memory retrieval returns the stored record. If it contains only a summary or
reference, follow the existing original-document reader when the task requires
the original. Label summaries, imported evidence, withdrawn decisions and missing
originals truthfully. A current read does not make a historical record current.

### Published media custody and separate methods

Owner direction requires distinct MCP methods for research documents and published
artefacts. `search_documents` / `read_document` retain research text and authoring
inputs; `search_artefacts` / `read_artefact` discover exact media catalogue identities,
titles, types, generation configuration, source references and published originals.
Research that discusses an artefact remains research text. Catalogue metadata must
not appear as though it were the full underlying research or media content.

Publication deletes local and NotebookLM copies after verified publication. Reuse
the existing durable publication/catalogue manifests and original object/site
locations. Do not recreate mirrors, regenerate media or assume provider copies
remain. Retained transcripts/extracted text may support content search where the
existing owner exposes them; otherwise state metadata-only coverage. A catalogue
publication receipt is historical verification, distinct from a current URL check.

Expose only filters backed by observed metadata. Unsupported source classes,
missing manifests, absent transcripts and inaccessible published originals remain
explicit. Refresh affected project MCP consumers after deployment and verify their
actual tool discovery plus artefact search/exact metadata reads; restarting a
server alone is not completion.

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

The earlier deployed baseline advertised 15 tools with descriptions and argument
schemas: eleven source-bound native memory/controller reads, two original-document
methods and two retained compatibility methods. It registers tools, not MCP
resources or prompts. Method discovery documents invocation; it is not a corpus
coverage guarantee.

The 2026-11-04 retained-consumer check passed all fifteen exact reads across five
sources and three HZ parent sessions. Original-document checks also verified full
selected bodies and hashes. These checks establish the exercised identities and
operations, not exhaustive search recall or access to every repository file.

The deployed baseline document reader covers selected tracked Markdown/JSON,
including selected AI-BA authoring inputs. Shared runtime/generated-content
admission has been corrected: evidence classification is not access control.
Secrets remain protected. Private originals and other file formats require their existing
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
The separately stale BA and AI-BA project-memory clients were then refreshed;
their own native statistics reads passed and both project configuration files
were restored byte-for-byte.

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

Content admission was another independent boundary: it excluded six selected BA,
eleven SA and 64 EA documents. Some were runtime receipts. A concrete
false positive was SA's historical primary-source collection part 3:
its explicit inert upstream quotations include a command containing `<task>`,
and the shared runtime-wrapper detector excluded the entire document. Quoted
implementation examples are not executable runtime instructions; making them
retrievable does not waive credential protection.

That body-admission defect was repaired centrally in Product commits `6442c82`,
`f9e02c1` and `da488c5`. The shared predicate now protects credentials; heuristic
content classification is advisory metadata. Distinct native record identities
and unresolved graph discovery references remain visible. The old counts above
are pre-repair evidence, not current credential exclusions.

The final change is pushed and active in Hetzner Product and AI-BA services.
Authenticated full paginated reads matched content hashes for Product (11,119
characters) and AI-BA (39,978); unauthenticated and wrong-source requests returned
401 and 404. The actual SA false-positive document passed a full 377,206-character
shared-reader read on Hetzner. That SA check did not change its network route.
Focused consumer, source-boundary, graph and credential regression tests passed.
Receipt: `content-filter-live-proof.json` in the activation evidence directory.

At the audit cut, BA/SA/EA registrations still used the old laptop source route;
the later verified implementation and activation records below supersede that
routing observation. Overlapping uncommitted laptop reader changes were
preserved. AI-BA's independent path/extension selection still excludes 868 tracked
entries in the measured run; this includes non-research files and is not 868
proven missing research documents. Historical prefiltered exports and legacy
namespace scope also remain qualified limitations. No data was re-exported or
migrated by the content-filter repair.

Eleven native read methods also do not census all controller populations. Native
episode listing exists but is not exposed by this source interface; top-K pattern,
episode and graph reads cannot establish completeness. Ordinary records, retained
SQL graphs and native controller representations must be mapped separately.
Upstream ADR-520's episode get/list views bound text fields to 4,000 characters;
the same bound was verified in Hetzner's installed Ruflo 3.71.1 implementation.
An exact episode ID therefore identifies a record without guaranteeing its full
text; the subsequent list binding preserves this native limit. Verify the installed view contract and expose a supported full-record read
where available; otherwise state the limit. Never reconstruct missing text or
use raw managed-database access to bypass that boundary.
Published artefact catalogues, durable published originals and private research
holdings need explicit access/custody mappings; deleted local/provider copies are
not expected retrieval locations; they are not covered merely because a
document mentions their URLs.

Complete this decision by correcting authority after verifying the active source
owner, reusing existing readers for eligible omitted source classes, exposing
needed existing native inventory methods, and mapping artefact metadata to its
originals. Preserve intentional exclusions and qualify unavailable extraction.
Do not add a common store, synchronization pipeline or replacement search engine.

Private audit evidence: `coverage-audit-hz-summary.json` (24 source-class rows),
`coverage-audit-mac-paths.json`, `coverage-audit-authority.json`, and
`source-schema-refresh-hz.json` under the existing activation evidence directory.
`coverage-audit-mac-admission.json` records the additional content exclusions.

### Hetzner coverage completion plan

This is the implementation backlog, not a declaration that all listed material
is already exposed. The earlier laptop counts above are dated discovery evidence;
reconcile them against current Hetzner inventories before reporting completion.
Reuse existing source configuration, manifests, readers and native methods.

| Step | Work and owner | Completion evidence |
| --- | --- | --- |
| 1. Establish authority | Source configuration owner: map all five canonical Hetzner roots, existing ordinary/controller/graph bindings and authenticated endpoints. Correct laptop references in registrations, project overrides, instructions and retrieval skills. Keep historical imports labelled with their original source cut. | Each intended consumer identifies the Hetzner source and retrieves a current known record/document. No operational EA access or fallback to a laptop copy. |
| 2. Correct retrieval admission | Shared Product reader owner: preserve authorization and credential checks; replace relevance-based exclusion with truthful content qualification across document and compatibility retrieval. | Previously rejected inert code examples, generated artefacts and catalogues can be retrieved; credential and out-of-scope requests remain refused. |
| 3. Account for all source classes | Each existing source owner supplies its current tracked paths, declared private holdings and retained manifests. Map each class to a supported method, explicit access restriction, duplicate rendition or unresolved gap. Include ordinary memories, learning controllers and graphs independently. | Every inventoried class has a disposition and authority. Counts are tied to a source cut; unresolved/private uninspected holdings are explicit, never counted as covered. |
| 4. Expose omitted documents/data | Shared reader owner: extend existing reader configuration for eligible text, CSV, JSONL, Markdown authoring inputs, research catalogues, reviewed assertions and opportunity specifications. Reuse existing extraction/readers for binary originals. | Known omitted items from every source can be discovered and read with matching identity/content. JSONL records retain line/record identity; truncation, extraction gaps and duplicate formats are visible. |
| 5. Complete native record access | Native interface owner: discover installed read/list/get schemas for populated controllers, tiers and graph representations; expose missing read-only methods only where needed. Use native pagination and exact retrieval. | Enumeration/count reconciliation and representative exact reads for each populated representation; unavailable enumeration remains a named limitation. Top-K search is not a census. |
| 6. Link artefacts to evidence | Existing source/catalogue owner: connect durable published artefact metadata to source references, verified published object/site locations, configurations and any retained transcript/text renditions through separate artefact methods. Preserve the deletion-after-publication lifecycle; do not require deleted local/provider copies. | A source-to-artefact and artefact-to-source example works for every populated artefact type; missing, removed or inaccessible originals are reported. An accessible URL alone does not prove body/text coverage. |
| 7. Activate and verify consumers | Deploy the shared change on Hetzner, refresh affected registrations through supported controls, then point laptop consumers at Hetzner. Preserve existing sessions and exact unrelated configuration. | Five-source discovery, native reads, original-document reads and the separate artefact methods pass from refreshed actual project consumers; stale-client/restart behavior and explicit failure reporting pass. Record active code/configuration identity and rollback. |

The initial source-specific backlog is:

- BA: current Hetzner ADR/research changes, authoring inputs, reviewed graph and
  artefact assertions; account separately for golden/evaluation cases rather than
  treating their volume as missing primary research.
- SA: retained text originals, authoring/research selections and their source
  manifests; identify whether PDF/CSV/HTML/MDX contain additional content or are
  equivalent renditions.
- EA: retained upstream text blobs, research CSVs and their provenance; preserve
  the research-only store boundary and distinguish site renderings from originals.
- Product: current research catalogue, claims/questions and benefits coverage;
  qualify imported memory/learning snapshots separately from live source owners.
- AI-BA: Markdown authoring inputs, record-addressable JSONL ledgers, opportunity
  specifications, private book projection and published artefact manifests. Keep
  the known missing book page and unavailable visual extraction explicit. Its
  current `scripts/knowledge/corpus.mjs` path selection is a separate boundary
  from the shared content predicate; fixing body classification does not expose
  files outside those selected roots or extensions.

The fresh read-only Hetzner inventory establishes the following baseline. Every
root is `/home/claude/src/hm/<repository>`, on `main`, without a `/data` symlink.
Counts describe selected classes at these revisions, not universal missing totals.

| Source / repository | Inspected revision | Concrete inventory and reuse |
| --- | --- | --- |
| BA / `semantic-business-architecture` | `9b6588a1ad71ecc8b968a64911912b8e7304fd81` | The 13 added / 27 changed research/config paths versus the configured Mac cut remain confirmed. Reuse `src/chat/documents.mjs`, `src/research/catalog.mjs` and the shared reader for authoring and reviewed assertions. |
| SA / `semantic-solution-architecture` | `ed7f571f4659fa49f8e06425f27d11e4a3a7f99a` | 79 selected research/source TXT files, ten authoring JSONs and 32 generation files. `src/corpus/manifests.mjs` already owns source manifests; `src/corpus/research-projection.mjs` recognizes TXT, CSV, TTL, JSON-LD and MDX. Reuse those format/source semantics. |
| EA / `semantic-enterprise-architecture` | `4ededa77a556608e96445244a333671f45f7351f` | 6,383 tracked TXT overall, 6,367 under docs, 6,319 under docs/research; these differ from the earlier 6,361 excluded-file predicate. Five research CSVs include ESRS and textile DPP data points. Reuse existing document/custody readers and source manifests. |
| Product / `semantic-product` | `134290e5a4c7dd88f2609c81a53829b19adfa9f6` | Configured private lifecycle catalogue: 16 sources, eight claims, eight questions; benefits coverage: nine sections. Reuse `vendor/research-runtime/src/research/catalog.mjs` with its existing realpath containment and `scripts/product-knowledge-documents.mjs`. |
| AI-BA / `semantic-ai-strategy-business-architecture` | `0174e8735c930614631287e0f405d2988979db2f` | 483 authoring MD plus 389 authoring JSON, nine research JSONL, 30 opportunity files and 130 generation JSONs. Reuse `scripts/knowledge/corpus.mjs`, `local.mjs`, `pdf.mjs` and `retainedBookOriginals`; do not equate all untracked implementation files with research. |

Authority rollout must correct Product's stale `AGENTS.md` and
`config/knowledge-mcp.json`, installed retrieval skill `references/hosts.json`,
agent instructions and project overrides as applicable. The current HZ
`semantic-knowledge-mac-tunnel.service` forwards port 4394 to laptop port 4391;
it cannot remain the source route after the Hetzner cutover. Retire that serving
dependency only after all consumers use verified Hetzner routes. No bulk
instruction rewrite or unrelated configuration standardization is required.

Preserve each verified store tuple: BA/SA/AI-BA ordinary and learning reads use
`agentdb-memory.db`, with retained graphs in `memory.db`; Product ordinary/graph
reads use `memory.db`, learning uses `agentdb-memory.db`; EA reads remain solely
on research `agentdb-memory.db`. Validate these roles against the existing owner
before activation; a filename by itself does not establish the authority.

For every source, include existing namespaces, controller patterns, episodes,
skills, tiered memory and graph data when populated and authorized. Check installed
native capabilities first: a method present in standalone AgentDB is not proof
that the running Ruflo owner exposes it. Missing bridge exposure is a distinct
task from adding file formats. Add no competing AgentDB owner just to acquire a
method.

Steps 2 and 3 can run independently. Source expansion depends on the authority map
and admission correction; native controller exposure can proceed independently of
file readers. Artefact linking depends on the catalogue/originals inventory.
Activate verified slices without waiting for unrelated source classes, but keep
the overall ADR Accepted until coverage limitations are honestly reconciled.

For documents, completeness means accounting for the configured source inventory
and proving the reader can address its admitted items; it does not mean that a
single ranked search returns everything. For managed records, use the native
list/count/get contract where available. For PDFs, images, audio and video,
distinguish access to the original from extracted text, transcription and visual
understanding. No promise of complete OCR or missing source reconstruction is made.

Use a small regression set drawn from the actual gaps: SA's quoted `<task>`
collection; an EA upstream text blob and research CSV; BA reviewed assertions;
Product catalogue/benefit records; AI-BA authoring Markdown, a JSONL record and an
opportunity specification; plus an artefact/original link and a native episode.
Include source refusal, credential refusal, no-match, real backend failure,
pagination and declared extraction-gap cases. Extend existing tests rather than
adding another harness or an exhaustive per-request inventory/export.

### Verified implementation slices, 4 November 2026

Product `b64e602` is pushed on `main`: canonical HZ source configuration; existing
tracked reader support for TXT, CSV, JSONL, Markdown/MDX, TTL/JSON-LD, HTML source
and Mermaid text; configured authoring/reviewed-assertion roots; Product's current
private catalogue through its existing validated `readCatalog` owner; benefits
coverage; and thin native `agentdb_episode-list` exposure. JSONL records retain
exact line bytes, line number and observed whole-file hash. HTML remains source
text, without executing scripts or claiming rendered/visual extraction.

Thirty-seven focused regressions passed, including exact text pagination, JSONL
line identity, native count/pagination passthrough, credential and source refusal,
private catalogue validation and existing consumer/service behaviour. The current
HZ BA, SA and EA research owners reported 93,996, 53,145 and 43,645 ordinary
records respectively at their canonical `agentdb-memory.db` paths. These are
observed counts, not fixed expected totals or complete controller coverage.

AI path selection is committed on HZ as `2658c916`; the identical scoped file
change is published through aligned Mac `main` as `9eb8661`, preserving HZ's
unrelated divergent history. Direct HZ validation matched every admitted live
text unit against its source bytes: 1,696 units plus 144 retained book pages.
The previously omitted selected classes include 483 authoring Markdown files,
nine JSONL ledgers and 29 opportunity Markdown/JSON specifications; the thirtieth
opportunity file is CSS and remains outside research text. The retained book's
missing page 1 and absent visual extraction remain explicit.

Native episode list/get succeeded at the five actual HZ controller owners:
BA 1,756; SA 15,827; EA research 2,413; Product zero; AI-BA 616 at observation.
Product's zero is a successful native inventory result at that observation.
Ruflo 3.71.1 omitted existing AgentDB 3.3 public pattern/skill inventory methods.
Issue-backed `ruflo-controller-inventory`, release 4.46.137, exposes native
`agentdb_pattern-list`, `agentdb_skill-list` and `agentdb_skill-get` through the
same owner, operation lease and authorization path. Pages preserve native totals,
filters and offsets; they are live reads, not a transaction across concurrent writes.
`agentdb_hierarchical-stats` exposes native counts and durability/fallback details,
not tier record enumeration. Qualified #4712 adds native `agentdb_hierarchical-list/get`
over persisted IDs/history; `asOf` fixes validity time, never a multi-page snapshot.
#4714 preserves legacy pattern lookup but distinguishes healthy empty reads from failures.

The artefact owner (`295e4ba` / `75d9029`) integrates methods, skills and defaults in `02da635`.
Forty-four initial regressions passed; the initial 60 consumer connections exposed 24 tools.
The current interface has eighteen native reads, two document methods and two artefact methods;
Product `4d13f5c` removes both compatibility methods; all 60 Mac/HZ connections verified 22 tools after refresh. Publication/generation catalogues are separated from
primary document results; discussion and authoring research remain readable.

The catalogue inventory contains BA 1,598, SA 3,057, EA 510 and AI-BA 2,808
records at inspection. AI-BA includes 1,134 published Strategy artefacts and
1,674 historical catalogue records. Product explicitly reports an unbound media
catalogue, not proof that no media exist. Current/publication, historical and
unavailable states remain distinct; binary text is not indexed by this adapter.
The installed methods preserve exact source lineage, original hashes/locations,
source-cut pagination and observed configuration fields. HEAD checks verify only
access response state, not full binary identity or semantic content.

The 28-class coverage disposition now includes 100 declared private originals:
Product 68, AI-BA 10, BA 11, SA 10 and EA research one. Existing catalogue/custody
owners supply exact identities; explicit configured paths cover selected working
research. All 100 bodies match their source hashes. Seven representative live
MCP searches and complete reads across all five owners verify hashes and status.
Held/quarantined status is not an access ban; drafts, held inputs and historical
copies retain their qualifications. Missing originals, credential refusal and
wrong-owner bindings propagate explicit coverage failures. Other unconfigured
holdings, binary features and controllers without native inventory remain gaps.

Proofs remain in Product `.local/native-live-mcp-20261104/` and the root
`.local/federated-research-20261104/native-live-activation/` bundle, including
private-holdings verification and `product-cold/completion-summary.json`.

### Actual consumer activation and remaining limits

Release 4.46.142 refreshed 22 native project owners and all three HZ source services.
At that release, 60 source connections across 12 loaded Mac/HZ parents exposed 24 tools and passed
tier listing plus exact same-row reads; ten absence and ten source-override checks passed.
Unrelated consumer configuration stayed intact. Tier totals were BA 74, SA 4, EA 24,
Product 22 and AI-BA 246 at observation. Strategy's original Product query returned
12 candidates with no coverage gaps in 61.069 seconds; native pattern no-match took
723 ms. This clears its degraded-empty defect, not the remaining broad-search cost.

Actual consumer searches and complete/hash-checked reads passed for TXT/CSV,
assertions, authoring Markdown, JSONL, opportunities and Product benefits/catalogues.
Artefact metadata reads and sixteen source-to-artefact round trips passed;
Product retains its explicit media-catalogue gap. Earlier duplicate cold loading
took 60.0 seconds and 2.49 GiB; shared atomic initialization reduced the same corpus
to 28.9 seconds and 1.36 GiB with identical result hashes. After private-source
integration, two independent MCP sessions completed first searches in 38.9 seconds
(39.1 including initialization), below the unchanged 70-second bound, at 1.39 GiB.
Exact originals matched hashes; failed loads publish nothing. Retry, cancellation and changed cuts passed 45 Product and 31 local/native tests at that revision.

Product commit `9dff14a` adds shared compact document memberships, replacing the
whole dictionary when freshly hashed title/body populations change. EA matched
benchmarks changed cold 19.38 to 23.23 seconds, warm 18.79/18.43 to 6.79/6.61;
peak RSS fell 2.49 to 1.92 GiB, with about 187 MB extra held heap/typed arrays.
All ordered identities/counts matched. Five live sources passed after refresh; EA measured 24.23/6.50 seconds, Product 31.08/0.53; exact bodies matched hashes.
Product sealed cold cost remains. Focused tests pass 13/13; full suite 110/111 has one unchanged Mac-only MetaHarness fixture failure. See `.local/query-performance-20261105/`.

The `routes-consumers/` receipt bundle contains host configuration/installation,
service activation, expanded-class and Product follow-up proofs. Its HZ and Mac
`post-retirement-proof.json` files record all 20 successful final checks;
`hz-proof/final-runtime-proof.json` records unchanged owners and retired routes.
Unrelated configuration was preserved at mutation; subsequent independent hook
trust-hash changes are not falsely described as byte-for-byte global preservation.
Dormant projects inherit user bindings; Claude registrations were checked, without
claiming a live Claude-process refresh. Current receipts are in `.local/tier-inventory-20261104/`.
Twenty search/exact calls used twenty owner policy transactions; no duplicate client evaluation.

## Consequences

The native engine owns retrieval/storage; the agent owns synthesis. Source data
stays at its authority without sharing synchronization.
The agent must select sources and assess evidence; original files still need an accessible reader. Native engine defects remain possible and are handled
through the shared issue-backed patch process, not hidden by the interface.

## Related decisions and evidence

- [ADR-028: managed memory boundary](ADR-028-managed-agentdb-interface-boundary.md),
  Implemented: managed interfaces remain mandatory.
- [ADR-032: proven ADR graph I/O](ADR-032-adr-graph-io-must-prove-reads-and-writes.md),
  Implemented: registration outcomes must be reported truthfully.
- [ADR-033: live structured interfaces](ADR-033-generated-ruflo-instructions-use-the-live-interface.md),
  Implemented: reuse discovered structured native tools.
- Product ADR-027 (Accepted, mirror choice) and ADR-037 (Accepted, implemented
  comprehensive facade) have scoped current-contract amendments in `02da635`;
  their older historical behaviour is retained as history. AI-BA ADR-084's historical withdrawal remains authoritative.
- Inventory exposure gap: [Ruflo #4707](https://github.com/ruvnet/ruflo/issues/4707).
- Native implementation: [memory MCP tools](https://github.com/ruvnet/ruflo/blob/main/v3/%40claude-flow/cli/src/mcp-tools/memory-tools.ts)
  and [MCP command configuration](https://github.com/ruvnet/ruflo/blob/main/v3/%40claude-flow/cli/src/commands/mcp.ts).
- Retained private evidence: `.local/federated-research-20261104/`, particularly
  `generation-scope-followup/configuration-first-decision.json`,
  `configuration-first-live-reads.json` in the same directory, and
  `product-incident-20261104/timing-analysis.json`.
- Seraphina's configuration advice is explicitly advisory: its gateway had no
  source/configuration access. Live probes and inspected source support this
  decision; the advice alone does not prove native capability or deployment.
