// https://github.com/ruvnet/ruflo/issues/4880 — report native flush outcomes.
// No storage algorithm, automatic retry, new writer or historical reconstruction.
import fs from 'node:fs';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { FLUSH_VARIANTS } from './native.mjs';

export const NAME = 'ruflo-learning-persistence';
export const MARKER = 'ruflo-source-patch (ruflo#4880)';
export const RETIREMENT = 'Retire only on pristine executable proof that failed native pattern flushes retain dirty state, return failure through trajectory/bridge/MCP consumers, and expose process-scoped flush status without throwing from timers or changing native storage.';
export function rspPatternFlushStatus(bank) {
  return { initialized: Boolean(bank), enabled: bank ? bank.persistenceEnabled === true : null,
    dirty: bank ? bank.dirty === true : null,
    lastFlush: bank?.rspPatternFlush ? { ...bank.rspPatternFlush } : null,
    scope: 'this process only; no historical recovery or other-writer durability is established' };
}
// Normalize only this process's native receipt; do not expose private error text.
export function rspNativePatternFlushStatus(bank) {
  const state = bank?.getFlushState();
  return { initialized: Boolean(bank), enabled: bank ? bank.persistenceEnabled === true : null,
    dirty: state ? state.dirty === true : null,
    lastFlush: state?.lastFlushAt ? { success: state.lastFlushError ? false : state.dirty ? null : true,
      at: new Date(state.lastFlushAt).toISOString(), code: state.lastFlushError ? 'PERSISTENCE_FAILED' : null } : null,
    scope: 'this process only; no historical recovery or other-writer durability is established' };
}
export async function rspRecordedTrajectory(intel, ...args) {
  if (await intel.recordTrajectory(...args) !== true)
    throw new Error('Native trajectory persistence was not confirmed; inspect the owning process pattern persistence status.');
}
const count = (s, needle) => s.split(needle).length - 1;
const flushEdits = FLUSH_VARIANTS.map(native => [native, native
  .replace('            return;', '            return this.persistenceEnabled === true;')
  .replace('        }\n        catch (error)', `            // ${MARKER}: preserve native write/lock/merge behavior.
            this.rspPatternFlush = { success: true, at: new Date().toISOString(), code: null };
            return true;
        }
        catch (error)`)
  .replace("            console.error('Failed to persist patterns:', error);",
    `            console.error('Failed to persist patterns:', error);
            this.rspPatternFlush = { success: false, at: new Date().toISOString(),
                code: typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'PERSISTENCE_FAILED' };
            return false;`)]);
const trajectoryTail = `        bumpStat('trajectoriesRecorded');
        globalStats.lastAdaptation = Date.now();
        // #4283: the bank's own save is debounced, and the one-shot bins exit as
        // soon as the command resolves, so write the patterns now. Otherwise
        // stats.json counts patterns that never reach patterns.json.
        reasoningBank?.flushToDisk();
        savePersistedStats();
        return true;`;
