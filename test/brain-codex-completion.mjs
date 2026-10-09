// Brain 4.5.16 pristine audit fixture; Codex native event shape observed on 0.161/0.162.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchSource, reverseSource, isPatched, SPECS } from '../lib/brain-codex-completion/patcher.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-completion-'));
const pristine = fs.readFileSync(new URL('./fixtures/brain-codex-completion/completion-claim-evidence.mjs', import.meta.url), 'utf8');
const result = patchSource(pristine);
assert.deepEqual(result.missing, []);
assert.equal(isPatched(result.next), true);
assert.equal(reverseSource(result.next), pristine);
assert.equal(patchSource(result.next).next, result.next);
for (const s of [pristine + pristine, pristine.replace('export function readClaudeTurn', 'export function altered'),
  result.next.replace('pending.size', 'false')]) {
  assert.ok(patchSource(s).missing.length);
  assert.equal(patchSource(s).next, s);
}
const gate = SPECS[1].edits.map(([a]) => a).join('\n');
assert.deepEqual(patchSource(gate).missing, []);
assert.equal(reverseSource(patchSource(gate).next), gate);
assert.equal(isPatched(patchSource(gate).next), true);
fs.writeFileSync(path.join(root, 'turn-outcome-capture.mjs'), 'export const readSettledTranscript = () => [];');
fs.writeFileSync(path.join(root, 'pristine.mjs'), pristine);
fs.writeFileSync(path.join(root, 'patched.mjs'), result.next);
const before = await import(pathToFileURL(path.join(root, 'pristine.mjs')));
const after = await import(pathToFileURL(path.join(root, 'patched.mjs')));
const message = 'The targeted tests are passing.\nVerified: npm test.\nUnverified: browser behaviour.';
const start = { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } };
function item(id, type, fields = {}, started = 10, ended = 20, turn = 'turn-1') {
  return { type: 'event_msg', payload: { type: 'item_completed', turn_id: turn,
    started_at_ms: started, completed_at_ms: ended, item: { id, type, ...fields } } };
}
const edit = item('edit', 'FileChange');
const check = (fields = {}, started = 30, ended = 40) => item('check', 'CommandExecution', {
  command: ['/bin/zsh', '-lc', 'npm test'], status: 'completed', exit_code: 0,
  aggregated_output: '12 tests passed', ...fields,
}, started, ended);
const lines = rows => rows.map(r => typeof r === 'string' ? r : JSON.stringify(r));
const turn = rows => after.codexTurnEvents(lines(rows));
const audit = (rows, text = message) => after.auditCompletionClaims(text, { turn: turn(rows), host: 'codex' });
assert.equal(before.auditCompletionClaims(message, { host: 'codex' }).verdict, 'UNKNOWN');
assert.equal(audit([start, edit, check()]).verdict, 'OBSERVED_CHECK');
assert.equal(audit([start,
  { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'exec-1', name: 'exec' } },
  edit, check(),
  { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-1', output: 'complete' } },
]).verdict, 'OBSERVED_CHECK');
for (const rows of [
  [start, edit, check({ exit_code: 1 })], [start, edit, check({ status: 'inProgress' })],
  [start, edit, check({ aggregated_output: '' })], [start, edit, check({ exit_code: null })],
  [start, check({}, 1, 9), edit], [start, edit, check({}, 15, 40)],
  [start, check(), item('later', 'FileChange', {}, 45, 50)],
  [start, check(), item('unknown', 'NewNativeTool', {}, 45, 50)],
  [start, edit, check({ command: 'node arbitrary-script.mjs' })],
  [start, edit, check({ command: 'npm test; touch production' })],
  [start, edit, check({ command: 'npm test -- --updateSnapshot' })],
  [start, edit, check({ command: 'curl -X POST https://example.invalid' })],
]) assert.notEqual(audit(rows).verdict, 'OBSERVED_CHECK');
for (const rows of [
  [edit, check()], [start, '{broken', check()], [start, edit, check(), check()],
  [start, item('wrong', 'CommandExecution', { command: 'npm test' }, 30, 40, 'other-turn')],
  [start, check(), { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'pending', name: 'exec' } }],
  [start, item('bad-clock', 'CommandExecution', {}, 100, 1)],
]) assert.equal(turn(rows), null);
assert.equal(audit([start, edit, check(),
  item('failed-repeat', 'CommandExecution', { command: 'npm test', status: 'completed', exit_code: 1,
    aggregated_output: 'failure' }, 50, 60)]).verdict, 'UNKNOWN');
assert.equal(audit([start, edit, check()], 'The targeted tests are passing.').verdict, 'FAIL');
assert.equal(audit([start, edit, check()], 'Fixed.\nVerified: npm test.\nUnverified: browser.').verdict, 'UNKNOWN');
assert.equal(after.readCodexTurn('x.jsonl', { read: () => lines([start, edit, check()]) }).events.length, 2);
assert.equal(after.readCodexTurn('x.jsonl', { read: () => { throw Error('missing'); } }), null);
assert.equal(after.readCodexTurn('x.txt'), null);
// The existing Claude classifier and verdict are byte-identical and behave identically.
const claude = lines([
  { type: 'user', message: { content: 'run checks', role: 'user' } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', id: 'c', input: { command: 'npm test' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c', content: 'passed' }] } },
]);
assert.deepEqual(after.claudeTurnEvents(claude), before.claudeTurnEvents(claude));
assert.deepEqual(after.auditCompletionClaims(message, { turn: after.claudeTurnEvents(claude) }),
  before.auditCompletionClaims(message, { turn: before.claudeTurnEvents(claude) }));
fs.rmSync(root, { recursive: true, force: true });
console.log('Codex completion: pristine reproduction, scoped success, fail-closed cases, Claude parity and reversible anchors passed');
