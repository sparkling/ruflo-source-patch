// Operator-authorized containment for Brain #390. No storage/updater/config mutation.
// Retire only after native mature-history/host-deadline acceptance or a native
// independently scoped progression opt-out is behaviorally proven; never on version alone.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
export const NAME = 'brain-progression-suspension';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#390)';
export const REASON = 'Automatic full-snapshot progression is suspended by the operator (Brain #390); existing records and pending work are retained, but no automatic capture or restoration is claimed.';
const insert = (anchor, body) => [anchor, anchor + `\n  // ${PATCH_MARKER}: reversible containment, never a persistence receipt.\n` + body];
export const SPECS = [
  { relative: 'scripts/project-transition-hook.mjs', edits: [insert(
    "  readHistory = readTransitionHistory, capture = runSessionSnapshotHook, env = process.env } = {}) {",
    `  return { state: 'suspended', reason: ${JSON.stringify(REASON)}, progressionCaptured: false, receipt: null };`),
  ] },
  { relative: 'scripts/session-snapshot-hook.mjs', edits: [insert(
    '  const idle = { metadataWritten, progressionCaptured: false, receipt: null, turn, continuity };',
    `  return { ...idle, progressionSuspended: true, skipped: ${JSON.stringify(REASON)} };`),
  ] },
  { relative: 'scripts/project-progression-session-start.mjs', edits: [insert(
    '  const projectDir = env.CLAUDE_PROJECT_DIR || cwd;',
    `  return { status: 'unavailable', reason: 'operator-suspended', severity: 'info',\n    context: ${JSON.stringify('[RuvNet Brain — AUTOMATIC PROGRESSION SUSPENDED]\n' + REASON)} };`),
  ] },
  { relative: 'scripts/project-capture-queue.mjs', edits: [
    insert('export function replayOutboxDetached({ projectDir, token = null, spawnFn = spawn } = {}) {', '  return false;'),
    insert('  captureNormalized = captureNormalizedTransition, onCaptured = null } = {}) {', '  return 0;'),
    insert('export function drainCaptureQueue({ projectDir, budgetMs = 1000, ...options } = {}) {',
      `  return { state: 'suspended', replayed: 0, pending: null, reason: ${JSON.stringify(REASON)} };`),
  ] },
  { relative: 'mcp/managed-cli-interface.mjs', edits: [
    insert('const MANAGED = new Set(MANAGED_EXECUTABLES);',
      "const RSP_PROGRESSION_SUSPENDED = Symbol('operator-suspended progression');"),
    insert("  if (!['claude', 'codex'].includes(host)) return { adopted: true, error: 'managed host identity unavailable' };",
      `  return { adopted: true, progressionCaptured: false, receipt: null,\n    policy: RSP_PROGRESSION_SUSPENDED, skipped: ${JSON.stringify(REASON)} };`),
    ['(beforeCapture?.adopted && beforeCapture.progressionCaptured !== true)',
      '(beforeCapture?.adopted && beforeCapture.policy !== RSP_PROGRESSION_SUSPENDED && beforeCapture.progressionCaptured !== true)'],
    ['if (afterCapture?.adopted && afterCapture.progressionCaptured !== true)',
      'if (afterCapture?.adopted && afterCapture.policy !== RSP_PROGRESSION_SUSPENDED && afterCapture.progressionCaptured !== true)'],
    ['      return resultOf(executable, argv, execution);',
      `      const result = resultOf(executable, argv, execution);\n      if (beforeCapture?.policy === RSP_PROGRESSION_SUSPENDED || afterCapture?.policy === RSP_PROGRESSION_SUSPENDED) {\n        result.content.push({ type: 'text', text: ${JSON.stringify(REASON)} });\n      }\n      return result;`],
  ] },
];
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
const matches = (source, patched) => SPECS.filter(spec => spec.edits.every(edit => count(source, edit[patched ? 1 : 0]) === 1));
export const isPatched = source => hasPatch(source) && matches(source, true).length === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const specs = matches(source, false);
  if (hasPatch(source) || specs.length !== 1) return { next: source, applied: [], missing: ['unique-native-progression-suspension-bundle'] };
  return { next: specs[0].edits.reduce((body, [from, to]) => body.replace(from, to), source), applied: [NAME], missing: [] };
}
export const reverseSource = source => SPECS.flatMap(spec => spec.edits).reduceRight((body, [from, to]) => body.replace(to, from), source);
export const surfaces = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: SPECS.map(spec => spec.relative) });
const members = surface => SPECS.filter(spec => surface.kind === 'full' || spec.relative.startsWith('mcp/'));
export const discover = () => surfaces().flatMap(surface => members(surface).map(spec => path.join(surface.root, spec.relative)));
export function preflight() {
  const errors = [];
  for (const surface of surfaces()) for (const spec of members(surface)) {
    const file = path.join(surface.root, spec.relative);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(surface.root, file) === null) throw Error('unsafe native member');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('native suspension anchors not proved');
    } catch (error) { errors.push(file + ': ' + error.message); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
