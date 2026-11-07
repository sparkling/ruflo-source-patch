// Brain #519/#521: preserve released composition; serialize capture-owned metadata.
import * as legacy from './legacy.mjs';
import { OWNERSHIP_MARKER } from './ownership.mjs';
import { OWNERSHIP_EDITS } from './transforms.mjs';
import { addTiming, hasTiming, isTimed, undoTiming } from './diagnostics.mjs';
import { addWait, hasWait, isWaiting, undoWait } from './backpressure.mjs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { READ_MARKER, READ_EDITS, PREVIOUS_TO, isLearningSource, hasRead, isReading, patchRead, undoRead } from './learning-read-first.mjs';
export { NAME, PATCH_MARKER, PREVIOUS_EDITS } from './legacy.mjs';
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
export const hasPatch = source => legacy.hasPatch(source) || source.includes(OWNERSHIP_MARKER) || hasTiming(source) || hasWait(source) || hasRead(source);
const undoOwnership = (source, edits = OWNERSHIP_EDITS) => edits.reduceRight((text, [, from, to]) => text.replace(to, () => from), source);
function matchesOwnership(source, edits) {
  if (count(source, OWNERSHIP_MARKER) !== 1 || !edits.every(([, , to]) => count(source, to) === 1)) return false;
  return legacy.isPatched(undoOwnership(source, edits));
}
const isTimedOwnership = source => isTimed(source) && matchesOwnership(undoTiming(source), OWNERSHIP_EDITS);
export const isPatched = source => isLearningSource(source) ? isReading(source) : isWaiting(source) && isTimedOwnership(undoWait(source));
export function patchSource(source) {
  if (isLearningSource(source) || hasRead(source)) return patchRead(source);
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
  if (isLearningSource(source) || hasRead(source)) return undoRead(source);
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
  if (isLearningSource(source)) {
    const from = READ_EDITS[0][1];
    if (count(current, PREVIOUS_TO) === 1 && count(source, from) === 1)
      return { next: source.replace(from, () => PREVIOUS_TO), applied: ['historical-read-first'], missing: [] };
    return { next: source, applied: [], missing: [] };
  }
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
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [legacy.PATCH_MARKER, READ_MARKER], ownedRelatives: ['scripts/learn-capture.mjs', 'scripts/learning-store.mjs'],
}).filter(surface => surface.kind === 'full').flatMap(surface => ['scripts/learn-capture.mjs', 'scripts/learning-store.mjs'].map(file => path.join(surface.root, file)));
export const descriptor = { ...legacy.descriptor, patchSource, hasPatch, isPatched, reverse: reverseSource,
  discover, historicalPatchSource };
