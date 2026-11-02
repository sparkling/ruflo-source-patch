// ruflo-memory-entries-only: exact-anchor surfaces and the patched memory_retrieve handler.
// Imports the pure transform and edits only; discovery (patcher.mjs) reads the active Brain,
// so no installed runtime or managed store is touched here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeSurface, makeDescriptor } from '../lib/ruflo-memory-entries-only/transform.mjs';

const specs = JSON.parse(fs.readFileSync(new URL('../lib/ruflo-memory-entries-only/edits.json', import.meta.url), 'utf8'));
const pristineOf = (spec, sep) => {
  const body = spec.edits.map((edit) => edit.old).join(sep);
  return body.includes(spec.identity) ? body : `${spec.identity}\n${body}`;
};

for (const spec of specs) {
  const surface = makeSurface(spec);
  // Complete bundle applies, reverses and stays idempotent beside sibling text.
  const pristine = pristineOf(spec, '\nUNRELATED SIBLING TEXT\n');
  const result = surface.patch(pristine);
  assert.deepEqual(result.missing, [], `${spec.id}: complete bundle applies`);
  assert.equal(result.applied.length, spec.edits.length);
  assert(surface.patched(result.next));
  assert.equal(surface.reverse(result.next), pristine);
  assert.deepEqual(surface.patch(result.next), { next: result.next, applied: [], missing: [] });
  const sibling = (value) => value.replaceAll('UNRELATED SIBLING TEXT', 'SIBLING PATCH');
  assert.equal(surface.patch(sibling(pristine)).next, sibling(result.next));
  assert.equal(surface.reverse(sibling(result.next)), sibling(pristine));

  // Ambiguous, absent and partial anchors fail without changes.
  const plain = pristineOf(spec, '\nUNRELATED\n');
  const partial = spec.edits.length > 1 ? [plain.replace(spec.edits[0].old, spec.edits[0].new)] : [];
  for (const source of [plain + spec.edits[0].old, plain.replace(spec.edits[0].old, 'REMOVED'), ...partial]) {
    const refused = surface.patch(source);
    assert.equal(refused.next, source, `${spec.id}: refused source unchanged`);
    assert(refused.missing.length);
    assert.deepEqual(refused.applied, []);
  }

  // Patched text plus a standalone old anchor is neither patched nor reversed.
  const duplicated = `${surface.patch(plain).next}\n${spec.edits[0].old}`;
  assert.equal(surface.patched(duplicated), false);
  assert.equal(surface.patch(duplicated).next, duplicated);
  assert(surface.patch(duplicated).missing.length);
  assert.equal(surface.reverse(duplicated), duplicated);
}

const literal = makeSurface({ id: 'literal', identity: 'IDENTITY', edits: [{ id: 'one', old: 'OLD', new: 'NEW $& $` ${value}' }] });
assert.equal(literal.patch('IDENTITY OLD').next, 'IDENTITY NEW $& $` ${value}');
const descriptor = makeDescriptor({ name: 'test', discover: () => [], surfaces: specs.map(makeSurface) });
assert(descriptor.patchSource('unknown').missing.length, 'unknown identity refused');
assert(descriptor.patchSource(specs.map((spec) => spec.identity).join('\n')).missing.length, 'ambiguous identity refused');

// memory_retrieve: execute the patched handler against a stubbed getEntry.
const toolsSpec = specs.find((spec) => spec.id === 'memory-tools');
assert(toolsSpec, 'memory-tools surface present');
const toolsSurface = makeSurface(toolsSpec);
const toolsPristine = `
const missingRequiredString = (input, field) => {
  if (typeof input?.[field] !== 'string' || !input[field].trim()) return { success: false, error: 'Missing required string: ' + field };
  return null;
};
const resolveDbPathOption = (dbPath) => dbPath;
const ensureInitialized = async () => {};
const validateMemoryInput = (key, value, ttl, namespace) => {
  if (typeof key !== 'string' || !key.trim() || key === 'invalid') throw new Error('Invalid key');
  if (typeof namespace !== 'string' || !namespace.trim()) throw new Error('Invalid namespace');
};
const describeBackend = async () => 'native';
export function makeHandler(getEntry) {
  const getMemoryFunctions = async () => ({ getEntry });
  const tool = {
    name: 'memory_retrieve',
${toolsSpec.edits[0].old}
  };
  return tool.handler;
}
`;
const toolsPatched = toolsSurface.patch(toolsPristine).next;
assert.notEqual(toolsPatched, toolsPristine);
assert.deepEqual(toolsSurface.patch(toolsPatched), { next: toolsPatched, applied: [], missing: [] });
assert.equal(toolsSurface.reverse(toolsPatched), toolsPristine);
const { makeHandler } = await import('data:text/javascript;base64,' + Buffer.from(toolsPatched).toString('base64'));
const { descriptor: production } = await import('../lib/ruflo-memory-entries-only/patcher.mjs');
const toolsNarrow = production.patchSource(toolsPatched).next;
assert(!toolsNarrow.includes('memoryEntriesOnly'), 'error propagation does not select an alternate registry');
assert.equal(production.reverse(toolsNarrow), toolsPristine);
assert.equal(production.patchSource(toolsNarrow).next, toolsNarrow);
const { makeHandler: nativeHandler } = await import('data:text/javascript;base64,' + Buffer.from(toolsNarrow).toString('base64'));
assert.equal((await nativeHandler(async options => {
  assert.equal(options.memoryEntriesOnly, undefined);
  return { error: 'native read refused', found: false };
})({key: 'k', namespace: 'ns'})).success, false);
const run = (backend, input = { key: 'k', namespace: 'ns' }) => makeHandler(async () => backend)(input);

