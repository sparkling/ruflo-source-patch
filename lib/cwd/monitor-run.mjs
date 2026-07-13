#!/usr/bin/env node
// The scheduled job body (launchd / cron invoke THIS).
//
// Short-lived on purpose: re-apply the installed target set, log only if it actually
// had to repair something, exit. Steady state is a few stats and no writes.

import { runOnce } from './monitor.mjs';

try {
  runOnce();
} catch { /* never let a monitor tick fail loudly */ }

process.exit(0);
