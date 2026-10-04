import fs from 'node:fs';
import { isBridgeSource, patchBridgeSource, hasBridgePatch, isBridgePatched, reverseBridgeSource } from './bridge.mjs';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
export const NAME = 'ruflo-pattern-receipt';
export const PATCH_MARKER = 'ruflo-source-patch (ruflo#3691)';
export const EDITS = [
  ["            if (result) {\n                // #3288:", `            if (result) {
                // ${PATCH_MARKER}: failed bridge results never claim persistence.
                if (result.success !== true) return { ...result, success: false, degraded: true,
                    reason: 'pattern-persistence-unconfirmed', note: 'Pattern persistence was not confirmed by the native bridge.' };
                // #3288:`],
  ["                const { storeEntry } = await import('../memory/memory-initializer.js');\n                const patternId =",
    "                const { storeEntry, getEntry } = await import('../memory/memory-initializer.js');\n                const patternId ="],
  ["                await storeEntry({\n                    key: patternId,", "                const stored = await storeEntry({\n                    key: patternId,"],
  ["                    tags: [type, 'reasoning-pattern', 'fallback'],\n                });\n                return {\n                    success: true,",
    `                    tags: [type, 'reasoning-pattern', 'fallback'],
                });
                if (stored?.success !== true) throw new Error('Pattern fallback store refused: ' + (stored?.error || 'missing successful store result'));
                const readback = await getEntry({ key: patternId, namespace: 'pattern' });
                if (readback?.success !== true || readback.found !== true || readback.entry?.key !== patternId
                    || readback.entry.namespace !== 'pattern' || readback.entry.content !== value) {
                    throw new Error('Pattern fallback exact readback failed: ' + (readback?.error || 'stored value not verified'));
                }
                return {
                    success: true,
                    namespace: 'pattern',
                    verified: true,`],
];
const count = (s, n) => s.split(n).length - 1;
export const hasPatch = s => isBridgeSource(s) ? hasBridgePatch(s) : s.includes(PATCH_MARKER);
export const isPatched = s => isBridgeSource(s) ? isBridgePatched(s) : count(s, PATCH_MARKER) === 1 && EDITS.every(([, next]) => count(s, next) === 1);
export function patchSource(source) {
  if (isBridgeSource(source)) return patchBridgeSource(source);
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || EDITS.some(([anchor]) => count(source, anchor) !== 1)) return { next: source, applied: [], missing: ['native-pattern-receipt-anchors'] };
  return { next: EDITS.reduce((s, [a, b]) => s.replace(a, b), source), applied: [NAME], missing: [] };
}
export const reverseSource = s => isBridgeSource(s) ? reverseBridgeSource(s) : EDITS.reduceRight((s, [a, b]) => s.replace(b, a), s);
export const discover = () => [
  ...discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'agentdb-tools.js']),
  ...discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js']),
];
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('unsafe native pattern tools');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw new Error('unproved native pattern receipt anchors');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