// Successful reads are unchanged, including JSON decoding and metadata.
const entry = { content: '{"n":42}', tags: ['a'], createdAt: 11, updatedAt: 12, accessCount: 13, hasEmbedding: true };
assert.deepEqual(await run({ success: true, found: true, entry }, { key: 'k' }), {
  key: 'k', namespace: 'default', value: { n: 42 }, tags: ['a'], storedAt: 11, updatedAt: 12,
  accessCount: 13, hasEmbedding: true, found: true, backend: 'native',
});
assert.equal((await run({ success: true, found: true, entry: { ...entry, content: 'plain text' } })).value, 'plain text');

// A genuine missing key stays a healthy absence.
assert.deepEqual(await run({ success: true, found: false }, { key: 'missing', namespace: 'ns' }),
  { key: 'missing', namespace: 'ns', value: null, found: false });

// Backend refusals (live-WAL, missing database, contradictory results) are failures, never absence.
for (const backend of [
  { error: 'WAL refusal: read/write locked' },
  { success: false, found: false, error: 'Database not found' },
  { success: false, found: true, entry: { content: '{}' }, error: 'contradictory failure' },
  { found: false, error: 'Database not found' },
  { success: true, found: true, entry: { content: '{}' }, error: 'bridge degraded' },
]) {
  assert.deepEqual(await run(backend), { key: 'k', namespace: 'ns', value: null, found: false, success: false, error: backend.error });
}
for (const [backend, error] of [
  [{ success: false, found: false }, 'Memory retrieval failed'],
  [{ success: false, error: new Error('WAL refusal') }, 'WAL refusal'],
  [{ success: false, error: { code: 'EBUSY' } }, '{"code":"EBUSY"}'],
]) {
  assert.deepEqual(await run(backend), { key: 'k', namespace: 'ns', value: null, found: false, success: false, error });
}
const nullResult = await run(null);
assert.equal(nullResult.success, false);
assert.match(nullResult.error, /null/);
assert.deepEqual(await makeHandler(async () => { throw new Error('boom'); })({ key: 'k', namespace: 'ns' }),
  { key: 'k', namespace: 'ns', value: null, found: false, success: false, error: 'boom' });

// Input validation is unchanged and never reaches the backend.
let calls = 0;
const counted = makeHandler(async () => { calls++; return { success: true, found: false }; });
assert.equal((await counted({ namespace: 'ns' })).error, 'Missing required string: key');
await assert.rejects(() => counted({ key: 'invalid' }), /Invalid key/);
assert.equal(calls, 0);

