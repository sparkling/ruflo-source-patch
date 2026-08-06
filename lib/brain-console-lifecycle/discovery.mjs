// Installed, executable RuvNet Brain surfaces that carry the Console server or its doctor.

import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_ROOTS, HOME_BASE, NPX_ROOT } from '../cwd/paths.mjs';

const OWNED = 'ruflo-source-patch (stuinfla/ruvnet-brain#79)';

function packageVersion(file) {
  try { return JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(file)), 'package.json'), 'utf8')).version; }
  catch { return null; }
}

function addRoot(found, root) {
  try {
    if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name !== 'ruvnet-brain') return;
  } catch { return; }
  for (const rel of [['scripts', 'onboarding-console.mjs'], ['bin', 'install.mjs']]) {
    const file = path.join(root, ...rel);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink()) found.push(file);
    } catch { /* incomplete surface */ }
  }
}

function addVersions(found, root) {
  try { for (const version of fs.readdirSync(root)) addRoot(found, path.join(root, version)); }
  catch { /* host cache absent */ }
}

export function discover() {
  const found = [];
  const marketplace = process.env.RSP_RUVNET_BRAIN_MARKETPLACE
    || path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain');
  const brainHome = process.env.RSP_RUVNET_BRAIN_HOME || path.join(HOME_BASE, '.cache', 'ruvnet-brain');
  addRoot(found, marketplace);
  addRoot(found, path.join(HOME_BASE, '.codex', 'plugins', 'marketplaces', 'ruvnet-brain'));
  addVersions(found, path.join(HOME_BASE, '.claude', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain'));
  addVersions(found, path.join(HOME_BASE, '.codex', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain'));
  for (const root of GLOBAL_ROOTS) addRoot(found, path.join(root, 'ruvnet-brain'));
  try {
    for (const hash of fs.readdirSync(NPX_ROOT)) addRoot(found, path.join(NPX_ROOT, hash, 'node_modules', 'ruvnet-brain'));
  } catch { /* npx cache absent */ }
  const persistent = path.join(brainHome, 'kb', '.console-runtime');
  addRoot(found, persistent);
  const currentVersion = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(persistent, 'package.json'), 'utf8')).version; }
    catch { return null; }
  })();
  return [...new Set(found)].filter((file) => {
    if (!currentVersion || packageVersion(file) === currentVersion) return true;
    try { return fs.readFileSync(file, 'utf8').includes(OWNED); }
    catch { return false; }
  });
}
