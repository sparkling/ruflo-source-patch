// RuvNet Brain #81: standalone memory-doctor discovery must measure common/configured roots, not
// silently equate an empty ~/Code with an empty AgentDB fleet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SANDBOX = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-brain-memory-roots-'));
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

const {
  PATCH_MARKER, discover, fixtureSource, isPatched, patchSource, reverseSource,
} = await import('../lib/brain-memory-doctor-roots/patcher.mjs');
const { applyComposed, composeSource, reconcile, statusComposed } = await import('../lib/plugin-compose.mjs');

const fail = (message) => { console.error(`✘ ${message}`); process.exit(1); };
const check = (label, condition) => { if (!condition) fail(label); };
const writeDoctor = (root, source = fixtureSource(), name = 'ruvnet-brain') => {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name, version: '4.0.2' })}\n`);
  fs.writeFileSync(path.join(root, 'scripts', 'memory-doctor.mjs'), source);
  return path.join(root, 'scripts', 'memory-doctor.mjs');
};

const roots = [
  MARKETPLACE,
  path.join(NPX, 'one', 'node_modules', 'ruvnet-brain'),
  path.join(NPX, 'two', 'node_modules', 'ruvnet-brain'),
  path.join(GLOBAL, 'ruvnet-brain'),
  path.join(BRAIN_HOME, 'kb', '.console-runtime'),
];
const files = roots.map((root) => writeDoctor(root));
writeDoctor(path.join(NPX, 'other', 'node_modules', 'ruvnet-brain'), fixtureSource(), 'not-brain');
const immutable = writeDoctor(path.join(BRAIN_HOME, 'versions', '9.9.9'));
fs.copyFileSync(immutable, `${immutable}.rsp-backup`);

check('BMR1 discovers only bounded Brain memory-doctor copies',
  JSON.stringify(discover().sort()) === JSON.stringify([...files].sort()));
check('BMR1a discovery excludes immutable Brain versions and their backups',
  !discover().includes(immutable) && !discover().includes(`${immutable}.rsp-backup`));

const pristine = fixtureSource();
const pure = patchSource(pristine);
check('BMR2 all six exact edits apply', pure.applied.length === 6 && pure.missing.length === 0);
check('BMR3 complete output carries #81 ownership', isPatched(pure.next) && pure.next.includes(PATCH_MARKER));
check('BMR4 transform reverses byte-exactly',
  reverseSource(pure.next) === pristine && patchSource(reverseSource(pure.next)).next === pure.next);

const missing = pristine.replace('  walk(root, 0);', '  walk(path.resolve(root), 0);');
check('BMR5 missing walk anchor is detected', patchSource(missing).missing.includes('fleet-walk'));
check('BMR6 atomic target writes nothing on partial upstream drift',
  composeSource(missing, ['brain-memory-doctor-roots']) === missing);
const ambiguous = `${pristine}\n${pristine}`;
check('BMR7 duplicate anchors are ambiguous',
  patchSource(ambiguous).missing.some((entry) => entry.includes('AMBIGUOUS')));

const applied = applyComposed(['brain-memory-doctor-roots']);
check('BMR8 every discovered doctor is patched',
  applied.patched === files.length && !applied.incomplete && !applied.errors);
const statusState = statusComposed()['brain-memory-doctor-roots'];
check('BMR9 status proves every claimed copy',
  statusState.files === files.length && statusState.patched === files.length);
for (const file of files) {
  check(`BMR10 ${file} preserves vendor pristine`,
    isPatched(fs.readFileSync(file, 'utf8')) && fs.readFileSync(`${file}.rsp-backup`, 'utf8') === pristine);
}

const store = (project) => {
  const file = path.join(project, '.swarm', 'memory.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'fixture');
  return file;
};
const sourceA = store(path.join(HOME, 'source', 'hm', 'a'));
const workB = store(path.join(HOME, 'work', 'b'));
const ignored = store(path.join(HOME, 'source', 'node_modules', 'ignored'));
const extra = store(path.join(HOME, '.claude'));
const sourceACanonical = fs.realpathSync(sourceA);
const workBCanonical = fs.realpathSync(workB);
const extraCanonical = fs.realpathSync(extra);
check('BMR11 test fixture has no legacy ~/Code root', !fs.existsSync(path.join(HOME, 'Code')));

let behaviorSeq = 0;
async function executeFindStores(source, config) {
  const runtime = path.join(SANDBOX, `memory-doctor-runtime-${behaviorSeq++}.mjs`);
  const withHome = source.replace('const HOME = os.homedir();', `const HOME = ${JSON.stringify(HOME)};`);
  fs.writeFileSync(runtime, withHome);
  const configFile = path.join(HOME, '.claude', 'ruvnet-brain', 'config.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  if (config === undefined) fs.rmSync(configFile, { force: true });
  else fs.writeFileSync(configFile, `${JSON.stringify(config)}\n`);
  const mod = await import(`${pathToFileURL(runtime).href}?${behaviorSeq}`);
  return { all: mod.findStores(), scoped: mod.findStores(path.join(HOME, 'source', 'hm')) };
}

const defaultScan = await executeFindStores(pure.next);
check('BMR12 no-argument discovery covers ~/source and ~/work without ~/Code',
  defaultScan.all.includes(sourceACanonical) && defaultScan.all.includes(workBCanonical));
check('BMR13 discovery preserves known extra stores and skips node_modules',
  defaultScan.all.includes(extraCanonical) && !defaultScan.all.includes(fs.realpathSync(ignored)));
check('BMR14 explicit-root callers still discover their requested tree',
  defaultScan.scoped.includes(sourceACanonical) && !defaultScan.scoped.includes(workBCanonical));

const custom = store(path.join(HOME, 'custom-root', 'c'));
const customCanonical = fs.realpathSync(custom);
const configuredScan = await executeFindStores(pure.next, { scanRoots: ['custom-root'] });
check('BMR15 configured scanRoots replaces common defaults',
  configuredScan.all.includes(customCanonical)
    && !configuredScan.all.includes(sourceACanonical) && !configuredScan.all.includes(workBCanonical));

let invalidConfigError = '';
try { await executeFindStores(pure.next, { scanRoots: [{ invalid: true }, ''] }); }
catch (error) { invalidConfigError = error.message; }
check('BMR15a an all-invalid configured override fails loudly instead of reporting zero',
  invalidConfigError.includes('no valid directory paths'));
let missingConfigError = '';
try { await executeFindStores(pure.next, { scanRoots: ['does-not-exist'] }); }
catch (error) { missingConfigError = error.message; }
check('BMR15b an all-missing configured override fails loudly instead of reporting zero',
  missingConfigError.includes('none of the configured scanRoots directories exists'));

fs.symlinkSync(path.join(HOME, 'source'), path.join(HOME, 'source-link'));
const overlapping = await executeFindStores(pure.next, {
  scanRoots: ['source', 'source/hm', 'source-link'],
});
check('BMR15c overlapping and symlinked roots return each canonical store exactly once',
  overlapping.all.filter((db) => db === sourceACanonical).length === 1);

const mutatedSource = pure.next.replace("'Code', 'code', 'src', 'source', 'projects', 'dev', 'work'", "'Code'");
const mutationScan = await executeFindStores(mutatedSource);
check('BMR16 mutation test: restoring the ~/Code-only default loses the real fleet',
  !mutationScan.all.includes(sourceACanonical) && !mutationScan.all.includes(workBCanonical)
    && !isPatched(mutatedSource));

const restored = reconcile([], ['brain-memory-doctor-roots']);
check('BMR17 uninstall restores every claimed file',
  restored.restored === files.length && !restored.incomplete && !restored.errors);
check('BMR18 uninstall is byte-exact', files.every((file) =>
  fs.readFileSync(file, 'utf8') === pristine && !fs.existsSync(`${file}.rsp-backup`)));

const runCli = (...args) => spawnSync(process.execPath, [path.resolve('bin/cli.mjs'), ...args], {
  env: { ...process.env, RSP_NO_LAUNCHCTL: '1', RSP_NO_SELF_UPDATE: '1' },
  encoding: 'utf8',
});
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}\n');
const installed = runCli('brain-memory-doctor-roots', 'install');
check(`BMR19 public CLI installs and tracks the target: ${installed.stderr}`,
  installed.status === 0 && installed.stdout.includes('re-applied on session start and by the monitor'));
const cliStatus = runCli('brain-memory-doctor-roots', 'status');
check('BMR20 public CLI reports all copies patched and tracked',
  cliStatus.status === 0 && cliStatus.stdout.includes(`${files.length}/${files.length} file(s) patched`)
    && cliStatus.stdout.includes('tracked'));
const removed = runCli('brain-memory-doctor-roots', 'uninstall');
check('BMR21 public CLI removes the target cleanly',
  removed.status === 0 && removed.stdout.includes(`restored ${files.length} file(s)`));

console.log('✔ Brain memory-doctor roots (#81 common/configured defaults, explicit-root compatibility, bounded discovery, atomic refusal, mutation proof, exact restore)');
