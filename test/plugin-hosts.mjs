// Behavioral coverage for the dual-host Ruflo marketplace commands (#2854).
//
// The real source patch is applied to a sandboxed @claude-flow/cli. Its injected
// commands then execute against fake `claude` and `codex` binaries, so the test
// proves argv, state transitions, failure reporting, idempotence, and uninstall
// without touching either real host registry.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { catalog, fakeHost, versions } from './plugin-hosts-fixture.mjs';

const SB = path.resolve(process.argv[2]);
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = path.join(SB, 'home');
const NPX = path.join(SB, 'npx');
const BIN = path.join(SB, 'bin');
const STATE = path.join(SB, 'host-state.json');
const CALLS = path.join(SB, 'host-calls.jsonl');
const MARKETPLACE = path.join(SB, 'marketplace');
const CODEX_MARKETPLACE = path.join(SB, 'codex-marketplace');
const CODEX_HOME = path.join(SB, 'codex-home');
const CLAUDE_CACHE = path.join(SB, 'claude-cache');
const PROJECT = path.join(SB, 'project');
const PLUGINS = path.join(
  NPX, 'fixture', 'node_modules', '@claude-flow', 'cli',
  'dist', 'src', 'commands', 'plugins.js',
);
let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function write(file, body, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  fs.chmodSync(file, mode);
}
function readState() {
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}
function writeState(state) {
  fs.writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
}
function calls() {
  if (!fs.existsSync(CALLS)) return [];
  return fs.readFileSync(CALLS, 'utf8').trim().split('\n')
    .filter(Boolean).map((line) => JSON.parse(line));
}
function seed() {
  fs.rmSync(SB, { recursive: true, force: true });
  fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
  fs.mkdirSync(PROJECT, { recursive: true });
  write(path.join(HOME, '.claude', 'settings.json'), '{}\n');
  writeState({
    claudeMarketplace: true,
    claudeMarketplaceSource: 'github',
    claudeMarketplaceRepo: 'ruvnet/ruflo',
    claudeMarketplaceLocation: MARKETPLACE,
    codexMarketplace: true,
    codexMarketplaceRoot: CODEX_MARKETPLACE,
    codexMarketplaceSourceType: 'git',
    codexMarketplaceSource: 'https://github.com/ruvnet/ruflo.git',
    catalog,
    claude: [
      {
        id: 'ruflo-core@ruflo', version: '0.2.0', scope: 'user', enabled: true,
        installPath: path.join(CLAUDE_CACHE, 'ruflo-core', '0.2.0'),
      },
      {
        id: 'ruflo-swarm@ruflo', version: '0.2.1', scope: 'user', enabled: true,
        installPath: path.join(CLAUDE_CACHE, 'ruflo-swarm', '0.2.1'),
      },
      { id: 'ruflo-adr@ruflo', version: '0.4.1', scope: 'user', enabled: false },
      {
        id: 'ruflo-metaharness@ruflo', version: '0.1.1', scope: 'user', enabled: true,
        installPath: path.join(CLAUDE_CACHE, 'ruflo-metaharness', '0.1.1'),
      },
      {
        id: 'ruflo-graph-intelligence@ruflo', version: '0.1.0-alpha.1', scope: 'project',
        enabled: true, projectPath: PROJECT,
        installPath: path.join(CLAUDE_CACHE, 'ruflo-graph-intelligence', '0.1.0-alpha.1'),
      },
      {
        id: 'ruflo-uninstall@ruflo', version: '0.1.0', scope: 'user', enabled: true,
        installPath: path.join(CLAUDE_CACHE, 'ruflo-uninstall', '0.1.0'),
      },
      { id: 'ruflo-uninstall@ruflo', scope: 'project', enabled: true },
    ],
    codex: [
      { id: 'ruflo-core@ruflo', version: '0.2.0', enabled: true },
      { id: 'ruflo-adr@ruflo', version: '0.4.1', enabled: false },
      { id: 'ruflo-metaharness@ruflo', version: '0.1.1', enabled: true },
      { id: 'ruflo-uninstall@ruflo', version: '0.1.0', enabled: true },
      { id: 'ruflo-wasm@ruflo', version: '0.1.0', enabled: true },
    ],
    failCodexAdd: [],
    skipCodexCopy: false,
    refreshVersion: null,
  });

  const vendor = `const output = {
  writeln() {},
  bold(value) { return value; },
  printJson() {},
  printError() {},
  warning(value) { return value; },
  highlight(value) { return value; },
  printList() {},
};
const listCommand = { name: 'list' };
const searchCommand = { name: 'search' };
const installCommand = { name: 'install' };
const uninstallCommand = { name: 'uninstall' };
const upgradeCommand = { name: 'upgrade' };
const toggleCommand = { name: 'toggle' };
const infoCommand = { name: 'info' };
const createCommand = { name: 'create' };
const rateCommand = { name: 'rate' };
export const pluginsCommand = {
  name: 'plugins',
    subcommands: [listCommand, searchCommand, installCommand, uninstallCommand, upgradeCommand, toggleCommand, infoCommand, createCommand, rateCommand],
  action: async () => {
    output.printList([
            \`\${output.highlight('create')}    - Scaffold a new plugin project\`,
    ]);
  },
};
`;
  write(PLUGINS, vendor);
  write(path.join(path.dirname(path.dirname(path.dirname(path.dirname(PLUGINS)))),
    'package.json'), '{"type":"module"}\n');

  for (const host of ['claude', 'codex']) {
    write(path.join(BIN, host), fakeHost(host), 0o755);
    write(path.join(HOME, '.local', 'bin', host),
      fakeHost(host).replace('#!/usr/bin/env node', `#!${process.execPath}`), 0o755);
  }
}
const env = {
  ...process.env,
  HOME,
  PATH: `${BIN}${path.delimiter}${process.env.PATH || ''}`,
  RUFLO_SOURCE_PATCH_HOME: HOME,
  RUFLO_NPX_ROOT: NPX,
  RUFLO_GLOBAL_ROOT: path.join(SB, 'global'),
  RSP_HOST_STATE: STATE,
  RSP_HOST_CALLS: CALLS,
  RSP_MARKETPLACE_ROOT: MARKETPLACE,
  RSP_CODEX_MARKETPLACE_ROOT: CODEX_MARKETPLACE,
  RSP_CLAUDE_CACHE_ROOT: CLAUDE_CACHE,
  CODEX_HOME,
  RSP_NO_LAUNCHCTL: '1',
  RSP_NO_HOST_AUTO_UPDATE: '0',
};
function cli(...args) {
  return spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), ...args], {
    env, encoding: 'utf8',
  });
}
seed();
write(path.join(env.RSP_MARKETPLACE_ROOT, '.claude-plugin', 'marketplace.json'),
  `${JSON.stringify({
    name: 'ruflo',
    plugins: catalog.map((id) => ({ name: id.replace(/@ruflo$/, '') })),
  }, null, 2)}\n`);
