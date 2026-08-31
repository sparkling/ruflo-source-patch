// Ruflo #3143: memory-bridge accepts dbPath but upstream caches one process-wide
// ControllerRegistry. Prove the pristine first-open-wins bug, then execute the patched
// A -> B / B -> A boundary, canonical aliases, availability, and scoped/all shutdown.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SB = process.argv[2];
const HOME = path.join(SB, 'home');
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.RUFLO_NPX_ROOT = path.join(SB, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(SB, 'global');
process.env.RSP_NO_STALE_WRITER_KILL = '1';
process.env.RSP_NO_HOST_AUTO_UPDATE = '1';

const { REPO, findVendorRootWith, pristineBytes } = await import('./fixtures.mjs');
const patchLib = await import('../lib/cwd/patch-library.mjs');

const fail = (message) => {
  console.error(`✘ ${message}`);
  process.exit(1);
};
const check = (condition, message) => {
  if (!condition) fail(message);
};

const bridgeRel = path.join('@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js');
const initRel = path.join('@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js');
const fsRel = path.join('@claude-flow', 'cli', 'dist', 'src', 'fs-secure.js');
const vendor = findVendorRootWith(path.join('dist', 'src', 'memory', 'memory-bridge.js'), [
  'let registryPromise = null;',
  'async function getRegistry(dbPath) {',
  'export function __setMemoryBridgeRegistryForTests(registry) {',
  'export async function shutdownBridge() {',
]);
const nodeModules = path.join(process.env.RUFLO_NPX_ROOT, 'fixture', 'node_modules');
const packageDir = path.join(nodeModules, '@claude-flow', 'cli');

fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}');
for (const rel of [bridgeRel, initRel, fsRel]) {
  const source = path.join(vendor, rel);
  const target = path.join(nodeModules, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, pristineBytes(source));
}
fs.copyFileSync(
  path.join(vendor, '@claude-flow', 'cli', 'package.json'),
  path.join(packageDir, 'package.json'),
);

const baselineDir = path.join(SB, 'baseline');
fs.mkdirSync(baselineDir, { recursive: true });
fs.writeFileSync(path.join(baselineDir, 'package.json'), '{"type":"module"}\n');
fs.writeFileSync(path.join(baselineDir, 'memory-bridge.js'), pristineBytes(path.join(vendor, bridgeRel)));

const dbA = path.join(SB, 'project-memory.db');
const dbB = path.join(SB, 'user-memory.db');
const dbAlias = path.join(SB, 'project-memory-alias.db');
const dbC = path.join(SB, 'concurrent-memory.db');
const dbCAlias = path.join(SB, 'concurrent-memory-alias.db');
const dbFailure = path.join(SB, 'fail-memory.db');
const realParent = path.join(SB, 'real-parent');
const aliasParent = path.join(SB, 'alias-parent');
const futureDb = path.join(realParent, 'future-memory.db');
const futureAlias = path.join(aliasParent, 'future-memory.db');
fs.writeFileSync(dbA, 'A');
fs.writeFileSync(dbB, 'B');
fs.writeFileSync(dbC, 'C');
fs.writeFileSync(dbFailure, 'FAIL');
fs.mkdirSync(realParent);
fs.symlinkSync(dbA, dbAlias);
fs.symlinkSync(dbC, dbCAlias);
fs.symlinkSync(realParent, aliasParent);

// Exercise getRegistry() itself, rather than proving only the deterministic setter.
// The bridge dynamically imports this package from the sandbox node_modules tree.
const fakeMemoryDir = path.join(nodeModules, '@claude-flow', 'memory');
const fakeMemoryIndex = path.join(fakeMemoryDir, 'index.js');
fs.mkdirSync(fakeMemoryDir, { recursive: true });
fs.writeFileSync(path.join(fakeMemoryDir, 'package.json'), JSON.stringify({
  name: '@claude-flow/memory',
  type: 'module',
  exports: './index.js',
}));
fs.writeFileSync(fakeMemoryIndex, `export const instances = [];
export class ControllerRegistry {
  constructor() { this.options = null; this.shutdowns = 0; this.controllers = new Map(); instances.push(this); }
  async initialize(options) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (options.dbPath.includes('fail-memory.db')) throw new Error('fixture init failure');
    this.options = options;
  }
  listControllers() { return [{ name: this.options.dbPath, enabled: true, level: 1 }]; }
  get(name) { return this.controllers.get(name); }
  set(name, value) { this.controllers.set(name, value); }
  async shutdown() { this.shutdowns += 1; }
}
`);

const makeRegistry = (name) => ({
  name,
  shutdowns: 0,
  listControllers() { return [{ name, enabled: true, level: 1 }]; },
  async shutdown() { this.shutdowns += 1; },
});

// TEETH: the pristine module must exhibit the defect this patch claims to fix.
const pristine = await import(`${pathToFileURL(path.join(baselineDir, 'memory-bridge.js')).href}?baseline=1`);
const pristineA = makeRegistry('pristine-a');
pristine.__setMemoryBridgeRegistryForTests(pristineA);
const pristineCrossPath = await pristine.bridgeListControllers(dbB);
check(pristineCrossPath?.[0]?.name === 'pristine-a',
  'MBP0 pristine fixture no longer reproduces first-open-wins; review retirement instead of patching');
await pristine.shutdownBridge();

