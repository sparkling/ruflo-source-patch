// Brain #518: preserve scoped failure attribution and redacted terminal stderr.
// No driver, slot, timeout, queue or replay changes. Retirement requires marker-free native
// proof of distinct-store dedup/repeat identity, redacted stderr with timeout/cancel precedence,
// and unavailable readback distinguished from a readable content conflict;
// a version bump or marker alone is not evidence of a complete upstream replacement.
import path from 'node:path';
import fs from 'node:fs';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { nativeLearningRoute, prepareNativeLearningRoute } from './native-route.mjs';
import { CHECKPOINT_EDITS } from './checkpoint.mjs';

export const NAME = 'brain-capture-diagnostics';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#518 capture-diagnostics)';
const edit = (id, from, to) => ({ id, from, to });
const loggerImport = "import { recordHookFailure } from './hook-failures.mjs';";
const scopedImport = `// ${PATCH_MARKER}: correlation is hashed; native capture behaviour is unchanged.
import { recordHookFailure, failureScope, validFailureScope } from './hook-failures.mjs';`;
const scopes = `// ${PATCH_MARKER}: only explicit caller identities cross the shared diagnostic boundary.
const SCOPE_FIELDS = ['project', 'store', 'session', 'expectedKey'];
export const validFailureScope = (fields = {}) => Object.fromEntries(SCOPE_FIELDS
  .filter(key => typeof fields?.[key] === 'string' && /^[0-9a-f]{16}$/.test(fields[key]))
  .map(key => [key, fields[key]]));
export const failureScope = (fields = {}) => Object.fromEntries(SCOPE_FIELDS
  .filter(key => typeof fields?.[key] === 'string' && fields[key].length > 0 && fields[key].length <= 8192)
  .map(key => [key, createHash('sha256').update(fields[key]).digest('hex').slice(0, 16)]));
`;