// Execute the actual adapter body with inert native dependencies. This is a
// connection/lifecycle test, never an open of a managed database.
{
  const { default: vm } = await import('node:vm');
  const code = specs[0].edits[0].new;
  const start = code.indexOf('async function openMemoryEntriesOnlyAgentdb(');
  const end = code.indexOf('\n/**', start);
  assert(start >= 0 && end > start);
  const adapter = code.slice(start, end).replace("await import('agentdb')", 'agentdbModule');
  const exercise = async (mode, dbPath = '/fixture/memory.db') => {
    const calls = [];
    class Database {
      constructor(file, options) {
        calls.push(['open', file, options.fileMustExist]);
        this.name = mode === 'wrong-path' ? '/wrong' : file;
        this.memory = false; this.inTransaction = false;
      }
      transaction() {}
      pragma(value) { calls.push(['pragma', value]); }
      prepare() { return { get: () => mode !== 'missing-index' }; }
      close() { calls.push(['close']); }
    }
    class EmbeddingService {
      constructor(options) { calls.push(['embedder', options.model, options.dimension, options.provider]); }
      async initialize() { if (mode === 'embedding-failure') throw Error('embedding unavailable'); }
    }
    const context = vm.createContext({
      resolveAgentdbBetterSqlite3: () => mode === 'missing-native' ? null : Database,
      canonicalDbPath: p => p, ensureBridgeSchema: () => mode !== 'schema-failure', agentdbModule: { EmbeddingService },
    });
    vm.runInContext(adapter, context);
    try {
      const result = await context.openMemoryEntriesOnlyAgentdb(dbPath);
      assert.equal(result.isWasm, false);
      result.close(); result.close();
      return { calls, result };
    } catch (error) { return { calls, error: error.message }; }
  };
  const ok = await exercise('ok');
  assert(!ok.error, ok.error);
  assert.deepEqual(ok.calls, [
    ['open', '/fixture/memory.db', true], ['pragma', 'journal_mode = WAL'],
    ['embedder', 'Xenova/all-MiniLM-L6-v2', 384, 'transformers'], ['close'],
  ]);
  assert(!(await exercise('missing-index')).error, 'native bridge permits legacy stores without vector_indexes');
  for (const [mode, expected] of [
    ['wrong-path', /identity mismatch/],
    ['schema-failure', /schema not writable/], ['embedding-failure', /embedding unavailable/],
  ]) {
    const refused = await exercise(mode);
    assert.match(refused.error, expected);
    assert.equal(refused.calls.filter(c => c[0] === 'close').length, 1, mode);
  }
  assert.deepEqual((await exercise('missing-native')).calls, []);
  assert.deepEqual((await exercise('ok', ':memory:')).calls, []);
}

console.log('ruflo-memory-entries-only: passed');

