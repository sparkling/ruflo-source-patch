import fs from 'node:fs';
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
export const hasPatch = source => source.includes(MARKER);
export const isPatched = source => hasPatch(source) && match(source, 1).length === 1
  && (!source.includes(HOOK_PATCH) || (source.includes(DESCRIPTION_NEW) && source.includes(SCHEMA_NEW)));
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const matched = match(source, 0);
  if (hasPatch(source) || matched.length !== 1)
    return { next: source, applied: [], missing: ['unique-selected-learning-boundary'] };
  let next = source.replace(matched[0][0], () => matched[0][1]);
  if (matched[0][0] === HOOK_ANCHOR) {
    if (count(source, DESCRIPTION_OLD) !== 1 || count(source, SCHEMA_OLD) !== 1)
      return { next: source, applied: [], missing: ['selected-learning-tool-metadata'] };
    next = next.replace(DESCRIPTION_OLD, () => DESCRIPTION_NEW).replace(SCHEMA_OLD, () => SCHEMA_NEW);
  }
  return { next, applied: [NAME], missing: [] };
}
export const reverse = source => EDITS.reduceRight((s, [from, to]) => s.replace(to, () => from), source)
  .replace(DESCRIPTION_NEW, () => DESCRIPTION_OLD).replace(SCHEMA_NEW, () => SCHEMA_OLD);
export const discover = () => [...new Set(['memory/memory-bridge.js', 'mcp-tools/hooks-tools.js']
  .flatMap(file => discoverCli(['@claude-flow', 'cli', 'dist', 'src', ...file.split('/')])) )];
export function preflight() {
  const errors = [];
  for (const file of discover()) try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe selected-learning member');
    if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('selected-learning anchors changed');
  } catch (error) { errors.push(file + ': ' + error.message); }
  return { ok: !errors.length, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse };
