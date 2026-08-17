// Runtime injected into @claude-flow/cli's compiled plugins command.
//
// Ruflo's IPFS/npm plugin manager and the Claude/Codex host marketplaces are
// different systems. These commands deliberately use each host's public CLI;
// they never copy plugin files or edit either host's cache/config directly.

import { HOST_REFRESH_FRAGMENT } from './refresh-fragment.mjs';
import {
  HOST_DISCOVERY_FRAGMENT,
  __rspHostExec,
  __rspHostJson,
} from './discovery-fragment.mjs';

const __RSP_HOST_PLUGIN_ISSUE = 'ruvnet/ruflo#2854';
const __RSP_HOST_PLUGIN_REVISION = '2026-08-17.6';

function __rspHostPluginId(raw) {
  if (typeof raw !== 'string') throw new Error('plugin name is required');
  const name = raw.trim().replace(/@ruflo$/, '');
  if (!/^ruflo-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`invalid Ruflo marketplace plugin: ${raw}`);
  }
  return `${name}@ruflo`;
}

async function __rspSafeMarketplaceRoot(raw) {
  const [{ default: fs }, { default: path }] = await Promise.all([
    import('node:fs'), import('node:path'),
  ]);
  if (typeof raw !== 'string' || !path.isAbsolute(raw)) return false;
  try {
    const stat = fs.lstatSync(raw);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch { return false; }
}

function __rspClaudeRufloSource(row) {
  return row?.source === 'github' && row?.repo === 'ruvnet/ruflo';
}

function __rspCodexRufloSource(row) {
  const source = row?.marketplaceSource;
  if (source?.sourceType !== 'git' || typeof source.source !== 'string') return false;
  return source.source.replace(/\/$/, '').replace(/\.git$/, '').toLowerCase()
    === 'https://github.com/ruvnet/ruflo';
}

async function __rspClaudeMarketplace() {
  let rows = await __rspHostJson('claude', ['plugin', 'marketplace', 'list', '--json']);
  let row = Array.isArray(rows) ? rows.find((item) => item?.name === 'ruflo') : undefined;
  if (row && !__rspClaudeRufloSource(row)) {
    throw new Error('Claude marketplace name ruflo belongs to a noncanonical source; refusing to replace it');
  }
  if (row && !(await __rspSafeMarketplaceRoot(row.installLocation))) {
    await __rspHostExec('claude', ['plugin', 'marketplace', 'remove', 'ruflo', '--scope', 'user']);
    rows = await __rspHostJson('claude', ['plugin', 'marketplace', 'list', '--json']);
    row = Array.isArray(rows) ? rows.find((item) => item?.name === 'ruflo') : undefined;
    if (row) throw new Error('stale Claude Ruflo marketplace is not user-scoped; refusing to replace it');
  }
  if (!row) {
    await __rspHostExec('claude', [
      'plugin', 'marketplace', 'add', 'ruvnet/ruflo', '--scope', 'user',
    ]);
    rows = await __rspHostJson('claude', ['plugin', 'marketplace', 'list', '--json']);
    row = Array.isArray(rows) ? rows.find((item) => item?.name === 'ruflo') : undefined;
  }
  if (!row || !__rspClaudeRufloSource(row)
      || !(await __rspSafeMarketplaceRoot(row.installLocation))) {
    throw new Error('Claude Code did not expose the registered Ruflo marketplace');
  }
  return row;
}

async function __rspClaudeCatalog() {
  const row = await __rspClaudeMarketplace();
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(row.installLocation);
  const manifestFile = path.join(root, '.claude-plugin', 'marketplace.json');
  if (!fs.existsSync(manifestFile)
      || fs.lstatSync(root).isSymbolicLink()
      || fs.lstatSync(manifestFile).isSymbolicLink()
      || !fs.realpathSync(manifestFile).startsWith(`${fs.realpathSync(root)}${path.sep}`)) {
    throw new Error(`Claude Ruflo marketplace path is missing or unsafe: ${manifestFile}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest?.name !== 'ruflo' || !Array.isArray(manifest.plugins)) {
    throw new Error(`Claude Ruflo marketplace manifest is invalid: ${manifestFile}`);
  }
  return new Set(manifest.plugins.map((plugin) => plugin?.name)
    .filter((name) => typeof name === 'string')
    .map((name) => `${name}@ruflo`));
}

async function __rspClaudePlugins() {
  const rows = await __rspHostJson('claude', ['plugin', 'list', '--json']);
  if (!Array.isArray(rows)) throw new Error('claude plugin list did not return an array');
  return rows;
}

async function __rspCodexMarketplace() {
  let result = await __rspHostJson('codex', ['plugin', 'marketplace', 'list', '--json']);
  let row = Array.isArray(result?.marketplaces)
    ? result.marketplaces.find((item) => item?.name === 'ruflo')
    : undefined;
  if (row && !__rspCodexRufloSource(row)) {
    throw new Error('Codex marketplace name ruflo belongs to a noncanonical source; refusing to replace it');
  }
  if (row && !(await __rspSafeMarketplaceRoot(row.root))) {
    await __rspHostExec('codex', ['plugin', 'marketplace', 'remove', 'ruflo', '--json']);
    result = await __rspHostJson('codex', ['plugin', 'marketplace', 'list', '--json']);
    row = Array.isArray(result?.marketplaces)
      ? result.marketplaces.find((item) => item?.name === 'ruflo')
      : undefined;
    if (row) throw new Error('stale Codex Ruflo marketplace remained after supported removal');
  }
  if (!row) {
    await __rspHostExec('codex', [
      'plugin', 'marketplace', 'add', 'ruvnet/ruflo', '--ref', 'main',
    ]);
    result = await __rspHostJson('codex', ['plugin', 'marketplace', 'list', '--json']);
    row = Array.isArray(result?.marketplaces)
      ? result.marketplaces.find((item) => item?.name === 'ruflo')
      : undefined;
  }
  if (!row || !__rspCodexRufloSource(row)
      || !(await __rspSafeMarketplaceRoot(row.root))) {
    throw new Error('Codex did not expose the registered Ruflo marketplace');
  }
  return row;
}

async function __rspCodexPlugins(ensureMarketplace = true) {
  if (ensureMarketplace) await __rspCodexMarketplace();
  const result = await __rspHostJson('codex', ['plugin', 'list', '--available', '--json']);
  if (!Array.isArray(result?.installed) || !Array.isArray(result?.available)) {
    throw new Error('codex plugin list did not return installed and available arrays');
  }
  return result;
}

function __rspCodexCatalog(result) {
  return new Set([...result.installed, ...result.available]
    .filter((row) => row?.marketplaceName === 'ruflo' && typeof row.pluginId === 'string')
    .map((row) => row.pluginId));
}

function __rspClaudeUserRow(rows, pluginId) {
  return rows.find((row) => row?.id === pluginId && row?.scope === 'user');
}

function __rspCodexInstalledRow(result, pluginId) {
  return result.installed.find((row) =>
    row?.pluginId === pluginId && row?.marketplaceName === 'ruflo' && row?.installed);
}

async function __rspInstallHostPlugin(raw) {
  const pluginId = __rspHostPluginId(raw);
  const result = {
    issue: __RSP_HOST_PLUGIN_ISSUE,
    operation: 'install',
    pluginId,
    success: false,
    hosts: {},
    restartRequired: true,
  };
  let claudeCatalog;
  let codexState;
  try {
    [claudeCatalog, codexState] = await Promise.all([
      __rspClaudeCatalog(),
      __rspCodexPlugins(),
    ]);
  } catch (error) {
    result.error = `preflight failed: ${error.message}`;
    return result;
  }
  if (!claudeCatalog.has(pluginId) || !__rspCodexCatalog(codexState).has(pluginId)) {
    result.error = `${pluginId} is not present in both Ruflo marketplace snapshots`;
    return result;
  }

  let claudeState;
  try {
    claudeState = await __rspClaudePlugins();
    const current = __rspClaudeUserRow(claudeState, pluginId);
    if (current) {
      result.hosts.claude = {
        status: current.enabled ? 'already-installed' : 'preserved-disabled',
      };
    } else {
      await __rspHostExec('claude', ['plugin', 'install', pluginId, '--scope', 'user']);
      claudeState = await __rspClaudePlugins();
      if (!__rspClaudeUserRow(claudeState, pluginId)) {
        throw new Error('install exited 0 but the user-scoped plugin is absent');
      }
      result.hosts.claude = { status: 'installed' };
    }
  } catch (error) {
    result.hosts.claude = { status: 'failed', error: error.message };
  }

  try {
    const current = __rspCodexInstalledRow(codexState, pluginId);
    if (current) {
      result.hosts.codex = {
        status: current.enabled ? 'already-installed' : 'preserved-disabled',
      };
    } else {
      await __rspHostExec('codex', ['plugin', 'add', pluginId, '--json']);
      codexState = await __rspCodexPlugins();
      if (!__rspCodexInstalledRow(codexState, pluginId)) {
        throw new Error('add exited 0 but the plugin is absent');
      }
      result.hosts.codex = { status: 'installed' };
    }
  } catch (error) {
    result.hosts.codex = { status: 'failed', error: error.message };
  }

  result.success = ['claude', 'codex'].every((host) =>
    result.hosts[host] && result.hosts[host].status !== 'failed');
  if (pluginId === 'ruflo-core@ruflo'
      && result.hosts.codex?.status === 'installed') {
    result.hookReview = 'Start a new Codex session, open /hooks, and review the Ruflo hooks.';
  }
  return result;
}

async function __rspUninstallHostPlugin(raw) {
  const pluginId = __rspHostPluginId(raw);
  const result = {
    issue: __RSP_HOST_PLUGIN_ISSUE,
    operation: 'uninstall',
    pluginId,
    success: false,
    hosts: {},
    restartRequired: true,
  };
  let claudeState;
  let codexState;
  try {
    [claudeState, codexState] = await Promise.all([
      __rspClaudePlugins(),
      __rspCodexPlugins(false),
    ]);
  } catch (error) {
    result.error = `preflight failed: ${error.message}`;
    return result;
  }

  try {
    if (!__rspClaudeUserRow(claudeState, pluginId)) {
      result.hosts.claude = { status: 'already-absent' };
    } else {
      await __rspHostExec('claude', ['plugin', 'uninstall', pluginId, '--scope', 'user']);
      claudeState = await __rspClaudePlugins();
      if (__rspClaudeUserRow(claudeState, pluginId)) {
        throw new Error('uninstall exited 0 but the user-scoped plugin remains');
      }
      result.hosts.claude = { status: 'uninstalled' };
    }
  } catch (error) {
    result.hosts.claude = { status: 'failed', error: error.message };
  }

  try {
    if (!__rspCodexInstalledRow(codexState, pluginId)) {
      result.hosts.codex = { status: 'already-absent' };
    } else {
      await __rspHostExec('codex', ['plugin', 'remove', pluginId, '--json']);
      codexState = await __rspCodexPlugins(false);
      if (__rspCodexInstalledRow(codexState, pluginId)) {
        throw new Error('remove exited 0 but the plugin remains');
      }
      result.hosts.codex = { status: 'uninstalled' };
    }
  } catch (error) {
    result.hosts.codex = { status: 'failed', error: error.message };
  }

  result.success = ['claude', 'codex'].every((host) =>
    result.hosts[host] && result.hosts[host].status !== 'failed');
  return result;
}

async function __rspSyncClaudePluginsToCodex(dryRun) {
  const result = {
    issue: __RSP_HOST_PLUGIN_ISSUE,
    operation: 'sync',
    direction: 'claude-to-codex',
    dryRun: Boolean(dryRun),
    success: false,
    plan: [],
    installed: [],
    preserved: [],
    failures: [],
    restartRequired: !dryRun,
  };
  let claudeState;
  let codexState;
  try {
    [claudeState, codexState] = await Promise.all([
      __rspClaudePlugins(),
      __rspCodexPlugins(!dryRun),
    ]);
  } catch (error) {
    result.failures.push(`preflight failed: ${error.message}`);
    return result;
  }
  const source = [...new Set(claudeState
    .filter((row) => row?.scope === 'user' && row?.enabled === true
      && typeof row.id === 'string' && row.id.endsWith('@ruflo'))
    .map((row) => row.id))]
    .sort();
  const catalog = __rspCodexCatalog(codexState);
  const unknown = source.filter((pluginId) => !catalog.has(pluginId));
  if (unknown.length) {
    result.failures.push(`not present in the Codex Ruflo marketplace: ${unknown.join(', ')}`);
    return result;
  }
  const installed = new Set(codexState.installed
    .filter((row) => row?.marketplaceName === 'ruflo' && row?.installed)
    .map((row) => row.pluginId));
  result.plan = source.filter((pluginId) => !installed.has(pluginId));
  result.preserved = source.filter((pluginId) => installed.has(pluginId));
  if (dryRun) {
    result.success = true;
    return result;
  }

  for (const pluginId of result.plan) {
    try {
      await __rspHostExec('codex', ['plugin', 'add', pluginId, '--json']);
      result.installed.push(pluginId);
    } catch (error) {
      result.failures.push(`${pluginId}: ${error.message}`);
    }
  }
  try {
    codexState = await __rspCodexPlugins(false);
    const final = new Set(codexState.installed
      .filter((row) => row?.marketplaceName === 'ruflo' && row?.installed)
      .map((row) => row.pluginId));
    for (const pluginId of source) {
      if (!final.has(pluginId)
          && !result.failures.some((failure) => failure.startsWith(`${pluginId}:`))) {
        result.failures.push(`${pluginId}: add was not reflected in Codex state`);
      }
    }
  } catch (error) {
    result.failures.push(`postcondition failed: ${error.message}`);
  }
  result.success = result.failures.length === 0;
  return result;
}

function __rspReportHostResult(ctx, result) {
  if (ctx?.flags?.format === 'json') {
    output.printJson(result);
  } else {
    output.writeln();
    output.writeln(output.bold(`Ruflo host plugin ${result.operation}`));
    if (result.pluginId) output.writeln(`Plugin: ${result.pluginId}`);
    for (const [host, state] of Object.entries(result.hosts || {})) {
      output.writeln(`${host}: ${state.status}${state.error ? ` — ${state.error}` : ''}`);
    }
    for (const entry of result.entries || []) {
      const states = Object.entries(entry.hosts || {})
        .map(([host, state]) => `${host}=${state.status}${state.error ? ` (${state.error})` : ''}`)
        .join(', ');
      output.writeln(`${entry.pluginId}: ${states}`);
    }
    if (result.plan) {
      output.writeln(`Codex additions: ${result.plan.length ? result.plan.join(', ') : '(none)'}`);
    }
    for (const failure of result.failures || []) output.printError(failure);
    if (result.error) output.printError(result.error);
    if (result.hookReview) output.writeln(output.warning(result.hookReview));
    if (result.restartRequired && result.success) {
      output.writeln(output.warning('Start new Claude Code and Codex sessions to load plugin changes.'));
    }
  }
  return {
    success: result.success,
    ...(result.success ? {} : { exitCode: 1 }),
    data: result,
  };
}

const functions = [
  __rspHostPluginId,
  __rspSafeMarketplaceRoot,
  __rspClaudeRufloSource,
  __rspCodexRufloSource,
  __rspClaudeMarketplace,
  __rspClaudeCatalog,
  __rspClaudePlugins,
  __rspCodexMarketplace,
  __rspCodexPlugins,
  __rspCodexCatalog,
  __rspClaudeUserRow,
  __rspCodexInstalledRow,
  __rspInstallHostPlugin,
  __rspUninstallHostPlugin,
  __rspSyncClaudePluginsToCodex,
  __rspReportHostResult,
];

export const HOST_PLUGIN_FRAGMENT = [
  `const __RSP_HOST_PLUGIN_ISSUE = ${JSON.stringify(__RSP_HOST_PLUGIN_ISSUE)};`,
  `const __RSP_HOST_PLUGIN_REVISION = ${JSON.stringify(__RSP_HOST_PLUGIN_REVISION)};`,
  HOST_DISCOVERY_FRAGMENT,
  ...functions.map((fn) => fn.toString()),
  HOST_REFRESH_FRAGMENT,
  `const __rspHostInstallCommand = {
    name: 'host-install',
    description: 'Install one Ruflo marketplace plugin in Claude Code and Codex',
    options: [{ name: 'name', short: 'n', type: 'string', description: 'Ruflo plugin name', required: true }],
    examples: [{ command: 'ruflo plugins host-install -n ruflo-swarm', description: 'Install in both hosts' }],
    action: async (ctx) => __rspReportHostResult(ctx, await __rspInstallHostPlugin(ctx.flags.name)),
  };`,
  `const __rspHostUninstallCommand = {
    name: 'host-uninstall',
    description: 'Uninstall one user-scoped Ruflo marketplace plugin from Claude Code and Codex',
    options: [{ name: 'name', short: 'n', type: 'string', description: 'Ruflo plugin name', required: true }],
    examples: [{ command: 'ruflo plugins host-uninstall -n ruflo-swarm', description: 'Uninstall from both hosts' }],
    action: async (ctx) => __rspReportHostResult(ctx, await __rspUninstallHostPlugin(ctx.flags.name)),
  };`,
  `const __rspHostSyncCommand = {
    name: 'host-sync',
    description: 'Add enabled user-scoped Claude Ruflo plugins missing from Codex',
    options: [{ name: 'dry-run', type: 'boolean', description: 'Print the additive plan without installing' }],
    examples: [{ command: 'ruflo plugins host-sync --dry-run', description: 'Preview Claude-to-Codex reconciliation' }],
    action: async (ctx) => __rspReportHostResult(ctx, await __rspSyncClaudePluginsToCodex(
      ctx.flags.dryRun === true || ctx.flags['dry-run'] === true
    )),
  };`,
  `const __rspHostRefreshCommand = {
    name: 'host-refresh',
    description: 'Refresh one audited same-version Ruflo collision through both host CLIs',
    options: [{ name: 'name', short: 'n', type: 'string', description: 'Affected Ruflo plugin name', required: true }],
    examples: [{ command: 'ruflo plugins host-refresh -n ruflo-adr', description: 'Refresh an affected same-version cache' }],
    action: async (ctx) => __rspReportHostResult(ctx, await __rspRefreshHostPlugin(ctx.flags.name)),
  };`,
  `const __rspHostUpdateCommand = {
    name: 'host-update',
    description: 'Update installed Ruflo plugins in both hosts; omit --name to update all',
    options: [{ name: 'name', short: 'n', type: 'string', description: 'Optional Ruflo plugin name' }],
    examples: [
      { command: 'ruflo plugins host-update', description: 'Update every installed Ruflo plugin' },
      { command: 'ruflo plugins host-update -n ruflo-adr', description: 'Update one installed Ruflo plugin' },
    ],
    action: async (ctx) => __rspReportHostResult(ctx, await __rspUpdateHostPlugins(ctx.flags.name)),
  };`,
].join('\n');
