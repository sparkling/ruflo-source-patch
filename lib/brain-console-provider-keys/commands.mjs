// Dispatch for Brain Console's packaged-catalog provider-key fallback (#86).

import { runPluginCommand } from '../plugin-command.mjs';

export const brainConsoleProviderKeysCommand = (action) => runPluginCommand('brain-console-provider-keys', action);