export const SPECS = [
  { relative: 'scripts/hook-failures.mjs', identity: "export const FAILURE_FILE = 'hook-failures.jsonl';", edits: [
    edit('scope-helper', 'const MAX_WINDOWS = 64;', `const MAX_WINDOWS = 64;\n\n${scopes}`),
    edit('repeat-scope', "event: w.event, error: `${w.error} (repeated)`", "event: w.event, ...validFailureScope(w), error: `${w.error} (repeated)`"),
    edit('scope-signature',
      "    const sig = createHash('sha256').update(`${fields.hook}\\0${fields.event || ''}\\0${error}`).digest('hex').slice(0, 16);",
      "    const scope = validFailureScope(fields);\n    const sig = createHash('sha256').update(`${fields.hook}\\0${fields.event || ''}\\0${error}\\0${JSON.stringify(scope)}`).digest('hex').slice(0, 16);"),
    edit('safe-scope-row', '    appendRow(brainHome, { at: new Date(now).toISOString(), ...fields });',
      "    const details = { ...fields };\n    for (const field of SCOPE_FIELDS) delete details[field];\n    appendRow(brainHome, { at: new Date(now).toISOString(), ...details, ...scope });"),
    edit('window-scope', "windows[sig] = { at: now, count: 1, hook: fields.hook, event: fields.event || '', error };",
      "windows[sig] = { at: now, count: 1, hook: fields.hook, event: fields.event || '', error, ...scope };"),
  ] },
  { relative: 'scripts/ruflo-memory-hooks.mjs', identity: 'export function rufloMemory(args,', edits: [
    edit('native-redactor', "import { checkpointNamespaces, newestOfFamily } from './checkpoint-keys.mjs';",
      `import { checkpointNamespaces, newestOfFamily } from './checkpoint-keys.mjs';\n// ${PATCH_MARKER}: stderr goes through the existing native capture redactor.\nimport { captureFailureReason } from './turn-capture-privacy.mjs';`),
    edit('stderr-callback', '      (error, stdout) => {', '      (error, stdout, stderr) => {'),
    edit('terminal-cause',
      "          : error.killed || timedOut ? 'timed out' : `ruflo memory ${args[0]} exited ${error.code ?? 'abnormally'}`;",
      "          : error.killed || timedOut ? 'timed out' : `ruflo memory ${args[0]} exited ${error.code ?? error.signal ?? 'abnormally'}`\n            + (stderr ? `: ${captureFailureReason({ stderr }, error.code)}` : '');"),
    ...CHECKPOINT_EDITS,
  ] },
  { relative: 'scripts/session-snapshot-hook.mjs', identity: 'async function checkpointNow(', edits: [
    edit('scope-import', loggerImport, scopedImport),
    edit('checkpoint-scope',
      "recordHookFailure({ hook: 'checkpoint', event, error: saved.skipped || 'exact checkpoint readback failed' }, { brainHome });",
      "recordHookFailure({ hook: 'checkpoint', event, error: saved.skipped || 'exact checkpoint readback failed',\n      ...failureScope({ project: consent.projectRoot, store: consent.db, session: payload?.session_id, expectedKey: saved.key }) }, { brainHome });"),
    edit('distill-parent-scope', ".detachLearning('--distill', { env });",
      ".detachLearning('--distill', { env, diagnostics: failureScope({ project: projectDir, session: payload?.session_id }) });"),
    edit('distill-launch-scope', "event, error: `detach failed: ${error.code || 'spawn'}` });",
      "event, error: `detach failed: ${error.code || 'spawn'}`, ...failureScope({ project: projectDir, session: payload?.session_id }) });"),
    edit('checkpoint-launch-scope', "error: `skipped: hook budget too small and detach failed (${error.code || 'spawn'})` }, { brainHome });",
      "error: `skipped: hook budget too small and detach failed (${error.code || 'spawn'})`, ...failureScope({ project: projectDir, session: payload?.session_id }) }, { brainHome });"),
    edit('throw-scope', '  const loud = (event) => (error) => {', '  const loud = (event, diagnostics = {}) => (error) => {'),
    edit('throw-row', "error: `threw: ${redactText(String(error?.message || error)).slice(0, 120)}` });",
      "error: `threw: ${redactText(String(error?.message || error)).slice(0, 120)}`, ...validFailureScope(diagnostics) });"),
    edit('detached-throw-context', 'brainHome }).catch(loud(event));',
      'brainHome }).catch(loud(event, failureScope({ project: job.projectDir, session: job.session_id })));'),
    edit('inline-throw-context', 'runLifecycleBoundary(event, payload).catch(loud(event));',
      'runLifecycleBoundary(event, payload).catch(loud(event, failureScope({ project: payload.cwd, session: payload.session_id })));'),
  ] },
  { relative: 'scripts/learn-capture.mjs', identity: 'export function captureLearning(input,', edits: [
    edit('scope-import', loggerImport, scopedImport),
    edit('shed-scope-argument', 'export function shedObservation(brainHome) {', 'export function shedObservation(brainHome, diagnostics = {}) {'),
    edit('shed-scope-row', "event: 'PostToolUse', error: SHED_ERROR }, { brainHome });", "event: 'PostToolUse', error: SHED_ERROR, ...validFailureScope(diagnostics) }, { brainHome });"),
    edit('parent-scope', '  let tool; let action;', '  let tool; let action; let diagnostics = failureScope({ project: input?.cwd, session: input?.session_id });'),
    edit('expected-key', '    const key = observationKey(observation);', '    const key = observationKey(observation);\n    Object.assign(diagnostics, failureScope({ expectedKey: key }));'),
    edit('shed-call', 'if (!slot) return shedObservation(brainHome);', 'if (!slot) return shedObservation(brainHome, diagnostics);'),
    edit('detached-parent', 'brainHome, observation, slot });', 'brainHome, observation, slot, diagnostics });'),
    edit('inline-options', '{ env, deadline: Date.now() + 6000 });', '{ env, deadline: Date.now() + 6000, diagnostics });'),
    edit('parent-failure', "error: String(error?.message || error).slice(0, 160) }, { brainHome });",
      "error: String(error?.message || error).slice(0, 160), ...validFailureScope(diagnostics) }, { brainHome });"),
    edit('detach-argument', 'export function detachLearning(mode, { env = process.env, brainHome, observation, slot } = {}) {',
      'export function detachLearning(mode, { env = process.env, brainHome, observation, slot, diagnostics = {} } = {}) {'),
    edit('detached-envelope', 'env: { ...env, ...(observation ? { RUVNET_LEARN_OBSERVATION:',
      'env: { ...env, RUVNET_LEARN_FAILURE_SCOPE: JSON.stringify(validFailureScope(diagnostics)), ...(observation ? { RUVNET_LEARN_OBSERVATION:'),
    edit('child-scope', '  let observation = null;',
      "  let observation = null; let diagnostics = {};\n  try { diagnostics = validFailureScope(JSON.parse(process.env.RUVNET_LEARN_FAILURE_SCOPE || '{}')); } catch { /* no trusted correlation */ }"),
    edit('child-failure', "error: String(error?.message || error).slice(0, 160) });",
      "error: String(error?.message || error).slice(0, 160), ...diagnostics }, { brainHome });"),
    edit('child-options', "allowed: () => learningContext().enabled });", "allowed: () => learningContext().enabled, diagnostics });"),
    edit('distill-options', 'distillObservations(binary, context, { env: process.env });', 'distillObservations(binary, context, { env: process.env, diagnostics });'),
  ] },
  { relative: 'scripts/learning-store.mjs', identity: 'export function recordLearningObservation(binary,', edits: [
    edit('scope-import', "import { captureFailureReason } from './turn-capture-privacy.mjs';",
      `import { captureFailureReason } from './turn-capture-privacy.mjs';\n// ${PATCH_MARKER}: reuse the already-resolved native store; no extra resolver or driver.\nimport { failureScope } from './hook-failures.mjs';`),
    edit('resolved-store-scope', "  const key = observationKey({ session, tool, action });",
      "  const key = observationKey({ session, tool, action });\n  if (options.diagnostics) Object.assign(options.diagnostics, failureScope({ store: db, session, expectedKey: key }));"),
    edit('distill-store-scope', 'export function distillObservations(binary, context, options = {}) {\n  const db = learningTarget(context, options);',
      'export function distillObservations(binary, context, options = {}) {\n  const db = learningTarget(context, options);\n  if (options.diagnostics) Object.assign(options.diagnostics, failureScope({ store: db }));'),
  ] },
  { relative: 'scripts/turn-outcome-capture.mjs', identity: 'export function runSteps(', edits: [
    edit('scope-import', loggerImport, scopedImport),
    edit('parent-failure', "...(store ? { store: digest(store).slice(0, 16) } : {}) }, { brainHome }); return reason; };",
      "...failureScope({ project: target?.projectRoot || projectDir, store, session: payload.session_id || payload.transcript_path, expectedKey: report.key }) }, { brainHome }); return reason; };"),
    edit('binding-scope', "brainHome, rootIdentity: `${rootStat.dev}:${rootStat.ino}` };",
      "brainHome, rootIdentity: `${rootStat.dev}:${rootStat.ino}`, failureScope: failureScope({ project: projectRoot, store: db, session: payload.session_id || payload.transcript_path }) };"),
    edit('child-failure', "...(db ? { store: digest(db).slice(0, 16) } : {}) }, { brainHome });",
      "...validFailureScope(queued.failureScope), ...failureScope({ store: db, expectedKey: key }) }, { brainHome });"),
    edit('readback-terminal-state', "return result.status === 0 ? String(result.stdout || '').trim() : null;",
      "return result.status === 0 && !result.error && !result.signal ? String(result.stdout || '').trim() : null;"),
    edit('readback-result', "let status = 1; let error = null; let skipped = null; let verified = false;",
      "let status = 1; let error = null; let skipped = null; let verified = false; let readback = null;"),
    edit('readback-once', "{ verified = read({ ruflo, db, key, run, options }) === value; if (verified) status = 0; } // identical bytes = success",
      "{ readback = read({ ruflo, db, key, run, options }); verified = readback === value; if (verified) status = 0; } // identical bytes = success"),
    edit('readback-failure-kind', "if (!verified && duplicate) error = 'duplicate turn key holds different content';",
      "if (!verified && duplicate) error = readback === null ? 'duplicate turn key could not be read back' : 'duplicate turn key holds different content';"),
  ] },
];

