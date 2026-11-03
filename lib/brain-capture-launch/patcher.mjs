// Brain #519/#521: preserve released composition; serialize capture-owned metadata.
import * as legacy from './legacy.mjs';
import { OWNERSHIP_MARKER } from './ownership.mjs';
import { OWNERSHIP_EDITS } from './transforms.mjs';
import { addTiming, hasTiming, isTimed, undoTiming } from './diagnostics.mjs';
import { addWait, hasWait, isWaiting, undoWait } from './backpressure.mjs';
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
export const hasPatch = source => legacy.hasPatch(source) || source.includes(OWNERSHIP_MARKER) || hasTiming(source) || hasWait(source);
const undoOwnership = (source, edits = OWNERSHIP_EDITS) => edits.reduceRight((text, [, from, to]) => text.replace(to, () => from), source);
function matchesOwnership(source, edits) {
  if (count(source, OWNERSHIP_MARKER) !== 1 || !edits.every(([, , to]) => count(source, to) === 1)) return false;
  return legacy.isPatched(undoOwnership(source, edits));
}
const isTimedOwnership = source => isTimed(source) && matchesOwnership(undoTiming(source), OWNERSHIP_EDITS);
export const isPatched = source => isWaiting(source) && isTimedOwnership(undoWait(source));
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasWait(source)) return { next: source, applied: [], missing: ['capture-backpressure-composition'] };
  if (isTimedOwnership(source)) {
    const next = addWait(source);
    return next === null ? { next: source, applied: [], missing: ['capture-backpressure-anchors'] }
      : { next, applied: ['capture-backpressure'], missing: [] };
  }
  if (hasTiming(source)) return { next: source, applied: [], missing: ['capture-timing-composition'] };
  if (matchesOwnership(source, OWNERSHIP_EDITS)) {
    const next = addTiming(source);
    return next === null ? { next: source, applied: [], missing: ['capture-timing-anchors'] }
      : patchSource(next);
  }
  if (matchesOwnership(source, previousOwnershipEdits)) return patchSource(undoOwnership(source, previousOwnershipEdits));
  if (source.includes(OWNERSHIP_MARKER)) return { next: source, applied: [], missing: ['capture-ownership-composition'] };
  const previous = legacy.patchSource(source);
  if (previous.missing.length || !OWNERSHIP_EDITS.every(([, from]) => count(previous.next, from) === 1))
    return { next: source, applied: [], missing: [...previous.missing, 'capture-ownership-anchors'] };
  const owned = OWNERSHIP_EDITS.reduce((text, [, from, to]) => text.replace(from, () => to), previous.next);
  const next = addTiming(owned);
  if (next === null) return { next: source, applied: [], missing: ['capture-timing-anchors'] };
  const waiting = patchSource(next);
  return waiting.missing.length ? { ...waiting, next: source } : { ...waiting,
    applied: [...previous.applied, ...OWNERSHIP_EDITS.map(([id]) => id), 'capture-timing', ...waiting.applied] };
}
export function reverseSource(source) {
  if (hasWait(source) && !isPatched(source)) return source;
  const original = source;
  source = undoWait(source);
  if (hasTiming(source) && !isTimedOwnership(source)) return original;
  source = undoTiming(source);
  return source.includes(OWNERSHIP_MARKER)
    ? (matchesOwnership(source, OWNERSHIP_EDITS) ? legacy.reverseSource(undoOwnership(source))
      : matchesOwnership(source, previousOwnershipEdits) ? legacy.reverseSource(undoOwnership(source, previousOwnershipEdits)) : original)
    : legacy.reverseSource(source);
}
export function historicalPatchSource(source, current = '') {
  const previous = legacy.patchSource(source);
  if (!current.includes(OWNERSHIP_MARKER)) return previous;
  const edits = !hasWait(current) && current.includes(claimInsideRetry) ? OWNERSHIP_EDITS : previousOwnershipEdits;
  if (previous.missing.length || !edits.every(([, from]) => count(previous.next, from) === 1))
    return { next: source, applied: [], missing: ['capture-historical-ownership-anchors'] };
  const owned = edits.reduce((text, [, from, to]) => text.replace(from, () => to), previous.next);
  const timed = hasTiming(current) && !hasWait(current) ? addTiming(owned) : owned;
  if (timed === null) return { next: source, applied: [], missing: ['capture-historical-timing-anchors'] };
  return { next: timed,
    applied: [...previous.applied, 'capture-historical-ownership'], missing: [] };
}
export const descriptor = { ...legacy.descriptor, patchSource, hasPatch, isPatched, reverse: reverseSource,
  historicalPatchSource };
