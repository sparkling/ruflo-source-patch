// Brain #385: reuse a locally verified restore, never a caller-supplied verdict.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
export const NAME = 'brain-transition-validation';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#385)';
export const BUILDER = 'export function buildTransitionProgression({ resolution, observation, snapshots = [], sessionIdentity, host, sourceIdentity: originalSourceIdentity }) {';
export const RESTORE = '  const restored = restoreProjectProgression(snapshots, { expectedProjectIdentity: resolution.projectIdentity });';
export const EDITS = [
  [BUILDER + '\n' + RESTORE, `${BUILDER}
${RESTORE}
  return buildVerifiedTransition({ resolution, observation, snapshots, sessionIdentity, host,
    sourceIdentity: originalSourceIdentity }, restored);
}

// ${PATCH_MARKER}: only this module can pass its freshly verified result.
function buildVerifiedTransition({ resolution, observation, snapshots = [], sessionIdentity, host, sourceIdentity: originalSourceIdentity }, restored) {`],
  ["  if (snapshots.length && !restoreProjectProgression(snapshots, { expectedProjectIdentity: resolution.projectIdentity }).ok) {",
    RESTORE + "\n  if (snapshots.length && !restored.ok) {"],
  ["  const progression = buildTransitionProgression({ resolution, observation: normalized.observation,\n    snapshots, sessionIdentity: job.payload.session_id, host: job.host,\n    sourceIdentity: normalized.sourceIdentity });",
    "  const progression = buildVerifiedTransition({ resolution, observation: normalized.observation,\n    snapshots, sessionIdentity: job.payload.session_id, host: job.host,\n    sourceIdentity: normalized.sourceIdentity }, restored);"],
];
const count = (s, text) => s.split(text).length - 1;
export const hasPatch = s => s.includes(PATCH_MARKER);
export const isPatched = s => count(s, PATCH_MARKER) === 1 && EDITS.every(([, next]) => count(s, next) === 1);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || EDITS.some(([anchor]) => count(source, anchor) !== 1)) {
    return { next: source, applied: [], missing: ['unique-native-transition-validation-anchors'] };
  }
  return { next: EDITS.reduce((s, [a, b]) => s.replace(a, b), source), applied: [NAME], missing: [] };
}
export const reverseSource = s => EDITS.reduceRight((s, [a, b]) => s.replace(b, a), s);
export const discover = () => discoverBrain({ includeOwned: false, allowMissingActive: true })
  .filter(surface => surface.kind === 'full').map(surface => path.join(surface.root, 'scripts/project-transition-hook.mjs'));
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
          || existingPathRelative(path.dirname(path.dirname(file)), file) === null) throw new Error('unsafe transition module');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw new Error('unproved native transition anchors');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
