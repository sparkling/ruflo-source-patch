// Brain #520: verify an existing immutable turn using its original committed capture time.
// The native constructor must reproduce both full values; no field stripping or replay.
import path from 'node:path';
import crypto from 'node:crypto';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';

export const NAME = 'brain-capture-idempotency';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#520 committed-turn)';
const readBoundary = '/** Exact (namespace, key, content) readback. Exit zero alone never proves capture. */';
const helper = `// ${PATCH_MARKER}: original committed bytes remain authoritative.
function committedTurnEvidence(recipe, requested, stored) {
  if (!recipe || typeof recipe.project !== 'string' || typeof recipe.host !== 'string'
    || typeof recipe.turn?.finalText !== 'string' || !Array.isArray(recipe.turn?.files)
    || !Array.isArray(recipe.turn?.actions) || typeof requested !== 'string' || typeof stored !== 'string') return null;
  const captureTime = value => {
    const match = /^\\[turn (\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z) project=/.exec(value);
    if (!match) return null;
    try { return new Date(match[1]).toISOString() === match[1] ? match[1] : null; } catch { return null; }
  };
  const requestedAt = captureTime(requested), committedAt = captureTime(stored);
  if (!requestedAt || !committedAt) return null;
  try {
    const definition = { turn: recipe.turn, project: recipe.project, host: recipe.host, session: recipe.session };
    if (buildTurnRecord({ ...definition, at: new Date(requestedAt) }) !== requested
      || buildTurnRecord({ ...definition, at: new Date(committedAt) }) !== stored) return null;
    return { alreadyRecorded: true, committedAt, committedValueSha256: digest(stored) };
  } catch { return null; }
}

${readBoundary}`;
export const EDITS = [
  ['native-construction-input', "steps.push({ ...binding, kind: 'store', ruflo, args:",
    "steps.push({ ...binding, kind: 'store', ruflo, turnRecord: { turn, project, host, session: payload.session_id }, args:"],
  ['committed-record-proof', readBoundary, helper],
  ['retain-single-read', '  const run = (binary, args, options) => {',
    `  let lastTurnReadback = null;
  const nativeRead = read;
  read = options => {
    let result;
    const value = nativeRead({ ...options, run: (...args) => (result = options.run(...args)) });
    // Native value-only output is unframed when piped; preserve its complete bytes.
    lastTurnReadback = nativeRead !== readBack ? value
      : result?.status === 0 && !result.error && !result.signal ? String(result.stdout || '') : null;
    return lastTurnReadback;
  };
  const run = (binary, args, options) => {`],
  ['reset-read-evidence', '  for (const queued of steps) {',
    '  for (const queued of steps) {\n    lastTurnReadback = null; let committedTurn = null;'],
  ['verify-original-commit', "      if (kind === 'distill' && status === 0) {",
    `      if (duplicate && !r.error && !r.signal) {
        committedTurn = committedTurnEvidence(queued.turnRecord, value, lastTurnReadback);
        if (committedTurn) { verified = true; status = 0; }
      }
      if (kind === 'distill' && status === 0) {`],
  ['committed-receipt', "      ...(kind === 'store' ? { verified } : {}), ...(skipped ? { skipped } : {}) };",
    "      ...(kind === 'store' ? { verified } : {}), ...(committedTurn || {}), ...(skipped ? { skipped } : {}) };"],
  ['committed-report-value', '      Object.assign(report, { recorded: row?.verified === true, receipt: row });',
    `      Object.assign(report, { recorded: row?.verified === true, receipt: row });
      if (row?.verified && row.alreadyRecorded === true) Object.assign(report, {
        alreadyRecorded: true,
        value: buildTurnRecord({ ...store[0].turnRecord, at: new Date(row.committedAt) }),
      });`],
];
const count = (source, text) => source.split(text).length - 1;
const nativeConstructor = source => {
  const matches = source.match(/export function buildTurnRecord\([\s\S]*?\n\}/g) || [];
  return matches.length === 1 && crypto.createHash('sha256').update(matches[0]).digest('hex')
    === '6cf0f3f5191e62a8d77acf953a98b139a45ae6253dcb8200b10c8beda61d19c1';
};
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => nativeConstructor(source) && count(source, PATCH_MARKER) === 1 && EDITS.every(([, , to]) => count(source, to) === 1);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || !nativeConstructor(source)
    || !EDITS.every(([, from]) => count(source, from) === 1))
    return { next: source, applied: [], missing: ['unique-native-turn-commit-boundary'] };
  return { next: EDITS.reduce((text, [, from, to]) => text.replace(from, () => to), source),
    applied: EDITS.map(([id]) => id), missing: [] };
}
export const reverseSource = source => !isPatched(source) ? source
  : EDITS.reduceRight((text, [, from, to]) => text.replace(to, () => from), source);
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: ['scripts/turn-outcome-capture.mjs'],
}).filter(surface => surface.kind === 'full').map(surface => path.join(surface.root, 'scripts/turn-outcome-capture.mjs'));
// Retire only after native duplicate + original-value readback proves the same complete record,
// exposes the original committed identity, and rejects unavailable reads or changed content.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource };
