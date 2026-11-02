// Ruflo #4666. Withdraw our downstream capture adapter selection and restore
// native initialization. Historical edits below are reconstruction evidence only.
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { withdrawDescriptor } from '../ruflo-memory-entries-only/transform.mjs';

export const NAME = 'brain-learning-native-owner';
export const PATCH_MARKER = 'ruflo-source-patch (ruflo#4622 learning-native-owner)';
export const EDITS = [
  ['native-capture-route',
    "  const run = args => { if (options.allowed && !options.allowed()) throw new Error('learning consent changed'); return runLearningRuflo(binary, args, db, options); };\n  const stored = run(",
    `  // ${PATCH_MARKER}: capture does not acquire the shared vector companion.\n  const captureOptions = { ...options, env: { ...(options.env || process.env), RUFLO_BRIDGE_MEMORY_ENTRIES_ONLY: '1' } };\n  const run = args => { if (options.allowed && !options.allowed()) throw new Error('learning consent changed'); return runLearningRuflo(binary, args, db, captureOptions); };\n  const stored = run(`],
  ['require-native-write',
    "    '--no-upsert', '--provenance', 'system_observation', '--path', db]);",
    "    '--no-upsert', '--require-native', '--provenance', 'system_observation', '--path', db]);"],
];
const count = (s, text) => s.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => count(source, PATCH_MARKER) === 1
  && EDITS.every(([, , to]) => count(source, to) === 1);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || !EDITS.every(([, from]) => count(source, from) === 1))
    return { next: source, applied: [], missing: ['unique-native-learning-capture-route'] };
  return { next: EDITS.reduce((s, [, from, to]) => s.replace(from, () => to), source),
    applied: EDITS.map(([id]) => id), missing: [] };
}
export const reverseSource = source => EDITS.reduceRight((s, [, from, to]) => s.replace(to, () => from), source);
const checkpointFrom = "  const options = { db: store.db, env, bin, deadlineAt };\n  const stored = await rufloMemory(['store', '--key', key, '-n', store.namespace, '--value', value, '--no-upsert'], options);";
const checkpointTo = "  const options = { db: store.db, env: { ...env, RUFLO_BRIDGE_MEMORY_ENTRIES_ONLY: '1' }, bin, deadlineAt };\n  const stored = await rufloMemory(['store', '--key', key, '-n', store.namespace, '--value', value, '--no-upsert', '--require-native'], options);";
const checkpointAppendOnly = checkpointTo.replace("'--require-native'", "'--require-native', '--append-only'");
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: ['scripts/learning-store.mjs'],
}).filter(surface => surface.kind === 'full').flatMap(surface => ['scripts/learning-store.mjs', 'scripts/ruflo-memory-hooks.mjs'].map(file => path.join(surface.root, file)));
// Recognize historical bytes only for exact restoration; never reinstall them.
const legacyDescriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch: source => hasPatch(source) || source.includes(checkpointTo) || source.includes(checkpointAppendOnly), isPatched,
  reverse: source => reverseSource(source).replace(checkpointTo, () => checkpointFrom).replace(checkpointAppendOnly, () => checkpointFrom),
  historicalPatchSource: (source, current = '') => source.includes(checkpointFrom)
    ? { next: source.replace(checkpointFrom, () => current.includes(checkpointAppendOnly) ? checkpointAppendOnly : checkpointTo), applied: ['historical-hz-checkpoint'], missing: [] }
    : patchSource(source) };
export const descriptor = withdrawDescriptor(legacyDescriptor, source => !legacyDescriptor.hasPatch(source)
  && (source.includes(checkpointFrom) || EDITS.every(([, from]) => source.includes(from))));
