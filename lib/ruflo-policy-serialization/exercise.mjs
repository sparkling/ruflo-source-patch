// Isolated executable proof of the actual native private writer/transaction bodies.
// No managed project, database, credentials or native engine is opened.
import assert from 'node:assert/strict';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = Buffer.alloc(32, 7);
export function policyFixture(mode = 'legacy', size = 12) {
  const receipts = [];
  for (let index = 0; index < size; index++) {
    const payload = { index, decision: 'allowed', detail: 'fixture detail', previous: receipts.at(-1)?.hash || null };
    const digest = hash(payload);
    receipts.push({ payload, hash: digest, signature: createHmac('sha256', key).update(digest).digest('hex') });
  }
  return { version: 1, mode, configuredMode: mode, rules: [{ id: 'rule', effect: 'deny',
    actions: ['claude-code.write'], constraints: { maxCostUsd: 1 }, roles: ['fixture'] }],
  budgets: [{ id: 'cap', limit: 1 }], usage: [{ id: 'cap', used: 0.5 }],
  approvals: [{ id: 'approval', uses: 1 }], migratedFrom: 'fixture', migratedAt: 123,
  receipts, ledgerLength: receipts.length, ledgerHead: receipts.at(-1)?.hash || null };
}
function ownedBodies(source) {
  const retry = source.indexOf('const RENAME_RETRY_DELAYS_MS');
  const first = retry >= 0 ? retry : source.indexOf('function writeJsonAtomic');
  const last = source.indexOf('function detectLegacyCapabilities', first);
  const transaction = source.indexOf('export async function withPolicyTransaction');
  const end = source.indexOf('function verifyPolicyEvidence', transaction);
  if (first < 0 || transaction < 0) throw new Error('native policy writer/transaction absent');
  const writer = source.slice(first, last < 0 ? transaction : last);
  const body = source.slice(transaction, end < 0 ? source.length : end).replace('export async function', 'async function');
  return writer + '\n' + body + '\nreturn { withPolicyTransaction, writePolicyState, verifyStateAnchor };';
}
export function policyHarness(source, options = {}) {
  const root = '/synthetic-unmanaged-policy';
  const statePath = root + '/state.json';
  const files = new Map(), promotions = [], sleeps = [], writes = [], projections = [];
  const initial = structuredClone(options.state || policyFixture(options.mode));
  let engine, releases = 0, verifyCalls = 0, inspected = 0, exports = 0, completeSerializations = 0;
  let fullClones = 0, injectedFailures = options.failures || 0, mutated = false;
  const code = options.failureCode || 'EBUSY';
  const copy = value => { if (value?.receipts) fullClones++; return structuredClone(value); };
  const json = { parse: JSON.parse, stringify(value, ...args) {
    if (value?.receipts) completeSerializations++;
    return JSON.stringify(value, ...args);
  } };
  const api = new Function('AgenticPolicyEngine', 'paths', 'acquireLock', 'loadPolicyState',
    'verifyPolicyEvidence', 'mkdirSync', 'dirname', 'randomUUID', 'writeFileSync', 'renameSync',
    'unlinkSync', 'sleep', 'userInfo', 'join', 'createHash', 'realpathSync', 'existsSync',
    'randomBytes', 'readFileSync', 'createHmac', 'timingSafeEqual', 'syncPolicyProjection',
    'structuredClone', 'JSON', 'process', ownedBodies(source))({ fromState(state, configuration) {
      assert.equal(configuration.approvalIssuerVerifier, options.approvalIssuerVerifier);
      if (options.engineClass) {
        engine = options.engineClass.fromState(state, configuration);
        const verify = engine.verifyLedger.bind(engine), exported = engine.exportState.bind(engine);
        engine.verifyLedger = () => { verifyCalls++; inspected += engine.state.receipts.length; return verify(); };
        engine.exportState = () => { exports++; return exported(); };
        return engine;
      }
      engine = { state, exportState() { exports++; return copy(this.state); }, verifyLedger() {
        verifyCalls++;
        const valid = this.state.receipts.every((receipt, index, rows) => {
          inspected++;
          return receipt.payload.index === index && receipt.payload.previous === (rows[index - 1]?.hash || null)
            && receipt.hash === hash(receipt.payload)
            && receipt.signature === createHmac('sha256', key).update(receipt.hash).digest('hex');
        }) && this.state.ledgerLength === this.state.receipts.length
          && this.state.ledgerHead === (this.state.receipts.at(-1)?.hash || null);
        return { valid };
      } };
      return engine;
    } }, () => ({ dir: root, state: statePath, lock: root + '/state.lock' }),
    async () => () => { releases++; }, () => structuredClone(initial), () => true,
    () => {}, path.dirname, () => 'unique-fixture', (file, value, settings) => {
      assert.equal(settings.mode, 0o600); writes.push(file); files.set(file, Buffer.from(value));
      if (options.mutateDuringWrite && engine && !mutated) {
        mutated = true; engine.state.mode = 'legacy'; engine.state.rules[0].constraints.maxCostUsd = 999;
        engine.state.receipts[0].payload.detail = 'changed after snapshot'; engine.state.approvals[0].uses = 999;
      }
    }, (from, to) => {
      if (options.failTarget && to.endsWith(options.failTarget)) throw Object.assign(new Error('fixture rename failed'), { code: 'EIO' });
      if (injectedFailures-- > 0) throw Object.assign(new Error('fixture transient rename'), { code });
      if (!files.has(from)) throw new Error('fixture missing temp');
      files.set(to, files.get(from)); files.delete(from); promotions.push(to);
    }, file => files.delete(file), async ms => sleeps.push(ms), () => ({ homedir: root }), path.join,
    createHash, value => value, file => files.has(file), () => key,
    file => { if (!files.has(file)) throw new Error('fixture missing file'); return files.get(file); },
    createHmac, timingSafeEqual, (project, state) => {
      assert.equal(project, root); if (options.projectionFailure) throw new Error('fixture projection failure');
      projections.push(structuredClone(state));
    }, copy, json, { pid: 1, env: { CLAUDE_FLOW_POLICY_SIGNING_KEY: options.signingKey }, stderr: { write() {} } });
  // Establish the external anchor through the native ordinary writer when requested.
  return { api, initial, root, statePath, files, promotions, projections, writes, sleeps,
    async seedAnchor() { await api.writePolicyState(root, statePath, initial); this.resetCounters(); },
    resetCounters() { exports = 0; completeSerializations = 0; fullClones = 0; promotions.length = 0; writes.length = 0; projections.length = 0; },
    async run(operation = () => 'allowed') {
      return api.withPolicyTransaction(root, operation, { approvalIssuerVerifier: options.approvalIssuerVerifier });
    },
    state() { return JSON.parse(files.get(statePath).toString()); },
    metrics() { return { releases, verifyCalls, inspected, exports, completeSerializations, fullClones }; } };
}
export async function exercisePolicySerialization(source) {
  const outcomes = [];
  for (const [mode, anchored] of [['legacy', false], ['enforce', false], ['enforce', true]]) {
    const h = policyHarness(source, { mode, mutateDuringWrite: true, approvalIssuerVerifier: () => true });
    if (anchored) await h.seedAnchor();
    assert.equal(await h.run(), 'allowed');
    assert.deepEqual(h.state(), h.initial, 'all ledger, approval, budget and metadata fields preserved');
    if (source.includes('syncPolicyProjection(projectRoot, state)'))
      assert.deepEqual(h.projections.at(-1), { mode: h.initial.mode, rules: h.initial.rules }, 'independent mode/rules projection');
    h.api.verifyStateAnchor(h.root, h.state());
    const metrics = h.metrics();
    assert.equal(metrics.exports, 0, 'native transaction must avoid complete exportState clone');
    assert.equal(metrics.fullClones, 0, 'native transaction must not clone the complete ledger');
    // Verifying an existing external anchor adds one complete serialization after persistence.
    assert.equal(metrics.completeSerializations, mode === 'enforce' ? 2 : 1, 'one immutable complete transaction serialization');
    assert.equal(metrics.verifyCalls, 1); assert.equal(metrics.inspected, h.initial.receipts.length);
    assert.equal(metrics.releases, 1);
    const order = h.promotions.map(file => file === h.statePath ? 'state' : 'anchor');
    assert.deepEqual(order, mode === 'legacy' ? ['state'] : anchored ? ['state', 'anchor'] : ['anchor', 'state']);
    outcomes.push({ mode, anchored, ...metrics });
  }
  for (const mutation of [state => state.receipts[3].payload.detail = 'tampered',
    state => state.receipts.pop(), state => state.receipts[3].signature = 'bad']) {
    const state = policyFixture(); mutation(state); const h = policyHarness(source, { state });
    await assert.rejects(h.run(), /policy-ledger-verification-failed/);
    assert.equal(h.writes.length, 0); assert.equal(h.metrics().releases, 1);
  }
  for (const failTarget of ['state.json', 'state.anchor.json']) {
    const h = policyHarness(source, { mode: 'enforce', failTarget });
    await assert.rejects(h.run(), /fixture rename failed/); assert.equal(h.metrics().releases, 1);
    if (source.includes('let renamed = false;'))
      assert.equal([...h.files.keys()].filter(file => file.endsWith('.tmp')).length, 0);
    if (h.files.has(h.statePath)) assert.throws(() => h.api.verifyStateAnchor(h.root, h.state()));
  }
  if (source.includes('TRANSIENT_RENAME_CODES')) {
    const transient = policyHarness(source, { failures: 2 }); await transient.run();
    assert.deepEqual(transient.sleeps, [25, 50]); assert.deepEqual(transient.state(), transient.initial);
  }
  const projectionFailure = policyHarness(source, { projectionFailure: true });
  assert.equal(await projectionFailure.run(), 'allowed'); assert.deepEqual(projectionFailure.state(), projectionFailure.initial);
  const ordinary = policyHarness(source, { mode: 'enforce' });
  await ordinary.api.writePolicyState(ordinary.root, ordinary.statePath, ordinary.initial);
  assert.deepEqual(ordinary.state(), ordinary.initial); ordinary.api.verifyStateAnchor(ordinary.root, ordinary.state());
  assert.match(ordinary.files.get(ordinary.statePath).toString(), /\n  "version"/, 'ordinary writers retain native formatting/contract');
  return outcomes;
}
