// Existing-system repair for ruvnet/ruflo#2801. Everything external is fake:
// no test may change the developer's Codex marketplaces, plugins, or MCP registry.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SB = fs.realpathSync(process.argv[2]);
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = path.join(SB, 'home');
const STATE = path.join(SB, 'codex-state.json');
const LOG = path.join(SB, 'codex-argv.jsonl');
const FAKE_CODEX = path.join(SB, 'fake-codex');
const CLI = path.join(REPO, 'bin', 'cli.mjs');
const STABLE = path.join(HOME, '.ruflo-source-patch', 'ruflo-codex-hooks');

fs.mkdirSync(HOME, { recursive: true });

function fail(message) {
  console.error(`\n✘ ${message}\n`);
  process.exit(1);
}

function output(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function writeState(value) {
  fs.writeFileSync(STATE, `${JSON.stringify(value, null, 2)}\n`);
}

function readState() {
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}

function canonicalMarketplace() {
  return {
    name: 'ruflo',
    root: '/fake/cache/ruflo',
    marketplaceSource: {
      sourceType: 'git',
      source: 'https://github.com/ruvnet/ruflo.git',
    },
  };
}

function plugin(enabled, installed = true) {
  return {
    pluginId: 'ruflo-core@ruflo',
    name: 'ruflo-core',
    marketplaceName: 'ruflo',
    version: '0.2.4',
    installed,
    enabled,
  };
}

function baseState() {
  return {
    marketplaces: [{
      name: 'unrelated',
      root: '/fake/unrelated',
      marketplaceSource: { sourceType: 'local', source: '/fake/unrelated' },
    }],
    installed: [{
      pluginId: 'unrelated@unrelated',
      name: 'unrelated',
      marketplaceName: 'unrelated',
      version: '1.0.0',
      installed: true,
      enabled: true,
    }],
    available: [],
    mcpRegistry: {
      ruflo: {
        command: 'npx',
        args: ['-y', 'ruflo@latest', 'mcp', 'start'],
        startup_timeout_sec: 120,
      },
    },
  };
}

fs.writeFileSync(FAKE_CODEX, `#!${process.execPath}
const fs = require('node:fs');
const stateFile = process.env.RSP_FAKE_CODEX_STATE;
const logFile = process.env.RSP_FAKE_CODEX_LOG;
const mode = process.env.RSP_FAKE_CODEX_MODE || '';
const args = process.argv.slice(2);
fs.appendFileSync(logFile, JSON.stringify(args) + '\\n');
let state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\\n');
const send = (value) => { process.stdout.write(JSON.stringify(value)); process.exit(0); };
const canonical = {
  name: 'ruflo',
  root: '/fake/cache/ruflo',
  marketplaceSource: { sourceType: 'git', source: 'https://github.com/ruvnet/ruflo.git' },
};
const available = {
  pluginId: 'ruflo-core@ruflo', name: 'ruflo-core', marketplaceName: 'ruflo',
  version: '0.2.4', installed: false, enabled: false,
};
if (args[0] === 'mcp') process.exit(90);
if (args[0] !== 'plugin') process.exit(91);
if (args[1] === 'marketplace' && args[2] === 'list') {
  if (mode === 'marketplace-list-fail') process.exit(12);
  if (mode === 'invalid-json') { process.stdout.write('{broken'); process.exit(0); }
  send({ marketplaces: state.marketplaces });
}
if (args[1] === 'marketplace' && args[2] === 'add') {
  if (mode === 'marketplace-add-fail') process.exit(13);
  if (args[3] !== 'ruvnet/ruflo' || !args.includes('--ref') || !args.includes('main')) process.exit(92);
  if (mode !== 'marketplace-add-no-post') {
    state.marketplaces.push(canonical);
    state.available.push(available);
    save();
  }
  send({ added: 'ruflo' });
}
if (args[1] === 'list') {
  if (mode === 'plugin-list-fail') process.exit(14);
  send({ installed: state.installed, available: state.available });
}
if (args[1] === 'add') {
  if (mode === 'plugin-add-fail') process.exit(15);
  if (args[2] !== 'ruflo-core@ruflo') process.exit(93);
  if (mode !== 'plugin-add-no-post') {
    state.available = state.available.filter((row) => row.pluginId !== args[2]);
    state.installed.push({ ...available, installed: true, enabled: true });
    save();
  }
  send({ installed: args[2] });
}
process.exit(94);
`);
fs.chmodSync(FAKE_CODEX, 0o755);

const env = {
  ...process.env,
  HOME,
  RUFLO_SOURCE_PATCH_HOME: HOME,
  RUFLO_NPX_ROOT: path.join(SB, 'no-npx'),
  RUFLO_GLOBAL_ROOT: path.join(SB, 'no-global'),
  RSP_CODEX_BIN: FAKE_CODEX,
  RSP_NODE_BIN: process.execPath,
  RSP_FAKE_CODEX_STATE: STATE,
  RSP_FAKE_CODEX_LOG: LOG,
  RSP_NO_LAUNCHCTL: '1',
  RSP_NO_SELF_UPDATE: '1',
};

function cli(args, extraEnv = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
    timeout: 20_000,
  });
}

