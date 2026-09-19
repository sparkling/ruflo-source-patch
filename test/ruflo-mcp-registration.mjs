import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repairRegistrationSource as repair, repairLegacyRufloMcp } from '../lib/dual/ruflo-mcp-registration.mjs';

if (!process.argv[2] || !path.isAbsolute(process.argv[2])) throw new Error('absolute fixture root required');
const home = fs.realpathSync(process.argv[2]), codexHome = path.join(home, '.codex');
const cli = path.join(home, '.npm-global/lib/node_modules/@claude-flow/cli/bin/cli.js');
const wrapper = path.join(home, '.npm-global/bin/ruflo');
const prefix = 'model = "custom"\napproval_policy = "on-request"\n';
const suffix = '[mcp_servers.ruflo.env]\nEXAMPLE = "unchanged"\n[mcp_servers.other]\ncommand = "other"\n';
const source = prefix + '[mcp_servers.ruflo]\ncommand = "/node/bin/node" # keep\n'
  + 'args = ' + JSON.stringify([cli, 'mcp', 'start']) + '\n' + suffix;
const missing = () => false;
const next = repair(source, home, missing);
assert(next.includes('command = "npx" # keep\n'));
assert(next.includes('args = ["-y", "ruflo@latest", "mcp", "start"]\n'));
assert(next.includes('startup_timeout_sec = 120\n'));
assert(next.startsWith(prefix));
assert(next.endsWith(suffix));
assert.equal(repair(next, home, missing), next);
assert.equal(repair(source, home, () => true), source);
const wrapped = source.replace('"/node/bin/node"', JSON.stringify(wrapper))
  .replace(JSON.stringify([cli, 'mcp', 'start']), '["mcp","start"]');
assert(repair(wrapped, home, missing).includes('command = "npx"'));
for (const custom of [
  source.replace('"mcp","start"', '"mcp","start","--custom"'),
  source.replace('"/node/bin/node"', '"custom"'),
  source.replace(cli, '/another-account/cli.js'),
  source.replace('[mcp_servers.ruflo]\n', '[mcp_servers.ruflo]\nenabled = false\n'),
  next, prefix,
]) assert.equal(repair(custom, home, missing), custom);
for (const value of [30, 120, 300]) {
  const timed = source.replace(suffix, `startup_timeout_sec = ${value} # retain\n` + suffix);
  assert(repair(timed, home, missing).includes(`startup_timeout_sec = ${Math.max(value, 120)} # retain`));
}
for (const extra of ['command = "duplicate"', 'args = []', 'enabled = true\nenabled = true',
  'startup_timeout_sec = 1\nstartup_timeout_sec = 2', 'startup_timeout_sec = "bad"']) {
  assert.throws(() => repair(source.replace(suffix, extra + '\n' + suffix), home, missing));
}
assert.throws(() => repair(source + '[mcp_servers.ruflo]\n', home, missing));
assert.equal(repair(source.replaceAll('\n', '\r\n'), home, missing), next.replaceAll('\n', '\r\n'));
assert.equal(repairLegacyRufloMcp({ home, codexHome }), false);
assert(!fs.existsSync(codexHome));
fs.mkdirSync(codexHome);
const file = path.join(codexHome, 'config.toml');
fs.writeFileSync(file, source, { mode: 0o600 });
assert.equal(repairLegacyRufloMcp({ home, codexHome }), true);
assert.equal(fs.readFileSync(file, 'utf8'), next);
assert.equal(fs.statSync(file).mode & 0o777, 0o600);
const backup = fs.readdirSync(codexHome).find(name => name.endsWith('.bak'));
assert(backup);
assert.equal(fs.readFileSync(path.join(codexHome, backup), 'utf8'), source);
assert.equal(fs.statSync(path.join(codexHome, backup)).mode & 0o777, 0o600);
assert.equal(repairLegacyRufloMcp({ home, codexHome }), false);
assert.equal(fs.readdirSync(codexHome).length, 2);
fs.unlinkSync(file);
fs.symlinkSync(path.join(codexHome, backup), file);
assert.throws(() => repairLegacyRufloMcp({ home, codexHome }), /linked/);
assert.equal(fs.readFileSync(file, 'utf8'), source);
// Exercise the public install dispatch, with every discovery root isolated.
fs.unlinkSync(file);
fs.writeFileSync(file, source, { mode: 0o600 });
const repo = fileURLToPath(new URL('../', import.meta.url));
fs.mkdirSync(path.join(home, '.claude'));
fs.writeFileSync(path.join(home, '.claude/settings.json'), '{}\n');
const install = spawnSync(process.execPath, [path.join(repo, 'bin/cli.mjs'), 'ruflo-wrapper-guard', 'install'], {
  cwd: home, encoding: 'utf8', timeout: 20000,
  env: { ...process.env, HOME: home, RUFLO_SOURCE_PATCH_HOME: home,
    RUFLO_NPX_ROOT: path.join(home, 'npx'), RUFLO_GLOBAL_ROOT: path.join(home, 'global'),
    CODEX_HOME: path.join(home, 'unrelated-codex'), RSP_NO_SELF_UPDATE: '1',
    RSP_NO_MONITOR_RECOVER: '1', RSP_NO_LAUNCHCTL: '1',
    RSP_NO_STALE_WRITER_KILL: '1', RSP_NO_HOST_AUTO_UPDATE: '1' },
});
assert.equal(install.status, 0, install.stdout + install.stderr);
assert.equal(fs.readFileSync(file, 'utf8'), next);
assert(!fs.existsSync(path.join(home, 'unrelated-codex')));
console.log('✓ missing global MCP recovery: narrow matching, preservation, backup, idempotency, refusal');
