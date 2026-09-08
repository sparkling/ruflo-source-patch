# ADR-023: The memory target refuses torn writes and restarts stale writers

**Status**: Implemented
**Date**: 2026-07-17
**Updated**: 2026-09-08. Ruflo 3.38.12 now supplies the basic native #2878 shared lock for ordinary
sql.js writers. This target remains for the integrity gate, raw WAL refusal, stronger outer lock, and
stale-process recovery. Writer discovery now shares current runnable-root coverage: npx, authenticated
global launchers on PATH, custom prefixes without npm, the public `.bin/ruflo` wrapper, and its nested
or hoisted CLI. A pre-patch writer is never claimed fully covered until those launch shapes pass mutation
tests. A live incident proved that an unattended monitor cannot safely kill an MCP stdio child:
11 clients became permanently `Transport closed` until host-local reconnect. Automatic recovery is
therefore daemon-only; stale MCP clients are reported and require a controlled host reconnect.
Supersedes: none
Related: ADR-006 (fail-closed serialization and WAL refusal), ADR-013 (cleanup's guarded kill), ADR-021 (the monitor acts on its own tick)

## Context

`semantic-product-mock/.swarm/memory.db` was found corrupt: `integrity_check` failing, roughly
87 entries lost, 809 rows swept into `lost_and_found`. The `memory` target (ADR-006) exists to
prevent exactly this, and it was installed. So the first job was to explain why it did not hold,
and the honest answer reshaped the fix.

Three facts, each verified against the live tree rather than assumed:

1. **The current whole-file flush is already atomic.** `storeEntry` writes through
   `writeFileRestricted`, which delegates to `writeFileAtomic` (temp file, `fsync`, `rename`).
   Two sql.js writers now produce last-writer-wins, never a torn image. Upstream closed #2584.
2. **Both writers share the guarded path.** The MCP `memory_store` tool destructures `storeEntry`
   from a live-binding dynamic import, so it gets the `__rufloGuard`-wrapped function, the same
   lock the CLI takes. Cooperating patched processes are serialised.
3. **Neither of those covers the case that actually corrupted the store.** A whole-file flush
   landing on a database that is ALREADY torn does not tear it further, it OVERWRITES the damage.
   sql.js opens a truncated image without error, loses the missing pages, and the mutator
   re-exports the shrunken image. "no such table: memory_entries" on a multi-megabyte file is the
   measured symptom. And the writer that tore it in the first place is one the lock can never
   reach: a long-running MCP server or daemon that loaded `memory-initializer.js` BEFORE the patch,
   or that runs a different npx cache copy the patch never touched. It keeps flushing the old,
   unguarded, pre-atomic way from memory until it is restarted. This machine had two `@claude-flow/cli`
   cache copies live at once, which is precisely how a process ends up running code the patch missed.

The gap is not more locking. It is (a) a whole-file flush trusting a torn file, and (b) a process
that never loaded the patch and so no source edit can protect. A failure that looks like success,
which is the one outcome this package exists to forbid.

## Decision

Two additions to the `memory` target, chosen with the user over the alternatives (detect-and-warn
only, or a full quick_check on every write).

**The integrity gate (at the whole-image boundary).** The `integrityGate` fragment defines
`__rufloIntegrityCheck`, and `writeFileAtomic` invokes it immediately before publishing a raw
whole-file image. It reads at most 100 bytes and verifies the on-disk SQLite header is
self-consistent: the magic string, a valid power-of-two page size, and, when the in-header page
count is authoritative (the change counter equals the version-valid-for number, per the SQLite
file format), that `page_size * page_count` equals the file size. When it is not authoritative, it
falls back to the weaker but always-true invariant that a complete SQLite file is a whole number of
pages. A torn or truncated image fails and the mutator THROWS rather than overwriting the damage.
Missing and zero-byte files remain legitimate initialization inputs. Every existing non-empty
`.db`, including `ensureSchemaColumns` output, must pass; inability to inspect it also fails closed.
This fixes the earlier exemption, which was unsound because schema repair itself exports and renames
a whole database image. The check is pure buffer, with no engine load or second image.

The boundary first refuses any live `-wal`/`-shm` sidecar under ADR-006. That means the integrity
probe never blesses a stale main file while another native connection owns uncheckpointed frames.
The EOF wrapper only supplies serialization and pre-unlink protection for force initialization;
it does not run an image gate on a successful transactional AgentDB bridge call.

The same EOF wrapper conditionally guards native `purgeNamespace`. In Ruflo 3.38.12 the upstream
`withMemoryDbLock()` now covers purge and ordinary sql.js writers. The outer `.rsp-lock` remains for
the stricter failure and ownership semantics in ADR-006, but #2666 retirement may rely on the complete
native writer set without mistaking a purge-only implementation for success.

**The stale-writer guard (outside the patched module).** A new `lib/cwd/stale-writer.mjs` detects
running ruflo workers writing memory.db with old code. It resolves a worker's `@claude-flow/cli` root
from the daemon's direct `.../node_modules/@claude-flow/cli/bin/cli.js`, the plugin MCP client's
`.../node_modules/.bin/cli` symlink, and the public `.../node_modules/.bin/ruflo` wrapper used by
`npx ruflo@latest mcp start`. The Ruflo-wrapper path validates both package identities, then mirrors
the wrapper's bounded walk to a nested or hoisted CLI. Matching only the first two shapes was a live
blind spot: old project MCP clients remained invisible even though their on-disk CLI had been patched.
The machine-wide `ps` read has a bounded 64 MB buffer: 8 MB was measured failing on a 12.5 MB argv
stream and had been caught as an empty list, turning detector failure into a false healthy zero.

The action is decided by whether a restart would actually FIX the process at all, and separately, how
loud the warning must be when it does:

- **A `pre-patch` daemon** (the copy on disk IS patched; the process predates it) is killed and
  respawns patched on next use.
- **A `pre-patch` MCP client** is detected and reported but never signalled by the monitor. The
  8 September incident proved the boundary at machine scale: a scheduled repair rewrote 146 files,
  killed 11 live MCP children, and every owning session retained a dead `Transport closed` channel.
  The detached monitor cannot perform the required reconnect inside each Codex/Claude host. A
  controlled host reconnect is therefore the only safe transition to the new bytes.
- **An `unpatched` writer** (daemon or MCP client) is NEVER auto-killed, regardless of the above: the
  copy lacks the current fail-closed lock because the patch could not be applied (anchor drift), or
  it still carries the older fail-open wrapper. ANY respawn reads those same unsafe bytes and gains
  nothing. That is patch drift, fixed by re-anchoring (which `runOnce` attempts and the drift
  machinery reports), not by killing a process for no benefit.

Following ADR-021's split (the hook REPORTS, the monitor ACTS), the SessionStart hook warns about every
stale writer; the monitor tick restarts only eligible daemons and merges a controlled-reconnect warning
for stale MCP clients into the shared problem feed. `monitor run` follows the same boundary. Daemon signalling is guarded to
ADR-013's cleanup bar: a process is only ever signalled when we can positively resolve its argv to an
`@claude-flow/cli` install. The detector is inert unless the `memory` target is installed, and
`RSP_NO_STALE_WRITER_KILL` disables the kill while keeping detection.

Installed-root discovery must match the patch engine. The guard resolves direct CLI argv, `.bin/cli`,
verified `.bin/ruflo`, and launcher-discovered custom global prefixes. A wrapper is followed only after
its package identity is proven, with a bounded walk to a nested or hoisted `@claude-flow/cli`. Failure to
resolve remains visible as unpatched/unknown and never authorizes a signal.

## Consequences

### Positive

- A whole-file flush can no longer silently overwrite a torn store: the write is refused, loudly,
  and the corrupt image is left untouched for recovery. The measured `no such table` data-loss path
  is closed at the last moment before the write.
- Every positively resolved stale writer is detected. Eligible daemons are forced onto patched code;
  MCP clients remain alive until their owning host can reconnect them deliberately.
- A scheduled repair cannot silently destroy every live Ruflo tool transport on the machine.
- The kill reuses cleanup's positive-identification discipline and never signals a process it has not
  resolved to a ruflo memory writer.

### Negative

- A pre-patch MCP client can continue running older in-memory code until its owning host reconnects.
  The monitor reports that condition rather than pretending it forced convergence.
- An `unpatched` writer is only warned about, never killed, because a restart would loop on the same
  unpatched copy for no benefit. The real fix there is re-anchoring the patch, surfaced by the drift
  machinery.
- `recoverStaleWriters` scans machine-wide in production, not per project. The test harness sets
  `RSP_NO_STALE_WRITER_KILL` globally; the stale-writer suite clears it only while passing an explicit
  PID allowlist containing its own children, so a live-process regression cannot signal another test
  or a user's real MCP session.

### Neutral

- The integrity gate reads a header on every raw whole-image write. The cost is one `open`, one
  100-byte `read`, one `close`; negligible against the flush it precedes. Native bridge writes do
  not cross this boundary.
- The mtime-versus-start signal flags a patched-but-old process as stale. If it is wrong, the cost is
  one restart (respawn or next-session reload), never data loss, so the guard leans that way on
  purpose: a missed stale writer corrupts, a spurious restart merely reloads.

## Links

- ruvnet/ruflo#2584 (the atomic-flush close-out this builds past)
- ruvnet/ruflo#2878 (ordinary-writer serialization and fail-closed locking, ADR-006)
- ruvnet/ruflo#2621 (historical lost-update report)
- The corruption analysis: `semantic-product-mock/.swarm/backups/memory-CORRUPT-preswap-*.db`
