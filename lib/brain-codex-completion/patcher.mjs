// Operator-disabled completion-claim feature (#425). Other Stop gates are unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
export const NAME = 'brain-codex-completion';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#425 completion-disabled)';
export const ANCHOR = 'const completion = (() => {';
export const REPLACEMENT = `${ANCHOR}\n  // ${PATCH_MARKER}\n  return { verdict: 'NONE', claims: [] }; // Disabled, never verified or completed.`;
const count = (s, n) => s.split(n).length - 1;
const evidence = s => s.includes('export function auditCompletionClaims(') && s.includes('export function readClaudeTurn(');
export const hasPatch = s => s.includes(PATCH_MARKER);
export const isPatched = s => !s.includes('ruflo-source-patch (stuinfla/ruvnet-brain#423)')
  && (evidence(s) || count(s, REPLACEMENT) === 1 && !s.replace(REPLACEMENT, '').includes(ANCHOR));
export function patchSource(source) {
  if (source.includes('ruflo-source-patch (stuinfla/ruvnet-brain#423)'))
    return { next: source, applied: [], missing: ['obsolete completion overlay: restore pristine installed source first'] };
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (source.includes(PATCH_MARKER) || count(source, ANCHOR) !== 1)
    return { next: source, applied: [], missing: ['unique native completion audit boundary'] };
  return { next: source.replace(ANCHOR, REPLACEMENT), applied: [NAME], missing: [] };
}
export const reverseSource = source => source.replace(REPLACEMENT, ANCHOR);
const relatives = ['scripts/completion-claim-evidence.mjs', 'scripts/continuation-gate.mjs'];
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: relatives })
  .filter(s => s.kind === 'full').flatMap(s => relatives.map(relative => path.join(s.root, relative)));
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
        || existingPathRelative(path.dirname(path.dirname(file)), file) === null) throw Error('unsafe native script');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unproved completion source');
    } catch (error) { errors.push(file + ': ' + error.message); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
