// Brain #522: preserve native restore output and observable failure causes.
// No change to restore, deadlines, advisory exit codes, memory or the updater.
import fs from 'node:fs';
import path from 'node:path';
import { STABLE_LIB } from '../cwd/paths.mjs';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
export const NAME = 'brain-restore-diagnostics';
export const MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#522 restore-diagnostics)';
export const PREVIOUS_EDITS = [
  ["import fs from 'node:fs';", `import fs from 'node:fs';
// ${MARKER}: the existing private logger subscribes; no new worker or store.
import { channel as rspRestoreChannel } from 'node:diagnostics_channel';`],
  ["      || s.startsWith('[RuvNet Brain — PROJECT CONTINUITY UNKNOWN]')", `      || s.startsWith('[RuvNet Brain — PROJECT STATE · ')
      || s.startsWith('[RuvNet Brain — PROJECT CONTINUITY INCOMPLETE]')
      || s.startsWith('[RuvNet Brain — PROJECT CONTINUITY UNKNOWN]')`],
  ['  let restoreFailed = false;', '  let restoreFailed = false;\n  let restoreStatus, restoreRoute, restoreError;'],
  ['    if (continuity?.context) emit(continuity.context);', `    restoreStatus = continuity?.status;
    restoreRoute = continuity?.route;
    if (continuity?.context) emit(continuity.context);`],
  ["    emit('[RuvNet Brain — PROJECT CONTINUITY UNKNOWN]');\n    emit(/deadline/i.test(error?.message || '')", `    restoreError = error;
    restoreStatus = /deadline/i.test(error?.message || '') ? 'timed-out' : 'failed';
    emit('[RuvNet Brain — PROJECT CONTINUITY UNKNOWN] ' + (/deadline/i.test(error?.message || '')`],
  ["      : 'The SessionStart restore boundary failed unexpectedly. Do not claim project state was restored; verify the canonical store before relying on remembered state.');", "      : 'The SessionStart restore boundary failed unexpectedly. Do not claim project state was restored; verify the canonical store before relying on remembered state.'));"],
  ['  const restoreProof = { name: \'restore\', ms: Date.now() - restoreStart, failed: restoreFailed };', `  const restoreProof = { name: 'restore', ms: Date.now() - restoreStart, failed: restoreFailed,
    status: restoreStatus, route: restoreRoute, budgetMs: restoreDeadlineAt - restoreStart };
  try { rspRestoreChannel('ruflo-source-patch.brain-restore').publish({ ...restoreProof, error: restoreError }); }
  catch { /* observation cannot alter the native hook outcome */ }`],
];
export const LOGGER_PATH = path.join(STABLE_LIB, 'hook-failure-log', 'runtime.cjs');
const loggerMarker = '// rspRestoreLogger: the native shim does not inherit its parent preload.';
export const EDITS = [...PREVIOUS_EDITS, ['  const restoreStart = Date.now();',
  `  ${loggerMarker}
  try { (await import('node:module')).createRequire(import.meta.url)(${JSON.stringify(LOGGER_PATH)}); }
  catch { /* Optional diagnostics cannot change native restoration. */ }
  const restoreStart = Date.now();`]];
const count = (s, text) => s.split(text).length - 1;
export const hasPatch = s => s.includes(MARKER);
export const isPatched = s => hasPatch(s) && EDITS.every(([, to]) => count(s, to) === 1);
export function patchSource(source) {
  const original = source;
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) && !source.includes('rspRestoreLogger')
      && PREVIOUS_EDITS.every(([, to]) => count(source, to) === 1))
    source = PREVIOUS_EDITS.reduceRight((s, [from, to]) => s.replace(to, () => from), source);
  if (hasPatch(source) || EDITS.some(([from]) => count(source, from) !== 1))
    return { next: original, applied: [], missing: ['exact-native-restore-reporting-anchors'] };
  return { next: EDITS.reduce((s, [from, to]) => s.replace(from, () => to), source), applied: [NAME], missing: [] };
}
export const reverse = source => EDITS.reduceRight((s, [from, to]) => s.replace(to, () => from), source);
const relative = 'scripts/session-start-core.mjs';
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [MARKER], ownedRelatives: [relative] }).filter(s => s.kind === 'full')
  .map(s => path.join(s.root, relative));
export function preflight() {
  const errors = [];
  for (const file of discover()) try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || patchSource(fs.readFileSync(file, 'utf8')).missing.length)
      throw Error('unproved native restore reporting source');
  } catch (e) { errors.push(`${file}: ${e.message}`); }
  return { ok: !errors.length, errors };
}
// Retire on executable pristine proof of quiet restored/partial/failure output and bounded cause diagnostics.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse };
