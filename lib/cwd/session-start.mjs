#!/usr/bin/env node
// SessionStart hook body (runs from the stable copy at
// ~/.ruflo-source-patch/lib/session-start.mjs). Re-applies the patch to any
// npx cache copy that isn't patched yet. Best-effort; never blocks startup.

import { run } from './patch-library.mjs';

// Drain stdin (Claude Code pipes the hook event JSON) so we don't hang.
try { process.stdin.resume(); process.stdin.on('data', () => {}); } catch { /* ignore */ }

try {
  run({ revert: false });
} catch { /* best-effort */ }

// Never emit stdout (keeps session context clean); never block.
setTimeout(() => process.exit(0), 4000);
process.exit(0);