const env = {
  ...process.env,
  RUFLO_SOURCE_PATCH_HOME: HOME,
  RUFLO_NPX_ROOT: process.env.RUFLO_NPX_ROOT,
  RUFLO_GLOBAL_ROOT: process.env.RUFLO_GLOBAL_ROOT,
  RSP_NO_STALE_WRITER_KILL: '1',
  RSP_NO_HOST_AUTO_UPDATE: '1',
};
const installed = spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), 'memory', 'install'], {
  env,
  encoding: 'utf8',
});
check(installed.status === 0, `MBP1 memory install failed:\n${installed.stdout}${installed.stderr}`);

const patchedBridge = path.join(nodeModules, bridgeRel);
const patchedInit = path.join(nodeModules, initRel);
for (const file of [patchedBridge, patchedInit]) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  check(syntax.status === 0, `MBP2 patched source is invalid: ${file}\n${syntax.stderr}`);
}
const bridgeSource = fs.readFileSync(patchedBridge, 'utf8');
const initSource = fs.readFileSync(patchedInit, 'utf8');
check(bridgeSource.includes('const __RSP_MEMORY_BRIDGE_PATHS_REVISION = "2026-08-31.1";'),
  'MBP3 path-keyed bridge revision proof is absent');
check(!bridgeSource.includes('if (registryInstance)\n        return registryInstance;'),
  'MBP3 process-global first-open return remains live');
check(initSource.includes("getBridgeFailureReason?.(dbPath)"),
  'MBP3 WAL diagnostics are not scoped to the failed database');
check(!initSource.includes("walRefusalError('write'),")
  && !initSource.includes("walRefusalError('read/write'),"),
  'MBP3 an unscoped WAL diagnostic call remains');

const bridge = await import(`${pathToFileURL(patchedBridge).href}?patched=1`);
const fakeMemory = await import(pathToFileURL(fakeMemoryIndex).href);

const aFirstRegistry = await bridge.getControllerRegistry(dbA);
const bSecondRegistry = await bridge.getControllerRegistry(dbB);
const aFirst = await bridge.bridgeListControllers(dbA);
const bSecond = await bridge.bridgeListControllers(dbB);
check(aFirstRegistry !== bSecondRegistry
  && aFirst?.[0]?.name === fs.realpathSync(dbA)
  && bSecond?.[0]?.name === fs.realpathSync(dbB),
  'MBP4 A -> B did not preserve database identity');
await bridge.shutdownBridge();

const bFirstRegistry = await bridge.getControllerRegistry(dbB);
const aSecondRegistry = await bridge.getControllerRegistry(dbA);
const bFirst = await bridge.bridgeListControllers(dbB);
const aSecond = await bridge.bridgeListControllers(dbA);
check(bFirstRegistry !== aSecondRegistry
  && bFirst?.[0]?.name === fs.realpathSync(dbB)
  && aSecond?.[0]?.name === fs.realpathSync(dbA),
  'MBP5 B -> A did not preserve database identity');

const beforeConcurrent = fakeMemory.instances.length;
const [concurrentA, concurrentB, concurrentAlias] = await Promise.all([
  bridge.getControllerRegistry(dbC),
  bridge.getControllerRegistry(dbC),
  bridge.getControllerRegistry(dbCAlias),
]);
check(concurrentA === concurrentB && concurrentB === concurrentAlias
  && fakeMemory.instances.length === beforeConcurrent + 1,
  'MBP6 concurrent canonical aliases did not deduplicate one initialization');
check((await bridge.getControllerRegistry(dbAlias)) === aSecondRegistry,
  'MBP6 a symlink alias created a second database identity');
const [futureA, futureB] = await Promise.all([
  bridge.getControllerRegistry(futureDb),
  bridge.getControllerRegistry(futureAlias),
]);
check(futureA === futureB,
  'MBP6 a symlinked existing parent created two identities for a future database');
check((await bridge.getControllerRegistry(':memory:'))?.options?.dbPath === ':memory:',
  'MBP6 the SQLite :memory: sentinel was rewritten as a filesystem path');
check(await bridge.isBridgeAvailable(dbA) && await bridge.isBridgeAvailable(dbB)
  && await bridge.isBridgeAvailable(dbC),
  'MBP7 availability is not scoped per database');

check(await bridge.getControllerRegistry(dbFailure) === null
  && await bridge.isBridgeAvailable(dbFailure) === false
  && bridge.getBridgeFailureReason(dbFailure) === 'fixture init failure'
  && await bridge.isBridgeAvailable(dbB) === true,
  'MBP8 one database initialization failure poisoned another database');

await bridge.shutdownBridge(dbCAlias);
check(concurrentA.shutdowns === 1 && bFirstRegistry.shutdowns === 0,
  'MBP8 path-scoped shutdown closed the wrong registry');
check((await bridge.getControllerRegistry(dbB)) === bFirstRegistry,
  'MBP8 path-scoped shutdown disturbed an unrelated database');
await bridge.shutdownBridge();
check(bFirstRegistry.shutdowns === 1 && aSecondRegistry.shutdowns === 1
  && concurrentA.shutdowns === 1,
  'MBP9 all-state shutdown did not close each registry exactly once');

const status = spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), 'memory', 'status'], {
  env,
  encoding: 'utf8',
});
check(status.status === 0 && /memory\s+\d+\/\d+ file\(s\) satisfied/.test(`${status.stdout}${status.stderr}`),
  `MBP10 memory status does not recognize the installed bridge patch:\n${status.stdout}${status.stderr}`);

check(patchLib.ENTRIES.some((entry) => entry.id === 'memory/path-keyed-bridge'),
  'MBP11 path-keyed bridge entry is absent from the shipped patch table');

console.log('✔ memory bridge paths (pristine defect, A/B isolation, aliases, diagnostics, scoped shutdown)');
