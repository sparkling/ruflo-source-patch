import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Home base. Normally the user's home; RUFLO_SOURCE_PATCH_HOME overrides it for
// isolated testing (os.homedir() ignores $HOME on macOS, so an explicit knob is
// the only reliable way to sandbox).
export const HOME_BASE = process.env.RUFLO_SOURCE_PATCH_HOME || os.homedir();

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

// Claude Code user settings.
export const SETTINGS_PATH = path.join(HOME_BASE, '.claude', 'settings.json');

// Marker on the hook entry we own (for idempotent install / precise uninstall).
export const HOOK_MARKER = '_rufloSourcePatch';

// npx cache root; overridable for tests.
export const NPX_ROOT = process.env.RUFLO_NPX_ROOT || path.join(os.homedir(), '.npm', '_npx');

// Infer global npm roots from npm executables on PATH without spawning npm. Node and npm
// need not come from the same prefix: this server deliberately runs Node from mise while
// `/usr/local/bin/npm` owns the global `ruflo` installation. Deriving only from
// process.execPath silently missed that real CLI.
export function globalRootsFromPath(pathValue = process.env.PATH || '') {
  const roots = [];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!path.isAbsolute(dir) || path.basename(dir) !== 'bin') continue;
    const candidates = process.platform === 'win32' ? ['npm.cmd', 'npm.exe', 'npm'] : ['npm'];
    if (!candidates.some((name) => fs.existsSync(path.join(dir, name)))) continue;
    roots.push(path.join(path.dirname(dir), 'lib', 'node_modules'));
  }
  return [...new Set(roots)];
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
  ])];

// Marker written into each patched library file.
export const PATCH_MARKER = '/* ruflo-source-patch:patched */';
