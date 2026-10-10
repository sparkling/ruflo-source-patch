// Migration-only historical bytes. Never used as the active patch contribution.
// Brain #423: normalize native Codex evidence; retain the existing completion verdict rules.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';

export const NAME = 'brain-codex-completion';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#423)';
const runtime = fs.readFileSync(new URL('./migration-v44644-runtime.mjs', import.meta.url), 'utf8');
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
// Exact v4.46.42/43 composition remains recognizable during this diagnostic-only upgrade.
const LEGACY_SPECS = SPECS.map(spec => ({ ...spec, edits: [...spec.edits] }));
SPECS[0].edits.push([
  "  else if (!verification.checks.length) {\n    problems.push(verification.lastChange",
  "  else if (!verification.checks.length && host === 'codex') {\n"
    + "    problems.push('no qualifying successful check evidence follows the last observed or possible change'\n"
    + "      + (verification.lastChange ? ' (' + verification.lastChange + ')' : '')\n"
    + "      + '; arbitrary scripts and unsupported tools are conservative boundaries, not proof that no check ran or that application code changed');\n"
    + "  } else if (!verification.checks.length) {\n    problems.push(verification.lastChange",
]);
// This anchor exists only in the scoped native policy; older policies keep their original text.
export const SCOPE_EDIT = [
  "problems.push('observed checks cover only their executed scope; whole-task completion is UNKNOWN');",
  "problems.push('observed checks cover only their executed scope; this audit cannot qualify task-completion claims, even when locally scoped. Report individual evidenced outcomes and limitations; repeating checks does not establish task-completion authority');",
];
SPECS[1].edits.push([
  'Run the real consumer path, or restate it as UNVERIFIED.',
  'Report the checks actually observed and what remains UNVERIFIED. A classifier limitation is not proof of application failure. Do not repeat recovery or expand project work merely to satisfy this hook.',
]);
const count = (s, n) => s.split(n).length - 1;
const specOf = s => SPECS.find(spec => spec.edits.some(([a, b]) => s.includes(a) || s.includes(b)));
export const hasPatch = s => s.includes(PATCH_MARKER);
export const isPatched = s => {
  const spec = specOf(s);
  return Boolean(spec && spec.edits.every(([a, b]) => count(s, b) === 1 && !s.replace(b, '').includes(a))
    && !s.includes(SCOPE_EDIT[0])
    && (!s.includes('const scopedCheck =') || count(s, SCOPE_EDIT[1]) === 1));
};
const legacyOf = s => LEGACY_SPECS.find(spec => spec.edits.every(([a, b]) =>
  count(s, b) === 1 && !s.replace(b, '').includes(a)));
export function historicalPatchSource(source) {
  const spec = LEGACY_SPECS.find(spec => spec.edits.every(([a]) => count(source, a) === 1));
  return spec ? { next: spec.edits.reduce((s, [a, b]) => s.replace(a, b), source), applied: [NAME], missing: [] }
    : { next: source, applied: [], missing: ['legacy completion boundary'] };
}
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const legacy = legacyOf(source);
  if (legacy) {
    const pristine = legacy.edits.reduceRight((s, [a, b]) => s.replace(b, a), source);
    const upgraded = patchSource(pristine);
    return upgraded.missing.length ? { ...upgraded, next: source } : upgraded;
  }
  const spec = specOf(source);
  if (!spec || hasPatch(source) || spec.edits.some(([a]) => count(source, a) !== 1)) {
    return { next: source, applied: [], missing: ['unique reviewed Codex completion boundary'] };
  }
  if (count(source, SCOPE_EDIT[0]) > 1 || (source.includes('const scopedCheck =') && count(source, SCOPE_EDIT[0]) !== 1)) return { next: source, applied: [], missing: ['ambiguous scope diagnostic'] };
  return { next: spec.edits.reduce((s, [a, b]) => s.replace(a, b), source)
    .replace(...SCOPE_EDIT), applied: [NAME], missing: [] };
}
export const reverseSource = source => SPECS.flatMap(s => s.edits)
  .reduceRight((s, [a, b]) => s.replace(b, a), source.replace(SCOPE_EDIT[1], SCOPE_EDIT[0]));
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
  discover, preflight, patchSource, historicalPatchSource, hasPatch, isPatched, reverse: reverseSource };

// Exact staged once-turn bytes: restoration only, never an active contribution.
export const DELIVERY_EDIT = ['const completionWork = ', `// ${PATCH_MARKER}: one correction reservation per native user turn, never a completion receipt.
function reserveCompletionCorrection() {
  if (!['FAIL', 'UNKNOWN'].includes(completion.verdict)) return false;
  const advisory = reason => {
    console.error(JSON.stringify({ kind: 'completion-correction-advisory', authority: false,
      verdict: completion.verdict, problems: completion.problems, reason }));
    return false;
  };
  if (typeof hookInput.turn_id !== 'string' || !hookInput.turn_id.trim()
    || typeof hookInput.session_id !== 'string' || !hookInput.session_id.trim())
    return advisory('native turn identity unavailable; correction cannot be safely bounded');
  const identity = [projectIdentity.projectId, projectIdentity.worktreeId, hookInput.session_id, hookInput.turn_id];
  const key = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  try {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true, mode: 0o700 });
    fs.writeFileSync(LEDGER + '.completion-correction.' + key, JSON.stringify({
      schema: 'completion-correction-reservation/v1', identity, verdict: completion.verdict,
      problems: completion.problems, at: new Date(nowMs).toISOString(),
      completionVerified: false, hostDeliveryVerified: false,
    }) + '\\n', { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    return advisory(error?.code === 'EEXIST' ? 'correction already reserved for this native turn'
      : 'correction reservation could not be persisted');
  }
}
const completionDeliveryAllowed = reserveCompletionCorrection();
const completionWork = completionDeliveryAllowed && `];
