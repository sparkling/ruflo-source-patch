// Synthetic native-API proof; no managed journal, database or updater is opened.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { constants as bufferConstants } from 'node:buffer';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existingPathRelative } from '../path-containment.mjs';

export async function exerciseOutbox(source, root, { large = false } = {}) {
  fs.mkdirSync(root, { recursive: true });
  const member = path.join(root, 'outbox.mjs'); fs.writeFileSync(member, source);
  const { ProgressionOutbox } = await import(pathToFileURL(member).href);
  let fsyncs = 0;
  const outbox = new ProgressionOutbox({ projectRoot: root, fsync: fd => { assert.equal(fs.fstatSync(fd).isFile(), true); fsyncs++; } });
  const write = text => { fs.mkdirSync(path.dirname(outbox.path), { recursive: true }); fs.writeFileSync(outbox.path, text); };
  assert.deepEqual(outbox.records(), [], 'absent journal stays absent');
  assert(!fs.existsSync(path.dirname(outbox.path)));
  // Both historic nonblank-record indices and native physical-line indices are valid,
  // but require one consistent, exact convention for every malformed record.
  write('{}\n\nmalformed\n');
  let physicalLines = false;
  try { outbox.records(); } catch (error) { physicalLines = error.message === 'malformed outbox record at line 3'; }
  const fixtures = [
    ['', []], ['\n\n', []], ['{}\n\n1\ntrue\nnull\n["x"]\n', [{}, 1, true, null, ['x']]],
    ['{}\r\n{"text":"雪😀"}\r\n', [{}, { text: '雪😀' }]],
    ['{}\n{"tail":true}', [{}, { tail: true }]], ['{}\n{"tail":', [{}]],
    ['{}\n  ', [{}]], ['{}\n\nmalformed\n', `malformed outbox record at line ${physicalLines ? 3 : 2}`],
    ['\nmalformed\n', `malformed outbox record at line ${physicalLines ? 2 : 1}`], ['{}\r\n\r\n', physicalLines ? [{}] : 'malformed outbox record at line 2'],
  ];
  for (const [text, expected] of fixtures) {
    write(text);
    if (typeof expected === 'string') assert.throws(() => outbox.records(), error => error.message === expected);
    else assert.deepEqual(outbox.records(), expected);
  }
  // Place every UTF-8 byte width across the production 64 KiB seam.
  for (const char of ['é', '雪', '😀']) for (let offset = 1; offset < Buffer.byteLength(char); offset++) {
    const prefix = '{"text":"', padding = 'x'.repeat(65536 - Buffer.byteLength(prefix) - offset);
    const value = { text: padding + char + 'tail' }; write(JSON.stringify(value) + '\n'); assert.deepEqual(outbox.records(), [value]);
  }
  const long = { text: 'x'.repeat(140000) + '雪😀' };
  write(JSON.stringify(long)); assert.deepEqual(outbox.records(), [long], 'complete unterminated multi-chunk row retained');
  const readWhole = fs.readFileSync, read = fs.readSync;
  let requested = 0, readBytes = 0;
  const ownFd = fd => typeof fd === 'number' && fs.fstatSync(fd).size === fs.statSync(outbox.path).size;
  fs.readFileSync = function(file, ...args) {
    if ((file === outbox.path || ownFd(file)) && fs.statSync(outbox.path).size > 128 * 1024) throw Error('whole-journal read is forbidden by the synthetic proof');
    return readWhole.call(this, file, ...args);
  };
  fs.readSync = function(fd, buffer, offset, length, position) {
    requested = Math.max(requested, length);
    const count = read.call(this, fd, buffer, offset, length, position); readBytes += count; return count;
  };
  try {
    assert.deepEqual(outbox.records(), [long], 'large rows use bounded reads');
    const before = fsyncs; outbox.appendRecord({ type: 'fixture-append' }); assert.equal(fsyncs, before + 1);
    assert.deepEqual(outbox.records(), [long, { type: 'fixture-append' }]);
  } finally { fs.readFileSync = readWhole; fs.readSync = read; }
  assert(requested <= 65536, 'reads never request a journal-sized buffer');
  for (const torn of ['{"broken":', '{}\n{"broken":', '{}\n   ']) {
    write(torn); const before = fsyncs;
    assert.throws(() => outbox.appendRecord({ type: 'fixture' }), /incomplete outbox final record/);
    assert.equal(fs.readFileSync(outbox.path, 'utf8'), torn, 'torn suffix preserved byte-for-byte'); assert.equal(fsyncs, before);
  }
  write('{}'); outbox.appendRecord({ type: 'fixture' }); assert.equal(fs.readFileSync(outbox.path, 'utf8'), '{}\n{"type":"fixture"}\n');
  assert.equal(fs.statSync(outbox.path).mode & 0o777, 0o600);
  const snapshot = (eventKey, payloadDigest) => ({ eventKey, payloadDigest, fixture: 'public' });
  const receipt = (eventKey, payloadDigest) => ({ eventKey, payloadDigest, readbackDigest: payloadDigest, committedAt: '2026-10-04T00:00:00.000Z' });
  write('');
  outbox.appendSnapshot(snapshot('a', 'a1')); outbox.markCommitted(receipt('a', 'a1'));
  outbox.appendSnapshot(snapshot('b', 'b1')); outbox.appendSnapshot(snapshot('b', 'b1'));
  outbox.appendSnapshot(snapshot('c', 'c1')); outbox.appendSnapshot(snapshot('c', 'c2'));
  outbox.appendSnapshot(snapshot('d', 'd1')); outbox.markCommitted(receipt('d', 'd2'));
  outbox.appendSnapshot(snapshot('e', 'e1')); outbox.markCommitted(receipt('e', 'e1')); outbox.markCommitted(receipt('e', 'e2'));
  assert.deepEqual(outbox.pendingSnapshots(), [snapshot('b', 'b1')]);
  assert.deepEqual(outbox.quarantinedKeys(), [{ eventKey: 'c', reason: 'outbox event key collision' },
    { eventKey: 'e', reason: 'outbox commit collision' }, { eventKey: 'd', reason: 'outbox commit digest mismatch' }]);
  assert.throws(() => outbox.markCommitted({ ...receipt('b', 'b1'), readbackDigest: 'wrong' }), /readback digest mismatch/);
  write('{"type":"unknown","eventKey":"z","payloadDigest":"z1"}\n'); assert.throws(() => outbox.pendingSnapshots(), /unsupported outbox record/);
  if (large) {
    write(''); outbox.appendSnapshot(snapshot('old', 'old-digest'));
    const fd = fs.openSync(outbox.path, 'a'), blank = Buffer.alloc(1024 * 1024, 10);
    try { while (fs.fstatSync(fd).size <= bufferConstants.MAX_STRING_LENGTH + 65536) fs.writeSync(fd, blank); }
    finally { fs.closeSync(fd); }
    const tail = { eventKey: 'new', payloadDigest: 'new-digest', text: '雪😀' };
    fs.appendFileSync(outbox.path, JSON.stringify({ type: 'snapshot', eventKey: tail.eventKey, payloadDigest: tail.payloadDigest, snapshot: tail }));
    const bytes = fs.statSync(outbox.path).size; assert(bytes > bufferConstants.MAX_STRING_LENGTH);
    readBytes = 0;
    fs.readFileSync = function(file, ...args) { if (file === outbox.path || ownFd(file)) throw Error('giant whole-file allocation forbidden'); return readWhole.call(this, file, ...args); };
    fs.readSync = function(fd, buffer, offset, length, position) { assert(length <= 65536); const count = read.call(this, fd, buffer, offset, length, position); readBytes += count; return count; };
    try {
      assert.deepEqual(outbox.pendingSnapshots(), [tail, snapshot('old', 'old-digest')]);
      assert.equal(outbox.records().length, 2);
      readBytes = 0; outbox.markCommitted(receipt('new', 'new-digest'));
      assert(readBytes <= 65537, 'append inspects only bounded final-record bytes');
      assert.deepEqual(outbox.pendingSnapshots(), [snapshot('old', 'old-digest')]); assert.deepEqual(outbox.quarantinedKeys(), []);
    } finally { fs.readFileSync = readWhole; fs.readSync = read; }
    return { hugeJournalBytes: bytes, maximumStringLength: bufferConstants.MAX_STRING_LENGTH, nativePendingPreserved: true, boundedTailRead: true };
  }
  return { nativeRecords: true, boundedUtf8Reads: true, exactTornTail: true, nativeQuarantine: true, nativeFsync: true };
}