for (const root of [MARKETPLACE, CODEX_MARKETPLACE]) {
  for (const pluginId of catalog) {
    const plugin = pluginId.replace(/@ruflo$/, '');
    write(path.join(root, 'plugins', plugin, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({ name: plugin, version: versions[pluginId] })}\n`);
    write(path.join(root, 'plugins', plugin, 'payload.txt'), 'current\n');
  }
}
for (const [pluginId, version] of [
  ['ruflo-core@ruflo', '0.2.0'],
  ['ruflo-swarm@ruflo', '0.2.1'],
  ['ruflo-uninstall@ruflo', '0.1.0'],
]) {
  write(path.join(CLAUDE_CACHE, pluginId.replace(/@ruflo$/, ''), version, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify({ name: pluginId.replace(/@ruflo$/, ''), version })}\n`);
  write(path.join(CLAUDE_CACHE, pluginId.replace(/@ruflo$/, ''), version, 'payload.txt'),
    pluginId === 'ruflo-core@ruflo' ? 'stale-version\n' : 'current\n');
}
for (const [pluginId, version] of [
  ['ruflo-core@ruflo', '0.2.0'],
  ['ruflo-uninstall@ruflo', '0.1.0'],
  ['ruflo-wasm@ruflo', '0.1.0'],
]) {
  const root = path.join(CODEX_HOME, 'plugins', 'cache', 'ruflo', pluginId.replace(/@ruflo$/, ''), version);
  write(path.join(root, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify({ name: pluginId.replace(/@ruflo$/, ''), version })}\n`);
  write(path.join(root, 'payload.txt'), pluginId === 'ruflo-core@ruflo' ? 'stale-version\n' : 'current\n');
}
write(path.join(CLAUDE_CACHE, 'ruflo-metaharness', '0.1.1', 'payload.txt'), 'stale\n');
write(path.join(CLAUDE_CACHE, 'ruflo-metaharness', '0.1.1', '.claude-plugin', 'plugin.json'),
  `${JSON.stringify({ name: 'ruflo-metaharness', version: '0.1.1' })}\n`);
write(path.join(CLAUDE_CACHE, 'ruflo-graph-intelligence', '0.1.0-alpha.1', 'payload.txt'),
  'stale-project\n');
write(path.join(
  CLAUDE_CACHE, 'ruflo-graph-intelligence', '0.1.0-alpha.1', '.claude-plugin', 'plugin.json',
), `${JSON.stringify({ name: 'ruflo-graph-intelligence', version: '0.1.0-alpha.1' })}\n`);
write(path.join(
  CODEX_HOME, 'plugins', 'cache', 'ruflo', 'ruflo-metaharness', '0.1.1', 'payload.txt',
), 'stale\n');
write(path.join(
  CODEX_HOME, 'plugins', 'cache', 'ruflo', 'ruflo-metaharness', '0.1.1', '.claude-plugin', 'plugin.json',
), `${JSON.stringify({ name: 'ruflo-metaharness', version: '0.1.1' })}\n`);

console.log('\nDual-host Ruflo plugin commands');
const pristine = fs.readFileSync(PLUGINS, 'utf8');
const installed = cli('plugin-hosts', 'install');
check('PH1 patch installs cleanly', installed.status === 0,
  `${installed.stdout}${installed.stderr}`);
const afterAutomaticUpdate = readState();
check('PH1a install automatically updates ordinary and same-version stale host copies',
  afterAutomaticUpdate.claude.some((row) => row.id === 'ruflo-core@ruflo' && row.version === '0.2.1')
    && afterAutomaticUpdate.codex.some((row) => row.id === 'ruflo-core@ruflo' && row.version === '0.2.1')
    && fs.readFileSync(path.join(CLAUDE_CACHE, 'ruflo-metaharness', '0.1.1', 'payload.txt'), 'utf8') === 'current\n'
    && fs.readFileSync(path.join(
      CLAUDE_CACHE, 'ruflo-graph-intelligence', '0.1.0-alpha.1', 'payload.txt',
    ), 'utf8') === 'current\n'
    && afterAutomaticUpdate.claude.some((row) => row.id === 'ruflo-graph-intelligence@ruflo'
      && row.scope === 'project' && row.projectPath === PROJECT)
    && fs.readFileSync(path.join(CODEX_HOME, 'plugins', 'cache', 'ruflo', 'ruflo-metaharness', '0.1.1', 'payload.txt'), 'utf8') === 'current\n',
  `${installed.stdout}${installed.stderr}`);
const patched = fs.readFileSync(PLUGINS, 'utf8');
check('PH2 exact Ruflo command layer is patched and backed up',
  patched.includes('ruflo-source-patch:patched')
    && patched.includes("name: 'host-install'")
    && patched.includes("name: 'host-uninstall'")
    && patched.includes("name: 'host-sync'")
    && patched.includes("name: 'host-refresh'")
    && patched.includes("name: 'host-update'")
    && fs.readFileSync(`${PLUGINS}.rsp-backup`, 'utf8') === pristine);
const status = cli('plugin-hosts', 'status');
check('PH3 status proves the target live', status.status === 0
  && /plugin-hosts\s+1\/1 file\(s\) satisfied \(1 patched, 0 native\)/.test(status.stdout),
`${status.stdout}${status.stderr}`);
const oldRevision = fs.readFileSync(PLUGINS, 'utf8')
  .replace('const __RSP_HOST_PLUGIN_REVISION = "2026-08-17.6";',
    'const __RSP_HOST_PLUGIN_REVISION = "2026-08-15.1";');
write(PLUGINS, oldRevision);
const staleRevisionStatus = cli('plugin-hosts', 'status');
const revisionUpgrade = cli('plugin-hosts', 'install');
const upgradedRevisionSource = fs.readFileSync(PLUGINS, 'utf8');
check('PH3a status rejects and install upgrades an obsolete injected-fragment revision',
  staleRevisionStatus.status !== 0
    && revisionUpgrade.status === 0
    && upgradedRevisionSource.includes('const __RSP_HOST_PLUGIN_REVISION = "2026-08-17.6";')
    && !upgradedRevisionSource.includes('const __RSP_HOST_PLUGIN_REVISION = "2026-08-15.1";'),
  `${staleRevisionStatus.stdout}${staleRevisionStatus.stderr}${revisionUpgrade.stdout}${revisionUpgrade.stderr}`);
Object.assign(process.env, env);
const module = await import(`${pathToFileURL(PLUGINS).href}?patched=${Date.now()}`);
const command = (name) => module.pluginsCommand.subcommands.find((item) => item.name === name);
check('PH4 all five commands are registered',
  ['host-install', 'host-uninstall', 'host-sync', 'host-refresh', 'host-update']
    .every((name) => command(name)));
const directHostPath = process.env.PATH;
process.env.PATH = ['/usr/bin', '/bin']
  .filter((entry, index, rows) => entry && rows.indexOf(entry) === index)
  .join(path.delimiter);
const userBinUpdate = await command('host-update').action({ flags: { format: 'json' } });
process.env.PATH = directHostPath;
check('PH4a host CLIs resolve from the user install root when noninteractive PATH omits it',
  userBinUpdate.success,
  JSON.stringify(userBinUpdate.data));
const migratedMarketplaceState = readState();
migratedMarketplaceState.claudeMarketplaceLocation = '/Users/previous-host/.claude/ruflo';
migratedMarketplaceState.codexMarketplaceRoot = '/Users/previous-host/.codex/ruflo';
writeState(migratedMarketplaceState);
const beforeMarketplaceRepair = calls().length;
const marketplaceRepair = await command('host-update').action({ flags: { format: 'json' } });
const repairedMarketplaceState = readState();
const marketplaceRepairCalls = calls().slice(beforeMarketplaceRepair);
const called = (host, argv) => marketplaceRepairCalls.some((entry) => entry[0] === host
  && entry.slice(1).join(' ') === argv);
check('PH4b stale canonical marketplace roots are repaired only through supported host CLIs',
  marketplaceRepair.success && repairedMarketplaceState.claudeMarketplaceLocation === MARKETPLACE
    && repairedMarketplaceState.codexMarketplaceRoot === CODEX_MARKETPLACE
    && called('claude', 'plugin marketplace remove ruflo --scope user')
    && called('claude', 'plugin marketplace add ruvnet/ruflo --scope user')
    && called('codex', 'plugin marketplace remove ruflo --json')
    && called('codex', 'plugin marketplace add ruvnet/ruflo --ref main'),
  JSON.stringify(marketplaceRepair.data));

const noncanonicalState = readState();
noncanonicalState.claudeMarketplaceRepo = 'example/ruflo-fork';
noncanonicalState.claudeMarketplaceLocation = '/Users/foreign/fork';
writeState(noncanonicalState);
const beforeMarketplaceRefusal = calls().length;
const marketplaceRefusal = await command('host-update').action({ flags: { format: 'json' } });
const marketplaceRefusalCalls = calls().slice(beforeMarketplaceRefusal);
check('PH4c a noncanonical marketplace using the Ruflo name is refused without mutation',
  !marketplaceRefusal.success && /noncanonical source/.test(marketplaceRefusal.data.error)
    && !marketplaceRefusalCalls.some((argv) =>
      ['add', 'remove', 'update', 'upgrade'].includes(argv[3])),
  JSON.stringify(marketplaceRefusal.data));
Object.assign(noncanonicalState, {
  claudeMarketplaceRepo: 'ruvnet/ruflo', claudeMarketplaceLocation: MARKETPLACE,
});
writeState(noncanonicalState);

const beforeIdempotentUpdate = calls().length;
const idempotentUpdate = await command('host-update').action({ flags: { format: 'json' } });
const updateMutations = calls().slice(beforeIdempotentUpdate).filter((argv) =>
  ['install', 'uninstall', 'add', 'remove', 'update'].includes(argv[2]));
check('PH4d automatic all-plugin update is idempotent and preserves disabled plugins',
  idempotentUpdate.success
    && updateMutations.length === 0
    && idempotentUpdate.data.entries.some((entry) => entry.pluginId === 'ruflo-adr@ruflo'
      && entry.hosts.claude.status === 'preserved-disabled'
      && entry.hosts.codex.status === 'preserved-disabled'),
  JSON.stringify(idempotentUpdate.data));
write(path.join(CLAUDE_CACHE, 'ruflo-metaharness', '0.1.1', 'payload.txt'), 'stale-again\n');
write(path.join(CODEX_HOME, 'plugins', 'cache', 'ruflo', 'ruflo-metaharness', '0.1.1', 'payload.txt'), 'stale-again\n');
const monitorInstall = cli('monitor', 'install');
check('PH4e patch-system self-update path also repairs stale host copies',
  monitorInstall.status === 0
    && fs.readFileSync(path.join(CLAUDE_CACHE, 'ruflo-metaharness', '0.1.1', 'payload.txt'), 'utf8') === 'current\n'
    && fs.readFileSync(path.join(CODEX_HOME, 'plugins', 'cache', 'ruflo', 'ruflo-metaharness', '0.1.1', 'payload.txt'), 'utf8') === 'current\n',
  `${monitorInstall.stdout}${monitorInstall.stderr}`);
const beforeDry = JSON.stringify(readState());
// Ruflo's parser canonicalizes --dry-run to camelCase before invoking the action.
const dry = await command('host-sync').action({ flags: { dryRun: true, format: 'json' } });
check('PH5 dry-run is additive, exact, and mutation-free',
  dry.success && JSON.stringify(dry.data.plan) === JSON.stringify(['ruflo-swarm@ruflo'])
    && dry.data.preserved.includes('ruflo-core@ruflo')
    && JSON.stringify(readState()) === beforeDry,
  JSON.stringify(dry.data));

const sync = await command('host-sync').action({ flags: { format: 'json' } });
const afterSync = readState();
check('PH6 sync adds only Claude-enabled gaps and preserves Codex-only plugins',
  sync.success
    && JSON.stringify(sync.data.installed) === JSON.stringify(['ruflo-swarm@ruflo'])
    && afterSync.codex.some((row) => row.id === 'ruflo-wasm@ruflo')
    && !afterSync.codex.some((row) => row.id === 'ruflo-failing@ruflo'),
  JSON.stringify(sync.data));
const repeat = await command('host-sync').action({ flags: { format: 'json' } });
check('PH7 repeated sync is an idempotent no-op',
  repeat.success && repeat.data.plan.length === 0 && repeat.data.installed.length === 0,
  JSON.stringify(repeat.data));

const install = await command('host-install').action({
  flags: { name: 'ruflo-neural', format: 'json' },
});
const afterInstall = readState();
check('PH8 host-install uses both public registries and verifies both postconditions',
  install.success
    && install.data.hosts.claude.status === 'installed'
    && install.data.hosts.codex.status === 'installed'
    && afterInstall.claude.some((row) =>
      row.id === 'ruflo-neural@ruflo' && row.scope === 'user')
    && afterInstall.codex.some((row) => row.id === 'ruflo-neural@ruflo'),
  JSON.stringify(install.data));

const disabled = await command('host-install').action({
  flags: { name: 'ruflo-adr', format: 'json' },
});
check('PH9 install preserves disabled state in both hosts',
  disabled.success
    && disabled.data.hosts.claude.status === 'preserved-disabled'
    && disabled.data.hosts.codex.status === 'preserved-disabled',
  JSON.stringify(disabled.data));

const callCount = calls().length;
let invalid;
try {
  await command('host-install').action({
    flags: { name: 'ruflo-swarm;touch-owned', format: 'json' },
  });
} catch (error) {
  invalid = error;
}
check('PH10 invalid plugin input is rejected before any process spawn',
  /invalid Ruflo marketplace plugin/.test(invalid?.message || '')
    && calls().length === callCount);

const failingState = readState();
failingState.failCodexAdd = ['ruflo-failing@ruflo'];
writeState(failingState);
const partial = await command('host-install').action({
  flags: { name: 'ruflo-failing', format: 'json' },
});
const afterPartial = readState();
check('PH11 a partial host failure is loud and never reported as success',
  !partial.success && partial.exitCode === 1
    && partial.data.hosts.claude.status === 'installed'
    && partial.data.hosts.codex.status === 'failed'
    && afterPartial.claude.some((row) =>
      row.id === 'ruflo-failing@ruflo' && row.scope === 'user')
    && !afterPartial.codex.some((row) => row.id === 'ruflo-failing@ruflo'),
  JSON.stringify(partial.data));

const removed = await command('host-uninstall').action({
  flags: { name: 'ruflo-uninstall', format: 'json' },
});
const afterRemove = readState();
check('PH12 uninstall removes only exact user/Codex ownership',
  removed.success
    && removed.data.hosts.claude.status === 'uninstalled'
    && removed.data.hosts.codex.status === 'uninstalled'
    && afterRemove.claude.some((row) =>
      row.id === 'ruflo-uninstall@ruflo' && row.scope === 'project')
    && !afterRemove.claude.some((row) =>
      row.id === 'ruflo-uninstall@ruflo' && row.scope === 'user')
    && !afterRemove.codex.some((row) => row.id === 'ruflo-uninstall@ruflo'),
  JSON.stringify(removed.data));
const removedAgain = await command('host-uninstall').action({
  flags: { name: 'ruflo-uninstall', format: 'json' },
});
check('PH13 repeated uninstall is idempotent',
  removedAgain.success
    && removedAgain.data.hosts.claude.status === 'already-absent'
    && removedAgain.data.hosts.codex.status === 'already-absent',
  JSON.stringify(removedAgain.data));

const refresh = await command('host-refresh').action({
  flags: { name: 'ruflo-metaharness', format: 'json' },
});
check('PH14 same-version refresh uses both host CLIs and proves current cache bytes',
  refresh.success
    && refresh.data.issue === 'ruvnet/ruflo#2870'
    && refresh.data.hosts.claude.status === 'refreshed'
    && refresh.data.hosts.codex.status === 'refreshed'
    && fs.readFileSync(path.join(
      CLAUDE_CACHE, 'ruflo-metaharness', '0.1.1', 'payload.txt',
    ), 'utf8') === 'current\n'
    && fs.readFileSync(path.join(
      CODEX_HOME, 'plugins', 'cache', 'ruflo', 'ruflo-metaharness', '0.1.1', 'payload.txt',
    ), 'utf8') === 'current\n',
  JSON.stringify(refresh.data));

write(path.join(
  CODEX_MARKETPLACE, 'plugins', 'ruflo-metaharness', 'payload.txt',
), 'newer\n');
const staleState = readState();
staleState.skipCodexCopy = true;
writeState(staleState);
const staleRefresh = await command('host-refresh').action({
  flags: { name: 'ruflo-metaharness', format: 'json' },
});
check('PH15 refresh fails loudly when a host reports reinstall but keeps stale bytes',
  !staleRefresh.success
    && staleRefresh.data.hosts.codex.status === 'failed'
    && /cache differs.*changed payload\.txt/.test(staleRefresh.data.hosts.codex.error),
  JSON.stringify(staleRefresh.data));

const upgradedState = readState();
upgradedState.skipCodexCopy = false;
upgradedState.refreshVersion = '0.1.2';
writeState(upgradedState);
const upgradedRefresh = await command('host-refresh').action({
  flags: { name: 'ruflo-metaharness', format: 'json' },
});
check('PH16 a version bump landing during refresh is accepted and verified',
  upgradedRefresh.success
    && upgradedRefresh.data.hosts.claude.status === 'upgraded'
    && upgradedRefresh.data.hosts.claude.version === '0.1.2'
    && upgradedRefresh.data.hosts.codex.status === 'upgraded'
    && upgradedRefresh.data.hosts.codex.version === '0.1.2',
  JSON.stringify(upgradedRefresh.data));

const beforeRefusals = calls().length;
const disabledRefresh = await command('host-refresh').action({
  flags: { name: 'ruflo-adr', format: 'json' },
});
const unknownRefresh = await command('host-refresh').action({
  flags: { name: 'ruflo-core', format: 'json' },
});
const refusalCalls = calls().slice(beforeRefusals);
check('PH17 refresh is bounded and refuses disabled or unaudited identities before mutation',
  !disabledRefresh.success
    && disabledRefresh.data.hosts.claude.status === 'refused-disabled'
    && !unknownRefresh.success
    && /not one of the audited/.test(unknownRefresh.data.error)
    && !refusalCalls.some((argv) =>
      argv.includes('update') || argv.includes('upgrade')
      || argv.includes('install') || argv.includes('uninstall')
      || argv.includes('add') || argv.includes('remove')),
  `${JSON.stringify(disabledRefresh.data)} ${JSON.stringify(unknownRefresh.data)}`);

const uninstalled = cli('plugin-hosts', 'uninstall');
check('PH18 patch uninstall restores pristine vendor bytes',
  uninstalled.status === 0
    && fs.readFileSync(PLUGINS, 'utf8') === pristine
    && !fs.existsSync(`${PLUGINS}.rsp-backup`),
  `${uninstalled.stdout}${uninstalled.stderr}`);

if (failures) {
  console.error(`\n${failures} plugin-host test(s) failed`);
  process.exit(1);
}
console.log('\nAll plugin-host tests passed');
