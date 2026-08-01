# ADR-027: A missing packaged catalog must not look like missing credentials

**Status**: Implemented
**Date**: 2026-08-01
**Deciders**: Henrik Pettersen
**Tags**: brain, console, packaging, provider-detection, patch-target

## Context

Brain #24 / PR #26 added real provider-key checks to the Console. Those checks load
`data/model-catalog.json` through `scripts/model-catalog.mjs`. Brain 4.0.2 and current upstream source
omit that data file from both the npm `files` allow-list and the persistent Console-runtime transaction.

`gatherRouterEngine()` catches the resulting catalog-load error but leaves `providerKeys` empty. Its API
therefore reports only the separately detected OpenRouter key, even while the same response's native
`detectSubscriptions()` output correctly reports OpenAI and Google/Gemini keys. An internal packaging
failure is presented as a valid credential-negative result.

The package/runtime boundary belongs upstream. This repository must not seed the missing asset, modify
Brain's updater, or maintain a parallel provider catalog.

## Decision

Add the atomic composed target `brain-console-provider-keys`, backed by
[stuinfla/ruvnet-brain#86](https://github.com/stuinfla/ruvnet-brain/issues/86).

- Patch only bounded installed `scripts/onboarding-console.mjs` copies.
- Replace the exact catalog-failure catch with a marked multiline form that preserves Brain's native
  house fallback and derives boolean provider availability from Brain's own `detectSubscriptions()`.
- Activate the fallback only when the catalog path throws. Catalog-driven detection remains unchanged
  when the required asset is present.
- Never read, log, return, or persist credential values.
- Compose from the same vendor pristine as `brain-console-lifecycle`; either target can be removed while
  the other remains, and final removal restores vendor bytes exactly.
- Refuse missing or duplicated anchors atomically and re-apply through the existing desired-state hook
  and monitor.

The target does not create or copy catalog data and does not touch Brain's updater, `.console-runtime`
activation transaction, immutable version store, `active.json`, caches, hooks, MCP, or learning runtime.

## Verification

The executable regression proves bounded discovery, exact forward/reverse transforms, atomic refusal,
composition and independent uninstall with #79, public CLI lifecycle, and byte-perfect restoration. A
missing-catalog runtime fixture checks `OPENAI_API_KEY`, `GOOGLE_API_KEY`, the `GEMINI_API_KEY` alias,
and unset-key negative controls. It also proves returned JSON contains no synthetic key values, and a
mutation that restores the empty fallback fails the behavior and ownership checks.

## Retirement

Do not guess a version predicate before an upstream candidate exists. Retire only after active released
bytes prove all of the following:

1. the packed artifact contains and loads the required catalog;
2. the persistent runtime transaction copies and validates that exact asset before activation;
3. synthetic OpenAI, Google, and Gemini-alias keys produce correct boolean API state after a clean staged
   install, with unset-key negative controls; and
4. a deliberately missing catalog fails staging or exposes an explicit degraded state without false
   credential negatives.

Issue closure, a version string, or source-checkout behavior alone is insufficient under ADR-014.

## Links

- Upstream: [stuinfla/ruvnet-brain#86](https://github.com/stuinfla/ruvnet-brain/issues/86)
- Predecessor: [stuinfla/ruvnet-brain#24](https://github.com/stuinfla/ruvnet-brain/issues/24)
- [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md)
- [ADR-020](ADR-020-plugin-targets-compose.md)
- [ADR-025](ADR-025-brain-console-owned-runtime.md)
- `lib/brain-console-provider-keys/patcher.mjs`
- `test/brain-console-provider-keys.mjs`
