import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GRAPH_IMPORT, GRAPH_IMPORT_BOUND, GRAPH_PATH, GRAPH_PATH_BOUND,
  memoryGraphPathEntry, memoryGraphNativeSentinelEntry, GRAPH_NATIVE_PATH, GRAPH_NATIVE_SENTINEL, nativeGraphPathSatisfied } from '../lib/cwd/memory-graph-path.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-graph-path-'));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
const { composeCliContribution } = await import('../lib/cwd/patch-library.mjs');
const source = `${GRAPH_IMPORT}
export function isBridgeDbEncryptedAtRest(customDbPath) {\n${GRAPH_PATH}\n return dbPath;\n}
export async function getBridgeDb(customDbPath, opts) {\n${GRAPH_PATH}\n return dbPath;\n}`;
try {
  assert.equal(nativeGraphPathSatisfied(source), false, 'pristine graph source ignores explicit research binding');
  const patched = composeCliContribution(source, [memoryGraphPathEntry]);
  assert.deepEqual(patched.missing, []);
  assert(patched.next.includes(GRAPH_IMPORT_BOUND));
  assert.equal(patched.next.split(GRAPH_PATH_BOUND).length, 3, 'encryption sniff and native open must share precedence');
  assert.equal(nativeGraphPathSatisfied(patched.next), true);
  assert.equal(composeCliContribution(patched.next, [memoryGraphPathEntry]).next, patched.next);
  const native = patched.next.replace('    // ruflo-source-patch: explicit graph store follows native path precedence (#4291).\n', '');
  assert.equal(nativeGraphPathSatisfied(native), true, 'retirement follows behavior, not a marker');
  const split = patched.next.replace(GRAPH_PATH_BOUND, GRAPH_PATH);
  assert.equal(nativeGraphPathSatisfied(split), false, 'sniff/open mismatch must not retire');
  assert(composeCliContribution(source.replace(GRAPH_IMPORT, 'import changed from "other";'), [memoryGraphPathEntry]).missing.length);
  const configured = '/research/agentdb-memory.db';
  const resolve = expression => new Function('process', 'resolveDbPath', 'customDbPath', expression + '; return dbPath;')(
    { env: { CLAUDE_FLOW_DB_PATH: configured } }, () => configured, undefined);
  assert.equal(resolve(GRAPH_PATH_BOUND), configured);
  const upstream=source.replace(GRAPH_IMPORT,"import { resolveDbPath } from './memory-initializer.js';").replaceAll(GRAPH_PATH,GRAPH_NATIVE_PATH);
  assert.equal(nativeGraphPathSatisfied(upstream),false,'3.59.1 file resolver loses the memory sentinel');
  const residual=composeCliContribution(upstream,[memoryGraphPathEntry,memoryGraphNativeSentinelEntry]);
  assert.deepEqual(residual.missing,[]);assert(residual.next.includes(GRAPH_NATIVE_SENTINEL));
  assert.equal(nativeGraphPathSatisfied(residual.next),true);
  assert.equal(composeCliContribution(residual.next,[memoryGraphNativeSentinelEntry]).next,residual.next,'residual native guard remains recognizable after apply');
  assert(!residual.next.includes('explicit graph store follows'),'do not overlay the native file selector');
  assert.equal(nativeGraphPathSatisfied(residual.next.replace(GRAPH_NATIVE_SENTINEL,GRAPH_NATIVE_PATH)),false);
  console.log('explicit graph binding: native path precedence for sniff/open, custom override and in-memory isolation; default sibling policy unchanged; drift and split ownership refused');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
