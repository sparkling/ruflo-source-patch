// Native #2666/#2878 retirement proof. A current Ruflo replacement is safe only when
// purge and every ordinary sql.js mutator share one lock; a function name or version
// marker alone must not retire the legacy reconcile.

import fs from 'node:fs';
import path from 'node:path';

const SB = path.resolve(process.argv[2]);
const HOME = path.join(SB, 'home');
const NPX = path.join(SB, 'npx');
const GLOBAL = path.join(SB, 'global');
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.RUFLO_NPX_ROOT = NPX;
process.env.RUFLO_GLOBAL_ROOT = GLOBAL;

const patcher = await import('../lib/adr-reindex/patcher.mjs');

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

const nativeSource = `
const heldMemoryDbLocks = new AsyncLocalStorage();
export async function ensureSchemaColumns(dbPath) { return await withMemoryDbLock(dbPath, async () => true); }
export async function applyTemporalDecay(dbPath) { return await withMemoryDbLock(dbPath, async () => true); }
export async function storeEntry(dbPath) { await withMemoryDbLock(dbPath, async () => true); }
export async function getEntry(dbPath) { return await withMemoryDbLock(dbPath, async () => true); }
export async function deleteEntry(dbPath) { return await withMemoryDbLock(dbPath, async () => true); }
export async function withMemoryDbLock(dbPath, fn) {
  const resolved = path.resolve(dbPath);
  const held = heldMemoryDbLocks.getStore();
  const lockFile = \`\${resolved}.lock\`;
  try { return await fn(); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  throw new Error(\`timed out acquiring memory.db lock: \${lockFile}\`);
}
export async function purgeNamespace(dbPath) { return withMemoryDbLock(dbPath, async () => true); }
`;

console.log('\nADR reindex native lock retirement');
check('ARN1 complete native writer sharing is accepted',
  patcher.nativeWritersShareMemoryDbLock(nativeSource));

const missingGetLock = nativeSource.replace(
  'export async function getEntry(dbPath) { return await withMemoryDbLock(dbPath, async () => true); }',
  'export async function getEntry(dbPath) { return true; }',
);
check('ARN2 removing one ordinary writer from the lock fails the proof',
  !patcher.nativeWritersShareMemoryDbLock(missingGetLock));

const plugin = path.join(HOME, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-adr', '0.4.1');
write(path.join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"ruflo-adr"}\n');
write(path.join(plugin, 'skills', 'adr-reindex', 'SKILL.md'), '---\nname: adr-reindex\n---\n');

// Prove the public `ruflo` launcher layout, where @claude-flow/cli is nested one
// node_modules deeper than the custom global prefix root.
const nestedCli = path.join(GLOBAL, 'ruflo', 'node_modules', '@claude-flow', 'cli', 'dist', 'src');
write(path.join(nestedCli, 'commands', 'memory.js'), "const commands = ['purge'];\n");
const nestedInitializer = write(path.join(nestedCli, 'memory', 'memory-initializer.js'), nativeSource);

const ready = patcher.supersessionCheck();
check('ARN3 a nested global Ruflo CLI with the complete native lock retires',
  ready.state === 'superseded' && /every ordinary sql\.js writer/.test(ready.evidence),
  JSON.stringify(ready));

write(nestedInitializer, missingGetLock);
const partial = patcher.supersessionCheck();
check('ARN4 a native purge with one unlocked writer stays live',
  partial.state === 'live' && /does not share one proven/.test(partial.evidence),
  JSON.stringify(partial));

write(nestedInitializer, nativeSource);
const oldCli = path.join(NPX, 'old', 'node_modules', '@claude-flow', 'cli', 'dist', 'src');
write(path.join(oldCli, 'commands', 'memory.js'), "const commands = ['purge'];\n");
write(path.join(oldCli, 'memory', 'memory-initializer.js'), 'export async function purgeNamespace() {}\n');
const mixed = patcher.supersessionCheck();
check('ARN5 one runnable legacy copy prevents all-copy retirement',
  mixed.state === 'live', JSON.stringify(mixed));

if (failures) {
  console.error(`\n${failures} ADR reindex native test(s) failed`);
  process.exit(1);
}
console.log('\nAll ADR reindex native tests passed');
