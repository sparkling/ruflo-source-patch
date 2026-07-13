#!/usr/bin/env node
// SessionStart hook body (runs from the stable copy at
// ~/.ruflo-source-patch/lib/session-start.mjs).
//
// Re-applies EXACTLY the installed target set (state.json) to any npx cache copy
// fetched since the last session. It never re-patches a target the user uninstalled —
// that is the whole point of per-target install/uninstall.
//
// Best-effort; never blocks startup, never writes to stdout.

import { reapply } from './commands.mjs';

// Drain stdin (Claude Code pipes the hook event JSON) so we don't hang.
try { process.stdin.resume(); process.stdin.on('data', () => {}); } catch { /* ignore */ }

try {
  reapply();
} catch { /* best-effort */ }

setTimeout(() => process.exit(0), 4000);
process.exit(0);
