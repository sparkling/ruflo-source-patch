// Execute the installed transition functions and their real progression contract.
// Persistence and source measurement are fixture boundaries, never live stores.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discover } from './patcher.mjs';
import { composeSource, isOurs } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';
import { existingPathRelative } from '../path-containment.mjs';
import { readCapturePrivacySources, evaluateCapturePrivacy } from '../brain-native/capture-privacy-proof.mjs';

export function exerciseTransitionSource(source, contract, { expectedRestores = 1, privacySources } = {}) {
  const requiresPrivacy = source.includes("from './turn-capture-privacy.mjs'");
  if (requiresPrivacy && !privacySources) throw Error('native transition privacy dependencies absent');
  const privacy = requiresPrivacy ? evaluateCapturePrivacy(privacySources) : null;
  const fixturePolicy = {};
  const publicStart = source.indexOf('export function buildTransitionProgression(');
  const privateStart = source.indexOf('function buildRestoredTransitionProgression(');
  const start = privateStart >= 0 ? Math.min(publicStart, privateStart) : publicStart;
  const end = source.indexOf('export function runProjectTransitionHook(', start);
  if (start < 0 || end < 0) throw new Error('native transition function boundaries absent');
  const functions = source.slice(start, end).replaceAll('export function ', 'function ');
  const nativeContract = contract.replace("import crypto from 'node:crypto';", '').replace(/export (function|const|class) /g, '$1 ');
  const run = new Function('crypto', 'path', 'os', 'privateTransitionObservation', 'resolveTurnDb', 'fixturePolicy', 'requiresPrivacy', `${nativeContract}
${functions}
const automaticProgressionSuspensionResult = () => null;
const resolution = { checkoutRoot: '/fixture/project', canonicalAgentDbPath: '/fixture/project/.swarm/memory.fixture',
  projectIdentity: { id: 'fixture-project', canonicalAgentDbPath: '/fixture/project/.swarm/memory.fixture' } };
const resolveProjectStore = () => resolution;
const readTransitionHistory = () => { throw new Error('unexpected live history access'); };
const runSessionSnapshotHook = () => { throw new Error('unexpected live writer access'); };
const sourceIdentity = { checkoutPath: '/fixture/project', capturePath: '/fixture/project', worktreeId: 'fixture',
  branch: 'main', head: 'abc', trackedDigest: 't', untrackedDigest: 'u', dirtyTreeDigest: 'd' };
const state = Object.fromEntries(STATE_ARRAY_FIELDS.map(k => [k, []]));
for (const k of STATE_VALUE_FIELDS) state[k] = null;
state.currentGoal = 'Retain verified research';
state.observations = [];
const observation = { id: 'new-observation', authoritative: false, kind: 'tool-observation',
  trigger: 'PostToolUse', outcome: 'failure', tool: 'exec_command', occurredAt: '2026-10-01T00:00:00.000Z' };
const job = { originProjectDir: '/fixture/project', host: 'codex', event: 'PostToolUse',
  payload: { session_id: 'session', normalizedTransition: { observation, sourceIdentity } } };
const make = (sequence, parents = [], overrides = {}) => createProgressionSnapshot({
  projectIdentity: resolution.projectIdentity, sourceIdentity, hostIdentity: { host: 'codex', adapterVersion: 'fixture' },
  sessionIdentity: 'session', dedupId: 'old-' + sequence, sequence, occurredAt: '2026-10-01T00:00:00.000Z',
  trigger: 'PostToolUse', parentEventKeys: parents, completeProjectState: state, ...overrides });
const first = make(1), second = make(2, [first.eventKey]);
const nativeRestore = restoreProjectProgression;
let restoreCalls = 0;
restoreProjectProgression = (...args) => { restoreCalls++; return nativeRestore(...args); };
function attempt(snapshots, customJob = job, refused = false) {
  restoreCalls = 0; let writes = 0, historyReads = 0, progression = null;
  try {
    const result = captureNormalizedTransition(customJob, { budgetMs: 60000, readHistory: () => (++historyReads, snapshots),
      capture: (cwd, event, options) => {
        writes++; progression = JSON.parse(options.rawInput).projectProgression;
        return refused ? { progressionCaptured: false, error: 'fixture exact readback refused' }
          : { progressionCaptured: true, receipt: { payloadDigest: 'fixture', readbackDigest: 'fixture' } };
      } });
    return { result, writes, progression, restoreCalls, historyReads };
  } catch (error) { return { error: error.message, writes, restoreCalls, historyReads }; }
}
const normal = attempt([first, second]);
const empty = attempt([]);
const invalid = attempt([{ ...first, payloadDigest: 'tampered' }]);
const foreign = attempt([make(1, [], { projectIdentity: { ...resolution.projectIdentity, id: 'foreign' } })]);
const missingParent = attempt([make(2, ['absent'])]);
const collision = attempt([first, make(1, [], { completeProjectState: { ...state, currentGoal: 'Conflicting goal' } })]);
const cycleA = make(1, [], { sessionIdentity: 'cycle-a' });
const cycleB = make(1, [], { sessionIdentity: 'cycle-b' });
const cycle = attempt([make(1, [cycleB.eventKey], { sessionIdentity: 'cycle-a' }),
  make(1, [cycleA.eventKey], { sessionIdentity: 'cycle-b' })]);
const branch = make(2, [first.eventKey], { dedupId: 'branch', sessionIdentity: 'other',
  completeProjectState: { ...state, nextAction: 'Review alternate evidence' } });
const merged = attempt([first, second, branch]);
const already = make(3, [second.eventKey], { dedupId: 'codex:session:new-observation',
  completeProjectState: { ...state, observations: [observation] } });
const dedup = attempt([first, second, already]);
const refused = attempt([first, second], job, true);
const badBinding = attempt([first], { ...job, payload: { ...job.payload,
  normalizedTransition: { observation, sourceIdentity: { ...sourceIdentity, checkoutPath: '/elsewhere' } } } });
restoreCalls = 0; let publicError;
try { buildTransitionProgression({ resolution, observation, snapshots: [{ ...first, payloadDigest: 'bad' }],
  sessionIdentity: 'session', host: 'codex', sourceIdentity, restored: { ok: true, heads: [], state } }); }
catch (error) { publicError = error.message; }
const publicGuard = { restoreCalls, error: publicError };
let privateChecks = null;
if (requiresPrivacy) {
  fixturePolicy.contentPathExcludes = ['/fixture/private'];
  const privateJob = { ...job, payload: { ...job.payload, normalizedTransition: {
    sourceIdentity, observation: { ...observation, error: '/fixture/private/error.txt' }
  } } };
  const excluded = attempt([first], privateJob);
  fixturePolicy.skipped = 'project consent refused';
  const denied = attempt([first]);
  delete fixturePolicy.skipped;
  fixturePolicy.contentPathExcludes = ['../unsafe'];
  const unsafe = attempt([first]);
  privateChecks = { excluded, denied, unsafe };
}
return { normal, empty, invalid, foreign, missingParent, collision, cycle, merged, dedup, refused, badBinding, publicGuard, privateChecks };
`);
  const result = run(crypto, path, os, privacy?.privateTransitionObservation,
    () => ({ ...fixturePolicy, contentPathExcludes: privacy.contentPathExcludes(fixturePolicy.contentPathExcludes) }), fixturePolicy, requiresPrivacy);
  assert.equal(result.normal.restoreCalls, expectedRestores, 'complete native history must be restored exactly once');
  assert.equal(result.normal.writes, 1);
  assert.equal(result.normal.result.progressionCaptured, true);
  assert.equal(result.normal.progression.completeProjectState.commands.at(-1).outcome, 'failure');
  assert.equal(result.normal.progression.completeProjectState.observations.at(-1).id, 'new-observation');
  assert.equal(result.empty.writes, 1);
  for (const name of ['invalid', 'foreign', 'missingParent', 'collision', 'cycle']) {
    assert.match(result[name].error, /no coherent ancestry/, name);
    assert.equal(result[name].writes, 0, name);
  }
  assert.equal(result.merged.writes, 1);
  assert.equal(result.merged.progression.parentEventKeys.length, 2);
  assert.equal(result.dedup.writes, 0);
  assert.equal(result.dedup.result.progressionCaptured, true);
  assert.equal(result.refused.result.progressionCaptured, false, 'failed exact receipt stays failed');
  assert.match(result.badBinding.error, /invalid normalized transition binding/);
  assert.equal(result.publicGuard.restoreCalls, 1, 'public builder must validate independently');
  assert.match(result.publicGuard.error, /no coherent ancestry/, 'forged caller verdict is ignored');
  if (requiresPrivacy) {
    assert.match(result.privateChecks.excluded.error, /immutable transition retained/);
    assert.match(result.privateChecks.denied.error, /project consent refused/);
    assert.match(result.privateChecks.unsafe.error, /must be rooted/);
    for (const refused of Object.values(result.privateChecks)) {
      assert.equal(refused.historyReads, 0, 'privacy refusal precedes canonical history access');
      assert.equal(refused.writes, 0, 'privacy refusal cannot reach the native writer');
    }
  }
  return result;
}

