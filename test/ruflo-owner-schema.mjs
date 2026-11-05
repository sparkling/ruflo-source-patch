import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalSchemaEdits } from '../lib/ruflo-memory-owner/canonical.mjs';
import { patchSource } from '../lib/ruflo-memory-owner/patcher.mjs';

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
