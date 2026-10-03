import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root = fs.realpathSync(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-router-test-')));
const home = path.join(root, 'home');
process.env.RUFLO_SOURCE_PATCH_HOME = home;
const patcher = await import('../lib/brain-router-imports/patcher.mjs');
const write = (file, source) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source); };
const run = (file, expression = 'mod.probe()', extra = {}) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `const mod = await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(JSON.stringify(${expression}));`], {
  env: { HOME: home, PATH: process.env.PATH, ...extra }, encoding: 'utf8', timeout: 10_000,
});
const runtime = path.join(home, '.cache/ruvnet-brain/kb/.console-runtime');
const manifest = path.join(runtime, 'package.json');
write(manifest, '{"name":"ruvnet-brain","version":"4.5.2"}');
const original = new Map();
const files = [];
for (const spec of patcher.SPECS) {
  const file = path.join(home, '.claude/model-router/bin', spec.file); files.push(file);
  const body = `${spec.anchor}\nexport const probe = () => ${spec.file.startsWith('dual')
    ? 'DUAL_HOST_MODEL_IDS.claude' : 'loadRuntimePreferences().routing'};\n`;
  original.set(file, body); write(file, body);
  const red = run(file); assert.notEqual(red.status, 0); assert.match(red.stderr, /ERR_MODULE_NOT_FOUND/);
  const fixed = patcher.patchSource(body); assert.deepEqual(fixed.missing, []);
  assert.equal(patcher.reverseSource(fixed.next), body); assert.equal(patcher.isPatched(fixed.next), true);
  assert.deepEqual(patcher.patchSource(fixed.next), { next: fixed.next, applied: [], missing: [] });
  write(file, fixed.next);
  assert.notEqual(run(file).status, 0, 'missing native asset fails closed');
  write(path.join(runtime, spec.relative), spec.file.startsWith('dual')
    ? 'export const DUAL_HOST_MODEL_IDS = { claude: "native-v1", codex: "native-codex" };'
    : 'export const loadRuntimePreferences = () => ({ routing: "native-v1" }); export const runtimeChildEnv = (env) => env;');
  const first = run(file); assert.equal(first.status, 0, first.stderr); assert.equal(JSON.parse(first.stdout), 'native-v1');
  write(path.join(runtime, spec.relative), fs.readFileSync(path.join(runtime, spec.relative), 'utf8').replace('native-v1', 'native-v2'));
  assert.equal(JSON.parse(run(file).stdout), 'native-v2', 'native owner update reflected without reseeding');
  const local = path.resolve(path.dirname(file), spec.specifier);
  write(local, fs.readFileSync(path.join(runtime, spec.relative), 'utf8').replace('native-v2', 'packaged'));
  assert.equal(JSON.parse(run(file).stdout), 'packaged', 'original packaged helper wins');
  fs.unlinkSync(local);
  const nativeFile = path.join(runtime, spec.relative); const nativeBody = fs.readFileSync(nativeFile, 'utf8');
  fs.unlinkSync(nativeFile); fs.symlinkSync(path.join(root, 'outside.mjs'), nativeFile);
  write(path.join(root, 'outside.mjs'), nativeBody);
  assert.notEqual(run(file).status, 0, 'symlinked helper refused');
  fs.unlinkSync(nativeFile); write(nativeFile, nativeBody);
  for (const bad of [body + body, body.replace('import {', 'import  {'), fixed.next.replace('return import(pathToFileURL(file).href);', 'return {};')]) {
    const result = patcher.patchSource(bad); assert.equal(result.next, bad); assert.equal(result.missing.length, 1);
  }
}
const dual = files[0];
write(manifest, '{"name":"some-other-package","version":"4.5.2"}');
assert.notEqual(run(dual).status, 0, 'wrong native owner rejected');
write(manifest, '{"name":"ruvnet-brain","version":"garbage"}');
assert.notEqual(run(dual).status, 0, 'invalid native version metadata rejected');
write(manifest, '{"name":"ruvnet-brain","version":"4.5.2"}');
const nativeModel = path.join(runtime, 'scripts/review-model-defaults.mjs');
const nativeBody = fs.readFileSync(nativeModel, 'utf8');
write(nativeModel, 'throw new Error("native helper deliberately broken");');
assert.match(run(dual).stderr, /native helper deliberately broken/, 'runtime error not swallowed into fallback');
write(nativeModel, nativeBody);
assert.deepEqual(patcher.discover(), files);
const updater = path.join(home, '.cache/ruvnet-brain/active.json'); write(updater, '{"untouched":true}');
// Composed restoration is exercised once the parent registers this target.
const compose = await import('../lib/plugin-compose.mjs');
for (const file of files) write(file, original.get(file));
const installed = compose.applyComposed(['brain-router-imports']);
assert.equal(installed.errors, 0); assert.equal(installed.incomplete, 0); assert.equal(installed.patched, 2);
for (const file of files) assert.equal(run(file).status, 0);
const restored = compose.reconcile([], ['brain-router-imports']); assert.equal(restored.errors, 0);
for (const file of files) assert.equal(fs.readFileSync(file, 'utf8'), original.get(file));
assert.equal(fs.readFileSync(updater, 'utf8'), '{"untouched":true}');
assert.equal(patcher.probeRouterImportsReplacement().state, 'live', 'bridge cannot stand in for native installed helpers');
for (const spec of patcher.SPECS) {
  const local = path.resolve(path.join(home, '.claude/model-router/bin'), spec.specifier);
  write(local, fs.readFileSync(path.join(runtime, spec.relative), 'utf8'));
}
assert.equal(patcher.probeRouterImportsReplacement().state, 'superseded', 'native installed helpers load without bridge');
const nativeLocal = path.join(home, '.claude/model-router/bin/review-model-defaults.mjs');
write(nativeLocal, 'throw new Error("invalid native import graph");');
assert.equal(patcher.probeRouterImportsReplacement().state, 'unknown', 'load failure cannot retire bridge');
assert.equal(patcher.probeRouterImportsReplacement({ files: [] }).state, 'unknown');
console.log('✓ Brain #341 router imports: missing-module red, native owner reuse/updates, packaged precedence, unsafe/absent/error refusals and exact composition restoration');
