import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { patchSource, reverseSource, isPatched, ANCHOR, preflight, applicability } from '../lib/brain-grounding-code/patcher.mjs';
import { nativeSatisfied } from '../lib/brain-grounding-code/native.mjs';
import { probeGroundingCodeReplacement } from '../lib/brain-grounding-code/probe.mjs';
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
assert.equal(proof.state, 'superseded', proof.evidence);
assert.match(proof.evidence, /missing-helper refusal/);
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
