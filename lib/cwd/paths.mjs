import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Home base. The effective OS account is authoritative: migrated shell snapshots
// can export another machine's HOME, and Node's os.homedir() follows that value on
// Linux. RUFLO_SOURCE_PATCH_HOME remains the explicit isolated-test/layout override.
function accountHome() {
  try {
    if (path.isAbsolute(os.userInfo().homedir)) return os.userInfo().homedir;
  } catch { /* fall through */ }
  return os.homedir();
}
export const HOME_BASE = process.env.RUFLO_SOURCE_PATCH_HOME || accountHome();

// Stable runtime location. The npm package is only the distributor/installer;
// the always-firing SessionStart hook points at scripts copied HERE, so the
// hook never depends on the volatile npx cache or a global npm install.
export const STABLE_DIR = path.join(HOME_BASE, '.ruflo-source-patch');
export const STABLE_LIB = path.join(STABLE_DIR, 'lib');

// The notifier. The monitor detects a broken patch within one tick (5 min), but the
// SessionStart hook only speaks at session START — so mid-session breakage (a new ruflo
// version landing in the npx cache while you work, which is exactly how 3.26.1 arrived)
// would stay quiet for hours. The monitor records problems HERE, and a UserPromptSubmit
// hook surfaces them on the next thing you type.
export const PROBLEMS_PATH = path.join(STABLE_DIR, 'problems.json');

// Who watches the watchman.
//
// Every warning in this project is delivered by the monitor. If the MONITOR is dead, the
// silence is indistinguishable from health — the most dangerous state a watchdog can be in,
// and one it cannot report on itself.
//
//   heartbeat   touched on every monitor tick. Stale => it is scheduled but not running.
//   monitor.json  what we scheduled: node path, script path, interval. Lets the prompt hook
//                 check liveness with plain fs.existsSync + one mtime — NO subprocess, so it
//                 stays affordable on the prompt path.
export const HEARTBEAT_PATH = path.join(STABLE_DIR, 'heartbeat');
export const MONITOR_META_PATH = path.join(STABLE_DIR, 'monitor.json');
export const NOTIFY_STATE_PATH = path.join(STABLE_DIR, 'notify-state.json');
export const NOTIFY_SCRIPT = path.join(STABLE_DIR, 'lib', 'cwd', 'notify.mjs');
export const HOOK_MARKER_NOTIFY = '_rufloSourcePatchNotify';

// Where the SessionStart hook lives once installed.
//
// The stable copy MIRRORS the repo's lib/ layout (lib/cwd/, lib/adr-index/, …) rather
// than flattening it. It used to be flat, which was fine while only lib/cwd/*.mjs was
// ever copied — but the plugin patchers live in their own directories and import across
// them, and a flat copy silently breaks those specifiers. Structure-preserving means the
// same import graph works from the repo and from the stable copy, with no rewriting.
//
// Moving this path means an already-installed hook points at the OLD flat location, so
// installHook() self-heals a drifted command instead of assuming its own marker means
// its own path (see hooks.mjs).
export const SESSION_START_SCRIPT = path.join(STABLE_LIB, 'cwd', 'session-start.mjs');

// Which patch targets are installed (source of truth for the SessionStart hook).
export const STATE_PATH = path.join(STABLE_DIR, 'state.json');

// Stable locations for the script targets. Each target owns its OWN directory so
// installing/uninstalling one never touches the other's files.
export const DUAL_DIR = path.join(STABLE_DIR, 'dual');
export const DEDUPE_DIR = path.join(STABLE_DIR, 'dedupe-bundle');
export const ADR_REINDEX_DIR = path.join(STABLE_DIR, 'adr-reindex');
export const RUFLO_CODEX_HOOKS_DIR = path.join(STABLE_DIR, 'ruflo-codex-hooks');
export const CODEX_SWITCH_DIR = path.join(STABLE_DIR, 'codex-switch');

// Claude Code user settings.
export const SETTINGS_PATH = path.join(HOME_BASE, '.claude', 'settings.json');

// Marker on the hook entry we own (for idempotent install / precise uninstall).
export const HOOK_MARKER = '_rufloSourcePatch';

// npx cache root; overridable for tests.
export const NPX_ROOT = process.env.RUFLO_NPX_ROOT || path.join(HOME_BASE, '.npm', '_npx');

// Infer global npm roots from npm executables on PATH without spawning npm. Node and npm
// need not come from the same prefix: this server deliberately runs Node from mise while
// `/usr/local/bin/npm` owns the global `ruflo` installation. Deriving only from
// process.execPath silently missed that real CLI.
const RUFLO_LAUNCHERS = process.platform === 'win32'
  ? [
    'ruflo.cmd', 'ruflo.exe', 'ruflo',
    'claude-flow.cmd', 'claude-flow.exe', 'claude-flow',
    'claude-flow-mcp.cmd', 'claude-flow-mcp.exe', 'claude-flow-mcp',
  ]
  : ['ruflo', 'claude-flow', 'claude-flow-mcp'];
