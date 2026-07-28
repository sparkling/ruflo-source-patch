// Dispatch for the RuvNet Brain flywheel advisory cadence patch (#53).

import { runPluginCommand } from '../plugin-command.mjs';

export const flywheelDailyCommand = (action) => runPluginCommand('flywheel-daily', action);
