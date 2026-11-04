import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { bounded, run, plist, suites } from '../scripts/hourly-regression.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-hourly-test-'));
const success = { code: 0, signal: null, stopped: null, bytes: 7, tail: 'fixture passed' };
try {
  const rendered = plist({ codex: '/native/codex', state: root, envPath: '/a&b' });
  assert(rendered.includes('<integer>3600</integer>'));
  assert(rendered.includes('/a&amp;b'));
  assert(!rendered.includes('RunAtLoad'));
  assert(!rendered.includes('KeepAlive'));
  assert.throws(() => plist({ codex: 'codex' }), /absolute paths/);
  let count = 0;
  const execute = async (command, args, options) => {
    count++;
    if (command === 'git') return { ...success, tail: 'fixture-revision' };
    if (command === '/bin/bash') {
      assert.equal(options.env.RSP_TEST_JOBS, '1');
      assert(options.env.TMPDIR.startsWith('/tmp/rsp-hr-'));
      assert(options.env.TMPDIR.length < 40, 'keep nested fixture sockets below macOS sun_path limit');
      assert.equal(options.timeoutMs, 900000);
      assert(args[1].includes('ulimit -t 180; ulimit -f 32768'));
      assert.deepEqual(args.slice(4), suites.flatMap(s => ['--suite', s]));
      // Concurrent attempts must not start another suite or model process.
      assert.equal(await run({ state: root, execute: () => assert.fail('overlap') }), 75);
      options.output('fixture output\n');
      return { ...success, code: 1, tail: 'fixture FAIL; live probes not performed' };
    }
    assert.equal(command, '/native/codex');
    assert(args.includes('gpt-6.1-sol'));
    assert(args.includes('model_reasoning_effort="medium"'));
    assert(args.includes('model_provider="openai"'));
    assert(args.includes('read-only'));
    assert(!args.some(arg => /ignore-user-config|bypass|openrouter/.test(arg)));
    assert(options.input.includes('Test exit: 1'));
    assert(options.input.includes('never proof of current database/MCP health'));
    assert.equal(options.timeoutMs, 180000);
    assert.notEqual(options.cwd, process.cwd());
    return success;
  };
  assert.equal(await run({ state: root, codex: '/native/codex', execute }), 1);
  assert.equal(count, 3);
  assert(!fs.existsSync(path.join(root, 'running.lock')));
  const receiptFile = fs.readdirSync(root).find(f => f.endsWith('.json'));
  const receipt = JSON.parse(fs.readFileSync(path.join(root, receiptFile)));
  assert.equal(receipt.ok, false);
  assert.equal(receipt.tests.code, 1);
  assert.equal(receipt.coverage, 'fixture-only; live probes not performed');
  for (const file of fs.readdirSync(root)) assert.equal(fs.statSync(path.join(root, file)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  // Reviewer errors must remain failures even when fixtures pass.
  let call = 0;
  const failingReview = async () => (++call === 3 ? { ...success, code: null, stopped: 'timeout' } : success);
  assert.equal(await run({ state: root, execute: failingReview }), 1);
  assert.equal(await run({ state: path.join(root, 'healthy'), execute: async () => success }), 0);
  let interruptedCalls = 0;
  assert.equal(await run({ state: path.join(root, 'interrupted'), execute: async () => {
    interruptedCalls++;
    return interruptedCalls === 2 ? { ...success, stopped: 'interrupted' } : success;
  } }), 1);
  assert.equal(interruptedCalls, 2, 'interruption must not start a reviewer');
  assert.equal((await bounded(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 50 })).stopped, 'timeout');
  assert.equal((await bounded(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000));setInterval(()=>{},1000)'], { timeoutMs: 3000, maxBytes: 10 })).stopped, 'output-limit');
  assert.equal((await bounded('/nonexistent/rsp-hourly-command', [], { timeoutMs: 100 })).code, -2);
  const invalid = spawnSync('/bin/bash', ['scripts/run-tests.sh', '--suite', '../not-a-suite'], { encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /usage:/);
  console.log('✔ hourly runner: fixture selection, lock, bounded children, failure receipts, private logs and inactive hourly plist');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
