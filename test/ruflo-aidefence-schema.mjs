import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateText } from './fixtures/aidefence-schema/validate-text-native.js';

const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-aidefence-schema-')));
process.env.RUFLO_SOURCE_PATCH_HOME = temporary;
process.env.RUFLO_GLOBAL_ROOT = path.join(temporary, 'global');
process.env.RUFLO_NPX_ROOT = path.join(temporary, 'npx');
process.env.RSP_CODEX_HOME = path.join(temporary, '.codex');
const patch = await import('../lib/ruflo-aidefence-schema/patcher.mjs');
const config = await import('../lib/ruflo-aidefence-config/patcher.mjs');
const compose = await import('../lib/plugin-compose.mjs');
const fixture = name => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const source = fixture('aidefence-schema/scan-native-3.71.4.js');
const validator = fixture('aidefence-schema/validate-text-native.js');
const published = fixture('aidefence-schema/scan-native-3.75.0.js');
assert(patch.nativeSatisfied(published));
assert.equal(patch.patchSource(published).next, published);
assert.equal(patch.reverse(published), published);
assert(!patch.nativeSatisfied(published.replace('maxLength: 10000', 'maxLength: 20000')));
assert(!patch.nativeSatisfied(published.replace(patch.GUARD, '')));
const changed = patch.patchSource(source);
assert.deepEqual(changed.missing, []);
assert(patch.isPatched(changed.next));
assert.equal(patch.reverse(changed.next), source);
assert.equal(patch.patchSource(changed.next).next, changed.next);
assert.equal(changed.next.slice(changed.next.indexOf('    handler:')),
  source.slice(source.indexOf('    handler:')), 'native handler is byte-identical');
const native = source.replace(patch.ANCHOR, patch.NATIVE);
assert(patch.nativeSatisfied(native));
assert.equal(patch.patchSource(native).next, native);
assert.equal(patch.reverse(native), native);
for (const mutant of [source + source, source.replace(patch.GUARD, ''),
  source.replace('Text to scan for threats', 'Changed'),
  changed.next.replace('maxLength: 10000', 'maxLength: 20000'),
  changed.next.replace(patch.MARKER, patch.MARKER + ' drift')]) {
  assert(patch.patchSource(mutant).missing.length);
  assert.equal(patch.patchSource(mutant).next, mutant);
  assert.equal(patch.reverse(mutant), mutant);
}
assert(patch.validatorQualified(validator));
assert(!patch.validatorQualified(validator.replace('10_000', '20_000')));
assert(!patch.validatorQualified(validator.replace('value.length', '[...value].length')));

// Execute the exact native handler and validator; only detector/known-miss dependencies
// are doubles. No runtime imports, model calls, managed files or learning writes.
function tool(body, verdict) {
  const calls = [];
  const defender = {
    detect: async input => { calls.push(input); return verdict; },
    quickScan: input => { calls.push(input); return { threat: !verdict.safe, confidence: 0.8 }; },
    hasPII: () => verdict.piiFound,
  };
  const value = new Function('validateText', 'getAIDefence', 'findKnownMiss', 'wrapperStats',
    body + '\nreturn aidefenceScanTool;')(validateText, async () => defender, () => null,
      { quickScanCalls: 0, quickScanThreats: 0 });
  return { value, calls };
}
for (const input of ['', 'a'.repeat(9999), 'a'.repeat(10000), 'a'.repeat(10001),
  '😀'.repeat(4999) + 'a', '😀'.repeat(5000), '😀'.repeat(5000) + 'a', '😀'.repeat(10000)]) {
  for (const quick of [false, true]) for (const safe of [false, true]) {
    const verdict = { safe, piiFound: true, detectionTimeMs: 1,
      threats: safe ? [] : [{ type: 'test', severity: 'high', confidence: 1, description: 'fixture' }] };
    const before = tool(source, verdict), after = tool(changed.next, verdict);
    assert.equal(before.value.inputSchema.properties.input.maxLength, undefined, 'reproduce missing advertised bound');
    const a = await before.value.handler({ input, quick }), b = await after.value.handler({ input, quick });
    const upstream = tool(published, verdict);
    assert.deepEqual(await upstream.value.handler({ input, quick }), a);
    assert.deepEqual(upstream.calls, before.calls);
    assert.equal(upstream.value.inputSchema.properties.input.maxLength, 10000);
    assert.deepEqual(b, a);
    assert.deepEqual(after.calls, input.length > 10000 ? [] : [input], 'no truncation or validation bypass');
    assert.equal(Boolean(b.isError), input.length > 10000);
    const schema = after.value.inputSchema.properties.input;
    assert.equal(schema.maxLength, 10000);
    assert.match(schema.description, /UTF-16 code units/);
    if ([...input].length > schema.maxLength) assert(input.length > 10000);
  }
}
console.log('PASS scan schema: native guard/detector results unchanged at BMP and astral boundaries, no truncation, exact restoration and drift refusal');

try {
  const file = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src/mcp-tools/security-tools.js');
  const combined = fixture('aidefence-config/loader-native-3.71.1.js') + source;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, combined);
  const validationFile = path.join(path.dirname(file), 'validate-input.js');
  fs.writeFileSync(validationFile, validator);
  assert(patch.preflight([file]).ok);
  const installed = compose.applyComposed([config.NAME, patch.NAME]);
  assert.equal(installed.errors, 0, JSON.stringify(installed));
  assert.equal(installed.incomplete, 0, JSON.stringify(installed));
  const bytes = fs.readFileSync(file, 'utf8');
  assert(config.isPatched(bytes)); assert(patch.isPatched(bytes));
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), combined);
  assert.equal(compose.applyComposed([config.NAME, patch.NAME]).patched, 0);
  assert.equal(compose.reconcile([config.NAME], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), config.patchSource(combined).next);
  assert.equal(compose.reconcile([], [config.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), combined);
  const coreRoot = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/node_modules/@claude-flow/cli-core');
  fs.mkdirSync(coreRoot, { recursive: true });
  fs.writeFileSync(path.join(coreRoot, 'package.json'), JSON.stringify({
    name: '@claude-flow/cli-core', exports: { './mcp-tools/validate-input': './validate-input.js' },
  }));
  fs.writeFileSync(path.join(coreRoot, 'validate-input.js'), validator);
  fs.writeFileSync(validationFile, "export * from '@claude-flow/cli-core/mcp-tools/validate-input';\n");
  assert(patch.preflight([file]).ok, 'qualify native cli-core delegation without executing it');
  fs.writeFileSync(path.join(coreRoot, 'validate-input.js'), validator.replace('10_000', '20_000'));
  assert(!patch.preflight([file]).ok, 'changed delegated bound refuses');
  fs.writeFileSync(validationFile, validator.replace('10_000', '20_000'));
  assert(!patch.preflight([file]).ok, 'changed native limit refuses before patching');
  console.log('PASS scan schema composition: sibling config preserved, install/idempotence/uninstall, native limit drift refusal');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
