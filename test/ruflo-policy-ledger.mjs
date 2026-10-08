import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { patchSource, reverseSource, isPatched, recover } from '../lib/ruflo-policy-ledger/patcher.mjs';
import { patchSource as serialization } from '../lib/ruflo-policy-serialization/patcher.mjs';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-policy-ledger-')));
const fixture = new URL('./fixtures/ruflo-policy-ledger/', import.meta.url);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const count = Number(process.env.RSP_POLICY_TEST_RECEIPTS || 5000);
assert.ok(Number.isSafeInteger(count) && count >= 5000 && count <= 250000);
const request = index => ({ identity: { id: 'fixture-agent', type: 'agent' },
  action: { type: 'read', resource: String(index), costUsd: 0.1, tokens: 2 } });
function write(file, value) {
  assert.ok(file.startsWith(temporary + path.sep));
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
}
try {
  write(path.join(temporary, 'package.json'), '{"type":"module"}');
  for (const name of ['engine', 'canonical', 'evaluator', 'envelope', 'types']) {
    const source = fs.readFileSync(new URL(name + '.js', fixture), 'utf8');
    const result = name === 'engine' ? patchSource(source) : { next: source, missing: [] };
    assert.deepEqual(result.missing, []);
    if (name === 'engine') {
      assert.ok(isPatched(result.next)); assert.equal(reverseSource(result.next), source);
      write(path.join(temporary, 'old-engine.js'), source);
    }
    write(path.join(temporary, name + '.js'), result.next);
  }
  const native = fs.readFileSync(new URL('policy-runtime.js', fixture), 'utf8');
  const packageRoot = path.join(temporary, 'global/@claude-flow/cli');
  const runtimeFile = path.join(packageRoot, 'dist/src/services/policy-runtime.js');
  const securityRoot = path.join(packageRoot, 'node_modules/@claude-flow/security');
  const engineFile = path.join(securityRoot, 'dist/policy/engine.js');
  write(path.join(packageRoot, 'package.json'), '{"name":"@claude-flow/cli","version":"3.54.1"}');
  write(path.join(securityRoot, 'package.json'), '{"name":"@claude-flow/security","main":"dist/index.js"}');
  write(path.join(securityRoot, 'dist/index.js'), '');
  write(runtimeFile, native);
  const engineSource = fs.readFileSync(new URL('engine.js', fixture), 'utf8');
  write(engineFile, engineSource);
  const composeChild = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'; import fs from 'node:fs';
    import {applyComposed,reconcile} from ${JSON.stringify(new URL('../lib/plugin-compose.mjs', import.meta.url).href)};
    const targets=['ruflo-policy-serialization','ruflo-policy-ledger'];
    const first=applyComposed(targets); assert.equal(first.errors+first.incomplete,0,JSON.stringify(first));
    assert.equal(first.patched,2); assert.equal(applyComposed(targets).patched,0);
    const remove=reconcile([],targets); assert.equal(remove.errors+remove.incomplete,0,JSON.stringify(remove));
  `], { encoding: 'utf8', env: { ...process.env, RUFLO_SOURCE_PATCH_HOME: temporary,
    RUFLO_GLOBAL_ROOT: path.join(temporary, 'global'), RUFLO_NPX_ROOT: path.join(temporary, 'absent-npx'),
    RSP_NO_SELF_UPDATE: '1', RSP_NO_LAUNCHCTL: '1', RSP_NO_STALE_WRITER_KILL: '1' } });
  assert.equal(composeChild.status, 0, composeChild.stderr + composeChild.stdout);
  assert.equal(fs.readFileSync(runtimeFile, 'utf8'), native);
  assert.equal(fs.readFileSync(engineFile, 'utf8'), engineSource);
  const applied = patchSource(serialization(native).next);
  assert.deepEqual(applied.missing, []);
  assert.ok(isPatched(applied.next));
  assert.equal(reverseSource(applied.next), serialization(native).next);
  // Upgrade the deployed hz.1 sources without recording patched bytes as pristine.
  for (const original of [serialization(native).next, engineSource]) {
    const current = patchSource(original).next;
    const previous = current
      .replace("        state.policyLedgerMode = 'segmented-v1';\n", '')
      .replace('        if (state.policyLedgerMode === "segmented-v1") engine.state.policyLedgerMode = state.policyLedgerMode;\n', '')
      .replace(" || engine.state.policyLedgerMode === 'segmented-v1'", '')
      .replace('        const { policyArchive, policyLedgerMode, ...expanded } = state;\n        if (!state.policyArchive) return expanded;', '        if (!state.policyArchive) return state;')
      .replace('        return { ...expanded, receipts };', '        const { policyArchive, ...expanded } = state;\n        return { ...expanded, receipts };');
    const recovery = recover(previous);
    assert.ok(recovery);
    assert.equal(recovery.candidate, original);
    assert.equal(recovery.verify(original), previous);
    assert.equal(patchSource(previous).next, current);
    assert.equal(recover(previous.replace('segmented', 'foreign')), null);
  }
  assert.ok(patchSource(native.replace('verifyStateAnchor(projectRoot, parsed)', 'foreign(parsed)')).missing.length);
  // Test the actual native transaction/writer with real files. Only imports that
  // would reach external packages or the real user trust directory are isolated.
  let runtime = applied.next.replace(/^import \{ AgenticPolicyEngine[^\n]+\n/,
    "import { AgenticPolicyEngine, createLegacyCompatibleState } from './engine.js';\n")
    .replace("import { hostname, userInfo } from 'node:os';",
      `import { hostname } from 'node:os';\nconst userInfo = () => ({homedir:${JSON.stringify(temporary)}});`)
    .replace("import { syncPolicyProjection } from '../mods/policy-projection.js';", 'const syncPolicyProjection = () => {};');
  write(path.join(temporary, 'runtime.js'), runtime);
  const api = await import(pathToFileURL(path.join(temporary, 'runtime.js')));
  const { AgenticPolicyEngine } = await import(pathToFileURL(path.join(temporary, 'engine.js')));
  const { AgenticPolicyEngine: OldEngine } = await import(pathToFileURL(path.join(temporary, 'old-engine.js')));
  const root = path.join(temporary, 'project'), statePath = path.join(root, '.claude-flow/policy/state.json');
  const engine = new AgenticPolicyEngine({ mode: 'legacy' });
  engine.setBudget({ id: 'budget', maxCostUsd: 10000, periodMs: 86400000 });
  for (let i = 0; i < count; i++) engine.evaluate(request(i));
  assert.equal(engine.verifyLedger().valid, true);
  const initial = engine.exportState(), prefixHash = hash(initial.receipts);
  const untouchedRoot = path.join(temporary, 'no-implicit-migration');
  write(path.join(untouchedRoot, '.claude-flow/policy/state.json'), JSON.stringify(initial));
  await api.evaluatePolicyRequest(request('ordinary'), untouchedRoot);
  assert.equal(api.loadPolicyState(untouchedRoot, { compact: true }).policyArchive, undefined);
  assert.equal(fs.existsSync(path.join(untouchedRoot, '.claude-flow/policy/receipt-segments')), false);
  const smallRoot = path.join(temporary, 'small-opt-in');
  write(path.join(smallRoot, '.claude-flow/policy/state.json'), JSON.stringify({ ...initial,
    receipts: initial.receipts.slice(0, 1000), ledgerLength: 1000, ledgerHead: initial.receipts[999].hash }));
  await api.withPolicyTransaction(smallRoot, () => null, { compactLedger: true });
  assert.equal(api.loadPolicyState(smallRoot, { compact: true }).policyLedgerMode, 'segmented-v1');
  assert.equal(api.loadPolicyState(smallRoot).policyLedgerMode, undefined);
  await api.withPolicyTransaction(smallRoot, engine => {
    for (let i = 0; i < 600; i++) engine.evaluate(request('small-' + i));
  });
  assert.ok(api.loadPolicyState(smallRoot, { compact: true }).policyArchive);
  assert.deepEqual(await api.verifyPolicyLedger(smallRoot), { valid: true, length: 1600 });
  write(statePath, JSON.stringify(initial));
  const initialBytes = fs.statSync(statePath).size, migrationStarted = performance.now();
  await api.withPolicyTransaction(root, engine => engine.evaluate(request('migration')), { compactLedger: true });
  const migrationMs = performance.now() - migrationStarted, compactBytes = fs.statSync(statePath).size;
  const state = api.loadPolicyState(root, { compact: true });
  assert.ok(state.receipts.length <= 1536);
  assert.equal(state.ledgerLength, count + 1);
  assert.deepEqual(state.budgets, initial.budgets);
  assert.deepEqual(state.rules, initial.rules);
  assert.deepEqual(state.approvals, initial.approvals);
  assert.equal(state.usage[0].tokens, initial.usage[0].tokens + 2);
  assert.equal((await api.verifyPolicyLedger(root)).valid, true);
  assert.equal((await api.verifyPolicyLedger(root)).length, count + 1);
  const publicState = api.loadPolicyState(root);
  assert.equal(publicState.receipts.length, count + 1, 'native audit/status/export callers see complete history');
  assert.equal(publicState.policyArchive, undefined);
  assert.equal(OldEngine.fromState(publicState).verifyLedger().valid, true);
  // Old workers retain ledgerLength, therefore refuse before any receipt append.
  const old = OldEngine.fromState(state), oldState = hash(old.exportState());
  assert.throws(() => old.evaluate(request('old')), /policy-ledger-truncated/);
  assert.equal(hash(old.exportState()), oldState);
  const archiveDir = path.join(root, '.claude-flow/policy/receipt-segments');
  const files = fs.readdirSync(archiveDir).filter(file => file.endsWith('.json'));
  const archived = files.flatMap(file => JSON.parse(fs.readFileSync(path.join(archiveDir, file))).receipts)
    .sort((a, b) => a.payload.sequence - b.payload.sequence);
  assert.equal(hash([...archived, ...state.receipts].slice(0, count)), prefixHash,
    'every pre-existing receipt field is preserved exactly');
  // Corruption in an old cold segment fails the full audit, even if the hot head remains intact.
  const oldest = files.find(file => JSON.parse(fs.readFileSync(path.join(archiveDir, file))).from === 0);
  const oldestFile = path.join(archiveDir, oldest), bytes = fs.readFileSync(oldestFile);
  write(oldestFile, bytes.toString().replace('fixture-agent', 'altered-agent'));
  assert.equal((await api.verifyPolicyLedger(root)).valid, false);
  write(oldestFile, bytes);
  const tampered = structuredClone(state); tampered.policyArchive.length++;
  write(statePath, JSON.stringify(tampered));
  assert.throws(() => api.loadPolicyState(root), /policy-archive-authentication-failed/);
  write(statePath, JSON.stringify(state));
  // Real processes contend on the native lock, with independent module instances.
  const childCode = `import {evaluatePolicyRequest} from './runtime.js';
    for(let i=0;i<8;i++) await evaluatePolicyRequest(${JSON.stringify(request('parallel'))}, ${JSON.stringify(root)});`;
  const concurrentStarted = performance.now();
  const children = Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], { cwd: temporary, stdio: ['ignore','pipe','pipe'] });
    let stderr = ''; child.stderr.on('data', b => stderr += b); child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr)));
  }));
  await Promise.all(children);
  const concurrentMs = performance.now() - concurrentStarted;
  assert.deepEqual(await api.verifyPolicyLedger(root), { valid: true, length: count + 49 });
  // Crash/failure boundaries: the original state stays authoritative until
  // immutable segment publication and sync have all completed.
  for (const [label, before, after] of [
    ['segment-write', 'writeFileSync(fd, bytes);',
      "writeFileSync(fd, bytes.slice(0, Math.floor(bytes.length / 2))); throw new Error('injected-segment-write');"],
    ['segment-sync', 'rspFsyncSync(fd);', "throw new Error('injected-segment-sync');"],
    ['after-publish', '            rspSyncDirectory(dir);\n        } finally',
      "            throw new Error('injected-after-publish');\n        } finally"],
    ['before-state', 'rspCompactLedger(projectRoot, engine.state);',
      "rspCompactLedger(projectRoot, engine.state); throw new Error('injected-before-state');"],
  ]) {
    const crashRoot = path.join(temporary, label), file = path.join(crashRoot, '.claude-flow/policy/state.json');
    write(file, JSON.stringify(initial));
    const beforeBytes = fs.readFileSync(file);
    const brokenFile = path.join(temporary, label + '.js');
    assert.ok(runtime.includes(before));
    write(brokenFile, runtime.replace(before, after));
    const broken = await import(pathToFileURL(brokenFile));
    await assert.rejects(broken.withPolicyTransaction(crashRoot, engine => engine.evaluate(request(label)),
      { compactLedger: true }), /injected-/, label);
    assert.deepEqual(fs.readFileSync(file), beforeBytes, label + ' did not publish reduced state');
    await api.withPolicyTransaction(crashRoot, engine => engine.evaluate(request('retry-' + label)), { compactLedger: true });
    assert.deepEqual(await api.verifyPolicyLedger(crashRoot), { valid: true, length: count + 1 });
    assert.equal(hash(api.loadPolicyState(crashRoot).receipts.slice(0, count)), prefixHash);
  }
  const committedRoot = path.join(temporary, 'after-state');
  write(path.join(committedRoot, '.claude-flow/policy/state.json'), JSON.stringify(initial));
  const afterStateFile = path.join(temporary, 'after-state.js');
  write(afterStateFile, runtime.replace('renamed = true;', "renamed = true; throw new Error('injected-after-state');"));
  const afterState = await import(pathToFileURL(afterStateFile));
  await assert.rejects(afterState.withPolicyTransaction(committedRoot,
    engine => engine.evaluate(request('after-state')), { compactLedger: true }), /injected-after-state/);
  assert.deepEqual(await api.verifyPolicyLedger(committedRoot), { valid: true, length: count + 1 });
  assert.equal(hash(api.loadPolicyState(committedRoot).receipts.slice(0, count)), prefixHash);
  // Signed receipts remain signed; rules/budgets/approval decisions use the
  // same native engine before and after migration.
  const signingKey = 'synthetic-policy-signing-key-for-tests-only';
  const signed = new AgenticPolicyEngine({ mode: 'enforce', signingKey });
  signed.upsertRule({ id: 'deny', effect: 'deny', actions: ['read'] });
  for (let i = 0; i < 1800; i++) assert.equal(signed.evaluate(request(i)).enforcedOutcome, 'denied');
  const signedRoot = path.join(temporary, 'signed');
  write(path.join(signedRoot, '.claude-flow/policy/state.json'), JSON.stringify(signed.exportState()));
  process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY = signingKey;
  try {
    assert.equal((await api.withPolicyTransaction(signedRoot, engine => engine.evaluate(request('signed-migrate')),
      { compactLedger: true })).enforcedOutcome, 'denied');
    assert.equal((await api.verifyPolicyLedger(signedRoot)).valid, true);
    const complete = api.loadPolicyState(signedRoot);
    assert.ok(complete.receipts.every(receipt => receipt.signature));
    assert.equal(OldEngine.fromState(complete, { signingKey }).verifyLedger().valid, true);
  } finally { delete process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY; }
  // A proven live owner is not evicted based on an old mtime.
  const lock = path.join(root, '.claude-flow/policy/state.lock');
  const release = await api.acquireLock(lock); fs.utimesSync(lock, new Date(0), new Date(0));
  await assert.rejects(api.acquireLock(lock), /policy-state-lock-timeout/); release();
  const oldRelease = await api.acquireLock(lock);
  fs.unlinkSync(lock); write(lock, 'replacement-owner'); oldRelease();
  assert.equal(fs.readFileSync(lock, 'utf8'), 'replacement-owner');
  console.log(JSON.stringify({ count, initialBytes, compactBytes, migrationMs, concurrentMs, concurrentCalls: 48 }));
  console.log('policy-ledger: exact receipt preservation, full audit, tamper refusal, old writer refusal and multi-process ledger continuity passed');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
