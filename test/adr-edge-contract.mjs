// ADR edge keys must round-trip through guarded memory and retain legacy meaning.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  EDGE_MARKER, EDGE_HELPER_ANCHOR, EDGE_PARSE_ANCHOR, EDGE_HELPER_054, EDGE_PARSE_054, patchEdgeHelpers, edgeHelpersPatched,
} from '../lib/adr-io-safety/edge-contract.mjs';
import { patchSource } from '../lib/adr-io-safety/patcher.mjs';
import { probeNativeRoot } from '../lib/adr-io-safety/probes.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-edge-contract-'));
try {
  const helper = EDGE_HELPER_ANCHOR + '\n' + EDGE_PARSE_ANCHOR;
  const patched = patchEdgeHelpers(helper);
  assert.deepEqual(patched.missing, []);
  assert.ok(edgeHelpersPatched(patched.next));
  const previous = patched.next.replace(String.raw`  if (!match) match = /^([\w.-]+):([\w.-]+?)__([\w.-]+)$/.exec(key);` + '\n', '');
  assert.notEqual(previous, patched.next);
  assert.deepEqual(patchEdgeHelpers(previous).missing, []);
  assert.equal(patchEdgeHelpers(previous).next, patched.next);
  assert.equal(patchEdgeHelpers(patched.next).next, patched.next);
  assert.ok(patchEdgeHelpers(helper + '\n' + EDGE_HELPER_ANCHOR).missing.some(s => s.includes('AMBIGUOUS')));
  assert.ok(patchEdgeHelpers(helper.replace('return `', 'return  `')).missing.length > 0);
  const current = patchEdgeHelpers(EDGE_HELPER_054 + '\n' + EDGE_PARSE_054);
  assert.deepEqual(current.missing, []);
  assert.ok(edgeHelpersPatched(current.next));
  assert.ok(patchEdgeHelpers(EDGE_HELPER_054 + '\n' + EDGE_HELPER_054 + '\n' + EDGE_PARSE_054)
    .missing.some(s => s.includes('AMBIGUOUS')));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib/index-records.mjs'), patched.next);
  const { edgeKey, parseEdgeKey } = await import(pathToFileURL(path.join(dir, 'lib/index-records.mjs')));
  const expected = { relation: 'depends-on', from: 'ADR-006', to: 'ADR-005' };
  assert.equal(edgeKey(expected), 'depends-on:ADR-006:ADR-005');
  assert.equal(edgeKey({ ...expected, capturedAt: 'different' }), edgeKey(expected));
  for (const key of [
    edgeKey(expected), 'depends-on:ADR-006__ADR-005', 'depends-on:ADR-006->ADR-005',
    'depends-on:ADR-006->ADR-005:1234-abc', 'depends-on-ADR-006-to-ADR-005',
  ]) {
    assert.deepEqual(parseEdgeKey(key), { ...expected, key });
  }
  for (const key of [
    '', 'depends-on:ADR-006:ADR-005:extra', 'depends-on-ADR-006-to-ADR-005-to-ADR-007',
    'depends-on:ADR-006->ADR-005:bad', 'depends-on:../bad:ADR-005',
    'depends-on:ADR-006->ADR-005\n', 'depends-on:ADR-006:ADR-005\n',
  ]) assert.equal(parseEdgeKey(key), null, key);
  for (const from of ['../bad', 'ADR:006', 'ADR-006;exit', 'ADR-006>file', 'x'.repeat(257)]) {
    assert.throws(() => edgeKey({ ...expected, from }));
  }
  assert.ok(!/[;&|`$(){}[\]<>!#\\\0]/.test(edgeKey(expected)));

  const vendor = fs.readFileSync(new URL('./fixtures/adr-io-safety-0.4.1/verify.mjs', import.meta.url), 'utf8');
  const verify = patchSource(vendor);
  assert.deepEqual(verify.missing, []);
  fs.writeFileSync(path.join(dir, 'verify.mjs'), verify.next);
  const fakeCli = path.join(dir, 'ruflo.cjs');
  fs.writeFileSync(fakeCli, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const option = n => args[args.indexOf('--'+n)+1];
const ns = option('namespace');
const key = process.env.EDGE_TEST_KEY;
if (args[1] === 'list') {
  process.stdout.write(JSON.stringify(ns === 'adr-patterns'
    ? [{key:'ADR-006'},{key:'ADR-005'}] : [{key}]));
} else if (args[1] === 'retrieve') {
  if (process.env.EDGE_TEST_READ_FAILURE) process.exit(7);
  process.stdout.write(process.env.EDGE_TEST_VALUE);
} else process.exit(9);
`, { mode: 0o755 });
  const run = (key, value, extra = {}) => spawnSync(process.execPath, [path.join(dir, 'verify.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, ADR_ROOT: dir, ADR_DB_PATH: path.join(dir, 'fake.db'),
      RUFLO_ADR_CLI: fakeCli, VERIFY_STRICT: '1', VERIFY_FORMAT: 'json',
      EDGE_TEST_KEY: key, EDGE_TEST_VALUE: typeof value === 'string' ? value : JSON.stringify(value), ...extra },
  });
  for (const key of [edgeKey(expected), 'depends-on-ADR-006-to-ADR-005', 'depends-on:ADR-006->ADR-005', 'depends-on:ADR-006__ADR-005']) {
    const result = run(key, expected);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).edgeCount, 1);
  }
  for (const value of ['{}', 'not json', { ...expected, to: 'ADR-999' }, []]) {
    const result = run('depends-on-ADR-006-to-ADR-005', value);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid adr-edges value/);
  }
  assert.equal(run(edgeKey(expected), expected, { EDGE_TEST_READ_FAILURE: '1' }).status, 1);
  const missingEndpoint = { ...expected, to: 'ADR-999' };
  assert.equal(run(edgeKey(missingEndpoint), missingEndpoint).status, 1);
  // Native retirement must execute the helper proof, not mistake a syntax
  // failure in the proof itself for evidence that a correct helper is broken.
  const root = path.join(dir, 'candidate');
  fs.mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/lib/index-records.mjs'), patched.next.replace(EDGE_MARKER, 'candidate'));
  fs.writeFileSync(path.join(root, 'scripts/verify.mjs'), verify.next);
  assert.match(probeNativeRoot(root).evidence, /verify.mjs still carries/);
  fs.writeFileSync(path.join(root, 'scripts/lib/index-records.mjs'), helper);
  assert.match(probeNativeRoot(root).evidence, /fails memory-safe identity/);
  console.log('✓ ADR edge contract: deterministic safe identity, legacy parsing, refusal, exact-value checks and strict dangling gate');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
