// Adds the missing Codex plugin/hook surface to RuvNet Brain (upstream issue #52).
//
// This is additive, like adr-reindex: upstream ships no Codex plugin manifest or
// lifecycle manifest, so there is no pristine vendor file to transform. Every
// created artifact carries our marker, and uninstall removes only exact bytes we
// generated. Codex's CLI owns config.toml mutation; this code never parses or
// rewrites the user's TOML, hook trust, approvals, or sandbox policy.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOME_BASE, STABLE_LIB } from '../cwd/paths.mjs';

const ISSUE = 'https://github.com/stuinfla/ruvnet-brain/issues/52';
const MARKER = 'ruflo-source-patch';
const MARKETPLACE_NAME = 'ruvnet-brain';
const PLUGIN_ID = 'ruvnet-brain@ruvnet-brain';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterSource = path.join(here, 'codex-hook-adapter.mjs');
const brainHome = process.env.RSP_RUVNET_BRAIN_HOME
  || path.join(HOME_BASE, '.cache', 'ruvnet-brain');

export const CODEX_HOME = process.env.RSP_CODEX_HOME
  || (process.env.RUFLO_SOURCE_PATCH_HOME
    ? path.join(HOME_BASE, '.codex')
    : process.env.CODEX_HOME || path.join(HOME_BASE, '.codex'));
const CODEX_BIN = process.env.RSP_CODEX_BIN || 'codex';

function configuredMarketplace() {
  return path.resolve(process.env.RSP_RUVNET_BRAIN_MARKETPLACE
    || path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', MARKETPLACE_NAME));
}

export function discover() {
  const root = configuredMarketplace();
  return fs.existsSync(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'))
    ? root
    : null;
}

function readClaudeManifest(root) {
  const file = path.join(root, 'plugin', '.claude-plugin', 'plugin.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || parsed.name !== 'ruvnet-brain' || typeof parsed.version !== 'string') {
    throw new Error(`unexpected RuvNet Brain manifest: ${file}`);
  }
  return parsed;
}

function pluginManifest(claude) {
  return `${JSON.stringify({
    name: 'ruvnet-brain',
    version: claude.version,
    description: `RuvNet Brain lifecycle hooks for Codex — temporary ${MARKER} for stuinfla/ruvnet-brain#52.`,
    author: claude.author,
    repository: claude.repository,
    license: claude.license,
    keywords: Array.isArray(claude.keywords) ? [...new Set([...claude.keywords, 'codex'])] : ['codex'],
    hooks: './hooks/codex-hooks.json',
  }, null, 2)}\n`;
}

function marketplaceManifest() {
  return `${JSON.stringify({
    name: MARKETPLACE_NAME,
    interface: { displayName: 'RuvNet Brain — temporary ruflo-source-patch #52' },
    plugins: [{
      name: 'ruvnet-brain',
      source: { source: 'local', path: './plugin' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
      category: 'Engineering',
    }],
  }, null, 2)}\n`;
}

function codexHookCommand(command, adapter) {
  const prefix = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/hook-shim.mjs" ';
  if (typeof command !== 'string') throw new Error('unsupported Brain hook without a command');
  const bare = command.endsWith(' || true') ? command.slice(0, -8) : command;
  if (!bare.startsWith(prefix)) throw new Error(`unsupported Brain hook command: ${command}`);
  const args = bare.slice(prefix.length).split(' ');
  if (!args.length || args.some((arg) => !/^[A-Za-z0-9-]+$/.test(arg))) {
    throw new Error(`unsupported Brain hook arguments: ${command}`);
  }
  if (args[0] === 'learn-flush') return `node ${adapter} detach-flush`;
  if (args[0] === 'continuation-gate') return `node ${adapter} stop`;
  return `node ${adapter} shim ${args.join(' ')}`;
}

function codexHookManifest(root) {
  const source = path.join(root, 'plugin', 'hooks', 'hooks.json');
  const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (!parsed?.hooks || typeof parsed.hooks !== 'object' || Array.isArray(parsed.hooks)) {
    throw new Error(`unexpected RuvNet Brain hook manifest: ${source}`);
  }
  const adapter = JSON.stringify(path.join(STABLE_LIB, 'codex-hooks', 'codex-hook-adapter.mjs'));
  const hooks = {};
  for (const [event, groups] of Object.entries(parsed.hooks)) {
    if (!Array.isArray(groups)) throw new Error(`unexpected ${event} hook groups: ${source}`);
    hooks[event] = groups.map((sourceGroup) => {
      if (!Array.isArray(sourceGroup?.hooks)) throw new Error(`unexpected ${event} hook group: ${source}`);
      const group = {
        ...sourceGroup,
        hooks: sourceGroup.hooks.map((hook) => ({
          ...hook,
          command: codexHookCommand(hook?.command, adapter),
          ...(event === 'SessionEnd' ? { timeout: 3 } : {}),
        })),
      };
      if (group.matcher === 'Task') group.matcher = 'Agent';
      if (event === 'SessionEnd') group.matcher = 'other';
      if (event === 'UserPromptSubmit' || event === 'Stop') delete group.matcher;
      return group;
    });
  }
  return `${JSON.stringify({
    description: `RuvNet Brain lifecycle for Codex — temporary ${MARKER} for stuinfla/ruvnet-brain#52.`,
    hooks,
  }, null, 2)}\n`;
}

function desired(root) {
  const claude = readClaudeManifest(root);
  return [
    {
      file: path.join(root, '.agents', 'plugins', 'marketplace.json'),
      body: marketplaceManifest(),
      label: 'Codex marketplace manifest',
    },
    {
      file: path.join(root, 'plugin', '.codex-plugin', 'plugin.json'),
      body: pluginManifest(claude),
      label: 'Codex plugin manifest',
    },
    {
      file: path.join(root, 'plugin', 'hooks', 'codex-hooks.json'),
      body: codexHookManifest(root),
      label: 'Codex lifecycle manifest',
    },
    {
      file: path.join(root, 'plugin', 'scripts', 'codex-hook-adapter.mjs'),
      body: fs.readFileSync(adapterSource, 'utf8'),
      label: 'Codex hook adapter',
      mode: 0o755,
    },
  ];
}

function staleSessionBridge() {
  try {
    const active = JSON.parse(fs.readFileSync(path.join(brainHome, 'active.json'), 'utf8'));
    const version = active?.previous?.version;
    if (typeof version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version)) {
      return null;
    }
    return {
      file: path.join(
        CODEX_HOME, 'plugins', 'cache', MARKETPLACE_NAME, MARKETPLACE_NAME,
        version, 'scripts', 'codex-hook-adapter.mjs',
      ),
      body: fs.readFileSync(adapterSource, 'utf8'),
      label: `stale-session bridge for Brain ${version}`,
      mode: 0o755,
    };
  } catch {
    return null;
  }
}

const isOurs = (body) => body.includes(MARKER) && (body.includes('#52') || body.includes('issues/52'));

function atomicWrite(file, body, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.rsp-tmp-${process.pid}-${randomUUID()}`);
  try {
    fs.writeFileSync(tmp, body, { mode: mode || 0o644 });
    if (mode) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* rename already consumed it */ }
  }
}

