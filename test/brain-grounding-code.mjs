import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { patchSource, reverseSource, isPatched, ANCHOR, preflight, applicability } from '../lib/brain-grounding-code/patcher.mjs';
import { nativeSatisfied, readNativeGroundingBundle } from '../lib/brain-grounding-code/native.mjs';
import { patchSource as boundInput } from '../lib/brain-policy-input/patcher.mjs';
import { exerciseNativeGrounding, probeGroundingCodeReplacement } from '../lib/brain-grounding-code/probe.mjs';
import { MULTI_ANCHOR, MULTI_REPLACEMENT, patchMultiSource, isMultiPatched, reverseMultiPatch } from '../lib/brain-grounding-code/multi-patch.mjs';
import { preflight as preflightMultifile, probeMultifileReplacement } from '../lib/brain-grounding-code/multifile.mjs';
import { pluginStatusHealthy } from '../lib/plugin-registry.mjs';
import { brainNativeSupersessions } from '../lib/brain-native/supersede.mjs';

const root = fs.realpathSync(path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-code-'))));
const fixtures = new URL('./fixtures/brain-grounding-evidence/', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, fixtures), 'utf8');
const original = read('ground-before-write.sh');
const patched = patchSource(original);
assert.deepEqual(patched.missing, []);
assert.equal(isPatched(patched.next), true);
assert.equal(reverseSource(patched.next), original);
assert.deepEqual(patchSource(patched.next), { next: patched.next, applied: [], missing: [] });
for (const changed of [original + original, original.replace(ANCHOR, '# changed'),
  patched.next.replace('RSP_CODE_INPUT="$RSP_SCAN_OUTPUT"', 'RSP_CODE_INPUT=""')]) {
  assert.equal(patchSource(changed).next, changed);
  assert.equal(patchSource(changed).missing.length, 1);
}
const scripts = path.join(root, 'scripts');
fs.mkdirSync(scripts, { recursive: true });
fs.mkdirSync(path.join(root, '.claude/model-router'), { recursive: true });
fs.writeFileSync(path.join(root, '.claude/model-router/profile.json'), '{}');
fs.writeFileSync(path.join(scripts, 'hook-input.mjs'), fs.readFileSync(
  new URL('./fixtures/brain-grounding-code/hook-input.mjs', import.meta.url), 'utf8'));
const env = { ...process.env, HOME: root, RUVNET_SKIP_GROUNDING_CHECK: '0',
  MODEL_ROUTER_PROFILE: path.join(root, '.claude/model-router/profile.json'),
  RUVNET_BRAIN_STATE_DIR: path.join(root, 'state'), RUVNET_NODE_BIN: process.execPath };
let assertions = 0;
function check(source, content, expected, file = 'backup.py', extra = {}) {
  const script = path.join(scripts, 'ground-before-write.sh');
  fs.writeFileSync(script, source);
  const event = { tool_name: 'Write', tool_input: { file_path: path.join(root, file), content }, ...extra };
  const result = spawnSync('/bin/bash', [script], { input: JSON.stringify(event), env, cwd: root,
    encoding: 'utf8', timeout: 6000 });
  assert.equal(result.status, expected, `${file}: ${content}\n${result.stderr}`);
  assertions++;
}
const incident = '#!/usr/bin/env python3\n"""Consistent application SQLite backup; never access Ruflo/AgentDB memory stores."""\nimport sqlite3\n';
check(original, incident, 2); // Reproduce the actual Herdr refusal without a stamp.
check(patched.next, incident, 0);
const patch = `*** Begin Patch\n*** Add File: ${path.join(root, 'backup.py')}\n${incident.trimEnd().split('\n').map((line) => '+' + line).join('\n')}\n*** End Patch`;
check(original, '', 2, 'backup.py', { tool_name: 'Edit', tool_input: {
  file_path: path.join(root, 'backup.py'), new_string: patch } });
check(patched.next, '', 0, 'backup.py', { tool_name: 'Edit', tool_input: {
  file_path: path.join(root, 'backup.py'), new_string: patch } });
check(patched.next, '', 0, 'backup.py', { tool_name: 'Edit', tool_input: {
  file_path: path.join(root, 'backup.py'), new_string: patch + '\n' } });
check(patched.next, '', 2, 'backup.py', { tool_name: 'Edit', tool_input: {
  file_path: path.join(root, 'backup.py'), new_string: patch.replace('import sqlite3', 'import agentdb') } });
