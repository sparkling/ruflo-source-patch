import { runPluginCommand } from '../plugin-command.mjs';
export const hookFailureLogCommand = action => runPluginCommand('hook-failure-log', action);
