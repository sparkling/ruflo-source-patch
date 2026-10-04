import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-policy-serialization-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = temporary;
process.env.RUFLO_GLOBAL_ROOT = path.join(temporary, 'global');
process.env.RUFLO_NPX_ROOT = path.join(temporary, 'npx');
process.env.RSP_CODEX_HOME = path.join(temporary, '.codex');
const patch = await import('../lib/ruflo-policy-serialization/patcher.mjs');
const { exercisePolicySerialization, policyHarness, policyFixture } = await import('../lib/ruflo-policy-serialization/exercise.mjs');
const { probePolicySerializationReplacement } = await import('../lib/ruflo-policy-serialization/probe.mjs');
const compose = await import('../lib/plugin-compose.mjs');
const write = (file, value) => {
  assert.ok(path.relative(temporary, file).split(path.sep)[0] !== '..' && file.startsWith(temporary + path.sep));
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
  assert.ok(fs.realpathSync(file).startsWith(temporary + path.sep), 'mutations stay inside isolated fixture');
};
try {
  assert.equal(patch.applicability().state, 'not-applicable');
  const rows = [];
  for (const name of ['policy-runtime.js', 'policy-runtime-async-legacy.js', 'policy-runtime-sync-legacy.js']) {
    const source = fs.readFileSync(new URL('./fixtures/ruflo-policy-serialization/' + name, import.meta.url), 'utf8');
    const result = patch.patchSource(source);
    assert.deepEqual(result.missing, []); assert.equal(patch.isPatched(result.next), true);
    assert.equal(patch.reverseSource(result.next), source);
    assert.deepEqual(patch.patchSource(result.next), { next: result.next, missing: [], applied: [] });
    await assert.rejects(exercisePolicySerialization(source), undefined, 'native full-ledger clone reproduced');
    await exercisePolicySerialization(result.next);
    for (const invalid of [source + source, result.next + result.next,
      source.replace('function stateAuthentication', 'function driftedAuthentication'),
      result.next.replace('JSON.stringify(engine.state)', 'JSON.stringify({ mode: engine.state.mode })')]) {
      assert.ok(patch.patchSource(invalid).missing.length); assert.equal(patch.patchSource(invalid).next, invalid);
    }
    for (const invalid of [
      result.next.replace('if (!engine.verifyLedger().valid)', 'if (false)'),
      result.next.replace('JSON.stringify(engine.state)', 'JSON.stringify({ mode: engine.state.mode })'),
      ...(source.includes('syncPolicyProjection') ? [result.next.replace('structuredClone({ mode: engine.state.mode, rules: engine.state.rules })', 'engine.state')] : []),
      result.next.replace('stateAuthentication(state, key, serialized)', 'stateAuthentication(state, key)'),
    ]) await assert.rejects(exercisePolicySerialization(invalid), undefined, 'semantic weakening rejected');
    const fixturePath = path.join(process.env.RUFLO_NPX_ROOT, name, 'node_modules/@claude-flow/cli/dist/src/services/policy-runtime.js');
    write(fixturePath, source); rows.push({ source, result, file: fixturePath });
  }
  const file = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src/services/policy-runtime.js');
  write(file, rows[0].source);
  assert.equal(patch.discover().length, 4); assert.equal(patch.preflight().ok, true);
  assert.equal(patch.applicability().state, 'applicable');
  assert.equal(probePolicySerializationReplacement().state, 'live');
  const installed = compose.applyComposed([patch.NAME]);
  assert.equal(installed.errors, 0, JSON.stringify(installed)); assert.equal(installed.incomplete, 0);
  assert.equal(installed.patched, 4); assert.equal(compose.applyComposed([patch.NAME]).patched, 0);
  assert.equal(probePolicySerializationReplacement({ installed: [patch.NAME] }).state, 'live', 'local patch cannot retire itself');
  write(file + '.rsp-backup', rows[0].source + '// foreign backup');
  assert.match(probePolicySerializationReplacement({ files: [file], installed: [patch.NAME] }).evidence, /composition/);
  write(file + '.rsp-backup', rows[0].source);
  write(file, rows[0].result.next + '// foreign marker-preserving change');
  assert.ok(compose.applyComposed([patch.NAME]).incomplete > 0, 'foreign live bytes cannot be overwritten');
  write(file, rows[0].result.next);
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), rows[0].source);
  for (const row of rows) assert.equal(fs.readFileSync(row.file, 'utf8'), row.source);
  for (const row of [...rows, { file, result: rows[0].result }])
    write(row.file, row.result.next.replaceAll(patch.PATCH_MARKER, 'native verified serialization'));
  assert.equal(probePolicySerializationReplacement().state, 'superseded', 'every genuine existing policy shape proven');
  write(rows[1].file, rows[1].source);
  assert.equal(probePolicySerializationReplacement().state, 'live', 'one old unfixed runtime prevents retirement');
  write(file, rows[0].source.replace('function stateAuthentication', 'function unknownAuthentication'));
  assert.equal(patch.preflight().ok, false); assert.ok(compose.applyComposed([patch.NAME]).incomplete > 0);
  // Public callback errors / unrepresentable state release the native lock without any receipt acknowledgment.
  const body = rows[0].result.next;
  const denied = policyHarness(body); await assert.rejects(denied.run(() => { throw new Error('authorization failed'); }), /authorization failed/);
  assert.equal(denied.writes.length, 0); assert.equal(denied.metrics().verifyCalls, 0); assert.equal(denied.metrics().releases, 1);
  const circular = policyFixture(); circular.self = circular;
  const invalid = policyHarness(body, { state: circular }); await assert.rejects(invalid.run(), /circular/i);
  assert.equal(invalid.writes.length, 0); assert.equal(invalid.metrics().releases, 1);
  console.log('ruflo-policy-serialization: complete immutable ledger, full validation, atomic HMAC ordering, failure handling, legacy copies, composition and retirement passed');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
