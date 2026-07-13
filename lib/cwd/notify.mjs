#!/usr/bin/env node
// UserPromptSubmit hook body — the timely half of the warning.
//
// The SessionStart hook only speaks when a session STARTS. A ruflo version can land in the
// npx cache mid-session (3.26.1 did exactly that, mid-session, and silently disabled the
// cwd/daemon-autostart patch), so a break could sit unannounced for hours.
//
// This runs on every prompt and does almost nothing: read one small file, usually absent.
// Claude Code surfaces a UserPromptSubmit hook's stdout, so this reaches you where you are
// already looking. Rate-limited in problems.mjs — an unchanged problem re-announces at most
// every 30 minutes, a NEW one announces at once.
//
// It only REPORTS. Repair is the monitor's job; a hook on the prompt path must stay cheap
// and must never block you.

import { takeProblemsToAnnounce, takeLiveToAnnounce } from './problems.mjs';
import { monitorHealthProblems } from './health.mjs';

try { process.stdin.resume(); process.stdin.on('data', () => {}); } catch { /* ignore */ }

try {
  const problems = [
    // What the monitor found and wrote down.
    ...takeProblemsToAnnounce(),
    // ...and whether the monitor is alive at all. It cannot leave a note about being dead,
    // so this one is worked out here, from a heartbeat and two path checks. Without it, a
    // dead monitor is indistinguishable from a healthy system: both are silent.
    ...takeLiveToAnnounce('monitor', monitorHealthProblems()),
  ];

  if (problems.length) {
    const lines = [
      '[ruflo-source-patch] ATTENTION — a patch may no longer be doing anything:',
      ...problems.slice(0, 6).map((p) => `  ${p}`),
    ];
    if (problems.length > 6) lines.push(`  … and ${problems.length - 6} more`);
    lines.push('  Check: npx github:sparkling/ruflo-source-patch monitor check');
    console.log(lines.join('\n'));
  }
} catch { /* best-effort: never block a prompt */ }

process.exit(0);
