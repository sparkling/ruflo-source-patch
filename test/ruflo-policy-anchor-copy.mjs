import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { patchSource, reverse, hasPatch, isPatched, historicalPatchSource, historicalSummaryPatchSource } from '../lib/ruflo-policy-anchor-copy/patcher.mjs';
import { patchSource as ownerPatch } from '../lib/ruflo-memory-owner/patcher.mjs';
import { descriptor } from '../lib/ruflo-policy-anchor-copy/patcher.mjs';
import { isKnownComposition } from '../lib/composition-proof.mjs';
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
    const previous = historicalPatchSource(source).next;
    assert.equal(reverse(previous), source, 'exact149 restoration preserves other composition');
    assert.equal(patchSource(previous).next, result.next, 'exact149 upgrades to byte-bound summary reuse');
    assert.equal(isPatched(previous), false, 'previous publication-only patch still needs upgrade');
    const summaryCopy = historicalSummaryPatchSource(source).next;
    assert.equal(reverse(summaryCopy), source, 'released summary-copy restores exact native bytes');
    assert.equal(patchSource(summaryCopy).next, result.next, 'released summary-copy upgrades without losing sibling patches');
    assert.equal(isPatched(summaryCopy), false);
    assert(patchSource(summaryCopy.replace('digest.digest', 'digest.foreign')).missing.length);
    const claimants = [{ patchSource: ownerPatch, atomic: true }, descriptor];
    assert(isKnownComposition(pristine, summaryCopy, claimants), 'installer recognizes the complete prior summary composition');
    assert(isKnownComposition(pristine, previous, claimants), 'installer still recognizes released149 composition');
    assert(!isKnownComposition(pristine, summaryCopy.replace('digest.digest', 'digest.foreign'), claimants),
      'installer refuses mutated historical ownership');
    assert(patchSource(previous.replace('source.digest', 'source.foreign')).missing.length);
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
  assert.equal(validations, 2, 'only the new anchor and its exact serialized form are reauthenticated');
  assert.deepEqual(JSON.parse(fs.readFileSync(output)), { version: 1, entries: [...entries, next] });
  validations = 0; write(proof);
  assert.equal(validations, entries.length + 1, 'consumed proof never grants reuse in another publication');
  for (const mutate of [
    bytes => Buffer.from(bytes.toString().replace('hash-50', 'hash-X0')),
    bytes => Buffer.concat([bytes.subarray(0, -1), Buffer.from('x')]),
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

  const publish = (change = {}, transform = value => value) => {
    fs.writeFileSync(file, canonical(entries));
    const evidence = assess(), tip = { ...next, ...change };
    const publication = reader.appendedAnchorLog(file, tip, validate, evidence);
    const target = fs.openSync(output, 'w');
    try { publication[reader.ATOMIC_JSON_WRITER](target); } finally { fs.closeSync(target); }
    fs.renameSync(output, file);
    reader.publishVerifiedAnchorSummary(transform(publication), file, 'context', tip.hash);
  };
  publish(); validations = 0;
  let bytesRead = 0;
  const nativeRead = fs.readSync;
  fs.readSync = (...args) => { const count = nativeRead(...args); bytesRead += count; return count; };
  syncBuiltinESMExports();
  let reused;
  try { reused = reader.readVerifiedAnchorSummary(file, 'context', next.hash); }
  finally { fs.readSync = nativeRead; syncBuiltinESMExports(); }
  assert.equal(bytesRead, fs.statSync(file).size, 'reuse freshly reads and hashes every source byte');
  assert.equal(validations, 0, 'identical authenticated bytes avoid repeated entry parsing and hash-chain work');
  assert.equal(reused.count, entries.length + 1); assert.deepEqual(reused.last, next); assert.equal(reused.mirrorIncluded, true);
  assert.equal(reader.readVerifiedAnchorSummary(file, 'context', next.hash), undefined, 'one publication summary is consumed once');
  // Exercise all footer/chunk alignments and forced partial reads/writes. The
  // output summary digest must authenticate exactly the bytes actually written.
  const realWrite = fs.writeSync;
  for (const endingOffset of [-3, -2, -1, 0, 1, 2, 3, 4]) {
    const row = { seq: 0, hash: 'hash-0', text: '' };
    row.text = 'x'.repeat(65536 + endingOffset - Buffer.byteLength(canonical([row])));
    fs.writeFileSync(file, canonical([row]));
    const evidence = assess();
    fs.readSync = (fd, buffer, offset, length, position) => nativeRead(fd, buffer, offset, Math.min(length, 3), position);
    fs.writeSync = (fd, buffer, offset, length) => realWrite(fd, buffer, offset, Math.min(length, 2));
    syncBuiltinESMExports();
    const tip = { seq: 1, hash: 'hash-1' };
    const publication = reader.appendedAnchorLog(file, tip, validate, evidence);
    const target = fs.openSync(output, 'w');
    try { publication[reader.ATOMIC_JSON_WRITER](target); }
    finally { fs.closeSync(target); fs.readSync = nativeRead; fs.writeSync = realWrite; syncBuiltinESMExports(); }
    assert.equal(fs.readFileSync(output, 'utf8'), canonical([row, tip]));
    fs.renameSync(output, file);
    reader.publishVerifiedAnchorSummary(publication, file, 'boundary', tip.hash);
    const summary = reader.readVerifiedAnchorSummary(file, 'boundary', tip.hash);
    assert(summary, 'forked digest matches exact output under partial I/O');
    assert.equal(summary.count, 2);
    assert.deepEqual(summary.last, tip);
  }
  for (const [context, mirror, selected] of [['other', next.hash, file], ['context', 'older-mirror', file], ['context', undefined, file], ['context', next.hash, other]]) {
    publish(); assert.equal(reader.readVerifiedAnchorSummary(selected, context, mirror), undefined);
    assert.equal(reader.readVerifiedAnchorSummary(file, 'context', next.hash), undefined, 'a mismatch discards old reuse authority');
  }
  for (const alter of [
    bytes => Buffer.from(bytes.toString().replace('hash-50', 'hash-X0')),
    bytes => bytes.subarray(0, -1), bytes => Buffer.concat([bytes, Buffer.from(' ')]),
    bytes => Buffer.from(JSON.stringify(JSON.parse(bytes), null, 2)),
  ]) {
    publish(); const stat = fs.statSync(file); fs.writeFileSync(file, alter(fs.readFileSync(file))); fs.utimesSync(file, stat.atime, stat.mtime);
    assert.equal(reader.readVerifiedAnchorSummary(file, 'context', next.hash), undefined, 'same metadata never authenticates changed bytes or grammar');
  }
  publish({}, () => ({}));
  assert.equal(reader.readVerifiedAnchorSummary(file, 'context', next.hash), undefined, 'unexecuted or forged publication cannot grant reuse');
  publish({ toJSON() { return { ...next, seq: -1 }; } });
  assert.equal(reader.readVerifiedAnchorSummary(file, 'context', next.hash), undefined, 'pre-serialization validation cannot bless different output');
  publish({ toJSON() { return undefined; } });
  assert(fs.readFileSync(file, 'utf8').endsWith(',\nundefined\n]}\n'), 'summary optimization preserves original undefined serialization behavior');
  assert.equal(reader.readVerifiedAnchorSummary(file, 'context', next.hash), undefined);
  publish(); const nativeClose = fs.closeSync;
  fs.closeSync = value => { nativeClose(value); throw Error('close failure'); }; syncBuiltinESMExports();
  try { assert.equal(reader.readVerifiedAnchorSummary(file, 'context', next.hash), undefined, 'failed digest-read cleanup declines reuse'); }
  finally { fs.closeSync = nativeClose; syncBuiltinESMExports(); }
  publish(); fs.renameSync(file, other); fs.symlinkSync(other, file);
  assert.equal(reader.readVerifiedAnchorSummary(file, 'context', next.hash), undefined, 'symlink replacement cannot use authenticated summary');
  fs.unlinkSync(file); fs.renameSync(other, file);
  publish(); const priorSummary = reader.readVerifiedAnchorSummary(file, 'context', next.hash);
  fs.writeFileSync(file, canonical(entries));
  const changedAfterRead = fs.openSync(output, 'w');
  try { assert.throws(() => reader.appendedAnchorLog(file, { seq: next.seq + 1, hash: 'hash-' + (next.seq + 1) }, validate,
    priorSummary.rspProof)[reader.ATOMIC_JSON_WRITER](changedAfterRead), /policy-anchor-log-source-changed/); }
  finally { fs.closeSync(changedAfterRead); }

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
      const target = path.join(copy, 'dist/src/services', name), pristineSource = fs.readFileSync(target, 'utf8');
      const source = name === 'policy-anchor-log.js' ? ownerPatch(pristineSource).next : pristineSource;
      const patched = patchSource(source); assert.deepEqual(patched.missing, [], name);
      if (name === 'policy-ledger-anchor.js') assert(patchSource(source.replace(
        'if (!validEntry(value, summary.count, prev))', 'if (false)')).missing.length,
      'missing native initial chain authentication refuses');
      assert.equal(reverse(patched.next), source); assert(isPatched(patched.next));
      assert.equal(patchSource(historicalPatchSource(source).next).next, patched.next, name + ' exact149 migration with owner parser');
      assert.equal(patchSource(historicalSummaryPatchSource(source).next).next, patched.next, name + ' prior summary-copy migration');
      const instrumented = name === 'policy-ledger-anchor.js' ? patched.next
        .replace('function validEntry(value, seq, prev) {', 'function validEntry(value, seq, prev) {\n    rspTestStats.validated++;')
        .replace('if (reused) return reused;', 'if (reused) { rspTestStats.hits++; return reused; }')
        + '\nexport const rspTestStats = { validated: 0, hits: 0 };\nexport const rspTest = { readLog, validEntry, entryHash, context: rspAnchorSummaryContext };\n' : patched.next;
      fs.writeFileSync(target, instrumented);
    }
    const native = await import(pathToFileURL(path.join(copy, 'dist/src/services/policy-runtime.js')));
    const anchors = await import(pathToFileURL(path.join(copy, 'dist/src/services/policy-ledger-anchor.js')));
    const nativeReader = await import(pathToFileURL(path.join(copy, 'dist/src/services/policy-anchor-log.js')));
    const root = path.join(temporary, 'synthetic-project'); fs.mkdirSync(root);
    const request = () => ({ identity: { id: 'synthetic-test', type: 'agent' }, action: { type: 'memory.read', resource: 'fixture' } });
    for (let i = 0; i < 4; i++) await native.withPolicyTransaction(root, engine => {
      for (let n = 0; n < 8; n++) engine.evaluate(request());
    });
    assert(anchors.rspTestStats.hits >= 2, 'current native transactions reuse freshly hashed published summaries');
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

    // Component timing only: native full-chain parser versus exact-byte reuse.
    // Optional real history is copied into this disposable fixture; no live file is written.
    const benchRoot = path.join(temporary, 'history-benchmark'), benchFile = path.join(benchRoot, '.claude-flow/policy/ledger-anchors.json');
    fs.mkdirSync(path.dirname(benchFile), { recursive: true });
    const realHistory = process.env.RSP_ANCHOR_BENCH_SOURCE;
    if (realHistory) {
      assert.equal(path.basename(realHistory), 'ledger-anchors.json');
      const source = fs.openSync(realHistory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { assert(fs.fstatSync(source).isFile()); fs.writeFileSync(benchFile, fs.readFileSync(source), { mode: 0o600 }); }
      finally { fs.closeSync(source); }
    } else {
      let prev = null; const history = [];
      for (let seq = 0; seq < 20000; seq++) {
        const item = { seq, length: 1, headHash: 'fixture-head', prevAnchorHash: prev, ts: seq, event: 'append' };
        item.hash = anchors.rspTest.entryHash(item); history.push(item); prev = item.hash;
      }
      fs.writeFileSync(benchFile, canonical(history), { mode: 0o600 });
    }
    const contextState = { ledgerLength: 1, ledgerHead: 'component-benchmark', retainedFrom: 0 };
    const mark = performance.now(), startValidations = anchors.rspTestStats.validated;
    const assessed = anchors.rspTest.readLog(benchRoot, undefined, contextState);
    const coldMs = performance.now() - mark;
    assert.notEqual(assessed, 'corrupt'); assert(assessed.count > 1);
    assert.equal(anchors.rspTestStats.validated - startValidations, assessed.count, 'every original anchor initially authenticated natively');
    const newTip = { ...assessed.last, seq: assessed.count, prevAnchorHash: assessed.last.hash, ts: Date.now() };
    newTip.hash = anchors.rspTest.entryHash(newTip);
    const publication = nativeReader.appendedAnchorLog(benchFile, newTip, anchors.rspTest.validEntry, assessed.rspProof);
    const benchTemp = benchFile + '.temporary', benchFd = fs.openSync(benchTemp, 'w', 0o600);
    try { publication[nativeReader.ATOMIC_JSON_WRITER](benchFd); fs.fsyncSync(benchFd); } finally { fs.closeSync(benchFd); }
    fs.renameSync(benchTemp, benchFile);
    nativeReader.publishVerifiedAnchorSummary(publication, benchFile, anchors.rspTest.context(benchRoot, contextState), newTip.hash);
    const hotMark = performance.now(), hotValidations = anchors.rspTestStats.validated, hotHits = anchors.rspTestStats.hits;
    const hot = anchors.rspTest.readLog(benchRoot, newTip.hash, contextState);
    const warmMs = performance.now() - hotMark;
    assert.equal(anchors.rspTestStats.hits, hotHits + 1); assert.equal(anchors.rspTestStats.validated, hotValidations);
    assert.equal(hot.count, assessed.count + 1); assert.deepEqual(hot.last, newTip); assert.equal(hot.mirrorIncluded, true);
    const fullMark = performance.now();
    const fullAgain = anchors.rspTest.readLog(benchRoot, newTip.hash, contextState);
    const fullAgainMs = performance.now() - fullMark;
    assert.deepEqual({ ...hot, rspProof: null }, { ...fullAgain, rspProof: null }, 'same complete summary on exactly the same final bytes');
    console.log(JSON.stringify({ anchorHistoryBenchmark: { source: realHistory ? 'read-only real history copy' : 'synthetic native hash chain',
      entries: hot.count, bytes: fs.statSync(benchFile).size, coldMs, warmMs, fullAgainMs,
      rssBytes: process.memoryUsage().rss, scope: 'anchor authentication component; not live policy or hook timing' } }));
  } else console.log('native-current qualification not requested (set RSP_POLICY_NATIVE_ROOT)');
} finally {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('authenticated anchor copy regression passed');
