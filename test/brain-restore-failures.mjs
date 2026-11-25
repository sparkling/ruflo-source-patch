import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { patchSource } from '../lib/brain-restore-diagnostics/patcher.mjs';

const pristine = fs.readFileSync(new URL('./fixtures/brain-capture-diagnostics/ruflo-memory-hooks.mjs', import.meta.url), 'utf8');
const patched = patchSource(pristine);
assert.deepEqual(patched.missing, []);
const section = (s, from, to) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));
async function exercise(source, { batch, cli, aborted = false, expired = false } = {}) {
  let calls = 0, closes = 0;
  const clock = 100000, deadlineAt = expired ? clock : clock + 15000;
  const controller = new AbortController();
  if (aborted) controller.abort();
  const context = vm.createContext({
    Date: { now: () => clock }, process, Promise, Map, Set,
    projectStore: () => ({ adopted: true, root: '/fixture/project', db: '/fixture/memory.db' }),
    resolveRuflo: () => '/fixture/ruflo',
    openBatchSession: () => ({
      async list(namespace, limit, deadline) {
        calls++; assert.equal(deadline, deadlineAt);
        return batch(namespace, limit);
      },
      close() { closes++; },
    }),
    observeRestoreSession() {},
    rufloMemory: async (argv, options) => {
      calls++; assert.equal(argv[0], 'list'); assert.equal(options.deadlineAt, deadlineAt);
      return cli(argv[2]);
    },
    checkpointNamespaces: () => ['project', 'default'], newestOfFamily: () => null,
  });
  const functions = section(source, 'function parseJson(', '\nfunction gitFacts(')
    + section(source, 'export const RESTORE_FAST_LIMIT', '\n/**\n * Synchronous exact write:');
  vm.runInContext(functions.replaceAll('export ', '') + '\nglobalThis.run = restore;', context);
  const result = await context.run({ cwd: '/fixture/project', bin: '/fixture/ruflo', deadlineAt,
    signal: controller.signal, ...(cli ? { run() {} } : {}) });
  assert.equal(calls, 3, 'only the three original list operations');
  assert.equal(closes, batch ? 1 : 0, 'native session is closed exactly once');
  return result;
}
const cliFailure = () => ({ ok: false, stdout: '', error: 'ruflo memory list exited 1: PRIVATE owner binding missing or ambiguous' });
const old = await exercise(pristine, { cli: cliFailure });
assert.match(old.context, /did not answer in time/, 'pristine reproduces a false timeout without time passing');
const failed = await exercise(patched.next, { cli: cliFailure });
assert.equal(failed.status, 'unknown');
assert.match(failed.context, /terminal-failure/);
assert.doesNotMatch(failed.context, /time|PRIVATE|binding/);
for (const state of ['unavailable', 'unknown-state']) {
  const r = await exercise(patched.next, { batch: () => ({ state }) });
  assert.equal(r.status, 'unknown'); assert.match(r.context, /unavailable/);
  assert.doesNotMatch(r.context, /time/);
}
const cancelled = await exercise(patched.next, { aborted: true, batch: () => ({ state: 'unavailable' }) });
assert.match(cancelled.context, /cancelled/); assert.doesNotMatch(cancelled.context, /time/);
const timeout = await exercise(patched.next, { expired: true, batch: () => ({ state: 'timed out' }) });
assert.match(timeout.context, /did not answer in time/);
const premature = await exercise(patched.next, { batch: () => ({ state: 'timed out' }) });
assert.doesNotMatch(premature.context, /did not answer in time/, 'a closed native session alone is not an observed deadline');
const mixed = await exercise(patched.next, { expired: true,
  batch: namespace => ({ state: namespace === 'project' ? 'timed out' : 'unavailable' }) });
assert.match(mixed.context, /timed-out, unavailable/);
assert.doesNotMatch(mixed.context, /did not answer in time/, 'one deadline does not turn all failures into timeouts');
const empty = await exercise(patched.next, { batch: () => ({ state: 'ok', rows: [] }) });
assert.equal(empty.status, 'empty');
assert(!empty.failureCategories, 'successful native result is unchanged');
console.log('Restore failure categories: pristine false timeout, CLI failure, unavailable, cancelled, deadline, mixed and empty pass');