// ---- descriptor discovery/applicability: one isolated child per case, fixture roots only ----
// Block scope + dynamic imports: no name clash with the original test, no live Brain, no host state.
{
const { default: nodeOs } = await import('node:os');
const { default: nodePath } = await import('node:path');
const { spawnSync } = await import('node:child_process');

const patcherURL = new URL('../lib/ruflo-memory-entries-only/patcher.mjs', import.meta.url).href;
const transformsURL = new URL('../lib/brain-managed-memory-boundary/transforms.mjs', import.meta.url).href;
const VERSION = '9.9.9';
const TURN_CAPTURE = 'scripts/turn-outcome-capture.mjs';
const HELPER = 'scripts/ruflo-bin.mjs';
const MARKER = 'CASE_RESULT:';

// Child: env is already isolated by the parent, so the patcher import graph (paths.mjs HOME_BASE) sees fixtures only.
const CHILD = `
const spec = JSON.parse(process.argv[process.argv.length - 1]);
const attempt = (fn) => {
  try { return { ok: true, value: fn() }; }
  catch (error) { return { ok: false, name: error?.name, code: error?.code, message: String(error?.message ?? error) }; }
};
const out = {};
if (spec.mode === 'required') {
  const { VENDOR_SPECS } = await import(spec.transformsURL);
  out.relatives = VENDOR_SPECS.map((entry) => entry.relative);
} else {
  const { existsSync } = await import('node:fs');
  const mod = await import(spec.patcherURL);
  const descriptor = mod.descriptor;
  out.imported = true;
  out.api = { discover: typeof descriptor?.discover, applicability: typeof descriptor?.applicability };
  out.touchedAtImport = existsSync(spec.record);
  out.discover = attempt(() => {
    const value = descriptor.discover();
    if (!Array.isArray(value) || typeof value?.then === 'function') throw new TypeError('discover() did not synchronously return an array');
    return value;
  });
  out.applicability = typeof descriptor?.applicability === 'function'
    ? attempt(() => descriptor.applicability())
    : { ok: false, name: 'TypeError', message: 'descriptor.applicability is not a function' };
}
console.log(${JSON.stringify(MARKER)} + JSON.stringify(out));
`;

const scratch = fs.realpathSync(fs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'rsp-meo-')));
const childLog = [];
const put = (file, body, mode = 0o644) => {
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
};
const layout = (label) => {
  const dir = fs.mkdtempSync(nodePath.join(scratch, `${label}-`));
  const home = nodePath.join(dir, 'home');
  const brain = nodePath.join(home, '.cache', 'ruvnet-brain');
  const cliRoot = nodePath.join(dir, 'native', 'node_modules', '@claude-flow', 'cli');
  return {
    dir, home, brain, cliRoot,
    codex: nodePath.join(home, '.codex'),
    runtime: nodePath.join(home, '.claude', 'ruvnet-brain'),
    market: nodePath.join(home, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain'),
    activeRoot: nodePath.join(brain, 'versions', VERSION),
    claudeCache: nodePath.join(home, '.claude', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain', VERSION),
    link: nodePath.join(dir, 'native', 'node_modules', '.bin', 'ruflo'),
    cliEntry: nodePath.join(cliRoot, 'bin', 'cli.js'),
    executed: nodePath.join(dir, 'cli-executed'),
    record: nodePath.join(dir, 'resolver-record.json'),
  };
};
const envFor = (c) => ({
  HOME: c.home, RUFLO_SOURCE_PATCH_HOME: c.home, RSP_RUVNET_BRAIN_HOME: c.brain,
  RSP_CODEX_HOME: c.codex, RSP_RUVNET_BRAIN_RUNTIME: c.runtime, RSP_RUVNET_BRAIN_MARKETPLACE: c.market,
});
const spawnChild = (label, c, spec) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, JSON.stringify(spec)], {
    env: envFor(c), cwd: c.dir, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  childLog.push({ label, status: r.status, signal: r.signal });
  const diag = `status=${r.status} signal=${r.signal} stderr=${String(r.stderr ?? '').slice(0, 400)}`;
  assert.equal(r.status, 0, `${label}: case child failed (${diag})`);
  const line = String(r.stdout).split('\n').find((entry) => entry.startsWith(MARKER));
  assert(line, `${label}: case child printed no result (${diag})`);
  return JSON.parse(line.slice(MARKER.length));
};

// Required full-surface files come from the real transforms + discovery.fullSurface default list.
const probe = layout('probe');
fs.mkdirSync(probe.home, { recursive: true });
const { relatives } = spawnChild('required-files', probe, { mode: 'required', transformsURL });
assert(Array.isArray(relatives) && relatives.length > 0, 'VENDOR_SPECS relatives derived');
const required = [...relatives, 'scripts/hook-input.mjs'];

const fullSurface = (root, { helper = null, omit = [] } = {}) => {
  put(nodePath.join(root, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'ruvnet-brain', version: VERSION })}\n`);
  for (const relative of required) if (!omit.includes(relative)) put(nodePath.join(root, relative), '// fixture\n');
  put(nodePath.join(root, TURN_CAPTURE), '// fixture turn capture\n');
  if (helper !== null) put(nodePath.join(root, HELPER), helper);
};
const nativeCli = (c, packageName) => {
  put(nodePath.join(c.cliRoot, 'package.json'), `${JSON.stringify({ name: packageName, version: '0.0.0-fixture' })}\n`);
  put(c.cliEntry, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(c.executed)}, 'ran');\n`, 0o755);
  for (const relative of ['dist/src/memory/memory-bridge.js', 'dist/src/mcp-tools/memory-tools.js']) {
    put(nodePath.join(c.cliRoot, relative), '// fixture\n');
  }
  fs.mkdirSync(nodePath.dirname(c.link), { recursive: true });
  fs.symlinkSync(nodePath.relative(nodePath.dirname(c.link), c.cliEntry), c.link);
};
const buildCase = (label, { active = 'valid', helper = null, packageName = '@claude-flow/cli', omit = [], runtime = false } = {}) => {
  const c = layout(label);
  fs.mkdirSync(c.home, { recursive: true });
  const body = { syntax: '{not json\n', schema: `${JSON.stringify({ generation: 1, version: VERSION })}\n` }[active]
    ?? `${JSON.stringify({ generation: 1, version: VERSION, codeRoot: `versions/${VERSION}` })}\n`;
  if (active !== 'none') put(nodePath.join(c.brain, 'active.json'), body);
  if (active === 'valid') {
    fullSurface(c.activeRoot, { helper: helper ? helper(c) : null, omit });
    fullSurface(c.claudeCache); // second full surface: its capture file must be returned too
    if (runtime) { // persistent MCP shell is kind 'mcp': never a turn-capture target
      put(nodePath.join(c.runtime, 'mcp', 'server.mjs'), "// ruvnet-brain MCP server\nimport { MANAGED_CLI_TOOLS } from './managed-cli-interface.mjs';\n");
      put(nodePath.join(c.runtime, 'mcp', 'managed-cli-interface.mjs'), 'export const MANAGED_CLI_TOOLS = [];\n');
      put(nodePath.join(c.runtime, TURN_CAPTURE), '// must not be returned\n');
    }
  }
  if (helper) nativeCli(c, packageName);
  return c;
};
const resolverOk = (extra = '') => (c) => `import fs from 'node:fs';
${extra}
export function resolveRuflo(options) {
  fs.writeFileSync(${JSON.stringify(c.record)}, JSON.stringify({ argc: arguments.length, keys: Object.keys(options), home: options.home, env: options.env }));
  return ${JSON.stringify(c.link)};
}
`;
const exercise = (label, options) => {
  const c = buildCase(label, options);
  const res = spawnChild(label, c, { mode: 'case', patcherURL, record: c.record });
  assert.equal(res.imported, true, `${label}: patcher import must succeed`);
  assert.equal(res.touchedAtImport, false, `${label}: import must not resolve the active Brain`);
  assert.equal(res.api.discover, 'function', `${label}: descriptor.discover`);
  assert.equal(fs.existsSync(c.executed), false, `${label}: resolved CLI must never execute`);
  return { c, res };
};
const expectThrow = (label, res, match, forbid = /Cannot find module|ERR_MODULE_NOT_FOUND|did not synchronously/) => {
  const d = res.discover;
  assert.equal(d.ok, false, `${label}: discover() must throw, returned ${JSON.stringify(d.value)}`);
  assert.match(d.message, match, `${label}: unclassified failure ${d.name}: ${d.message}`);
  assert.doesNotMatch(d.message, forbid, `${label}: wrong failure class: ${d.message}`);
};
const expectNotApplicable = (label, res) => {
  assert.equal(res.discover.ok, true, `${label}: discover must not throw: ${res.discover.message}`);
  assert.deepEqual(res.discover.value, [], `${label}: discover => []`);
  assert.equal(res.applicability.ok, true, `${label}: applicability(): ${res.applicability.message}`);
  const a = res.applicability.value;
  assert.deepEqual(Object.keys(a).sort(), ['reason', 'state'], `${label}: applicability shape`);
  assert.equal(a.state, 'not-applicable');
  assert.equal(typeof a.reason, 'string');
  assert(a.reason.length > 0, `${label}: reason must be non-empty`);
};

