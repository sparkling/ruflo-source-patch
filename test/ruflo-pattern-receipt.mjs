import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-pattern-receipt-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = temporary;
process.env.RUFLO_GLOBAL_ROOT = path.join(temporary, 'global');
process.env.RUFLO_NPX_ROOT = path.join(temporary, 'npx');
process.env.RSP_CODEX_HOME = path.join(temporary, '.codex');
const patch = await import('../lib/ruflo-pattern-receipt/patcher.mjs');
const { exercisePatternReceipt, probePatternReceiptReplacement } = await import('../lib/ruflo-pattern-receipt/probe.mjs');
const bridge = fs.readFileSync(new URL('./fixtures/ruflo-pattern-receipt/bridge-store-pattern.js', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('./fixtures/ruflo-pattern-receipt/agentdb-tools.js', import.meta.url), 'utf8');
const legacyBridge = fs.readFileSync(new URL('./fixtures/ruflo-pattern-receipt/bridge-store-pattern-legacy.js', import.meta.url), 'utf8');
// Reuse the native handler fixture; these are the two observed pre-#3288 deltas.
const modernResultStart = source.indexOf("            if (result) {\n                // #3288:");
const modernResultEnd = source.indexOf('            // ADR-093 F4:', modernResultStart);
const legacySource = source.slice(0, modernResultStart) + "            if (result)\n                return result;\n"
  + source.slice(modernResultEnd).replace(/                    \/\/ #3288:[\s\S]*?                    reason: 'reasoningBank-unavailable:registry-null',\n/, '');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
try {
  const bridgeResult = patch.patchSource(bridge);
  assert.deepEqual(bridgeResult.missing, []);
  assert.equal(patch.reverseSource(bridgeResult.next), bridge);
  assert.equal(patch.isPatched(bridgeResult.next), true);
  await assert.rejects(exercisePatternReceipt(bridge), undefined, 'native bridge masking reproduced');
  await exercisePatternReceipt(bridgeResult.next);
  const result = patch.patchSource(source);
  assert.deepEqual(result.missing, []);
  assert.equal(patch.isPatched(result.next), true);
  assert.equal(patch.reverseSource(result.next), source);
  assert.deepEqual(patch.patchSource(result.next), { next: result.next, applied: [], missing: [] });
  await assert.rejects(exercisePatternReceipt(source), /unverified pattern/, 'upstream false acknowledgement reproduced');
  await exercisePatternReceipt(result.next);
  for (const invalid of [source + source, source.replace(patch.EDITS[0][0], '// drift'), result.next + result.next]) {
    assert.equal(patch.patchSource(invalid).next, invalid);
    assert.ok(patch.patchSource(invalid).missing.length);
  }
  for (const mutation of [
    result.next.replace('stored?.success !== true', 'false'),
    result.next.replace("readback.entry.content !== value", 'false'),
    result.next.replace('result.success !== true', 'false'),
  ]) await assert.rejects(exercisePatternReceipt(mutation), undefined, 'receipt guard mutation must fail');
  const legacyResults = [legacySource, legacyBridge].map(native => {
    const fixed = patch.patchSource(native);
    assert.deepEqual(fixed.missing, []);
    assert.equal(patch.isPatched(fixed.next), true);
    assert.equal(patch.reverseSource(fixed.next), native);
    assert.deepEqual(patch.patchSource(fixed.next), { next: fixed.next, applied: [], missing: [] });
    for (const invalid of [native + native, fixed.next + fixed.next, fixed.next.replace('readback.entry.content !==', 'false && readback.entry.content !==')]) {
      assert.equal(patch.patchSource(invalid).next, invalid);
      assert.ok(patch.patchSource(invalid).missing.length);
    }
    return fixed;
  });
  for (const [index, native] of [legacySource, legacyBridge].entries()) {
    await assert.rejects(exercisePatternReceipt(native), undefined, 'legacy native false acknowledgement reproduced');
    await exercisePatternReceipt(legacyResults[index].next);
    const broken = legacyResults[index].next.replace('readback.entry.content !==', 'false && readback.entry.content !==');
    await assert.rejects(exercisePatternReceipt(broken), undefined, 'legacy receipt guard mutation must fail');
  }
  const file = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src/mcp-tools/agentdb-tools.js');
  const bridgeFile = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src/memory/memory-bridge.js');
  write(file, source); write(bridgeFile, bridge);
  assert.deepEqual(patch.discover(), [file, bridgeFile]);
  assert.equal(patch.preflight().ok, true);
  assert.equal(probePatternReceiptReplacement({ files: [file] }).state, 'live');
  const compose = await import('../lib/plugin-compose.mjs');
  const applied = compose.applyComposed([patch.NAME]);
  assert.equal(applied.errors, 0, JSON.stringify(applied));
  assert.equal(applied.incomplete, 0, JSON.stringify(applied));
  assert.equal(applied.patched, 2);
  assert.equal(compose.applyComposed([patch.NAME]).patched, 0);
  assert.equal(probePatternReceiptReplacement({ files: [file], installed: [patch.NAME] }).state, 'live', 'overlay cannot retire itself');
  const backup = file + '.rsp-backup';
  write(backup, source + '// foreign');
  assert.match(probePatternReceiptReplacement({ files: [file], installed: [patch.NAME] }).evidence, /composition/);
  write(backup, source);
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.equal(fs.readFileSync(bridgeFile, 'utf8'), bridge);
  write(file, legacySource); write(bridgeFile, legacyBridge);
  assert.equal(patch.preflight().ok, true);
  const legacyApplied = compose.applyComposed([patch.NAME]);
  assert.equal(legacyApplied.errors, 0, JSON.stringify(legacyApplied));
  assert.equal(legacyApplied.incomplete, 0, JSON.stringify(legacyApplied));
  assert.equal(legacyApplied.patched, 2);
  assert.equal(compose.applyComposed([patch.NAME]).patched, 0);
  assert.equal(probePatternReceiptReplacement({ files: [file, bridgeFile], installed: [patch.NAME] }).state, 'live', 'legacy overlays do not retire themselves');
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), legacySource);
  assert.equal(fs.readFileSync(bridgeFile, 'utf8'), legacyBridge);
  write(file, legacyResults[0].next.replaceAll(patch.PATCH_MARKER, 'native future implementation'));
  write(bridgeFile, legacyResults[1].next.replaceAll('ruflo-source-patch', 'native future implementation'));
  assert.equal(probePatternReceiptReplacement().state, 'superseded', 'legacy native repair retires only after both behavior proofs');
  write(bridgeFile, bridge);
  write(file, result.next.replaceAll(patch.PATCH_MARKER, 'native future implementation'));
  assert.equal(probePatternReceiptReplacement({ files: [file] }).state, 'superseded');
  assert.equal(probePatternReceiptReplacement().state, 'live', 'unfixed native bridge prevents retirement');
  write(bridgeFile, bridgeResult.next.replaceAll('ruflo-source-patch', 'native future implementation'));
  assert.equal(probePatternReceiptReplacement().state, 'superseded');
  write(file, source.replace(patch.EDITS[0][0], '// unsupported upstream drift'));
  assert.equal(patch.preflight().ok, false);
  assert.ok(compose.applyComposed([patch.NAME]).incomplete > 0);
  console.log('ruflo-pattern-receipt: false acknowledgements reproduced; exact store/read guards, native success, composition and retirement passed');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
