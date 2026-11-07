import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalEdits, priorCanonicalEdits, canonicalSchemaEdits } from '../lib/ruflo-memory-owner/canonical.mjs';
import { patchSource, reverse, isPatched, historicalPatchSource, descriptor,
  unifiedSearchYield, unifiedNamespaceProjection } from '../lib/ruflo-memory-owner/patcher.mjs';
import { isKnownComposition } from '../lib/composition-proof.mjs';

// A physical-file claimant may not support an older source shape. That refusal
// must not throw out an independently exact sibling's historical composition.
{
  const source = 'export const unrelated = true;\n';
  const current = source + '// verified sibling contribution\n';
  const sibling = { name: 'fixture-sibling', atomic: true, patchSource: value => ({
    next: value === source ? current : value, applied: value === source ? ['sibling'] : [], missing: [],
  }) };
  const refused = historicalPatchSource(source, current);
  assert.equal(refused.next, source);
  assert.deepEqual(refused.applied, []);
  assert.ok(refused.missing.length, 'unsupported owner shape stays refused');
  assert.equal(isKnownComposition(source, current, [descriptor, sibling]), true);
  assert.equal(isKnownComposition(source, current + '// foreign change\n', [descriptor, sibling]), false);
  assert.equal(isKnownComposition(source, current, [descriptor]), false,
    'an unsupported owner cannot claim a sibling contribution');
}

const names = ['memory_store', 'memory_retrieve', 'memory_list', 'memory_search', 'memory_delete'];
const property = "                dbPath: { type: 'string', description: 'Explicit SQLite store to read/write; omit to use the MCP default (the native/AgentDB sibling).' },";
const section = (name, args) => `    {
        name: '${name}',
        inputSchema: { type: 'object', properties: {
${property}
        } },
        handler: async (${args}) => {
            return resolveDbPathOption(input.dbPath, context);
        },
    },`;
