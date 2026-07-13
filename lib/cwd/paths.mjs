import path from 'node:path';
import os from 'node:os';

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

// Claude Code user settings.
export const SETTINGS_PATH = path.join(HOME_BASE, '.claude', 'settings.json');

// Marker on the hook entry we own (for idempotent install / precise uninstall).
export const HOOK_MARKER = '_rufloSourcePatch';

// npx cache root; overridable for tests.
export const NPX_ROOT = process.env.RUFLO_NPX_ROOT || path.join(os.homedir(), '.npm', '_npx');

// Global npm install root(s) — node_modules of a `npm i -g`. Derived from the running
// node's prefix (`<prefix>/bin/node` -> `<prefix>/lib/node_modules`), which matches
// `npm root -g` for mise / nvm / homebrew / system. NEVER a subprocess: the monitor runs
// on a timer and this must stay cheap. A custom npm prefix overrides via RUFLO_GLOBAL_ROOT.
// Each is existence-checked before use, so a machine with no global install just skips it.
export const GLOBAL_ROOTS = process.env.RUFLO_GLOBAL_ROOT
  ? process.env.RUFLO_GLOBAL_ROOT.split(path.delimiter).filter(Boolean)
  : [path.join(path.dirname(path.dirname(process.execPath)), 'lib', 'node_modules')];

// Marker written into each patched library file.
export const PATCH_MARKER = '/* ruflo-source-patch:patched */';
