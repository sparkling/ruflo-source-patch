// Completion disabling is one gate change; historical parser bytes are migration-only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { patchSource, reverseSource, isPatched, historicalPatchSource, recover, ANCHOR, REPLACEMENT } from '../lib/brain-codex-completion/patcher.mjs';
import * as previous from '../lib/brain-codex-completion/migration-v44644.mjs';
const evidence = fs.readFileSync(new URL('./fixtures/brain-codex-completion/completion-claim-evidence.mjs', import.meta.url), 'utf8');
const gate = `const completion = (() => {\n  return auditCompletionClaims();\n})();\notherGate(completion);`;
const result = patchSource(gate);
assert.deepEqual(result.missing, []);
assert.equal(result.next, gate.replace(ANCHOR, REPLACEMENT));
assert.equal(reverseSource(result.next), gate);
assert.equal(patchSource(result.next).next, result.next);
assert.equal(isPatched(result.next), true);
let audits = 0, other = 0;
vm.runInNewContext(result.next, { auditCompletionClaims() { audits++; throw Error('must not run'); },
  otherGate(value) { other++; assert.equal(value.verdict, 'NONE'); assert.equal(value.claims.length, 0); } });
assert.equal(audits, 0);
assert.equal(other, 1);
assert.equal(patchSource(evidence).next, evidence);
assert.equal(isPatched(evidence), true);
for (const old of [previous.patchSource(evidence).next, previous.historicalPatchSource(evidence).next]) {
  assert.equal(patchSource(old).next, evidence);
  assert.equal(reverseSource(old), evidence);
  assert.equal(historicalPatchSource(evidence, old).next, old);
  const proof = recover(old);
  assert.equal(proof.candidate, evidence);
  assert.equal(proof.verify(evidence), old);
}
// Old gate import/adapter/diagnostics disappear before the one disabling edit is applied.
const oldGate = previous.SPECS[1].edits.map(([a]) => a).join('\n') + '\n' + gate;
for (const old of [previous.patchSource(oldGate).next, previous.historicalPatchSource(oldGate).next,
  previous.patchSource(oldGate).next.replace(...previous.DELIVERY_EDIT)]) {
  const next = patchSource(old);
  assert.deepEqual(next.missing, []);
  assert.equal(next.next, oldGate.replace(ANCHOR, REPLACEMENT));
  assert.equal(reverseSource(next.next), oldGate);
  assert.equal(historicalPatchSource(oldGate, old).next, old);
}
for (const bad of [gate + gate, gate.replace(ANCHOR, 'const modified = (() => {'),
  previous.patchSource(evidence).next.replace('pending.size', 'false'),
  result.next.replace("verdict: 'NONE'", "verdict: 'PASS'")]) {
  assert.ok(patchSource(bad).missing.length);
  assert.equal(patchSource(bad).next, bad);
}
assert.ok(!result.next.includes('completion-correction-reservation'));
assert.ok(!patchSource(previous.patchSource(evidence).next).next.includes('readCodexTurn'));
console.log('Completion disable: audit unreachable, other gates preserved, evidence restored, historical upgrades/reversal and drift refusal passed');
