import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { discover, hasPatch } from './patcher.mjs';

export function exerciseSummary(source) {
  const begin = source.indexOf('function requirePositiveInteger(');
  const end = source.indexOf('function validatePage(', begin);
  if (begin < 0 || end < 0) throw Error('native summary boundaries missing');
  const body = source.slice(begin, end).replace('export function ', 'function ');
  const digestCanonical = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const payload = { schema: 'ruvnet-brain.project-resume', schemaVersion: 1,
    projectIdentity: { id: 'fixture' }, heads: ['exact-head'], evidence: {}, state: {
      currentGoal: 'Keep the exact goal', nextAction: 'Keep the exact action',
      observations: Array.from({ length: 160 }, (_, i) => ({ id: i, text: '雪'.repeat(200) })),
      resumeConflicts: Array.from({ length: 109 }, (_, i) => ({ field: i % 2 ? 'observations' : 'sourceIdentity',
        values: [{ value: 'first-' + i }, { value: 'second-' + i }] })),
    } };
  const run = (input, limit = 7742) => vm.runInNewContext(body
    + '\nprojectResumePayloadToBound(input, limit)',
  { input, limit, Buffer, structuredClone, digestCanonical }, { timeout: 1000 });
  const original = JSON.stringify(payload), result = run(payload);
  assert(result, 'optional observations and repeated conflict metadata must fit');
  assert(Buffer.byteLength(result.rendered) <= 7742);
  assert.equal(JSON.stringify(payload), original, 'source evidence must not mutate');
  assert.equal(result.payload.state.currentGoal, payload.state.currentGoal);
  assert.equal(result.payload.state.nextAction, payload.state.nextAction);
  assert.equal(JSON.stringify(result.payload.heads), JSON.stringify(payload.heads));
  const observations = result.payload.state.observations;
  assert.equal(observations.omitted, true);
  assert.equal(observations.count, payload.state.observations.length);
  assert.equal(observations.sha256, digestCanonical(payload.state.observations));
  const conflicts = result.payload.state.resumeConflicts;
  assert.equal(conflicts.length, 2);
  for (const conflict of conflicts) {
    const rows = payload.state.resumeConflicts.filter(row => row.field === conflict.field);
    const summaries = rows.map(row => ({ field: row.field, valueCount: row.values.length,
      valuesDigest: digestCanonical(row.values) }));
    assert.equal(conflict.omitted, true);
    assert.equal(conflict.conflictCount, rows.length);
    assert.equal(conflict.valueCount, rows.length * 2);
    assert.equal(conflict.summariesDigest, digestCanonical(summaries));
  }
  for (const field of ['currentGoal', 'nextAction']) {
    assert.equal(run({ ...payload, state: { ...payload.state, [field]: 'x'.repeat(9000) } }), null,
      'oversized mandatory field still refuses');
  }
  const small = { ...payload, state: { ...payload.state, observations: [], resumeConflicts: [] } };
  const smallResult = run(small);
  assert.equal(JSON.stringify(smallResult.payload.state), JSON.stringify(small.state));
  assert.throws(() => run(small, -1), /positive safe integer/);
  return { bytes: Buffer.byteLength(result.rendered), conflictFields: conflicts.length, preserved: true };
}

export function brainContinuitySummarySupersession() {
  return { issue: 'https://github.com/stuinfla/ruvnet-brain/issues/389',
    replacement: 'native bounded optional observations and explicit grouped conflict evidence',
    check() {
      try {
        const files = discover();
        if (!files.length) return { state: 'unknown', evidence: 'no installed native store' };
        for (const file of files) {
          const source = fs.readFileSync(file, 'utf8');
          if (hasPatch(source)) return { state: 'live', evidence: 'local summary patch is not native retirement proof' };
          exerciseSummary(source);
        }
        return { state: 'superseded', evidence: `all ${files.length} native summaries preserve mandatory values and bounded optional evidence` };
      } catch (error) { return { state: 'live', evidence: error.message }; }
    } };
}
