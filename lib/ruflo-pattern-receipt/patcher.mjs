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
// Ruflo 3.54.x carries the #3691 refusal guard upstream, but its fallback
// handler still acknowledges a successful store without proving the exact row.
// Keep the local safety property on the new native shape as well.
export const CURRENT_EDITS = [
  ["                const { storeEntry } = await import('../memory/memory-initializer.js');\n                const patternId = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;\n                const value = JSON.stringify({ pattern, type, confidence, _fallback: 'reasoningBank-unavailable' });\n                const stored = await storeEntry({\n                    key: patternId,\n                    value,\n                    namespace: 'pattern',\n                    tags: [type, 'reasoning-pattern', 'fallback'],\n                });\n                // #3691: storeEntry reports failure as {success:false}, not a throw.\n                if (!stored || stored.success !== true) {\n                    return {\n                        success: false,\n                        error: `Pattern store failed: memory_store fallback did not persist (${stored?.error ?? 'no result'})`,\n                        recommendation: 'Run agentdb_health to inspect controller registration and check that .swarm/memory.db is writable.',\n                    };\n                }\n",
    "                const { storeEntry, getEntry } = await import('../memory/memory-initializer.js');\n                const patternId = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;\n                const value = JSON.stringify({ pattern, type, confidence, _fallback: 'reasoningBank-unavailable' });\n                const stored = await storeEntry({\n                    key: patternId,\n                    value,\n                    namespace: 'pattern',\n                    tags: [type, 'reasoning-pattern', 'fallback'],\n                });\n                // #3691: storeEntry reports failure as {success:false}, not a throw.\n                if (!stored || stored.success !== true) {\n                    return {\n                        success: false,\n                        error: `Pattern store failed: memory_store fallback did not persist (${stored?.error ?? 'no result'})`,\n                        recommendation: 'Run agentdb_health to inspect controller registration and check that .swarm/memory.db is writable.',\n                    };\n                }\n"],
  ["                }\n                return {\n                    success: true,\n                    // #3288: a caller must not have to already know to distrust a",
    `                const readback = await getEntry({ key: patternId, namespace: 'pattern' });
                if (readback?.success !== true || readback.found !== true || readback.entry?.key !== patternId
                    || readback.entry.namespace !== 'pattern' || readback.entry.content !== value) {
                    return {
                        success: false,
                        error: 'Pattern store failed: exact fallback readback was not verified',
                        controller: 'memory-store-fallback',
                    };
                }
                return {
                    success: true,
                    verified: true,
                    // #3288: a caller must not have to already know to distrust a`],
];
// Observed native 3.32.9/3.38.19/3.38.21 shapes, before #3288's wrapper.
export const LEGACY_EDITS = [
  ["            if (result)\n                return result;", `            if (result) {
                // ${PATCH_MARKER}: failed bridge results never claim persistence.
                if (result.success !== true) return { ...result, success: false, degraded: true,
                    reason: 'pattern-persistence-unconfirmed', note: 'Pattern persistence was not confirmed by the native bridge.' };
                if (result.controller === 'reasoningBank') return result;
                return { ...result, degraded: true, reason: 'reasoningBank-unavailable:' + result.controller };
            }`],
  ...EDITS.slice(1, 3),
  [EDITS[3][0] + "\n                    patternId,", EDITS[3][1] + `
                    degraded: true,
                    reason: 'reasoningBank-unavailable:registry-null',
                    patternId,`],
];
const variants = [EDITS, LEGACY_EDITS, CURRENT_EDITS];
const count = (s, n) => s.split(n).length - 1;
export const hasPatch = s => isBridgeSource(s) ? hasBridgePatch(s) : s.includes(PATCH_MARKER);
const matching = (s, index) => variants.filter(edits => edits.every(pair => count(s, pair[index]) === 1));
export const isPatched = s => isBridgeSource(s) ? isBridgePatched(s) : count(s, PATCH_MARKER) === 1 && matching(s, 1).length === 1;
export function patchSource(source) {
  if (isBridgeSource(source)) return patchBridgeSource(source);
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const matches = matching(source, 0);
  // Ruflo 3.54.x already carries the issue's refusal marker in the fallback
  // failure branch. That partial upstream/local composition is still safe to
  // extend with the missing exact readback; do not mistake its marker for an
  // ambiguous foreign edit.
  const current = matches.find(edits => edits === CURRENT_EDITS);
  if (current && !CURRENT_EDITS.every(([, replacement]) => source.includes(replacement))) {
    return { next: current.reduce((s, [a, b]) => s.replace(a, b), source), applied: [NAME], missing: [] };
  }
  if (hasPatch(source) || matches.length !== 1) return { next: source, applied: [], missing: ['native-pattern-receipt-anchors'] };
  return { next: matches[0].reduce((s, [a, b]) => s.replace(a, b), source), applied: [NAME], missing: [] };
}
export const reverseSource = s => isBridgeSource(s) ? reverseBridgeSource(s) : isPatched(s)
  ? matching(s, 1)[0].reduceRight((s, [a, b]) => s.replace(b, a), s) : s;
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
