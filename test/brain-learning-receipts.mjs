import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EDITS, patchSource, reverseSource, isPatched } from '../lib/brain-learning-receipts/patcher.mjs';

// Exercise the native producer/child boundaries without a live memory driver.
const fixture = `function parent() {
${EDITS[0][1]} '--observe', {});
}
function child(o) {
${EDITS[1][1]}
}`;
const patched = patchSource(fixture);
assert.deepEqual(patched.missing, []);
assert(isPatched(patched.next));
assert.equal(reverseSource(patched.next), fixture);
assert.equal(patchSource(patched.next).next, patched.next);
assert(patchSource(fixture.replace('14_000', '15_000')).missing.length);
assert(patchSource(fixture + EDITS[0][1]).missing.length);

let fail = true, marks = 0, submitted = 0, writes = 0;
const context = vm.createContext({ binary: 'inert', context: { enabled: true },
  brainHome: '/inert', key: 'key', process: { env: {} },
  defaultBrainHome: () => '/inert', observationKey: () => 'key',
  learningContext: () => ({ enabled: true }),
  markCaptured: () => marks++, detachLearning: () => { submitted++; return true; },
  recordLearningObservation: () => { writes++; if (fail) throw Error('exact readback unavailable'); },
});
vm.runInContext(patched.next, context, { timeout: 1000 });
assert.equal(vm.runInContext('parent()', context), true);
assert.equal(submitted, 1);
assert.equal(marks, 0, 'submission is not a successful capture');
assert.throws(() => vm.runInContext("child({tool:'Bash', action:'git status', session:'s'})", context));
assert.equal(marks, 0, 'uncertain/failed write cannot suppress later capture');
fail = false;
vm.runInContext("child({tool:'Bash', action:'git status', session:'s'})", context);
assert.equal(writes, 2);
assert.equal(marks, 1, 'only a verified write creates a marker');
console.log('brain-learning-receipts: passed');
