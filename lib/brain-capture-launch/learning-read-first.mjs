// Brain #521: exact native readback can prove a durable duplicate without another write.
export const READ_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#521 capture-read-first)';
const from = `  const run = args => { if (options.allowed && !options.allowed()) throw new Error('learning consent changed'); return runLearningRuflo(binary, args, db, options); };
  const stored = run(['memory', 'store', '--key', key, '--value', value, '--namespace', LEARNING_NAMESPACE,`;
const to = `  // ${READ_MARKER}: same constructor, consent, explicit store and native CLI.
  const run = (args, overrides = {}) => { if (options.allowed && !options.allowed()) throw new Error('learning consent changed'); return runLearningRuflo(binary, args, db, { ...options, ...overrides }); };
  const step = Number.isFinite(options.maxStepMs) && options.maxStepMs > 0 ? options.maxStepMs : 6000;
  const remaining = Number.isFinite(options.deadline) ? options.deadline - Date.now() : 18000;
  // Reserve both original native steps. The short inline budget skips this optimization.
  const preReadMs = Math.floor(Math.min(1000, Math.max(0, remaining - 2 * step)));
  if (preReadMs > 0) {
    const existing = run(['memory', 'retrieve', '--key', key, '--namespace', LEARNING_NAMESPACE, '--value-only', '--path', db], { maxStepMs: preReadMs });
    if (!existing.error && existing.status === 0 && String(existing.stdout || '').trim() === value)
      return { db, key, digest: createHash('sha256').update(value).digest('hex'), exactCli: true, alreadyStored: true, readOnlyDuplicate: true };
    // Missing, conflicting or unavailable evidence is not an acknowledgement. The original
    // first strict insert and exact readback below retain their native outcomes; never retry a write.
  }
  const stored = run(['memory', 'store', '--key', key, '--value', value, '--namespace', LEARNING_NAMESPACE,`;
export const READ_EDITS = [['native-exact-read-first', from, to]];
const count = (source, text) => source.split(text).length - 1;
export const isLearningSource = source => source.includes('export function recordLearningObservation(binary,');
export const hasRead = source => source.includes(READ_MARKER);
export const isReading = source => isLearningSource(source) && count(source, READ_MARKER) === 1 && count(source, to) === 1;
export function patchRead(source) {
  if (isReading(source)) return { next: source, applied: [], missing: [] };
  if (!isLearningSource(source) || hasRead(source) || count(source, from) !== 1)
    return { next: source, applied: [], missing: ['unique-native-learning-read-first'] };
  return { next: source.replace(from, () => to), applied: ['native-exact-read-first'], missing: [] };
}
export const undoRead = source => isReading(source) ? source.replace(to, () => from) : source;
