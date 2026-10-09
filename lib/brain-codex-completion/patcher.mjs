// Brain #423: normalize native Codex evidence; retain the existing completion verdict rules.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';

export const NAME = 'brain-codex-completion';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#423)';
const runtime = fs.readFileSync(new URL('./runtime.mjs', import.meta.url), 'utf8');
const evidenceAnchor = 'export function readClaudeTurn(transcriptPath, { read = readSettledTranscript } = {}) {';
export const SPECS = [
  { relative: 'scripts/completion-claim-evidence.mjs', edits: [
    [evidenceAnchor, `// ${PATCH_MARKER}\n${runtime}\n${evidenceAnchor}`],
  ] },
  { relative: 'scripts/continuation-gate.mjs', edits: [
    ['  auditCompletionClaims, readClaudeTurn, extractCommitments, claimClosesPromise,',
      '  auditCompletionClaims, readClaudeTurn, readCodexTurn, extractCommitments, claimClosesPromise,'],
    ["    const turn = HOST === 'claude' ? readClaudeTurn(hookInput.transcript_path) : null;",
      `    // ${PATCH_MARKER}: unsupported evidence remains UNKNOWN, never a manufactured pass.\n    const turn = HOST === 'claude' ? readClaudeTurn(hookInput.transcript_path)\n      : HOST === 'codex' ? readCodexTurn(hookInput.transcript_path) : null;`],
  ] },
];
const count = (s, n) => s.split(n).length - 1;
const specOf = s => SPECS.find(spec => spec.edits.some(([a, b]) => s.includes(a) || s.includes(b)));
export const hasPatch = s => s.includes(PATCH_MARKER);
export const isPatched = s => {
  const spec = specOf(s);
  return Boolean(spec && spec.edits.every(([a, b]) => count(s, b) === 1 && !s.replace(b, '').includes(a)));
};
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const spec = specOf(source);
  if (!spec || hasPatch(source) || spec.edits.some(([a]) => count(source, a) !== 1)) {
    return { next: source, applied: [], missing: ['unique reviewed Codex completion boundary'] };
  }
  return { next: spec.edits.reduce((s, [a, b]) => s.replace(a, b), source), applied: [NAME], missing: [] };
}
export const reverseSource = source => SPECS.flatMap(s => s.edits)
  .reduceRight((s, [a, b]) => s.replace(b, a), source);
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: SPECS.map(s => s.relative) })
  .filter(s => s.kind === 'full').flatMap(s => SPECS.map(spec => path.join(s.root, spec.relative)));
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
        || existingPathRelative(path.dirname(path.dirname(file)), file) === null) throw Error('unsafe native script');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unproved Codex completion source');
    } catch (error) { errors.push(file + ': ' + error.message); }
  }
  return { ok: errors.length === 0, errors };
}
// Retirement requires an upstream parser plus the same positive/negative Stop-path matrix.
// Anchor drift remains visible until that replacement has been reviewed and behaviourally qualified.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