function codex(args) {
  const result = spawnSync(CODEX_BIN, args, {
    env: { ...process.env, CODEX_HOME },
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error?.code === 'ENOENT') return { available: false, result };
  return { available: true, result };
}

function jsonCommand(args) {
  const run = codex(args);
  if (!run.available) return { available: false };
  if (run.result.status !== 0) {
    return {
      available: true,
      error: (run.result.stderr || run.result.stdout || `exit ${run.result.status}`).trim(),
    };
  }
  try {
    return { available: true, value: JSON.parse(run.result.stdout || '{}') };
  } catch (err) {
    return { available: true, error: `invalid JSON from \`codex ${args.join(' ')}\`: ${err.message}` };
  }
}

function registration(root) {
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

function ensureRegistration(root, result) {
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

export function apply() {
  const result = {
    patched: 0, unchanged: 0, skipped: 0, incomplete: 0, errors: 0, log: [],
  };
  const root = discover();
  if (!root) {
    result.incomplete++;
    result.log.push(`INCOMPLETE RuvNet Brain marketplace not found at ${configuredMarketplace()} — install Brain first`);
    return result;
  }

  let files;
  try {
    files = desired(root);
    const bridge = staleSessionBridge();
    if (bridge) files.push(bridge);
  } catch (err) {
    result.errors++;
    result.log.push(`error cannot build Codex hook artifacts: ${err.message}`);
    return result;
  }

  for (const item of files) {
    if (!fs.existsSync(item.file)) continue;
    try {
      const current = fs.readFileSync(item.file, 'utf8');
      if (current === item.body || isOurs(current)) continue;
      result.incomplete++;
      result.log.push(`skip:not-ours ${item.file} already exists and is not the #52 patch; refusing an additive overwrite`);
    } catch (err) {
      result.errors++;
      result.log.push(`error cannot inspect ${item.file}: ${err.message}`);
    }
  }
  if (result.incomplete || result.errors) return result;

  for (const item of files) {
    try {
      if (fs.existsSync(item.file) && fs.readFileSync(item.file, 'utf8') === item.body) {
        result.unchanged++;
        continue;
      }
      atomicWrite(item.file, item.body, item.mode);
      result.patched++;
      result.log.push(`patched ${item.file} (${item.label})`);
    } catch (err) {
      result.errors++;
      result.log.push(`error ${item.file}: ${err.message}`);
    }
  }
  if (!result.errors) ensureRegistration(root, result);
  if (!result.errors && !result.incomplete) {
    result.log.push(`Codex hook trust is user-owned: open /hooks, review ${PLUGIN_ID}, and trust it; ${ISSUE}`);
  }
  return result;
}

function removeRegistration(root, result) {
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

export function restore() {
  const result = { restored: 0, incomplete: 0, errors: 0, unresolved: 0, log: [] };
  const root = discover();
  if (!root) return result;

  let files;
  try {
    files = desired(root);
    const bridge = staleSessionBridge();
    if (bridge) files.push(bridge);
  } catch (err) {
    result.errors++;
    result.log.push(`error cannot build uninstall plan: ${err.message}`);
    return result;
  }

  for (const item of files) {
    if (!fs.existsSync(item.file)) continue;
    try {
      const current = fs.readFileSync(item.file, 'utf8');
      if (current === item.body) continue;
      result.unresolved++;
      result.log.push(`skip:not-ours ${item.file} is not the exact #52 patch; refusing to remove or disable anything`);
    } catch (err) {
      result.errors++;
      result.log.push(`error cannot inspect ${item.file}: ${err.message}`);
    }
  }
  if (result.unresolved || result.errors) return result;
  if (!removeRegistration(root, result)) return result;

  for (const item of [...files].reverse()) {
    try {
      if (!fs.existsSync(item.file)) continue;
      fs.rmSync(item.file);
      result.restored++;
      result.log.push(`restored ${item.file} (removed additive #52 artifact)`);
      try { fs.rmdirSync(path.dirname(item.file)); } catch { /* shared/non-empty directory */ }
    } catch (err) {
      result.errors++;
      result.log.push(`error removing ${item.file}: ${err.message}`);
    }
  }
  return result;
}

export function status() {
  const out = { files: 6, patched: 0, log: [] };
  const root = discover();
  if (!root) {
    out.log.push(`not-patched RuvNet Brain marketplace missing at ${configuredMarketplace()}`);
    return out;
  }

  let files;
  try {
    files = desired(root);
  } catch (err) {
    out.log.push(`error cannot inspect Codex hook artifacts: ${err.message}`);
    return out;
  }
  for (const item of files) {
    try {
      if (fs.readFileSync(item.file, 'utf8') === item.body) {
        out.patched++;
      } else {
        out.log.push(`not-patched ${item.file} — missing, stale, or not ours`);
      }
    } catch {
      out.log.push(`not-patched ${item.file} — missing or unreadable`);
    }
  }

  const state = registration(root);
  if (!state.available) {
    out.log.push('not-patched Codex CLI unavailable — marketplace/plugin state is unknown');
    return out;
  }
  if (state.error) {
    out.log.push(`not-patched cannot inspect Codex registration: ${state.error}`);
    return out;
  }
  if (state.marketplaceMatches) out.patched++;
  else out.log.push(`not-patched Codex marketplace ${MARKETPLACE_NAME} is absent or points elsewhere`);

  if (state.pluginInstalled && state.pluginEnabled && state.pluginMatches) out.patched++;
  else if (state.pluginInstalled && !state.pluginEnabled) {
    out.log.push(`not-patched ${PLUGIN_ID} is installed but disabled`);
  } else {
    out.log.push(`not-patched ${PLUGIN_ID} is absent or resolves elsewhere`);
  }
  if (out.patched === out.files) {
    out.log.push(`installed/enabled ${PLUGIN_ID}; trust/active state is intentionally user-owned and must be verified in /hooks`);
  }
  return out;
}
