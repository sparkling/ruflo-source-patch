// Ruflo #4666. Reuse the retained downstream capture adapter from
// ruflo-memory-entries-only, backed by the native SQLite and embedding owners.
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';

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
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: ['scripts/learning-store.mjs'],
}).filter(surface => surface.kind === 'full').map(surface => path.join(surface.root, 'scripts/learning-store.mjs'));
// Retire only after upstream capture selects the same native adapter, preserves
// consent and exact readback, and passes a real concurrent-owner capture test.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource };
