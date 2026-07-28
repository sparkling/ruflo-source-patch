// Codex hook-manifest and PreToolUse output compatibility (PR #2800 / issue #2816).

import { runPluginCommand } from '../plugin-command.mjs';

export const rufloHooksSchemaCommand = (action) => runPluginCommand('ruflo-hooks-schema', action);
