import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-hook-id-schema-')));
process.env.RUFLO_SOURCE_PATCH_HOME = temporary;
process.env.RUFLO_GLOBAL_ROOT = path.join(temporary, 'global');
process.env.RUFLO_NPX_ROOT = path.join(temporary, 'npx');
process.env.RSP_CODEX_HOME = path.join(temporary, '.codex');
const patch = await import('../lib/ruflo-hook-id-schema/patcher.mjs');
const compose = await import('../lib/plugin-compose.mjs');
const fixture = name => fs.readFileSync(new URL(`./fixtures/hook-id-schema/${name}`, import.meta.url), 'utf8');
const source = fixture('post-task-native.js'), core = fixture('validator-core.js'), shim = fixture('validator-shim.js');
const published = fixture('native-3.75.0.js');
assert(patch.nativeSatisfied(published));
assert.equal(patch.patchSource(published).next, published);
assert.equal(patch.reverse(published), published);
assert(!patch.nativeSatisfied(published.replace('maxLength: 128', 'maxLength: 256')));
assert(!patch.nativeSatisfied(published.replace("validateIdentifier(agent, 'agent')", 'changed(agent)')));
const result = patch.patchSource(source);
assert.deepEqual(result.missing, []);
assert(patch.isPatched(result.next));
assert.equal(patch.reverse(result.next), source);
assert.equal(patch.patchSource(result.next).next, result.next);
assert.equal(result.next.slice(result.next.indexOf('    handler:')),
  source.slice(source.indexOf('    handler:')), 'entire native handler is byte-identical');
for (const changed of [source + source, source.replace("validateIdentifier(parentAgentId, 'parentAgentId')", 'changed(parentAgentId)'),
  source.replace('Agent that completed the task', 'Changed description'), result.next.replace('maxLength: 128', 'maxLength: 129')]) {
  assert(patch.patchSource(changed).missing.length);
  assert.equal(patch.patchSource(changed).next, changed);
  assert.equal(patch.reverse(changed), changed);
}
// Execute the unchanged native validation prefix, stopping before any persistence.
const validateIdentifier = new Function(core.replace('export function validateIdentifier', 'function coreValidateIdentifier')
  + shim.slice(shim.indexOf('const RESERVED_KEYS')).replace('export function', 'function')
  + '\nreturn validateIdentifier;')();
const load = text => new Function('validateIdentifier', 'feedbackPatternsSchema', 'validateFeedbackPatterns',
  text.slice(0, text.indexOf('        const depthRaw = params.depth;')).replace('export const', 'const')
  + "        return { reachedEffects: true };\n    },\n};\nreturn hooksPostTask;")(
    validateIdentifier, {}, () => []);
const old = load(source), updated = load(result.next), upstream = load(published);
const permits = (schema, value) => typeof value === schema.type
  && [...value].length >= (schema.minLength ?? 0) && [...value].length <= schema.maxLength
  && (schema.anyOf ? value === '' || new RegExp(schema.anyOf[1].pattern).test(value)
    : new RegExp(schema.pattern).test(value)) && !schema.not.enum.includes(value);
assert.deepEqual(updated.inputSchema.required, ['taskId']);
for (const field of ['taskId', 'agent', 'parentAgentId']) {
  assert.equal(old.inputSchema.properties[field].pattern, undefined);
  for (const value of ['', 'a', '_', 'a-b.c:d', '/root/adr095_queen', 'a/b', '.a', '-a', ':a',
    '__proto__', 'constructor', 'prototype', 'Constructor', 'a'.repeat(128), 'a'.repeat(129),
    '\n', '\r\n', 'a\n', 'a'.repeat(128) + '\n', 'a b', 'a;b', 'é', '😀', 'a\\b']) {
    const args = { taskId: 'task-1', [field]: value };
    const before = await old.handler(args), after = await updated.handler(args);
    assert.deepEqual(await upstream.handler(args), before);
    assert.equal(permits(upstream.inputSchema.properties[field], value), after.reachedEffects === true);
    assert.deepEqual(after, before, 'native rejection/effects boundary unchanged');
    assert.equal(permits(updated.inputSchema.properties[field], value), after.reachedEffects === true,
      `${field}: ${JSON.stringify(value)}`);
  }
}
assert((await updated.handler({ taskId: 'task-1' })).reachedEffects, 'optional IDs remain optional');
assert((await upstream.handler({ taskId: 'task-1' })).reachedEffects);
assert(!(await upstream.handler({})).reachedEffects);
assert(!(await updated.handler({})).reachedEffects, 'required task ID still refuses before effects');
try {
  const file = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src/mcp-tools/hooks-tools.js');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
  fs.writeFileSync(path.join(path.dirname(file), 'validate-input.js'), shim);
  const coreRoot = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/node_modules/@claude-flow/cli-core');
  fs.mkdirSync(coreRoot, { recursive: true });
  fs.writeFileSync(path.join(coreRoot, 'package.json'), JSON.stringify({
    name: '@claude-flow/cli-core', exports: { './mcp-tools/validate-input': './validate-input.js' },
  }));
  const validatorFile = path.join(coreRoot, 'validate-input.js');
  fs.writeFileSync(validatorFile, core + '/**\n * Validate a git ref');
  assert(patch.preflight([file]).ok);
  const installed = compose.applyComposed([patch.NAME]);
  assert.equal(installed.errors, 0, JSON.stringify(installed));
  assert.equal(installed.incomplete, 0, JSON.stringify(installed));
  assert.equal(fs.readFileSync(file, 'utf8'), result.next);
  assert.equal(compose.applyComposed([patch.NAME]).patched, 0);
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  fs.writeFileSync(validatorFile, core.replace('value.length > 128', 'value.length > 256') + '/**\n * Validate a git ref');
  assert(!patch.preflight([file]).ok, 'changed core validator refused');
  fs.writeFileSync(validatorFile, core + '/**\n * Validate a git ref');
  fs.writeFileSync(path.join(path.dirname(file), 'validate-input.js'), shim.replace("'prototype'", "'changed'"));
  assert(!patch.preflight([file]).ok, 'changed reserved names refused');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log('PASS post-task ID schemas: native validation/effects boundary unchanged; reserved/optional/length/character cases; install, reverse, drift refusal');
