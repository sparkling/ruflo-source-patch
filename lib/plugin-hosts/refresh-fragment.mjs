// Narrow host-native refresh for the three immutable-identity collisions audited in Ruflo #2870.
// This does not copy cache bytes. It asks each host to refresh its marketplace and reinstall the
// exact affected identity, then proves that the installed payload matches that host's new snapshot.

const ISSUE = 'ruvnet/ruflo#2870';
const VERSIONS = Object.freeze({
  'ruflo-adr@ruflo': '0.4.1',
  'ruflo-metaharness@ruflo': '0.1.1',
  'ruflo-graph-intelligence@ruflo': '0.1.0-alpha.1',
});

async function __rspComparePluginTrees(sourceRoot, installedRoot) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  // Hosts add their own lifecycle metadata, Codex migrates commands, and npm may rewrite the lock
  // while installing graph-intelligence. Compare the executable/source payload, not host products.
  const ignored = new Set([
    '.codex-plugin', '.in_use', '.rsp-backup', 'node_modules', 'package-lock.json',
  ]);
  const collect = (root) => {
    const files = new Map();
    const walk = (dir, prefix = '') => {
      for (const name of fs.readdirSync(dir).sort()) {
        if (ignored.has(name) || name.endsWith('.rsp-backup')) continue;
        const file = path.join(dir, name);
        const rel = prefix ? `${prefix}/${name}` : name;
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) throw new Error(`unsafe symlink in plugin tree: ${file}`);
        if (stat.isDirectory()) walk(file, rel);
        else if (stat.isFile()) files.set(rel, fs.readFileSync(file));
      }
    };
    if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) {
      throw new Error(`plugin tree is missing: ${root}`);
    }
    walk(root);
    return files;
  };
  const source = collect(sourceRoot);
  const installed = collect(installedRoot);
  for (const name of [...new Set([...source.keys(), ...installed.keys()])].sort()) {
    if (!source.has(name)) return { equal: false, difference: `unexpected ${name}` };
    if (!installed.has(name)) return { equal: false, difference: `missing ${name}` };
    if (!source.get(name).equals(installed.get(name))) {
      return { equal: false, difference: `changed ${name}` };
    }
  }
  return { equal: true };
}

async function __rspRefreshHostPlugin(raw) {
  const pluginId = __rspHostPluginId(raw);
  const expectedVersion = __RSP_REFRESH_VERSIONS[pluginId];
  const result = {
    issue: __RSP_MUTABLE_PLUGIN_ISSUE,
    operation: 'refresh',
    pluginId,
    expectedVersion,
    success: false,
    hosts: {},
    restartRequired: false,
  };
  if (!expectedVersion) {
    result.error = `${pluginId} is not one of the audited same-version collisions`;
    return result;
  }

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
  const claudeBefore = __rspClaudeUserRow(claudeState, pluginId);
  const codexBefore = __rspCodexInstalledRow(codexState, pluginId);
  for (const [host, row] of [['claude', claudeBefore], ['codex', codexBefore]]) {
    if (row && row.version === expectedVersion && row.enabled !== true) {
      result.hosts[host] = { status: 'refused-disabled', version: row.version };
      result.error = `${pluginId} is disabled in ${host}; refresh refused rather than changing enabled state`;
      return result;
    }
  }
  if (![claudeBefore, codexBefore].some((row) => row?.version === expectedVersion)) {
    for (const [host, row] of [['claude', claudeBefore], ['codex', codexBefore]]) {
      result.hosts[host] = {
        status: row ? 'not-affected' : 'not-installed',
        ...(row?.version ? { version: row.version } : {}),
      };
    }
    result.success = true;
    return result;
  }

  let claudeMarketplace;
  try {
    await Promise.all([
      __rspHostExec('claude', ['plugin', 'marketplace', 'update', 'ruflo']),
      __rspHostExec('codex', ['plugin', 'marketplace', 'upgrade', 'ruflo', '--json']),
    ]);
    claudeMarketplace = await __rspClaudeMarketplace();
    codexState = await __rspCodexPlugins(false);
    if (!__rspCodexCatalog(codexState).has(pluginId)) {
      throw new Error(`${pluginId} disappeared from the refreshed Codex marketplace`);
    }
  } catch (error) {
    result.error = `marketplace refresh failed: ${error.message}`;
    return result;
  }

  const pluginName = pluginId.replace(/@ruflo$/, '');
  const path = await import('node:path');
  if (claudeBefore?.version === expectedVersion) {
    try {
      await __rspHostExec('claude', ['plugin', 'uninstall', pluginId, '--scope', 'user']);
      await __rspHostExec('claude', ['plugin', 'install', pluginId, '--scope', 'user']);
      claudeState = await __rspClaudePlugins();
      const current = __rspClaudeUserRow(claudeState, pluginId);
      if (!current?.version || current.enabled !== true) {
        throw new Error('reinstall exited 0 but an enabled user-scoped version is absent');
      }
      const compared = await __rspComparePluginTrees(
        path.join(claudeMarketplace.installLocation, 'plugins', pluginName),
        current.installPath,
      );
      if (!compared.equal) throw new Error(`cache differs from refreshed marketplace: ${compared.difference}`);
      result.hosts.claude = {
        status: current.version === expectedVersion ? 'refreshed' : 'upgraded',
        version: current.version,
      };
      result.restartRequired = true;
    } catch (error) {
      result.hosts.claude = { status: 'failed', error: error.message };
    }
  } else {
    result.hosts.claude = {
      status: claudeBefore ? 'not-affected' : 'not-installed',
      ...(claudeBefore?.version ? { version: claudeBefore.version } : {}),
    };
  }

  if (codexBefore?.version === expectedVersion) {
    try {
      await __rspHostExec('codex', ['plugin', 'remove', pluginId, '--json']);
      await __rspHostExec('codex', ['plugin', 'add', pluginId, '--json']);
      codexState = await __rspCodexPlugins(false);
      const current = __rspCodexInstalledRow(codexState, pluginId);
      if (!current?.version || current.enabled !== true) {
        throw new Error('reinstall exited 0 but an enabled version is absent');
      }
      const codexHome = process.env.CODEX_HOME
        || path.join((await import('node:os')).homedir(), '.codex');
      const compared = await __rspComparePluginTrees(
        current.source?.path,
        path.join(codexHome, 'plugins', 'cache', 'ruflo', pluginName, current.version),
      );
      if (!compared.equal) throw new Error(`cache differs from refreshed marketplace: ${compared.difference}`);
      result.hosts.codex = {
        status: current.version === expectedVersion ? 'refreshed' : 'upgraded',
        version: current.version,
      };
      result.restartRequired = true;
    } catch (error) {
      result.hosts.codex = { status: 'failed', error: error.message };
    }
  } else {
    result.hosts.codex = {
      status: codexBefore ? 'not-affected' : 'not-installed',
      ...(codexBefore?.version ? { version: codexBefore.version } : {}),
    };
  }
  result.success = ['claude', 'codex'].every((host) =>
    result.hosts[host] && result.hosts[host].status !== 'failed');
  return result;
}

export const HOST_REFRESH_FRAGMENT = [
  `const __RSP_MUTABLE_PLUGIN_ISSUE = ${JSON.stringify(ISSUE)};`,
  `const __RSP_REFRESH_VERSIONS = Object.freeze(${JSON.stringify(VERSIONS)});`,
  __rspComparePluginTrees.toString(),
  __rspRefreshHostPlugin.toString(),
].join('\n');
