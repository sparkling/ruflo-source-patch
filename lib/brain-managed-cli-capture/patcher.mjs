// Brain #382: compare the current native action before deciding a boundary is
// unchanged. The native writer still owns enrichment, persistence and receipts.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
import { reviewedBoundary } from '../brain-native/reviewed-source.mjs';
export const NAME = 'brain-managed-cli-capture';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#382)';
export const SPECS = [
  { relative: 'scripts/project-progression-hook.mjs', edits: [
    ['shared-native-action-projection', '\nfunction enrichStateWithObservation(state, payload) {',
      `\n// ${PATCH_MARKER}: one shared projection for writer and retention comparison.\nexport function enrichStateWithObservation(state, payload) {`],
  ] },
  { relative: 'scripts/project-progression-producer.mjs', edits: [
    ['reuse-native-action-owner', "import { withProgressionReader } from './project-progression-reader.mjs';",
      `import { withProgressionReader } from './project-progression-reader.mjs';\n// ${PATCH_MARKER}: action affects meaning before the no-op decision.\nimport { enrichStateWithObservation } from './project-progression-hook.mjs';`],
    ['redacted-action-before-retention', '    state: { ...projectProgression.completeProjectState, activeStep: null, evidence: null },',
      '    state: { ...redactProgression(enrichStateWithObservation(projectProgression.completeProjectState, payload)).value, activeStep: null, evidence: null },'],
  ] },
];
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = (source) => source.includes(PATCH_MARKER);
function selectedSpec(source, patched) {
  return SPECS.filter(spec => spec.edits.every(([, original, next]) => count(source, patched ? next : original) === 1
    && (!patched || !source.includes(original) || next.includes(original))));
}
export const nativeSatisfied = source => !hasPatch(source) && (
  reviewedBoundary(source, 'function toolAction(', 'function verifyReceipt(',
    ['9bc2f46a5b563e4e2718fd3632c586f026f7d3371c49b50207aae50ff24b7e17',
      '0bf63a2a1cb0eafacdd01f1d0894dbd48a1282f9ad49c26c073d252e793ae045'])
  || reviewedBoundary(source, 'export function buildProjectProgression(', null,
    ['e21e99eb42e5f3b3fb59d173d83ed59c56bb2e0e9239b8eb0af6e33e0c11f844',
      '7d2babd4c1c8f034f9043f3fb98ae2d49d24497d5cebc9b0f2f7f987725bd2b4']));
export const isPatched = (source) => nativeSatisfied(source) || (hasPatch(source) && selectedSpec(source, true).length === 1
  && count(source, PATCH_MARKER) === 1);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const matches = selectedSpec(source, false);
  if (hasPatch(source) || matches.length !== 1) {
    return { next: source, applied: [], missing: ['unique-native-action-projection-bundle'] };
  }
  const spec = matches[0];
  return { next: spec.edits.reduce((body, [, from, to]) => body.replace(from, to), source),
    applied: spec.edits.map(([id]) => id), missing: [] };
}
export const reverseSource = (source) => SPECS.flatMap(spec => spec.edits).reduceRight((body, [, from, to]) => body.replace(to, from), source);
export function surfaces() { return discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: SPECS.map(spec => spec.relative) }); }
export const discover = () => surfaces().flatMap(surface => SPECS.map(spec => path.join(surface.root, spec.relative)));
export function preflight() {
  const errors = [];
  for (const surface of surfaces()) for (const spec of SPECS) {
    const file = path.join(surface.root, spec.relative);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(surface.root, file) === null) {
        throw new Error('absent, empty or unsafe native progression member');
      }
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw new Error('native action projection anchors do not match');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource, preflight };
