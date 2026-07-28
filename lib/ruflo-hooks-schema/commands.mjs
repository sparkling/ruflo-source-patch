// Codex strict hook-manifest schema compatibility (ruvnet/ruflo#2801 / PR #2800).

import { runPluginCommand } from '../plugin-command.mjs';

export const rufloHooksSchemaCommand = (action) => runPluginCommand('ruflo-hooks-schema', action);
