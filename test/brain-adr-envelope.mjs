import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-adr-envelope-')));
process.env.RUFLO_SOURCE_PATCH_HOME = path.join(sandbox, 'home');
process.env.RUFLO_NPX_ROOT = path.join(sandbox, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(sandbox, 'global');
process.env.RSP_CODEX_HOME = path.join(sandbox, 'codex');
process.env.RSP_RUVNET_BRAIN_HOME = path.join(sandbox, 'brain');
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = path.join(sandbox, 'marketplace');
const patcher = await import('../lib/brain-adr-envelope/patcher.mjs');
const { NAME, SPECS, patchSource, reverseSource, isPatched } = patcher;
for (const spec of SPECS) {
  const source = spec.edits.map(([from]) => from).join('\n');
  const patched = patchSource(source);
  assert.deepEqual(patched.missing, []);
  assert(isPatched(patched.next));
  assert.equal(reverseSource(patched.next), source);
  assert.equal(patchSource(patched.next).next, patched.next);
  assert(patchSource(source.replace('65536', '4096')).missing.length);
}
const evaluateEntry = text => vm.runInNewContext('({' + text + '})')["decision-gate"];
const oldEntry = evaluateEntry(SPECS[0].edits[0][0]);
const newEntry = evaluateEntry(SPECS[0].edits[0][1]);
assert.equal(newEntry.mode, oldEntry.mode);
assert.equal(newEntry.file, oldEntry.file);
assert.equal(newEntry.stdinBytes, 1048576);
// Path intentionally follows large content: prefix regex recovery cannot safely recover it.
const event = { cwd: '/fixture', tool_name: 'Edit', tool_input: { content: 'x'.repeat(100000), file_path: '/fixture/src/owned.mjs' } };
const bytes = Buffer.from(JSON.stringify(event));
assert.throws(() => JSON.parse(bytes.subarray(0, oldEntry.stdinBytes).toString()), SyntaxError);
assert.deepEqual(JSON.parse(bytes.subarray(0, newEntry.stdinBytes).toString()), event);
const huge = Buffer.from(JSON.stringify({ ...event, tool_input: { content: 'x'.repeat(1100000), file_path: '/fixture/src/owned.mjs' } }));
assert.throws(() => JSON.parse(huge.subarray(0, newEntry.stdinBytes).toString()), SyntaxError);
try {
  const write = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
  const { fixtureSources, VENDOR_SPECS } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
  const fixtures = fixtureSources();
  const roots = [path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'versions/4.7.28'),
    path.join(process.env.RSP_CODEX_HOME, 'plugins/cache/ruvnet-brain/ruvnet-brain/4.7.28')];
  const nativeShim = fixtures.nativeShim.replace('};', SPECS[0].edits[0][0] + '\n};');
  for (const root of roots) {
    write(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruvnet-brain', version: '4.7.28' }));
    for (const spec of VENDOR_SPECS) write(path.join(root, spec.relative),
      spec.id === 'shim' ? nativeShim : spec.id === 'hijack' ? fixtures.nativeHijack : fixtures.mcp4310);
    write(path.join(root, 'scripts/hook-input.mjs'), 'export const parseHookEvent = () => null;');
    write(path.join(root, SPECS[1].relative), SPECS[1].edits[0][0]);
  }
  const active = path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'active.json');
  const activeBytes = JSON.stringify({ version: '4.7.28', codeRoot: 'versions/4.7.28' }); write(active, activeBytes);
  const boundary = await import('../lib/brain-managed-memory-boundary/patcher.mjs');
  const compose = await import('../lib/plugin-compose.mjs');
  const state = await import('../lib/cwd/state.mjs');
  const { resolveActive } = await import('../lib/brain-managed-memory-boundary/discovery.mjs');
  const owners = ['brain-managed-memory-boundary', NAME];
  state.writeState({ patchTargets: [], pluginTargets: owners });
  const boundaryResult = boundary.apply();
  assert.equal(boundaryResult.errors, 0, JSON.stringify(boundaryResult));
  const absentDecoder = path.join(roots[1], SPECS[1].relative);
  fs.unlinkSync(absentDecoder);
  const shimBefore = roots.map(root => fs.readFileSync(path.join(root, SPECS[0].relative), 'utf8'));
  const refusedInstall = compose.applyComposed(owners);
  assert(refusedInstall.incomplete > 0, 'first install refuses a missing pair before patching any shim');
  roots.forEach((root, index) => assert.equal(fs.readFileSync(path.join(root, SPECS[0].relative), 'utf8'), shimBefore[index]));
  assert(!fs.existsSync(path.join(roots[0], SPECS[1].relative) + '.rsp-backup'), 'refusal creates no partial decoder backup');
  write(absentDecoder, SPECS[1].edits[0][0]);
  const installed = compose.applyComposed(owners);
  assert.equal(installed.errors, 0, installed.log.join('\n'));
  assert.equal(installed.incomplete, 0, installed.log.join('\n'));
  const files = roots.flatMap(root => SPECS.map(spec => path.join(root, spec.relative)));
  assert.deepEqual(compose.statusComposed([NAME])[NAME], { files: 4, patched: 4 });
  for (const missing of files) {
    const saved = fs.readFileSync(missing, 'utf8');
    fs.unlinkSync(missing);
    if (missing === files[0]) assert.throws(() => resolveActive(), /incomplete/,
      'the shared discovery default still requires a complete native shim');
    assert.equal(compose.statusComposed([NAME])[NAME].files, 4, 'either absent member stays in the active/host denominator');
    assert.equal(compose.statusComposed([NAME])[NAME].patched, 3, 'a partial envelope install cannot report healthy');
    const preserved = files.filter(file => file !== missing)
      .map(file => [file, fs.readFileSync(file), fs.readFileSync(file + '.rsp-backup')]);
    const blocked = compose.applyComposed([NAME]);
    assert(blocked.incomplete > 0, 'either missing member blocks the complete paired bundle');
    for (const [file, live, pristine] of preserved) {
      assert.deepEqual(fs.readFileSync(file), live, 'refusal preserves every executable and sibling contribution');
      assert.deepEqual(fs.readFileSync(file + '.rsp-backup'), pristine, 'refusal preserves exact pristine evidence');
    }
    assert(!fs.existsSync(missing), 'installation never fabricates a missing native member');
    write(missing, saved);
  }
  assert(patcher.preflight().ok);
  const removed = compose.reconcile([owners[0]], [NAME]);
  assert.equal(removed.incomplete, 0, removed.log.join('\n'));
  assert.equal(removed.errors, 0, removed.log.join('\n'));
  for (const root of roots) {
    assert.equal(fs.readFileSync(path.join(root, SPECS[0].relative), 'utf8'),
      (await import('../lib/brain-managed-memory-boundary/transforms.mjs')).patchShim(nativeShim).next);
    assert.equal(fs.readFileSync(path.join(root, SPECS[1].relative), 'utf8'), SPECS[1].edits[0][0]);
  }
  assert.equal(fs.readFileSync(active, 'utf8'), activeBytes, 'native active selector is unchanged');
  console.log('brain-adr-envelope: bounded transport, missing-pair refusal, exact denominator, sibling preservation and reversal passed');
} finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
