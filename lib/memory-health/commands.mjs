// Dispatch for the `memory-health` target — fixes the ruvnet-brain Onboarding Console's
// background cache refresh scoring the WRONG project's memory store (see patcher.mjs for what is
// broken). The install/uninstall/status flow and the shared composition engine live in
// ../plugin-command.mjs (ADR-020).

import { runPluginCommand } from '../plugin-command.mjs';

export const memoryHealthCommand = (action) => runPluginCommand('memory-health', action);
