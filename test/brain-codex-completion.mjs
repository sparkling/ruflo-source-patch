// Completion disabling is one gate change; obsolete implementations are deleted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { patchSource, reverseSource, isPatched, ANCHOR, REPLACEMENT } from '../lib/brain-codex-completion/patcher.mjs';
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
for (const bad of [gate + gate, gate.replace(ANCHOR, 'const modified = (() => {'),
  result.next.replace("verdict: 'NONE'", "verdict: 'PASS'")]) {
  assert.ok(patchSource(bad).missing.length);
  assert.equal(patchSource(bad).next, bad);
}
assert.ok(!result.next.includes('completion-correction-reservation'));
assert.equal(isPatched('// ruflo-source-patch (stuinfla/ruvnet-brain#423)\n' + evidence), false);
assert.ok(patchSource('// ruflo-source-patch (stuinfla/ruvnet-brain#423)\n' + gate).missing.length);
console.log('Completion disable: audit unreachable, other gates preserved, native evidence preserved, reversal and drift refusal passed');
