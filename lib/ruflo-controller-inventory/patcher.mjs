import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { BRIDGE_RUNTIME, TOOL_RUNTIME } from './runtime.mjs';
import { BRIDGE_RUNTIME as OLD_BRIDGE, TOOL_RUNTIME as OLD_TOOLS } from './historical.mjs';
import { TIER_ANCHOR, TIER_RUNTIME } from './tier-runtime.mjs';
export const NAME = 'ruflo-controller-inventory';
const BRIDGE_ANCHOR = '// ===== Phase 4: Health check with attestation =====';
const TOOL_ANCHOR = 'export const agentdbTools = [';
const LIST_ANCHOR = '    agentdbHealth,';
const isTier = source => source.includes('export class TieredMemoryStore {');
const listAddition = '\n    agentdbPatternList,\n    agentdbSkillList,\n    agentdbSkillGet,\n    agentdbHierarchicalStats,';
export const editsFor = source => isTier(source) ? [[TIER_ANCHOR, TIER_RUNTIME + TIER_ANCHOR]]
  : source.includes('export async function bridgeStorePattern(options) {')
  ? [[BRIDGE_ANCHOR, BRIDGE_RUNTIME + BRIDGE_ANCHOR]]
  : [[TOOL_ANCHOR, TOOL_RUNTIME + TOOL_ANCHOR], [LIST_ANCHOR, LIST_ANCHOR + listAddition + '\n    agentdbHierarchicalList,\n    agentdbHierarchicalGet,']];
const supportedContext = source => isTier(source)
  ? ['function rowToEntry(row)', 'export function isTemporallyValid(', 'const VALID_TIERS =', '    countPersisted() {', '    db = null;', '  id TEXT PRIMARY KEY,', '  ts INTEGER NOT NULL,'].every(token => source.includes(token))
  : source.includes('export async function bridgeStorePattern(options) {')
  ? ['const operationContext =', 'async function withBridgeOperation(', 'export async function getControllerRegistry(', 'function canonicalDbPath(', 'function describeHierarchicalStore(', 'function getHierarchicalFallback('].every(token => source.includes(token))
  : source.includes('async function getBridge(');
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes('ruflo-source-patch (controller-inventory');
export const isPatched = source => supportedContext(source) && editsFor(source).every(([, replacement]) => count(source, replacement) === 1)
  && count(source, 'ruflo-source-patch (controller-inventory') === 1;
function oldEdits(source) {
  if (isTier(source)) return [];
  return source.includes('export async function bridgeStorePattern(options) {')
    ? [[BRIDGE_ANCHOR, OLD_BRIDGE + BRIDGE_ANCHOR]]
    : [[TOOL_ANCHOR, OLD_TOOLS + TOOL_ANCHOR], [LIST_ANCHOR, LIST_ANCHOR + listAddition]];
}
export function historicalPatchSource(source, current) {
  const edits = oldEdits(source);
  return { next: edits.length && edits.every(([anchor, replacement]) => count(source, anchor) === 1 && count(current, replacement) === 1)
    ? edits.reduce((text, [anchor, replacement]) => text.replace(anchor, () => replacement), source) : source };
}
function oldBase(source) {
  const edits = oldEdits(source);
  if (!edits.length || !edits.every(([, replacement]) => count(source, replacement) === 1)) return null;
  const base = edits.reduceRight((text, [anchor, replacement]) => text.replace(replacement, () => anchor), source);
  return !hasPatch(base) && supportedContext(base) ? base : null;
}
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const previous = oldBase(source);
  if (previous !== null) return patchSource(previous);
  const edits = editsFor(source);
  if (!supportedContext(source) || hasPatch(source) || /(?:bridgeControllerInventory|agentdbPatternList|agentdbSkillList|agentdbSkillGet|agentdbHierarchicalStats|agentdbHierarchicalList|agentdbHierarchicalGet|\n    listEntries\(|\n    getEntry\()/.test(source) || !edits.every(([anchor]) => count(source, anchor) === 1))
    return { next: source, applied: [], missing: ['native-controller-inventory-anchors'] };
  return { next: edits.reduce((text, [anchor, replacement]) => text.replace(anchor, () => replacement), source), applied: [NAME], missing: [] };
}
export const reverse = source => isPatched(source) ? editsFor(source).reduceRight((text, [anchor, replacement]) => text.replace(replacement, () => anchor), source) : source;
export const discover = () => [
  ...discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js']),
  ...discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'agentdb-tools.js']),
  ...discoverCli(['@claude-flow', 'memory', 'dist', 'tiered-memory.js']),
];
export function preflight() {
  const errors = [], blockedFiles = [], packages = new Map();
  for (const file of discover()) {
    if (path.basename(file) === 'tiered-memory.js') continue;
    const root = path.resolve(path.dirname(file), '../../..');
    if (!packages.has(root)) packages.set(root, []);
    packages.get(root).push(file);
  }
  for (const [root, files] of packages) {
    const failures = [];
    if (files.length !== 2) failures.push(root + ': complete bridge/tool pair required');
    const members = [...files];
    try {
      const entry = createRequire(files[0]).resolve('@claude-flow/memory');
      const tier = path.join(path.dirname(entry), 'tiered-memory.js');
      if (!discover().includes(tier)) throw Error('native tier store is outside discovered package ownership');
      members.push(tier);
    } catch (error) { failures.push(root + ': native tier-store dependency unavailable: ' + error.message); }
    for (const file of members) {
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe native inventory source');
        if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unproved controller inventory anchors');
      } catch (error) { failures.push(file + ': ' + error.message); }
    }
    if (failures.length) { errors.push(...failures); blockedFiles.push(...members); }
  }
  return { ok: errors.length === 0, errors, ...(errors.length && { blockedFiles }) };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, discover, preflight, patchSource, historicalPatchSource, hasPatch, isPatched, reverse };
