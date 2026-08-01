// Dispatch for the fail-closed Brain release-version reporting patch (#77).

import { runPluginCommand } from '../plugin-command.mjs';

export const brainReleaseLockstepCommand = (action) => runPluginCommand('brain-release-lockstep', action);
