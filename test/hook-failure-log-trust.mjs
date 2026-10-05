import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../lib/cwd/paths.mjs';
import { PREFIX } from '../lib/hook-failure-log/patcher.mjs';
import { hashHookMetadata, reconcileLoggerTrust } from '../lib/hook-failure-log/trust.mjs';

// Loaded by the isolated parent suite only; never enumerate or mutate the real account.
assert.match(path.basename(HOME_BASE), /^rsp-hook-log-test-/);
const configPath = path.join(HOME_BASE, '.codex/config.toml');
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, '# synthetic native config fixture\n');
const file = path.join(HOME_BASE, '.codex/plugins/cache/ruflo/ruflo-core/0.2.6/hooks/hooks.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
const original = 'node -e "process.exit(0)"';
const command = PREFIX + original.slice(5);
const base = { key: 'ruflo-core@ruflo:hooks/hooks.json:pre_tool_use:0:0', eventName: 'preToolUse',
  handlerType: 'command', command, async: false, matcher: 'Bash', timeoutSec: 600,
  statusMessage: null, additionalContextLimit: null, sourcePath: file, source: 'plugin',
  pluginId: 'ruflo-core@ruflo', enabled: true, isManaged: false, trustStatus: 'modified' };
base.currentHash = hashHookMetadata(base);
const originalHash = hashHookMetadata(base, original);
const writeManifest = (change = {}, cmd = command) => fs.writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [
  { matcher: 'Bash', hooks: [{ type: 'command', command: cmd, ...change }] },
] } }));
writeManifest();

// Native discovery.rs vector independently measured in the existing registered hook metadata.
assert.equal(hashHookMetadata({ ...base, command: "node --require '/Users/henrik/.ruflo-source-patch/lib/hook-failure-log/runtime.cjs' -e \"process.argv=[process.argv[0],'x','modify-bash'];require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'scripts','ruflo-hook.cjs'))\"" }),
  'sha256:b8f173b2ca65b9774de1ca79bb7a37f3ce0e95fab9ff4c4c1f936cc1b1b2dab6');
assert.equal(hashHookMetadata({ ...base, eventName: 'unknown' }), null);
assert.equal(hashHookMetadata({ ...base, timeoutSec: -1 }), null);

function fixture({ row = base, prior = originalHash, mode = '' } = {}) {
  const user = { hooks: { state: { [base.key]: { trusted_hash: prior, enabled: true }, other: { enabled: false } } },
    model: 'same-model', model_provider: 'same-provider', sandbox_mode: 'same-security', privateSentinel: 'DO_NOT_LOG_CONFIG' };
  const calls = []; let version = 'sha256:fixture-before', written = false;
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === 'hooks/list') return { data: [{ cwd: HOME_BASE, errors: [], warnings: [], hooks: [
      { ...row, ...(written ? { trustStatus: mode === 'verify-fail' ? 'modified' : 'trusted' } : {}),
        ...(mode === 'promotion' && calls.filter(c => c.method === method).length > 1 ? { currentHash: 'sha256:' + 'a'.repeat(64) } : {}) },
    ] }] };
    if (method === 'config/read') return { config: structuredClone(user), layers: [{ name: { type: 'user', file: configPath },
      config: structuredClone(user), version }] };
    assert.equal(method, 'config/batchWrite');
    assert.equal(params.expectedVersion, version); assert.equal(params.filePath, configPath);
    assert.equal(params.reloadUserConfig, true); assert.equal(params.edits.length, 1);
    assert.deepEqual(params.edits[0], { keyPath: `hooks.state.${JSON.stringify(base.key)}.trusted_hash`,
      value: row.currentHash, mergeStrategy: 'replace' });
    if (mode === 'cas-fail') throw new Error('SECRET_CONFIG_NATIVE_ERROR');
    user.hooks.state[base.key].trusted_hash = row.currentHash;
    if (mode === 'foreign-config') user.model = 'changed-by-other-owner';
    version = 'sha256:fixture-after'; written = true;
    return { status: 'ok', filePath: configPath, version };
  };
  return { rpc, calls, user };
}
const options = { configPath, cwd: HOME_BASE, sources: [file] };
let f = fixture(); let result = await reconcileLoggerTrust({ ...options, rpc: f.rpc });
assert.equal(result.state, 'verified'); assert.equal(result.migrated, 1);
assert.equal(f.user.model, 'same-model'); assert.equal(f.user.hooks.state.other.enabled, false);
assert.equal(JSON.stringify(result).includes('DO_NOT_LOG_CONFIG'), false);
// Exact inverse restores native approval after removing just the owned wrapper.
writeManifest({}, original);
f = fixture({ row: { ...base, command: original, currentHash: originalHash }, prior: base.currentHash });
result = await reconcileLoggerTrust({ ...options, rpc: f.rpc, direction: 'remove' });
assert.equal(result.state, 'verified'); assert.equal(f.user.hooks.state[base.key].trusted_hash, originalHash);
f = fixture({ row: { ...base, command: original, currentHash: originalHash }, prior: 'sha256:' + 'd'.repeat(64) });
result = await reconcileLoggerTrust({ ...options, rpc: f.rpc, direction: 'remove' });
assert.equal(f.calls.some(c => c.method === 'config/batchWrite'), false);
writeManifest();