for (const args of ['input', 'input, context']) {
  const source = names.map(name => section(name, args)).join('\n');
  const edits = canonicalSchemaEdits(source);
  assert.equal(edits.length, 5);
  const patched = edits.reduce((text, [from, to]) => text.replace(from, to), source);
  assert.equal((patched.match(/nativeResult:/g) ?? []).length, 5);
  assert.equal((patched.match(/resolveDbPathOption\(input.dbPath, context\)/g) ?? []).length, 5,
    'retain upstream context-aware path validation');
  assert.equal(edits.reduceRight((text, [from, to]) => text.replace(to, from), patched), source);
  assert.deepEqual(canonicalSchemaEdits(patched), edits);
  for (const name of names) {
    assert.throws(() => canonicalSchemaEdits(source.replace(section(name, args), section(name, 'unknown'))),
      /Missing or ambiguous native schema/, 'never consume the next tool schema');
    assert.throws(() => canonicalSchemaEdits(source.replace(section(name, args), section(name, args).replace(property, property + '\n' + property))),
      /Ambiguous native path schema/);
  }
}
// ST03 2026-11-05: a canonical store with an object value must forward the
// handler's validated JSON string. The raw object reached better-sqlite3 and
// failed before any row was written, surfacing only the sql.js fallback refusal.
{
  const helper = new Function(canonicalEdits[0][1].replace('export const memoryTools = [', 'return rspCanonicalMemoryOptions;'))();
  const storeCall = edits => edits.find(([from]) => from.includes('await storeEntry({'))[1];
  const run = async (edits, input) => {
    const seen = [];
    const body = `const rawValue = input.value;
      const value = typeof rawValue === 'string' ? rawValue : (rawValue !== undefined ? JSON.stringify(rawValue) : '');
      const { key, namespace = 'default', tags = [], ttl, provenance_type: provenanceType } = input; const upsert = input.upsert !== false;
      ${storeCall(edits)}
      return result;`;
    const handler = new Function('rspCanonicalMemoryOptions', 'storeEntry', 'input', 'dbPath', `return (async () => { ${body} })();`);
    const result = await handler(helper, async options => { seen.push(options); return { success: true, id: 'native' }; }, input, '/abs/agentdb-memory.db');
    return { result, options: seen[0] };
  };
  const value = { schema: 'review/v1', checks: { dryRuns: 6 }, finding: 'exact' };
  const input = { nativeResult: true, requireNative: true, key: 'k', namespace: 'reviews', value,
    tags: ['t'], provenance_type: 'agent_output', dbPath: '/abs/agentdb-memory.db' };
  const current = await run(canonicalEdits, input);
  assert.deepEqual(current.result, { success: true, id: 'native' }, 'canonical result returned unchanged');
  assert.equal(current.options.value, JSON.stringify(value), 'forward the exact validated string bytes');
  assert.equal(input.value, value, 'caller input is not mutated');
  assert.equal(current.options.requireNative, true);
  assert.equal(current.options.provenanceType, 'agent_output');
  assert.equal(current.options.dbPath, '/abs/agentdb-memory.db');
  assert.equal(Object.hasOwn(current.options, 'upsert'), false, 'no presentation default injected');
  const text = await run(canonicalEdits, { ...input, value: 'already text' });
  assert.equal(text.options.value, 'already text', 'string values are byte-identical');
  const prior = await run(priorCanonicalEdits, input);
  assert.equal(prior.options.value, value, 'reproduces released raw-object forwarding');
  for (const [name, edits] of [['current', canonicalEdits], ['prior', priorCanonicalEdits]])
    assert.equal(edits.filter(([from]) => from.includes('await storeEntry({')).length, 1, name);
  assert.deepEqual(canonicalEdits.filter(([from]) => !from.includes('await storeEntry({')),
    priorCanonicalEdits.filter(([from]) => !from.includes('await storeEntry({')), 'only the store rendition changes');

  // Installed prior bytes upgrade exactly and restore the pristine anchors.
  const tools = 'export const memoryTools = [\n' + names.map(name => section(name, 'input, context')).join('\n') + '\n'
    + canonicalEdits.slice(1).map(([from]) => from).join('\n') + '\n'
    + fs.readFileSync(new URL('./fixtures/ruflo-memory-owner/unified-search-3.71.4.js', import.meta.url), 'utf8') + '\n];\n';
  const patched = patchSource(tools);
  assert.deepEqual(patched.missing, []);
  assert.equal(isPatched(patched.next), true);
  assert.equal(reverse(patched.next), tools);
  assert(patched.next.includes('{ ...rspCanonicalMemoryOptions(input, dbPath), value }'));
  const release152 = patched.next.replace(unifiedSearchYield[1], unifiedSearchYield[0])
    .replace(unifiedNamespaceProjection[1], unifiedNamespaceProjection[0]);
  assert.equal(patchSource(release152).next, patched.next, '152 upgrades without losing canonical string normalization');
  assert.equal(reverse(release152), tools, '152 restores pristine source exactly');
  const installedPrior = release152.replace('{ ...rspCanonicalMemoryOptions(input, dbPath), value }', 'rspCanonicalMemoryOptions(input, dbPath)');
  assert.notEqual(installedPrior, patched.next);
  assert.equal(isPatched(installedPrior), false, 'monitor reports the released raw-value rendition as drift');
  assert.deepEqual(patchSource(installedPrior).missing, []);
  assert.equal(patchSource(installedPrior).next, patched.next, 'released rendition upgrades exactly');
  assert.equal(reverse(installedPrior), tools, 'released rendition restores exactly');
  const unknown = installedPrior.replace('rspCanonicalMemoryOptions(input, dbPath) : {', 'rspCanonicalMemoryOptions(input, dbPath ) : {');
  assert.deepEqual(patchSource(unknown).next, unknown, 'unknown modification is never overwritten');
  assert.ok(patchSource(unknown).missing.length);
}
if (process.env.RSP_OWNER_NATIVE_SRC) {
  const base = process.env.RSP_OWNER_NATIVE_SRC;
  const source = fs.readFileSync(path.join(base, 'mcp-tools/memory-tools.js'), 'utf8');
  const resolver = source.match(/function resolveDbPathOption\(inputDbPath, context\) \{[\s\S]*?\n\}/)?.[0];
  if (resolver) {
    const patched = patchSource(source);
    assert.deepEqual(patched.missing, []);
    assert(patched.next.includes(resolver), 'owner forwarding must preserve the entire native path resolver');
    const safety = await import(pathToFileURL(path.join(base, 'mcp-tools/path-containment.js')));
    const resolveDbPathOption = new Function('resolve', 'isLocalCliCall', 'dbPathError', resolver + '\nreturn resolveDbPathOption;')(
      path.resolve, safety.isLocalCliCall, safety.dbPathError);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-path-'));
    try {
      const text = path.join(dir, 'fixture.db'), link = path.join(dir, 'alias.db');
      fs.writeFileSync(text, 'not a database'); fs.symlinkSync(text, link);
      assert.throws(() => resolveDbPathOption(text), /not a SQLite database/);
      assert.throws(() => resolveDbPathOption(link), /symlink/);
      assert.throws(() => resolveDbPathOption(text, { 'ruflo.localCliCall': true }), /not a SQLite database/);
      assert.equal(resolveDbPathOption(text, safety.localCliContext()), text, 'only native local CLI capability retains operator path choice');
      assert.equal(resolveDbPathOption(path.join(dir, 'new.db')), path.join(dir, 'new.db'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}
console.log('PASS native owner schemas: legacy and context-aware handlers; unchanged path guards; ambiguous/unknown handlers refused');
