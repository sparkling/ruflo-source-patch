// Exercise native capture methods against fixture receipts; never open a managed database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { discover } from './patcher.mjs';
import { composeSource, isOurs } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';
import { existingPathRelative } from '../path-containment.mjs';

export function storeFixture(source) {
  const start = source.indexOf('  appendExact('), end = source.indexOf('\n  replay()', start);
  if (start < 0 || end < 0) throw new Error('native append/capture boundary absent');
  const typeStart = source.indexOf('export class ProgressionKeyCollisionError');
  const typeEnd = source.indexOf('export class ProjectProgressionStore {');
  const type = typeStart >= 0 && typeEnd > typeStart ? source.slice(typeStart, typeEnd) : '';
  return `import { createProgressionSnapshot, digestCanonical, validateProgressionSnapshot } from './project-progression-contract.mjs';
const PROGRESSION_NAMESPACE = 'project-progression';
const resultStatus = r => Number.isInteger(r?.status) ? r.status : 1;
const resultText = (r, field) => String(r?.[field] ?? '');
${source.includes('  captureFrozen(') ? ['plainRecord', 'sortRejected'].map(name => { const begin=source.indexOf('function ' + name + '('); return source.slice(begin, source.indexOf('\n}', begin) + 2); }).join('\n') : ''}
${type}export class ProjectProgressionStore {
${source.slice(start, end)}
${source.includes('  captureFrozen(') ? source.slice(source.indexOf('  retrieveSnapshots(keys)'), source.indexOf('  /** How many durable snapshots')) : ''}
}`;
}
function replayFunction(source) {
  const start = source.indexOf('export function runOutboxReplay('), end = source.indexOf('\n}', start);
  if (start < 0 || end < 0) throw new Error('native ordered replay boundary absent');
  return source.slice(start, end + 2).replace('export function', 'function');
}
export async function exerciseSources(sources, root) {
  const nativeRecovery = sources.store.includes('  captureFrozen(');
  fs.mkdirSync(root, { recursive: true });
  if (nativeRecovery && !sources.redactor) throw Error('native collision redaction dependency absent');
  if (sources.redactor) fs.writeFileSync(path.join(root, 'continuity-events.mjs'), sources.redactor);
  for (const [name, source] of Object.entries(sources)) {
    if (!['queue', 'producer', 'redactor'].includes(name)) fs.writeFileSync(path.join(root, `project-progression-${name}.mjs`), source);
  }
  const contract = await import(pathToFileURL(path.join(root, 'project-progression-contract.mjs')).href);
  const { ProjectProgressionStore } = await import(pathToFileURL(path.join(root, 'project-progression-store.mjs')).href);
  const hook = await import(pathToFileURL(path.join(root, 'project-progression-hook.mjs')).href);
  const projectIdentity = { id: 'fixture-project', canonicalAgentDbPath: path.join(root, '.swarm/memory.fixture') };
  const resolution = { projectIdentity, canonicalAgentDbPath: projectIdentity.canonicalAgentDbPath, checkoutRoot: fs.realpathSync(root) };
  const state = Object.fromEntries(['plan', 'completed', 'inProgress', 'blockers', 'failures', 'decisions', 'changedFiles', 'commands', 'proofArtifacts', 'untested', 'resumeConflicts'].map(k => [k, []]));
  for (const field of ['currentGoal', 'acceptanceContract', 'activeProcess', 'activeStep', 'nextAction']) state[field] = null;
  state.provenance = { currentGoal: { source: 'fixture', authoritative: false } };
  const input = { projectIdentity, sourceIdentity: { checkoutPath: resolution.checkoutRoot, capturePath: resolution.checkoutRoot,
    worktreeId: 'fixture', branch: 'main', head: 'head', trackedDigest: 'tracked', untrackedDigest: 'old', dirtyTreeDigest: 'old' },
  hostIdentity: { host: 'codex', adapterVersion: '4.5.4' }, sessionIdentity: 'fixture-session', sequence: 20,
  occurredAt: '2026-10-03T12:00:00.000Z', trigger: 'SessionEnd', parentEventKeys: [], dedupId: 'codex:fixture:SessionEnd:20', completeProjectState: state };
  const old = contract.createProgressionSnapshot(input);
  const desired = contract.createProgressionSnapshot({ ...input, sourceIdentity: { ...input.sourceIdentity, untrackedDigest: 'new', dirtyTreeDigest: 'new' } });
  assert.equal(old.eventKey, desired.eventKey, 'recorded native contract reproduces the historical key collision');
  assert.notEqual(old.payloadDigest, desired.payloadDigest);
  const payload = snap => ({ session_id: snap.sessionIdentity, hook_event_name: snap.trigger, projectProgression: {
    canonicalAgentDbPath: projectIdentity.canonicalAgentDbPath, sourceIdentity: snap.sourceIdentity, sequence: snap.sequence,
    occurredAt: snap.occurredAt, parentEventKeys: snap.parentEventKeys, dedupId: snap.dedupId, completeProjectState: snap.completeProjectState } });
  function fixtureStore({ failRead = false, corrupt = false, failRecovery = false, foreign = false, wrongKey = false } = {}) {
    const rows = new Map([[old.eventKey, JSON.stringify(old)]]), snapshots = [], commits = [], recoveries = [];
    const store = new ProjectProgressionStore();
    Object.assign(store, { resolution, clock: () => '2026-10-04T12:00:00.000Z',
      validateSnapshot: snapshot => assert.equal(contract.validateProgressionSnapshot(snapshot, { expectedProjectIdentity: projectIdentity }).ok, true),
      requireCaptureConsent: () => {},
      run: args => {
        const key = args[args.indexOf('--key') + 1];
        assert.equal(args[args.indexOf('--path') + 1], projectIdentity.canonicalAgentDbPath);
        if (args[1] === 'store') {
          assert(args.includes('--no-upsert'));
          if (rows.has(key) || failRecovery && key !== old.eventKey) return { status: 1, stderr: 'fixture refusal' };
          rows.set(key, args[args.indexOf('--value') + 1]); return { status: 0 };
        }
        return { status: 1, stderr: 'fixture independent read unavailable' };
      },
      readFast: fn => failRead ? { ok: false, reason: 'fixture unavailable' } : { ok: true, value: fn({ readContent: (_, key) => {
        const value = rows.get(key);
        if (foreign) return JSON.stringify(contract.createProgressionSnapshot({ ...input,
          projectIdentity: { id: 'foreign', canonicalAgentDbPath: '/foreign/memory.fixture' } }));
        if (wrongKey) return JSON.stringify(contract.createProgressionSnapshot({ ...input, dedupId: 'another-exact-key' }));
        if (!corrupt || !value) return value;
        return JSON.stringify({ ...JSON.parse(value), payloadDigest: 'invalid' });
      } }) },
      outbox: { markRecovered: (snapshot, receipt) => recoveries.push({ snapshot, receipt }), appendSnapshot: snap => snapshots.push(structuredClone(snap)), markCommitted: receipt => commits.push(structuredClone(receipt)), pendingSnapshots: () => [] },
    });
    return { store, rows, snapshots, commits, recoveries };
  }
  const call = (fixture, snap = desired) => hook.captureProjectTransition({ host: 'codex', payload: payload(snap), projectDir: root,
    adapterVersion: '4.5.4', ...(nativeRecovery ? { recoverFrozen: true, canCommit: () => true } : {}), storeFactory: () => fixture.store });
  const fixture = fixtureStore(), original = fixture.rows.get(old.eventKey);
  const recovered = call(fixture);
  assert.notEqual(recovered.snapshot.eventKey, old.eventKey, 'different immutable content receives a recovery identity');
  assert.equal(fixture.rows.get(old.eventKey), original, 'existing canonical bytes are never overwritten');
  assert.deepEqual(recovered.snapshot.sourceIdentity, desired.sourceIdentity);
  for (const field of ['sequence', 'occurredAt', 'parentEventKeys', 'trigger', 'hostIdentity', 'sessionIdentity']) assert.deepEqual(recovered.snapshot[field], desired[field]);
  const { identityRecovery, ...retained } = recovered.snapshot.completeProjectState;
  assert.deepEqual(retained, desired.completeProjectState, 'every original state/provenance field survives');
  if (nativeRecovery) {
    assert.equal(identityRecovery, undefined);
    assert.deepEqual(recovered.snapshot.recoveryDiagnostics, { kind: 'immutable-event-key-collision', authoritative: false,
      originalEventKey: desired.eventKey, frozenPayloadDigest: desired.payloadDigest, existingPayloadDigest: old.payloadDigest });
  } else assert.deepEqual(identityRecovery, { source: 'verified-immutable-key-collision', authoritative: false,
    originalEventKey: desired.eventKey, originalPayloadDigest: desired.payloadDigest, existingPayloadDigest: old.payloadDigest });
  assert.equal(recovered.receipt.readbackDigest, recovered.snapshot.payloadDigest);
  if (nativeRecovery) {
    assert.equal(fixture.recoveries.length, 1);
    assert.deepEqual(fixture.recoveries[0], { snapshot: desired, receipt: recovered.receipt });
    const fenced = fixtureStore();
    assert.throws(() => fenced.store.captureFrozen(desired), /requires replay fencing/);
    assert.throws(() => fenced.store.captureFrozen(desired, { canCommit: () => false }), /lost replay fencing/);
    assert.equal(fenced.snapshots.length, 0); assert.equal(fenced.recoveries.length, 0);
    for (let boundary = 2; boundary <= 7; boundary++) {
      const interrupted = fixtureStore(); let checks = 0;
      assert.throws(() => interrupted.store.captureFrozen(desired, { canCommit: () => ++checks < boundary }), /lost replay fencing/);
      assert.equal(interrupted.recoveries.length, 0, 'lost fencing cannot acknowledge recovery at any phase');
      assert.equal(interrupted.rows.get(old.eventKey), original, 'lost fencing never replaces the original row');
    }
    const { ProgressionOutbox } = await import(pathToFileURL(path.join(root, 'project-progression-outbox.mjs')).href);
    const outbox = new ProgressionOutbox({ projectRoot: path.join(root, 'native-outbox') });
    outbox.appendSnapshot(desired); outbox.appendSnapshot(recovered.snapshot);
    outbox.markRecovered(desired, recovered.receipt);
    assert.equal(outbox.pendingSnapshots().some(row => row.eventKey === desired.eventKey), true, 'disposition alone never hides an uncommitted recovery');
    outbox.markCommitted(recovered.receipt);
    assert.deepEqual(outbox.pendingSnapshots(), []);
    assert.equal(outbox.records().length, 4, 'original evidence and recovery disposition remain in the journal');
    assert.throws(() => outbox.markRecovered(desired, { ...recovered.receipt, readbackDigest: 'fake' }), /unverified/);
  }
  const restored = contract.restoreProjectProgression([old, recovered.snapshot], { expectedProjectIdentity: projectIdentity });
  assert.equal(restored.ok, true);
  assert.equal(restored.heads.length, 2, 'native restore retains both historical siblings rather than selecting a winner');
  assert(restored.state.resumeConflicts.some(row => row.field === 'sourceIdentity'), 'different frozen source identities remain an explicit conflict');
  assert(fixture.commits.every(receipt => receipt.eventKey !== old.eventKey), 'never mark the original collision committed');
  assert.equal(fixture.snapshots[0].eventKey, old.eventKey, 'native conflicting outbox history remains retained');
  const again = call(fixture);
  assert.equal(again.snapshot.eventKey, recovered.snapshot.eventKey, 'retry identity is deterministic');
  assert.equal(fixture.rows.size, 2);
  for (const opts of [{ failRead: true }, { corrupt: true }, { failRecovery: true }, { foreign: true }, { wrongKey: true }]) {
    const refused = fixtureStore(opts); assert.throws(() => call(refused)); assert.equal(refused.commits.length, 0); assert.equal(refused.recoveries.length, 0);
    assert.equal(refused.rows.get(old.eventKey), original);
  }
  const collisionField = contract.createProgressionSnapshot({ ...input, sourceIdentity: desired.sourceIdentity,
    completeProjectState: { ...state, identityRecovery: { original: 'must retain' } } });
  if (nativeRecovery) assert.deepEqual(call(fixtureStore(), collisionField).snapshot.completeProjectState.identityRecovery, { original: 'must retain' });
  else assert.throws(() => call(fixtureStore(), collisionField), undefined, 'never overwrite an existing diagnostic state field');
  const start = sources.producer.indexOf('  const { value: redactedProgression } = redactProgression({');
  const end = sources.producer.indexOf('  // RETENTION', start);
  if (start < 0 || end < 0) throw new Error('native producer identity boundary absent');
  const produce = new Function('redactProgression', 'digestCanonical', 'resolution', 'source', 'priorSequence', 'now', 'heads', 'host', 'payload', 'trigger', 'completeProjectState', 'enrichStateWithObservation',
    sources.producer.slice(start, end) + '\nreturn projectProgression;');
  const frozen = (source, event = {}) => produce(contract.redactProgression, contract.digestCanonical, resolution, { identity: source }, 19,
    () => input.occurredAt, [], 'codex', { session_id: input.sessionIdentity, ...event }, 'SessionEnd', state, hook.enrichStateWithObservation);
  assert.notEqual(frozen(input.sourceIdentity).dedupId, frozen(desired.sourceIdentity).dedupId, 'future frozen source changes have distinct identities');
  assert.equal(frozen(desired.sourceIdentity).dedupId, frozen(desired.sourceIdentity).dedupId, 'identical immutable capture identity is stable');
  assert.notEqual(frozen(desired.sourceIdentity, { tool_name: 'Bash', tool_input: { command: 'first' } }).dedupId,
    frozen(desired.sourceIdentity, { tool_name: 'Bash', tool_input: { command: 'second' } }).dedupId,
    'same-time native actions have distinct frozen identities without duplicating action enrichment');
  function replay(failRecovery) {
    const f = fixtureStore({ failRecovery }), jobs = ['first', 'later'], consumed = [], returned = [];
    const later = contract.createProgressionSnapshot({ ...input, sequence: 21, dedupId: 'later', occurredAt: '2026-10-03T13:00:00.000Z' });
    const records = { first: { originProjectDir: root, host: 'codex', event: 'SessionEnd', payload: payload(desired) },
      later: { originProjectDir: root, host: 'codex', event: 'SessionEnd', payload: payload(later) } };
    const runCapture = (_, __, options) => ({ ...call(f, options.rawInput.includes('"dedupId":"later"') ? later : desired), progressionCaptured: true });
    const context = { process: { env: {} }, DETACHED_REPLAY_BUDGET_MS: 45000,
      operatorProgressionSuspension: () => null, developmentHooksSuspended: () => false, resolveTurnDb: () => ({}), os: { homedir: () => root }, path,
      takeReplayLock: () => 'owned', adoptReplayLock: () => true, refreshReplayLock: () => true, releaseReplayLock: () => true,
      reclaimOrphans: () => {}, resolveProjectStore: () => resolution, queuedCaptures: () => [...jobs], queuedWork: () => 0,
      claimQueued: file => file, returnClaim: file => returned.push(file), boundedStoreFactory: () => () => f.store,
      runSessionSnapshotHook: runCapture, captureNormalizedTransition: () => { throw new Error('not this fixture'); },
      fs: { readFileSync: file => JSON.stringify(records[file]), rmSync: file => consumed.push(file) } };
    const run = new Function(...Object.keys(context), replayFunction(sources.queue) + '\nreturn runOutboxReplay;')(...Object.values(context));
    run({ projectDir: root, budgetMs: 45000, now: () => 0, makeStoreFactory: () => () => f.store, runCapture });
    assert.deepEqual(consumed, failRecovery ? [] : jobs);
    assert.deepEqual(returned, failRecovery ? ['first'] : []);
  }
  replay(false); replay(true);
  return { immutableExistingPreserved: true, exactRecoveryVerified: true, failedRecoveryRetained: true, laterJobsAdvance: true };
}

