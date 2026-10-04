import { runPluginCommand } from '../plugin-command.mjs';
export const brainOutboxStreamingCommand = action => runPluginCommand('brain-outbox-streaming', action);
