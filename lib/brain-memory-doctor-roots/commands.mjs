// Dispatch for Brain's standalone memory-doctor fleet-discovery repair (#81).

import { runPluginCommand } from '../plugin-command.mjs';

export const brainMemoryDoctorRootsCommand = (action) => runPluginCommand('brain-memory-doctor-roots', action);
