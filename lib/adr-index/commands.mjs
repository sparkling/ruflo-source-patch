// Dispatch for the `adr-index` target — patches the installed `ruflo-adr` plugin's importer
// (`scripts/import.mjs`) in place (ruvnet/ruflo#2660). See patcher.mjs for the fix. The install/uninstall/
// status flow and the shared composition engine live in ../plugin-command.mjs (ADR-020).

import { runPluginCommand } from '../plugin-command.mjs';

export const adrIndexCommand = (action) => runPluginCommand('adr-index', action);
