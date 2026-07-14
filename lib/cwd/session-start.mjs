#!/usr/bin/env node
// SessionStart hook body (runs from the stable copy at
// ~/.ruflo-source-patch/lib/cwd/session-start.mjs).
//
// Re-applies EXACTLY the installed target set (state.json) to any copy fetched since the
// last session — CLI patch targets and ruflo-adr plugin patches alike. It never re-patches
// a target the user uninstalled; that is the whole point of per-target install/uninstall.
//
// SILENT ON SUCCESS, LOUD ON TROUBLE. It used to be silent unconditionally, which meant a
// patch that had stopped applying — because upstream reworded an anchor, or replaced the
// file wholesale — produced NO signal anywhere a human actually looks. The monitor writes
// it to ~/.ruflo-source-patch/monitor.log, and nobody reads a log file. A patch that
// silently does nothing while `status` still reports "installed" is precisely the failure
// this project exists to prevent; it must not be how the project itself fails.
//
// Claude Code surfaces a SessionStart hook's stdout, so this is the one channel that
// reliably reaches you. It stays quiet in the steady state (which is nearly always) and
// speaks only when an edit could not be applied, a vendor file changed under us, or a file
// was skipped.

import { reapply, problemsIn } from './commands.mjs';
import { recordProblems, rebaselineGuidance, isRetirement } from './problems.mjs';

// Drain stdin (Claude Code pipes the hook event JSON) so we don't hang.
try { process.stdin.resume(); process.stdin.on('data', () => {}); } catch { /* ignore */ }

try {
  const r = reapply();
  const problems = r ? problemsIn(r) : [];

  // A RETIREMENT gets its own, calm channel — announced ONCE and never again, because retirement is
  // terminal: the target is out of state.json, so the next session re-applies nothing and says nothing.
  // That is the entire point. The old behaviour was a `skip:upstream-owns-it` warning that fired every
  // single session and could never resolve itself, and a banner that always cries wolf is a banner
  // people stop reading.
  const retirements = (r?.log ?? []).filter(isRetirement);
  if (retirements.length) {
    console.log([
      '[ruflo-source-patch] a patch RETIRED itself — upstream now does this, and the replacement was verified HERE:',
      ...retirements.map((l) => `  ${l}`),
    ].join('\n'));
  }

  // Keep the shared record in step with what we just found — including CLEARING it when a
  // problem is gone, so the prompt notifier doesn't keep warning about something fixed.
  recordProblems(problems);

  if (problems.length) {
    const lines = [
      '[ruflo-source-patch] ATTENTION — a patch may no longer be doing anything:',
      ...problems.slice(0, 8).map((p) => `  ${p}`),
    ];
    if (problems.length > 8) lines.push(`  … and ${problems.length - 8} more`);
    lines.push('  Check:  npx github:sparkling/ruflo-source-patch monitor check');
    lines.push('  Detail: npx github:sparkling/ruflo-source-patch <target> status');
    // A re-baseline is the one failure mode with no automated guard, so it gets INSTRUCTIONS rather
    // than a warning — and the reader of this text is usually an agent, which can act on them.
    lines.push(...rebaselineGuidance(problems));
    // stdout, not stderr: Claude Code surfaces a hook's stdout back to the user.
    console.log(lines.join('\n'));
  }
} catch { /* best-effort: never block session startup */ }

// NO update check here, deliberately. It belongs on the MONITOR TICK (see update-check.mjs): this hook
// fires only when a session STARTS, and sessions run for days — so an update gated on it would leave a
// patch that upstream has since invalidated re-applying itself, every 5 minutes, for a week. That is the
// exact gap the monitor exists to close, and putting the update here would reopen it.

// ─── THE LEAK DETECTOR ───────────────────────────────────────────────────────
//
// The `state` target anchors the cwd-dependent paths we can FIND. It cannot be complete, and pretending
// otherwise is the failure this package exists to hunt. cwd-dependence takes three syntactic forms:
//
//   path.join(process.cwd(), '.claude-flow', …)   62 sites — a literal search finds these
//   resolve('.claude-flow/data')                  11 sites — one-arg resolve is ALREADY cwd-relative;
//                                                            there is no `process.cwd()` token to find
//   applyChampion(process.cwd())                  87 sites — the callee builds the path from a parameter
//
// You cannot enumerate that soundly by searching. So do not try to: OBSERVE THE RESULT INSTEAD. A
// `.claude-flow`/`.swarm` in a subdirectory is, by definition, an anchor that leaked — whatever form it
// took. This is the same reasoning that made the fork wire a write-path guard rather than trust a grep,
// moved to the one place we can put it without touching vendor code.
//
// It only ever REPORTS. Deleting a stray dir is what `cleanup` does, and that is a human's call: those
// directories hold orphaned neural checkpoints and split memory.db files, and discarding the only copy
// of someone's learning state is not a decision a hook gets to make.
try {
  const { strayStateDirs } = await import('./cleanup.mjs');
  const strays = strayStateDirs(process.cwd());
  if (strays.length) {
    const rel = strays.map((d) => d.replace(`${process.cwd()}/`, ''));
    console.log([
      `[ruflo-source-patch] ${strays.length} STRAY state dir(s) — an unpatched cwd anchor is still leaking:`,
      ...rel.slice(0, 5).map((d) => `  ${d}`),
      ...(rel.length > 5 ? [`  … and ${rel.length - 5} more`] : []),
      '  These hold state written from a drifted cwd, which nothing will ever read again (ruvnet/ruflo#2633).',
      '  Inspect them before removing: they may hold the only copy of a neural checkpoint or a split memory.db.',
      '  Then: npx github:sparkling/ruflo-source-patch cleanup',
    ].join('\n'));
  }
} catch { /* a detector must never break the start of a session */ }

setTimeout(() => process.exit(0), 4000);
process.exit(0);
