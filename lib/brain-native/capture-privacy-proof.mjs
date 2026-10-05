// Public v4.5.10 privacy implementation under proof; policy lookup and durable
// stores are inert fixture boundaries. Never import a live Brain memory owner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { reviewedBoundary } from './reviewed-source.mjs';

const PRIVACY_HASH = 'd495620afc8396eeabf9f23dbcbf85705213e8c05f7ae364bd58618871daf3d4';
const NORMALIZER_HASH = 'ee9f4306d21e08f6100e06860169cd2c2a72c606d8aa45a9fe08423e941581b9';
const NORMALIZER_START = 'export const GROK_TOOL_ALIASES =';
const NORMALIZER_END = '/** The raw payload TEXT';
const digest = source => crypto.createHash('sha256').update(source).digest('hex');
const clean = source => source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '');
// The public 4.5.10/11 parser documents a different binary named
// `ruflo-source-patch`. That prose grants no ownership to any local patch.
export const isReviewedNativeCaptureNormalizer = source => typeof source === 'string'
  && digest(source) === '71cbfd3d39ac59ad0d1ee720c978f52534ba85111647aee983991b80c073490b';

export function readCapturePrivacySources(read) {
  const privacy = read('scripts/turn-capture-privacy.mjs');
  const source = read('scripts/hook-input.mjs');
  if (!reviewedBoundary(source, NORMALIZER_START, NORMALIZER_END, NORMALIZER_HASH))
    throw Error('native capture normalizer boundary is not reviewed');
  // Only the actual imported normalizer and its dependencies are exercised.
  const normalizer = source.slice(source.indexOf(NORMALIZER_START), source.indexOf(NORMALIZER_END));
  verifySources({ privacy, normalizer });
  return { privacy, normalizer };
}

function verifySources({ privacy, normalizer }) {
  if (digest(privacy) !== PRIVACY_HASH || digest(normalizer) !== NORMALIZER_HASH)
    throw Error('native capture privacy dependency bytes are not reviewed');
}

export function stageCapturePrivacy(scripts, sources) {
  verifySources(sources);
  fs.writeFileSync(path.join(scripts, 'turn-capture-privacy.mjs'), sources.privacy, { mode: 0o600 });
  fs.writeFileSync(path.join(scripts, 'hook-input.mjs'), sources.normalizer, { mode: 0o600 });
  // The live resolver can open canonical memory. Replace ONLY that policy
  // lookup boundary, applying the real native exclusion parser to fixture input.
  fs.writeFileSync(path.join(scripts, 'turn-outcome-capture.mjs'),
    `import { contentPathExcludes } from './turn-capture-privacy.mjs';
export function resolveTurnDb(){const p=globalThis.rspPrivacyFixture||{};return {
  ...p,contentPathExcludes:contentPathExcludes(p.contentPathExcludes)
};}\n`, { mode: 0o600 });
}

export function evaluateCapturePrivacy(sources) {
  verifySources(sources);
  const normalize = new Function(clean(sources.normalizer) + '\nreturn normalizeHostEvent;')();
  return new Function('fs', 'path', 'crypto', 'redactText', 'normalizeHostEvent', clean(sources.privacy)
    + '\nreturn {contentPathExcludes,pathIsExcluded,privateTransitionObservation,privateProgressionState};')(
    fs, path, crypto, () => { throw Error('unused redaction boundary executed'); }, normalize);
}

export function exercisePrivateCapture({ capture, produce, projectDir, resolution, sourceIdentity, state }) {
  const saved = globalThis.rspPrivacyFixture;
  const excluded = path.join(projectDir, 'private'), resource = path.join(excluded, 'data.txt');
  const sensitive = 'private fixture output must not survive';
  let writes = 0;
  const store = { resolution, capture(snapshot) {
    writes++;
    return { eventKey: snapshot.eventKey, payloadDigest: snapshot.payloadDigest, readbackDigest: snapshot.payloadDigest };
  }, captureFrozen() { throw Error('private frozen capture reached a durable writer'); } };
  const payload = (input = { command: 'cat ' + resource }, response = {
    exit_code: 23, stdout: sensitive, stderr: sensitive, error: sensitive, signal: 'SIGTERM',
  }) => ({ session_id: 'privacy-fixture', hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: input, tool_response: response, projectProgression: {
      canonicalAgentDbPath: resolution.canonicalAgentDbPath, sourceIdentity,
      sequence: 100, occurredAt: '2026-10-05T13:00:00.000Z', parentEventKeys: [],
      dedupId: 'privacy-fixture', completeProjectState: state,
    } });
  const call = (event, extra = {}) => capture({ host: 'codex', projectDir, adapterVersion: '4.5.10',
    payload: event, storeFactory: () => store, ...extra });
  try {
    globalThis.rspPrivacyFixture = { contentPathExcludes: [excluded] };
    for (const input of [{ command: 'cat ' + resource }, { file_path: resource },
      { command: 'x'.repeat(5000) + ' ' + resource }]) {
      const event = payload(input), result = call(event), row = result.snapshot.completeProjectState.commands.at(-1);
      assert.equal(row.outcome, 'failure', 'privacy preserves the observed terminal outcome');
      assert.equal(row.exitCode, 23);
      assert.equal(row.signal, '[REDACTED:excluded-resource-output]');
      assert.equal(row.stdout, '[REDACTED:excluded-resource-output]');
      assert(!JSON.stringify(result).includes(sensitive));
      assert(!JSON.stringify(result).includes(resource));
      assert.deepEqual(result.snapshot.sourceIdentity, { ...sourceIdentity, capturePath: fs.realpathSync(projectDir) },
        'privacy cannot rewrite canonical source provenance');
      if (produce) {
        const produced = produce(event);
        assert(!produced.skipped, 'a private terminal event is still an observed action');
        assert(!JSON.stringify(produced).includes(resource));
        assert(!JSON.stringify(produced).includes(sensitive));
      }
    }
    const plain = call(payload({ command: 'cat ' + resource }, sensitive));
    assert.equal(plain.snapshot.completeProjectState.commands.at(-1).result, '[REDACTED:excluded-resource-output]');
    const frozen = payload({ command: 'public fixture command' });
    frozen.projectProgression.completeProjectState = { ...state, currentGoal: 'Review ' + resource };
    const before = writes;
    assert.throws(() => call(frozen, { recoverFrozen: true, canCommit: () => true }), /frozen snapshot retained/);
    assert.equal(writes, before, 'changed privacy cannot replace frozen evidence');
    for (const skipped of ['project opted out', 'consent unavailable']) {
      globalThis.rspPrivacyFixture = { skipped };
      assert.throws(() => call(payload()), new RegExp(skipped));
      if (produce) assert.equal(produce(payload()).skipped.reason, skipped);
      assert.equal(writes, before, 'missing consent cannot reach durable capture');
    }
    globalThis.rspPrivacyFixture = { contentPathExcludes: ['../unsafe'] };
    assert.throws(() => call(payload()), /must be rooted/);
    assert.equal(writes, before, 'invalid exclusion configuration fails closed');
    return { excludedInputAndOutput: true, unboundedOriginalInputChecked: true,
      frozenEvidenceRetained: true, consentRefusal: true, nativeOutcomesPreserved: true };
  } finally { globalThis.rspPrivacyFixture = saved; }
}
