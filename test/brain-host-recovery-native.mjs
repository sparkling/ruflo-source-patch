// Brain 4.7.22: native boot evidence is scoped to fresh sessions, never live-host activation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { patchSource, reverseSource, preflight } from '../lib/brain-host-recovery/patcher.mjs';
import { checkHostRecoveryRetirement } from '../lib/brain-host-recovery/supersede.mjs';
import { proveCodexBootSurface, parseChangedPaths, isolatedEnv } from './fixtures/brain-host-recovery/native-4.7.22/scripts/codex-boot-surface-proof.mjs';
const fixtures = new URL('./fixtures/brain-host-recovery/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, fixtures), 'utf8');
const source = read('native-4.7.22/installer.mjs');
assert.deepEqual(patchSource(source), { next: source, applied: [], missing: [] });
assert.equal(reverseSource(source), source);
const body = source.replace(/^import .*;$/gm, '').replace(/^export (?=(?:async )?function)/gm, '');
const version = '4.7.22';
const changed = ['hooks/codex-hooks.json', 'scripts/hook-shim.mjs', 'mcp/server.mjs', 'skills/'];
const declarations = { ok: true, state: 'fresh-declarations-ready', expectedVersion: version, pluginRoot: '/installed' };
const boot = { ok: true, state: 'boot-surface-ready', changed, proven: changed.map(file => ({ path: file })),
  existingWindows: 'unproven', hostRelaunch: 'not-observed' };
const receipt = { desiredVersion: version, consoleRuntime: { state: 'ready' }, hosts: {
  claude: { state: 'ready', version }, codex: { state: 'ready', version, restartRequired: true,
    restartScope: 'unproven', sessionSafetyReason: 'boot-level declarations changed: ' + changed.join(', ') },
} };
const context = extra => ({ PACKAGE_VERSION: version, recorded: structuredClone(receipt), proof: declarations,
  bootSurface: boot, path, os, versionSatisfies: (a, b) => a === b, openSessionsNotice: () => 'Open windows remain unproven', ...extra });
const reconcile = (extra, nativeBody = body) => vm.runInNewContext(nativeBody
  + '\nreconcileFreshCodexDeclarations(recorded, proof, PACKAGE_VERSION, bootSurface)', context(extra), { timeout: 1000 });
function scopeChecks(nativeBody = body) {
  const original = JSON.stringify(receipt);
  const result = reconcile({}, nativeBody);
  assert.equal(result.healthy, true); assert.equal(result.state, 'boot-surface-ready');
  assert.equal(result.bootSurface.existingWindows, 'unproven');
  assert.equal(result.bootSurface.hostRelaunch, 'not-observed');
  assert.match(result.notice, /existing open windows remain unproven/);
  assert.equal(JSON.stringify(receipt), original);
  for (const proof of [{ ...declarations, ok: false }, { ...declarations, expectedVersion: '4.7.21' }, null]) {
    assert.equal(reconcile({ proof }, nativeBody).healthy, false);
  }
  for (const bootSurface of [{ ...boot, ok: false }, { ...boot, state: 'unproven' },
    { ...boot, changed: changed.slice(1) }, { ...boot, changed: [...changed.slice(0, -1), 'commands/'] }, null]) {
    assert.equal(reconcile({ bootSurface }, nativeBody).healthy, false);
  }
  for (const recorded of [{ ...receipt, consoleRuntime: { state: 'stale' } },
    { ...receipt, desiredVersion: '4.7.21' },
    { ...receipt, hosts: { ...receipt.hosts, claude: { state: 'pending', version } } }]) {
    assert.equal(reconcile({ recorded }, nativeBody).healthy, false);
  }
  const hookOnly = structuredClone(receipt);
  hookOnly.hosts.codex.sessionSafetyReason = 'boot-level declarations changed: hooks/codex-hooks.json';
  assert.equal(reconcile({ recorded: hookOnly, bootSurface: null }, nativeBody).state, 'fresh-declarations-ready');
}
scopeChecks();
// These mutations would turn partial evidence or failed declarations into a healthy result.
for (const [from, to] of [
  ["bootSurface?.ok === true", 'true'],
  ["!proof?.ok ||", 'false ||'],
  ['changed.every((file) => bootSurface.changed.includes(file))', 'true'],
]) {
  const mutated = source.replace(from, to); assert.notEqual(mutated, source);
  assert(patchSource(mutated).missing.length);
  assert.throws(() => scopeChecks(body.replace(from, to)));
}
for (const mutated of [source + source,
  source.replace('hostConvergence = reconcileFreshCodexDeclarations(recorded, fresh, PACKAGE_VERSION, bootSurface);', 'hostConvergence = { healthy: true };'),
  source.replace('if (process.env.CODEX_BIN) return process.env.CODEX_BIN;', "return 'unreviewed-host';"),
  source.replace('existing open windows remain unproven and a host relaunch was not observed.', 'all live hosts are ready.')]) {
  assert(patchSource(mutated).missing.length); assert.equal(patchSource(mutated).next, mutated);
}
const calls = []; const notices = [];
const doctor = context({ process: { env: { CODEX_BIN: '/native/codex' }, cwd: () => '/project' },
  fs: { readFileSync() { throw Error('doctor must not read or rewrite configuration in this probe'); } },
  REPO_ROOT: '/release', codexHomeDir: () => '/codex', parseChangedPaths,
  probeFreshCodexDeclarations: async args => { calls.push(['declarations', args]); return declarations; },
  proveCodexBootSurface: async args => { calls.push(['boot', args]); return boot; },
  codexInstalledPluginRoot() { throw Error('fresh declaration root must be reused'); },
  info: text => notices.push(text), warn: text => notices.push(text), hostConvergence: null });
await vm.runInNewContext(body + '\ndoctorFixture()', doctor, { timeout: 1000 });
assert.equal(doctor.hostConvergence.state, 'boot-surface-ready');
assert.equal(calls[0][1].binary, '/native/codex');
assert.equal(calls[1][1].installedPluginRoot, '/installed');
assert.equal(calls[1][1].releasedPluginRoot, '/release/plugin');
assert.deepEqual([...calls[1][1].changedPaths], changed);
assert(notices.some(text => /Existing open windows remain unproven/.test(text)));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-host-native-'));
const write = (relative, contents) => { const file = path.join(temp, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); return file; };
try {
  const installer = write('bin/install.mjs', source);
  const helpers = {
    'scripts/codex-fresh-host-proof.mjs': 'fresh-proof-native-4.5.8.mjs',
    'scripts/codex-hook-trust.mjs': 'native-4.7.21/scripts/codex-hook-trust.mjs',
    'scripts/codex-hook-trust-reconcile.mjs': 'native-4.7.21/scripts/codex-hook-trust-reconcile.mjs',
    'plugin/scripts/entrypoint.mjs': 'native-4.7.21/plugin/scripts/entrypoint.mjs',
    'scripts/codex-boot-surface-proof.mjs': 'native-4.7.22/scripts/codex-boot-surface-proof.mjs',
    'plugin/scripts/host-shell-boundary.mjs': 'native-4.7.22/plugin/scripts/host-shell-boundary.mjs',
  };
  for (const [destination, fixture] of Object.entries(helpers)) write(destination, read(fixture));
  assert.equal(preflight([installer]).ok, true);
  const scheduler = write('plugin/scripts/nightly-scheduler.mjs', read('scheduler-native-4.5.7.mjs').trimEnd() + '\n\nfunction sameExecutable() {}');
  const selected = [installer, scheduler];
  assert.equal(checkHostRecoveryRetirement(selected).state, 'superseded');
  assert.equal(checkHostRecoveryRetirement([]).state, 'unknown');
  assert.equal(checkHostRecoveryRetirement([installer]).state, 'unknown');
  fs.writeFileSync(installer, read('installer-native-4.5.8.mjs'));
  assert.equal(checkHostRecoveryRetirement(selected).state, 'live', 'declaration-only proof cannot retire executable recovery');
  fs.writeFileSync(installer, source);
  fs.appendFileSync(scheduler, '\n// ruflo-source-patch (stuinfla/ruvnet-brain#391)');
  assert.equal(checkHostRecoveryRetirement(selected).state, 'live');
  fs.writeFileSync(scheduler, read('scheduler-native-4.5.7.mjs').trimEnd() + '\n\nfunction sameExecutable() {}');
  for (const relative of Object.keys(helpers)) {
    const file = path.join(temp, relative), bytes = fs.readFileSync(file);
    fs.unlinkSync(file); assert.equal(preflight([installer]).ok, false, relative + ' absent');
    assert.equal(checkHostRecoveryRetirement(selected).state, 'unknown', relative + ' required for retirement');
    fs.writeFileSync(file, bytes); fs.appendFileSync(file, '\n// drift');
    assert.equal(preflight([installer]).ok, false, relative + ' unreviewed');
    fs.writeFileSync(file, bytes); fs.renameSync(file, file + '.original'); fs.symlinkSync(file + '.original', file);
    assert.equal(preflight([installer]).ok, false, relative + ' linked');
    fs.unlinkSync(file); fs.renameSync(file + '.original', file);
  }
  // Old declaration-only helpers cannot satisfy the new installer, even though their common hashes match.
  fs.unlinkSync(path.join(temp, 'scripts/codex-boot-surface-proof.mjs'));
  assert.equal(preflight([installer]).ok, false);
  write('scripts/codex-boot-surface-proof.mjs', read(helpers['scripts/codex-boot-surface-proof.mjs']));

  const installed = path.join(temp, 'installed'), released = path.join(temp, 'released');
  const shim = "console.error('known: session-start');\n";
  const mcp = `import readline from 'node:readline';
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => { const q = JSON.parse(line); if (q.id === undefined) return;
const result = q.method === 'initialize' ? { protocolVersion: '2024-11-05' } : { tools: [{ name: 'search_ruvnet' }] };
console.log(JSON.stringify({ jsonrpc: '2.0', id: q.id, result })); });
input.on('close', () => process.exit(0));\n`;
  const manifest = { hooks: { SessionStart: [{ hooks: [{ command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/hook-shim.mjs" 20000 session-start SessionStart' }] }] } };
  const both = (file, contents) => { for (const root of ['installed', 'released']) write(root + '/' + file, contents); };
  both('hooks/codex-hooks.json', JSON.stringify(manifest)); both('skills/one/SKILL.md', 'Exact skill');
  both('scripts/hook-shim.mjs', shim); both('mcp/server.mjs', mcp);
  const prove = (changedPaths = changed, extra = {}) => proveCodexBootSurface({ changedPaths,
    installedPluginRoot: installed, releasedPluginRoot: released, declarations, timeoutMs: 3000, ...extra });
  const passed = await prove();
  assert.equal(passed.ok, true); assert.equal(passed.proven.length, changed.length);
  assert.equal(passed.existingWindows, 'unproven'); assert.equal(passed.hostRelaunch, 'not-observed');
  assert.equal(passed.inferenceRequests, 0);
  assert.equal((await prove(['unknown.mjs'])).ok, false);
  assert.equal((await prove([])).ok, false);
  assert.equal((await prove(['skills/'], { declarations: { ok: false } })).ok, false);
  write('installed/skills/one/SKILL.md', 'Changed'); assert.equal((await prove(['skills/'])).ok, false);
  both('skills/one/SKILL.md', 'Exact skill');
  write('installed/scripts/hook-shim.mjs', shim + '// drift');
  assert.equal((await prove(['scripts/hook-shim.mjs'])).ok, false);
  both('scripts/hook-shim.mjs', "console.error('known: unrelated-role');\n");
  assert.equal((await prove(['scripts/hook-shim.mjs'])).ok, false);
  both('scripts/hook-shim.mjs', 'process.exit(2);\n'); assert.equal((await prove(['scripts/hook-shim.mjs'])).ok, false);
  both('scripts/hook-shim.mjs', 'setInterval(() => {}, 1000);\n');
  assert.match((await prove(['scripts/hook-shim.mjs'], { timeoutMs: 50 })).reason, /killed/);
  both('scripts/hook-shim.mjs', shim);
  both('mcp/server.mjs', mcp.replace('search_ruvnet', 'different_tool'));
  assert.equal((await prove(['mcp/server.mjs'])).ok, false);
  both('mcp/server.mjs', 'process.exit(0);\n'); assert.equal((await prove(['mcp/server.mjs'])).ok, false);
  both('mcp/server.mjs', 'setInterval(() => {}, 1000);\n');
  assert.match((await prove(['mcp/server.mjs'], { timeoutMs: 50 })).reason, /killed/);
  const env = isolatedEnv('/isolated', {}, { PATH: '/bin', SECRET: 'never-pass', CLAUDE_FLOW_DB_PATH: '/live' });
  assert.equal(env.SECRET, undefined); assert.equal(env.CLAUDE_FLOW_DB_PATH, undefined);
  assert.equal(env.HOME, '/isolated'); assert.equal(env.RUVNET_BRAIN_KB, '/isolated/kb');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log('Brain 4.7.22 native host recovery: exact installer/helper closure, changed-path evidence, bounded isolated shim/MCP probes, failure mutations and open-session uncertainty PASS');

// The registered predicate must be the proven native one, not a later duplicate key.
const registrySource = fs.readFileSync(new URL('../lib/brain-native/supersede.mjs', import.meta.url), 'utf8');
assert.equal(registrySource.split("'brain-host-recovery':").length - 1, 1);
assert(registrySource.includes("'brain-host-recovery': { ...brainHostRecoverySupersession"));
