// RuvNet Brain #81: the standalone memory-doctor must not equate an empty ~/Code with an empty
// AgentDB fleet. The Console already scans common/configured roots; this target applies that same
// read-only discovery policy to memory-doctor.mjs without touching Brain's updater or memory data.

import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_ROOTS, HOME_BASE, NPX_ROOT } from '../cwd/paths.mjs';

export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#81)';

const HOME_ORIGINAL = `const HOME = os.homedir();`;
const HOME_PATCHED = `const HOME = os.homedir();

// ${PATCH_MARKER}: #19 fixed Console discovery but left the standalone doctor on ~/Code.
// Keep the same common/configured roots here so a fleet count measures the machine it describes.
const MEMORY_DOCTOR_DEFAULT_ROOTS = ['Code', 'code', 'src', 'source', 'projects', 'dev', 'work'];
const MEMORY_DOCTOR_CONFIG = path.join(HOME, '.claude', 'ruvnet-brain', 'config.json');
function memoryDoctorCandidateRoots() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(MEMORY_DOCTOR_CONFIG, 'utf8')); } catch { /* absent or invalid config -> defaults */ }
  const hasOverride = Array.isArray(cfg.scanRoots) && cfg.scanRoots.length > 0;
  const configured = hasOverride
    ? cfg.scanRoots.filter((root) => typeof root === 'string' && root.length > 0 && root.length < 4096)
      .map((root) => (path.isAbsolute(root) ? root : path.join(HOME, root)))
    : MEMORY_DOCTOR_DEFAULT_ROOTS.map((root) => path.join(HOME, root));
  if (hasOverride && configured.length === 0) {
    throw new Error('configured scanRoots contains no valid directory paths');
  }
  const seen = new Set();
  const roots = [];
  for (const candidate of configured) {
    let resolved;
    try {
      resolved = fs.realpathSync(path.resolve(candidate));
      if (!fs.statSync(resolved).isDirectory()) continue;
    } catch { continue; }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    roots.push(resolved);
  }
  if (hasOverride && roots.length === 0) {
    throw new Error('none of the configured scanRoots directories exists');
  }
  return roots;
}`;

const SIGNATURE_ORIGINAL = `export function findStores(root = path.join(HOME, 'Code')) {`;
const SIGNATURE_PATCHED = `export function findStores(root) {`;

const WALK_ORIGINAL = `  walk(root, 0);`;
const WALK_PATCHED = `  const roots = root === undefined
    ? memoryDoctorCandidateRoots()
    : [path.resolve(root)];
  for (const scanRoot of roots) walk(scanRoot, 0);`;

const STORE_SETUP_ORIGINAL = `  const out = [];`;
const STORE_SETUP_PATCHED = `  const out = [];
  const seenStores = new Set();
  const addStore = (db) => {
    let canonical;
    try { canonical = fs.realpathSync(db); } catch { return; }
    if (seenStores.has(canonical)) return;
    seenStores.add(canonical);
    out.push(canonical);
  };`;

const STORE_FOUND_ORIGINAL = `        if (fs.existsSync(db)) out.push(db);`;
const STORE_FOUND_PATCHED = `        addStore(db);`;

const EXTRA_FOUND_ORIGINAL = `    if (fs.existsSync(extra) && !out.includes(extra)) out.push(extra);`;
const EXTRA_FOUND_PATCHED = `    addStore(extra);`;

const EDITS = [
  ['candidate-roots', HOME_ORIGINAL, HOME_PATCHED,
    (source) => source.includes(HOME_PATCHED)],
  ['optional-root', SIGNATURE_ORIGINAL, SIGNATURE_PATCHED,
    (source) => source.includes(SIGNATURE_PATCHED)],
  ['fleet-walk', WALK_ORIGINAL, WALK_PATCHED,
    (source) => source.includes(WALK_PATCHED)],
  ['store-dedup', STORE_SETUP_ORIGINAL, STORE_SETUP_PATCHED,
    (source) => source.includes(STORE_SETUP_PATCHED)],
  ['store-canonical', STORE_FOUND_ORIGINAL, STORE_FOUND_PATCHED,
    (source) => source.includes(STORE_FOUND_PATCHED)],
  ['extra-canonical', EXTRA_FOUND_ORIGINAL, EXTRA_FOUND_PATCHED,
    (source) => source.includes(EXTRA_FOUND_PATCHED)],
];

