import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discover } from './patcher.mjs';
import { isBridgeSource } from './bridge.mjs';
import { exerciseBridgePatternReceipt } from './bridge-probe.mjs';
import { composeSource } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';

export async function exercisePatternReceipt(source) {
  if (isBridgeSource(source)) return exerciseBridgePatternReceipt(source);
  const start = source.indexOf('export const agentdbPatternStore = {');
  const end = source.indexOf('// ===== agentdb_pattern_search', start);
  if (start < 0) throw new Error('native pattern handler absent');
  let body = source.slice(start, end < 0 ? source.length : end).replace('export const ', 'const ');
  body = body.replaceAll("await import('../memory/memory-initializer.js')", 'await fixtureImport()');
  const validations = source.slice(source.indexOf('const MAX_STRING_LENGTH'), source.indexOf('// Lazy-cached bridge module'));
  const make = new Function('getBridge', 'fixtureImport', 'validateIdentifier', 'validateText',
    validations + '\n' + body + '\nreturn agentdbPatternStore.handler;');
  const outcomes = [];
  async function run(mode, bridgeResult = null) {
    let stored, writes = 0, reads = 0;
    const input = { pattern: 'A synthetic durable receipt fixture', type: 'verification', confidence: 0.75 };
    const handler = make(async () => ({ bridgeStorePattern: async () => bridgeResult }), async () => ({
      storeEntry: async args => {
        writes++; stored = args;
        if (mode === 'throw') throw new Error('fixture native writer refused');
        if (mode === 'false') return { success: false, error: 'fixture structured refusal' };
        if (mode === 'missing') return undefined;
        return { success: true, id: 'row-fixture' };
      },
      getEntry: async args => {
        reads++;
        assert.equal(args.key, stored.key); assert.equal(args.namespace, 'pattern');
        if (mode === 'read-throw') throw new Error('fixture read refused');
        if (mode === 'absent') return { success: true, found: false };
        if (mode === 'read-false') return { success: false, found: false, error: 'fixture query refused' };
        return { success: true, found: true, entry: { key: mode === 'wrong-key' ? 'other' : stored.key,
          namespace: mode === 'wrong-namespace' ? 'other' : stored.namespace,
          content: mode === 'wrong-value' ? 'different' : stored.value } };
      },
    }), () => ({ valid: true }), () => ({ valid: true }));
    const result = await handler(input);
    return { result, writes, reads, stored, input };
  }
  for (const mode of ['false', 'missing', 'throw', 'absent', 'read-false', 'read-throw', 'wrong-key', 'wrong-namespace', 'wrong-value']) {
    const row = await run(mode); outcomes.push({ mode, success: row.result.success });
    assert.equal(row.result.success, false, `${mode}: unverified pattern cannot be acknowledged`);
    assert.doesNotMatch(row.result.note || '', /persisted/i);
    if (['false', 'missing', 'throw'].includes(mode)) assert.equal(row.reads, 0, 'failed store cannot be rescued by an older read');
  }
  const exact = await run('exact');
  assert.equal(exact.result.success, true); assert.equal(exact.writes, 1); assert.equal(exact.reads, 1);
  assert.equal(exact.result.patternId, exact.stored.key); assert.equal(exact.result.namespace, 'pattern');
  assert.equal(exact.result.verified, true); assert.equal(exact.result.degraded, true);
  assert.deepEqual(JSON.parse(exact.stored.value), { ...exact.input, _fallback: 'reasoningBank-unavailable' });
  for (const controller of ['reasoningBank', 'bridge-fallback']) {
    const failed = await run('exact', { success: false, controller, error: 'fixture controller refusal' });
    assert.equal(failed.result.success, false); assert.equal(failed.writes, 0);
    assert.doesNotMatch(failed.result.note || '', /persisted/i);
  }
  const native = { success: true, controller: 'reasoningBank', patternId: 'native-pattern' };
  const healthy = await run('exact', native);
  assert.deepEqual(healthy.result, native); assert.equal(healthy.writes, 0); assert.equal(healthy.reads, 0);
  return outcomes;
}

export function probePatternReceiptReplacement({ files = discover(), installed = readState().pluginTargets } = {}) {
  let temporary;
  try {
    if (!files.length) return { state: 'unknown', evidence: 'no installed native pattern tools' };
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-pattern-receipt-'));
    for (const [index, file] of files.entries()) {
      const read = candidate => {
        const st = fs.lstatSync(candidate);
        if (!st.isFile() || st.isSymbolicLink() || !st.size) throw new Error('unsafe native pattern source');
        return fs.readFileSync(candidate, 'utf8');
      };
      let source = read(file);
      if (source.includes('ruflo-source-patch')) {
        // Exact shared CLI/plugin composition below proves ownership across both engines.
        const pristine = read(file + '.rsp-backup');
        if (pristine.includes('ruflo-source-patch') || composeSource(pristine, installed, { file }) !== source) throw new Error('unproved pristine composition');
        source = pristine;
      }
      const fixture = path.join(temporary, `${index}.js`); fs.writeFileSync(fixture, source);
      const child = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import fs from 'node:fs'; import { exercisePatternReceipt } from ${JSON.stringify(import.meta.url)};
        await exercisePatternReceipt(fs.readFileSync(process.argv[1], 'utf8'));`, fixture],
      { encoding: 'utf8', timeout: 6000, maxBuffer: 1024 * 1024, env: { HOME: temporary, PATH: process.env.PATH || '' } });
      if (child.error || child.status !== 0) throw new Error(child.error?.message || child.stderr || 'native pattern probe failed');
    }
    return { state: 'superseded', evidence: `${files.length} pristine native handlers reject unproved writes and require exact fallback readback while preserving native controller success` };
  } catch (error) { return { state: 'live', evidence: `native pattern receipt proof failed: ${error.message}` }; }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
