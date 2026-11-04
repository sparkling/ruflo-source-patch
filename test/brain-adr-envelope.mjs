import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const nativeHome = path.join(os.homedir(), '.cache/ruvnet-brain');
let nativeScripts = process.env.RSP_ENVELOPE_NATIVE_SCRIPTS;
if (!nativeScripts) {
  try {
    const active = JSON.parse(fs.readFileSync(path.join(nativeHome, 'active.json'), 'utf8'));
    nativeScripts = path.join(nativeHome, active.codeRoot || `versions/${active.version}`, 'scripts');
  } catch { /* portable anchor tests below do not require a Brain installation */ }
}
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-adr-envelope-')));
process.env.RUFLO_SOURCE_PATCH_HOME = path.join(sandbox, 'home');
process.env.RUFLO_NPX_ROOT = path.join(sandbox, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(sandbox, 'global');
process.env.RSP_CODEX_HOME = path.join(sandbox, 'codex');
process.env.RSP_RUVNET_BRAIN_HOME = path.join(sandbox, 'brain');
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = path.join(sandbox, 'marketplace');
const patcher = await import('../lib/brain-adr-envelope/patcher.mjs');
const { NAME, SPECS, patchSource, reverseSource, isPatched } = patcher;
const nativeGate = SPECS[1].edits.map(([from]) => from).join('\n');
for (const spec of SPECS) {
  const source = spec.edits.map(([from]) => from).join('\n');
  const patched = patchSource(source);
  assert.deepEqual(patched.missing, []);
  assert(isPatched(patched.next));
  assert.equal(reverseSource(patched.next), source);
  assert.equal(patchSource(patched.next).next, patched.next);
  assert(patchSource(source.replace('65536', '4096')).missing.length);
}
const priorGate = nativeGate.replace(...SPECS[1].edits[0]);
assert.equal(patchSource(priorGate).next, patchSource(nativeGate).next, 'exact prior cap-only source upgrades');
assert(patchSource(priorGate.replace('readPayload()', 'readOtherPayload()')).missing.length);
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
try {
  const write = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
  const { fixtureSources, VENDOR_SPECS } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
  const fixtures = fixtureSources();
  const roots = [path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'versions/4.7.28'),
    path.join(process.env.RSP_CODEX_HOME, 'plugins/cache/ruvnet-brain/ruvnet-brain/4.7.28')];
  const nativeShim = fixtures.nativeShim.replace('};', SPECS[0].edits[0][0] + '\n};');
  for (const root of roots) {
    write(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruvnet-brain', version: '4.7.28' }));
    for (const spec of VENDOR_SPECS) write(path.join(root, spec.relative),
      spec.id === 'shim' ? nativeShim : spec.id === 'hijack' ? fixtures.nativeHijack : fixtures.mcp4310);
    write(path.join(root, 'scripts/hook-input.mjs'), 'export function readStdinBounded() {}');
    write(path.join(root, SPECS[1].relative), nativeGate);
  }
  const active = path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'active.json');
  const activeBytes = JSON.stringify({ version: '4.7.28', codeRoot: 'versions/4.7.28' }); write(active, activeBytes);
  const boundary = await import('../lib/brain-managed-memory-boundary/patcher.mjs');
  const compose = await import('../lib/plugin-compose.mjs');
  const state = await import('../lib/cwd/state.mjs');
  const { resolveActive } = await import('../lib/brain-managed-memory-boundary/discovery.mjs');
  const owners = ['brain-managed-memory-boundary', NAME];
  state.writeState({ patchTargets: [], pluginTargets: owners });
  const boundaryResult = boundary.apply();
  assert.equal(boundaryResult.errors, 0, JSON.stringify(boundaryResult));
  const absentDecoder = path.join(roots[1], SPECS[1].relative);
  fs.unlinkSync(absentDecoder);
  const shimBefore = roots.map(root => fs.readFileSync(path.join(root, SPECS[0].relative), 'utf8'));
  const refusedInstall = compose.applyComposed(owners);
  assert(refusedInstall.incomplete > 0, 'first install refuses a missing pair before patching any shim');
  roots.forEach((root, index) => assert.equal(fs.readFileSync(path.join(root, SPECS[0].relative), 'utf8'), shimBefore[index]));
  assert(!fs.existsSync(path.join(roots[0], SPECS[1].relative) + '.rsp-backup'), 'refusal creates no partial decoder backup');
  write(absentDecoder, nativeGate);
  const installed = compose.applyComposed(owners);
  assert.equal(installed.errors, 0, installed.log.join('\n'));
  assert.equal(installed.incomplete, 0, installed.log.join('\n'));
  const files = roots.flatMap(root => SPECS.map(spec => path.join(root, spec.relative)));
  assert.deepEqual(compose.statusComposed([NAME])[NAME], { files: 4, patched: 4 });
  for (const missing of files) {
    const saved = fs.readFileSync(missing, 'utf8');
    fs.unlinkSync(missing);
    if (missing === files[0]) assert.throws(() => resolveActive(), /incomplete/,
      'the shared discovery default still requires a complete native shim');
    assert.equal(compose.statusComposed([NAME])[NAME].files, 4, 'either absent member stays in the active/host denominator');
    assert.equal(compose.statusComposed([NAME])[NAME].patched, 3, 'a partial envelope install cannot report healthy');
    const preserved = files.filter(file => file !== missing)
      .map(file => [file, fs.readFileSync(file), fs.readFileSync(file + '.rsp-backup')]);
    const blocked = compose.applyComposed([NAME]);
    assert(blocked.incomplete > 0, 'either missing member blocks the complete paired bundle');
    for (const [file, live, pristine] of preserved) {
      assert.deepEqual(fs.readFileSync(file), live, 'refusal preserves every executable and sibling contribution');
      assert.deepEqual(fs.readFileSync(file + '.rsp-backup'), pristine, 'refusal preserves exact pristine evidence');
    }
    assert(!fs.existsSync(missing), 'installation never fabricates a missing native member');
    write(missing, saved);
  }
  assert(patcher.preflight().ok);
  const inputFile = path.join(roots[0], 'scripts/hook-input.mjs');
  const inputSource = fs.readFileSync(inputFile, 'utf8');
  write(inputFile, 'export const parseHookEvent = () => null;');
  assert(!patcher.preflight().ok, 'paired preflight refuses unavailable native async reader');
  write(inputFile, inputSource);
  const removed = compose.reconcile([owners[0]], [NAME]);
  assert.equal(removed.incomplete, 0, removed.log.join('\n'));
  assert.equal(removed.errors, 0, removed.log.join('\n'));
  for (const root of roots) {
    assert.equal(fs.readFileSync(path.join(root, SPECS[0].relative), 'utf8'),
      (await import('../lib/brain-managed-memory-boundary/transforms.mjs')).patchShim(nativeShim).next);
    assert.equal(fs.readFileSync(path.join(root, SPECS[1].relative), 'utf8'), nativeGate);
  }
  assert.equal(fs.readFileSync(active, 'utf8'), activeBytes, 'native active selector is unchanged');
  if (nativeScripts && fs.existsSync(path.join(nativeScripts, 'decision-gate.mjs'))) {
    // Run real installed shim/gate/helper copies. Policies are inert fixture consumers,
    // so no project command, native store or live hook owner can be invoked.
    const root = path.join(sandbox, 'executable'), scripts = path.join(root, 'scripts');
    const copied = new Set();
    const copy = name => {
      if (copied.has(name)) return;
      copied.add(name);
      const source = fs.readFileSync(path.join(nativeScripts, name), 'utf8');
      write(path.join(scripts, name), source);
      for (const match of source.matchAll(/(?:from\s+|import\s*)['"]\.\/([^'"]+\.mjs)['"]/g)) copy(match[1]);
    };
    for (const name of ['hook-shim.mjs', 'decision-gate.mjs']) copy(name);
    const gateFile = path.join(scripts, 'decision-gate.mjs');
    const gate = reverseSource(fs.readFileSync(gateFile, 'utf8'));
    const shimFile = path.join(scripts, 'hook-shim.mjs');
    write(shimFile, patchSource(reverseSource(fs.readFileSync(shimFile, 'utf8'))).next);
    const receipts = path.join(root, 'received.jsonl');
    const consumer = `import fs from 'node:fs';import {createHash} from 'node:crypto';
let body='';for await(const chunk of process.stdin)body+=chunk;
let value;try{value=JSON.parse(body)}catch{}
fs.appendFileSync(${JSON.stringify(receipts)},JSON.stringify({bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex'),tail:value?.tool_input?.file_path})+'\\n');
if(process.env.FIXTURE_POLICY==='timeout')await new Promise(resolve=>setTimeout(resolve,1000));
if(process.env.FIXTURE_POLICY==='error')process.exit(7);
if(process.env.FIXTURE_POLICY==='refuse'||process.env.FIXTURE_POLICY==='require-json'&&!value){process.stderr.write('fixture policy refused\\n');process.exit(2);}
`;
    for (const name of ['adr-currency-gate.mjs', 'decision-recall-gate.mjs', 'duplicate-gate.mjs', 'unprompted-runtime.mjs']) write(path.join(scripts, name), consumer);
    const env = { PATH: process.env.PATH, HOME: root, CLAUDE_PLUGIN_ROOT: root,
      RUVNET_BRAIN_HOME: path.join(root, 'brain'), RUVNET_CONFIG_ROOT: path.join(root, 'config'), RUVNET_HOOK_HOST: 'codex' };
    const run = (input, policy = '', extraEnv = {}) => {
      write(receipts, '');
      const result = spawnSync(process.execPath, [shimFile, 'decision-gate', 'write'],
        { input, env: { ...env, FIXTURE_POLICY: policy, ...extraEnv }, cwd: root, encoding: 'utf8', timeout: 10000 });
      return { ...result, rows: fs.readFileSync(receipts, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
    };
    const large = JSON.stringify({ tool_name: 'Edit', tool_input: { content: 'x'.repeat(500000), file_path: '/fixture/TAIL.mjs' } });
    write(gateFile, gate.replace(...SPECS[1].edits[0]));
    const before = run(large);
    // Pipe scheduling differs by platform; preserve the actual baseline, never require
    // a timing-dependent failure to make a correct implementation pass.
    console.log(JSON.stringify({ nativeEnvelopeBaseline: { status: before.status, stderr: before.stderr,
      receivedBytes: before.rows.map(row => row.bytes) } }));
    write(gateFile, patchSource(gate).next);
    for (const size of [1000, 65500, 100000, 500000, 1000000]) {
      const input = JSON.stringify({ tool_name: 'Edit', tool_input: { content: 'x'.repeat(size), file_path: '/fixture/TAIL.mjs' } });
      const result = run(input);
      assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
      assert.equal(result.rows.length, 4);
      for (const row of result.rows) {
        assert.equal(row.bytes, Buffer.byteLength(input));
        assert.equal(row.sha256, createHash('sha256').update(input).digest('hex'));
        assert.equal(row.tail, '/fixture/TAIL.mjs');
      }
    }
    const refused = run(large, 'refuse');
    assert.equal(refused.status, 2); assert.match(refused.stderr, /fixture policy refused/);
    const failed = run(large, 'error');
    assert.equal(failed.status, 0, 'native gate fail-open semantics remain unchanged');
    assert.match(failed.stdout, /did not obtain a verdict.*exit:7/);
    const timed = run(large, 'timeout', { RUVNET_DECISION_BUDGET_MS: '300' });
    assert.equal(timed.status, 0, 'native timeout remains fail-open with an explicit missing verdict');
    assert.match(timed.stdout, /did not obtain a verdict.*budget/);
    for (const input of ['{"tool_name":', JSON.stringify({ content: 'x'.repeat(1100000) })]) {
      const result = run(input, 'require-json');
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /fixture policy refused/);
      assert(result.rows.every(row => row.bytes <= 1048576));
    }
    // The native helper's stream-error contract is an empty envelope. A refusing
    // policy must still be consulted; transport failure is never a forged allow.
    const reader = fs.readFileSync(path.join(scripts, 'hook-input.mjs'), 'utf8');
    const start = reader.indexOf('export function readStdinBounded('), end = reader.indexOf('\n}\n', start) + 2;
    const { EventEmitter } = await import('node:events');
    const stdin = new EventEmitter(); stdin.pause = () => {}; stdin.resume = () => queueMicrotask(() => stdin.emit('error', new Error('fixture stream failure')));
    const read = vm.runInNewContext(reader.slice(start, end).replace('export function', 'function') + ';readStdinBounded',
      { process: { stdin }, Buffer, setTimeout, clearTimeout });
    assert.equal((await read({ maxBytes: 1048576 })).length, 0);
    assert.equal(run('', 'require-json').status, 2);
    console.log('brain-adr-envelope: native executable pipe/full-tail/refusal/error/malformed/oversize checks passed');
  } else console.log('brain-adr-envelope: native executable qualification unavailable (no installed Brain); anchor/composition checks ran');
  console.log('brain-adr-envelope: bounded transport, missing-pair refusal, exact denominator, sibling preservation and reversal passed');
} finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
