import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { CONTEXT_OLD, CONTEXT_NEW } from '../lib/ruflo-context-contract/patcher.mjs';

const argv = process.argv.slice(2);
assert.ok(argv.length === 0 || (argv.length === 2 && argv[0] === '--native-cli'
  && path.isAbsolute(argv[1]) && path.basename(argv[1]) === 'package.json'),
'Usage: node test/ruflo-context-contract.mjs [--native-cli <absolute CLI package.json>]');
const nativeCli = argv[1];
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'context-contract-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
const root = path.join(scratch, 'npx', 'fixture', 'node_modules', '@claude-flow', 'cli');
const mem = path.join(root, 'dist', 'src', 'memory');
fs.mkdirSync(mem, { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), '{"name":"@claude-flow/cli","version":"fixture","type":"module"}');
const file = path.join(mem, 'memory-bridge.js');
const prelude = `let registry;
export function setRegistry(value) { registry = value; }
async function getRegistry() { if (registry instanceof Error) throw registry; return registry; }
export function projectRootProbe() { return [process.cwd(), '.swarm'].join('/'); }
`;
const pristine = prelude + CONTEXT_OLD + '\n';
fs.writeFileSync(file, pristine);
const { apply } = await import('../lib/cwd/patch-library.mjs');
const critique = 'Use explicit outcome fields when adapting stored episodes.';
const episode = (overrides = {}) => ({ task: 'repair adapter', success: true, reward: 0.8, critique, ...overrides });
const examples = [episode(), episode({ task: 'test adapter', success: false, reward: 0.2 })];
let captured = [], calls = 0, recallCalls = [];
const controller = {
  async synthesize(patterns, options) {
    calls++;
    captured = patterns;
    assert.deepEqual(options, { includeRecommendations: true });
    return {
      summary: patterns.length ? 'Controller-owned summary' : 'No relevant memories found.',
      patterns: [], recommendations: [], keyInsights: [], totalMemories: patterns.length,
      successRate: patterns.length ? patterns.filter(p => p.success).length / patterns.length : 0,
      averageReward: patterns.length ? patterns.reduce((sum, p) => sum + p.reward, 0) / patterns.length : 0,
    };
  },
};
function registryFor(rows, { real = false, cs = controller, recallError } = {}) {
  const hm = {
    async recall(...args) {
      recallCalls.push(args);
      await Promise.resolve();
      if (recallError) throw recallError;
      return rows;
    },
  };
  if (real) hm.promote = () => assert.fail('recall must not promote memories');
  return { get(name) { return name === 'contextSynthesizer' ? cs : name === 'hierarchicalMemory' ? hm : null; } };
}
function reset() { captured = []; calls = 0; recallCalls = []; }
function assertCounts(result, recalled, eligible, excluded) {
  assert.equal(result.recalledCount, recalled);
  assert.equal(result.eligibleCount, eligible);
  assert.equal(result.excludedCount, excluded);
  assert.equal(result.inputContract, 'validated-memory-pattern-v1');
}
async function mappingProof(mod) {
  reset();
  mod.setRegistry(registryFor(examples));
  const result = await mod.bridgeContextSynthesize({ query: 'adapter' });
  assert.equal(result.success, true);
  assert.deepEqual(captured, examples, 'task, true/false, actual rewards and repeated critiques survive');
  assert.equal(result.synthesis.successRate, 0.5);
  assert.equal(result.synthesis.averageReward, 0.5);
  assertCounts(result, 2, 2, 0);
}
async function nativeProof(mod, original) {
  if (!nativeCli) return; // Default suite needs only Node and this repository.
  const cliPackage = fs.realpathSync(nativeCli);
  const cliMeta = JSON.parse(fs.readFileSync(cliPackage, 'utf8'));
  assert.equal(cliMeta.name, '@claude-flow/cli', '--native-cli must identify the CLI package');
  const requireFromCli = createRequire(cliPackage);
  // Resolve only the pure static controller, never AgentDB's index, registry,
  // installed memory bridge, database driver, or any MCP/service entrypoint.
  const controllerFile = requireFromCli.resolve('agentdb/controllers/ContextSynthesizer');
  assert.equal(path.basename(controllerFile), 'ContextSynthesizer.js');
  const { ContextSynthesizer } = await import(pathToFileURL(controllerFile).href);
  assert.equal(typeof ContextSynthesizer?.synthesize, 'function');
  original.setRegistry({ get(name) {
    return name === 'contextSynthesizer' ? ContextSynthesizer : { recall: () => examples };
  } });
  const before = await original.bridgeContextSynthesize({ query: 'adapter' });
  assert.equal(before.success, true);
  assert.equal(before.synthesis.successRate, 0);
  assert.equal(before.synthesis.averageReward, 1);
  assert.deepEqual(before.synthesis.patterns, [], 'old mapper drops critique-derived patterns');
  for (const real of [false, true]) {
    mod.setRegistry(registryFor(examples, { real, cs: ContextSynthesizer }));
    const after = await mod.bridgeContextSynthesize({ query: 'adapter' });
    assert.equal(after.success, true);
    assert.equal(after.status, 'complete');
    assertCounts(after, 2, 2, 0);
    assert.equal(after.synthesis.successRate, 0.5);
    assert.equal(after.synthesis.averageReward, 0.5);
    assert.deepEqual(after.synthesis.patterns, ['use explicit outcome fields when adapting stored episodes (2/2 times)']);
  }
  console.log('Native ContextSynthesizer: original 0/1/no patterns; patched 0.5/0.5/repeated critique (both recall forms; no DB).');
}
try {
  const applied = apply(['ruflo-context-contract']);
  assert.equal(applied.patched, 1, JSON.stringify(applied));
  assert.equal(applied.incomplete, 0);
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), pristine);
  assert.equal(apply(['ruflo-context-contract']).patched, 0, 'idempotent');
  assert.equal(spawnSync(process.execPath, ['--check', file]).status, 0);
  const mod = await import(pathToFileURL(file).href);
  await mappingProof(mod);
  assert.deepEqual(recallCalls, [['adapter', 10]], 'async legacy recall is awaited');
  assert.equal(calls, 1);

  reset();
  mod.setRegistry(registryFor(examples, { real: true }));
  let result = await mod.bridgeContextSynthesize({ query: 'adapter', maxEntries: 3 });
  assert.deepEqual(recallCalls, [[{ query: 'adapter', k: 3 }]], 'object-query recall is awaited');
  assert.equal(result.status, 'complete');
  assertCounts(result, 2, 2, 0);

  const zero = episode({ success: false, reward: 0, input: '', output: '', similarity: 0 });
  const negativeZero = episode({ reward: -0 });
  const large = episode({ reward: 2.5 });
  const negative = episode({ reward: -3.5 });
  const accepted = [zero, negativeZero, large, negative];
  for (const value of accepted) Object.freeze(value);
  reset();
  mod.setRegistry(registryFor(Object.freeze(accepted)));
  result = await mod.bridgeContextSynthesize({ query: 'adapter' });
  assert.equal(result.success, true);
  assert.deepEqual(captured, accepted, 'no clamping, coercion or mutation');
  assert.equal(Object.is(captured[1].reward, -0), true);
  assert.notEqual(captured[0], zero, 'only a fresh validated projection reaches the controller');

  reset();
  const packed = [
    { key: 'first', value: JSON.stringify(examples[0]) },
    { id: 'second', content: JSON.stringify(examples[1]) },
    { value: zero }, { content: zero },
    { value: zero, content: { ...zero } },
    { ...zero, value: { ...zero } },
  ];
  mod.setRegistry(registryFor(packed));
  result = await mod.bridgeContextSynthesize({ query: 'adapter' });
  assert.equal(result.success, true);
  assertCounts(result, 6, 6, 0);
  assert.deepEqual(captured, [examples[0], examples[1], zero, zero, zero, zero]);
  assert.ok(captured.every(row => !Object.hasOwn(row, 'key') && !Object.hasOwn(row, 'value')));

  let getterCalls = 0;
  const accessor = { ...zero };
  Object.defineProperty(accessor, 'success', { get() { getterCalls++; return true; } });
  const optionalAccessor = { ...zero };
  Object.defineProperty(optionalAccessor, 'critique', { get() { getterCalls++; return critique; } });
  const wrapperAccessor = {};
  Object.defineProperty(wrapperAccessor, 'value', { get() { getterCalls++; return zero; } });
  const invalid = [
    null, undefined, [], 'plain string', JSON.stringify(zero),
    { key: 'fact', value: 'The project uses Node.' }, { content: 'Use the default database.' },
    { value: '{"task":' }, { value: 'null' }, { value: '[]' }, { value: '{"fact":"yes"}' },
    { value: JSON.stringify({ ...zero, success: 'false' }) },
    { value: '{"task":"repair","success":false,"success":true,"reward":0}' },
    { value: '{"task":"repair","success":false,"succe\\u0073s":true,"reward":0}' },
    { value: JSON.stringify(episode({ critique: 'x'.repeat(65_536) })) },
    { value: JSON.stringify(episode({ critique: '€'.repeat(30_000) })) },
    { value: { task: 'repair', success: true } }, { value: { task: 'repair', reward: 0 } },
    { success: true, reward: 0 }, episode({ task: '' }), episode({ task: '   ' }),
    episode({ task: 9 }), episode({ success: 0 }), episode({ success: 'true' }),
    episode({ reward: '0' }), episode({ reward: null }), episode({ reward: NaN }),
    episode({ reward: Infinity }), episode({ reward: -Infinity }),
    episode({ critique: {} }), episode({ input: [] }), episode({ output: 0 }),
    episode({ similarity: '0' }), episode({ similarity: NaN }),
    Object.create(zero), Object.create({ value: zero }), accessor, optionalAccessor, wrapperAccessor,
    { value: zero, content: { ...zero, success: true } },
    { ...zero, value: { ...zero, reward: 1 } },
  ];
  for (const row of invalid) {
    reset();
    mod.setRegistry(registryFor([row]));
    result = await mod.bridgeContextSynthesize({ query: 'adapter' });
    assert.equal(result.success, false, `ineligible row: ${typeof row}`);
    assert.equal(result.status, 'no-eligible-episodes');
    assertCounts(result, 1, 0, 1);
    assert.equal(Object.hasOwn(result, 'synthesis'), false, 'facts do not acquire measured outcomes');
    assert.equal(calls, 0);
  }
  assert.equal(getterCalls, 0, 'accessors never provide evidence');

  reset();
  const inheritedOptional = Object.assign(Object.create({ critique: 'invented critique', similarity: 1 }),
    { task: 'repair', success: false, reward: 0 });
  const pollution = { value: '{"__proto__":{"success":true},"task":"repair","success":false,"reward":0}' };
  mod.setRegistry(registryFor([inheritedOptional, pollution]));
  result = await mod.bridgeContextSynthesize({ query: 'adapter' });
  assert.equal(result.success, true);
  assert.deepEqual(captured, [{ task: 'repair', reward: 0, success: false }, { task: 'repair', reward: 0, success: false }]);
  assert.equal({}.success, undefined, 'JSON keys do not modify prototypes');

  reset();
  mod.setRegistry(registryFor([...examples, ...invalid]));
  result = await mod.bridgeContextSynthesize({ query: 'adapter' });
  assert.equal(result.success, true);
  assert.equal(result.status, 'partial');
  assertCounts(result, 2 + invalid.length, 2, invalid.length);
  assert.deepEqual(captured, examples);
  assert.equal(result.synthesis.totalMemories, 2, 'denominator counts only eligible episodes');

  reset();
  mod.setRegistry(registryFor([]));
  result = await mod.bridgeContextSynthesize({ query: 'adapter' });
  assert.equal(result.success, true);
  assert.equal(result.status, 'no-memories');
  assert.equal(result.synthesis.summary, 'No relevant memories found.');
  assertCounts(result, 0, 0, 0);
  assert.equal(calls, 1, 'native empty-result contract is retained');

  for (const badParams of [null, undefined, {}, { query: '' }, { query: 1 },
    Object.create({ query: 'inherited' }), { query: 'x'.repeat(10_001) },
    ...[0, -1, 1.5, '3', NaN, Infinity, null].map(maxEntries => ({ query: 'x', maxEntries }))]) {
    reset();
    mod.setRegistry(registryFor(examples));
    result = await mod.bridgeContextSynthesize(badParams);
    assert.equal(result.success, false);
    assert.equal(result.phase, 'input');
    assertCounts(result, null, null, null);
    assert.equal(calls, 0);
    assert.deepEqual(recallCalls, []);
  }
  for (const [registry, phase] of [
    [null, 'registry'], [new Error('registry failed'), 'registry'], [{}, 'registry'],
    [registryFor([], { cs: null }), 'controller'],
    [{ get: name => name === 'contextSynthesizer' ? controller : null }, 'recall'],
    [registryFor(null), 'recall'], [registryFor({ entries: examples }), 'recall'],
    [registryFor([], { recallError: new Error('recall failed') }), 'recall'],
  ]) {
    reset();
    mod.setRegistry(registry);
    result = await mod.bridgeContextSynthesize({ query: 'adapter' });
    assert.equal(result.success, false);
    assert.equal(result.status, 'error');
    assert.equal(result.phase, phase);
    assertCounts(result, null, null, null);
    assert.ok(result.error);
    assert.equal(calls, 0);
  }
  for (const synthesize of [
    () => { throw new Error('controller failed'); },
    async () => { throw new Error('async controller failed'); },
    () => { throw null; }, () => undefined, () => ({ success: false, error: 'refused' }),
    () => ({ summary: 'invalid', patterns: [], recommendations: [], keyInsights: [], totalMemories: 2,
      successRate: 0.5, averageReward: Infinity }),
  ]) {
    mod.setRegistry(registryFor(examples, { cs: { synthesize } }));
    result = await mod.bridgeContextSynthesize({ query: 'adapter' });
    assert.equal(result.success, false);
    assert.equal(result.status, 'error');
    assert.equal(result.phase, 'synthesis');
    assertCounts(result, 2, 2, 0);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length);
  }

  // These mutant functions run in isolation; no source package or database is imported.
  for (const [find, replace] of [
    ['success: success.value', 'success: true'],
    ['reward: reward.value', 'reward: 1'],
    ["['critique', 'input', 'output', 'similarity']", "['input', 'output', 'similarity']"],
    ['await hm.recall(query.value, maxEntries)', 'hm.recall(query.value, maxEntries)'],
  ]) {
    assert.ok(CONTEXT_NEW.includes(find), `mutant anchor: ${find}`);
    const mutant = await import('data:text/javascript;base64,' + Buffer.from(prelude + CONTEXT_NEW.replace(find, replace)).toString('base64'));
    await assert.rejects(() => mappingProof(mutant), { name: 'AssertionError' });
  }
  const original = await import('data:text/javascript;base64,' + Buffer.from(prelude + CONTEXT_OLD).toString('base64'));
  await assert.rejects(() => mappingProof(original), { name: 'AssertionError' }, 'baseline fails the contract proof');
  await nativeProof(mod, original);

  assert.equal(apply(['cwd', 'ruflo-context-contract']).incomplete, 0, 'shared-file composition');
  let bytes = fs.readFileSync(file, 'utf8');
  assert.ok(bytes.includes(CONTEXT_NEW));
  assert.ok(bytes.includes('__rufloResolveRoot(process.cwd())'));
  assert.equal(apply(['cwd']).incomplete, 0);
  bytes = fs.readFileSync(file, 'utf8');
  assert.ok(bytes.includes(CONTEXT_OLD), 'context uninstalls while cwd remains');
  assert.ok(bytes.includes('__rufloResolveRoot(process.cwd())'));
  assert.equal(apply(['ruflo-context-contract']).incomplete, 0);
  bytes = fs.readFileSync(file, 'utf8');
  assert.ok(bytes.includes(CONTEXT_NEW));
  assert.ok(!bytes.includes('__rufloResolveRoot(process.cwd())'));
  apply([]);
  assert.equal(fs.readFileSync(file, 'utf8'), pristine, 'byte-exact restoration');

  for (const changed of [pristine.replace('reward: 1,', 'reward: 0.5,'), pristine + CONTEXT_OLD]) {
    fs.writeFileSync(file, changed);
    const drift = apply(['ruflo-context-contract']);
    assert.ok(drift.incomplete > 0);
    assert.ok(drift.skipped > 0);
    assert.equal(fs.readFileSync(file, 'utf8'), changed, 'missing/duplicate anchors leave unknown source untouched');
  }
  console.log('Context contract: outcomes, bounded JSON, async recall, eligibility, errors, mutants, composition and reversal passed (no DB).');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
