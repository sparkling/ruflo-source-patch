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

const SB = path.resolve(process.argv[2]);
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = path.join(SB, 'home');
const NPX = path.join(SB, 'npx');
const BIN = path.join(SB, 'bin');
const STATE = path.join(SB, 'host-state.json');
const CALLS = path.join(SB, 'host-calls.jsonl');
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

const catalog = [
  'ruflo-adr@ruflo',
  'ruflo-core@ruflo',
  'ruflo-failing@ruflo',
  'ruflo-neural@ruflo',
  'ruflo-swarm@ruflo',
  'ruflo-uninstall@ruflo',
  'ruflo-wasm@ruflo',
];

function seed() {
  fs.rmSync(SB, { recursive: true, force: true });
  fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
  write(path.join(HOME, '.claude', 'settings.json'), '{}\n');
  writeState({
    claudeMarketplace: true,
    codexMarketplace: true,
    catalog,
    claude: [
      { id: 'ruflo-core@ruflo', scope: 'user', enabled: true },
      { id: 'ruflo-swarm@ruflo', scope: 'user', enabled: true },
      { id: 'ruflo-adr@ruflo', scope: 'user', enabled: false },
      { id: 'ruflo-uninstall@ruflo', scope: 'user', enabled: true },
      { id: 'ruflo-uninstall@ruflo', scope: 'project', enabled: true },
    ],
    codex: [
      { id: 'ruflo-core@ruflo', enabled: true },
      { id: 'ruflo-adr@ruflo', enabled: false },
      { id: 'ruflo-uninstall@ruflo', enabled: true },
      { id: 'ruflo-wasm@ruflo', enabled: true },
    ],
    failCodexAdd: [],
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
  }
}

function fakeHost(host) {
  return `#!/usr/bin/env node
import fs from 'node:fs';
const host = ${JSON.stringify(host)};
const args = process.argv.slice(2);
const stateFile = process.env.RSP_HOST_STATE;
const callsFile = process.env.RSP_HOST_CALLS;
const read = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const save = (state) => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\\n');
const same = (...expected) => JSON.stringify(args) === JSON.stringify(expected);
fs.appendFileSync(callsFile, JSON.stringify([host, ...args]) + '\\n');
let state = read();
if (host === 'claude') {
  if (same('plugin', 'marketplace', 'list', '--json')) {
    process.stdout.write(JSON.stringify(state.claudeMarketplace
      ? [{ name: 'ruflo', installLocation: process.env.RSP_MARKETPLACE_ROOT }]
      : []));
  } else if (same('plugin', 'marketplace', 'add', 'ruvnet/ruflo')) {
    state.claudeMarketplace = true; save(state);
  } else if (same('plugin', 'list', '--json')) {
    process.stdout.write(JSON.stringify(state.claude));
  } else if (args[0] === 'plugin' && args[1] === 'install'
      && args[3] === '--scope' && args[4] === 'user') {
    if (!state.claude.some((row) => row.id === args[2] && row.scope === 'user')) {
      state.claude.push({ id: args[2], scope: 'user', enabled: true });
    }
    save(state);
  } else if (args[0] === 'plugin' && args[1] === 'uninstall'
      && args[3] === '--scope' && args[4] === 'user') {
    state.claude = state.claude.filter((row) =>
      !(row.id === args[2] && row.scope === 'user'));
    save(state);
  } else {
    process.stderr.write('unexpected claude argv: ' + JSON.stringify(args));
    process.exit(9);
  }
} else if (same('plugin', 'marketplace', 'list', '--json')) {
  process.stdout.write(JSON.stringify({
    marketplaces: state.codexMarketplace ? [{ name: 'ruflo' }] : [],
  }));
} else if (same('plugin', 'marketplace', 'add', 'ruvnet/ruflo', '--ref', 'main')) {
  state.codexMarketplace = true; save(state);
} else if (same('plugin', 'list', '--available', '--json')) {
  const installed = state.codex.map((row) => ({
    pluginId: row.id, marketplaceName: 'ruflo', installed: true, enabled: row.enabled,
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
    state.codex.push({ id: args[2], enabled: true });
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

const env = {
  ...process.env,
  PATH: `${BIN}${path.delimiter}${process.env.PATH || ''}`,
  RUFLO_SOURCE_PATCH_HOME: HOME,
  RUFLO_NPX_ROOT: NPX,
  RUFLO_GLOBAL_ROOT: path.join(SB, 'global'),
  RSP_HOST_STATE: STATE,
  RSP_HOST_CALLS: CALLS,
  RSP_MARKETPLACE_ROOT: path.join(SB, 'marketplace'),
  RSP_NO_LAUNCHCTL: '1',
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

console.log('\nDual-host Ruflo plugin commands');
const pristine = fs.readFileSync(PLUGINS, 'utf8');
const installed = cli('plugin-hosts', 'install');
check('PH1 patch installs cleanly', installed.status === 0,
  `${installed.stdout}${installed.stderr}`);
const patched = fs.readFileSync(PLUGINS, 'utf8');
check('PH2 exact Ruflo command layer is patched and backed up',
  patched.includes('ruflo-source-patch:patched')
    && patched.includes("name: 'host-install'")
    && patched.includes("name: 'host-uninstall'")
    && patched.includes("name: 'host-sync'")
    && fs.readFileSync(`${PLUGINS}.rsp-backup`, 'utf8') === pristine);
const status = cli('plugin-hosts', 'status');
check('PH3 status proves the target live', status.status === 0
  && /plugin-hosts\s+1\/1 file\(s\) patched/.test(status.stdout),
`${status.stdout}${status.stderr}`);

Object.assign(process.env, env);
const module = await import(`${pathToFileURL(PLUGINS).href}?patched=${Date.now()}`);
const command = (name) => module.pluginsCommand.subcommands.find((item) => item.name === name);
check('PH4 all three commands are registered',
  ['host-install', 'host-uninstall', 'host-sync'].every((name) => command(name)));

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

const uninstalled = cli('plugin-hosts', 'uninstall');
check('PH14 patch uninstall restores pristine vendor bytes',
  uninstalled.status === 0
    && fs.readFileSync(PLUGINS, 'utf8') === pristine
    && !fs.existsSync(`${PLUGINS}.rsp-backup`),
  `${uninstalled.stdout}${uninstalled.stderr}`);

if (failures) {
  console.error(`\n${failures} plugin-host test(s) failed`);
  process.exit(1);
}
console.log('\nAll plugin-host tests passed');
