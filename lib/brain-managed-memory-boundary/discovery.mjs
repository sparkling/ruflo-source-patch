// Resolve only the Brain generation selected by native active.json, matching host copies, the
// native persistent MCP shell, and older roots that already carry this target's ownership marker.
// No version is selected, downloaded, promoted, pinned, or inferred here.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import { PATCH_MARKER, VENDOR_SPECS } from './transforms.mjs';

const FULL_ADDITIVES = [
  'scripts/managed-memory-policy.mjs',
  'scripts/managed-memory-gate.mjs',
  'mcp/managed-memory-diagnostic.mjs',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function regular(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch { return false; }
}

function pluginIdentity(root) {
  try {
    const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json'));
    if (manifest?.name !== 'ruvnet-brain'
        || typeof manifest.version !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(manifest.version)) return null;
    return manifest;
  } catch { return null; }
}

function fullSurface(root, expectedVersion, label) {
  const requested = path.resolve(root);
  let resolved;
  try { resolved = fs.realpathSync(requested); } catch { return null; }
  if (resolved !== requested) return null;
  const manifest = pluginIdentity(resolved);
  if (!manifest || (expectedVersion && manifest.version !== expectedVersion)) return null;
  if (!VENDOR_SPECS.every((spec) => regular(path.join(resolved, spec.relative)))) return null;
  if (!regular(path.join(resolved, 'scripts', 'hook-input.mjs'))) return null;
  return { root: resolved, version: manifest.version, label, kind: 'full' };
}

function persistentMcpSurface(root) {
  const requested = path.resolve(root);
  let resolved;
  try { resolved = fs.realpathSync(requested); } catch { return null; }
  if (resolved !== requested) return null;
  const server = path.join(resolved, 'mcp', 'server.mjs');
  const managed = path.join(resolved, 'mcp', 'managed-cli-interface.mjs');
  if (!regular(server) || !regular(managed)) return null;
  try {
    const source = fs.readFileSync(server, 'utf8');
    if (!source.includes('ruvnet-brain MCP server')
        || !source.includes("from './managed-cli-interface.mjs'")) return null;
  } catch { return null; }
  return { root: resolved, version: 'persistent', label: 'persistent MCP shell', kind: 'mcp' };
}

function owned(root, kind = 'full') {
  const relatives = kind === 'mcp'
    ? ['mcp/server.mjs', 'mcp/managed-memory-diagnostic.mjs', 'scripts/managed-memory-policy.mjs']
    : [...VENDOR_SPECS.map((spec) => spec.relative), ...FULL_ADDITIVES];
  return relatives.some((relative) => {
    try { return fs.readFileSync(path.join(root, relative), 'utf8').includes(PATCH_MARKER); }
    catch { return false; }
  });
}

function versionDirs(base) {
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(base, entry.name));
  } catch { return []; }
}

export function resolveActive() {
  const brainHome = path.resolve(process.env.RSP_RUVNET_BRAIN_HOME
    || path.join(HOME_BASE, '.cache', 'ruvnet-brain'));
  const activeFile = path.join(brainHome, 'active.json');
  const active = readJson(activeFile);
  if (typeof active?.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(active.version)
      || typeof active?.codeRoot !== 'string' || !active.codeRoot) {
    throw new Error(`${activeFile} does not name a valid native version and codeRoot`);
  }
  const versions = fs.realpathSync(path.join(brainHome, 'versions'));
  const root = fs.realpathSync(path.resolve(brainHome, active.codeRoot));
  if (!inside(versions, root)) throw new Error(`${activeFile} codeRoot escapes the native versions directory`);
  const surface = fullSurface(root, active.version, `native active generation ${active.version}`);
  if (!surface) throw new Error(`native active generation ${active.version} is incomplete or has a mismatched manifest`);
  return { brainHome, active, surface };
}

export function discover({ includeOwned = true } = {}) {
  const { brainHome, active, surface } = resolveActive();
  const found = new Map([[surface.root, surface]]);
  const addFull = (root, expectedVersion, label, requireOwned = false) => {
    const candidate = fullSurface(root, expectedVersion, label);
    if (candidate && (!requireOwned || owned(candidate.root))) found.set(candidate.root, candidate);
  };

  const claudeCache = path.join(HOME_BASE, '.claude', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain');
  const codexCache = path.join(
    process.env.RSP_CODEX_HOME || process.env.CODEX_HOME || path.join(HOME_BASE, '.codex'),
    'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain',
  );
  addFull(path.join(claudeCache, active.version), active.version, `Claude cache ${active.version}`);
  addFull(path.join(codexCache, active.version), active.version, `Codex cache ${active.version}`);

  const claudeMarketplace = path.resolve(process.env.RSP_RUVNET_BRAIN_MARKETPLACE
    || path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain'));
  addFull(path.join(claudeMarketplace, 'plugin'), active.version, 'Claude marketplace plugin');
  addFull(path.join(HOME_BASE, '.codex', 'plugins', 'marketplaces', 'ruvnet-brain', 'plugin'),
    active.version, 'Codex marketplace plugin');

  const runtimeRoot = path.resolve(process.env.RSP_RUVNET_BRAIN_RUNTIME
    || path.join(HOME_BASE, '.claude', 'ruvnet-brain'));
  const runtime = persistentMcpSurface(runtimeRoot);
  if (runtime) found.set(runtime.root, runtime);

  if (includeOwned) {
    for (const root of versionDirs(path.join(brainHome, 'versions'))) {
      addFull(root, null, `owned native generation ${path.basename(root)}`, true);
    }
    for (const root of versionDirs(claudeCache)) addFull(root, null, `owned Claude cache ${path.basename(root)}`, true);
    for (const root of versionDirs(codexCache)) addFull(root, null, `owned Codex cache ${path.basename(root)}`, true);
    addFull(path.join(claudeMarketplace, 'plugin'), null, 'owned Claude marketplace plugin', true);
    addFull(path.join(HOME_BASE, '.codex', 'plugins', 'marketplaces', 'ruvnet-brain', 'plugin'),
      null, 'owned Codex marketplace plugin', true);
  }
  return [...found.values()];
}

export function surfaceFiles(surface) {
  const vendor = surface.kind === 'mcp'
    ? VENDOR_SPECS.filter((spec) => spec.id === 'mcp')
    : VENDOR_SPECS;
  const additive = surface.kind === 'mcp'
    ? ['scripts/managed-memory-policy.mjs', 'mcp/managed-memory-diagnostic.mjs']
    : FULL_ADDITIVES;
  return { vendor, additive };
}
