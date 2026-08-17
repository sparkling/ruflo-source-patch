// Cross-host executable and persisted-root discovery for plugin-hosts (#2854).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  __rspHostAccountHomes,
  __rspHostExecutableDirs,
  __rspHostExecutableNames,
  __rspResolveHostExecutable,
  __rspWindowsHostInvocation,
} from '../lib/plugin-hosts/discovery-fragment.mjs';

const SB = path.resolve(process.argv[2]);
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function write(file, body, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  fs.chmodSync(file, mode);
}

console.log('\nPlugin-host discovery boundaries');
const accountHomes = __rspHostAccountHomes({
  userInfo: () => ({ homedir: '/home/effective-account' }),
  homedir: () => '/Users/migrated-home',
});
const migratedDirs = __rspHostExecutableDirs({
  PATH: '/usr/bin', HOME: '/Users/migrated-home', XDG_BIN_HOME: '/opt/host-bin',
  NPM_CONFIG_PREFIX: '/srv/npm-prefix', PNPM_HOME: '/srv/pnpm', VOLTA_HOME: '/srv/volta',
}, accountHomes, path);
check('PHD1 OS account home remains independent from a migrated HOME',
  migratedDirs.includes('/home/effective-account/.local/bin')
    && migratedDirs.includes('/Users/migrated-home/.local/bin')
    && migratedDirs.includes('/opt/host-bin')
    && migratedDirs.includes('/srv/npm-prefix/bin')
    && migratedDirs.includes('/srv/pnpm')
    && migratedDirs.includes('/srv/volta/bin')
    && migratedDirs.includes('/home/effective-account/.npm-global/bin'));
check('PHD2 Windows candidates are bounded to PATH/PATHEXT launchers',
  JSON.stringify(__rspHostExecutableNames('codex', 'win32', '.EXE;.CMD'))
    === JSON.stringify(['codex.exe', 'codex.cmd', 'codex']));

const windowsPrefix = path.join(SB, 'windows-prefix');
const windowsWrapper = path.join(windowsPrefix, 'codex.cmd');
const windowsPackage = path.join(windowsPrefix, 'node_modules', '@openai', 'codex');
const windowsEntry = path.join(windowsPackage, 'bin', 'codex.js');
write(windowsWrapper, '@echo off\n');
write(windowsEntry, '// fixture\n');
write(path.join(windowsPackage, 'package.json'), JSON.stringify({
  name: '@openai/codex', bin: { codex: 'bin/codex.js' },
}));
const windowsInvocation = __rspWindowsHostInvocation(
  'codex', windowsWrapper, ['plugin', 'list'], fs, path, process.execPath,
);
check('PHD2a a standard Windows npm shim resolves to its identity-checked JS entry',
  windowsInvocation.executable === process.execPath
    && JSON.stringify(windowsInvocation.argv) === JSON.stringify([
      windowsEntry, 'plugin', 'list',
    ]));
write(path.join(windowsPackage, 'package.json'), JSON.stringify({
  name: '@attacker/codex', bin: { codex: 'bin/codex.js' },
}));
let forgedRefused = false;
try {
  __rspWindowsHostInvocation('codex', windowsWrapper, [], fs, path, process.execPath);
} catch (error) {
  forgedRefused = /identity could not be proven/.test(error.message);
}
check('PHD2b a forged Windows command shim is refused', forgedRefused);

const runtimeBin = path.join(SB, 'runtime-bin');
const poisonBin = path.join(SB, 'poison-bin');
const npmSentinel = path.join(SB, 'npm-ran');
write(path.join(runtimeBin, 'codex'), `#!${process.execPath}\n`, 0o755);
write(path.join(poisonBin, 'npm'), `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(npmSentinel)}, 'ran');\n`, 0o755);
const oldPath = process.env.PATH;
const oldXdg = process.env.XDG_BIN_HOME;
process.env.PATH = poisonBin;
process.env.XDG_BIN_HOME = runtimeBin;
const resolvedWithoutNpm = await __rspResolveHostExecutable('codex');
process.env.PATH = oldPath;
if (oldXdg === undefined) delete process.env.XDG_BIN_HOME;
else process.env.XDG_BIN_HOME = oldXdg;
check('PHD2c executable discovery never runs a PATH-selected npm helper',
  resolvedWithoutNpm === fs.realpathSync(path.join(runtimeBin, 'codex'))
    && !fs.existsSync(npmSentinel));

const pathsModule = pathToFileURL(path.join(REPO, 'lib', 'cwd', 'paths.mjs')).href;
const homeProbe = spawnSync(process.execPath, ['--input-type=module', '--eval',
  `const m = await import(${JSON.stringify(pathsModule)}); process.stdout.write(m.HOME_BASE);`], {
  env: {
    ...process.env,
    HOME: '/Users/foreign-host',
    RUFLO_SOURCE_PATCH_HOME: '',
    RUFLO_GLOBAL_ROOT: '',
  },
  encoding: 'utf8',
});
check('PHD3 patch state uses the effective account home when HOME belongs to another host',
  homeProbe.status === 0 && homeProbe.stdout === os.userInfo().homedir,
  `${homeProbe.stdout}${homeProbe.stderr}`);

const recordedHome = path.join(SB, 'recorded-home');
const recordedRoot = path.join(SB, 'recorded-prefix', 'lib', 'node_modules');
write(path.join(recordedRoot, 'ruflo', 'package.json'), '{"name":"ruflo"}\n');
write(path.join(recordedHome, '.ruflo-source-patch', 'state.json'), `${JSON.stringify({
  globalRoots: [recordedRoot, path.join(SB, 'unverified-root')],
})}\n`);
const recordedProbe = spawnSync(process.execPath, ['--input-type=module', '--eval',
  `const m = await import(${JSON.stringify(pathsModule)}); process.stdout.write(JSON.stringify(m.GLOBAL_ROOTS));`], {
  env: {
    ...process.env,
    PATH: '/usr/bin:/bin',
    RUFLO_SOURCE_PATCH_HOME: recordedHome,
    RUFLO_GLOBAL_ROOT: '',
    NPM_CONFIG_PREFIX: '',
  },
  encoding: 'utf8',
});
check('PHD4 a validated root captured by a rich shell survives a narrow monitor PATH',
  recordedProbe.status === 0
    && JSON.parse(recordedProbe.stdout).includes(recordedRoot)
    && !JSON.parse(recordedProbe.stdout).includes(path.join(SB, 'unverified-root')),
  `${recordedProbe.stdout}${recordedProbe.stderr}`);

if (failures) {
  console.error(`\n${failures} plugin-host discovery test(s) failed`);
  process.exit(1);
}
console.log('\nAll plugin-host discovery tests passed');
