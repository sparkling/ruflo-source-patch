// Brain #521: reuse the existing private capture timing sink; no new writer or replay.
export const STEP_MARKER = 'ruflo-source-patch (brain#521 capture-step-timing)';
const learning = [[
  '  const run = (args, overrides = {}) => { if (options.allowed && !options.allowed()) throw new Error(\'learning consent changed\'); return runLearningRuflo(binary, args, db, { ...options, ...overrides }); };',
  `  // ${STEP_MARKER}: fixed metadata only, never observation or response text.
  let diagnosticSequence = 0;
  const run = (args, overrides = {}) => {
    if (options.allowed && !options.allowed()) throw new Error('learning consent changed');
    const started = Date.now(), sequence = diagnosticSequence++;
    const settings = { ...options, ...overrides };
    let result, thrown;
    try { return result = runLearningRuflo(binary, args, db, settings); }
    catch (error) { thrown = error; throw error; }
    finally {
      try { context.diagnosticStep?.({ sequence, operation: args[1] === 'store' ? 'store' : 'retrieve',
        durationMs: Math.max(0, Date.now() - started),
        budgetMs: Number.isFinite(settings.maxStepMs) ? settings.maxStepMs : 6000,
        remainingAtStartMs: Number.isFinite(settings.deadline) ? Math.max(0, settings.deadline - started) : null,
        status: Number.isInteger(result?.status) ? result.status : null,
        timedOut: result?.error?.code === 'ETIMEDOUT', threw: Boolean(thrown),
        errorPresent: Boolean(result?.error), signalPresent: Boolean(result?.signal),
        exactMatch: args[1] === 'retrieve' && !result?.error && result?.status === 0
          && String(result.stdout || '').trim() === value }); } catch { /* Diagnostics cannot affect capture. */ }
    }
  };`, 1,
]];
const capture = [
  ['    captureTimingWrite(() => {', '    captureTimingWrite(diagnosticStep => {', 2],
  ['return recordLearningObservation(binary, context, observation,',
    'return recordLearningObservation(binary, { ...context, diagnosticStep }, observation,', 2],
  ["  captureTimingWrite = fn => step('native-store-readback', () => {\n    const result = fn();",
    `  // ${STEP_MARKER}: reuse the bounded snapshot and its event limit.
  captureTimingWrite = fn => step('native-store-readback', () => {
    const result = fn(fields => note('native-step', fields));`, 1],
];
const edits = source => source.includes('export function recordLearningObservation(') ? learning : capture;
const count = (s, a) => s.split(a).length - 1;
export const hasSteps = s => s.includes(STEP_MARKER);
export const stepsValid = s => hasSteps(s) && edits(s).every(([, to, n]) => count(s, to) === n);
export const undoSteps = s => stepsValid(s) ? edits(s).reduceRight((v, [from, to]) => v.split(to).join(from), s) : s;
export function addSteps(s) {
  if (stepsValid(s)) return s;
  if (hasSteps(s) || !edits(s).every(([from, , n]) => count(s, from) === n)) return null;
  return edits(s).reduce((v, [from, to]) => v.split(from).join(to), s);
}
