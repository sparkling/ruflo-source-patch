import { runPluginCommand } from '../plugin-command.mjs';
import { reconcileLoggerTrust } from './trust.mjs';
export async function hookFailureLogCommand(action) {
  const handled = runPluginCommand('hook-failure-log', action);
  if (!handled || !['install', 'init', 'uninstall', 'remove'].includes(action) || process.exitCode) return handled;
  const receipt = await reconcileLoggerTrust({ direction: ['uninstall', 'remove'].includes(action) ? 'remove' : 'install' });
  console.log(`[hook-failure-log] Codex trust: ${receipt.state}; migrated ${receipt.migrated}; pending review ${receipt.pendingReview ?? 'unknown'}`);
  if (receipt.reason) console.log(`[hook-failure-log] ${receipt.reason}`);
  if (receipt.transport) console.log(`[hook-failure-log] trust verification transport: ${receipt.transport}; hook execution not tested`);
  if (receipt.transport === 'fresh-metadata-stdio') console.log('[hook-failure-log] disk trust verified; existing standalone Codex sessions still need their native refresh');
  if (['blocked', 'degraded'].includes(receipt.state)) process.exitCode = 1;
  return handled;
}