try {
  // Not-applicable: absence of active.json, or a valid full surface lacking the native helper.
  expectNotApplicable('no-active', exercise('no-active', { active: 'none' }).res);
  expectNotApplicable('helper-absent', exercise('helper-absent').res);

  // Everything else must throw, each with its own classification.
  expectThrow('malformed-syntax', exercise('malformed-syntax', { active: 'syntax' }).res, /JSON|active\.json/i, /ENOENT|Cannot find module/);
  expectThrow('malformed-schema', exercise('malformed-schema', { active: 'schema' }).res, /active\.json|native version|codeRoot/i);
  expectThrow('stale-active', exercise('stale-active', { active: 'stale' }).res, /ENOENT|no such file|incomplete|codeRoot|versions/i, /resolveRuflo|bridge/i);
  expectThrow('incomplete-surface', exercise('incomplete-surface', { omit: [required[0]], helper: resolverOk() }).res, /incomplete|mismatched manifest/i);
  expectThrow('no-export', exercise('no-export', { helper: () => 'export const notResolveRuflo = () => 1;\n' }).res, /(?=.*resolveRuflo)(?=.*export)/i);
  for (const [label, value] of [['falsy-null', 'null'], ['falsy-empty', "''"]]) {
    expectThrow(label, exercise(label, { helper: () => `export function resolveRuflo() { return ${value}; }\n` }).res,
      /cannot resolve|did not resolve|falsy|empty|no (?:native )?(?:ruflo )?(?:executable|binary)/i, /export/i);
  }
  expectThrow('load-throws', exercise('load-throws', {
    helper: () => "throw new Error('FIXTURE_LOAD_FAILURE');\nexport function resolveRuflo() { return 'x'; }\n",
  }).res, /FIXTURE_LOAD_FAILURE/);
  expectThrow('call-throws', exercise('call-throws', {
    helper: () => "export function resolveRuflo() { throw new Error('FIXTURE_CALL_FAILURE'); }\n",
  }).res, /FIXTURE_CALL_FAILURE/);
  expectThrow('wrong-identity', exercise('wrong-identity', { helper: resolverOk(), packageName: 'not-claude-flow-cli' }).res, /identity|mismatch/i, /Cannot find module|ENOENT/);

  // Valid result followed by nonzero bridge exit must fail, not be accepted.
  const exit7 = exercise('exit-after-result', { helper: resolverOk("process.on('exit', () => process.exit(7));") });
  assert(fs.existsSync(exit7.c.record), 'exit-after-result: resolver produced its valid result first');
  expectThrow('exit-after-result', exit7.res, /\b7\b|status|exit/i, /identity|Cannot find module|did not synchronously/);

  // Success: exact resolver options, realpaths of every target, sentinel CLI never run.
  const { c, res } = exercise('success', { helper: resolverOk(), runtime: true });
  assert.equal(res.discover.ok, true, `success: discover threw ${res.discover.message}`);
  const found = res.discover.value;
  const real = (...parts) => fs.realpathSync(nodePath.join(...parts));
  assert.deepEqual([...found].sort(), [
    real(c.cliRoot, 'dist/src/memory/memory-bridge.js'),
    real(c.cliRoot, 'dist/src/mcp-tools/memory-tools.js'),
    real(c.activeRoot, TURN_CAPTURE),
    real(c.claudeCache, TURN_CAPTURE),
  ].sort(), 'success: CLI bridge, memory-tools and each full Brain capture file as realpaths');
  assert.equal(new Set(found).size, found.length, 'success: no duplicates');
  const record = JSON.parse(fs.readFileSync(c.record, 'utf8'));
  assert.equal(record.argc, 1);
  assert.deepEqual([...record.keys].sort(), ['env', 'home'], 'resolveRuflo receives exactly {env, home}');
  assert.equal(record.home, c.home);
  for (const [key, value] of Object.entries(envFor(c))) assert.equal(record.env[key], value, `resolver env ${key}`);
  assert.deepEqual(Object.keys(record.env).filter((key) => key.startsWith('__RUFLO_BRIDGE')), [], 'bridge payload var removed before call');
  assert.equal(res.applicability.ok, true, `success: applicability(): ${res.applicability.message}`);
  assert.deepEqual(res.applicability.value, { state: 'applicable' });
  assert.equal(fs.existsSync(c.executed), false, 'success: sentinel CLI never executed');
} finally {
  console.log('ruflo-memory-entries-only descriptor children:', JSON.stringify(childLog));
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log('ruflo-memory-entries-only: descriptor discovery passed');
}

