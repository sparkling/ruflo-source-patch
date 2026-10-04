// Brain #383: preserve immutable frozen captures when their historical key collides.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
export const NAME = 'brain-progression-collision';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#383)';
export const ERROR_CLASS = `// ${PATCH_MARKER}: only a validated independent exact read can authorize recovery.
export class ProgressionKeyCollisionError extends Error {
  constructor(attempted, stored) {
    super('progression readback digest mismatch');
    this.name = 'ProgressionKeyCollisionError';
    this.attempted = attempted;
    this.stored = stored;
  }
}

`;
export const STORE_ANCHOR = `    if (readback.payloadDigest !== snapshot.payloadDigest || digestCanonical(readback) !== digestCanonical(snapshot)) {
      throw new Error('progression readback digest mismatch');
    }`;
export const STORE_REPLACEMENT = `    if (readback.payloadDigest !== snapshot.payloadDigest || digestCanonical(readback) !== digestCanonical(snapshot)) {
      const verdict = validateProgressionSnapshot(readback, { expectedProjectIdentity: this.resolution.projectIdentity });
      if (!verdict.ok || readback.eventKey !== snapshot.eventKey) throw new Error('progression readback digest mismatch');
      throw new ProgressionKeyCollisionError(snapshot, readback);
    }`;
export const CAPTURE_ANCHOR = `  const receipt = store.capture(snapshot);
  verifyReceipt(snapshot, receipt);
  return { snapshot, receipt };`;
export const CAPTURE_REPLACEMENT = `  // ${PATCH_MARKER}: never overwrite or acknowledge the collided immutable key.
  let captured = snapshot;
  let receipt;
  try { receipt = store.capture(snapshot); }
  catch (error) {
    if (!(error instanceof ProgressionKeyCollisionError)) throw error;
    const existing = error.stored;
    const verdict = validateProgressionSnapshot(existing, { expectedProjectIdentity: store.resolution.projectIdentity });
    if (!verdict.ok || existing.eventKey !== snapshot.eventKey
      || digestCanonical(error.attempted) !== digestCanonical(snapshot)
      || existing.payloadDigest === snapshot.payloadDigest) throw error;
    if (own(snapshot.completeProjectState, 'identityRecovery')) throw error;
    captured = createProgressionSnapshot({
      ...snapshot,
      dedupId: snapshot.dedupId + ':collision:' + snapshot.payloadDigest + ':' + existing.payloadDigest,
      completeProjectState: {
        ...snapshot.completeProjectState,
        identityRecovery: {
          source: 'verified-immutable-key-collision', authoritative: false,
          originalEventKey: snapshot.eventKey,
          originalPayloadDigest: snapshot.payloadDigest,
          existingPayloadDigest: existing.payloadDigest,
        },
      },
    });
    receipt = store.capture(captured);
  }
  verifyReceipt(captured, receipt);
  return { snapshot: captured, receipt };`;
export const PRODUCER_ANCHOR = '  const projectProgression = redactedProgression;';
export const PRODUCER_REPLACEMENT = `  // ${PATCH_MARKER}: deferred boundaries can share a committed sequence, never a content identity.
  redactedProgression.dedupId += ':content:' + digestCanonical({
    canonicalAgentDbPath: redactedProgression.canonicalAgentDbPath,
    sourceIdentity: redactedProgression.sourceIdentity,
    sequence: redactedProgression.sequence,
    occurredAt: redactedProgression.occurredAt,
    parentEventKeys: redactedProgression.parentEventKeys,
    completeProjectState: redactedProgression.completeProjectState,
    nativeInputIdentity: redactProgression({
      tool_name: payload.tool_name ?? null, tool_input: payload.tool_input ?? null,
      tool_response: payload.tool_response ?? null, observation: payload.observation ?? null,
    }).value,
  });
  const projectProgression = redactedProgression;`;
export const SPECS = [
  { relative: 'scripts/project-progression-store.mjs', edits: [
    ['typed-native-collision', 'export class ProjectProgressionStore {', `${ERROR_CLASS}export class ProjectProgressionStore {`],
    ['validated-independent-read', STORE_ANCHOR, STORE_REPLACEMENT],
  ] },
  { relative: 'scripts/project-progression-hook.mjs', edits: [
    ['native-contract-validation', "import { createProgressionSnapshot } from './project-progression-contract.mjs';",
      "import { createProgressionSnapshot, digestCanonical, validateProgressionSnapshot } from './project-progression-contract.mjs';"],
    ['typed-collision-owner', "import { ProjectProgressionStore } from './project-progression-store.mjs';",
      "import { ProjectProgressionStore, ProgressionKeyCollisionError } from './project-progression-store.mjs';"],
    ['immutable-recovery-receipt', CAPTURE_ANCHOR, CAPTURE_REPLACEMENT],
  ] },
  { relative: 'scripts/project-progression-producer.mjs', edits: [
    ['content-bound-deferred-identity', PRODUCER_ANCHOR, PRODUCER_REPLACEMENT],
  ] },
];
const count = (source, text) => source.split(text).length - 1;
function selected(source, patched) {
  return SPECS.filter(spec => spec.edits.every(([, from, to]) => count(source, patched ? to : from) === 1
    && (!patched || to.includes(from) || !source.includes(from))));
}
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => hasPatch(source) && selected(source, true).length === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const matches = selected(source, false);
  if (hasPatch(source) || matches.length !== 1) return { next: source, applied: [], missing: ['unique-native-progression-collision-bundle'] };
  return { next: matches[0].edits.reduce((body, [, from, to]) => body.replace(from, to), source),
    applied: matches[0].edits.map(([id]) => id), missing: [] };
}
export const reverseSource = source => SPECS.flatMap(spec => spec.edits).reduceRight((body, [, from, to]) => body.replace(to, from), source);
export const surfaces = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: SPECS.map(spec => spec.relative) });
export const discover = () => surfaces().flatMap(surface => SPECS.map(spec => path.join(surface.root, spec.relative)));
export function preflight() {
  const errors = [];
  for (const surface of surfaces()) for (const spec of SPECS) {
    const file = path.join(surface.root, spec.relative);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(surface.root, file) === null) {
        throw new Error('absent, empty or unsafe native progression member');
      }
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw new Error('native progression collision anchors do not match');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