export function probeProgressionCollisionReplacement({ files = discover(), installed } = {}) {
  let temporary;
  try {
    if (!files.length || files.length % 3) throw new Error('native progression bundle absent or incomplete');
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-progression-collision-proof-'));
    const state = readState();
    installed ??= [...new Set([...state.patchTargets, ...state.pluginTargets])];
    for (let i = 0; i < files.length; i += 3) {
      const read = file => {
        const regular = value => { const st = fs.lstatSync(value); if (!st.isFile() || st.isSymbolicLink() || !st.size
          || existingPathRelative(path.dirname(path.dirname(file)), value) === null) throw new Error('unsafe native member or backup'); };
        regular(file); const live = fs.readFileSync(file, 'utf8');
        if (!isOurs(live, installed)) { if (live.includes('ruflo-source-patch')) throw new Error('untracked local source'); return live; }
        const backup = file + '.rsp-backup'; regular(backup); const original = fs.readFileSync(backup, 'utf8');
        if (original.includes('ruflo-source-patch') || composeSource(original, installed) !== live) throw new Error('unproved pristine/live composition');
        return original;
      };
      const scripts = path.dirname(files[i]);
      const sources = { store: storeFixture(read(files[i])), hook: read(files[i + 1]), producer: read(files[i + 2]),
        contract: read(path.join(scripts, 'project-progression-contract.mjs')), queue: read(path.join(scripts, 'project-capture-queue.mjs')) };
      if (sources.store.includes('  captureFrozen(')) {
        sources.redactor = read(path.join(scripts, 'continuity-events.mjs'));
        sources.outbox = read(path.join(scripts, 'project-progression-outbox.mjs'));
      }
      const sourceFile = path.join(temporary, `${i}.json`), root = path.join(temporary, String(i));
      fs.writeFileSync(sourceFile, JSON.stringify(sources));
      const result = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import fs from 'node:fs';import { exerciseSources } from ${JSON.stringify(import.meta.url)};
await exerciseSources(JSON.parse(fs.readFileSync(process.argv[1],'utf8')),process.argv[2]);`, sourceFile, root],
      { encoding: 'utf8', timeout: 5000, env: { HOME: temporary, PATH: process.env.PATH || '' } });
      if (result.status !== 0 || result.error) throw new Error(result.error?.message || result.stderr || 'native behavior proof failed');
    }
    return { state: 'superseded', evidence: `${files.length / 3} pristine native bundles preserve collision history and verify recovered queue progress` };
  } catch (error) { return { state: 'live', evidence: `native progression collision proof failed: ${error.message}` }; }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
