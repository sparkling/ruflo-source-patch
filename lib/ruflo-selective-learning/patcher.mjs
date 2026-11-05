import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { BRIDGE_RUNTIME } from './runtime.mjs';
export const NAME = 'ruflo-selective-learning';
export const MARKER = 'ruflo-source-patch (#2245 selected-learning)';
const BRIDGE_ANCHOR = '// ===== Phase 3: ReasoningBank pattern operations =====';
const HOOK_ANCHOR = `    handler: async (params) => {
        const consolidate = params.consolidate !== false;
        const startTime = Date.now();`;
const HOOK_PATCH = `    handler: async (params) => {
        // ${MARKER}: selected calls must never enter the global buffered cycle.
        if (params.trajectoryIds !== undefined) {
            try {
                const bridge = await import('../memory/memory-bridge.js');
                return await bridge.bridgeLearnSelectedTrajectories(params);
            } catch (error) {
                return { success: false, learned: false, error: error.message, backgroundLearningRun: false };
            }
        }
        const consolidate = params.consolidate !== false;
        const startTime = Date.now();`;
const DESCRIPTION_OLD = "description: 'Force immediate SONA learning cycle with EWC++ consolidation Use when";
const DESCRIPTION_NEW = "description: 'With trajectoryIds: retain only selected complete evaluated trajectories as native ReasoningBank patterns, preserving exact bodies/outcomes and unchanged idempotence. This selected path does not run global buffered learning or EWC; consolidate is reported requested but not run. Omit trajectoryIds only to request the historical global SONA cycle. Use when";
const SCHEMA_OLD = "trajectoryIds: { type: 'array', items: { type: 'string' }, description: 'Specific trajectories to learn from' },";
const SCHEMA_NEW = "trajectoryIds: { type: 'array', minItems: 1, maxItems: 32, uniqueItems: true, items: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' }, description: 'Explicit completed canonical trajectory IDs; invalid/missing/changed sources refuse, never global fallback' },";
export const EDITS = [[BRIDGE_ANCHOR, BRIDGE_RUNTIME + '\n' + BRIDGE_ANCHOR], [HOOK_ANCHOR, HOOK_PATCH]];
const count = (s, needle) => s.split(needle).length - 1;
const match = (s, index) => EDITS.filter(pair => count(s, pair[index]) === 1);
const hasLegacy = source => source.includes(MARKER);
const legacyPatched = source => hasLegacy(source) && match(source, 1).length === 1
  && (!source.includes(HOOK_PATCH) || (source.includes(DESCRIPTION_NEW) && source.includes(SCHEMA_NEW)));
export function legacyPatchSource(source) {
  if (legacyPatched(source)) return { next: source, applied: [], missing: [] };
  const matched = match(source, 0);
  if (hasLegacy(source) || matched.length !== 1)
    return { next: source, applied: [], missing: ['unique-selected-learning-boundary'] };
  let next = source.replace(matched[0][0], () => matched[0][1]);
  if (matched[0][0] === HOOK_ANCHOR) {
    if (count(source, DESCRIPTION_OLD) !== 1 || count(source, SCHEMA_OLD) !== 1)
      return { next: source, applied: [], missing: ['selected-learning-tool-metadata'] };
    next = next.replace(DESCRIPTION_OLD, () => DESCRIPTION_NEW).replace(SCHEMA_OLD, () => SCHEMA_NEW);
  }
  return { next, applied: [NAME], missing: [] };
}
const reverseLegacy = source => EDITS.reduceRight((s, [from, to]) => s.replace(to, () => from), source)
  .replace(DESCRIPTION_NEW, () => DESCRIPTION_OLD).replace(SCHEMA_NEW, () => SCHEMA_OLD);
// The former retention algorithm is recognized only to remove released bytes.
// The surviving repair is the ignored native selection boundary, never learning.
const GUARD_MARKER = 'ruflo-source-patch (#4693): unsupported native trajectory selection';
export const HOOK_GUARD = `    handler: async (params) => {
        // ${GUARD_MARKER}: never expand a selected request into global learning.
        if (Object.prototype.hasOwnProperty.call(params, 'trajectoryIds')) {
            return { success: false, learned: false, status: 'unsupported',
                reason: 'trajectory-selection-unsupported',
                error: 'Native hooks_intelligence_learn does not support trajectoryIds; no learning ran',
                cycleTriggered: false, backgroundLearningRun: false, mutationAttempted: false };
        }
        const consolidate = params.consolidate !== false;
        const startTime = Date.now();`;
const GUARDED_DESCRIPTION = "description: 'Request the native global SONA learning cycle. trajectoryIds is unsupported and refuses before any learning; omit it only when a global cycle is intended. Use when";
const GUARDED_SCHEMA = "trajectoryIds: { type: 'array', items: { type: 'string' }, description: 'Unsupported by this native implementation; supplying this field refuses without learning' },";
const guardEdits = [[HOOK_ANCHOR, HOOK_GUARD], [DESCRIPTION_OLD, GUARDED_DESCRIPTION], [SCHEMA_OLD, GUARDED_SCHEMA]];
const reverseGuard = source => guardEdits.reduceRight((s, [from, to]) => s.replace(to, () => from), source);
export const reverse = source => reverseLegacy(reverseGuard(source));
const toolHash = source => {
  const anchor = 'export const hooksIntelligenceLearn = ';
  if (count(source, anchor) !== 1) return null;
  const start = source.indexOf(anchor), end = source.indexOf('\n};', start);
  return end < 0 ? null : createHash('sha256').update(source.slice(start, end + 3)).digest('hex');
};
const NATIVE_LEARN_SHA256 = '4a8cca2602f4a534b00f853205714604b174993bc81bda7c270a19980c04bdca';
const nativeBridge = source => count(source, BRIDGE_ANCHOR) === 1
  && !hasLegacy(source) && !source.includes('bridgeLearnSelectedTrajectories');
export const hasPatch = source => hasLegacy(source) || source.includes(GUARD_MARKER);
export const isPatched = source => nativeBridge(source)
  || (guardEdits.every(([, to]) => count(source, to) === 1)
    && toolHash(reverseGuard(source)) === NATIVE_LEARN_SHA256);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const native = reverseLegacy(source);
  if (hasLegacy(source) && (native === source || legacyPatchSource(native).next !== source))
    return { next: source, applied: [], missing: ['unproved-selected-retention-removal'] };
  if (nativeBridge(native)) return { next: native, applied: native === source ? [] : ['withdraw-selected-retention'], missing: [] };
  if (toolHash(native) !== NATIVE_LEARN_SHA256 || guardEdits.some(([from]) => count(native, from) !== 1))
    return { next: source, applied: [], missing: ['unknown-native-learning-contract'] };
  return { next: guardEdits.reduce((s, [from, to]) => s.replace(from, () => to), native),
    applied: ['refuse-unsupported-native-selection'], missing: [] };
}
export const discover = () => [...new Set(['memory/memory-bridge.js', 'mcp-tools/hooks-tools.js']
  .flatMap(file => discoverCli(['@claude-flow', 'cli', 'dist', 'src', ...file.split('/')])) )];
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
    for (const file of files) try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe selected-learning member');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('selected-learning anchors changed');
    } catch (error) { failures.push(file + ': ' + error.message); }
    if (failures.length) { errors.push(...failures); blockedFiles.push(...files); }
  }
  return { ok: !errors.length, errors, ...(errors.length && { blockedFiles }) };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse, historicalPatchSource: legacyPatchSource };
