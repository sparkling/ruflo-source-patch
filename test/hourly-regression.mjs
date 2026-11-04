import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { bounded, run, plist, suites, sourceFixtures, sourceFixtureCommand } from '../scripts/hourly-regression.mjs';
import { acquireLock } from '../scripts/hourly-regression-lock.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-hourly-test-'));
const success = { code: 0, signal: null, stopped: null, bytes: 7, tail: 'fixture passed' };
const liveSuccess = { ...success, tail: JSON.stringify({ status: 'verified', targets: [{ target: 'fixture', kind: 'knowledge-source', status: 'verified' }] }) };
const sourceSuccess = { ...success, tail: '# tests 33\n# pass 33\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n' };
const fixtureResult = command => command === 'python3' ? liveSuccess : command === 'ssh' ? sourceSuccess : success;
try {
  fs.writeFileSync(path.join(root, 'live-targets.json'), JSON.stringify({ enableSource: true }), { mode: 0o600 });
  const skippedSource = await sourceFixtures(async () => ({ ...sourceSuccess,
    tail: sourceSuccess.tail.replace('# skipped 0', '# skipped 1') }), process.cwd());
  assert.equal(skippedSource.report.status, 'not-verified');
  assert(!JSON.stringify(skippedSource).includes('# tests'), 'raw source fixture output must not enter receipts');
  const liveTests = spawnSync('python3', [new URL('./hourly-regression-live.py', import.meta.url).pathname],
    { encoding: 'utf8', timeout: 5000 });
  assert.equal(liveTests.status, 0, liveTests.stderr);
  const rendered = plist({ codex: '/native/codex', state: root, envPath: '/a&b' });
  assert(rendered.includes('<integer>3600</integer>'));
  assert(rendered.includes('<key>ProcessType</key><string>Standard</string>'));
  assert(!rendered.includes('<key>LowPriorityIO</key>'), 'deadline qualification must not inherit forced disk throttling');
  assert(!rendered.includes('<key>Nice</key>'), 'deadline qualification must not inherit forced CPU demotion');
  assert(rendered.includes('/a&amp;b'));
  assert(!rendered.includes('RunAtLoad'));
  assert(!rendered.includes('KeepAlive'));
  assert.throws(() => plist({ codex: 'codex' }), /absolute paths/);
  let count = 0;
  const execute = async (command, args, options) => {
    count++;
    if (command === 'git') return { ...success, tail: 'fixture-revision' };
    if (command === 'ssh') {
      assert.equal(args.at(-1), sourceFixtureCommand);
      assert.equal(options.timeoutMs, 120000);
      options.output(sourceSuccess.tail);
      return sourceSuccess;
    }
    if (command === 'python3') {
      assert.equal(options.timeoutMs, 315000);
      assert(args[0].endsWith('/scripts/hourly-regression-live.py'));
      return liveSuccess;
    }
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
    assert(options.input.includes('Live read-only result:'));
    assert.equal(options.timeoutMs, 180000);
    assert.notEqual(options.cwd, process.cwd());
    return success;
  };
  assert.equal(await run({ state: root, codex: '/native/codex', execute }), 1);
  assert.equal(count, 5);
  assert(!fs.existsSync(path.join(root, 'running.lock')));
  const receiptFile = fs.readdirSync(root).find(f => f.startsWith('run-') && f.endsWith('.json'));
  const receipt = JSON.parse(fs.readFileSync(path.join(root, receiptFile)));
  assert.equal(receipt.ok, false);
  assert.equal(receipt.tests.code, 1);
  assert.equal(receipt.live.report.status, 'verified');
  for (const file of fs.readdirSync(root)) assert.equal(fs.statSync(path.join(root, file)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  // Reviewer errors must remain failures even when fixtures pass.
  let call = 0;
  const failingReview = async command => (++call === 5 ? { ...success, code: null, stopped: 'timeout' } : fixtureResult(command));
  assert.equal(await run({ state: root, execute: failingReview }), 1);
  assert.equal(await run({ state: path.join(root, 'healthy'), execute: async command => fixtureResult(command) }), 0);
  const originalState = path.join(root, 'original-monitor');
  assert.equal(await run({ state: originalState, execute: async (command, _args, options) => {
    assert.notEqual(command, 'ssh', 'source fixtures stay inactive until private configuration enables them');
    if (command === 'python3') assert.equal(options.timeoutMs, 125000);
    return fixtureResult(command);
  } }), 0);
  const originalFile = fs.readdirSync(originalState).find(file => file.endsWith('.json'));
  const originalReceipt = JSON.parse(fs.readFileSync(path.join(originalState, originalFile)));
  assert.equal(originalReceipt.sourceFixtures.report.status, 'not-enabled');
  assert(originalReceipt.missingCoverage.some(gap => gap.includes('awaiting qualification')));
  assert.equal(await run({ state: path.join(root, 'unverified-live'), execute: async command => command === 'python3'
    ? { ...success, tail: JSON.stringify({ status: 'not-verified', error: 'native-error' }) } : fixtureResult(command) }), 1);
  const deadlineState = path.join(root, 'live-deadline');
  assert.equal(await run({ state: deadlineState, execute: async command => command === 'python3'
    ? { ...liveSuccess, stopped: 'timeout' } : fixtureResult(command) }), 1);
  const deadlineFile = fs.readdirSync(deadlineState).find(file => file.endsWith('.json'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(deadlineState, deadlineFile))).live.report.error,
    'monitor-deadline-completion-unknown', 'outer expiry must override even a partial success response');
  let interruptedCalls = 0;
  assert.equal(await run({ state: path.join(root, 'interrupted'), execute: async () => {
    interruptedCalls++;
    return interruptedCalls === 2 ? { ...success, stopped: 'interrupted' } : success;
  } }), 1);
  assert.equal(interruptedCalls, 2, 'interruption must not start a reviewer');
  const lockState = path.join(root, 'owner-proofs'); fs.mkdirSync(lockState);
  const release = acquireLock(lockState);
  const ownerFile = path.join(lockState, 'running.lock/owner.json');
  const originalOwner = fs.readFileSync(ownerFile, 'utf8');
  fs.writeFileSync(ownerFile, JSON.stringify({ ...JSON.parse(originalOwner), token: 'b'.repeat(36) }));
  assert.throws(release, /owner changed/);
  assert.equal(JSON.parse(fs.readFileSync(ownerFile)).token, 'b'.repeat(36), 'same-PID replacement must survive old release');
  fs.writeFileSync(ownerFile, originalOwner); release();
  const worker = spawn(process.execPath, ['--input-type=module', '-e',
    `import {acquireLock} from ${JSON.stringify(new URL('../scripts/hourly-regression-lock.mjs', import.meta.url).href)}; acquireLock(process.argv[1]); console.log('ready'); setInterval(()=>{},1000);`, lockState], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('worker did not acquire lock')), 3000);
      worker.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      worker.once('error', reject);
    });
    assert.equal(acquireLock(lockState), null, 'actual live worker prevents overlap');
    const dead = new Promise(resolve => worker.once('close', resolve)); worker.kill('SIGKILL'); await dead;
    const recoveredRelease = acquireLock(lockState);
    assert.equal(typeof recoveredRelease, 'function', 'native ESRCH permits fenced dead-worker recovery');
    recoveredRelease();
    fs.mkdirSync(path.join(lockState, 'running.lock'));
    assert.equal(await run({ state: lockState, execute: () => assert.fail('unknown owner must block') }), 75);
    assert.equal(JSON.parse(fs.readFileSync(path.join(lockState, 'last-blocked.json'))).status, 'blocked');
  } finally { worker.kill('SIGKILL'); }
  assert.equal((await bounded(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 50 })).stopped, 'timeout');
  assert.equal((await bounded(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000));setInterval(()=>{},1000)'], { timeoutMs: 3000, maxBytes: 10 })).stopped, 'output-limit');
  assert.equal((await bounded('/nonexistent/rsp-hourly-command', [], { timeoutMs: 100 })).code, -2);
  const invalid = spawnSync('/bin/bash', ['scripts/run-tests.sh', '--suite', '../not-a-suite'], { encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /usage:/);
  console.log('✔ hourly runner: fixture selection, lock, bounded children, failure receipts, private logs and inactive hourly plist');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
