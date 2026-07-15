// Dispatch for the `verify-interface` target — patches the installed `ruvnet-brain` plugin's PreToolUse
// gate (stuinfla/ruvnet-brain#12). See patcher.mjs for what is broken. The install/uninstall/status flow
// and the shared composition engine live in ../plugin-command.mjs (ADR-020); a partial apply exits
// nonzero there, and the atomic descriptor declines to write a half-patched gate.

import { runPluginCommand } from '../plugin-command.mjs';

export const verifyInterfaceCommand = (action) => runPluginCommand('verify-interface', action);
