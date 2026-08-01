// RuvNet Brain #86: missing packaged catalog data must not masquerade as absent provider keys.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SANDBOX = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-brain-provider-keys-'));
const HOME = path.join(SANDBOX, 'home');
const NPX = path.join(SANDBOX, 'npx');
const GLOBAL = path.join(SANDBOX, 'global');
const BRAIN_HOME = path.join(HOME, '.cache', 'ruvnet-brain');
const MARKETPLACE = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain');
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.RUFLO_NPX_ROOT = NPX;
process.env.RUFLO_GLOBAL_ROOT = GLOBAL;
process.env.RSP_RUVNET_BRAIN_HOME = BRAIN_HOME;
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = MARKETPLACE;

const providerKeys = await import('../lib/brain-console-provider-keys/patcher.mjs');
const lifecycle = await import('../lib/brain-console-lifecycle/patcher.mjs');
const { applyComposed, composeSource, reconcile, statusComposed } = await import('../lib/plugin-compose.mjs');

const fail = (message) => { console.error(`✘ ${message}`); process.exit(1); };
const check = (label, condition) => { if (!condition) fail(label); };
const providerFixture = providerKeys.fixtureSource();
const lifecycleFixture = lifecycle.fixtureSource();
const combinedConsole = `${lifecycleFixture.console}\n\n${providerFixture}`;

