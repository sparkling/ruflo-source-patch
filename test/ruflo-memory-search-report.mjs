import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { NAME, SEARCH_REPORT, FIXED_REPORT, NATIVE_HELPER, nativeSearchReporting } from '../lib/ruflo-memory-search-report/patcher.mjs';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-search-report-')));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
const root = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli');
const dir = path.join(root, 'dist/src/mcp-tools');
const memory = path.join(root, 'dist/src/memory');
const file = path.join(dir, 'memory-tools.js');
const pristine = fs.readFileSync(new URL('./fixtures/memory-search-report-3.71.1.js', import.meta.url), 'utf8');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
write(path.join(root, 'package.json'), '{"name":"@claude-flow/cli","version":"3.71.1","type":"module"}');
write(file, pristine);
write(path.join(memory, 'memory-initializer.js'), `export function getHNSWStatus() {
  if (globalThis.__reportProbe.fail) throw Error('status unavailable');
  return {algorithm:globalThis.__reportProbe.algorithm};
}`);
write(path.join(memory, 'memory-bridge.js'), `export const shouldDisableNativeBridge=()=>globalThis.__reportProbe.disabled;
export const getBridgeFailureReason=()=>globalThis.__reportProbe.reason;`);
const { apply, inspect } = await import('../lib/cwd/patch-library.mjs');
let generation = 0;
const report = async () => (await import(pathToFileURL(file).href + '?v=' + generation++)).report;
const args = { query:'test', results:[{key:'source-a',similarity:0.75}], duration:1.25,
  thresholdWasDefault:true, smartFallbackReason:'native optional SmartRetrieval unavailable',
  nearMisses:async()=>({nearMisses:[{key:'near'}]}) };
try {
  assert.equal(createHash('sha256').update(pristine).digest('hex'), '1ac2a79fb70a4503b90521d90b1a50945021df92c1e165692130ebec0933dfa7');
  globalThis.__reportProbe = {algorithm:'brute-force-cosine'};
  assert.equal((await (await report())(args)).backend, 'HNSW + sql.js', 'reproduce misleading published response');
  const applied = apply([NAME]);
  assert.equal(applied.errors, 0, JSON.stringify(applied));
  assert.equal(applied.incomplete, 0, JSON.stringify(applied));
  assert.equal(applied.patched, 1);
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), pristine);
  assert.equal(apply([NAME]).patched, 0);
  assert.equal(spawnSync(process.execPath, ['--check', file]).status, 0);
  const handler = await report();
  for (const [probe, expected] of [
    [{algorithm:'brute-force-cosine'}, 'sqlite (bridge, brute-force cosine)'],
    [{algorithm:'hnsw'}, 'sql.js + HNSW'],
    [{algorithm:'hnsw',disabled:true,reason:'explicit native bridge gate'}, 'sql.js + HNSW (native bridge disabled: explicit native bridge gate)'],
    [{fail:true}, 'sqlite'],
  ]) {
    globalThis.__reportProbe = probe;
    const result = await handler(args);
    assert.equal(result.backend, expected);
    assert.deepEqual(result.results, args.results, 'ranking and evidence unchanged');
    assert.equal(result.smartFallback, args.smartFallbackReason, 'fallback diagnostics survive');
    assert.equal(result.searchTime, '1.25ms');
  }
  const empty = await handler({...args,results:[]});
  assert.deepEqual(empty.nearMisses, [{key:'near'}]);
  assert.equal(empty.total, 0);
  apply([]);
  assert.equal(fs.readFileSync(file, 'utf8'), pristine, 'exact uninstall');
  const native = pristine.replace(SEARCH_REPORT, FIXED_REPORT);
  write(file, native);
  assert.equal(nativeSearchReporting(native), true);
  const nativeApply = apply([NAME]);
  assert.equal(nativeApply.patched, 0, 'upstream correction needs no local overlay');
  assert.equal(nativeApply.incomplete, 0);
  assert.equal(inspect()[NAME].native, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), native);
  for (const drift of [pristine + pristine, pristine.replace(NATIVE_HELPER, 'async function describeBackend() {return "invented";}')]) {
    write(file, drift);
    const rejected = apply([NAME]);
    assert.ok(rejected.incomplete > 0, JSON.stringify(rejected));
    assert.equal(fs.readFileSync(file, 'utf8'), drift, 'unknown source remains untouched');
    fs.rmSync(file + '.rsp-backup', {force:true});
  }
  const help = spawnSync(process.execPath, ['bin/cli.mjs','--help'], {encoding:'utf8'});
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes(NAME));
  console.log('ruflo-memory-search-report: native reproduction, truthful labels, fallback/result preservation, exact rollback and native correction passed');
} finally {
  delete globalThis.__reportProbe;
  fs.rmSync(scratch, {recursive:true,force:true});
}
