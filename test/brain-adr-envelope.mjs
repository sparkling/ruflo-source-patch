import assert from 'node:assert/strict';
import vm from 'node:vm';
import { SPECS, patchSource, reverseSource, isPatched } from '../lib/brain-adr-envelope/patcher.mjs';
for (const spec of SPECS) {
  const source = spec.edits.map(([from]) => from).join('\n');
  const patched = patchSource(source);
  assert.deepEqual(patched.missing, []);
  assert(isPatched(patched.next));
  assert.equal(reverseSource(patched.next), source);
  assert.equal(patchSource(patched.next).next, patched.next);
  assert(patchSource(source.replace('65536', '4096')).missing.length);
}
const evaluateEntry = text => vm.runInNewContext('({' + text + '})')["decision-gate"];
const oldEntry = evaluateEntry(SPECS[0].edits[0][0]);
const newEntry = evaluateEntry(SPECS[0].edits[0][1]);
assert.equal(newEntry.mode, oldEntry.mode);
assert.equal(newEntry.file, oldEntry.file);
assert.equal(newEntry.stdinBytes, 1048576);
// Path intentionally follows large content: prefix regex recovery cannot safely recover it.
const event = { cwd: '/fixture', tool_name: 'Edit', tool_input: { content: 'x'.repeat(100000), file_path: '/fixture/src/owned.mjs' } };
const bytes = Buffer.from(JSON.stringify(event));
assert.throws(() => JSON.parse(bytes.subarray(0, oldEntry.stdinBytes).toString()), SyntaxError);
assert.deepEqual(JSON.parse(bytes.subarray(0, newEntry.stdinBytes).toString()), event);
const huge = Buffer.from(JSON.stringify({ ...event, tool_input: { content: 'x'.repeat(1100000), file_path: '/fixture/src/owned.mjs' } }));
assert.throws(() => JSON.parse(huge.subarray(0, newEntry.stdinBytes).toString()), SyntaxError);
console.log('brain-adr-envelope: bounded large JSON repair, over-limit refusal and exact reversal passed');
