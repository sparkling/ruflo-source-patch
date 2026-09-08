// Dispatch for the RuvNet Brain dual-host stdin transport patch (#273).

import { runPluginCommand } from '../plugin-command.mjs';

export const brainDualHostStdinCommand = (action) => runPluginCommand('brain-dual-host-stdin', action);
