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
// Serialized only at restore's existing session seam; no child/process lifecycle changes.
export function observeRestoreSession(session) {
  if (!session) return;
  let observed = 0;
  const emit = row => { try { rspRestoreOperationChannel('ruflo-source-patch.brain-restore-operation').publish(row); } catch {} };
  for (const operation of ['list', 'get']) {
    const native = session[operation];
    if (typeof native !== 'function') continue;
    session[operation] = function (...args) {
      if (observed++ >= 32) return Reflect.apply(native, this, args);
      const token = {}, started = Date.now();
      try {
        emit({ event: 'start', token, operation,
          namespaceHash: typeof args[0] === 'string' ? crypto.createHash('sha256').update(args[0]).digest('hex') : null,
          limit: operation === 'list' ? args[1] : null, deadlineAt: args[2] });
      } catch { /* Metadata observation cannot prevent a read. */ }
      const finish = (event, result, error) => {
        try { emit({ event, token, elapsedMs: Date.now() - started,
          state: result?.state, count: operation === 'list' && Array.isArray(result?.rows) ? result.rows.length : null,
          errorName: error?.name, errorCode: error?.code }); } catch {}
      };
      let result;
      try { result = Reflect.apply(native, this, args); }
      catch (error) { finish('error', undefined, error); throw error; }
      try {
        if (result instanceof Promise) Promise.prototype.then.call(result,
          value => { finish('end', value); }, error => { finish('error', undefined, error); });
        else finish('end', result);
      } catch { /* Return the exact native result even if observation is unavailable. */ }
      return result;
    };
  }
}
export const OPERATION_EDITS = [
  ["import crypto from 'node:crypto';", `import crypto from 'node:crypto';
// ${MARKER}: bounded metadata-only timings in the existing restore logger.
import { channel as rspRestoreOperationChannel } from 'node:diagnostics_channel';
${observeRestoreSession.toString()}`],
  ['  options.session = session;', `  options.session = session;
  try { observeRestoreSession(session); } catch { /* Preserve native restoration if diagnostics are unavailable. */ }`],
];
const count = (s, text) => s.split(text).length - 1;
const selectedEdits = source => source.includes('async function restoreFrom(store, options, deadlineAt) {')
  ? OPERATION_EDITS : source.includes('  const restoreStart = Date.now();') ? EDITS : null;
export const hasPatch = s => s.includes(MARKER);
export const isPatched = s => {
  const edits = selectedEdits(s);
  return hasPatch(s) && !!edits && edits.every(([, to]) => count(s, to) === 1);
};
export function patchSource(source) {
  const original = source, edits = selectedEdits(source);
  if (!edits) return { next: source, applied: [], missing: ['native-restore-surface'] };
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (edits === EDITS && hasPatch(source) && !source.includes('rspRestoreLogger')
      && PREVIOUS_EDITS.every(([, to]) => count(source, to) === 1))
    source = PREVIOUS_EDITS.reduceRight((s, [from, to]) => s.replace(to, () => from), source);
  if (hasPatch(source) || edits.some(([from]) => count(source, from) !== 1))
    return { next: original, applied: [], missing: ['exact-native-restore-reporting-anchors'] };
  return { next: edits.reduce((s, [from, to]) => s.replace(from, () => to), source), applied: [NAME], missing: [] };
}
export function reverse(source) {
  const edits = selectedEdits(source);
  for (const version of edits === EDITS ? [EDITS, PREVIOUS_EDITS] : [edits]) {
    if (!version || !version.every(([, to]) => count(source, to) === 1)) continue;
    const clean = version.reduceRight((s, [from, to]) => s.replace(to, () => from), source);
    if (!hasPatch(clean)) return clean;
  }
  return source;
}
const relatives = ['scripts/session-start-core.mjs', 'scripts/ruflo-memory-hooks.mjs'];
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [MARKER], ownedRelatives: relatives }).filter(s => s.kind === 'full')
  .flatMap(s => relatives.map(relative => path.join(s.root, relative)));
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