check(patched.next, '', 2, 'backup.py', { tool_name: 'Edit', tool_input: {
  file_path: path.join(root, 'backup.py'), new_string: '"""agentdb"""' } });
check(patched.next, '', 2, 'backup.py', { tool_name: 'Edit', tool_input: {
  file_path: path.join(root, 'backup.py'), new_string: '# agentdb' } });
for (const content of ['# do not access agentdb\nimport sqlite3\n',
  'def backup():\n    """Never access AgentDB."""\n    return 1\n']) check(patched.next, content, 0);
for (const content of ['import agentdb\n', 'exec("agentdb")\n',
  'payload = """agentdb"""\n', 'exec(\n"""agentdb"""\n)\n',
  'f"""{agentdb.run()}"""\n', '"""agentdb""".strip()\n',
  '"""unterminated agentdb']) check(patched.next, content, 2);
for (const content of ['// agentdb warning\nconsole.log(1);',
  '/* agentdb warning */\nconsole.log(1);']) check(patched.next, content, 0, 'code.mjs');
for (const content of ["import 'agentdb';", "require('agentdb');", "const x = 'https://host/agentdb';",
  'const x = `agentdb ${call()}`;', '/* unterminated agentdb',
  'const x = /agentdb/;', 'const x = 1 / 2; // agentdb']) check(patched.next, content, 2, 'code.mjs');
check(patched.next, 'echo agentdb', 2, 'code.sh'); // Unsupported language preserves vendor behavior.
check(patched.next, 'import sqlite3', 2, 'agentdb-backup.py'); // Paths remain guarded.
check(patched.next, '', 0, 'backup.py', { tool_name: 'Edit', tool_input: {
  file_path: path.join(root, 'backup.py'), old_string: 'import agentdb', new_string: 'import sqlite3' } });
check(patched.next, '', 2, 'backup.py', { tool_name: 'MultiEdit', tool_input: {
  file_path: path.join(root, 'backup.py'), edits: [{ new_string: '# agentdb warning' }, { new_string: 'import agentdb' }] } });
// Missing parser cannot quietly weaken the existing code boundary.
fs.renameSync(path.join(scripts, 'hook-input.mjs'), path.join(scripts, 'hook-input.saved'));
check(patched.next, incident, 2);
fs.renameSync(path.join(scripts, 'hook-input.saved'), path.join(scripts, 'hook-input.mjs'));
fs.renameSync(path.join(scripts, 'hook-input.mjs'), path.join(scripts, 'hook-input.saved'));
fs.writeFileSync(path.join(scripts, 'hook-input.mjs'), 'process.exit(0);');
check(patched.next, 'import agentdb', 2); // Early successful exit is not parsed evidence.
fs.renameSync(path.join(scripts, 'hook-input.saved'), path.join(scripts, 'hook-input.mjs'));
const stamps = path.join(root, '.cache/ruvnet-brain/grounded');
fs.mkdirSync(stamps, { recursive: true });
fs.writeFileSync(path.join(stamps, 'agentdb'), '');
check(patched.next, 'import agentdb', 0);
check(patched.next, 'import metaharness', 2); // AgentDB evidence cannot authorize another product.
fs.utimesSync(path.join(stamps, 'agentdb'), new Date(0), new Date(0));
check(patched.next, 'import agentdb', 2);
check(patched.next, incident, 0); // Prose never needed that expired stamp.
console.log(`PASS brain-grounding-code: ${assertions} native gate replays, restoration and anchor drift`);

