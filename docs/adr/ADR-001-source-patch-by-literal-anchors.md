# ADR-001: Source-patch the installed library by exact literal anchors, rebuilt from pristine

**Status**: accepted
**Date**: 2026-07-14
**Deciders**: Henrik Pettersen
**Tags**: patching, safety, core

## Context

`ruflo` / `@claude-flow/cli` ships bugs that bite every session, and upstream fixes land on their own
schedule. Waiting is not free: the daemon proliferation alone cost measured tokens continuously, and the
cwd anchoring silently loses learning state. So the installed library has to be corrected locally.

Every mechanism for doing that is dangerous in a different way. Line numbers and byte offsets drift the
moment upstream reformats. Regex edits match text the author never intended. In-place edits cannot be
composed: `memory/memory-initializer.js` is patched by two targets, so uninstalling one would have to
un-apply its edits while leaving the other's intact.

And the failure that matters most is not a broken patch. It is a patch that silently stops applying while
`status` still reports it as installed.

## Decision

Patch by **exact literal find/replace**: `src.includes(find)` then `split(find).join(replace)`. Never line
numbers, never offsets, never regex against vendor code.

Anchor count is the safety rule:

- exactly 1 occurrence: apply
- 0 occurrences: `skip:anchor-not-found`, reported loudly, nothing written
- more than 1: `skip:ambiguous-anchor`, refuse. An ambiguous anchor is not a licence to guess; it means
  upstream restructured and a human must look
- more than 1 with an explicit `all: true`: apply to all, deliberately (e.g. `process.cwd()` at several
  call sites in one file)

An edit may also be marked `optional`, which makes zero occurrences of an `all` edit a deliberate no-op
rather than a skip, for a file that legitimately does not use that anchor. Uniqueness and the ambiguity
refusal are unchanged, and an entry of only optional edits must still match at least one of them. See
ADR-017.

Every apply **rebuilds the file from a pristine backup**: `pristine (.rsp-backup) -> fragments -> edits`.
The file is always exactly "pristine plus the entries currently asked for", which makes install and
uninstall of any subset trivially correct and idempotent, and lets a stale patched version be replaced
wholesale rather than layered on.

Interdependent edits are **atomic**. Bash ERE has no non-capturing group, so a regex edit shifts the
capture indices its readers use; a partial apply would leave a gate reading the wrong group. On a partial
match, write nothing.

## Consequences

### Positive

- A patch that no longer applies is LOUD, never silent. The one thing we refuse to ship is a target that
  reports `installed` while doing nothing.
- Upstream reformatting breaks an anchor into a visible skip, not a corrupted file.
- Targets compose: several may patch the same file and each can be removed independently.
- A superseded patch version is replaced, not stacked, because every apply starts from pristine.

### Negative

- An anchor that still matches, matches uniquely, and no longer MEANS the same thing is the one failure
  mode with no automated guard. Only a human reading the re-baselined diff can catch it.
- Literal anchors are brittle by design. Every upstream release may turn some into skips, which is work.
- The entry table must be maintained by hand; it cannot be generated from the vendor source.

### Neutral

- Patching compiled `dist` output rather than source means no type checking and no test suite from
  upstream. The tests here have to carry that weight instead (see ADR-016).

## Links

- [ADR-016](ADR-016-tests-are-behavioural-and-mutation-tested.md)
- [ADR-017](ADR-017-optional-anchors-and-the-hidden-alias-layout.md)
- `lib/cwd/patch-library.mjs`
