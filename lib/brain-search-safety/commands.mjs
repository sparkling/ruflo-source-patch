// Dispatch for the RuvNet Brain source-search safety patch (#224/#225).

import { runPluginCommand } from '../plugin-command.mjs';

export const brainSearchSafetyCommand = (action) => runPluginCommand('brain-search-safety', action);
