# ADR-023: The memory target refuses torn writes and restarts stale writers

**Status**: accepted
Date: 2026-07-17
Supersedes: none
Related: ADR-006 (the write lock and WAL-coherent reads), ADR-013 (cleanup's guarded kill), ADR-021 (the monitor acts on its own tick)

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

**The integrity gate (in the patched module).** A new `integrityGate` fragment defines
`__rufloIntegrityCheck`, and the EOF wrapper runs it under the write lock, just before each write
mutator flushes. It reads at most 100 bytes and verifies the on-disk SQLite header is
self-consistent: the magic string, a valid power-of-two page size, and, when the in-header page
count is authoritative (the change counter equals the version-valid-for number, per the SQLite
file format), that `page_size * page_count` equals the file size. When it is not authoritative, it
falls back to the weaker but always-true invariant that a complete SQLite file is a whole number of
pages. A torn or truncated image fails and the mutator THROWS rather than overwriting the damage.
`ensureSchemaColumns`, the init and repair path, is deliberately left ungated: it must be allowed to
run on a fresh or half-built database, so gating it would block the recovery that heals a torn DB.
The check is pure buffer, no engine load, no second read of the image.

**The stale-writer guard (outside the patched module).** A new `lib/cwd/stale-writer.mjs` detects
running ruflo workers writing memory.db with old code. It resolves a worker's `@claude-flow/cli` root
from its argv in BOTH shapes: the daemon's direct `.../node_modules/@claude-flow/cli/bin/cli.js`, and,
crucially, the plugin MCP client's `.../node_modules/.bin/cli` SYMLINK launched by
`npm exec @claude-flow/cli` with no subcommand. Matching only the first shape was a real blind spot: a
live box reported zero stale writers while five plugin MCP clients were running pre-patch.

The action is decided by whether a restart would actually FIX the process at all, and separately, how
loud the warning must be when it does:

- **A `pre-patch` writer** (the copy on disk IS patched; the process predates it) is killed, daemon or
  MCP client alike. A daemon respawns invisibly on next use. An MCP client does not: reloading one onto
  patched code needs BOTH steps, validated live against this package's own session (2026-07-17): kill
  the pid, THEN `/mcp` -> Reconnect (or `/reload-plugins` for a plugin server) inside that exact
  session. Neither step alone works: `/mcp` -> Reconnect on a still-alive stale process just
  re-attaches to that same stale process (confirmed live); a kill with no follow-up does not self-heal
  either, confirmed by killing this session's own MCP client and immediately retrying a tool call with
  no other action, which failed instantly with no on-demand respawn, matching Claude Code's own docs
  ("stdio servers... are not reconnected automatically"). The monitor cannot perform step 2 (it is
  bound to that session's live UI), so it kills anyway and pushes a loud, specific warning into the
  shared problem feed (`addProblems`, `lib/cwd/problems.mjs`) naming the killed pid(s) and the exact
  two-step fix, surfaced on the user's very next prompt in ANY session. **This is a deliberate,
  user-directed trade**: automatically forcing fresh code onto every writer, at the cost of an MCP
  client outage the user must notice and manually clear, chosen over the safer default (daemons only,
  MCP clients merely warned) this ADR shipped with initially.
- **An `unpatched` writer** (daemon or MCP client) is NEVER auto-killed, regardless of the above: the
  copy has no lock because the patch could not be applied (anchor drift), so ANY respawn, whether a
  daemon or an MCP client after its manual reconnect, reads the same unpatched copy and gains nothing.
  That is patch drift, fixed by re-anchoring (which `runOnce` attempts and the drift machinery
  reports), not by killing a process for no benefit.

Following ADR-021's split (the hook REPORTS, the monitor ACTS), the SessionStart hook warns about every
stale writer, flagging which pre-patch MCP clients WILL be killed; the monitor tick kills every
pre-patch writer and, for each killed MCP client, merges a loud warning into the shared problem feed;
`monitor run` does the same on demand, visible directly in that terminal. The kill is guarded to
ADR-013's cleanup bar: a process is only ever signalled when we can positively resolve its argv to an
`@claude-flow/cli` install. The detector is inert unless the `memory` target is installed, and
`RSP_NO_STALE_WRITER_KILL` disables the kill while keeping detection.

## Consequences

### Positive

- A whole-file flush can no longer silently overwrite a torn store: the write is refused, loudly,
  and the corrupt image is left untouched for recovery. The measured `no such table` data-loss path
  is closed at the last moment before the write.
- Every pre-patch writer, daemon or MCP client, is forced onto patched code on the next monitor tick,
  and the `.bin/cli` resolution means the plugin MCP clients (the common case) are actually seen, not
  skipped.
- The daemon half of the kill disrupts no live session (it respawns on next use); the MCP-client half
  is paired with a warning routed through the shared problem feed, reaching the user's next prompt in
  any session rather than depending on them noticing a dead tool call first.
- The kill reuses cleanup's positive-identification discipline and never signals a process it has not
  resolved to a ruflo memory writer.

### Negative

- Killing a pre-patch MCP client is genuinely destructive: ruflo MCP access in that session is dead
  until the user manually runs `/mcp` -> Reconnect (or `/reload-plugins`) THERE, and nothing brings it
  back on its own. This is a deliberate trade the user chose (forced freshness over avoiding the
  outage), not a side effect discovered after the fact, but it means every affected session sees a
  real capability loss until the user acts.
- An `unpatched` writer is only warned about, never killed, because a restart would loop on the same
  unpatched copy for no benefit. The real fix there is re-anchoring the patch, surfaced by the drift
  machinery.
- `recoverStaleWriters` scans machine-wide, not per project, so a tick-exercising test would kill
  another parallel test's fakes. The test harness sets `RSP_NO_STALE_WRITER_KILL` globally and the
  stale-writer suite clears it in-process to exercise the real kill against only its own fakes.

### Neutral

- The integrity gate reads a header on every write mutation. The cost is one `open`, one 100-byte
  `read`, one `close`; negligible against the whole-file flush it precedes.
- The mtime-versus-start signal flags a patched-but-old process as stale. If it is wrong, the cost is
  one restart (respawn or next-session reload), never data loss, so the guard leans that way on
  purpose: a missed stale writer corrupts, a spurious restart merely reloads.

## Links

- ruvnet/ruflo#2584 (the atomic-flush close-out this builds past)
- ruvnet/ruflo#2621 (the write lock, ADR-006)
- The corruption analysis: `semantic-product-mock/.swarm/backups/memory-CORRUPT-preswap-*.db`
