import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { BRIDGE_RUNTIME, TOOL_RUNTIME } from './runtime.mjs';
export const NAME = 'ruflo-controller-inventory';
const BRIDGE_ANCHOR = '// ===== Phase 4: Health check with attestation =====';
const TOOL_ANCHOR = 'export const agentdbTools = [';
const LIST_ANCHOR = '    agentdbHealth,';
export const editsFor = source => source.includes('export async function bridgeStorePattern(options) {')
  ? [[BRIDGE_ANCHOR, BRIDGE_RUNTIME + BRIDGE_ANCHOR]]
  : [[TOOL_ANCHOR, TOOL_RUNTIME + TOOL_ANCHOR], [LIST_ANCHOR, LIST_ANCHOR + '\n    agentdbPatternList,\n    agentdbSkillList,\n    agentdbSkillGet,\n    agentdbHierarchicalStats,']];
const supportedContext = source => source.includes('export async function bridgeStorePattern(options) {')
  ? ['const operationContext =', 'async function withBridgeOperation(', 'export async function getControllerRegistry(', 'function canonicalDbPath(', 'function describeHierarchicalStore(', 'function getHierarchicalFallback('].every(token => source.includes(token))
  : source.includes('async function getBridge(');
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes('ruflo-source-patch (controller-inventory');
export const isPatched = source => supportedContext(source) && editsFor(source).every(([, replacement]) => count(source, replacement) === 1)
  && count(source, 'ruflo-source-patch (controller-inventory') === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const edits = editsFor(source);
  if (!supportedContext(source) || hasPatch(source) || /(?:bridgeControllerInventory|agentdbPatternList|agentdbSkillList|agentdbSkillGet|agentdbHierarchicalStats)/.test(source) || !edits.every(([anchor]) => count(source, anchor) === 1))
    return { next: source, applied: [], missing: ['native-controller-inventory-anchors'] };
  return { next: edits.reduce((text, [anchor, replacement]) => text.replace(anchor, () => replacement), source), applied: [NAME], missing: [] };
}
export const reverse = source => isPatched(source) ? editsFor(source).reduceRight((text, [anchor, replacement]) => text.replace(replacement, () => anchor), source) : source;
export const discover = () => [
  ...discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js']),
  ...discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'agentdb-tools.js']),
];
export function preflight() {
  const errors = [], blockedFiles = [], packages = new Map();
  for (const file of discover()) {
    const root = path.resolve(path.dirname(file), '../../..');
    if (!packages.has(root)) packages.set(root, []);
    packages.get(root).push(file);
  }
  for (const [root, files] of packages) {
    const failures = [];
    if (files.length !== 2) failures.push(root + ': complete bridge/tool pair required');
    for (const file of files) {
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe native inventory source');
        if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unproved controller inventory anchors');
      } catch (error) { failures.push(file + ': ' + error.message); }
    }
    if (failures.length) { errors.push(...failures); blockedFiles.push(...files); }
  }
  return { ok: errors.length === 0, errors, ...(errors.length && { blockedFiles }) };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, discover, preflight, patchSource, hasPatch, isPatched, reverse };
