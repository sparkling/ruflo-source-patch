import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import readline from 'node:readline';

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-forge-jsonl-')));
process.env.RUFLO_SOURCE_PATCH_HOME = dir;
process.env.RSP_RUVNET_BRAIN_HOME = path.join(dir, '.cache/ruvnet-brain');
process.env.RUFLO_GLOBAL_ROOT = path.join(dir, 'global');
process.env.RUFLO_NPX_ROOT = path.join(dir, 'npx');
process.env.RSP_CODEX_HOME = path.join(dir, '.codex');
const patcher = await import('../lib/brain-forge-jsonl/patcher.mjs');
const source = fs.readFileSync(new URL('./fixtures/brain-forge-jsonl/forge-guard.mjs', import.meta.url), 'utf8');
const patched = patcher.patchSource(source);
assert.deepEqual(patched.missing, []);
assert(patcher.isPatched(patched.next));
assert.equal(patcher.reverseSource(patched.next), source);
assert.equal(patcher.patchSource(patched.next).next, patched.next);
assert(patcher.patchSource(source + '\n// drift').missing.length);
assert(!patcher.isPatched(patched.next.replace('emptyText++', 'emptyText += 0')));
const reader = vm.runInNewContext(patched.next.slice(patched.next.indexOf('async function streamPassages'),
  patched.next.indexOf('\nasync function checkStore')) + '; streamPassages', { fs });
const original = vm.runInNewContext(`(${patcher.ORIGINAL})`, { fs, readline });
const file = path.join(dir, 'passages.jsonl');
try {
  const unicode = JSON.stringify({ text: 'a\u2028b\u2029c' }) + '\n';
  fs.writeFileSync(file, unicode);
  assert.equal(await original(file, () => {}), 3, 'red: original splits Unicode inside a string');
  const cases = [
    [unicode, 1, 0], ['{"text":"one"}\r\n{"text":"two"}\r\n', 2, 0],
    ['{"text":"last"}', 1, 0], ['\n \n{"text":"one"}\n', 1, 0],
    ['{"text":\n{"text":"two"}\n', 2, 1], ['{"text":""}\n', 1, 1],
    [JSON.stringify({ text: 'x'.repeat(65520) + 'é\u2028終' }), 1, 0],
  ];
  for (const [bytes, count, bad] of cases) {
    fs.writeFileSync(file, bytes);
    let invalid = 0;
    assert.equal(await reader(file, value => { if (!value?.text) invalid++; }), count);
    assert.equal(invalid, bad);
  }
  await assert.rejects(reader(path.join(dir, 'absent'), () => {}), { code: 'ENOENT' });
  fs.writeFileSync(file, unicode);
  await assert.rejects(reader(file, () => { throw Error('callback failure'); }), /callback failure/);

  // Execute unchanged checkStore with only searchKb replaced by a deterministic
  // fixture. This proves validation branches, not a real RVF query.
  let queryCalls = 0, queryFails = false;
  const body = patched.next.replace(/^#!.*\n/, '').replace(/^import .*;\n/gm, '');
  const check = vm.runInNewContext(body.slice(0, body.indexOf('async function main()'))
    + '; checkStore', { fs, path, searchKb: async () => {
      queryCalls++;
      if (queryFails) throw Error('query unavailable');
      return [{ text: 'complete source content', score: 1 }];
    } });
  const rows = [{ id: '1', text: 'a\u2028b\u2029c' }];
  function writeRows(values, metaCount = values.length) {
    fs.writeFileSync(path.join(dir, 'fixture.passages.jsonl'), values.map(JSON.stringify).join('\n'));
    fs.writeFileSync(path.join(dir, 'fixture.rvf'), 'fixture');
    fs.writeFileSync(path.join(dir, 'fixture.meta.json'), JSON.stringify({ entries:
      Object.fromEntries(Array.from({ length: metaCount }, (_, i) => [String(i + 1), { preview: '' }])) }));
    fs.writeFileSync(path.join(dir, 'fixture.rvf.idmap.json'), JSON.stringify({ ids: values.map(r => r.id) }));
  }
  writeRows(rows);
  let verdict = await check({ dir, name: 'fixture' });
  assert.equal(verdict.fails.length, 0, verdict.fails.join(';'));
  assert(queryCalls > 0);
  queryFails = true;
  assert((await check({ dir, name: 'fixture' })).fails.some(f => /LIVE QUERY failed/.test(f)));
  queryFails = false;
  writeRows([{ id: '1', text: '' }]);
  assert((await check({ dir, name: 'fixture' })).fails.some(f => /TRUNCATION/.test(f)));
  writeRows(rows, 2);
  assert((await check({ dir, name: 'fixture' })).fails.some(f => /PARITY/.test(f)));
  writeRows(Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), text: 'x'.repeat(240) })));
  assert((await check({ dir, name: 'fixture' })).fails.some(f => /TRUNCATION/.test(f)));

  const kb = path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'kb');
  fs.mkdirSync(kb, { recursive: true });
  const guard = path.join(kb, 'forge-guard.mjs');
  fs.writeFileSync(guard, source);
  assert(patcher.preflight().ok);
  const compose = await import('../lib/plugin-compose.mjs');
  const result = compose.applyComposed([patcher.NAME]);
  assert.equal(result.errors || 0, 0, JSON.stringify(result));
  assert.equal(fs.readFileSync(guard, 'utf8'), patched.next);
  assert.equal(compose.applyComposed([patcher.NAME]).patched, 0);
  assert.equal(compose.statusComposed([patcher.NAME])[patcher.NAME].patched, 1);
  compose.reconcile([], [patcher.NAME]);
  assert.equal(fs.readFileSync(guard, 'utf8'), source);
  fs.unlinkSync(guard); fs.symlinkSync(file, guard);
  assert(!patcher.preflight().ok, 'symlink refused');
  console.log('PASS forge JSONL: Unicode, CRLF, EOF, malformed/empty data, UTF8, I/O, callback, validation, composition and restoration');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