// Withdrawn initialization changes are recognized only for exact rollback.
{
  const {captureCostEdits, legacySchemaCheck, legacyDescriptor: current, descriptor: withdrawnDescriptor} = await import('../lib/ruflo-memory-entries-only/patcher.mjs');
  let source = pristineOf(specs[0], '\n');
  for (const [from] of captureCostEdits) if (!makeSurface(specs[0]).patch(source).next.includes(from)) source += '\n'+from;
  const original = makeSurface(specs[0]).patch(source).next;
  const withdrawn = captureCostEdits.reduce((s,[from,to]) => s.replace(from,()=>to),original);
  assert.equal(current.historicalPatchSource(source,withdrawn).next,withdrawn);
  assert.equal(current.patchSource(withdrawn).next,original);
  assert(current.isPatched(original));assert(!current.isPatched(withdrawn));
  assert.equal(current.reverse(withdrawn),source);
  assert.equal(current.patchSource(original).next,original);
  const oldRequirement = original.replace('        const embedder = new EmbeddingService({',
    legacySchemaCheck + '        const embedder = new EmbeddingService({');
  assert(current.hasPatch(oldRequirement));
  assert(!current.isPatched(oldRequirement));
  assert.equal(current.historicalPatchSource(source, oldRequirement).next, oldRequirement);
  assert.equal(current.patchSource(oldRequirement).next, original);
  assert.equal(current.reverse(oldRequirement), source);
  const drifted = oldRequirement.replace('vector_indexes table missing', 'unexpected schema drift');
  assert(current.patchSource(drifted).missing.length);
  assert.equal(current.patchSource(drifted).next, drifted);
  assert(withdrawnDescriptor.isPatched(source));
  assert(!withdrawnDescriptor.isPatched(original));
  assert.equal(withdrawnDescriptor.patchSource(original).next, source);
  assert.equal(withdrawnDescriptor.patchSource(oldRequirement).next, source);
  assert.equal(withdrawnDescriptor.patchSource(source).next, source);
  assert(withdrawnDescriptor.patchSource(drifted).missing.length);
}