// Public v4.5.9 fixes the reported incident through a stricter, conservative native projection.
const nativeGuard = fs.readFileSync(new URL('./fixtures/brain-grounding-code/native-4.5.9.sh', import.meta.url), 'utf8');
const nativeHelper = fs.readFileSync(new URL('./fixtures/brain-grounding-code/projection-native-4.5.9.mjs', import.meta.url), 'utf8');
assert(nativeSatisfied(nativeGuard));
const boundedGuard = boundInput(nativeGuard);
assert.deepEqual(boundedGuard.missing, []);
assert(nativeSatisfied(boundedGuard.next), 'reviewed bounded input must not hide grounding discovery');
for (const drift of [boundedGuard.next.replace('4 * (65536', '3 * (65536'),
  boundedGuard.next + '\n# unknown edit', boundedGuard.next + boundedGuard.next]) {
  assert(!nativeSatisfied(drift), 'only exact reversible policy composition is accepted');
}
assert.equal(isPatched(nativeGuard), true);
assert.deepEqual(patchSource(nativeGuard), { next: nativeGuard, applied: [], missing: [] });
assert.equal(reverseSource(nativeGuard), nativeGuard);
for (const drift of [nativeGuard + nativeGuard,
  nativeGuard.replace('PROJECTED_MISSING=""', 'PROJECTED_MISSING="agentdb"')]) {
  assert.equal(nativeSatisfied(drift), false);
  assert(patchSource(drift).missing.length);
  assert.equal(patchSource(drift).next, drift);
}
const nativeRoot = path.join(root, 'native');
const nativeScripts = path.join(nativeRoot, 'scripts');
fs.mkdirSync(nativeScripts, { recursive: true });
const nativeFile = path.join(nativeScripts, 'ground-before-write.sh');
const helperFile = path.join(nativeScripts, 'grounding-code-projection.mjs');
fs.writeFileSync(nativeFile, nativeGuard);
assert.equal(preflight([nativeFile]).ok, false);
assert.equal(applicability([nativeFile]).state, 'error');
assert.equal(pluginStatusHealthy({ files: 1, patched: 1, applicability: applicability([nativeFile]) }), false);
assert.equal(probeGroundingCodeReplacement({ files: [nativeFile] }).state, 'live');
fs.writeFileSync(helperFile, nativeHelper);
assert.equal(preflight([nativeFile]).ok, true);
const proof = probeGroundingCodeReplacement({ files: [nativeFile] });
assert.equal(proof.state, 'superseded', 'original single-file retirement contract remains valid');
assert.equal(probeMultifileReplacement({ files: [helperFile] }).state, 'live');
assert.equal(typeof brainNativeSupersessions['brain-grounding-code'].check, 'function');
assert.match(brainNativeSupersessions['brain-grounding-code'].issue, /issues\/46$/);
fs.writeFileSync(helperFile, nativeHelper.replace('throw new Error', 'return ""; //'));
assert.equal(preflight([nativeFile]).ok, false);
assert.equal(probeGroundingCodeReplacement({ files: [nativeFile] }).state, 'live');
fs.unlinkSync(helperFile);
const external = path.join(root, 'external-helper.mjs');
fs.writeFileSync(external, nativeHelper);
fs.symlinkSync(external, helperFile);
assert.equal(preflight([nativeFile]).ok, false);
assert.equal(probeGroundingCodeReplacement({ files: [nativeFile] }).state, 'live');
fs.unlinkSync(helperFile);
fs.writeFileSync(helperFile, nativeHelper);
fs.writeFileSync(nativeFile, patched.next);
assert.equal(preflight([nativeFile]).ok, true);
assert.equal(probeGroundingCodeReplacement({ files: [nativeFile] }).state, 'live', 'older overlays cannot retire by version or nearby helper presence');
assert.equal(probeGroundingCodeReplacement({ files: [] }).state, 'unknown');
console.log('PASS brain-grounding-code: exact native guard/helper acceptance, behavioral retirement, missing/drifted/escaping helper refusal and legacy preservation');

// 4.7.28 changes only direct-invocation detection, now imported from its packaged shared owner.
// Qualify the full dependency instead of accepting a helper hash that cannot run on its own.
const entrypointHelper = fs.readFileSync(new URL('./fixtures/brain-grounding-code/projection-native-4.7.28.mjs', import.meta.url), 'utf8');
const entrypoint = fs.readFileSync(new URL('./fixtures/brain-grounding-code/entrypoint-native-4.7.28.mjs', import.meta.url), 'utf8');
const entrypointFile = path.join(nativeScripts, 'entrypoint.mjs');
fs.writeFileSync(nativeFile, nativeGuard);
fs.writeFileSync(helperFile, entrypointHelper);
assert.equal(preflight([nativeFile]).ok, false, 'shared native entrypoint must be present');
fs.writeFileSync(entrypointFile, entrypoint);
assert.equal(preflight([nativeFile]).ok, true);
const entrypointProof = probeGroundingCodeReplacement({ files: [nativeFile] });
assert.equal(entrypointProof.state, 'superseded', 'legacy contract remains retired');
assert.equal(probeMultifileReplacement({ files: [helperFile] }).state, 'live', '4.7.28 retains the multi-file defect');
fs.writeFileSync(entrypointFile, entrypoint.replace('return false;', 'return true;'));
assert.equal(preflight([nativeFile]).ok, false, 'changed dependency cannot retain native qualification');
assert.equal(probeGroundingCodeReplacement({ files: [nativeFile] }).state, 'live');
fs.unlinkSync(entrypointFile);
const externalEntrypoint = path.join(root, 'external-entrypoint.mjs');
fs.writeFileSync(externalEntrypoint, entrypoint);
fs.symlinkSync(externalEntrypoint, entrypointFile);
assert.equal(preflight([nativeFile]).ok, false, 'shared dependency cannot escape its native bundle');
fs.unlinkSync(entrypointFile);
fs.writeFileSync(entrypointFile, entrypoint);
assert.equal(preflight([nativeFile]).ok, true);
assert.equal(patchSource(nativeGuard).next, nativeGuard, 'qualification never reinstalls the retired overlay');
console.log('PASS brain-grounding-code: native shared entrypoint qualification and dependency refusal');