const RUFLO_PACKAGE_NAMES = new Set(['ruflo', '@claude-flow/cli']);

function packageNameAt(dir) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return typeof meta.name === 'string' ? meta.name : null;
  } catch { return null; }
}

function containingNodeModules(dir) {
  let current = path.resolve(dir);
  for (let depth = 0; depth < 12; depth++) {
    if (path.basename(current) === 'node_modules') return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function rootFromLauncher(file) {
  let current;
  try { current = path.dirname(fs.realpathSync(file)); } catch { return null; }
  for (let depth = 0; depth < 12; depth++) {
    if (RUFLO_PACKAGE_NAMES.has(packageNameAt(current))) return containingNodeModules(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function prefixRootWithRuflo(dir) {
  if (path.basename(dir) !== 'bin') return null;
  const root = path.join(path.dirname(dir), 'lib', 'node_modules');
  for (const packageRoot of [path.join(root, 'ruflo'), path.join(root, '@claude-flow', 'cli')]) {
    if (RUFLO_PACKAGE_NAMES.has(packageNameAt(packageRoot))) return root;
  }
  return null;
}

export function globalRootsFromPath(pathValue = process.env.PATH || '') {
  const roots = [];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    const candidates = process.platform === 'win32' ? ['npm.cmd', 'npm.exe', 'npm'] : ['npm'];
    if (path.basename(dir) === 'bin' && candidates.some((name) => fs.existsSync(path.join(dir, name)))) {
      roots.push(path.join(path.dirname(dir), 'lib', 'node_modules'));
    }

    // A custom npm prefix need not expose `npm` in its bin directory. This machine's
    // ~/.npm-global/bin is a real example: it contains only the runnable `ruflo`
    // launcher, whose nested @claude-flow/cli was therefore invisible to status and
    // the monitor. Accept a root only after proving the launcher resolves into a
    // package whose own package.json says `ruflo` or `@claude-flow/cli`; the bounded
    // sibling-prefix fallback covers non-symlink npm shims with the same identity check.
    for (const name of RUFLO_LAUNCHERS) {
      const launcher = path.join(dir, name);
      if (!fs.existsSync(launcher)) continue;
      const resolved = rootFromLauncher(launcher);
      if (resolved) roots.push(resolved);
    }
    const prefix = prefixRootWithRuflo(dir);
    if (prefix) roots.push(prefix);
  }
  return [...new Set(roots)];
}

export function verifiedGlobalRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return null;
  for (const packageRoot of [path.join(root, 'ruflo'), path.join(root, '@claude-flow', 'cli')]) {
    if (RUFLO_PACKAGE_NAMES.has(packageNameAt(packageRoot))) return root;
  }
  return null;
}

function recordedGlobalRoots() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return Array.isArray(state.globalRoots)
      ? state.globalRoots.map(verifiedGlobalRoot).filter(Boolean)
      : [];
  } catch { return []; }
}

function standardUserGlobalRoots() {
  const candidates = [
    path.join(HOME_BASE, '.npm-global', 'lib', 'node_modules'),
    path.join(HOME_BASE, '.local', 'lib', 'node_modules'),
  ];
  if (process.env.NPM_CONFIG_PREFIX && path.isAbsolute(process.env.NPM_CONFIG_PREFIX)) {
    candidates.push(path.join(process.env.NPM_CONFIG_PREFIX, 'lib', 'node_modules'));
  }
  return candidates.map(verifiedGlobalRoot).filter(Boolean);
}

// Global npm install root(s) — node_modules of a `npm i -g`. The running Node
// prefix plus every absolute npm-on-PATH prefix are cheap, read-only candidates;
// no subprocess runs on the monitor path. RUFLO_GLOBAL_ROOT remains the exact
// override for tests and non-standard layouts. Missing roots are ignored later.
export const GLOBAL_ROOTS = process.env.RUFLO_GLOBAL_ROOT
  ? process.env.RUFLO_GLOBAL_ROOT.split(path.delimiter).filter(Boolean)
  : [...new Set([
    path.join(path.dirname(path.dirname(process.execPath)), 'lib', 'node_modules'),
    ...globalRootsFromPath(),
    ...standardUserGlobalRoots(),
    ...recordedGlobalRoots(),
  ])];

// Marker written into each patched library file.
export const PATCH_MARKER = '/* ruflo-source-patch:patched */';
