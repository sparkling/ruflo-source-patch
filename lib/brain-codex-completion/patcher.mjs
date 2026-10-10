// Operator-disabled completion-claim feature (#425). Other Stop gates are unchanged.
import fs from 'node:fs';
import path from 'node:path';
import * as previous from './migration-v44644.mjs';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
export const NAME = 'brain-codex-completion';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#425 completion-disabled)';
export const ANCHOR = 'const completion = (() => {';
export const REPLACEMENT = `${ANCHOR}\n  // ${PATCH_MARKER}\n  return { verdict: 'NONE', claims: [] }; // Disabled, never verified or completed.`;
const count = (s, n) => s.split(n).length - 1;
const evidence = s => s.includes('export function auditCompletionClaims(') && s.includes('export function readClaudeTurn(');
export const hasPatch = s => s.includes(PATCH_MARKER) || previous.hasPatch(s);
function oldPristine(source) {
  if (!previous.hasPatch(source)) return source;
  const withoutStaged = source.replace(previous.DELIVERY_EDIT[1], previous.DELIVERY_EDIT[0]);
  const candidate = previous.reverseSource(withoutStaged);
  const old = previous.patchSource(candidate).next;
  const variants = [old, previous.historicalPatchSource(candidate).next,
    old.replace(...previous.DELIVERY_EDIT)];
  return variants.includes(source) ? candidate : null;
}
export const isPatched = s => !previous.hasPatch(s) && (evidence(s)
  || count(s, REPLACEMENT) === 1 && !s.replace(REPLACEMENT, '').includes(ANCHOR));
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const pristine = oldPristine(source);
  if (pristine === null || source.includes(PATCH_MARKER))
    return { next: source, applied: [], missing: ['unproved completion patch composition'] };
  if (evidence(pristine)) return { next: pristine, applied: [NAME], missing: [] };
  if (count(pristine, ANCHOR) !== 1)
    return { next: source, applied: [], missing: ['unique native completion audit boundary'] };
  return { next: pristine.replace(ANCHOR, REPLACEMENT), applied: [NAME], missing: [] };
}
export const reverseSource = source => oldPristine(source.replace(REPLACEMENT, ANCHOR)) ?? source;
export function historicalPatchSource(source, current) {
  const old = previous.patchSource(source);
  const variants = [old, previous.historicalPatchSource(source),
    { ...old, next: old.next.replace(...previous.DELIVERY_EDIT) }];
  return variants.find(result => result.next === current) || variants[0];
}
export function recover(current) {
  const candidate = oldPristine(current);
  if (candidate !== null && candidate !== current)
    return { candidate, verify: source => historicalPatchSource(source, current).next };
  return { candidate: reverseSource(current), verify: source => patchSource(source).next };
}
const relatives = ['scripts/completion-claim-evidence.mjs', 'scripts/continuation-gate.mjs'];
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER, previous.PATCH_MARKER], ownedRelatives: relatives })
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
  discover, preflight, patchSource, historicalPatchSource, hasPatch, isPatched, reverse: reverseSource, recover };