// #373 recurrence: the native Codex adapter checks each path with the complete patch.
// A code-only gate must not attribute the sibling JSON screening receipt to acquire.py.
const multiPatched = patchMultiSource(entrypointHelper);
assert.deepEqual(multiPatched.missing, []);
assert.equal(isMultiPatched(multiPatched.next), true);
assert.equal(reverseMultiPatch(multiPatched.next), entrypointHelper);
assert.deepEqual(patchMultiSource(multiPatched.next), { next: multiPatched.next, applied: [], missing: [] });
for (const drift of [entrypointHelper + entrypointHelper,
  entrypointHelper.replace(MULTI_ANCHOR, '// changed'),
  multiPatched.next.replace('additions.has(file)', 'additions.has("other.py")')]) {
  assert(patchMultiSource(drift).missing.length);
}
fs.writeFileSync(helperFile, multiPatched.next);
assert.equal(preflightMultifile([helperFile]).ok, true);
assert.equal(probeMultifileReplacement({ files: [helperFile] }).state, 'live',
  'installed overlay must never prove its own upstream retirement');
const repairedRoot = path.join(root, 'repaired'); fs.mkdirSync(repairedRoot);
const repairedProof = exerciseNativeGrounding({ guard: nativeGuard, helper: multiPatched.next, entrypoint }, repairedRoot, { multiFile: true });
assert.equal(repairedProof.assertions, 45);
fs.writeFileSync(nativeFile, boundedGuard.next);
assert.equal(preflightMultifile([helperFile]).ok, true);
assert.equal(readNativeGroundingBundle(nativeFile).guard, nativeGuard,
  'retirement proves pristine behavior, never the sibling overlay');
assert.equal(probeMultifileReplacement({ files: [helperFile] }).state, 'live');
assert.equal(fs.readFileSync(nativeFile, 'utf8'), boundedGuard.next);
const boundedRoot = path.join(root, 'bounded'); fs.mkdirSync(boundedRoot);
assert.equal(exerciseNativeGrounding({ guard: boundedGuard.next, helper: multiPatched.next, entrypoint },
  boundedRoot, { multiFile: true }).assertions, 45);

const codeFile = path.join(root, 'acquire.py');
const methodFile = path.join(root, 'method.json');
const add = (file, body) => `*** Add File: ${file}\n${body.split('\n').map(line => '+' + line).join('\n')}\n`;
const mixedPatch = `*** Begin Patch\n${add(codeFile, 'import requests')}${add(path.join(root, '.claude-flow/research-active.json'), '{"status":"acquiring"}')}${add(methodFile,
  '{"screening":"Native mcp__ruflo__aidefence_scan input schema discovered; full extracted text in <=8000-character sequential chunks before admission"}')}*** End Patch`;
const nativeEnv = { ...env, HOME: repairedRoot,
  MODEL_ROUTER_PROFILE: path.join(repairedRoot, '.claude/model-router/profile.json') };
