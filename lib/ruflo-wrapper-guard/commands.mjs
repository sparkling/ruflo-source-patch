import { runPluginCommand } from '../plugin-command.mjs';
import { repairLegacyRufloMcp } from '../dual/ruflo-mcp-registration.mjs';

export function rufloWrapperGuardCommand(action) {
  if (action === 'install' || action === 'init') {
    try { repairLegacyRufloMcp(); }
    catch (error) {
      console.error('[ruflo-wrapper-guard] MCP repair failed: ' + error.message);
      process.exitCode = 1;
      return true;
    }
  }
  return runPluginCommand('ruflo-wrapper-guard', action);
}
