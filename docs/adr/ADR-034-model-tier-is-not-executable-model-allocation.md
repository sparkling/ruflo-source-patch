# ADR-034: A routing tier is not executable model allocation

**Status**: Implemented
**Date**: 2026-09-08
**Deciders**: Henrik Pettersen
**Tags**: ruflo, mcp, routing, models, codex, claude-code, metaharness

## Context

Ruflo 3.39.0 (bundling `@claude-flow/cli` 3.38.23) still exposes `hooks_model-route` as a
Haiku/Sonnet/Opus selector. Its fallback and bandit-backed paths return those same Claude aliases. Upstream
[ADR-026](https://github.com/ruvnet/ruflo/blob/main/v3/implementation/adrs/ADR-026-agent-booster-model-routing.md)
defines exactly that three-tier design. Upstream
[ADR-112](https://github.com/ruvnet/ruflo/blob/main/v3/docs/adr/ADR-112-mcp-tool-discoverability.md)
makes `agent_spawn` the tracked-agent interface and recommends pairing it with routing, but does not
define a host-neutral executable-model vocabulary.

The public `agent_spawn.model` schema nevertheless admits only `haiku`, `sonnet`, `opus`, `opus-4.7`,
and `inherit`. This rejects exact native IDs such as `gpt-6-astra` and `claude-fable-5` before the
handler runs. The handler itself already preserves any non-alias `config.model` as `modelId` after
Ruflo #2962/#3007, so the executable capability and advertised MCP contract disagree. Open issue
[#3215](https://github.com/ruvnet/ruflo/issues/3215) tracks that defect. The broader Fable-router design
remains open in [#2357](https://github.com/ruvnet/ruflo/issues/2357).

Our customised harness owns portfolio allocation. Teaching Ruflo's legacy three-tier hook a hardcoded
Astra/Fable table would duplicate that authority, age immediately, and risk presenting a tracking
decision as proof that a native host executed the requested model.

## Decision

Add the issue-backed `ruflo-model-contract` target across every authenticated global and npx
`@claude-flow/cli` copy.

- Replace the restrictive public enum on `agent_spawn.model` with a bounded, non-whitespace model-ID
  grammar; keep the existing handler and its exact non-alias `modelId` fast path unchanged.
- Describe exact IDs as native-executor or caller-harness intent. A Ruflo agent record is not execution
  evidence.
- Preserve `hooks_model-route`'s routing algorithm. Label its return as `routingTier` on both the
  fallback and router paths and return `allocationOwner: "caller"`.
- Do not add Astra/Fable aliases, provider transport, inference, availability claims, fallback, or
  model substitution. The customised harness maps a tier to its complete current portfolio.

The target uses the existing CLI composition engine because `hooks-tools.js` is already patched by the
`cwd` target. Both targets therefore rebuild that shared file from one pristine image instead of
competing over a backup. Every exact anchor is proved before its file changes; an unsatisfied file makes
the complete target fail nonzero. Uninstall recomposes shared files with their remaining targets. The
target is re-applied by the existing SessionStart hook and monitor.

Retirement requires every installed copy, without local markers, to import successfully; its public
schema must accept representative Astra and Fable exact IDs while rejecting empty/whitespace values;
the handler source must preserve exact IDs; and both hook paths must expose a tier plus
caller/harness/executor-owned allocation inside the `hooks_model-route` definition itself. Unrelated
fields elsewhere in the module cannot satisfy that proof. A changed marker, version, or closed issue
cannot retire it.

## Consequences

### Positive

- The MCP schema can express the exact model chosen by a native host or customised harness.
- Ruflo's useful learned tier remains available without falsely claiming a complete model portfolio.
- Model allocation has one owner, and tracked intent remains distinct from observed execution.

### Negative

- Consumers wanting routing outcomes for exact models still need an upstream typed separation between
  exact model identity and the legacy bandit's tier key; this patch does not redesign the learner.
- Exact anchors must be reviewed when upstream restructures either runtime file.

### Neutral

- No model is invoked, installed, configured, selected, or paid for by this patch.
- The patch changes MCP runtime metadata/return fields only; it does not change the router's decision.

## Links

- [ADR-001](ADR-001-source-patch-by-literal-anchors.md)
- [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md)
- [ADR-016](ADR-016-tests-are-behavioural-and-mutation-tested.md)
- [ADR-020](ADR-020-plugin-targets-compose.md)
- [Ruflo #3215](https://github.com/ruvnet/ruflo/issues/3215)
- [Ruflo #2357](https://github.com/ruvnet/ruflo/issues/2357)
