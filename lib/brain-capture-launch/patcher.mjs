// Brain #519/#521: preserve released composition; serialize capture-owned metadata.
import * as legacy from './legacy.mjs';
import { OWNERSHIP_MARKER } from './ownership.mjs';
import { OWNERSHIP_EDITS } from './transforms.mjs';
export { NAME, PATCH_MARKER, PREVIOUS_EDITS, discover } from './legacy.mjs';
export { OWNERSHIP_EDITS } from './transforms.mjs';
export const EDITS = legacy.EDITS;
const claimOutsideRetry = `        captureGateClaims(directory);
        try { if (captureOwnerDead(observed.owner) && captureReclaimGate(directory, observed, owner, path.join(staged, 'owner.json'))) continue; }`;
const claimInsideRetry = `        try {
          captureGateClaims(directory);
          if (captureOwnerDead(observed.owner) && captureReclaimGate(directory, observed, owner, path.join(staged, 'owner.json'))) continue;
        }`;
const previousOwnershipEdits = OWNERSHIP_EDITS.map(([id, from, to]) => [id, from,
  id === 'ownership-helpers' ? to.replace(claimInsideRetry, claimOutsideRetry) : to]);
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => legacy.hasPatch(source) || source.includes(OWNERSHIP_MARKER);
const undoOwnership = (source, edits = OWNERSHIP_EDITS) => edits.reduceRight((text, [, from, to]) => text.replace(to, () => from), source);
function matchesOwnership(source, edits) {
  if (count(source, OWNERSHIP_MARKER) !== 1 || !edits.every(([, , to]) => count(source, to) === 1)) return false;
  return legacy.isPatched(undoOwnership(source, edits));
}
export const isPatched = source => matchesOwnership(source, OWNERSHIP_EDITS);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (matchesOwnership(source, previousOwnershipEdits)) return patchSource(undoOwnership(source, previousOwnershipEdits));
  if (source.includes(OWNERSHIP_MARKER)) return { next: source, applied: [], missing: ['capture-ownership-composition'] };
  const previous = legacy.patchSource(source);
  if (previous.missing.length || !OWNERSHIP_EDITS.every(([, from]) => count(previous.next, from) === 1))
    return { next: source, applied: [], missing: [...previous.missing, 'capture-ownership-anchors'] };
  return { next: OWNERSHIP_EDITS.reduce((text, [, from, to]) => text.replace(from, () => to), previous.next),
    applied: [...previous.applied, ...OWNERSHIP_EDITS.map(([id]) => id)], missing: [] };
}
export const reverseSource = source => source.includes(OWNERSHIP_MARKER)
  ? (isPatched(source) ? legacy.reverseSource(undoOwnership(source))
    : matchesOwnership(source, previousOwnershipEdits) ? legacy.reverseSource(undoOwnership(source, previousOwnershipEdits)) : source)
  : legacy.reverseSource(source);
export function historicalPatchSource(source, current = '') {
  const previous = legacy.patchSource(source);
  if (!current.includes(OWNERSHIP_MARKER)) return previous;
  if (previous.missing.length || !previousOwnershipEdits.every(([, from]) => count(previous.next, from) === 1))
    return { next: source, applied: [], missing: ['capture-historical-ownership-anchors'] };
  return { next: previousOwnershipEdits.reduce((text, [, from, to]) => text.replace(from, () => to), previous.next),
    applied: [...previous.applied, 'capture-historical-ownership'], missing: [] };
}
export const descriptor = { ...legacy.descriptor, patchSource, hasPatch, isPatched, reverse: reverseSource,
  historicalPatchSource };
