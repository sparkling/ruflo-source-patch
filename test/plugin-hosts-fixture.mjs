export const catalog = [
  'ruflo-adr@ruflo',
  'ruflo-core@ruflo',
  'ruflo-failing@ruflo',
  'ruflo-graph-intelligence@ruflo',
  'ruflo-metaharness@ruflo',
  'ruflo-neural@ruflo',
  'ruflo-swarm@ruflo',
  'ruflo-uninstall@ruflo',
  'ruflo-wasm@ruflo',
];

export const versions = {
  'ruflo-adr@ruflo': '0.4.1',
  'ruflo-core@ruflo': '0.2.1',
  'ruflo-failing@ruflo': '0.1.0',
  'ruflo-graph-intelligence@ruflo': '0.1.0-alpha.1',
  'ruflo-metaharness@ruflo': '0.1.1',
  'ruflo-neural@ruflo': '0.1.0',
  'ruflo-swarm@ruflo': '0.2.1',
  'ruflo-uninstall@ruflo': '0.1.0',
  'ruflo-wasm@ruflo': '0.1.0',
};

export function fakeHost(host) {
  return `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const host = ${JSON.stringify(host)};
const args = process.argv.slice(2);
const versions = ${JSON.stringify(versions)};
const stateFile = process.env.RSP_HOST_STATE;
const callsFile = process.env.RSP_HOST_CALLS;
const read = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const save = (state) => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\\n');
const same = (...expected) => JSON.stringify(args) === JSON.stringify(expected);
const pluginName = (id) => id.replace(/@ruflo$/, '');
const scopeOf = () => args[args.indexOf('--scope') + 1];
const scopedRow = (row, id, scope) => row.id === id && row.scope === scope
  && (scope === 'user' || row.projectPath === process.cwd());
const copyPlugin = (sourceRoot, targetRoot, id) => {
  const source = path.join(sourceRoot, 'plugins', pluginName(id));
  if (!fs.existsSync(source)) return;
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
  fs.cpSync(source, targetRoot, { recursive: true });
};
fs.appendFileSync(callsFile, JSON.stringify([host, ...args]) + '\\n');
let state = read();
if (host === 'claude') {
  if (same('plugin', 'marketplace', 'list', '--json')) {
    process.stdout.write(JSON.stringify(state.claudeMarketplace
      ? [{
          name: 'ruflo',
          source: state.claudeMarketplaceSource,
          repo: state.claudeMarketplaceRepo,
          installLocation: state.claudeMarketplaceLocation,
        }]
      : []));
  } else if (same('plugin', 'marketplace', 'add', 'ruvnet/ruflo', '--scope', 'user')) {
    Object.assign(state, {
      claudeMarketplace: true,
      claudeMarketplaceSource: 'github',
      claudeMarketplaceRepo: 'ruvnet/ruflo',
      claudeMarketplaceLocation: process.env.RSP_MARKETPLACE_ROOT,
    }); save(state);
  } else if (same('plugin', 'marketplace', 'remove', 'ruflo', '--scope', 'user')) {
    state.claudeMarketplace = false; save(state);
  } else if (same('plugin', 'marketplace', 'update', 'ruflo')) {
    process.stdout.write('updated');
  } else if (same('plugin', 'list', '--json')) {
    process.stdout.write(JSON.stringify(state.claude));
  } else if (args[0] === 'plugin' && args[1] === 'install'
      && args[3] === '--scope') {
    const scope = scopeOf();
    const version = state.refreshVersion || versions[args[2]];
    const installPath = version
      ? path.join(process.env.RSP_CLAUDE_CACHE_ROOT, pluginName(args[2]), version)
      : undefined;
    if (installPath) copyPlugin(process.env.RSP_MARKETPLACE_ROOT, installPath, args[2]);
    if (!state.claude.some((row) => scopedRow(row, args[2], scope))) {
      state.claude.push({
        id: args[2], version, scope, enabled: true, installPath,
        ...(scope === 'user' ? {} : { projectPath: process.cwd() }),
      });
    }
    save(state);
  } else if (args[0] === 'plugin' && args[1] === 'update'
      && args[3] === '--scope') {
    const scope = scopeOf();
    const version = versions[args[2]];
    const row = state.claude.find((item) => scopedRow(item, args[2], scope));
    if (!row || !version) { process.stderr.write('plugin unavailable'); process.exit(8); }
    const installPath = path.join(process.env.RSP_CLAUDE_CACHE_ROOT, pluginName(args[2]), version);
    copyPlugin(process.env.RSP_MARKETPLACE_ROOT, installPath, args[2]);
    Object.assign(row, { version, installPath });
    save(state);
  } else if (args[0] === 'plugin' && args[1] === 'uninstall'
      && args[3] === '--scope') {
    const scope = scopeOf();
    state.claude = state.claude.filter((row) =>
      !scopedRow(row, args[2], scope));
    save(state);
  } else {
    process.stderr.write('unexpected claude argv: ' + JSON.stringify(args));
    process.exit(9);
  }
} else if (same('plugin', 'marketplace', 'list', '--json')) {
  process.stdout.write(JSON.stringify({
    marketplaces: state.codexMarketplace ? [{
      name: 'ruflo',
      root: state.codexMarketplaceRoot,
      marketplaceSource: {
        sourceType: state.codexMarketplaceSourceType,
        source: state.codexMarketplaceSource,
      },
    }] : [],
  }));
} else if (same('plugin', 'marketplace', 'add', 'ruvnet/ruflo', '--ref', 'main')) {
  Object.assign(state, {
    codexMarketplace: true,
    codexMarketplaceRoot: process.env.RSP_CODEX_MARKETPLACE_ROOT,
    codexMarketplaceSourceType: 'git',
    codexMarketplaceSource: 'https://github.com/ruvnet/ruflo.git',
  }); save(state);
} else if (same('plugin', 'marketplace', 'remove', 'ruflo', '--json')) {
  state.codexMarketplace = false; save(state); process.stdout.write('{}');
} else if (same('plugin', 'marketplace', 'upgrade', 'ruflo', '--json')) {
  process.stdout.write('{}');
} else if (same('plugin', 'list', '--available', '--json')) {
  const installed = state.codex.map((row) => ({
    pluginId: row.id, marketplaceName: 'ruflo', installed: true, enabled: row.enabled,
    version: row.version,
    source: { path: path.join(process.env.RSP_CODEX_MARKETPLACE_ROOT, 'plugins', pluginName(row.id)) },
  }));
  const ids = new Set(state.codex.map((row) => row.id));
  const available = state.catalog.filter((id) => !ids.has(id)).map((pluginId) => ({
    pluginId, marketplaceName: 'ruflo', installed: false, enabled: false,
  }));
  process.stdout.write(JSON.stringify({ installed, available }));
} else if (args[0] === 'plugin' && args[1] === 'add' && args[3] === '--json') {
  if (state.failCodexAdd.includes(args[2])) {
    process.stderr.write('fixture Codex add failure');
    process.exit(7);
  }
  if (!state.codex.some((row) => row.id === args[2])) {
    const version = state.refreshVersion || versions[args[2]];
    const installedPath = version
      ? path.join(process.env.CODEX_HOME, 'plugins', 'cache', 'ruflo', pluginName(args[2]), version)
      : undefined;
    if (installedPath && !state.skipCodexCopy) {
      copyPlugin(process.env.RSP_CODEX_MARKETPLACE_ROOT, installedPath, args[2]);
    }
    state.codex.push({ id: args[2], version, enabled: true });
    process.stdout.write(JSON.stringify({ installedPath }));
  }
  save(state);
} else if (args[0] === 'plugin' && args[1] === 'remove' && args[3] === '--json') {
  state.codex = state.codex.filter((row) => row.id !== args[2]);
  save(state);
} else {
  process.stderr.write('unexpected codex argv: ' + JSON.stringify(args));
  process.exit(9);
}
`;
}
