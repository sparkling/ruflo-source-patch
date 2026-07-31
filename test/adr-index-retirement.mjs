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
const { applyComposed } = await import('../lib/plugin-compose.mjs');
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
const importer = pristineBytes(path.join(sourceRoot, importerRel), 'adrIndex');
const records = fs.readFileSync(path.join(sourceRoot, recordsRel));
function seedPlugin(root) {
  for (const relative of copied) {
    const source = path.join(sourceRoot, relative);
    write(path.join(root, relative), relative === importerRel ? importer : fs.readFileSync(source));
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

void memoryCommand;
if (failures) {
  console.error(`\n${failures} adr-index retirement test(s) failed`);
  process.exit(1);
}
console.log('\nAll adr-index retirement tests passed');
