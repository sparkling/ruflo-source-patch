import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from './fixtures.mjs';
import {
  DAEMON_AUTOSTART_REL, DAEMON_COMMAND_REL, NATIVE_DAEMON,
} from './daemon-fixtures.mjs';

const SB = process.argv[2];
const HOME = path.join(SB, 'home');
const STATE = path.join(HOME, '.ruflo-source-patch', 'state.json');
const NM = path.join(SB, 'npx', 'native', 'node_modules');
const vendor = (rel) => path.join(NM, rel);
const env = {
  ...process.env,
  RUFLO_SOURCE_PATCH_HOME: HOME,
  RUFLO_NPX_ROOT: path.join(SB, 'npx'),
  RUFLO_GLOBAL_ROOT: path.join(SB, 'global'),
  RSP_NO_LAUNCHCTL: '1',
};
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), ...args], {
  env, encoding: 'utf8',
});
const out = (run) => `${run.stdout || ''}${run.stderr || ''}`;
const fail = (message) => { console.error(`\n✘ ${message}`); process.exit(1); };

fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}\n');
for (const [rel, bytes] of NATIVE_DAEMON) {
  fs.mkdirSync(path.dirname(vendor(rel)), { recursive: true });
  fs.writeFileSync(vendor(rel), bytes);
}

const installed = cli(['daemon', 'install']);
const status = cli(['daemon', 'status']);
if (installed.status !== 0 || status.status !== 0 || !/1 native/.test(out(status))) {
  fail(`native daemon routing was not reported as satisfied:\n${out(installed)}\n${out(status)}`);
}
for (const rel of [DAEMON_AUTOSTART_REL, DAEMON_COMMAND_REL]) {
  if (fs.readFileSync(vendor(rel), 'utf8').includes('ruflo-source-patch:patched')
      || fs.existsSync(`${vendor(rel)}.rsp-backup`)) {
    fail(`clean native bytes were stamped or backed up as a local patch: ${rel}`);
  }
}
if (cli(['monitor', 'check']).status !== 0) fail('monitor check rejected complete native daemon routing');

const nativeCommand = fs.readFileSync(vendor(DAEMON_COMMAND_REL), 'utf8');
fs.writeFileSync(vendor(DAEMON_COMMAND_REL), nativeCommand.replace(
  'getDaemon(resolveDaemonProjectRoot(process.cwd()))',
  'getDaemon(process.cwd())',
));
if (cli(['monitor', 'check']).status === 0) fail('one raw daemon identity route still passed native satisfaction');
fs.writeFileSync(vendor(DAEMON_COMMAND_REL), nativeCommand);

const retirement = cli(['monitor', 'run']);
const retiredState = JSON.parse(fs.readFileSync(STATE, 'utf8'));
if (retirement.status !== 0 || retiredState.patchTargets.includes('daemon') || !retiredState.retired?.daemon) {
  fail(`executable native replacement did not terminally retire daemon:\n${out(retirement)}\n${JSON.stringify(retiredState)}`);
}
if (cli(['daemon', 'install']).status !== 0 || JSON.parse(fs.readFileSync(STATE, 'utf8')).patchTargets.includes('daemon')) {
  fail('a direct install resurrected the terminally retired daemon target');
}

console.log('✔ native daemon retirement (pristine native satisfaction, route mutation failure, executable proof, terminal reinstall refusal)');
