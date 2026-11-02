import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { patchSource, reverseSource, isPatched } from '../lib/brain-learning-native-owner/patcher.mjs';

const source = fs.readFileSync(new URL('./fixtures/brain-learning-native-owner/native-4.7.28.mjs', import.meta.url), 'utf8');
const patched = patchSource(source);
assert.deepEqual(patched.missing, []);
assert(isPatched(patched.next));
assert.equal(reverseSource(patched.next), source);
assert.equal(patchSource(patched.next).next, patched.next);
assert(patchSource(source.replace("'--no-upsert'", "'--changed'")).missing.length);

function exercise(body, mode = 'ok', consent = true) {
  const fn = body.match(/export function recordLearningObservation\([\s\S]*?\n\}/)[0];
  const calls = [];
  let value;
  const env = { RETAIN: 'yes' };
  const sandbox = vm.createContext({ createHash, process: { env: {} },
    learningTarget: () => '/existing/memory.db', observationKey: () => 'key',
    LEARNING_NAMESPACE: 'learning-observations', captureFailureReason: r => r.stderr || 'refused',
    runLearningRuflo(binary, args, db, options) {
      calls.push({ args, db, options });
      assert.equal(options.env.RETAIN, 'yes');
      if (args[1] === 'store') {
        value = args[args.indexOf('--value') + 1];
        // Another process owns the vector companion. Only the existing native
        // lightweight route can write; raw-image fallback is never allowed.
        if (options.env.RUFLO_BRIDGE_MEMORY_ENTRIES_ONLY !== '1' || !args.includes('--require-native'))
          return { status: 1, stderr: 'vector companion already open' };
        assert(args.includes('--no-upsert'));
        return { status: mode === 'write-failure' ? 1 : 0, stderr: 'native write refused' };
      }
      assert.equal(args[1], 'retrieve');
      assert.equal(options.env.RUFLO_BRIDGE_MEMORY_ENTRIES_ONLY, '1');
      return { status: mode === 'write-failure' ? 1 : 0,
        stdout: mode === 'readback-mismatch' ? 'wrong value' : value };
    },
  });
  vm.runInContext(fn.replace('export ', ''), sandbox);
  const run = () => sandbox.recordLearningObservation('ruflo', {},
    { tool: 'verification', action: 'capture', session: 'test' },
    { env, deadline: 123, allowed: () => consent });
  return { run, calls, env };
}
assert.throws(exercise(source).run); // reproduces the observed concurrent owner failure
const success = exercise(patched.next);
assert.equal(success.run().exactCli, true);
assert.equal(success.calls.length, 2);
assert.equal(success.calls[0].options.deadline, 123);
assert.deepEqual(success.env, { RETAIN: 'yes' });
assert.throws(exercise(patched.next, 'write-failure').run, /refused/);
assert.throws(exercise(patched.next, 'readback-mismatch').run, /readback/);
const withdrawn = exercise(patched.next, 'ok', false);
assert.throws(withdrawn.run, /consent/);
assert.equal(withdrawn.calls.length, 0);
// No distillation, replay, transport, source selection, or update-plane edits.
assert.equal(source.slice(source.indexOf('export function parseDistillStatus')),
  patched.next.slice(patched.next.indexOf('export function parseDistillStatus')));
console.log('brain-learning-native-owner: passed');
