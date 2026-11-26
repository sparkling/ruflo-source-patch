// Execute only the reviewed native guard in a disposable fixture. The real KB,
// updater and query engine are never opened by this retirement proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { StringDecoder } from 'node:string_decoder';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discover, isNative, preflight } from './patcher.mjs';

const self = fileURLToPath(import.meta.url);
export async function proveNative(source) {
  assert(isNative(source), 'unreviewed native forge guard');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-forge-'));
  let queryFails = false, queryCalls = 0;
  try {
    const body = source.replace(/^#!.*\n/, '').replace(/^import .*;\n/gm, '');
    const { streamPassages, checkStore } = vm.runInNewContext(
      body.slice(0, body.indexOf('async function main()')) + '; ({streamPassages,checkStore})',
      { fs, path, StringDecoder, searchKb: async () => {
        queryCalls++;
        if (queryFails) throw Error('query unavailable');
        return [{ text: 'complete source content', score: 1 }];
      } }, { timeout: 1000 });
    const file = path.join(dir, 'input.jsonl');
    const cases = [
      [JSON.stringify({ text: 'a\u2028b\u2029c' }) + '\n', 1, 0],
      ['{"text":"one"}\r\n{"text":"two"}\r\n', 2, 0],
      ['{"text":"last"}', 1, 0], ['\n \n{"text":"one"}\n', 1, 0],
      ['{"text":\n{"text":"two"}\n', 2, 1], ['{"text":""}\n', 1, 1],
      [JSON.stringify({ text: 'x'.repeat(65520) + 'é\u2028終' }), 1, 0],
    ];
    for (const [bytes, count, bad] of cases) {
      fs.writeFileSync(file, bytes);
      let invalid = 0;
      assert.equal(await streamPassages(file, row => { if (!row?.text) invalid++; }), count);
      assert.equal(invalid, bad);
    }
    await assert.rejects(streamPassages(path.join(dir, 'absent'), () => {}), { code: 'ENOENT' });
    await assert.rejects(streamPassages(file, () => { throw Error('callback failure'); }), /callback failure/);
    function rows(values, count = values.length) {
      fs.writeFileSync(path.join(dir, 'fixture.passages.jsonl'), values.map(JSON.stringify).join('\n'));
      fs.writeFileSync(path.join(dir, 'fixture.rvf'), 'fixture');
      fs.writeFileSync(path.join(dir, 'fixture.meta.json'), JSON.stringify({ entries:
        Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i + 1), { preview: '' }])) }));
      fs.writeFileSync(path.join(dir, 'fixture.rvf.idmap.json'), JSON.stringify({ ids: values.map(r => r.id) }));
    }
    const valid = [{ id: '1', text: 'a\u2028b\u2029c' }];
    const check = () => checkStore({ dir, name: 'fixture' });
    rows(valid);
    assert.equal((await check()).fails.length, 0);
    assert(queryCalls > 0);
    queryFails = true;
    assert((await check()).fails.some(f => /LIVE QUERY failed/.test(f)));
    queryFails = false;
    rows([{ id: '1', text: '' }]);
    assert((await check()).fails.some(f => /TRUNCATION/.test(f)));
    rows(valid, 2);
    assert((await check()).fails.some(f => /PARITY/.test(f)));
    rows(Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), text: 'x'.repeat(240) })));
    assert((await check()).fails.some(f => /TRUNCATION/.test(f)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export function probeNativeForge() {
  const files = discover();
  if (files.length !== 1 || !preflight().ok) return { state: 'unknown', evidence: 'native guard path/source is unverified' };
  if (!isNative(fs.readFileSync(files[0], 'utf8'))) return { state: 'live', evidence: 'legacy guard still needs the JSONL correction' };
  const run = spawnSync(process.execPath, [self, files[0]], { encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
  return run.status === 0 && !run.error && run.stdout.trim() === 'native-forge-proof:ok'
    ? { state: 'superseded', evidence: 'reviewed native guard passes LF/Unicode/UTF8/EOF/error and parity/truncation/query-refusal fixtures; corpus unchanged' }
    : { state: 'unknown', evidence: 'native forge behavioral proof did not pass' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  await proveNative(fs.readFileSync(process.argv[2], 'utf8'));
  console.log('native-forge-proof:ok');
}