const occurrences = (source, needle) => {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    count++;
    offset += needle.length;
  }
  return count;
};

export function patchSource(pristine) {
  let next = pristine;
  const applied = [];
  const missing = [];
  for (const [id, find, replace, done] of EDITS) {
    if (done(next)) continue;
    const count = occurrences(next, find);
    if (count === 1) {
      next = next.replace(find, replace);
      applied.push(id);
    } else {
      missing.push(count > 1 ? `${id}(AMBIGUOUS: anchor occurs ${count}x)` : id);
    }
  }
  return { next, applied, missing };
}

export function reverseSource(patched) {
  let candidate = patched;
  for (const [, find, replace] of [...EDITS].reverse()) {
    if (occurrences(candidate, replace) === 1) candidate = candidate.replace(replace, find);
  }
  return candidate;
}

export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => EDITS.every(([, , , done]) => done(source));

function addRoot(found, root) {
  try {
    if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name !== 'ruvnet-brain') return;
  } catch { return; }
  const file = path.join(root, 'scripts', 'memory-doctor.mjs');
  try {
    const stat = fs.lstatSync(file);
    if (stat.isFile() && !stat.isSymbolicLink()) found.push(file);
  } catch { /* incomplete surface */ }
}

function addVersions(found, root) {
  try {
    for (const version of fs.readdirSync(root)) addRoot(found, path.join(root, version));
  } catch { /* host cache absent */ }
}

export function discover() {
  const found = [];
  const marketplace = process.env.RSP_RUVNET_BRAIN_MARKETPLACE
    || path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain');
  const brainHome = process.env.RSP_RUVNET_BRAIN_HOME
    || path.join(HOME_BASE, '.cache', 'ruvnet-brain');
  addRoot(found, marketplace);
  addRoot(found, path.join(HOME_BASE, '.codex', 'plugins', 'marketplaces', 'ruvnet-brain'));
  addVersions(found, path.join(HOME_BASE, '.claude', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain'));
  addVersions(found, path.join(HOME_BASE, '.codex', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain'));
  for (const root of GLOBAL_ROOTS) addRoot(found, path.join(root, 'ruvnet-brain'));
  try {
    for (const hash of fs.readdirSync(NPX_ROOT)) {
      addRoot(found, path.join(NPX_ROOT, hash, 'node_modules', 'ruvnet-brain'));
    }
  } catch { /* npx cache absent */ }
  addRoot(found, path.join(brainHome, 'kb', '.console-runtime'));
  return [...new Set(found)];
}

export const fixtureSource = () => `import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const NOISE_NS = new Set();
const n = (r) => r;

export function findStores(root = path.join(HOME, 'Code')) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'node_modules' || e.name === '.git') continue;
      if (e.name === '.swarm') {
        const db = path.join(dir, '.swarm/memory.db');
        if (fs.existsSync(db)) out.push(db);
        continue;
      }
      if (e.name.startsWith('.') && e.name !== '.swarm') continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  for (const extra of [path.join(HOME, '.claude/.swarm/memory.db'), path.join(HOME, 'cognitum-trader/.swarm/memory.db')]) {
    if (fs.existsSync(extra) && !out.includes(extra)) out.push(extra);
  }
  return out.sort();
}

export function diagnose(db) { return { db, learns: true }; }
`;

export const descriptor = {
  name: 'brain-memory-doctor-roots',
  atomic: true,
  editCount: EDITS.length,
  discover,
  patchSource,
  hasPatch,
  reverse: reverseSource,
  isPatched,
};
