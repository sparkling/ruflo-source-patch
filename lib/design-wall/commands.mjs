// Dispatch for the legacy `design-wall` target. Current ruvnet-brain versions ship a stronger
// repository-identity gate, so supersede.mjs verifies that implementation and retires this patch.
// Older installed copies still use the local edit in patcher.mjs.

import { runPluginCommand } from '../plugin-command.mjs';

export const designWallCommand = (action) => runPluginCommand('design-wall', action);
