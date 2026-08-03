# ADR-016: Tests are behavioural and mutation-tested; a green suite must be able to fail

**Status**: accepted
**Date**: 2026-07-14
**Updated**: 2026-08-01. Rendered-artifact checks now pair literal replacement-token probes with
structural output assertions. Ownership hashes, idempotency, exact restore, and loose substring checks all
stayed green while JavaScript expanded Markdown's dollar-plus-backtick sequence and duplicated part of a skill.
Brain #102/#103 adds a host-simulated denial test: a sentinel after a raw managed-store command must
remain absent, while prose, searches, comments, unmanaged stores, and non-Bash events must still pass.
Its diagnostic test proves row-count-only output, unchanged DB/WAL/SHM snapshots, bounded arguments,
private receipts, and resistance to SQL-literal injection.
**Deciders**: Henrik Pettersen
**Tags**: testing, core, safety

## Context

This package patches compiled `dist` output, so there is no upstream type check and no upstream test suite to
lean on. The tests carry all of it.

And the failure mode that matters is not a red suite. It is a GREEN one that asserts nothing. This has
happened, repeatedly, and every instance was caught only by deliberately breaking the code:

- The property fuzzer's oracle was `state.json`, so 480 steps a run asserted "the files agree with the
  bookkeeping" and never that either agrees with what the user typed. A CLI mutated to uninstall targets the
  user never named passed all 60 sequences.
- Six tests asserted a patch by grepping for the injected STRING. A resolver returning the wrong directory
  would have passed all of them.
- Three tests of the `verify-interface` gate passed because upstream's regex-based JSON parser truncated the
  command at the first quote, so the gate never saw it. They were green because it was blind.
- A test of the monitor destroyed the REAL monitor, because `paths.mjs` reads the sandbox env at module load
  and static imports hoist above the assignment.

## Decision

- **Behavioural, not textual.** Drive the real thing. The `verify-interface` suite feeds the real script the
  real JSON payload on stdin; the resolver is EXECUTED, not grepped.
- **Mutation-test every guard.** Remove the guard, confirm the test fails, and say so. A test that cannot
  fail is worth nothing, and this is the only way to know.
- **The oracle is what the user typed**, never the code under test.
- **Assert the feature still works, not only that the bug is gone.** A gate tightened until it matches
  NOTHING would sail through every false-positive test.
- **Sandbox everything**, before any lib module is imported, or the suite operates on the developer's real
  machine.
- **Never silently truncate coverage.** If a bound is applied, say so.
- **Treat inserted vendor text as literal bytes.** Probe JavaScript replacement tokens directly and assert
  the rendered structure; marker presence and selected substrings do not prove that a transform is correct.
- **Test the host contract, not only the handler.** A valid denial must prevent a following sentinel from
  executing in both host envelopes; empty allow output is different from malformed success JSON.

## Consequences

### Positive

- Six vacuous tests were found and fixed, each by mutation.
- The real bugs found by writing the test, rather than reading the code, include our own `state.json` having
  ruflo's #2621 (last-writer-wins dropping writes) in the one file that decides what stays patched.

### Negative

- Mutation testing is manual and slow. It is done at the point a guard is written, not continuously.

### Neutral

- The suite runs the seven groups in parallel (each takes its own sandbox), which turns the sum into the max.
  Failure propagation is itself mutation-tested.

## Links

- [ADR-001](ADR-001-source-patch-by-literal-anchors.md), [ADR-028](ADR-028-managed-agentdb-interface-boundary.md)
- `test/`, `scripts/run-tests.sh`
