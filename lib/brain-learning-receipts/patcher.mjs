// Residual Brain #377 capture/readback boundary: scheduling is not persistence.
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';

export const NAME = 'brain-learning-receipts';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#377 verified-learning-marker)';
export const EDITS = [
  ['parent-marker',
    '      markCaptured(brainHome, key);\n      return detachLearning(',
    `      // ${PATCH_MARKER}: the child marks only after exact readback.\n      return detachLearning(`],
  ['verified-child-marker',
    "    recordLearningObservation(binary, context, { tool: o.tool, action: o.action, session: String(o.session || '') }, { env: process.env, deadline: Date.now() + 14_000, allowed: () => learningContext().enabled });",
    "    recordLearningObservation(binary, context, { tool: o.tool, action: o.action, session: String(o.session || '') }, { env: process.env, deadline: Date.now() + 14_000, allowed: () => learningContext().enabled });\n    markCaptured(defaultBrainHome(process.env), observationKey(o));"],
];
const count = (s, text) => s.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => count(source, PATCH_MARKER) === 1
  && EDITS.every(([, , to]) => count(source, to) === 1)
  && !source.includes(EDITS[0][1]);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || !EDITS.every(([, from]) => count(source, from) === 1))
    return { next: source, applied: [], missing: ['unique-learning-receipt-boundary'] };
  return { next: EDITS.reduce((s, [, from, to]) => s.replace(from, () => to), source),
    applied: EDITS.map(([id]) => id), missing: [] };
}
export const reverseSource = source => EDITS.reduceRight((s, [, from, to]) => s.replace(to, () => from), source);
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: ['scripts/learn-capture.mjs'],
}).filter(surface => surface.kind === 'full').map(surface => path.join(surface.root, 'scripts/learn-capture.mjs'));
// Unknown upstream revisions fail visibly. Retirement requires the same failed-write,
// exact-readback and deferred-child probes against marker-free upstream code.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource };
