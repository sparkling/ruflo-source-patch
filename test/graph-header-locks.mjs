import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { HEADER_ANCHOR, HEADER_REPLACEMENT, GRAPH_HEADER_ENTRY } from '../lib/ruflo-sqlite-owner/header.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-graph-header-'));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
const { composeCliContribution } = await import('../lib/cwd/patch-library.mjs');
const pristine = `import * as fs from 'fs';\n${HEADER_ANCHOR}`;
const composed = composeCliContribution(pristine, [GRAPH_HEADER_ENTRY]);
assert.deepEqual(composed.missing, []);
assert.ok(composed.next.includes(HEADER_REPLACEMENT));
assert.ok(composeCliContribution(pristine + '\n' + HEADER_ANCHOR, [GRAPH_HEADER_ENTRY]).missing.length);
assert.ok(composeCliContribution(pristine.replace('fs.openSync', 'fs.unexpectedOpen'), [GRAPH_HEADER_ENTRY]).missing.length);
const modulePath = path.join(scratch, 'header.mjs');
fs.writeFileSync(modulePath, `import fs from 'node:fs';
import { execFileSync as __rspHeaderExec } from 'node:child_process';
export ${HEADER_REPLACEMENT}\n`);
const { readHeaderBytes } = await import(pathToFileURL(modulePath));
try {
  const blob = path.join(scratch, 'RFE1 with spaces');
  fs.writeFileSync(blob, 'RFE1' + 'x'.repeat(100));
  assert.equal(readHeaderBytes(blob, 64).length, 64);
  assert.equal(readHeaderBytes(blob, 4).toString(), 'RFE1');
  assert.throws(() => readHeaderBytes(blob, 0));
  assert.throws(() => readHeaderBytes(blob, 101));
  assert.throws(() => readHeaderBytes(path.join(scratch, 'missing'), 4));
  assert.equal(fs.readFileSync(blob, 'utf8'), 'RFE1' + 'x'.repeat(100));
  assert.equal(GRAPH_HEADER_ENTRY.edits[1].find, HEADER_ANCHOR);
  // Empty child environment must prevent inherited NODE_OPTIONS from loading
  // unrelated host hooks or introducing another driver into the header reader.
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--require=/nonexistent/rsp-header-poison';
  try { assert.equal(readHeaderBytes(blob, 4).toString(), 'RFE1'); }
  finally { if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous; }

  const cli = process.env.RSP_TEST_NATIVE_CLI
    || path.join(os.homedir(), '.npm-global/lib/node_modules/@claude-flow/cli');
  const shared = path.join(cli, 'dist/src/memory/shared-sqlite.js');
  if (process.platform !== 'win32' && fs.existsSync(shared)) {
    const { loadBetterSqlite3 } = await import(pathToFileURL(shared));
    const vendor = fs.readFileSync(path.join(cli, 'dist/src/memory/graph-edge-writer.js'), 'utf8');
    const actual = composeCliContribution(vendor, [GRAPH_HEADER_ENTRY]);
    assert.deepEqual(actual.missing, []);
    assert.ok(actual.next.includes(HEADER_REPLACEMENT), 'installed native surface composes');
    const Database = await loadBetterSqlite3();
    const original = new Function('fs', `${HEADER_ANCHOR}; return readHeaderBytes;`)(fs);
    for (const [label, read] of [['original', original], ['patched', readHeaderBytes]]) {
      const file = path.join(scratch, `${label}.db`);
      const db = new Database(file);
      try {
        db.pragma('journal_mode=WAL');
        db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t VALUES (1)');
        const wal = fs.statSync(file + '-wal').ino;
        read(file, 64);
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
          const {loadBetterSqlite3}=await import(${JSON.stringify(pathToFileURL(shared).href)});
          const D=await loadBetterSqlite3(); const db=new D(${JSON.stringify(file)});
          db.exec('INSERT INTO t VALUES (2)'); db.close();`], { encoding: 'utf8', timeout: 15000 });
        assert.equal(child.status, 0, child.stderr);
        if (label === 'patched') {
          assert.equal(fs.statSync(file + '-wal').ino, wal, 'live WAL identity preserved');
          assert.deepEqual(db.prepare('SELECT id FROM t ORDER BY id').all(), [{ id: 1 }, { id: 2 }]);
          db.exec('INSERT INTO t VALUES (3)');
          assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
          const verify = spawnSync(process.execPath, ['--input-type=module', '-e', `
            const {loadBetterSqlite3}=await import(${JSON.stringify(pathToFileURL(shared).href)});
            const D=await loadBetterSqlite3(); const db=new D(${JSON.stringify(file)});
            console.log(JSON.stringify(db.prepare('SELECT id FROM t ORDER BY id').all())); db.close();`],
          { encoding: 'utf8', timeout: 15000 });
          assert.equal(verify.status, 0, verify.stderr);
          assert.deepEqual(JSON.parse(verify.stdout), [{ id: 1 }, { id: 2 }, { id: 3 }]);
          assert.equal(fs.statSync(file + '-wal').ino, wal);
        } else {
          assert.equal(fs.existsSync(file + '-wal'), false, 'original defect reproduced');
        }
      } finally { db.close(); }
    }
    console.log('PASS graph header native two-process lock regression');
  } else {
    console.log('SKIP native POSIX regression: installed shared SQLite loader unavailable');
  }
  console.log('PASS graph header byte bounds, encryption magic, errors and environment isolation');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
