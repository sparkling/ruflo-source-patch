export const DAEMON_AUTOSTART_REL = '@claude-flow/cli/dist/src/services/daemon-autostart.js';
export const DAEMON_COMMAND_REL = '@claude-flow/cli/dist/src/commands/daemon.js';

const NATIVE_AUTOSTART_FIXTURE = `
import fs from 'node:fs';
import path from 'node:path';
export function isRufloProject(root) {
  return fs.existsSync(path.join(root, '.claude-flow', 'config.json'));
}
export function resolveDaemonProjectRoot(startDir) {
  const start = path.resolve(startDir);
  let dir = start;
  for (;;) {
    if (isRufloProject(dir)) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return start;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
function autostartDisabled() { return false; }
function isDaemonAlive() { return false; }
function defaultSpawn() {}
export function ensureDaemonRunning(startDir, opts = {}) {
  const projectRoot = resolveDaemonProjectRoot(startDir);
  if (autostartDisabled(projectRoot)) return { started: false };
  if (!isRufloProject(projectRoot)) return { started: false };
  const alive = (opts.isAlive ?? isDaemonAlive)(projectRoot);
  if (alive) return { started: false };
  (opts.spawnFn ?? defaultSpawn)(projectRoot);
  return { started: true };
}
`;

const NATIVE_COMMAND_FIXTURE = `
import { resolveDaemonProjectRoot } from '../services/daemon-autostart.js';
const resolveWorkspaceFlag = () => null;
const getDaemon = (root) => root;
const killBackgroundDaemon = async () => {};
export function start(ctx = { flags: {} }) {
  return resolveWorkspaceFlag(ctx.flags.workspace) ?? resolveDaemonProjectRoot(process.cwd());
}
export function stop() { return resolveDaemonProjectRoot(process.cwd()); }
export function status() { return getDaemon(resolveDaemonProjectRoot(process.cwd())); }
export function trigger() { return getDaemon(resolveDaemonProjectRoot(process.cwd())); }
export function enable() { return resolveDaemonProjectRoot(process.cwd()); }
export function supervisor() { return resolveDaemonProjectRoot(process.cwd()); }
export async function stopAll() { await killBackgroundDaemon(resolveDaemonProjectRoot(process.cwd())); }
`;

export const NATIVE_DAEMON = new Map([
  [DAEMON_AUTOSTART_REL, Buffer.from(NATIVE_AUTOSTART_FIXTURE)],
  [DAEMON_COMMAND_REL, Buffer.from(NATIVE_COMMAND_FIXTURE)],
]);

/** Turn current native bytes back into the legacy shape so the local patch stays mutation-tested. */
export function legacyDaemonBytes(rel, bytes, patchLibrary) {
  let source = bytes.toString('utf8');
  if (rel === DAEMON_AUTOSTART_REL && patchLibrary.nativeDaemonAutostartSatisfied(source)) {
    source = source
      .replace('export function ensureDaemonRunning(startDir, opts = {}) {', 'export function ensureDaemonRunning(projectRoot, opts = {}) {')
      .replace('        const projectRoot = resolveDaemonProjectRoot(startDir);\n', '');
  }
  if (rel === DAEMON_COMMAND_REL && patchLibrary.nativeDaemonCommandSatisfied(source)) {
    source = source
      .replace('const projectRoot = resolveWorkspaceFlag(ctx.flags.workspace)\n            ?? resolveDaemonProjectRoot(process.cwd());',
        'const projectRoot = resolveWorkspaceFlag(ctx.flags.workspace) ?? process.cwd();')
      .replace('?? resolveDaemonProjectRoot(process.cwd());', '?? process.cwd();')
      .split('const projectRoot = resolveDaemonProjectRoot(process.cwd());').join('const projectRoot = process.cwd();')
      .split('killBackgroundDaemon(resolveDaemonProjectRoot(process.cwd()))').join('killBackgroundDaemon(process.cwd())')
      .split('getDaemon(resolveDaemonProjectRoot(process.cwd())').join('getDaemon(process.cwd()')
      .replace('            const daemon = getDaemon(projectRoot);', '            const daemon = getDaemon(process.cwd());');
  }
  return Buffer.from(source);
}
