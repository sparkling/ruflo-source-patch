# ADR-025: A detached Brain Console needs an owned runtime identity

**Status**: Implemented
**Date**: 2026-08-01
**Updated**: 2026-08-15. Published Brain 4.0.36 natively supplies whole-runtime identity, receipts,
the runtime API, token-bound shutdown, stale/foreign classification, and detached-process replacement.
The local target recognizes and preserves that launcher. It remains live only because pristine 4.0.36
doctor reads a host-convergence receipt instead of independently comparing candidate bytes, persistent
runtime, receipt, live endpoint, PID, and API identity as #79 requires. A separately staged 4.0.52-dev
host copy is not treated as published retirement evidence.
**Deciders**: Henrik Pettersen
**Tags**: brain, lifecycle, security, patching

## Context

RuvNet Brain launches its Console as a background Node process. Updating the script changes the file,
not the route table already loaded into that process. The launcher nevertheless accepted any `GET /`
response containing “RuvNet Brain” as current. On this machine a 18 July process served current static
assets with an old in-memory router, so the current UI called `/api/capabilities` and received 404.
Restarting Codex could not help: the Console had PPID 1 and was no longer owned by a host session.

The original native `--update` path also omitted `installConsoleRuntime()`. PR #110 replaced the copy
list and one-file hash with one whole-runtime surface and native replacement transaction. That native
launcher remains present in 4.0.36. This patch
repository does not modify that updater, activation, cache, Stable Spine, immutable version store, or
`active.json`.

## Decision

`brain-console-lifecycle` is an atomic composed target over executable `onboarding-console.mjs` and
read-only `bin/install.mjs` copies only. On the current release the native launcher satisfies the first
surface without an edit; the doctor surface remains patched.

- The patcher stamps an immutable vendor SHA-256 plus patch-protocol revision into each transformed
  Console. A process never derives its advertised generation by rereading a path that an update may have
  replaced after module load.
- A successful bind writes a mode-0600 receipt under the mode-0700
  `~/.cache/ruvnet-brain/console-control/instances/` directory. Receipts are keyed by SHA-256 of the exact
  canonical launch cwd, so concurrent projects cannot overwrite or stop each other.
- `GET /api/runtime` exposes only non-secret identity fields. It omits the control token, cwd, receipt
  path, and script path. `POST /api/runtime/shutdown` requires both the random instance ID and a separate
  256-bit control token, compared in constant time.
- Launch and uninstall share one bounded, owner-safe lifecycle lock. A compatible receipt/live pair is
  reused. A receipt-proven stale generation is gracefully stopped and replaced. A legacy or foreign
  listener is never signalled; the current Console binds a free port and persists that port instead.
- Uninstall first authenticates and stops every receipt-proven live instance while the control endpoint
  still exists. Any invalid, unreachable, or mismatched receipt aborts restoration and leaves the target
  tracked.
- Doctor is read-only. It compares persistent stamped bytes, receipts, and live identities, and fails on
  missing, invalid, stale, legacy, or mixed generations. It does not invoke or alter the updater.

The target deliberately does not kill by PID, port, process title, path, or branding. The one legacy
process involved in this incident may be stopped only as a separately verified one-off operation.

## Consequences

### Positive

- Current bytes cannot silently reuse an incompatible patched Console generation.
- Repeated launches reuse the exact current per-project instance without process proliferation.
- Foreign services and unowned legacy Consoles survive; authenticated ownership, not a port number,
  authorizes replacement.
- The regression suite executes a real A-process/B-bytes replacement and proves receipt permissions,
  secret redaction, safe foreign-port fallback, composition with #77, and owned-instance uninstall.

### Negative

- Issue closure was not sufficient retirement evidence: the native lifecycle is delivered, but doctor
  still trusts `host-convergence.json` without a live identity probe. The narrowed overlay remains until
  the health command proves the same boundary as the launcher.
- A four-second lifecycle-lock timeout and strict receipt validation bias toward a loud refusal instead of
  guessing during contention or corruption.

## Retirement proof

Retire only after a released upstream candidate passes the remaining #79 behavior matrix: doctor must
compare candidate bytes, persistent runtime, receipt, live endpoint, PID, and API identity and fail on a
deliberately stale or mixed instance. The native launcher/update transaction already passes its separate
replacement proof. Issue closure or a version marker is not proof.

## Links

- [ADR-014](ADR-014-targets-retire-themselves-on-a-local-proof.md), [ADR-020](ADR-020-plugin-targets-compose.md)
- [Brain #77](https://github.com/stuinfla/ruvnet-brain/issues/77), [Brain #79](https://github.com/stuinfla/ruvnet-brain/issues/79)
