// Behavioral retirement coverage for ruflo/ruflo#2660.
// The compatibility importer retires only after every active Claude/Codex copy
// proves native convergence and the native deletion/reindex route is runnable.

import fs from 'node:fs';
import path from 'node:path';

const SB = path.resolve(process.argv[2]);
const HOME = path.join(SB, 'home');
const CODEX_HOME = path.join(SB, 'codex');
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.CODEX_HOME = CODEX_HOME;
process.env.RUFLO_NPX_ROOT = path.join(SB, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(SB, 'global');

const { findPluginRoot, pristineBytes } = await import('./fixtures.mjs');
const { applyComposed, composeSource } = await import('../lib/plugin-compose.mjs');
const { PATCH_MARKER } = await import('../lib/adr-io-safety/patcher.mjs');
const { evaluate, retireSuperseded } = await import('../lib/supersede.mjs');
const state = await import('../lib/cwd/state.mjs');

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

const sourceRoot = findPluginRoot().dir;
const importerRel = path.join('scripts', 'import.mjs');
const recordsRel = path.join('scripts', 'lib', 'index-records.mjs');
const copied = [
  path.join('.claude-plugin', 'plugin.json'), importerRel, recordsRel,
  path.join('skills', 'adr-index', 'SKILL.md'),
  path.join('skills', 'adr-reindex', 'SKILL.md'),
  path.join('scripts', 'reindex.mjs'),
];
// Pin compatibility bytes while retaining current native records/skills/reindex probes.
const importer = fs.readFileSync(new URL('./fixtures/adr-index-pre3097-import.mjs', import.meta.url));
// This suite proves native convergence. A locally instrumented installed
// helper must not become its purported upstream fixture after a repair release.
const records = pristineBytes(path.join(sourceRoot, recordsRel));
if (records.toString().includes('ruflo-source-patch')) throw Error('native records fixture is locally patched');
function seedPlugin(root) {
  for (const relative of copied) {
    const source = path.join(sourceRoot, relative);
    write(path.join(root, relative), relative === importerRel ? importer : relative === recordsRel ? records : fs.readFileSync(source));
  }
}

const claudeMarketplace = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'ruflo', 'plugins', 'ruflo-adr');
const claudeCache = path.join(HOME, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-adr', '0.4.1');
const projectCache = path.join(HOME, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-adr', '0.3.0');
const projectPath = path.join(SB, 'project');
const codexMarketplace = path.join(CODEX_HOME, '.tmp', 'marketplaces', 'ruflo', 'plugins', 'ruflo-adr');
const codexCache = path.join(CODEX_HOME, 'plugins', 'cache', 'ruflo', 'ruflo-adr', '0.4.1');
for (const root of [claudeMarketplace, claudeCache, projectCache, codexMarketplace, codexCache]) seedPlugin(root);

write(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), `${JSON.stringify({
  plugins: {
    'ruflo-adr@ruflo': [
      { scope: 'user', installPath: claudeCache, version: '0.4.1' },
      { scope: 'project', enabled: true, projectPath, installPath: projectCache, version: '0.3.0' },
    ],
  },
}, null, 2)}\n`);
write(path.join(codexMarketplace, '.claude-plugin', 'plugin.json'), '{"name":"ruflo-adr","version":"0.4.1"}\n');

const memoryCommand = write(path.join(
  process.env.RUFLO_NPX_ROOT, 'fixture', 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'commands', 'memory.js',
), "const commands = ['purge'];\n");
const memoryInitializer = write(path.join(
  process.env.RUFLO_NPX_ROOT, 'fixture', 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js',
), "const lockFile = p + '.rsp-lock';\ne.code = 'RSP_MEMORY_LOCK_UNAVAILABLE';\nconst __rufloLockScope = new __rufloAsyncLocalStorage();\npurgeNamespace = __rufloGuard(purgeNamespace);\n");

const brokenRecords = `
export const adrRecordKey = () => 'random';
export const adrRecordValue = () => 'same';
export const edgeKey = () => 'random';
export const memoryStoreArgs = () => [];
export const uniqueEdges = (edges) => edges;
`;

console.log('\nADR index retirement');
state.writeState({ patchTargets: [], pluginTargets: ['adr-index'], retired: {} });
const applied = applyComposed(['adr-index']);
const claudeImporters = [claudeMarketplace, claudeCache, projectCache]
  .map((root) => path.join(root, importerRel));
check('AI1 compatibility patch applies cleanly to every Claude copy',
  applied.incomplete === 0 && claudeImporters.every((file) => fs.readFileSync(file, 'utf8').includes('ruflo-source-patch (#2660)')),
  JSON.stringify(applied));

// The convergence contract does not require the later edge parser API.
write(path.join(codexCache, recordsRel), records.toString().replace(
  'export function parseEdgeKey(', 'function parseEdgeKey('));
check('AI1b native records without an edge parser still prove convergence',
  evaluate('adr-index').state === 'superseded');
write(path.join(codexCache, recordsRel), brokenRecords);
const stale = evaluate('adr-index');
check('AI2 one stale active copy keeps the patch live',
  stale.state === 'live' && /1\/4 active/.test(stale.evidence), JSON.stringify(stale));
const refused = retireSuperseded(state.readState());
check('AI3 failed proof cannot retire or mutate the patch',
  refused.retired === 0 && state.readState().pluginTargets.includes('adr-index')
    && claudeImporters.every((file) => fs.existsSync(`${file}.rsp-backup`)));

write(path.join(codexCache, recordsRel), records);
write(`${path.join(codexCache, importerRel)}.rsp-backup`, 'legacy importer\n');
const orphanIgnored = evaluate('adr-index');
check('AI4 fixed current bytes outrank a stale backup and an orphaned project is ignored',
  orphanIgnored.state === 'superseded' && /all 4 active/.test(orphanIgnored.evidence), JSON.stringify(orphanIgnored));

const marketplaceImporter = path.join(claudeMarketplace, importerRel);
const goodBackup = fs.readFileSync(`${marketplaceImporter}.rsp-backup`);
write(`${marketplaceImporter}.rsp-backup`, 'legacy importer\n');
const poisoned = evaluate('adr-index');
check('AI5 locally patched bytes cannot prove themselves over a stale backup',
  poisoned.state === 'unknown' && /does not exactly compose/.test(poisoned.evidence), JSON.stringify(poisoned));
write(`${marketplaceImporter}.rsp-backup`, goodBackup);

fs.mkdirSync(projectPath, { recursive: true });
write(path.join(projectCache, recordsRel), brokenRecords);
const activeProject = evaluate('adr-index');
check('AI6 an existing registered project copy becomes part of the proof',
  activeProject.state === 'live' && /1\/5 active/.test(activeProject.evidence), JSON.stringify(activeProject));
write(path.join(projectCache, recordsRel), records);

write(memoryInitializer, "const lockFile = p + '.rsp-lock';\npurgeNamespace = __rufloGuard(purgeNamespace);\n");
const unsafeReindex = evaluate('adr-index');
check('AI7 an unsafe native deletion route keeps the patch live',
  unsafeReindex.state === 'live' && /deletion route is not runnable/.test(unsafeReindex.evidence), JSON.stringify(unsafeReindex));
write(memoryInitializer, "const lockFile = p + '.rsp-lock';\ne.code = 'RSP_MEMORY_LOCK_UNAVAILABLE';\nconst __rufloLockScope = new __rufloAsyncLocalStorage();\npurgeNamespace = __rufloGuard(purgeNamespace);\n");

const ready = evaluate('adr-index');
check('AI8 every active copy plus the runnable deletion route permits retirement',
  ready.state === 'superseded' && /all 5 active/.test(ready.evidence), JSON.stringify(ready));
const retired = retireSuperseded(state.readState());
const after = state.readState();
check('AI9 retirement restores vendor importers and records terminal evidence',
  retired.retired === 1
    && !after.pluginTargets.includes('adr-index')
    && /all 5 active/.test(after.retired['adr-index']?.evidence || '')
    && claudeImporters.every((file) => fs.readFileSync(file).equals(importer))
    && claudeImporters.every((file) => !fs.existsSync(`${file}.rsp-backup`)),
  JSON.stringify({ retired, state: after }));

// Codex importers can carry only the surviving #3147 sibling. Its replacement
// loops are deliberately different from native #2660 anchors; prove the saved
// vendor bytes through the exact installed composition before checking those anchors.
const bothTargets = ['adr-index', 'adr-io-safety'];
function seedClaudeComposition(installed) {
  for (const file of claudeImporters) {
    write(file, composeSource(importer.toString(), installed));
    write(`${file}.rsp-backup`, importer);
  }
}
state.writeState({ patchTargets: [], pluginTargets: bothTargets, retired: {} });
seedClaudeComposition(bothTargets);
const siblingFiles = [codexMarketplace, codexCache].map((root) => path.join(root, importerRel));
const siblingSource = composeSource(importer.toString(), ['adr-io-safety']);
check('AI10 fixture carries only the exact ADR IO safety sibling patch',
  siblingSource.includes(PATCH_MARKER)
    && !siblingSource.includes('ruflo-source-patch (#2660)')
    && siblingSource !== importer.toString());
for (const file of siblingFiles) {
  write(file, siblingSource);
  write(`${file}.rsp-backup`, importer);
}
const siblingReady = evaluate('adr-index');
check('AI11 all-mode sibling-only Codex copies prove native index retirement',
  siblingReady.state === 'superseded' && /all 5 active/.test(siblingReady.evidence), JSON.stringify(siblingReady));
seedClaudeComposition(['adr-io-safety']);
const reconciledBeforeStateCommit = evaluate('adr-index');
check('AI11 post-reconcile proof accepts exact remaining siblings before state commits retirement',
  reconciledBeforeStateCommit.state === 'superseded' && /all 5 active/.test(reconciledBeforeStateCommit.evidence),
  JSON.stringify(reconciledBeforeStateCommit));

const siblingFile = siblingFiles[0];
for (const [name, backup, current, installed, expected] of [
  ['empty backup', '', siblingSource, bothTargets, /empty or locally patched/],
  ['patched backup', siblingSource, siblingSource, bothTargets, /empty or locally patched/],
  ['stale backup', 'legacy importer\n', siblingSource, bothTargets, /does not exactly compose/],
  ['mutated live bytes', importer, `${siblingSource}\n// unexplained change\n`, bothTargets, /does not exactly compose/],
  ['orphaned sibling', importer, siblingSource, ['adr-index'], /does not exactly compose/],
]) {
  state.writeState({ patchTargets: [], pluginTargets: installed, retired: {} });
  seedClaudeComposition(installed);
  write(siblingFile, current);
  write(`${siblingFile}.rsp-backup`, backup);
  const proof = evaluate('adr-index');
  check(`AI12 ${name} refuses retirement and preserves both files`,
    proof.state === 'unknown' && expected.test(proof.evidence)
      && fs.readFileSync(siblingFile, 'utf8') === current.toString()
      && fs.readFileSync(`${siblingFile}.rsp-backup`, 'utf8') === backup.toString(), JSON.stringify(proof));
}
state.writeState({ patchTargets: [], pluginTargets: bothTargets, retired: {} });
seedClaudeComposition(bothTargets);
write(siblingFile, siblingSource);
fs.rmSync(`${siblingFile}.rsp-backup`);
const missingBackup = evaluate('adr-index');
check('AI13 missing sibling pristine refuses retirement without mutation',
  missingBackup.state === 'unknown' && /could not read/.test(missingBackup.evidence)
    && fs.readFileSync(siblingFile, 'utf8') === siblingSource, JSON.stringify(missingBackup));
write(`${siblingFile}.rsp-backup`, importer);

void memoryCommand;
if (failures) {
  console.error(`\n${failures} adr-index retirement test(s) failed`);
  process.exit(1);
}
console.log('\nAll adr-index retirement tests passed');
