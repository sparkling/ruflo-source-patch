import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-flywheel-evidence-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = temporary;
process.env.RUFLO_GLOBAL_ROOT = path.join(temporary, 'global');
process.env.RUFLO_NPX_ROOT = path.join(temporary, 'npx');
process.env.RSP_CODEX_HOME = path.join(temporary, '.codex');
const patch = await import('../lib/ruflo-flywheel-evidence/patcher.mjs');
const { exerciseFlywheelEvidence } = await import('../lib/ruflo-flywheel-evidence/exercise.mjs');
const { probeFlywheelEvidenceReplacement } = await import('../lib/ruflo-flywheel-evidence/probe.mjs');
const compose = await import('../lib/plugin-compose.mjs');
const write = (file, value) => {
  assert.ok(file.startsWith(temporary + path.sep));
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
};
try {
  assert.equal(patch.applicability().state, 'not-applicable');
  const legacy = JSON.parse(fs.readFileSync(new URL('./fixtures/ruflo-flywheel-evidence/3.38.19.json', import.meta.url)));
  assert.deepEqual(patch.patchSource(legacy['flywheel-receipt.js']), { next: legacy['flywheel-receipt.js'], missing: [], applied: [] });
  assert.equal(patch.reverseSource(legacy['flywheel-receipt.js']), legacy['flywheel-receipt.js']);
  assert.ok(patch.patchSource(legacy['flywheel-receipt.js'] + '// changed').missing.length);
  const url = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
  const oldApi = await import(url(legacy['flywheel-receipt.js'].replace("'./flywheel-sequential-evidence.js'", JSON.stringify(url(legacy['flywheel-sequential-evidence.js'])))));
  const { generateKeyPairSync } = await import('node:crypto');
  const keys = generateKeyPairSync('ed25519');
  const publicKeyPem = keys.publicKey.export({type:'spki',format:'pem'});
  const input = { candidatePolicy: { alpha: 0.3 }, baselineRef: 'b', safetyEnvelopeRef: 's',
    corpusVersion: 'fixture', corpusHash: 'sha256:fixture', baselineScore: 0.5, candidateScore: 0.7,
    heldOutDeltas: [0.2,0.2], frozenAnchorRegression: 0, gates: { evidence: true }, bootstrapIterations: 100,
    now: 1700000000000, lineageId: 'fixture', evaluationRunId: 'fixture', publicKeyPem,
    privateKeyPem: keys.privateKey.export({type:'pkcs8',format:'pem'}),
    evidence: {corpusRoles: {selectionTaskIds:['a'],promotionHoldoutTaskIds:['b'],guardTaskIds:['c']},
      verification: { nested: [{ score: 1/3 }] }, canary: { delta: -0.0125 }} };
  const legacyReceipt = oldApi.createFlywheelReceipt(input);
  assert.deepEqual(legacyReceipt.payload.evidence, input.evidence);
  assert.equal(oldApi.verifyFlywheelReceipt(legacyReceipt, new Set([publicKeyPem])).valid, true);
  legacyReceipt.payload.evidence.canary.delta = 0.9;
  assert.equal(oldApi.verifyFlywheelReceipt(legacyReceipt, new Set([publicKeyPem])).valid, false);

  const source = fs.readFileSync(new URL('./fixtures/ruflo-flywheel-evidence/flywheel-receipt.js', import.meta.url), 'utf8');
  const dependency = fs.readFileSync(new URL('./fixtures/ruflo-flywheel-evidence/flywheel-sequential-evidence.js', import.meta.url), 'utf8');
  await assert.rejects(exerciseFlywheelEvidence(source, dependency), /fractional number at \$\.evidence\.verification\.driftThreshold/);
  const result = patch.patchSource(source);
  assert.deepEqual(result.missing, []); assert.equal(patch.isPatched(result.next), true);
  assert.equal(patch.reverseSource(result.next), source);
  const verifier = 'export function verifyFlywheelReceipt';
  assert.equal(result.next.slice(result.next.indexOf(verifier)), source.slice(source.indexOf(verifier)), 'verifier bytes are unchanged');
  assert.deepEqual(patch.patchSource(result.next), { next: result.next, missing: [], applied: [] });
  await exerciseFlywheelEvidence(result.next, dependency);
  for (const invalid of [source + source, result.next + result.next,
    source.replace('evidence: input.evidence', 'evidence: changed.evidence'),
    result.next.replace('encodePolicyFractions(input.evidence', 'String(input.evidence')]) {
    assert.ok(patch.patchSource(invalid).missing.length); assert.equal(patch.patchSource(invalid).next, invalid);
  }
  const file = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src/services/flywheel-receipt.js');
  write(file, source); write(path.join(path.dirname(file), 'flywheel-sequential-evidence.js'), dependency);
  assert.equal(patch.preflight().ok, true); assert.equal(patch.applicability().state, 'applicable');
  assert.equal(probeFlywheelEvidenceReplacement().state, 'live');
  const installed = compose.applyComposed([patch.NAME]);
  assert.equal(installed.errors, 0, JSON.stringify(installed)); assert.equal(installed.incomplete, 0);
  assert.equal(installed.patched, 1); assert.equal(compose.applyComposed([patch.NAME]).patched, 0);
  assert.equal(probeFlywheelEvidenceReplacement({ installed: [patch.NAME] }).state, 'live', 'local patch cannot retire itself');
  write(file, result.next + '// unrelated live change');
  assert.ok(compose.applyComposed([patch.NAME]).incomplete > 0);
  assert.equal(fs.readFileSync(file, 'utf8'), result.next + '// unrelated live change', 'foreign live bytes preserved');
  write(file, result.next);
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), source, 'uninstall restores pristine');
  write(file, result.next.replaceAll(patch.PATCH_MARKER, 'native equivalent evidence encoding'));
  assert.equal(probeFlywheelEvidenceReplacement().state, 'superseded', 'retirement requires native protocol behavior');
  write(file, source.replace('evidence: input.evidence', 'evidence: changed.evidence'));
  assert.equal(patch.preflight().ok, false); assert.ok(compose.applyComposed([patch.NAME]).incomplete > 0);
  console.log('ruflo-flywheel-evidence: native repro, signed nested fractions, identities, strict/tamper refusal, preservation, idempotence, uninstall and behavioral retirement passed');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
