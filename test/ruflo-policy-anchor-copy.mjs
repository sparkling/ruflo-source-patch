import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { patchSource, reverse, hasPatch, isPatched } from '../lib/ruflo-policy-anchor-copy/patcher.mjs';
import { patchSource as ownerPatch } from '../lib/ruflo-memory-owner/patcher.mjs';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-anchor-copy-'));
const originalEnv = { ...process.env };
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pristine = fs.readFileSync(new URL('./fixtures/ruflo-memory-owner/policy-anchor-log-3.71.0.js', import.meta.url), 'utf8');
try {
  fs.writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}');
  for (const source of [pristine, ownerPatch(pristine).next]) {
    const result = patchSource(source);
    assert.deepEqual(result.missing, []);
    assert(hasPatch(result.next)); assert(isPatched(result.next));
    assert.equal(reverse(result.next), source, 'exact restoration preserves other patches');
    assert.equal(patchSource(result.next).next, result.next);
    assert(patchSource(source + source).missing.length);
    assert(patchSource(result.next.replace('source.digest', 'source.corrupted')).missing.length);
    assert(patchSource(source.replace("{ fatal: true }", "{ fatal: false }")).missing.length,
      'unknown native UTF-8 authentication contract refuses');
  }
  assert.equal(ownerPatch(patchSource(pristine).next).next, patchSource(ownerPatch(pristine).next).next,
    'existing owner parser and authenticated copy compose in either order');
  const composed = patchSource(ownerPatch(pristine).next).next;
  fs.writeFileSync(path.join(temporary, 'reader.js'), composed);
  fs.writeFileSync(path.join(temporary, 'original.js'), pristine);
  const reader = await import(pathToFileURL(path.join(temporary, 'reader.js')));
  const original = await import(pathToFileURL(path.join(temporary, 'original.js')));
  const entries = Array.from({ length: 2000 }, (_, seq) => ({ seq, hash: 'hash-' + seq, text: 'escaped " \\ 😀 \n' }));
  const next = { seq: entries.length, hash: 'hash-' + entries.length };
  const canonical = rows => '{"version":1,"entries":[\n' + rows.map(row => JSON.stringify(row)).join(',\n') + '\n]}\n';
  const file = path.join(temporary, 'anchors.json');
  const output = path.join(temporary, 'output.json');
  let validations = 0;
  const validate = (entry, seq, previous) => { validations++;
    return entry.seq === seq && entry.hash === 'hash-' + seq && (seq === 0 ? previous === null : previous === 'hash-' + (seq - 1)); };
  const assess = () => {
    const proof = {}; let count = 0, previous = null;
    for (const entry of reader.anchorEntries(file, proof)) {
      assert(validate(entry, count++, previous)); previous = entry.hash;
    }
    return proof;
  };
  const write = (proof, target = output) => {
    const fd = fs.openSync(target, 'w');
    try { reader.appendedAnchorLog(file, next, validate, proof)[reader.ATOMIC_JSON_WRITER](fd); }
    finally { fs.closeSync(fd); }
  };
  fs.writeFileSync(file, canonical(entries));
  const proof = assess(); assert.equal(validations, entries.length, 'full initial validation');
  validations = 0; write(proof);
  assert.equal(validations, 1, 'only the new anchor needs entry reauthentication during byte-bound copy');
  assert.deepEqual(JSON.parse(fs.readFileSync(output)), { version: 1, entries: [...entries, next] });
  validations = 0; write(proof);
  assert.equal(validations, entries.length + 1, 'consumed proof never grants reuse in another publication');
  for (const mutate of [
    bytes => Buffer.from(bytes.toString().replace('hash-50', 'hash-X0')),
    bytes => bytes.subarray(0, bytes.length - 1),
    bytes => Buffer.concat([bytes, Buffer.from('x')]),
  ]) {
    fs.writeFileSync(file, canonical(entries)); const evidence = assess();
    fs.writeFileSync(file, mutate(fs.readFileSync(file)));
    assert.throws(() => write(evidence), /policy-anchor-log-source-changed/);
  }
  const documents = [
    JSON.stringify({ version: 1, entries }, null, 2),
    JSON.stringify({ entries: [{ ...entries[0], text: '😀'.repeat(20000) }], version: 1 }),
    JSON.stringify({ version: 1, unknown: ['bounded'], entries }),
    '{"version":1,"entries":[\n' + JSON.stringify(entries[0]) + ',\n]}',
    '{"version":1,"version":1,"entries":[]}',
    '{"version":2,"entries":[]}',
    '{"version":1,"entries":[]} trailing',
    '{"version":1,"entries":[\n{"text":"literal\nnewline"}\n]}',
  ];
  for (const document of documents) {
    fs.writeFileSync(file, document);
    const outcomes = [original, reader].map(api => {
      try { return { rows: [...api.anchorEntries(file)] }; } catch (error) { return { error: error.message }; }
    });
    assert.deepEqual(outcomes[1], outcomes[0]);
  }
  fs.writeFileSync(file, JSON.stringify({ entries, version: 1 }, null, 2));
  const fallback = assess(); validations = 0; write(fallback);
  assert.equal(validations, entries.length + 1, 'noncanonical root keeps native authenticated serializer');
  assert.deepEqual(JSON.parse(fs.readFileSync(output)), { version: 1, entries: [...entries, next] });
  fs.writeFileSync(file, canonical(entries));
  const incomplete = {}; const iterator = reader.anchorEntries(file, incomplete); iterator.next(); iterator.return();
  validations = 0; write(incomplete);
  assert.equal(validations, entries.length + 1, 'partial initial consumption cannot grant reuse');
  validations = 0; write({ file, size: fs.statSync(file).size, digest: sha(file) });
  assert.equal(validations, entries.length + 1, 'plain forged evidence cannot grant reuse');
  const bound = assess(), other = path.join(temporary, 'other.json'); fs.copyFileSync(file, other);
  let fd = fs.openSync(output, 'w'); validations = 0;
  try { reader.appendedAnchorLog(other, next, validate, bound)[reader.ATOMIC_JSON_WRITER](fd); }
  finally { fs.closeSync(fd); }
  assert.equal(validations, entries.length + 1, 'proof is bound to the exact source path');
  const invalidNext = assess(); fd = fs.openSync(output, 'w');
  try { assert.throws(() => reader.appendedAnchorLog(file, { ...next, seq: -1 }, validate, invalidNext)[reader.ATOMIC_JSON_WRITER](fd), /policy-anchor-log-corrupt/); }
  finally { fs.closeSync(fd); }

  const nativeRoot = process.env.RSP_POLICY_NATIVE_ROOT;
  if (nativeRoot) {
    process.env.HOME = path.join(temporary, 'home'); process.env.XDG_CONFIG_HOME = path.join(temporary, 'config');
    process.env.RUFLO_SOURCE_PATCH_HOME = process.env.HOME;
    process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION = '4';
    fs.mkdirSync(process.env.HOME);
    const copy = path.join(temporary, 'cli'); fs.mkdirSync(copy);
    fs.copyFileSync(path.join(nativeRoot, 'package.json'), path.join(copy, 'package.json'));
    fs.cpSync(path.join(nativeRoot, 'dist'), path.join(copy, 'dist'), { recursive: true });
    fs.symlinkSync(path.join(nativeRoot, 'node_modules'), path.join(copy, 'node_modules'));
    for (const name of ['policy-anchor-log.js', 'policy-ledger-anchor.js']) {
      const target = path.join(copy, 'dist/src/services', name), source = fs.readFileSync(target, 'utf8');
      const patched = patchSource(source); assert.deepEqual(patched.missing, [], name);
      if (name === 'policy-ledger-anchor.js') assert(patchSource(source.replace(
        'if (!validEntry(value, summary.count, prev))', 'if (false)')).missing.length,
      'missing native initial chain authentication refuses');
      assert.equal(reverse(patched.next), source); assert(isPatched(patched.next));
      fs.writeFileSync(target, patched.next);
    }
    const native = await import(pathToFileURL(path.join(copy, 'dist/src/services/policy-runtime.js')));
    const root = path.join(temporary, 'synthetic-project'); fs.mkdirSync(root);
    const request = () => ({ identity: { id: 'synthetic-test', type: 'agent' }, action: { type: 'memory.read', resource: 'fixture' } });
    for (let i = 0; i < 4; i++) await native.withPolicyTransaction(root, engine => {
      for (let n = 0; n < 8; n++) engine.evaluate(request());
    });
    assert.equal((await native.verifyPolicyLedger(root, { full: true })).length, 32);
    const anchor = path.join(root, '.claude-flow/policy/ledger-anchors.json');
    const state = path.join(root, '.claude-flow/policy/state.json');
    const mutate = bytes => {
      const changed = Buffer.from(bytes), at = changed.indexOf(Buffer.from('"headHash":"')) + 12;
      assert(at > 12); changed[at] = changed[at] === 97 ? 98 : 97; return changed;
    };
    const before = fs.readFileSync(anchor), beforeState = sha(state);
    fs.writeFileSync(anchor, mutate(before));
    await assert.rejects(native.evaluatePolicyRequest(request(), root), /policy-anchor-log-corrupt/);
    assert.equal(sha(state), beforeState, 'native initial authentication refuses before state writes');
    fs.writeFileSync(anchor, before);
    for (const tamper of [mutate, bytes => bytes.subarray(0, -1), bytes => Buffer.concat([bytes, Buffer.from('x')])]) {
      const originalBytes = fs.readFileSync(anchor); let changed;
      await assert.rejects(native.withPolicyTransaction(root, engine => {
        changed = tamper(originalBytes); fs.writeFileSync(anchor, changed); return engine.evaluate(request());
      }), /policy-anchor-log-source-changed/);
      assert.deepEqual(fs.readFileSync(anchor), changed, 'native atomic writer did not publish its incomplete temp');
      assert(!fs.readdirSync(path.dirname(anchor)).some(name => name.startsWith('ledger-anchors.json.') && name.endsWith('.tmp')));
      fs.writeFileSync(anchor, originalBytes);
      // Native state-before-anchor ordering can leave state ahead after failure.
      // Recovery is native catch-up; this does not retry the failed operation.
      await native.withPolicyTransaction(root, () => null);
      assert((await native.verifyPolicyLedger(root, { full: true })).valid);
    }
    const full = await native.verifyPolicyLedger(root, { full: true });
    assert.equal(full.length, 35, 'all three uncertain failure receipts remain in native history');
    const anchorBytes = fs.readFileSync(anchor), stateDigest = sha(state);
    await assert.rejects(native.withPolicyTransaction(root, engine => {
      engine.evaluate(request()); throw Error('simulated interruption before publication');
    }), /simulated interruption/);
    assert.equal(sha(state), stateDigest); assert.deepEqual(fs.readFileSync(anchor), anchorBytes);
    if (process.platform !== 'win32') {
      // Kill only this owned child at the native anchor rename boundary: its
      // state is durable, its verified anchor temp is not yet authoritative.
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
        const rename=fs.renameSync;
        fs.renameSync=(from,to)=>{if(to===${JSON.stringify(anchor)})process.kill(process.pid,'SIGKILL');return rename(from,to);};
        syncBuiltinESMExports();
        const runtime=await import(${JSON.stringify(pathToFileURL(path.join(copy, 'dist/src/services/policy-runtime.js')).href)});
        await runtime.evaluatePolicyRequest(${JSON.stringify(request())},${JSON.stringify(root)});
      `], { cwd: root, env: process.env, encoding: 'utf8', timeout: 15000 });
      assert.equal(child.signal, 'SIGKILL', child.stderr);
      assert.deepEqual(fs.readFileSync(anchor), anchorBytes, 'crash cannot publish a partial anchor');
      assert.notEqual(sha(state), stateDigest, 'native state-before-anchor ordering retained');
      await native.withPolicyTransaction(root, () => null);
      const recovered = await native.verifyPolicyLedger(root, { full: true });
      assert(recovered.valid); assert.equal(recovered.length, 36, 'crashed operation retained once; native catch-up adds no duplicate');
    }
    console.log('native-current composed atomic publication, tamper, crash-order and full audit qualification passed');
  } else console.log('native-current qualification not requested (set RSP_POLICY_NATIVE_ROOT)');
} finally {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('authenticated anchor copy regression passed');
