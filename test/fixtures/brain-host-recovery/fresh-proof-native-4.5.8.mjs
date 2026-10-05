// Evidence from a fresh native metadata process; Codex may refresh its own marketplace cache.
// No configuration write or hook-body execution is requested by this probe. It does not
// prove MCP readiness or declarations frozen in existing windows.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { codexHookIdentities, codexHookHash } from './codex-hook-trust.mjs';
import { obtainVerifiedPublishedHookIdentity } from './codex-hook-trust-reconcile.mjs';

const OWNER = 'ruvnet-brain@ruvnet-brain';
const FILES = ['.codex-plugin/plugin.json', 'hooks/codex-hooks.json'];
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const failed = (reason) => ({ ok: false, state: 'fresh-declarations-unproven', scope: 'fresh-codex-hook-declarations', reason,
  hookBodiesExecuted: false, mcpReadiness: 'unknown', existingWindows: 'unproven', inferenceRequests: 0, nativeCacheRefresh: 'possible' });

function readSurface(root) {
  const bytes = FILES.map((file) => {
    const target = path.join(root, file); const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Plugin source is unavailable or unsafe');
    return fs.readFileSync(target);
  });
  return { manifest: JSON.parse(bytes[0]), hooks: JSON.parse(bytes[1]), hashes: Object.fromEntries(FILES.map((file, i) => [file, sha256(bytes[i])])) };
}

export function classifyFreshCodexDeclarations({ plugin, listed, target, expectedVersion, codexHome, cwd }) {
  if (!plugin?.installed || plugin.enabled !== true || plugin.version !== expectedVersion) return failed('Current Codex plugin is missing, disabled, or stale');
  if (target?.manifest?.name !== 'ruvnet-brain' || target.manifest.version !== expectedVersion) return failed('Released target version is unavailable');
  let root;
  try {
    root = fs.realpathSync(path.join(codexHome, 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain', expectedVersion));
    if (plugin.installPath && fs.realpathSync(plugin.installPath) !== root) return failed('Native plugin source differs from the managed version');
    const cache = fs.realpathSync(path.join(codexHome, 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain'));
    if (!root.startsWith(`${cache}${path.sep}`)) return failed('Native plugin source is outside the managed cache');
    if (JSON.stringify(readSurface(root).hashes) !== JSON.stringify(target.hashes)) return failed('Installed declarations differ from the independent released target');
  } catch { return failed('Native plugin source cannot be verified'); }
  const groups = listed?.data;
  if (!Array.isArray(groups) || groups.length !== 1 || groups[0]?.cwd !== cwd
    || !Array.isArray(groups[0]?.hooks) || !Array.isArray(groups[0]?.errors) || !Array.isArray(groups[0]?.warnings)) return failed('Native registry shape or project scope is unproven');
  if (groups[0].errors.length || groups[0].warnings.length) return failed('Native registry reports errors or warnings');
  const rows = groups[0].hooks.filter((row) => row?.pluginId === OWNER);
  const identities = codexHookIdentities(target.hooks);
  if (!identities.size || rows.length !== identities.size || new Set(rows.map((row) => row.key)).size !== identities.size) return failed('Brain hook declarations are missing, duplicated, or unexpected');
  for (const row of rows) {
    if (row.source !== 'plugin' || row.sourcePath !== path.join(root, FILES[1]) || row.enabled !== true
      || !['trusted', 'managed'].includes(row.trustStatus)) return failed('Brain hook source, enabled state, or trust is unproven');
    // Verify the metadata itself, as well as the native currentHash. Foreign owner hooks are untouched.
    const event = Object.keys(target.hooks.hooks).find((name) => `${name[0].toLowerCase()}${name.slice(1)}` === row.eventName);
    const metadataHash = codexHookHash(event, { matcher: row.matcher }, {
      type: row.handlerType, command: row.command, timeout: row.timeoutSec, async: row.async,
      statusMessage: row.statusMessage, additionalContextLimit: row.additionalContextLimit,
    });
    if (!identities.has(row.key) || identities.get(row.key) !== row.currentHash || metadataHash !== row.currentHash) return failed('Brain hook metadata differs from released declarations');
  }
  return { ok: true, state: 'fresh-declarations-ready', scope: 'fresh-codex-hook-declarations', expectedVersion,
    pluginRoot: root, sourceHashes: target.hashes, hookCount: rows.length, hookBodiesExecuted: false,
    mcpReadiness: 'unknown', existingWindows: 'unproven', inferenceRequests: 0 };
}

