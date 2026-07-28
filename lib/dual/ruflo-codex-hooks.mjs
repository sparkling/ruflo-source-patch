#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const PREFIX = '[ruflo-codex-hooks]';
const MARKETPLACE_NAME = 'ruflo';
const MARKETPLACE_SOURCE = 'ruvnet/ruflo';
const PLUGIN_ID = 'ruflo-core@ruflo';
const CODEX_BIN = process.env.RSP_CODEX_BIN || 'codex';
const TIMEOUT_MS = 120_000;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const unknown = argv.filter((arg) => arg !== '--dry-run');
  if (unknown.length) {
    fail(`unknown argument(s): ${unknown.join(', ')}; usage: ruflo-codex-hooks [--dry-run]`);
  }
  return { dryRun: argv.includes('--dry-run') };
}

function commandResult(args) {
  const options = {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    windowsHide: true,
  };
  if (process.platform === 'win32') {
    const command = [CODEX_BIN, ...args].join(' ');
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], options);
  }
  return spawnSync(CODEX_BIN, args, options);
}

function runJson(args, description) {
  const result = commandResult(args);
  if (result.error) {
    fail(`${description} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    fail(`${description} exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`${description} returned invalid JSON`);
  }
}

function marketplaceRows(value) {
  if (!value || !Array.isArray(value.marketplaces)) {
    fail('Codex marketplace list returned an unexpected JSON shape');
  }
  return value.marketplaces;
}

function pluginRows(value) {
  if (!value || !Array.isArray(value.installed) || !Array.isArray(value.available)) {
    fail('Codex plugin list returned an unexpected JSON shape');
  }
  return value;
}

function canonicalMarketplace(row) {
  const source = row?.marketplaceSource;
  if (!source || source.sourceType !== 'git' || typeof source.source !== 'string') return false;
  const normalized = source.source
    .trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return normalized === 'https://github.com/ruvnet/ruflo'
    || normalized === 'ruvnet/ruflo';
}

function listMarketplaces() {
  return marketplaceRows(runJson(
    ['plugin', 'marketplace', 'list', '--json'],
    'Codex marketplace inspection',
  ));
}

function listPlugins() {
  return pluginRows(runJson(
    ['plugin', 'list', '--available', '--json'],
    'Codex plugin inspection',
  ));
}

function findPlugin(rows) {
  return rows.find((row) => row?.pluginId === PLUGIN_ID);
}

function printTrustAction() {
  console.log(`${PREFIX} ACTION REQUIRED: start a new Codex session, open /hooks, review the ${PLUGIN_ID} hook definitions, and trust them.`);
  console.log(`${PREFIX} Use “trust all” only when every pending definition is from Ruflo; otherwise trust the Ruflo definitions individually.`);
}

function repair({ dryRun }) {
  let marketplaces = listMarketplaces();
  let marketplace = marketplaces.find((row) => row?.name === MARKETPLACE_NAME);

  if (marketplace && !canonicalMarketplace(marketplace)) {
    fail(`marketplace name "${MARKETPLACE_NAME}" is already owned by a non-canonical source; refusing to overwrite it`);
  }

  if (!marketplace) {
    if (dryRun) {
      console.log(`${PREFIX} DRY RUN: would add marketplace ${MARKETPLACE_SOURCE} at ref main`);
      console.log(`${PREFIX} DRY RUN: would install ${PLUGIN_ID}`);
      return;
    }
    console.log(`${PREFIX} adding canonical marketplace ${MARKETPLACE_SOURCE} at ref main`);
    runJson(
      ['plugin', 'marketplace', 'add', MARKETPLACE_SOURCE, '--ref', 'main', '--json'],
      'Codex marketplace registration',
    );
    marketplaces = listMarketplaces();
    marketplace = marketplaces.find((row) => row?.name === MARKETPLACE_NAME);
    if (!marketplace || !canonicalMarketplace(marketplace)) {
      fail('Codex reported marketplace registration success, but the canonical ruflo marketplace is absent');
    }
  }

  const before = listPlugins();
  const installed = findPlugin(before.installed);
  if (installed) {
    if (installed.enabled === false) {
      console.log(`${PREFIX} ${PLUGIN_ID} is installed but disabled; preserving that user choice. Ruflo lifecycle hooks remain inactive.`);
      return;
    }
    if (installed.enabled !== true) {
      fail(`${PLUGIN_ID} has an indeterminate enabled state`);
    }
    console.log(`${PREFIX} ${PLUGIN_ID} is already installed and enabled`);
    printTrustAction();
    return;
  }

  if (!findPlugin(before.available)) {
    fail(`${PLUGIN_ID} is not available from the canonical ruflo marketplace`);
  }
  if (dryRun) {
    console.log(`${PREFIX} DRY RUN: would install ${PLUGIN_ID}`);
    return;
  }

  console.log(`${PREFIX} installing ${PLUGIN_ID}`);
  runJson(
    ['plugin', 'add', PLUGIN_ID, '--json'],
    'Codex plugin installation',
  );
  const after = listPlugins();
  const verified = findPlugin(after.installed);
  if (!verified || verified.enabled !== true) {
    fail(`Codex reported plugin installation success, but ${PLUGIN_ID} is not installed and enabled`);
  }
  console.log(`${PREFIX} installed and verified ${PLUGIN_ID}`);
  printTrustAction();
}

try {
  repair(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(`${PREFIX} INCOMPLETE — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
