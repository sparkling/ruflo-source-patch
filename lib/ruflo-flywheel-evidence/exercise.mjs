// Native protocol execution only: no CLI startup, databases, or external services.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
export async function exerciseFlywheelEvidence(source, dependency) {
  const api = await import(moduleUrl(source.replace("'./flywheel-sequential-evidence.js'", JSON.stringify(moduleUrl(dependency)))));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const input = {
    candidatePolicy: { alpha: 0.3, count: 8 }, baselineRef: 'baseline',
    safetyEnvelopeRef: 'safety', corpusVersion: 'fixture', corpusHash: 'sha256:fixture',
    baselineScore: 0.5, candidateScore: 0.7, heldOutDeltas: [0.2, 0.2], frozenAnchorRegression: 0,
    gates: { evidence: true }, bootstrapIterations: 100, now: 1700000000000,
    lineageId: 'fixed-lineage', evaluationRunId: 'fixed-evaluation', privateKeyPem, publicKeyPem,
    evidence: {
      corpusRoles: { selectionTaskIds: ['a'], promotionHoldoutTaskIds: ['b'], guardTaskIds: ['c'] },
      verification: { driftThreshold: 0.1, nested: [{ score: 1 / 3, count: 2, label: 'retain' }], success: false },
      canary: { delta: -0.0125, zero: 0, string: '0.050000000000', empty: null },
    },
  };
  const snapshot = structuredClone(input);
  const receipt = api.createFlywheelReceipt(input);
  assert.deepEqual(input, snapshot, 'producer cannot mutate input evidence');
  assert.equal(receipt.payload.evidence.verification.driftThreshold, '0.1');
  assert.equal(receipt.payload.evidence.verification.nested[0].score, '0.333333333333');
  assert.equal(receipt.payload.evidence.verification.nested[0].count, 2);
  assert.equal(receipt.payload.evidence.verification.success, false);
  assert.deepEqual(receipt.payload.evidence.corpusRoles, input.evidence.corpusRoles);
  assert.deepEqual(receipt.payload.evidence.canary, { delta: '-0.0125', zero: 0, string: '0.050000000000', empty: null });
  assert.equal(receipt.payload.decision, 'accepted');
  assert.equal(api.verifyFlywheelReceipt(receipt, new Set([publicKeyPem])).valid, true);
  assert.deepEqual(api.createFlywheelReceipt({ ...input, evidence: receipt.payload.evidence }), receipt, 'encoding is idempotent before hashing/signing');
  assert.deepEqual(api.createFlywheelReceipt(input), receipt, 'deterministic receipt identity/signature');
  const rejected = api.createFlywheelReceipt({ ...input, gates: { evidence: false } });
  assert.equal(rejected.payload.decision, 'rejected');
  assert.equal(api.verifyFlywheelReceipt(rejected, new Set([publicKeyPem])).valid, true);
  const tampered = structuredClone(receipt); tampered.payload.evidence.canary.delta = '0.99';
  const verdict = api.verifyFlywheelReceipt(tampered, new Set([publicKeyPem]));
  assert.equal(verdict.valid, false); assert.ok(verdict.errors.includes('receipt signature invalid'));
  assert.ok(verdict.errors.includes('receipt content ID mismatch'));
  const raw = structuredClone(receipt); raw.payload.evidence.verification.driftThreshold = 0.1;
  assert.match(api.verifyFlywheelReceipt(raw).errors.join(' '), /fractional number/);
  assert.equal(api.verifyFlywheelReceipt(receipt, new Set()).valid, false, 'untrusted signer refused');
  for (const invalid of [NaN, Infinity, -Infinity])
    assert.throws(() => api.createFlywheelReceipt({ ...input, evidence: { ...input.evidence, verification: { invalid } } }), /finite/);
  assert.throws(() => api.createFlywheelReceipt({ ...input, evidence: { ...input.evidence, canary: { invalid: undefined } } }), /undefined/);
  const unknown = api.createFlywheelReceipt({ ...input, evidence: { ...input.evidence, unknown: true } });
  assert.equal(api.verifyFlywheelReceipt(unknown).valid, false, 'closed field contract preserved');
  const negativeZero = api.createFlywheelReceipt({ ...input, evidence: { ...input.evidence, canary: { zero: -0 } } });
  assert.equal(negativeZero.payload.evidence.canary.zero, '0');
  assert.equal(api.verifyFlywheelReceipt(negativeZero, new Set([publicKeyPem])).valid, true);
  const defaults = api.createFlywheelReceipt({ ...input, evidence: undefined });
  assert.equal(api.verifyFlywheelReceipt(defaults, new Set([publicKeyPem])).valid, true);
  return { signed: true, valid: true, numberDomainEnforced: true, tamperRefused: true };
}
