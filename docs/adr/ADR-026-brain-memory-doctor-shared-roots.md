# ADR-026: Brain memory-doctor scans the machine it describes

**Status**: Implemented
**Date**: 2026-08-01
**Updated**: 2026-08-01. Added the issue-backed `brain-memory-doctor-roots` target for
stuinfla/ruvnet-brain#81 and installed it across bounded npm/npx, marketplace, and persistent
Console-runtime copies.
**Deciders**: Henrik Pettersen
**Tags**: brain, agentdb, discovery, correctness, patch-target

## Context

Brain #19 fixed the Console's fleet scan by enumerating common project roots and the configured
`scanRoots` override. The exported `memory-doctor.mjs` discovery function did not converge with that
fix: `findStores()` still defaulted to `~/Code`, and the standalone CLI called it with no argument.

On this machine `findStores()` returned zero stores while `findStores('~/source/hm')` returned 13.
The underlying `diagnose(db)` implementation is correct for an exact path; only the default discovery
layer turned “the legacy root is absent” into a confident machine-wide zero.

The patch repository may repair installed package bytes, but it must not replace Brain's updater,
immutable version store, cache, MCP, hooks, or memory runtime. This defect is therefore a small
read-only source transform, not a local discovery service or a parallel Brain implementation.

## Decision

Add the atomic composed target `brain-memory-doctor-roots`, backed by upstream issue #81.

- Patch only `scripts/memory-doctor.mjs` in bounded installed Brain surfaces.
- Preserve `findStores(explicitRoot)` for scoped callers.
- With no explicit root, scan the same common directories as the Console: `Code`, `code`, `src`,
  `source`, `projects`, `dev`, and `work`.
- Honor the existing `scanRoots` setting in `~/.claude/ruvnet-brain/config.json`, with absolute paths
  accepted and relative paths resolved below the user's home.
- Validate configured values, canonicalize existing directory roots, and de-duplicate both roots and
  exact database paths before diagnosis. A non-empty override with no valid existing directory fails
  loudly instead of producing a confident zero. Keep the two upstream known-extra stores unchanged,
  including their existing presence for explicit-root callers.
- Apply by exact literal anchors and refuse any partial or ambiguous transform atomically.
- Re-apply through the existing SessionStart/monitor desired-state system; uninstall restores the
  exact vendor bytes from the shared pristine.

The target does not alter `diagnose()`, any AgentDB file, or any Brain update/download mechanism.

## Verification

The executable regression uses an isolated HOME with no `~/Code`, real fixture stores under
`~/source/hm` and `~/work`, a configured custom root, an ignored `node_modules` store, and the two
known-extra semantics. It proves no-argument and explicit-root behavior, bounded installed-copy
discovery, atomic refusal on anchor drift, a mutation that restores the false-zero bug, CLI lifecycle,
and byte-exact uninstall.

## Retirement

Retire only after a released upstream candidate proves all of the following against active installed
bytes:

1. standalone no-argument discovery finds stores under common and configured roots without `~/Code`;
2. explicit-root callers remain deterministic;
3. Console and CLI share one discovery policy rather than duplicating it;
4. malformed configuration and duplicate roots cannot produce a false healthy zero; and
5. removing this target restores vendor bytes and the native behavior still passes the executable
   regression.

Issue closure or a version string alone is insufficient under ADR-014.

## Links

- Upstream: [stuinfla/ruvnet-brain#81](https://github.com/stuinfla/ruvnet-brain/issues/81)
- Predecessor: [stuinfla/ruvnet-brain#19](https://github.com/stuinfla/ruvnet-brain/issues/19)
- [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md)
- [ADR-020](ADR-020-plugin-targets-compose.md)
- `lib/brain-memory-doctor-roots/patcher.mjs`
- `test/brain-memory-doctor-roots.mjs`
