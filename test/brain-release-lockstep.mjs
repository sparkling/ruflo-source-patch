// RuvNet Brain #77: a split bundle/package/host release must fail doctor without mutating Brain's
// native updater, version store, cache identities, or active generation.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SANDBOX = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-brain-lockstep-'));
const HOME = path.join(SANDBOX, 'home');
const NPX = path.join(SANDBOX, 'npx');
const GLOBAL = path.join(SANDBOX, 'global');
const BRAIN_HOME = path.join(HOME, '.cache', 'ruvnet-brain');
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.RUFLO_NPX_ROOT = NPX;
process.env.RUFLO_GLOBAL_ROOT = GLOBAL;
process.env.RSP_RUVNET_BRAIN_HOME = BRAIN_HOME;
process.env.RUVNET_BRAIN_HOME = BRAIN_HOME;

const {
  PATCH_MARKER, discover, fixtureSource, hasPatch, isPatched, patchSource, reverseSource,
} = await import('../lib/brain-release-lockstep/patcher.mjs');
const { applyComposed, composeSource, reconcile, statusComposed } = await import('../lib/plugin-compose.mjs');

const fail = (message) => {
  console.error(`✘ ${message}`);
  process.exit(1);
};
const check = (label, condition) => {
  if (!condition) fail(label);
};
const writeInstaller = (root, source = fixtureSource(), name = 'ruvnet-brain') => {
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name, version: '4.0.2' })}\n`);
  fs.writeFileSync(path.join(root, 'bin', 'install.mjs'), source);
  return path.join(root, 'bin', 'install.mjs');
};

const roots = [
  path.join(NPX, 'one', 'node_modules', 'ruvnet-brain'),
  path.join(NPX, 'two', 'node_modules', 'ruvnet-brain'),
  path.join(GLOBAL, 'ruvnet-brain'),
  path.join(BRAIN_HOME, 'kb', '.console-runtime'),
];
const files = roots.map((root) => writeInstaller(root));
writeInstaller(path.join(NPX, 'other', 'node_modules', 'ruvnet-brain'), fixtureSource(), 'not-brain');

const found = discover().sort();
check('BL1 discovers only bounded npm/npx and persistent Brain installer copies',
  JSON.stringify(found) === JSON.stringify([...files].sort()));

const pristine = fixtureSource();
const pure = patchSource(pristine);
check('BL2 all eight exact edits apply', pure.applied.length === 8 && pure.missing.length === 0);
check('BL3 the complete transform carries #77 ownership', isPatched(pure.next) && pure.next.includes(PATCH_MARKER));
check('BL4 reporting rejects the old “normal separate schedules” claim',
  pure.next.includes('release-integrity failure') && !pure.next.includes("that's normal (they update on separate schedules)"));
check('BL5 doctor health is explicitly gated on version convergence',
  pure.next.includes('v.mcp && !versionState.drift'));
check('BL5a doctor gives release-specific guidance instead of claiming reinstall can repair drift',
  pure.next.includes("versionState.drift\n          ? 'Release artifacts are split upstream"));
check('BL5b the final doctor verdict says upstream release drift cannot be repaired locally',
  pure.next.includes('release artifacts are split upstream; this cannot be repaired locally'));
check('BL5c feedback cannot call a split release healthy or prescribe a futile reinstall',
  pure.next.includes('s.mcp && !versionState.drift')
    && pure.next.includes('release artifacts are not in version lockstep'));
check('BL5d any exact-version target revision remains recognisable as ours',
  hasPatch(`// ${PATCH_MARKER}`));
check('BL5e the complete transform has a byte-exact reverse/forward proof',
  reverseSource(pure.next) === pristine && patchSource(reverseSource(pure.next)).next === pure.next);

const missingAnchor = pristine.replace('  const allGreen = v.repos > 0 && v.reader && v.mcp;', '  const allGreen = true;');
const incomplete = patchSource(missingAnchor);
check('BL6 a missing edit is detected', incomplete.missing.includes('doctor-health-gate'));
check('BL7 an atomic partial transform contributes no bytes',
  composeSource(missingAnchor, ['brain-release-lockstep']) === missingAnchor);

const duplicateAnchor = `${pristine}\n\n${pristine}`;
const ambiguous = patchSource(duplicateAnchor);
check('BL8 duplicate anchors are ambiguous rather than replace-all',
  ambiguous.missing.some((entry) => entry.includes('AMBIGUOUS')));
check('BL9 duplicate anchors also contribute no atomic patch',
  composeSource(duplicateAnchor, ['brain-release-lockstep']) === duplicateAnchor);

const applied = applyComposed(['brain-release-lockstep']);
check('BL10 every discovered installer is patched', applied.patched === files.length && !applied.incomplete && !applied.errors);
check('BL11 status proves every claimed copy',
  statusComposed()['brain-release-lockstep'].files === files.length
    && statusComposed()['brain-release-lockstep'].patched === files.length);