function writeRoot(root, name = 'ruvnet-brain') {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name, version: '4.0.2' })}\n`);
  fs.writeFileSync(path.join(root, 'scripts', 'onboarding-console.mjs'), combinedConsole);
  fs.writeFileSync(path.join(root, 'bin', 'install.mjs'), lifecycleFixture.installer);
  return {
    console: path.join(root, 'scripts', 'onboarding-console.mjs'),
    installer: path.join(root, 'bin', 'install.mjs'),
  };
}

const roots = [
  MARKETPLACE,
  path.join(HOME, '.codex', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain', '4.0.2'),
  path.join(NPX, 'one', 'node_modules', 'ruvnet-brain'),
  path.join(GLOBAL, 'ruvnet-brain'),
  path.join(BRAIN_HOME, 'kb', '.console-runtime'),
];
const surfaces = roots.map((root) => writeRoot(root));
writeRoot(path.join(NPX, 'other', 'node_modules', 'not-brain'), 'not-brain');
const immutable = writeRoot(path.join(BRAIN_HOME, 'versions', '4.0.2'));
const backup = writeRoot(path.join(BRAIN_HOME, 'kb', 'backups', '4.0.2'));

const discovered = providerKeys.discover().sort();
const consoleFiles = surfaces.map(({ console }) => console).sort();
check('BPK1 discovery is bounded to executable Console surfaces',
  JSON.stringify(discovered) === JSON.stringify(consoleFiles));
check('BPK2 immutable versions and Brain backups are excluded',
  !discovered.includes(immutable.console) && !discovered.includes(backup.console));

const pure = providerKeys.patchSource(providerFixture);
check('BPK3 the exact fallback edit applies once', pure.applied.length === 1 && pure.missing.length === 0);
check('BPK4 ownership and reverse are exact',
  providerKeys.isPatched(pure.next) && pure.next.includes(providerKeys.PATCH_MARKER)
    && providerKeys.reverseSource(pure.next) === providerFixture
    && providerKeys.patchSource(providerKeys.reverseSource(pure.next)).next === pure.next);

const missing = providerFixture.replace("  } catch { house = { provider: cfg.provider && cfg.provider !== 'auto' ? cfg.provider : 'anthropic', source: 'default' }; }", '  } catch { house = null; }');
check('BPK5 anchor drift is detected and atomically refused',
  providerKeys.patchSource(missing).missing.includes('catalog-fallback')
    && composeSource(missing, ['brain-console-provider-keys']) === missing);
const ambiguous = `${providerFixture}\n${providerFixture}`;
check('BPK6 duplicate anchors are ambiguous and atomically refused',
  providerKeys.patchSource(ambiguous).missing.some((entry) => entry.includes('AMBIGUOUS'))
    && composeSource(ambiguous, ['brain-console-provider-keys']) === ambiguous);

const composedPure = composeSource(combinedConsole, [
  'brain-console-lifecycle', 'brain-console-provider-keys',
]);
check('BPK7 #79 and #86 compose on one Console source',
  lifecycle.isPatched(composedPure) && providerKeys.isPatched(composedPure));

const applied = applyComposed(['brain-console-lifecycle', 'brain-console-provider-keys']);
check('BPK8 both Console targets apply without partial writes',
  !applied.incomplete && !applied.errors);
const status = statusComposed();
check('BPK9 provider status proves every Console copy',
  status['brain-console-provider-keys'].files === consoleFiles.length
    && status['brain-console-provider-keys'].patched === consoleFiles.length);
check('BPK10 lifecycle status still proves both files per root',
  status['brain-console-lifecycle'].files === surfaces.length * 2
    && status['brain-console-lifecycle'].patched === surfaces.length * 2);
for (const { console, installer } of surfaces) {
  check(`BPK11 vendor pristine survives for ${console}`,
    fs.readFileSync(`${console}.rsp-backup`, 'utf8') === combinedConsole
      && fs.readFileSync(`${installer}.rsp-backup`, 'utf8') === lifecycleFixture.installer);
}

const withoutProvider = reconcile(['brain-console-lifecycle'], ['brain-console-provider-keys']);
check('BPK12 removing #86 preserves #79',
  !withoutProvider.errors && surfaces.every(({ console, installer }) =>
    lifecycle.isPatched(fs.readFileSync(console, 'utf8'))
      && lifecycle.isPatched(fs.readFileSync(installer, 'utf8'))
      && !providerKeys.isPatched(fs.readFileSync(console, 'utf8'))));
applyComposed(['brain-console-lifecycle', 'brain-console-provider-keys']);
const withoutLifecycle = reconcile(['brain-console-provider-keys'], ['brain-console-lifecycle']);
check('BPK13 removing #79 preserves #86',
  !withoutLifecycle.errors && surfaces.every(({ console, installer }) =>
    providerKeys.isPatched(fs.readFileSync(console, 'utf8'))
      && !lifecycle.isPatched(fs.readFileSync(console, 'utf8'))
      && fs.readFileSync(installer, 'utf8') === lifecycleFixture.installer));
const restored = reconcile([], ['brain-console-provider-keys']);
check('BPK14 final removal restores exact vendor bytes and removes backups',
  !restored.errors && surfaces.every(({ console, installer }) =>
    fs.readFileSync(console, 'utf8') === combinedConsole
      && fs.readFileSync(installer, 'utf8') === lifecycleFixture.installer
      && !fs.existsSync(`${console}.rsp-backup`) && !fs.existsSync(`${installer}.rsp-backup`)));

const runtime = path.join(SANDBOX, 'provider-runtime.mjs');
fs.writeFileSync(runtime, pure.next);
const api = await import(`${pathToFileURL(runtime).href}?behavior`);
const envNames = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY',
  'XAI_API_KEY', 'OPENROUTER_API_KEY',
];
const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const setEnv = (values) => {
  for (const name of envNames) delete process.env[name];
  Object.assign(process.env, values);
};
try {
  setEnv({ OPENAI_API_KEY: 'dummy-openai', GOOGLE_API_KEY: 'dummy-google' });
  const withGoogle = api.gatherRouterEngine();
  check('BPK15 missing catalog preserves OpenAI and Google boolean detections',
    withGoogle.keys.openai === true && withGoogle.keys.codex === true
      && withGoogle.keys.google === true && withGoogle.keys.xai === false);
  check('BPK16 key values are never returned',
    !JSON.stringify(withGoogle).includes('dummy-openai')
      && !JSON.stringify(withGoogle).includes('dummy-google'));

  setEnv({ GEMINI_API_KEY: 'dummy-gemini' });
  const withGemini = api.gatherRouterEngine();
  check('BPK17 GEMINI_API_KEY is accepted as the native Google-provider alias',
    withGemini.keys.google === true && withGemini.keys.openai === false);

  setEnv({});
  const withoutKeys = api.gatherRouterEngine();
  check('BPK18 unset-key negative controls remain false',
    withoutKeys.keys.openai === false && withoutKeys.keys.google === false
      && withoutKeys.keys.xai === false && withoutKeys.keys.openrouter === false);
} finally {
  for (const name of envNames) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
}

const mutated = pure.next.replace('Object.entries(detectSubscriptions())', 'Object.entries({})');
fs.writeFileSync(runtime, mutated);
const broken = await import(`${pathToFileURL(runtime).href}?mutation`);
setEnv({ OPENAI_API_KEY: 'dummy-openai', GOOGLE_API_KEY: 'dummy-google' });
try {
  const brokenState = broken.gatherRouterEngine();
  check('BPK19 mutation restoring empty provider keys is caught',
    brokenState.keys.openai !== true && brokenState.keys.google !== true
      && !providerKeys.isPatched(mutated));
} finally {
  for (const name of envNames) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
}

const runCli = (...args) => spawnSync(process.execPath, [path.resolve('bin/cli.mjs'), ...args], {
  env: { ...process.env, RSP_NO_LAUNCHCTL: '1', RSP_NO_SELF_UPDATE: '1' },
  encoding: 'utf8',
});
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}\n');
const installed = runCli('brain-console-provider-keys', 'install');
check(`BPK20 public CLI installs the target: ${installed.stderr}`,
  installed.status === 0 && installed.stdout.includes('re-applied on session start and by the monitor'));
const cliStatus = runCli('brain-console-provider-keys', 'status');
check('BPK21 public CLI reports every Console copy patched and tracked',
  cliStatus.status === 0 && cliStatus.stdout.includes(`${consoleFiles.length}/${consoleFiles.length} file(s) patched`)
    && cliStatus.stdout.includes('tracked'));
const removed = runCli('brain-console-provider-keys', 'uninstall');
check('BPK22 public CLI removes the target and restores all Console copies',
  removed.status === 0 && removed.stdout.includes(`restored ${consoleFiles.length} file(s)`));

console.log('✔ Brain Console provider keys (#86 bounded fallback, native detector, composition, mutation proof, exact restore)');
