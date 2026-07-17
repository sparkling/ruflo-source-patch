// Dispatch for the `design-wall` target — scopes ruvnet-brain's design-grade gate to its OWN repo
// (see patcher.mjs for what is broken). The install/uninstall/status flow and the shared
// composition engine live in ../plugin-command.mjs (ADR-020).

import { runPluginCommand } from '../plugin-command.mjs';

export const designWallCommand = (action) => runPluginCommand('design-wall', action);