export function probeTransitionValidationReplacement({ files = discover(), installed = readState().pluginTargets } = {}) {
  let temporary;
  try {
    if (!files.length) return { state: 'unknown', evidence: 'no native transition module installed' };
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-transition-validation-'));
    for (const [index, file] of files.entries()) {
      const regular = candidate => {
        const stat = fs.lstatSync(candidate);
        if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
            || existingPathRelative(path.dirname(path.dirname(file)), candidate) === null) throw new Error('unsafe native member');
      };
      regular(file);
      let source = fs.readFileSync(file, 'utf8');
      if (source.includes('ruflo-source-patch')) {
        if (!isOurs(source, installed)) throw new Error('untracked source ownership');
        const backup = file + '.rsp-backup'; regular(backup);
        const pristine = fs.readFileSync(backup, 'utf8');
        if (pristine.includes('ruflo-source-patch') || composeSource(pristine, installed, { file }) !== source) throw new Error('unproved pristine composition');
        source = pristine;
      }
      const contractFile = path.join(path.dirname(file), 'project-progression-contract.mjs'); regular(contractFile);
      const contract = fs.readFileSync(contractFile, 'utf8');
      if (contract.includes('ruflo-source-patch')) throw new Error('contract is not pristine native source');
      const fixture = path.join(temporary, `${index}.json`);
      const privacySources = source.includes("from './turn-capture-privacy.mjs'")
        ? readCapturePrivacySources(relative => { const dependency = path.join(path.dirname(path.dirname(file)), relative);
          regular(dependency); return fs.readFileSync(dependency, 'utf8'); }) : undefined;
      fs.writeFileSync(fixture, JSON.stringify({ source, contract, privacySources }));
      const child = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import fs from 'node:fs'; import { exerciseTransitionSource } from ${JSON.stringify(import.meta.url)};
        const x=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); exerciseTransitionSource(x.source,x.contract,{privacySources:x.privacySources});`, fixture],
      { encoding: 'utf8', timeout: 6000, maxBuffer: 1024 * 1024, env: { HOME: temporary, PATH: process.env.PATH || '' } });
      if (child.error || child.status !== 0) throw new Error(child.error?.message || child.stderr || 'native probe failed');
    }
    return { state: 'superseded', evidence: `${files.length} pristine native transition modules restore once and preserve validation, ancestry, deduplication, real outcomes and receipt refusal` };
  } catch (error) { return { state: 'live', evidence: `native transition validation proof failed: ${error.message}` }; }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