export function probeOutboxStreamingBehavior(file, { transform = source => source } = {}) {
  let staged;
  try {
    file = path.resolve(file);
    const stat = fs.lstatSync(file), root = path.dirname(path.dirname(file));
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(root, file) === null) throw Error('unsafe native outbox proof member');
    staged = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-outbox-streaming-proof-'));
    const source = transform(fs.readFileSync(file, 'utf8')), member = path.join(staged, 'source.mjs'); fs.writeFileSync(member, source, { mode: 0o600 });
    const run = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import fs from 'node:fs';import {exerciseOutbox} from ${JSON.stringify(import.meta.url)};console.log(JSON.stringify(await exerciseOutbox(fs.readFileSync(process.argv[1],'utf8'),process.argv[2])));`,
      member, path.join(staged, 'fixture')], { encoding: 'utf8', timeout: 6000, maxBuffer: 1024 * 1024, env: { HOME: staged, PATH: process.env.PATH || '' } });
    if (run.error) return { state: 'unknown', evidence: run.error.message };
    return run.status === 0 ? { state: 'proven', evidence: 'native outbox APIs preserve all records/UTF-8/error indices/torn suffixes/quarantine/fsync with bounded journal and final-record reads' }
      : { state: 'live', evidence: 'native outbox streaming proof failed: ' + (run.stderr || run.status) };
  } catch (error) { return { state: 'unknown', evidence: error.message }; }
  finally { if (staged) fs.rmSync(staged, { recursive: true, force: true }); }
}

// Separate #390 partial containment evidence. This is not required to satisfy #387 streaming.
// Mirrors the native 4.5.7 bounded-heap regression using only synthetic, disposable history.
export async function exerciseReplayContainment(source, root) {
  fs.mkdirSync(path.join(root, '.swarm'), { recursive: true });
  const member = path.join(root, 'outbox.mjs'), journal = path.join(root, '.swarm/project-progression-outbox.jsonl');
  fs.writeFileSync(member, source);
  const fd = fs.openSync(journal, 'wx', 0o600), hash = crypto.createHash('sha256');
  try {
    for (let i = 0; i < 1024; i++) {
      const eventKey = 'event-' + i, payloadDigest = 'digest-' + i;
      const text = JSON.stringify({ type: 'snapshot', eventKey, payloadDigest,
        snapshot: { eventKey, payloadDigest, evidence: i + ':' + 'x'.repeat(128 * 1024) } }) + '\n'
        + JSON.stringify({ type: 'commit', eventKey, payloadDigest }) + '\n';
      fs.writeSync(fd, text); hash.update(text);
    }
    for (const eventKey of ['pending-z', 'pending-a']) {
      const text = JSON.stringify({ type: 'snapshot', eventKey, payloadDigest: eventKey,
        snapshot: { eventKey, payloadDigest: eventKey } }) + '\n';
      fs.writeSync(fd, text); hash.update(text);
    }
  } finally { fs.closeSync(fd); }
  const before = hash.digest('hex');
  const child = spawnSync(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e',
    `import {ProgressionOutbox} from ${JSON.stringify(pathToFileURL(member).href)};const outbox=new ProgressionOutbox({projectRoot:process.argv[1]});console.log(JSON.stringify({pending:outbox.pendingSnapshots().map(row=>row.eventKey),quarantine:outbox.quarantine}));`, root],
  { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, env: { HOME: root, PATH: process.env.PATH || '' } });
  assert.equal(child.error?.message ?? child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { pending: ['pending-a', 'pending-z'], quarantine: [] });
  const after = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(journal)) after.update(chunk);
  assert.equal(after.digest('hex'), before, 'containment never rewrites historical evidence');
  return { historicalBytes: fs.statSync(journal).size, heapLimitMiB: 64, pendingOnlyMaterialized: true };
}
