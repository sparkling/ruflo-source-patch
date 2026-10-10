import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { backupMemoryDb, bridgeBackupExisting, tool } from './runtime.mjs';
export const NAME = 'ruflo-memory-backup';
export const PATCH_MARKER = 'ruflo-source-patch (#2895)';
const start = 'export async function backupMemoryDb(';
const end = '/** Verify a snapshot';
const nativeBody = fs.readFileSync(new URL('./native-backup.js', import.meta.url), 'utf8');
const nativeHash = 'afed0af46eb2cb5ee83061cd631c9f84cb6f0d7c492617e71a91f1d9103128a0';
const backup = `export ${backupMemoryDb.toString()}\n`;
const bridgeAnchor = 'export function getBridgeFailureReason(dbPath) {';
const bridge = `export ${bridgeBackupExisting.toString()}\n\n${bridgeAnchor}`;
const toolsAnchor = 'export const memoryTools = [\n';
const toolSource = JSON.stringify({ ...tool, handler: undefined }).slice(0, -1)
  + `,"handler":${tool.handler.toString()}}`;
const tools = `${toolsAnchor}    // ${PATCH_MARKER}: existing native owner backup only.\n    ${toolSource},\n`;
const helpAnchor = "description: 'Snapshot active project memory stores — WAL-safe, rotated, optional GCS offsite',";
const help = `// ${PATCH_MARKER}: unverified snapshots cannot justify retention pruning.\n    description: 'Native online backup with source integrity check; preserves history, no raw-copy fallback; restore not qualified',`;
const count = (s, needle) => s.split(needle).length - 1;
const section = s => {
  const a = s.indexOf(start), b = s.indexOf(end, a);
  return a >= 0 && b > a && count(s, start) === 1 && count(s, end) === 1 ? s.slice(a, b) : null;
};
const sha = s => createHash('sha256').update(s).digest('hex');
const leaseVerified = s => {
  const a = s.indexOf('async function withBridgeOperation(operation) {'), b = s.indexOf('\n}', a);
  return a >= 0 && b > a && sha(s.slice(a, b + 2)) === '52188bdb5ac63c7a46002aa1b13eb0689af366fde3019e1c700b3fa7b86a7b43';
};
export const hasPatch = s => s.includes(PATCH_MARKER);
export const isPatched = s => count(s, PATCH_MARKER) === 1 && (
  section(s) === backup || (count(s, bridge) === 1 && leaseVerified(s)) || count(s, tools) === 1 || count(s, help) === 1);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source)) return { next: source, applied: [], missing: ['modified-backup-overlay'] };
  const body = section(source);
  if (body && sha(body) === nativeHash && source.includes("import { loadBetterSqlite3 } from '../memory/shared-sqlite.js';"))
    return { next: source.replace(body, backup), applied: [NAME], missing: [] };
  if (count(source, bridgeAnchor) === 1 && !source.includes('bridgeBackupExisting')
      && source.includes('const registryInstances = new Map();')
      && leaseVerified(source))
    return { next: source.replace(bridgeAnchor, bridge), applied: [NAME], missing: [] };
  if (count(source, toolsAnchor) === 1 && !source.includes("name: 'memory_backup'") && !source.includes('"name":"memory_backup"'))
    return { next: source.replace(toolsAnchor, tools), applied: [NAME], missing: [] };
  if (count(source, helpAnchor) === 1)
    return { next: source.replace(helpAnchor, help), applied: [NAME], missing: [] };
  return { next: source, applied: [], missing: ['reviewed-native-backup-anchor'] };
}
// The shared pristine owner restores the service function; no second backup ledger.
export const reverseSource = s => s.replace(backup, nativeBody).replace(bridge, bridgeAnchor).replace(tools, toolsAnchor).replace(help, helpAnchor);
export const discover = () => ['services/memory-backup.js', 'memory/memory-bridge.js', 'mcp-tools/memory-tools.js', 'commands/memory-backup.js']
  .flatMap(file => discoverCli(['@claude-flow', 'cli', 'dist', 'src', ...file.split('/')]));
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe source file');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unreviewed backup source');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
