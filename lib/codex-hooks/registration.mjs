import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOME_BASE } from '../cwd/paths.mjs';

export const CODEX_HOME = process.env.RSP_CODEX_HOME
  || (process.env.RUFLO_SOURCE_PATCH_HOME
    ? path.join(HOME_BASE, '.codex')
    : process.env.CODEX_HOME || path.join(HOME_BASE, '.codex'));
const CODEX_BIN = process.env.RSP_CODEX_BIN || 'codex';
const MARKETPLACE_NAME = 'ruvnet-brain';
const PLUGIN_ID = 'ruvnet-brain@ruvnet-brain';

function jsonCommand(args) {
  const result = spawnSync(CODEX_BIN, args, {
    env: { ...process.env, CODEX_HOME },
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error?.code === 'ENOENT') return { available: false };
  if (result.status !== 0) {
    return {
      available: true,
      error: (result.stderr || result.stdout || `exit ${result.status}`).trim(),
    };
  }
  try {
    return { available: true, value: JSON.parse(result.stdout || '{}') };
  } catch (err) {
    return { available: true, error: `invalid JSON from \`codex ${args.join(' ')}\`: ${err.message}` };
  }
}

export function registration(root) {
  const markets = jsonCommand(['plugin', 'marketplace', 'list', '--json']);
  if (!markets.available) return { available: false };
  if (markets.error) return { available: true, error: markets.error };
  const marketplace = (markets.value?.marketplaces || []).find((m) => m.name === MARKETPLACE_NAME);
  const marketplaceRoot = marketplace?.root ? path.resolve(marketplace.root) : null;
  const plugins = jsonCommand(['plugin', 'list', '--available', '--json']);
  if (plugins.error) return { available: true, error: plugins.error };
  const rows = [...(plugins.value?.installed || []), ...(plugins.value?.available || [])];
  const plugin = rows.find((p) => p.pluginId === PLUGIN_ID);
  const pluginPath = plugin?.source?.path ? path.resolve(plugin.source.path) : null;
  return {
    available: true,
    marketplace,
    marketplaceRoot,
    marketplaceMatches: marketplaceRoot === root,
    plugin,
    pluginPath,
    pluginMatches: pluginPath === path.join(root, 'plugin'),
    pluginInstalled: Boolean(plugin?.installed),
    pluginEnabled: Boolean(plugin?.enabled),
  };
}

export function ensureRegistration(root, result) {
  let state = registration(root);
  if (!state.available) {
    result.incomplete++;
    result.log.push('INCOMPLETE Codex CLI not found — hook plugin was staged but cannot be registered');
    return;
  }
  if (state.error) {
    result.errors++;
    result.log.push(`error cannot inspect Codex plugins: ${state.error}`);
    return;
  }
  if (state.marketplace && !state.marketplaceMatches) {
    result.incomplete++;
    result.log.push(`skip:not-ours Codex marketplace "${MARKETPLACE_NAME}" points to ${state.marketplaceRoot}, not ${root}; refusing to replace it`);
    return;
  }
  if (!state.marketplace) {
    const added = jsonCommand(['plugin', 'marketplace', 'add', root, '--json']);
    if (added.error || !added.available) {
      result.errors++;
      result.log.push(`error Codex marketplace registration failed: ${added.error || 'Codex CLI unavailable'}`);
      return;
    }
    result.patched++;
    result.log.push(`registered Codex marketplace ${MARKETPLACE_NAME} -> ${root}`);
    state = registration(root);
  } else {
    result.unchanged++;
  }
  if (state.error || !state.marketplaceMatches) {
    result.errors++;
    result.log.push(`error Codex did not resolve the registered marketplace to ${root}${state.error ? `: ${state.error}` : ''}`);
    return;
  }
  if (state.plugin && !state.pluginMatches) {
    result.incomplete++;
    result.log.push(`skip:not-ours ${PLUGIN_ID} resolves to ${state.pluginPath}, not ${path.join(root, 'plugin')}; refusing to replace it`);
    return;
  }
  if (state.pluginInstalled && !state.pluginEnabled) {
    result.incomplete++;
    result.log.push(`INCOMPLETE ${PLUGIN_ID} is installed but disabled — respecting the user's choice; enable it explicitly or uninstall this target`);
    return;
  }
  if (!state.pluginInstalled) {
    const added = jsonCommand(['plugin', 'add', PLUGIN_ID, '--json']);
    if (added.error || !added.available) {
      result.errors++;
      result.log.push(`error Codex plugin install failed: ${added.error || 'Codex CLI unavailable'}`);
      return;
    }
    result.patched++;
    result.log.push(`installed and enabled Codex plugin ${PLUGIN_ID}`);
  } else {
    result.unchanged++;
  }
}

export function removeRegistration(root, result) {
  const state = registration(root);
  if (!state.available) {
    result.incomplete++;
    result.log.push('INCOMPLETE Codex CLI not found — refusing to remove hook files while the plugin may still be enabled');
    return false;
  }
  if (state.error) {
    result.errors++;
    result.log.push(`error cannot inspect Codex plugins before uninstall: ${state.error}`);
    return false;
  }
  if (state.pluginInstalled && state.pluginMatches) {
    const removed = jsonCommand(['plugin', 'remove', PLUGIN_ID, '--json']);
    if (removed.error) {
      result.errors++;
      result.log.push(`error could not remove ${PLUGIN_ID}: ${removed.error}`);
      return false;
    }
    result.restored++;
    result.log.push(`removed Codex plugin ${PLUGIN_ID}`);
  } else if (state.pluginInstalled && !state.pluginMatches) {
    result.incomplete++;
    result.log.push(`skip:not-ours installed ${PLUGIN_ID} resolves to ${state.pluginPath}; refusing to remove it`);
    return false;
  }
  if (state.marketplace && state.marketplaceMatches) {
    const removed = jsonCommand(['plugin', 'marketplace', 'remove', MARKETPLACE_NAME, '--json']);
    if (removed.error) {
      result.errors++;
      result.log.push(`error could not remove Codex marketplace ${MARKETPLACE_NAME}: ${removed.error}`);
      return false;
    }
    result.restored++;
    result.log.push(`removed Codex marketplace ${MARKETPLACE_NAME}`);
  }
  return true;
}
