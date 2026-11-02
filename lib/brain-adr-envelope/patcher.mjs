// Brain #515: do not cut ordinary large Codex edit envelopes mid-JSON at 64KiB.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
export const NAME = 'brain-adr-envelope';
export const PATCH_MARKER = 'ruflo-source-patch brain#515';
export const SPECS = [
  { relative: 'scripts/hook-shim.mjs', edits: [[
    "  'decision-gate':    { file: 'decision-gate.mjs',   interpreter: 'node', mode: 'blocking', offBehavior: 'run', stdinBytes: 65536 },",
    `  // ${PATCH_MARKER}: complete envelopes up to the existing 1MiB child I/O ceiling.
  'decision-gate':    { file: 'decision-gate.mjs',   interpreter: 'node', mode: 'blocking', offBehavior: 'run', stdinBytes: 1048576 },`,
  ]] },
  { relative: 'scripts/decision-gate.mjs', edits: [[
    'export const TRANSPORT_CAP_BYTES = 65536;',
    `// ${PATCH_MARKER}: envelope transport only; shell policies retain their independent 64KiB inspections.
export const TRANSPORT_CAP_BYTES = 1048576;`,
  ]] },
];
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => hasPatch(source) && SPECS.some(spec => spec.edits.every(([, to]) => count(source, to) === 1));
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const candidates = SPECS.filter(spec => spec.edits.every(([from]) => count(source, from) === 1));
  if (hasPatch(source) || candidates.length !== 1) return { next: source, applied: [], missing: ['native-decision-envelope-cap'] };
  return { next: candidates[0].edits.reduce((s, [from, to]) => s.replace(from, () => to), source), applied: ['bounded-complete-envelope'], missing: [] };
}
export const reverseSource = source => SPECS.flatMap(spec => spec.edits).reduceRight((s, [from, to]) => s.replace(to, () => from), source);
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: SPECS.map(spec => spec.relative),
}).filter(surface => surface.kind === 'full').flatMap(surface => SPECS.map(spec => path.join(surface.root, spec.relative)))
  .filter(file => fs.existsSync(file));
// Retire on upstream structured-scope transport that passes large-edit owning-checkout evaluation.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource };
