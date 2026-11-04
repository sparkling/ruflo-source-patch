// Brain #515: do not cut ordinary large Codex edit envelopes mid-JSON at 64KiB.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
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
  ], [
    "import { normalizePayloadText } from './hook-input.mjs';",
    "import { normalizePayloadText, readStdinBounded } from './hook-input.mjs';",
  ], [
    '  const payload = normalizePayloadText(readPayload());',
    '  const payload = normalizePayloadText(await readPayload());',
  ], [
    `function readPayload() {
  if (process.stdin.isTTY) return '';
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}`,
    `async function readPayload() {
  // ${PATCH_MARKER}: native async reader preserves pipe chunks instead of swallowing EAGAIN.
  return (await readStdinBounded({ maxBytes: TRANSPORT_CAP_BYTES })).toString('utf8');
}`,
  ]] },
];
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => hasPatch(source) && SPECS.some(spec => spec.edits.every(([, to]) => count(source, to) === 1));
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  // Exact prior cap-only contribution can upgrade in place; unknown/partial reader edits refuse.
  const prior = SPECS[1].edits[0];
  const base = count(source, PATCH_MARKER) === 1 && count(source, prior[1]) === 1
    ? source.replace(prior[1], () => prior[0]) : source;
  const candidates = SPECS.filter(spec => spec.edits.every(([from]) => count(base, from) === 1));
  if (hasPatch(base) || candidates.length !== 1) return { next: source, applied: [], missing: ['native-decision-envelope-cap'] };
  return { next: candidates[0].edits.reduce((s, [from, to]) => s.replace(from, () => to), base), applied: ['bounded-complete-envelope'], missing: [] };
}
export const reverseSource = source => SPECS.flatMap(spec => spec.edits).reduceRight((s, [from, to]) => s.replace(to, () => from), source);
const surfaces = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: SPECS.map(spec => spec.relative),
  // The paired shim is this target's preflight responsibility, not a discovery filter.
  requiredRelatives: ['scripts/hijack-ruvnet.sh', 'scripts/hook-input.mjs', 'mcp/server.mjs'],
}).filter(surface => surface.kind === 'full');
export const discover = () => surfaces().flatMap(surface => SPECS.map(spec => path.join(surface.root, spec.relative)));
export function preflight() {
  const errors = [];
  for (const surface of surfaces()) {
    const file = path.join(surface.root, 'scripts/hook-input.mjs');
    try {
      if (existingPathRelative(surface.root, file) === null
        || !fs.readFileSync(file, 'utf8').includes('export function readStdinBounded('))
        throw Error('native bounded input reader unavailable');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  for (const surface of surfaces()) for (const spec of SPECS) {
    const file = path.join(surface.root, spec.relative);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(surface.root, file) === null)
        throw new Error('absent, empty or unsafe decision-envelope member');
      const result = patchSource(fs.readFileSync(file, 'utf8'));
      if (result.missing.length || !spec.edits.every(([, to]) => count(result.next, to) === 1))
        throw new Error('paired decision-envelope anchors do not match');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
// Retire on upstream structured-scope transport that passes large-edit owning-checkout evaluation.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource, preflight };
