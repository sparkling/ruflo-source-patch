import { runPluginCommand } from '../plugin-command.mjs';
import { repairLegacyRufloMcp } from '../dual/ruflo-mcp-registration.mjs';

export function prepareRufloWrapperInstall() {
  try { repairLegacyRufloMcp(); return true; }
  catch (error) {
    console.error('[ruflo-wrapper-guard] MCP repair failed: ' + error.message);
    process.exitCode = 1;
    return false;
  }
}

export function rufloWrapperGuardCommand(action) {
  if ((action === 'install' || action === 'init') && !prepareRufloWrapperInstall()) return true;
  return runPluginCommand('ruflo-wrapper-guard', action);
}