const gate = (patchText, file, expected, helper = multiPatched.next) => {
  fs.writeFileSync(path.join(repairedRoot, 'scripts/grounding-code-projection.mjs'), helper);
  const result = spawnSync('/bin/bash', [path.join(repairedRoot, 'scripts/ground-before-write.sh')], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: file, new_string: patchText } }),
    env: nativeEnv, cwd: repairedRoot, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, expected, result.stderr);
  if (expected === 2) assert.match(result.stderr, /BLOCKED/);
};
gate(mixedPatch, codeFile, 2, entrypointHelper);
gate(mixedPatch, codeFile, 0);
gate(mixedPatch, methodFile, 0); // JSON remains outside the native code-file policy.
gate(mixedPatch.replace('+import requests', '+import aidefence'), codeFile, 2);
const siblingCode = mixedPatch.replace('*** End Patch', add(path.join(root, 'screen.py'), 'import aidefence') + '*** End Patch');
gate(siblingCode, codeFile, 0);
gate(siblingCode, path.join(root, 'screen.py'), 2); // Per-file fan-out still refuses the whole call.
for (const malformed of [mixedPatch.replace('*** End Patch', ''),
  mixedPatch.replace('*** End Patch', add(codeFile, 'import aidefence') + '*** End Patch'),
  mixedPatch.replace('*** End Patch', '*** Update File: other.py\n@@\n+import aidefence\n*** End Patch'),
  mixedPatch.replace('+import requests', 'import requests'),
  mixedPatch.replace('*** End Patch', '*** Delete File: other.py\n*** End Patch'),
  mixedPatch.replace('+import requests', '+import requests\n*** Move to: other.py'),
  mixedPatch.replace(`*** Add File: ${methodFile}`, `*** Add File: ${methodFile} `)]) gate(malformed, codeFile, 2);
gate(mixedPatch, path.join(root, 'absent.py'), 2);
gate(mixedPatch.replace('+import requests', '+open(".swarm/memory.db")'), codeFile, 2);
assert.equal(multiPatched.next.includes(MULTI_REPLACEMENT), true);
console.log('PASS brain-grounding-code: mixed Python/JSON recurrence, 45 repaired native cases, true sibling-code refusal, malformed/duplicate/move/partial refusal and pristine retirement');

