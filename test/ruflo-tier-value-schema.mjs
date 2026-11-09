import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateText } from './fixtures/aidefence-schema/validate-text-native.js';
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-tier-schema-')));
process.env.RUFLO_SOURCE_PATCH_HOME = tmp;
process.env.RUFLO_GLOBAL_ROOT = path.join(tmp, 'global');
process.env.RUFLO_NPX_ROOT = path.join(tmp, 'npx');
process.env.RSP_CODEX_HOME = path.join(tmp, '.codex');
const patch = await import('../lib/ruflo-tier-value-schema/patcher.mjs');
const compose = await import('../lib/plugin-compose.mjs');
const source = fs.readFileSync(new URL('./fixtures/tier-value-schema/native-3.71.4.js', import.meta.url), 'utf8');
const validator = fs.readFileSync(new URL('./fixtures/aidefence-schema/validate-text-native.js', import.meta.url), 'utf8');
const changed = patch.patchSource(source);
assert.deepEqual(changed.missing, []);
assert(patch.isPatched(changed.next));
assert.equal(patch.reverse(changed.next), source);
assert.equal(patch.patchSource(changed.next).next, changed.next);
const native = source.replace(patch.ANCHOR, patch.NATIVE).replace(patch.OLD_ERROR, patch.ERROR);
assert(patch.nativeSatisfied(native));
assert.equal(patch.reverse(native), native);
assert.equal(patch.patchSource(native).next, native);
assert.equal(changed.next.slice(changed.next.indexOf('    handler:')).replace(patch.ERROR, patch.OLD_ERROR),
  source.slice(source.indexOf('    handler:')), 'only the misleading empty-value message changes in the handler');
for (const mutant of [source + source, source.replace(patch.GUARD, ''),
  source.replace('Memory entry value', 'Unknown native contract'),
  changed.next.replace('maxLength: 10000', 'maxLength: 20000'),
  changed.next.replace(patch.MARKER, patch.MARKER + ' unknown'),
  source.replace('value.length === 0', 'value.trim().length === 0')]) {
  assert(patch.patchSource(mutant).missing.length);
  assert.equal(patch.patchSource(mutant).next, mutant);
  assert.equal(patch.reverse(mutant), mutant);
}
function tool(body) {
  const effects = [];
  const bridge = { bridgeHierarchicalStore: async params => { effects.push(params); return { success: true, id: 'fixture' }; } };
  const value = new Function('validateText', 'validateIdentifier', 'validateIsoTimestamp', 'sanitizeError', 'getBridge',
    body.replace('export const agentdbHierarchicalStore', 'const agentdbHierarchicalStore') + '\nreturn agentdbHierarchicalStore;')(
    validateText, () => ({ valid: true }), value => ({ value }), String,
    async () => { effects.push('getBridge'); return bridge; });
  return { value, effects };
}
for (const value of [undefined, null, {}, '', '\0', 'a'.repeat(9999), 'a'.repeat(10000),
  'a'.repeat(10001), '😀'.repeat(5000), '😀'.repeat(5000) + 'a', '😀'.repeat(5001)]) {
  const before = tool(source), after = tool(changed.next);
  const args = { key: 'fixture-key', value, tier: 'semantic', supersedes: 'prior-fixture' };
  const a = await before.value.handler(args), b = await after.value.handler(args);
  if (value === '') assert.equal(b.error, 'value is required (non-empty string, max 10000 UTF-16 code units)');
  else assert.deepEqual(b, a);
  assert.deepEqual(after.effects, before.effects, 'unchanged native value, tier and supersedes effects');
  const valid = typeof value === 'string' && value.length > 0 && value.length <= 10000;
  assert.equal(after.effects.length, valid ? 2 : 0, 'invalid values never reach the bridge or supersede records');
  if (valid) assert.equal(after.effects[1].value, value, 'never truncate or normalize the supplied value');
  const schema = after.value.inputSchema.properties.value;
  assert.equal(schema.minLength, 1); assert.equal(schema.maxLength, 10000);
  assert.match(schema.description, /UTF-16 code units/);
  assert.match(schema.description, /Unicode code points/);
}
try {
  const file = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src/mcp-tools/agentdb-tools.js');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
  const validationFile = path.join(path.dirname(file), 'validate-input.js'); fs.writeFileSync(validationFile, validator);
  assert(patch.preflight([file]).ok);
  const installed = compose.applyComposed([patch.NAME]);
  assert.equal(installed.errors, 0); assert.equal(installed.incomplete, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), changed.next);
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), source);
  assert.equal(compose.applyComposed([patch.NAME]).patched, 0);
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  fs.writeFileSync(validationFile, validator.replace('10_000', '20_000'));
  assert(!patch.preflight([file]).ok, 'changed effective native bound refuses installation');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('PASS tier value schema: native UTF-16/nonempty guards, exact value and supersedes behavior, no bridge effects on refusal, exact restoration and drift refusal');
