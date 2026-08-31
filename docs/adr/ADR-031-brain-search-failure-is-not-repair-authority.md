# ADR-031: A Brain search failure is not repair authority

**Status**: accepted
**Date**: 2026-08-31
**Deciders**: Henrik Pettersen

**Tags**: ruvnet-brain, retrieval, prototype, repair, updater, safety

## Context

An implementation query for MetaHarness contained the word `constructor`. The active Brain
`4.3.8-dev` worker returned `ERR: m is not iterable`, and its total-failure response told the model to
run `npm install` inside the live KB and download `github:stuinfla/ruvnet-brain` through npx. The model
did both. Neither action could repair the defect.

The exact cause was in `kb/forge-ask.mjs`. Symbol sidecars are decoded by `JSON.parse()` into ordinary
objects, but `symbolRoute()` directly read `sym.bySymbol[t]`, `sym.byStem[t]`, and
`sym.byPackage[t]`. A missing token named `constructor` therefore resolved the inherited `Object`
constructor. The truthy-value guard accepted it and a `for...of` threw because the function is not
iterable. A malformed non-array own value had the same failure shape.

The second defect amplified the first: every per-repository exception is reduced to an unclassified
`ERR: <message>`, yet MCP and CLI renderers prescribed the same package-manager repair for every total
failure. Loud failure is correct; inventing a mutation from an unclassified exception is not.

## Decision

Add the issue-backed `brain-search-safety` target for upstream
[#224](https://github.com/stuinfla/ruvnet-brain/issues/224) and
[#225](https://github.com/stuinfla/ruvnet-brain/issues/225):

- Symbol routing accepts only own, array-valued table entries. Inherited keys and malformed values are
  ignored; legitimate own arrays retain their behavior.
- Total retrieval failure remains prominent and non-successful, preserves the exact error, and forbids
  autonomous repair. It no longer recommends `npm install` or a GitHub npx download without a proven
  missing-dependency diagnosis.
- The target discovers only `forge-ask.mjs`, `forge-mcp-all.mjs`, and `forge-ask-all.mjs` in the one
  already-active user-level KB. It never changes Brain stores, RVF/passages/symbol sidecars, models,
  updater state, receipts, `active.json`, version identity, immutable generations, or host caches.
- Native retirement executes the exact installed `symbolRoute()` against missing `constructor`, an
  inherited array, an own `constructor` array, and malformed values. Both failure renderers must be
  marker-free, syntax-valid, loud/nonzero, and free of automatic mutation instructions.
- A native-equivalent result satisfies status but is not local ownership. Reconciliation uses
  `hasPatch` when supplied, so a marker-free upstream fix is preserved rather than treated as an
  orphaned patch requiring restoration.

## Consequences

The original MetaHarness query can use source retrieval again without reinstalling or replacing the
Brain. Future query tokens that collide with prototype keys cannot enter the symbol route through
inheritance. A different search failure is still visible, but it cannot silently grant the model
permission to mutate the runtime.

The patch is intentionally temporary. It retires only when the active shared KB passes the executable
own-array routing proof and both native failure paths reject automatic repair. Issue state, version text,
or source markers alone are insufficient.

## Links

- [ADR-001](ADR-001-source-patch-by-literal-anchors.md)
- [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md)
- [ADR-016](ADR-016-tests-are-behavioural-and-mutation-tested.md)
- [ADR-020](ADR-020-plugin-targets-compose.md)