// Discovery and the real composition engine own only the active generation and matching host copy.
const composeRoot = path.join(root, 'composition'); fs.mkdirSync(composeRoot);
const composition = spawnSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const { discover } = await import(${JSON.stringify(new URL('../lib/brain-grounding-code/multifile.mjs', import.meta.url).href)});
const { spawnSync } = await import('node:child_process');
const { applyComposed, statusComposed, reconcile } = await import(${JSON.stringify(new URL('../lib/plugin-compose.mjs', import.meta.url).href)});
const { VENDOR_SPECS } = await import(${JSON.stringify(new URL('../lib/brain-managed-memory-boundary/transforms.mjs', import.meta.url).href)});
const home = process.env.RUFLO_SOURCE_PATCH_HOME;
const brain = process.env.RSP_RUVNET_BRAIN_HOME;
const active = path.join(brain, 'versions/4.7.28');
const host = path.join(home, '.codex/plugins/cache/ruvnet-brain/ruvnet-brain/4.7.28');
const old = path.join(brain, 'versions/4.7.27');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
assert.deepEqual(discover(), []);
for (const dir of [active, host, old]) {
  write(path.join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruvnet-brain', version: dir === old ? '4.7.27' : '4.7.28' }));
  for (const spec of VENDOR_SPECS) write(path.join(dir, spec.relative), '// discovery fixture');
  write(path.join(dir, 'scripts/hook-input.mjs'), '// discovery fixture');
  write(path.join(dir, 'scripts/ground-before-write.sh'), ${JSON.stringify(nativeGuard)});
  write(path.join(dir, 'scripts/grounding-code-projection.mjs'), ${JSON.stringify(entrypointHelper)});
  write(path.join(dir, 'scripts/entrypoint.mjs'), ${JSON.stringify(entrypoint)});
}
write(path.join(brain, 'active.json'), JSON.stringify({ version: '4.7.28', codeRoot: active }));
assert.equal(discover().length, 2);
for (const dir of [active, host]) write(path.join(dir, 'scripts/ground-before-write.sh'), ${JSON.stringify(boundedGuard.next)});
assert.equal(discover().length, 2, 'bounded input sibling must preserve monitor discovery');
const applied = applyComposed(['brain-grounding-multifile']);
assert.equal(applied.errors, 0, JSON.stringify(applied));
assert.equal(applied.incomplete, 0, JSON.stringify(applied));
assert.equal(applied.patched, 2);
assert.equal(statusComposed(['brain-grounding-multifile'])['brain-grounding-multifile'].patched, 2);
assert.equal(applyComposed(['brain-grounding-multifile']).patched, 0);
write(path.join(active, 'scripts/grounding-code-projection.mjs'), ${JSON.stringify(entrypointHelper)});
assert.equal(statusComposed(['brain-grounding-multifile'])['brain-grounding-multifile'].patched, 1);
assert.equal(applyComposed(['brain-grounding-multifile']).patched, 1, 'monitor can repair a reverted helper');
assert.equal(fs.readFileSync(path.join(old, 'scripts/grounding-code-projection.mjs'), 'utf8'), ${JSON.stringify(entrypointHelper)});
const reverted = reconcile([], ['brain-grounding-multifile']);
assert.equal(reverted.errors, 0, JSON.stringify(reverted));
for (const dir of [active, host]) {
  assert.equal(fs.readFileSync(path.join(dir, 'scripts/ground-before-write.sh'), 'utf8'), ${JSON.stringify(boundedGuard.next)});
  assert.equal(fs.readFileSync(path.join(dir, 'scripts/grounding-code-projection.mjs'), 'utf8'), ${JSON.stringify(entrypointHelper)});
}
// Exercise terminal retirement through the public dispatcher, not an internal compose shortcut.
const { readState, writeState, retireTarget } = await import(${JSON.stringify(new URL('../lib/cwd/state.mjs', import.meta.url).href)});
const { PATCH_TARGETS } = await import(${JSON.stringify(new URL('../lib/cwd/patch-library.mjs', import.meta.url).href)});
const { PLUGIN_TARGETS } = await import(${JSON.stringify(new URL('../lib/plugin-registry.mjs', import.meta.url).href)});
retireTarget('brain-grounding-code', { reason: 'native single-file projection', evidence: 'verified legacy fixture', issue: 'https://github.com/stuinfla/ruvnet-brain/issues/46' });
const legacyReceipt = readState().retired['brain-grounding-code'];
write(path.join(home, '.claude/settings.json'), '{}');
const cli = (...args) => {
  const result = spawnSync(process.execPath, [${JSON.stringify(new URL('../bin/cli.mjs', import.meta.url).pathname)}, ...args], {
    cwd: home, env: { ...process.env, RSP_NO_SELF_UPDATE: '1', RSP_NO_MONITOR_RECOVER: '1',
      RSP_NO_LAUNCHCTL: '1', RSP_NO_STALE_WRITER_KILL: '1', RSP_NO_HOST_AUTO_UPDATE: '1' },
    encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
};
assert.match(cli('brain-grounding-code', 'install'), /RETIRED.*not re-installed/);
cli('brain-grounding-multifile', 'install');
assert.deepEqual(readState().pluginTargets, ['brain-grounding-multifile']);
assert.deepEqual(readState().retired['brain-grounding-code'], legacyReceipt);
assert.ok(cli('brain-grounding-multifile', 'status').includes('2/2 file(s) patched'));
for (const dir of [active, host]) assert.equal(fs.readFileSync(path.join(dir, 'scripts/grounding-code-projection.mjs'), 'utf8'), ${JSON.stringify(multiPatched.next)});
cli('brain-grounding-multifile', 'uninstall');
const retired = Object.fromEntries([...PATCH_TARGETS, ...PLUGIN_TARGETS].filter(name => name !== 'brain-grounding-multifile')
  .map(name => [name, { at: '2026-11-04T00:00:00.000Z', reason: 'unrelated fixture target', evidence: 'isolated test' }]));
retired['brain-grounding-code'] = legacyReceipt;
writeState({ patchTargets: [], pluginTargets: [], retired, all: true });
cli('all', 'install');
assert.deepEqual(readState().pluginTargets, ['brain-grounding-multifile']);
assert.deepEqual(readState().retired['brain-grounding-code'], legacyReceipt);
assert.equal(readState().all, true);
for (const dir of [active, host]) assert.equal(fs.readFileSync(path.join(dir, 'scripts/grounding-code-projection.mjs'), 'utf8'), ${JSON.stringify(multiPatched.next)});
cli('brain-grounding-multifile', 'uninstall');
for (const dir of [active, host]) assert.equal(fs.readFileSync(path.join(dir, 'scripts/grounding-code-projection.mjs'), 'utf8'), ${JSON.stringify(entrypointHelper)});
`], { env: { ...process.env, RUFLO_SOURCE_PATCH_HOME: composeRoot,
  RSP_RUVNET_BRAIN_HOME: path.join(composeRoot, '.cache/ruvnet-brain'),
  HOME: composeRoot, RUFLO_GLOBAL_ROOT: path.join(composeRoot, 'global'), RUFLO_NPX_ROOT: path.join(composeRoot, 'npx'),
  RSP_CODEX_HOME: path.join(composeRoot, '.codex') }, encoding: 'utf8', timeout: 45000 });
assert.equal(composition.status, 0, composition.stderr || composition.stdout);
console.log('PASS brain-grounding-multifile: active/host composition, public named/all install with terminal legacy retirement intact, exact restoration and older-generation preservation');
