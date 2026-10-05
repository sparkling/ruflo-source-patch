// Local #5: transfer prior trust only across our exact authorized logger wrapper.
// Identity follows native discovery.rs / the official codex-hook-trust.mjs helper.
// The native currentHash equality check makes future normalization drift fail closed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import { discover, PREFIX, unwrapCommand } from './patcher.mjs';
import { connectNativeMetadata } from './native-client.mjs';

const EVENTS = Object.freeze({ preToolUse: 'PreToolUse', permissionRequest: 'PermissionRequest',
  postToolUse: 'PostToolUse', preCompact: 'PreCompact', postCompact: 'PostCompact',
  sessionStart: 'SessionStart', sessionEnd: 'SessionEnd', userPromptSubmit: 'UserPromptSubmit',
  subagentStart: 'SubagentStart', subagentStop: 'SubagentStop', stop: 'Stop', interrupt: 'Interrupt' });
const CONTEXT = new Set(['preToolUse', 'postToolUse', 'sessionStart', 'userPromptSubmit', 'subagentStart']);
const NO_MATCHER = new Set(['userPromptSubmit', 'stop', 'interrupt']);
const eventLabel = event => event.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encoded = value => JSON.stringify(canonical(value));
const hash = value => 'sha256:' + crypto.createHash('sha256').update(encoded(value)).digest('hex');
const digest = value => /^sha256:[a-f0-9]{64}$/.test(value || '');
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

export function hashHookMetadata(row, command = row?.command) {
  if (!EVENTS[row?.eventName] || row.handlerType !== 'command' || typeof command !== 'string'
    || !command.trim() || !Number.isSafeInteger(row.timeoutSec) || row.timeoutSec < 1
    || typeof row.async !== 'boolean') return null;
  const handler = { type: 'command', command, timeout: row.timeoutSec, async: row.async };
  if (typeof row.statusMessage === 'string') handler.statusMessage = row.statusMessage;
  if (CONTEXT.has(row.eventName) && Number.isSafeInteger(row.additionalContextLimit)
      && row.additionalContextLimit >= 0 && row.additionalContextLimit !== 2500)
    handler.additionalContextLimit = row.additionalContextLimit;
  const identity = { event_name: eventLabel(row.eventName), hooks: [handler] };
  if (!NO_MATCHER.has(row.eventName) && typeof row.matcher === 'string') identity.matcher = row.matcher;
  return hash(identity);
}

function registry(response, cwd) {
  if (!Array.isArray(response?.data) || response.data.length !== 1
      || path.resolve(response.data[0].cwd) !== path.resolve(cwd)
      || !Array.isArray(response.data[0].errors) || response.data[0].errors.length
      || !Array.isArray(response.data[0].hooks)) throw Error('registry');
  const rows = response.data[0].hooks;
  if (rows.some(row => typeof row.key !== 'string') || new Set(rows.map(row => row.key)).size !== rows.length)
    throw Error('registry');
  return rows;
}
function userLayer(read, file) {
  const layers = read?.layers?.filter(layer => layer.name?.type === 'user'
    && layer.name.file === file && layer.name.profile == null && !layer.disabledReason);
  if (layers?.length !== 1 || typeof layers[0].version !== 'string' || !layers[0].version
      || !plain(layers[0].config) || !plain(read.config)) throw Error('config-layer');
  return layers[0];
}
function trustedHash(config, key) {
  const state = config?.hooks?.state;
  return plain(state) && Object.hasOwn(state, key) && plain(state[key]) ? state[key].trusted_hash : null;
}
function otherSettings(config, keys) {
  const clone = structuredClone(config);
  for (const key of keys) {
    const state = clone?.hooks?.state?.[key];
    if (plain(state)) {
      delete state.trusted_hash;
      if (!Object.keys(state).length) delete clone.hooks.state[key];
    }
  }
  if (plain(clone?.hooks?.state) && !Object.keys(clone.hooks.state).length) delete clone.hooks.state;
  if (plain(clone?.hooks) && !Object.keys(clone.hooks).length) delete clone.hooks;
  return encoded(clone);
}