for (const change of [
  { prior: undefined }, { prior: 'sha256:' + 'b'.repeat(64) },
  { row: { ...base, enabled: false } }, { row: { ...base, isManaged: true } },
  { row: { ...base, trustStatus: 'untrusted' } },
  { row: { ...base, source: 'project' } }, { row: { ...base, pluginId: 'foreign@plugin' } },
  { row: { ...base, currentHash: 'sha256:' + 'c'.repeat(64) } },
  { row: { ...base, command: command.replace(HOME_BASE, '/foreign') } },
  { row: { ...base, sourcePath: path.join(HOME_BASE, 'unowned.json') } },
  { row: { ...base, key: base.key.replace(':0:0', ':1:0') } },
]) {
  // Destructuring defaults would hide absent trust, so use null explicitly.
  if ('prior' in change && change.prior === undefined) change.prior = null;
  f = fixture(change); result = await reconcileLoggerTrust({ ...options, rpc: f.rpc });
  assert.equal(f.calls.some(c => c.method === 'config/batchWrite'), false, JSON.stringify(change));
  assert.equal(result.changed, false);
}
for (const mode of ['cas-fail', 'promotion', 'foreign-config', 'verify-fail']) {
  f = fixture({ mode }); result = await reconcileLoggerTrust({ ...options, rpc: f.rpc });
  assert.ok(['blocked', 'degraded'].includes(result.state), mode);
  assert.equal(JSON.stringify(result).includes('SECRET_CONFIG_NATIVE_ERROR'), false);
  if (mode === 'promotion') assert.equal(f.calls.some(c => c.method === 'config/batchWrite'), false);
}
writeManifest({ timeout: 123 });
f = fixture(); result = await reconcileLoggerTrust({ ...options, rpc: f.rpc });
assert.equal(f.calls.some(c => c.method === 'config/batchWrite'), false, 'changed timeout must not inherit trust');
writeManifest();
const foreign = path.join(HOME_BASE, 'foreign-hooks.json'); fs.copyFileSync(file, foreign);
fs.unlinkSync(file); fs.symlinkSync(foreign, file);
f = fixture(); result = await reconcileLoggerTrust({ ...options, rpc: f.rpc });
assert.equal(f.calls.some(c => c.method === 'config/batchWrite'), false, 'symlinked source must fail closed');
fs.unlinkSync(file); writeManifest();
console.log('hook trust: exact prior identity only, native hash equality, CAS/promotion failure, flags/config/privacy and source drift preserved');
