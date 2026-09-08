// Dispatch for the RuvNet Brain dual-host receipt boundary patch (#272).

import { runPluginCommand } from '../plugin-command.mjs';

export const brainDualHostReceiptCommand = (action) => runPluginCommand('brain-dual-host-receipt', action);