const count = (source, text) => source.split(text).length - 1;
const specFor = source => SPECS.find(spec => source.includes(spec.identity));
const previousEdits = spec => spec.edits.filter(({ id }) => !id.startsWith('readback-'));
const beforeCheckpoint = spec => spec.edits.filter(({ id }) => !id.startsWith('checkpoint-diagnostic-'));
const isPriorCheckpoint = (source, spec) => Boolean(spec?.relative === 'scripts/ruflo-memory-hooks.mjs'
  && hasPatch(source) && beforeCheckpoint(spec).every(({ to }) => count(source, to) === 1)
  && CHECKPOINT_EDITS.every(({ from }) => count(source, from) === 1));
const isPreviousPatched = (source, spec) => Boolean(spec?.relative === 'scripts/turn-outcome-capture.mjs'
  && hasPatch(source) && previousEdits(spec).every(({ to }) => count(source, to) === 1)
  && spec.edits.filter(({ id }) => id.startsWith('readback-')).every(({ from }) => count(source, from) === 1));
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => {
  const spec = specFor(source);
  return Boolean(spec && nativeLearningRoute(source) && hasPatch(source) && spec.edits.every(({ to }) => count(source, to) === 1));
};
export function patchSource(source) {
  if (!nativeLearningRoute(source)) return { next: source, applied: [], missing: ['native-detached-PostToolUse-route'] };
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const spec = specFor(source);
  if (isPriorCheckpoint(source, spec)) return {
    next: CHECKPOINT_EDITS.reduce((text, { from, to }) => text.replace(from, () => to), source),
    applied: CHECKPOINT_EDITS.map(({ id }) => id), missing: [],
  };
  if (isPreviousPatched(source, spec)) {
    const edits = spec.edits.filter(({ id }) => id.startsWith('readback-'));
    return { next: edits.reduce((text, { from, to }) => text.replace(from, () => to), source),
      applied: edits.map(({ id }) => id), missing: [] };
  }
  if (!spec || hasPatch(source)) return { next: source, applied: [], missing: ['capture-diagnostics-source-ownership'] };
  const missing = spec.edits.filter(({ from }) => count(source, from) !== 1).map(({ id }) => id);
  if (missing.length) return { next: source, applied: [], missing };
  return { next: spec.edits.reduce((text, { from, to }) => text.replace(from, () => to), source),
    applied: spec.edits.map(({ id }) => id), missing: [] };
}
export function reverseSource(source) {
  const spec = specFor(source);
  const edits = isPriorCheckpoint(source, spec) ? beforeCheckpoint(spec)
    : isPreviousPatched(source, spec) ? previousEdits(spec) : spec?.edits;
  return !spec || !(isPatched(source) || isPreviousPatched(source, spec) || isPriorCheckpoint(source, spec)) ? source
    : edits.reduceRight((text, { from, to }) => text.replace(to, () => from), source);
}
export function historicalPatchSource(source) {
  const spec = specFor(source);
  if (spec?.relative !== 'scripts/ruflo-memory-hooks.mjs') return patchSource(source);
  const edits = beforeCheckpoint(spec);
  if (hasPatch(source) || !edits.every(({ from }) => count(source, from) === 1))
    return { next: source, applied: [], missing: ['prior-checkpoint-diagnostics-boundary'] };
  return { next: edits.reduce((text, { from, to }) => text.replace(from, () => to), source),
    applied: edits.map(({ id }) => id), missing: [] };
}
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: SPECS.map(spec => spec.relative),
}).filter(surface => surface.kind === 'full').flatMap(surface => SPECS.map(spec => path.join(surface.root, spec.relative)));
export function preflight(files = discover()) {
  const errors = [];
  for (const file of files) {
    try {
      const result = patchSource(fs.readFileSync(file, 'utf8'));
      if (result.missing.length) errors.push(`${file}: ${result.missing.join(', ')}`);
    } catch (error) { errors.push(`${file}: ${error.code || error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, discover,
  prepare: () => prepareNativeLearningRoute(discover(), patchSource),
  preflight, patchSource, historicalPatchSource, hasPatch, isPatched, reverse: reverseSource };
