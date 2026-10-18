import fs from 'node:fs';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { BRIDGE_RUNTIME, TOOL_RUNTIME } from './runtime.mjs';
export const NAME = 'ruflo-pattern-withdrawal';
const BRIDGE_ANCHOR = '// ===== Phase 3: CausalMemoryGraph =====';
const TOOL_ANCHOR = '// ===== Export all tools =====';
const LIST_ANCHOR = '    agentdbPatternStore,\n    agentdbPatternSearch,';
export const editsFor = source => source.includes('export async function bridgeStorePattern(options) {')
  ? [[BRIDGE_ANCHOR, BRIDGE_RUNTIME + BRIDGE_ANCHOR]]
  : [[TOOL_ANCHOR, TOOL_RUNTIME + TOOL_ANCHOR], [LIST_ANCHOR, LIST_ANCHOR + '\n    agentdbPatternGet,\n    agentdbPatternDelete,']];
const supportedContext = source => source.includes('export async function bridgeStorePattern(options) {')
  ? ['const operationContext =', 'async function withBridgeOperation(', 'async function getRegistry(', 'function canonicalDbPath(', 'async function guardValidate(', 'async function logAttestation(', 'import * as crypto'].every(token => source.includes(token))
  : source.includes('async function getBridge(');
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes('ruflo-source-patch (pattern-withdrawal');
export const isPatched = source => supportedContext(source) && editsFor(source).every(([, replacement]) => count(source, replacement) === 1)
  && count(source, 'ruflo-source-patch (pattern-withdrawal') === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const edits = editsFor(source);
  if (!supportedContext(source) || hasPatch(source) || !edits.every(([anchor]) => count(source, anchor) === 1))
    return { next: source, applied: [], missing: ['native-pattern-withdrawal-anchors'] };
  return { next: edits.reduce((text, [anchor, replacement]) => text.replace(anchor, () => replacement), source), applied: [NAME], missing: [] };
}
export const reverse = source => isPatched(source) ? editsFor(source).reduceRight((text, [anchor, replacement]) => text.replace(replacement, () => anchor), source) : source;
export const discover = () => [
  ...discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js']),
  ...discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'agentdb-tools.js']),
];
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe native pattern source');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unproved pattern withdrawal anchors');
    } catch (error) { errors.push(file + ': ' + error.message); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, discover, preflight, patchSource, hasPatch, isPatched, reverse };