function loggedArgs() {
  try {
    return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch {
    return [];
  }
}

function reset(value = baseState()) {
  writeState(value);
  fs.writeFileSync(LOG, '');
}

console.log('\nRuflo Codex hook repair target');

reset();
const install = cli(['ruflo-codex-hooks', 'install']);
if (install.status !== 0) fail(`RH1 materialization failed:\n${output(install)}`);
for (const file of ['ruflo-codex-hooks.sh', 'ruflo-codex-hooks.mjs']) {
  if (!fs.existsSync(path.join(STABLE, file))) fail(`RH1 did not materialize ${file}`);
}
if (!/installed, current/.test(output(cli(['ruflo-codex-hooks', 'status'])))) {
  fail('RH1 status did not report the fresh materialization as current');
}
fs.appendFileSync(path.join(STABLE, 'ruflo-codex-hooks.mjs'), '\n// stale\n');
if (!/STALE/.test(output(cli(['ruflo-codex-hooks', 'status'])))) {
  fail('RH1 status did not detect a stale materialized repair script');
}

reset();
const fresh = cli(['ruflo-codex-hooks', 'run']);
if (fresh.status !== 0) fail(`RH2 fresh repair failed:\n${output(fresh)}`);
const repaired = readState();
if (!repaired.marketplaces.some((row) => row.name === 'ruflo')) fail('RH2 canonical marketplace was not added');
if (!repaired.installed.some((row) => row.pluginId === 'ruflo-core@ruflo' && row.enabled === true)) {
  fail('RH2 canonical plugin was not installed and enabled');
}
if (!repaired.installed.some((row) => row.pluginId === 'unrelated@unrelated')) {
  fail('RH2 unrelated plugin state was not preserved');
}
if (JSON.stringify(repaired.mcpRegistry) !== JSON.stringify(baseState().mcpRegistry)) {
  fail('RH2 the existing MCP registry changed');
}
if (loggedArgs().some((args) => args.includes('mcp'))) fail('RH2 repair issued a Codex MCP command');
if (!output(fresh).includes('ACTION REQUIRED: start a new Codex session, open /hooks')) {
  fail('RH2 successful repair omitted the required new-session /hooks trust message');
}

const beforeRepeat = fs.readFileSync(STATE);
fs.writeFileSync(LOG, '');
const repeat = cli(['ruflo-codex-hooks', 'run']);
if (repeat.status !== 0) fail(`RH3 idempotent repair failed:\n${output(repeat)}`);
if (!fs.readFileSync(STATE).equals(beforeRepeat)) fail('RH3 idempotent repair rewrote Codex state');
if (loggedArgs().some((args) => args[1] === 'add' || args[2] === 'add')) {
  fail('RH3 idempotent repair repeated a marketplace/plugin mutation');
}

const disabledState = baseState();
disabledState.marketplaces.push(canonicalMarketplace());
disabledState.installed.push(plugin(false));
reset(disabledState);
const disabledBefore = fs.readFileSync(STATE);
const disabled = cli(['ruflo-codex-hooks', 'run']);
if (disabled.status !== 0) fail(`RH4 disabled preservation failed:\n${output(disabled)}`);
if (!fs.readFileSync(STATE).equals(disabledBefore)) fail('RH4 disabled plugin state was changed');
if (!output(disabled).includes('preserving that user choice')) fail('RH4 disabled state was not reported plainly');

const collisionState = baseState();
collisionState.marketplaces.push({
  name: 'ruflo',
  root: '/someone/else',
  marketplaceSource: { sourceType: 'local', source: '/someone/else' },
});
reset(collisionState);
const collisionBefore = fs.readFileSync(STATE);
const collision = cli(['ruflo-codex-hooks', 'run']);
if (collision.status === 0 || !output(collision).includes('INCOMPLETE')) {
  fail(`RH5 marketplace collision did not fail loudly:\n${output(collision)}`);
}
if (!fs.readFileSync(STATE).equals(collisionBefore)) fail('RH5 marketplace collision changed Codex state');

reset();
const dryBefore = fs.readFileSync(STATE);
const dry = cli(['ruflo-codex-hooks', 'run', '--dry-run']);
if (dry.status !== 0 || !output(dry).includes('would install ruflo-core@ruflo')) {
  fail(`RH6 dry run did not report the full plan:\n${output(dry)}`);
}
if (!fs.readFileSync(STATE).equals(dryBefore)) fail('RH6 dry run changed Codex state');
if (loggedArgs().some((args) => args[1] === 'add' || args[2] === 'add')) fail('RH6 dry run invoked a mutator');

for (const mode of [
  'invalid-json',
  'marketplace-list-fail',
  'marketplace-add-fail',
  'marketplace-add-no-post',
]) {
  reset();
  const result = cli(['ruflo-codex-hooks', 'run'], { RSP_FAKE_CODEX_MODE: mode });
  if (result.status === 0 || !output(result).includes('INCOMPLETE')) {
    fail(`RH7 ${mode} looked successful:\n${output(result)}`);
  }
}

for (const mode of ['plugin-list-fail', 'plugin-add-fail', 'plugin-add-no-post']) {
  const state = baseState();
  state.marketplaces.push(canonicalMarketplace());
  state.available.push(plugin(false, false));
  reset(state);
  const result = cli(['ruflo-codex-hooks', 'run'], { RSP_FAKE_CODEX_MODE: mode });
  if (result.status === 0 || !output(result).includes('INCOMPLETE')) {
    fail(`RH8 ${mode} looked successful:\n${output(result)}`);
  }
}

const unknown = cli(['ruflo-codex-hooks', 'run', '--surprise']);
if (unknown.status === 0 || !output(unknown).includes('unknown argument')) {
  fail('RH9 an unknown repair argument did not fail');
}

const uninstall = cli(['ruflo-codex-hooks', 'uninstall']);
if (uninstall.status !== 0 || fs.existsSync(STABLE)) fail('RH10 uninstall did not remove only the materialized target');

console.log('✔ ruflo-codex-hooks (materialization/drift, fresh install, idempotency, disabled preservation, collision refusal, dry-run, loud failures, no MCP mutation, uninstall)');