const intelligenceEdits = [
  [trajectoryTail, `        // #4880: keep unsaved in-memory learning; do not acknowledge a failed flush.
        if (!reasoningBank || reasoningBank.flushToDisk() !== true) return false;
        bumpStat('trajectoriesRecorded');
        globalStats.lastAdaptation = Date.now();
        savePersistedStats();
        return true;`],
  ['\n        sonaEnabled: !!sonaCoordinator,', '\n        patternPersistence: rspPatternFlushStatus(reasoningBank),\n        sonaEnabled: !!sonaCoordinator,'],
  ['export function getPersistenceStatus() {', `${rspPatternFlushStatus.toString()}\nexport function getPersistenceStatus() {`],
  ['        patternsFile,\n        statsFile,', '        patternsFile,\n        statsFile,\n        patternPersistence: rspPatternFlushStatus(reasoningBank),'],
];
// 3.75 already owns locking, merging, dirty state and error receipts. Keep them.
const native375Edits = [
  ['        if (!this.persistenceEnabled || !this.dirty)\n            return true;',
    '        if (!this.persistenceEnabled || !this.dirty)\n            return this.persistenceEnabled === true;'],
  [trajectoryTail.replace('        reasoningBank?.flushToDisk();',
    "        // #4880: a failed write (e.g. ENOSPC) returns false instead of claiming\n        // success for patterns that exist only in memory.\n        const persisted = reasoningBank ? reasoningBank.flushToDisk() : true;")
    .replace('        return true;', '        return persisted;'),
    intelligenceEdits[0][1].replace('// #4880:', `// ${MARKER}:`)],
  ...intelligenceEdits.slice(1).map(([old, next]) => [old,
    next.replace(rspPatternFlushStatus.toString(), rspNativePatternFlushStatus.toString())
      .replaceAll('rspPatternFlushStatus(reasoningBank)', 'rspNativePatternFlushStatus(reasoningBank)')]),
];
const bridgeEdits = [[
  "            if (typeof reasoningBank.flushToDisk === 'function')\n                reasoningBank.flushToDisk();",
  `            // ${MARKER}: a refused native flush cannot acknowledge persistence.
            if (typeof reasoningBank.flushToDisk === 'function' && reasoningBank.flushToDisk() === false)
                return { success: false, patternId, controller: 'reasoningBank',
                    error: 'Native pattern persistence failed; in-memory state retained, do not replay blindly.' };`,
]];
const hookEdits = [
  ['export const hooksPostCommand = {', `// ${MARKER}: honor the existing boolean trajectory result.
${rspRecordedTrajectory.toString()}
export const hooksPostCommand = {`],
  ['            ruvllmStats.trajectories = iStats._ruvllmTrajectories || 0;',
    '            ruvllmStats.trajectories = iStats._ruvllmTrajectories || 0;\n            ruvllmStats.patternPersistence = iStats.patternPersistence ?? null;'],
];
// Four native MCP callers used statistics to infer success while ignoring false.
const hookCall = ['await intel.recordTrajectory(', 'await rspRecordedTrajectory(intel, '];
const families = source => source.includes('export async function recordTrajectory(steps, verdict) {') ? 'intelligence'
  : source.includes('export const hooksPostCommand = {') ? 'hooks'
    : source.includes('export async function bridgeStorePattern(options) {') ? 'bridge' : null;
function variants(source) {
  const kind = families(source);
  return kind === 'intelligence' ? [...flushEdits.map(pair => [pair, ...intelligenceEdits]), native375Edits]
    : kind === 'hooks' ? [[hookCall, ...hookEdits]] : kind === 'bridge' ? [bridgeEdits] : [];
}
function matches(source, edits, side) {
  return edits.every(pair => count(source, pair[side]) === (pair === hookCall ? 4 : 1));
}
const replace = (source, edits, side) => edits.reduce((s, pair) =>
  s.split(pair[side]).join(pair[1 - side]), source);
export const hasPatch = source => source.includes(MARKER);
export const isPatched = source => count(source, MARKER) === 1
  && variants(source).filter(edits => matches(source, edits, 1)).length === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const matched = variants(source).filter(edits => matches(source, edits, 0));
  if (hasPatch(source) || matched.length !== 1)
    return { next: source, applied: [], missing: ['native-learning-persistence-anchors'] };
  return { next: replace(source, matched[0], 0), applied: [NAME], missing: [] };
}
export function reverse(source) {
  if (!isPatched(source)) return source;
  return replace(source, variants(source).find(edits => matches(source, edits, 1)), 1);
}
export const discover = () => ['memory/intelligence.js', 'memory/memory-bridge.js', 'mcp-tools/hooks-tools.js']
  .flatMap(relative => discoverCli(['@claude-flow', 'cli', 'dist', 'src', ...relative.split('/')]));
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.isSymbolicLink() || !st.size) throw Error('unsafe source');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unproved learning persistence anchors');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: !errors.length, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse };
