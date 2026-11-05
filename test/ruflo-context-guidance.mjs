import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scratch = fs.realpathSync(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-context-guidance-')));
const taskHome = path.join(scratch, 'home'), globalRoot = path.join(scratch, 'global');
const codexHome = path.join(taskHome, '.codex');
process.env.RUFLO_SOURCE_PATCH_HOME = taskHome;
process.env.RUFLO_GLOBAL_ROOT = globalRoot;
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RSP_CODEX_HOME = codexHome;
process.env.RSP_RUFLO_CODEX_MARKETPLACE = path.join(codexHome, '.tmp', 'marketplaces', 'ruflo');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/ruflo-context-guidance.json', import.meta.url), 'utf8'));
const patcher = await import('../lib/ruflo-context-guidance/patcher.mjs');
const { NAME, MARKER, patchSource, reverseSource, isPatched, isNative, discover, preflight, probeNativeGuidance } = patcher;
const nativeText = source => source.split(/(?<=\n)/).filter(line => !line.includes(MARKER)).join('');
const stripDescriptions = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'description' ? undefined : item));

for (const key of ['tool', 'skill', 'researcher']) {
  for (const crlf of [false, true]) {
    const original = crlf ? fixture[key].replaceAll('\n', '\r\n') : fixture[key];
    const result = patchSource(original);
    assert.deepEqual(result.missing, [], key);
    assert.equal(result.applied.length, 1, key);
    assert.ok(isPatched(result.next));
    assert.deepEqual(patchSource(result.next), { next: result.next, applied: [], missing: [] });
    assert.equal(reverseSource(result.next), original, 'exact LF/CRLF restoration');
    assert.match(result.next, /explicit task, finite numeric reward and boolean success/);
    assert.match(result.next, /No matching or eligible episodes does not mean research records are missing/);
    assert.match(result.next, /Never invent outcomes or rewrite facts as episodes/);
    const native = nativeText(result.next);
    assert.ok(isNative(native));
    assert.deepEqual(patchSource(native), { next: native, applied: [], missing: [] });
    assert.equal(reverseSource(native), native, 'native corrections are not ours to undo');
    const duplicate = original + original;
    assert.ok(patchSource(duplicate).missing.length);
    assert.equal(patchSource(duplicate).next, duplicate);
    const changed = result.next.replace('finite numeric reward', 'invented reward');
    assert.ok(patchSource(changed).missing.length);
    assert.equal(reverseSource(changed), changed, 'unknown marked edits cannot be restored');
  }
}

// Exact current upstream metadata retires locally without touching handlers.
const upstreamGuidance = {
  "tool": "export const agentdbContextSynthesize = {\n    name: 'agentdb_context-synthesize',\n    description: 'Summarize validated task episodes (task, reward, success, critique) that match a query: observed success rate, reward and critique-derived patterns. Ordinary documents, research notes and graph entities are not episodes, so for them it answers no-memories or no-eligible-episodes; read those with memory_search or memory_retrieve instead. Use when generic memory_* tools are wrong because you need AgentDB-specific controllers (HNSW vector search, hierarchical tiers, causal-graph links, pattern store/recall, RaBitQ quantization). For simple key-value persistence, memory_store/memory_retrieve are simpler. For unrelated file work, native Read/Write are fine.',\n    inputSchema: {\n        type: 'object',\n        properties: {\n            query: { type: 'string', description: 'Task to find matching validated episodes for' },\n            maxEntries: { type: 'number', description: 'Maximum episodes to include (default: 10)' },\n        },\n        required: ['query'],\n    },",
  "skill": "   - Synthesize the findings yourself from what the searches return. `mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize` is not a document synthesizer: it summarizes validated task episodes (task, reward, success) and answers `no-memories` or `no-eligible-episodes` for research notes and sources, which is the correct answer, not missing research",
  "researcher": [
    "6. **Synthesize** \u2014 Write the research summary yourself from the graph findings and the records `memory_search` / `memory_retrieve` returned. Use `agentdb_context-synthesize` only for past task outcomes: it summarizes validated task episodes (task, reward, success) and answers `no-eligible-episodes` for documents and graph entities, which is correct, not a gap in the research.",
    "- `mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize` \u2014 summarize validated task episodes (past task outcomes); not for documents or graph findings"
  ]
};
const upstreamFixtures = {
  tool: fixture.tool.slice(0, fixture.tool.indexOf('export const agentdbContextSynthesize')) + upstreamGuidance.tool + '\n' + fixture.tool.slice(fixture.tool.indexOf('    handler:')),
  skill: fixture.skill.replace(/^   - .*for AI-assisted context building$/m, upstreamGuidance.skill),
  researcher: fixture.researcher.replace(/6\. \*\*Synthesize\*\*[\s\S]*?   ```\n/, upstreamGuidance.researcher[0] + '\n')
    .replace(/^- `mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize`.*$/m, upstreamGuidance.researcher[1]),
};
for (const source of Object.values(upstreamFixtures)) {
  assert(isNative(source)); assert.equal(patchSource(source).next, source); assert.equal(reverseSource(source), source);
  assert.equal(isNative(source.replace('validated task episodes', 'fabricated task episodes')), false);
}

const fixedSkill = patchSource(fixture.skill).next, fixedAgent = patchSource(fixture.researcher).next;
assert.doesNotMatch(fixedSkill, /for AI-assisted context building/);
assert.doesNotMatch(fixedAgent, /— merge multi-source findings|Merge graph findings into a coherent research summary:/);
assert.equal(fixedSkill.match(/^allowed-tools:.*$/m)[0], fixture.skill.match(/^allowed-tools:.*$/m)[0], 'preserve native permitted identifiers');
assert.equal((fixedAgent.match(/agentdb_context-synthesize\(\{ query: "TOPIC", maxEntries: 10 \}\)/g) || []).length, 1, 'retain real episode usage');
const drift = fixture.skill.replace('for AI-assisted context building', 'for unknown context building');
assert.ok(patchSource(drift).missing.length);
assert.equal(patchSource(drift).next, drift, 'unknown anchor is not rewritten');

const originalTool = fixture.tool, fixedTool = patchSource(originalTool).next;
assert.equal(fixedTool.slice(fixedTool.indexOf('    handler:')), originalTool.slice(originalTool.indexOf('    handler:')), 'executable handler remains byte-identical');
function instantiate(source, response, calls) {
  return new Function('getBridge', 'validateText', 'validateString', 'validatePositiveInt', 'MAX_TOP_K', 'sanitizeError',
    source.replace('export const ', 'const ') + '\nreturn agentdbContextSynthesize;')(
    async () => ({ bridgeContextSynthesize: async args => { calls.push(args); return response; } }),
    value => ({ valid: typeof value === 'string', error: 'query must be a string' }),
    value => value.trim(), (value, fallback, maximum) => Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback,
    100, error => error.message,
  );
}
const incident = { query: 'complete economics composition adoption FUR P1 fair comparison', maxEntries: 5 };
const outcomes = [
  { success: false, reason: 'no-memories', error: 'No memories matched the query', recalled: 0, eligible: 0, skipped: 0 },
  { success: false, reason: 'no-eligible-episodes', error: 'Recalled memories have no validated task outcomes', recalled: 5, eligible: 0, skipped: 5 },
  { success: true, synthesis: { successRate: 0, averageReward: 0, totalMemories: 1 } },
  null,
];
for (const response of outcomes) {
  const beforeCalls = [], afterCalls = [];
  const before = instantiate(originalTool, response, beforeCalls), after = instantiate(fixedTool, response, afterCalls);
  assert.equal(after.name, before.name);
  assert.deepEqual(stripDescriptions(after.inputSchema), stripDescriptions(before.inputSchema));
  assert.deepEqual(await after.handler(incident), await before.handler(incident), 'preserve exact native no-match/error/outcome result');
  assert.deepEqual(afterCalls, beforeCalls);
  assert.deepEqual(afterCalls, [incident], 'query and maxEntries are unchanged');
  assert.deepEqual(await after.handler({ query: 42 }), await before.handler({ query: 42 }));
}

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const cliRoot = path.join(globalRoot, '@claude-flow', 'cli');
write(path.join(cliRoot, 'package.json'), JSON.stringify({ name: '@claude-flow/cli', version: '3.71.1', type: 'module' }));
const toolFile = path.join(cliRoot, 'dist', 'src', 'mcp-tools', 'agentdb-tools.js');
write(toolFile, fixture.tool);
const originals = new Map([[toolFile, fixture.tool]]), registry = { plugins: {} };
for (const [plugin, relative, text] of [
  ['ruflo-goals', 'skills/research-synthesize/SKILL.md', fixture.skill],
  ['ruflo-core', 'agents/researcher.md', fixture.researcher],
]) {
  const claudeCache = path.join(taskHome, '.claude', 'plugins', 'cache', 'ruflo', plugin, '1.0.0');
  registry.plugins[`${plugin}@ruflo`] = [{ scope: 'user', installPath: claudeCache }];
  for (const root of [
    claudeCache,
    path.join(taskHome, '.claude', 'plugins', 'marketplaces', 'ruflo', 'plugins', plugin),
    path.join(codexHome, 'plugins', 'cache', 'ruflo', plugin, '1.0.0'),
    path.join(process.env.RSP_RUFLO_CODEX_MARKETPLACE, 'plugins', plugin),
  ]) {
    write(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: plugin, version: '1.0.0' }));
    const file = path.join(root, relative); write(file, text); originals.set(file, text);
  }
  const inactive = path.join(taskHome, '.claude', 'plugins', 'cache', 'ruflo', plugin, '0.0.0');
  write(path.join(inactive, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: plugin, version: '0.0.0' }));
  write(path.join(inactive, relative), 'unselected historical content');
}
write(path.join(taskHome, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify(registry));
assert.deepEqual(new Set(discover()), new Set(originals.keys()), 'both host marketplaces and selected caches; no inactive cache');
assert.ok(preflight().ok);
assert.notEqual(probeNativeGuidance().state, 'fixed');
const { applyComposed, reconcile, statusComposed } = await import('../lib/plugin-compose.mjs');
let applied = applyComposed([NAME]);
assert.equal(applied.errors, 0, JSON.stringify(applied));
assert.equal(applied.incomplete, 0, JSON.stringify(applied));
assert.equal(applied.patched, originals.size);
for (const [file, original] of originals) {
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), original);
  assert.equal(fs.readFileSync(file, 'utf8'), patchSource(original).next);
}
assert.equal(statusComposed([NAME])[NAME].patched, originals.size);
applied = applyComposed([NAME]);
assert.equal(applied.errors, 0);
assert.equal(applied.patched, 0);
let restored = reconcile([], [NAME]);
assert.equal(restored.errors, 0, JSON.stringify(restored));
assert.equal(restored.restored, originals.size);
for (const [file, original] of originals) assert.equal(fs.readFileSync(file, 'utf8'), original);

// Exercise the public dispatcher: direct composition alone cannot prove CLI adoption.
write(path.join(taskHome, '.claude', 'settings.json'), '{}\n');
const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../bin/cli.mjs', import.meta.url)), ...args], {
  cwd: scratch, encoding: 'utf8', timeout: 30000,
  env: { ...process.env, RSP_NO_SELF_UPDATE: '1', RSP_NO_MONITOR_RECOVER: '1',
    RSP_NO_LAUNCHCTL: '1', RSP_NO_STALE_WRITER_KILL: '1', RSP_NO_HOST_AUTO_UPDATE: '1' },
});
const cliOk = (...args) => {
  const result = cli(...args);
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
const { readState, writeState } = await import('../lib/cwd/state.mjs');
cliOk(NAME, 'install');
assert.ok(readState().pluginTargets.includes(NAME), 'named CLI install tracks guidance');
for (const [file, original] of originals) assert.equal(fs.readFileSync(file, 'utf8'), patchSource(original).next);
assert.match(cliOk(NAME, 'status'), /9\/9 file\(s\) patched.*tracked/);
cliOk(NAME, 'uninstall');
assert.ok(!readState().pluginTargets.includes(NAME));
for (const [file, original] of originals) assert.equal(fs.readFileSync(file, 'utf8'), original);

// Retire unrelated targets only in this fixture so `all install` proves adoption
// of the new target without requiring every other target's vendor source fixtures.
const { PATCH_TARGETS } = await import('../lib/cwd/patch-library.mjs');
const { PLUGIN_TARGETS } = await import('../lib/plugin-registry.mjs');
const retired = Object.fromEntries([...PATCH_TARGETS, ...PLUGIN_TARGETS].filter(name => name !== NAME)
  .map(name => [name, { at: '2026-11-04T00:00:00.000Z', reason: 'unrelated fixture target', evidence: 'isolated test' }]));
writeState({ patchTargets: [], pluginTargets: [], retired, all: true });
cliOk('all', 'install');
assert.deepEqual(readState().pluginTargets, [NAME], 'all install adopts the new composing target');
assert.equal(readState().all, true);
for (const [file, original] of originals) assert.equal(fs.readFileSync(file, 'utf8'), patchSource(original).next);
assert.match(cliOk(NAME, 'status'), /9\/9 file\(s\) patched.*tracked/);
cliOk(NAME, 'uninstall');
for (const [file, original] of originals) assert.equal(fs.readFileSync(file, 'utf8'), original);
writeState({ patchTargets: [], pluginTargets: [], retired: {}, all: false });

// Independently fetched unknown CLI bytes remain incomplete without freezing
// the verified active package or shared plugin guidance.
const unknownTool = path.join(process.env.RUFLO_NPX_ROOT, 'unknown/node_modules/@claude-flow/cli/dist/src/mcp-tools/agentdb-tools.js');
const unknownSource = fixture.tool.replace('Synthesize context from stored memories', 'Unknown changed upstream contract');
write(unknownTool, unknownSource);
assert.deepEqual(preflight().blockedFiles, [unknownTool]);
applied = applyComposed([NAME]);
assert.ok(applied.incomplete > 0);
assert.equal(fs.readFileSync(unknownTool, 'utf8'), unknownSource);
assert.equal(fs.existsSync(unknownTool + '.rsp-backup'), false);
assert.equal(fs.readFileSync(toolFile, 'utf8'), patchSource(fixture.tool).next);
fs.rmSync(path.join(process.env.RUFLO_NPX_ROOT, 'unknown'), { recursive: true });
assert.equal(reconcile([], [NAME]).errors, 0);

const selected = [...originals.keys()].find(file => file.endsWith('SKILL.md'));
write(selected, drift);
applied = applyComposed([NAME]);
assert.ok(applied.errors || applied.incomplete, 'unknown selected guidance cannot report success');
assert.equal(fs.readFileSync(selected, 'utf8'), drift);
assert.equal(fs.readFileSync(toolFile, 'utf8'), fixture.tool, 'target preflight prevents partial apply');
write(selected, originals.get(selected));
const outside = path.join(scratch, 'outside.md'); write(outside, fixture.skill);
fs.unlinkSync(selected); fs.symlinkSync(outside, selected);
assert.equal(preflight().ok, false, 'selected escaping symlink refuses preflight');
assert.equal(fs.readFileSync(outside, 'utf8'), fixture.skill);
fs.unlinkSync(selected); write(selected, originals.get(selected));

for (const [file, original] of originals) write(file, nativeText(patchSource(original).next));
assert.equal(probeNativeGuidance().state, 'fixed');
const { evaluate } = await import('../lib/supersede.mjs');
assert.equal(evaluate(NAME).state, 'fixed', 'shared retirement predicate accepts corrected native guidance');
applied = applyComposed([NAME]);
assert.equal(applied.errors, 0, JSON.stringify(applied));
assert.equal(applied.patched, 0, 'native fix is never repatched');
restored = reconcile([], [NAME]);
assert.equal(restored.errors, 0);
for (const [file, original] of originals) assert.equal(fs.readFileSync(file, 'utf8'), nativeText(patchSource(original).next));
console.log('✓ context guidance: source routing, unchanged native handler/results, exact rollback, host selection, public CLI/all adoption, drift refusal and native retirement');
