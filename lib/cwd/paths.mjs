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

// Where the SessionStart hook lives once installed.
export const SESSION_START_SCRIPT = path.join(STABLE_LIB, 'session-start.mjs');

// Which patch targets are installed (source of truth for the SessionStart hook).
export const STATE_PATH = path.join(STABLE_DIR, 'state.json');

// Stable locations for the script targets. Each target owns its OWN directory so
// installing/uninstalling one never touches the other's files.
export const DUAL_DIR = path.join(STABLE_DIR, 'dual');
export const DEDUPE_DIR = path.join(STABLE_DIR, 'dedupe-bundle');

// Claude Code user settings.
export const SETTINGS_PATH = path.join(HOME_BASE, '.claude', 'settings.json');

// Marker on the hook entry we own (for idempotent install / precise uninstall).
export const HOOK_MARKER = '_rufloSourcePatch';

// npx cache root; overridable for tests.
export const NPX_ROOT = process.env.RUFLO_NPX_ROOT || path.join(os.homedir(), '.npm', '_npx');

// Marker written into each patched library file.
export const PATCH_MARKER = '/* ruflo-source-patch:patched */';
