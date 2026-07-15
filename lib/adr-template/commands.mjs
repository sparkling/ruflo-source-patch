// Dispatch for the `adr-template` target — patches the installed `ruflo-adr` plugin's `adr-create` skill
// template in place (ruvnet/ruflo#2659). See patcher.mjs for the fix and why it's needed. The install/
// uninstall/status flow and the shared composition engine live in ../plugin-command.mjs (ADR-020).

import { runPluginCommand } from '../plugin-command.mjs';

export const adrTemplateCommand = (action) => runPluginCommand('adr-template', action);
