// Brain #519/#521: preserve released composition; serialize capture-owned metadata.
import * as legacy from './legacy.mjs';
import { OWNERSHIP_MARKER } from './ownership.mjs';
import { OWNERSHIP_EDITS } from './transforms.mjs';
export { NAME, PATCH_MARKER, PREVIOUS_EDITS, discover } from './legacy.mjs';
export { OWNERSHIP_EDITS } from './transforms.mjs';
export const EDITS = legacy.EDITS;
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => legacy.hasPatch(source) || source.includes(OWNERSHIP_MARKER);
const undoOwnership = source => OWNERSHIP_EDITS.reduceRight((text, [, from, to]) => text.replace(to, () => from), source);
export function isPatched(source) {
  if (count(source, OWNERSHIP_MARKER) !== 1 || !OWNERSHIP_EDITS.every(([, , to]) => count(source, to) === 1)) return false;
  return legacy.isPatched(undoOwnership(source));
}
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (source.includes(OWNERSHIP_MARKER)) return { next: source, applied: [], missing: ['capture-ownership-composition'] };
  const previous = legacy.patchSource(source);
  if (previous.missing.length || !OWNERSHIP_EDITS.every(([, from]) => count(previous.next, from) === 1))
    return { next: source, applied: [], missing: [...previous.missing, 'capture-ownership-anchors'] };
  return { next: OWNERSHIP_EDITS.reduce((text, [, from, to]) => text.replace(from, () => to), previous.next),
    applied: [...previous.applied, ...OWNERSHIP_EDITS.map(([id]) => id)], missing: [] };
}
export const reverseSource = source => source.includes(OWNERSHIP_MARKER)
  ? (isPatched(source) ? legacy.reverseSource(undoOwnership(source)) : source)
  : legacy.reverseSource(source);
export const descriptor = { ...legacy.descriptor, patchSource, hasPatch, isPatched, reverse: reverseSource,
  historicalPatchSource: legacy.patchSource };