for (const file of files) {
  check(`BL12 ${file} has the complete transform`, isPatched(fs.readFileSync(file, 'utf8')));
  check(`BL13 ${file} preserves a pristine backup`, fs.readFileSync(`${file}.rsp-backup`, 'utf8') === pristine);
}

// Simulate a target-revision migration whose old output was accidentally adopted as the backup.
// The composition engine may repair that only when reverse + current forward transform round-trips.
for (const file of files) fs.writeFileSync(`${file}.rsp-backup`, pure.next);
const recovered = applyComposed(['brain-release-lockstep']);
check('BL13a a patched baseline is recovered by proved reverse/forward composition',
  recovered.log.filter((line) => line.startsWith('recovered-pristine ')).length === files.length);
check('BL13b recovery restores every backup to pristine vendor bytes',
  files.every((file) => fs.readFileSync(`${file}.rsp-backup`, 'utf8') === pristine));

// Execute the injected version classifier itself with controlled component versions. This catches a
// reporting patch that looks right as text but compares v-prefixed tags incorrectly or omits a host.
const start = pure.next.indexOf('function checkVersionDrift(cacheDir) {');
const end = pure.next.indexOf('\n\n/**\n * ruflo-source-patch (stuinfla/ruvnet-brain#77): shared fail-closed narration', start);
check('BL14 injected classifier can be isolated for behavior proof', start >= 0 && end > start);
const classifierSource = pure.next.slice(start, end);
const makeClassifier = (bundle, packageVersion, claude, codex) => {
  const factory = new Function(
    'fs', 'path', 'os', 'installedBrainVersion', 'PACKAGE_VERSION', 'wrapperVersion', 'codexPluginStatus',
    `${classifierSource}\nreturn checkVersionDrift;`,
  );
  return factory(
    fs, path, os, () => bundle, packageVersion, () => claude,
    () => ({ installed: Boolean(codex), version: codex }),
  );
};
fs.mkdirSync(BRAIN_HOME, { recursive: true });
fs.writeFileSync(path.join(BRAIN_HOME, 'active.json'), '{"version":"4.0.2"}\n');
const split = makeClassifier('v4.0.3', '4.0.2', '4.0.2', '4.0.2')('/unused');
check('BL15 bundle/package/Spine/Claude/Codex divergence is detected',
  split.drift && split.bundle === 'v4.0.3' && split.package === '4.0.2'
    && split.spine === '4.0.2' && split.claude === '4.0.2' && split.codex === '4.0.2');

fs.writeFileSync(path.join(BRAIN_HOME, 'active.json'), '{"version":"4.0.3"}\n');
const converged = makeClassifier('v4.0.3', '4.0.3', '4.0.3', '4.0.3')('/unused');
check('BL16 a v-prefixed but otherwise identical release is converged', !converged.drift);

const mutated = pure.next.replace(' && !versionState.drift', '');
check('BL17 mutation test: deleting the doctor gate invalidates patch evidence', !isPatched(mutated));

const restored = reconcile([], ['brain-release-lockstep']);
check('BL18 uninstall restores every claimed file', restored.restored === files.length && !restored.incomplete && !restored.errors);
for (const file of files) {
  check(`BL19 ${file} is byte-identical after uninstall`,
    fs.readFileSync(file, 'utf8') === pristine && !fs.existsSync(`${file}.rsp-backup`));
}

const runCli = (...args) => spawnSync(process.execPath, [path.resolve('bin/cli.mjs'), ...args], {
  env: { ...process.env, RSP_NO_LAUNCHCTL: '1', RSP_NO_SELF_UPDATE: '1' },
  encoding: 'utf8',
});
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}\n');
const installed = runCli('brain-release-lockstep', 'install');
if (installed.status !== 0 || !installed.stdout.includes('re-applied on session start and by the monitor')) {
  fail(`BL20 public CLI installs and tracks the target\n${installed.stdout}\n${installed.stderr}`);
}
const status = runCli('brain-release-lockstep', 'status');
check('BL21 public CLI reports every component patched and tracked',
  status.status === 0 && status.stdout.includes(`${files.length}/${files.length} file(s) patched`)
    && status.stdout.includes('tracked'));
const removed = runCli('brain-release-lockstep', 'uninstall');
check('BL22 public CLI removes the target cleanly',
  removed.status === 0 && removed.stdout.includes(`restored ${files.length} file(s)`));
check('BL23 CLI lifecycle leaves every vendor byte pristine',
  files.every((file) => fs.readFileSync(file, 'utf8') === pristine && !fs.existsSync(`${file}.rsp-backup`)));

console.log('✔ brain release lockstep (#77 fail-closed all-component doctor verdict, bounded discovery, atomic refusal, behavior proof, mutation test, exact restore)');
