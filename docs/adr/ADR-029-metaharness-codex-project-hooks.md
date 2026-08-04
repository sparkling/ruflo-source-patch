# ADR-029: Render declared MetaHarness lifecycle hooks as native project Codex hooks

**Status**: accepted
**Date**: 2026-08-04
**Deciders**: Henrik Pettersen
**Tags**: metaharness, codex, hooks, patching, safety

## Context

MetaHarness owns a host-neutral `HarnessSpec.hooks` model. Its Claude Code adapter consumes that
field, but its Codex adapter drops it. The standalone CLI and Studio scaffold paths also emit only
Codex TOML and instructions. MetaHarness ADR-004 therefore describes Codex as having no native hooks
and claims a kernel fallback that the generated JavaScript harness does not actually wire.

Codex now discovers project `.codex/hooks.json` files, subject to project trust and explicit hook
review. Treating Codex as hookless is stale, but blindly copying Claude declarations is also wrong:
the supported events, matcher language, handler kinds, response JSON, and trust boundary differ.

The complete upstream correction is tracked by
[ruvnet/metaharness#168](https://github.com/ruvnet/metaharness/issues/168). It includes the public
adapter, CLI and Studio models, template declarations, packaging/witnesses, behavior tests, and the
documentation reconciliation requested in the issue.

## Decision

Add the issue-backed `metaharness-codex-hooks` package target with this deliberately narrow scope:

- Discover only installed npm/npx packages whose own `package.json` identity is exactly
  `metaharness` or `@metaharness/host-codex`; never patch a similarly shaped project file.
- Patch the installed CLI host renderer and installed host adapter by two unique literal anchors.
  Both edits are atomic, invertible, and composed from one saved vendor pristine.
- Emit hook files only for a non-empty declaration. Hook-free harnesses keep their existing output;
  the patch does not fabricate a default lifecycle policy.
- Emit only strict `.codex/hooks.json` keys and command handlers. Unsupported events, handler kinds,
  malformed helper names, and ambiguous inner matchers fail generation instead of disappearing.
- Translate a MetaHarness tool matcher to Codex's tool-name regex. When a declaration contains an
  inner glob such as `Bash(rm *)`, preserve it in an encoded, data-only token and enforce it against
  Codex's structured event input before invoking the helper.
- Ship a generated project-local CommonJS bridge. It walks from the event/session working directory
  to the owning `.codex` tree, confines a regular non-symlink handler beneath `.codex/helpers`, runs
  it with the original event JSON, and forwards its native Codex stdout and exit status unchanged.
- Do not alter or bypass Codex's trust state. The manifest tells the user to review it through
  `/hooks`; installation alone does not imply activation.

This downstream target repairs renderer behavior when a caller already supplies hooks. It does not
pretend to complete the missing upstream template/CLI/Studio declaration plumbing or package helper
implementations that MetaHarness does not currently ship.

## Retirement

Issue state or a version string is not sufficient. A future published candidate must behaviorally
prove all three upstream generation paths, strict current-Codex parsing, supported/unsupported
declaration handling, inner matcher preservation, subdirectory and native Windows execution,
packaged handler resolution, manifest/witness coverage, and trust messaging. Until such a candidate
exists, no retirement predicate is guessed.

## Consequences

### Positive

- A supplied Codex hook declaration can no longer be silently discarded by either installed runtime
  renderer.
- Policy carried inside a Claude-style matcher is not weakened to a broad tool-only hook.
- An npm/npx refresh re-baselines against the new vendor bytes and the monitor reapplies the target.
- Uninstall restores each authenticated package file byte for byte.

### Negative

- A generated handler must exist under `.codex/helpers`; absence is a loud runtime failure. Full
  helper packaging remains upstream work.
- Existing MetaHarness CLI/Studio templates declare no hooks, so this patch alone does not invent
  lifecycle behavior for those templates.

## Links

- [MetaHarness #168](https://github.com/ruvnet/metaharness/issues/168)
- [Codex hooks](https://learn.chatgpt.com/codex/hooks)
- [ADR-001](ADR-001-source-patch-by-literal-anchors.md)
- [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md)
- [ADR-016](ADR-016-tests-are-behavioural-and-mutation-tested.md)
- [ADR-020](ADR-020-plugin-targets-compose.md)