function declaredIdentity(row, sources, direction) {
  if (row.source !== 'plugin' || row.handlerType !== 'command' || row.enabled !== true
    || row.isManaged !== false || row.trustStatus !== 'modified'
    || !/^(?:ruflo-[a-z0-9-]+@ruflo|ruvnet-brain@ruvnet-brain)$/.test(row.pluginId || '')
    || typeof row.command !== 'string' || (direction === 'install' ? !row.command.startsWith(PREFIX)
      : !row.command.startsWith('node ') || row.command.includes('/hook-failure-log/runtime.cjs'))
    || !digest(row.currentHash) || hashHookMetadata(row) !== row.currentHash
    || !sources.has(row.sourcePath)) return null;
  const relative = row.key.slice(row.pluginId.length + 1);
  const match = /^(hooks\/(?:codex-hooks|hooks)\.json):([a-z_]+):(\d+):(\d+)$/.exec(relative);
  if (!row.key.startsWith(row.pluginId + ':') || !match || match[2] !== eventLabel(row.eventName)
      || !row.sourcePath.endsWith(path.sep + match[1].split('/').join(path.sep))) return null;
  const stat = fs.lstatSync(row.sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return null;
  const manifest = JSON.parse(fs.readFileSync(row.sourcePath, 'utf8'));
  const group = manifest?.hooks?.[EVENTS[row.eventName]]?.[Number(match[3])];
  const handler = group?.hooks?.[Number(match[4])];
  if (handler?.type !== 'command' || handler.command !== row.command) return null;
  const timeout = Number.isInteger(handler.timeout) && handler.timeout >= 0 ? handler.timeout : null;
  const timeoutSec = ['sessionEnd', 'interrupt'].includes(row.eventName)
    ? Math.min(3, Math.max(1, timeout ?? 1)) : Math.max(1, timeout ?? 600);
  const declared = { ...row, timeoutSec, async: handler.async === true,
    matcher: typeof group.matcher === 'string' ? group.matcher : null,
    statusMessage: handler.statusMessage ?? null, additionalContextLimit: handler.additionalContextLimit ?? null };
  if (hashHookMetadata(declared) !== row.currentHash) return null;
  const priorCommand = direction === 'install' ? unwrapCommand(row.command) : PREFIX + row.command.slice(5);
  const priorHash = hashHookMetadata(row, priorCommand);
  return digest(priorHash) ? { key: row.key, priorHash, currentHash: row.currentHash, row } : null;
}

export async function reconcileLoggerTrust({ rpc: suppliedRpc, sources = discover(), cwd = process.cwd(),
  configPath = path.join(process.env.CODEX_HOME || path.join(HOME_BASE, '.codex'), 'config.toml'),
  socketPath, nativeBinary, timeoutMs = 10000, direction = 'install' } = {}) {
  let client, writeAttempted = false, changed = false, stage = 'preflight';
  try {
    if (!path.isAbsolute(configPath) || !path.isAbsolute(cwd) || !['install', 'remove'].includes(direction)) throw Error('paths');
    const owned = new Set(sources.filter(file => path.isAbsolute(file)));
    if (!owned.size) return { state: 'not-applicable', changed: false, migrated: 0 };
    const configStat = fs.lstatSync(configPath);
    if (!configStat.isFile() || configStat.isSymbolicLink()) throw Error('config-path');
    if (!suppliedRpc) client = await connectNativeMetadata({ socketPath:
      socketPath || path.join(path.dirname(configPath), 'app-server-control/app-server-control.sock'), timeoutMs,
      nativeBinary, codexHome: path.dirname(configPath), cwd });
    const rpc = suppliedRpc || client.rpc;
    stage = 'native-registry';
    const beforeRows = registry(await rpc('hooks/list', { cwds: [cwd] }), cwd);
    stage = 'native-config';
    const before = await rpc('config/read', { includeLayers: true, cwd });
    const user = userLayer(before, configPath);
    const candidates = [], pending = [];
    for (const row of beforeRows) {
      if (row.source !== 'plugin' || !owned.has(row.sourcePath)
        || (direction === 'install' ? !row.command?.startsWith(PREFIX) : !row.command?.startsWith('node '))) continue;
      if (row.trustStatus === 'trusted' || row.isManaged || row.enabled === false) continue;
      let identity;
      try { identity = declaredIdentity(row, owned, direction); } catch { /* unsafe/changed source cannot inherit trust */ }
      if (!identity || trustedHash(user.config, row.key) !== identity.priorHash
          || trustedHash(before.config, row.key) !== identity.priorHash) { pending.push(row.key); continue; }
      candidates.push(identity);
    }
    const boundary = { transport: client?.transport || 'supplied-native-metadata',
      loadedThreadsReloadRequested: client?.transport === 'existing-control-socket' };
    if (!candidates.length) return { state: 'unchanged', changed: false, migrated: 0, pendingReview: pending.length, ...boundary };
    stage = 'native-prewrite';
    const refreshed = registry(await rpc('hooks/list', { cwds: [cwd] }), cwd);
    for (const identity of candidates) {
      const row = refreshed.find(item => item.key === identity.key);
      if (!row || encoded(row) !== encoded(identity.row) || !declaredIdentity(row, owned, direction)) throw Error('promotion');
    }
    const keys = candidates.map(identity => identity.key);
    stage = 'native-cas-write'; writeAttempted = true;
    const receipt = await rpc('config/batchWrite', { filePath: configPath, expectedVersion: user.version,
      reloadUserConfig: true, edits: candidates.map(identity => ({
        keyPath: `hooks.state.${JSON.stringify(identity.key)}.trusted_hash`,
        value: identity.currentHash, mergeStrategy: 'replace' })) });
    changed = receipt?.status === 'ok';
    if (!changed || receipt.filePath !== configPath) throw Error('write-receipt');
    stage = 'native-verification';
    const after = await rpc('config/read', { includeLayers: true, cwd });
    const afterUser = userLayer(after, configPath);
    if (afterUser.version !== receipt.version || otherSettings(user.config, keys) !== otherSettings(afterUser.config, keys)
      || otherSettings(before.config, keys) !== otherSettings(after.config, keys)) throw Error('other-settings');
    const rows = registry(await rpc('hooks/list', { cwds: [cwd] }), cwd);
    for (const identity of candidates) {
      const row = rows.find(item => item.key === identity.key);
      if (!row || row.currentHash !== identity.currentHash || hashHookMetadata(row) !== identity.currentHash
        || row.command !== identity.row.command || row.sourcePath !== identity.row.sourcePath
        || row.pluginId !== identity.row.pluginId || row.enabled !== true || row.isManaged !== false
        || row.trustStatus !== 'trusted' || trustedHash(after.config, row.key) !== identity.currentHash
        || trustedHash(afterUser.config, row.key) !== identity.currentHash) throw Error('trust-verification');
    }
    return { state: 'verified', changed: true, migrated: candidates.length, pendingReview: pending.length,
      unrelatedSettingsUnchanged: true, executionAcceptance: 'not-run', ...boundary };
  } catch {
    // Native errors/config values stay private. Never roll back a whole config over concurrent edits.
    return { state: writeAttempted ? 'degraded' : 'blocked', changed: changed || (writeAttempted ? 'unknown' : false),
      migrated: 0, reason: `logger trust migration failed at ${stage}; native review/verification required` };
  } finally { await client?.close(); }
}
