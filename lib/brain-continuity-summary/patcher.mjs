// Brain #389: bound optional context, never the canonical evidence or goal/action.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
export const NAME = 'brain-continuity-summary';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#389)';
export const RELATIVE = 'scripts/project-progression-store.mjs';
export const ANCHOR = "  // Never clip or replace the user goal or next action. If those plus the identity/omission ledger";
export const INSERT = `  // ${PATCH_MARKER}: all values remain addressable through the unchanged head keys.
  if (size() > maxOutputBytes) recordOmission(summary.state, 'observations', 'state.observations');
  if (size() > maxOutputBytes) recordOmission(summary.state, 'identityRecovery', 'state.identityRecovery');
  if (size() > maxOutputBytes && Array.isArray(summary.state?.resumeConflicts)) {
    const groups = new Map();
    for (const conflict of summary.state.resumeConflicts) {
      const rows = groups.get(conflict.field) ?? [];
      rows.push(conflict);
      groups.set(conflict.field, rows);
    }
    const original = summary.state.resumeConflicts;
    summary.state.resumeConflicts = [...groups].map(([field, rows]) => ({
      field, omitted: true, conflictCount: rows.length,
      valueCount: rows.reduce((total, row) => total + row.valueCount, 0),
      summariesDigest: digestCanonical(rows),
    }));
    omissions.push({ path: 'state.resumeConflicts[]', ...omissionSummary(original) });
  }

`;
// Reviewed v4.5.7 native boundary; executable fixture/mutation tests back this fingerprint.
export function nativeSatisfied(source) {
  if (hasPatch(source) || source.split('function requirePositiveInteger(').length !== 2) return false;
  const begin = source.indexOf('function requirePositiveInteger('), end = source.indexOf('function validatePage(', begin);
  return begin >= 0 && end > begin && crypto.createHash('sha256').update(source.slice(begin, end)).digest('hex')
    === '1e965f6b39bcd844e657817ba6946ed90645723479a19bd512a573c7e14853f2';
}
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => nativeSatisfied(source) || count(source, PATCH_MARKER) === 1 && count(source, INSERT + ANCHOR) === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || source.includes('conflictsDigest:') || count(source, ANCHOR) !== 1) return { next: source, applied: [], missing: ['unique-native-summary-anchor'] };
  return { next: source.replace(ANCHOR, INSERT + ANCHOR), applied: [NAME], missing: [] };
}
export const reverseSource = source => source.replace(INSERT + ANCHOR, ANCHOR);
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: [RELATIVE] }).map(surface => path.join(surface.root, RELATIVE));
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
        || existingPathRelative(path.dirname(path.dirname(file)), file) === null) throw Error('unsafe native store module');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('native summary anchor not proved');
    } catch (error) { errors.push(file + ': ' + error.message); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
