// Brain #377 native replacement: exact executable boundaries plus inert owner tests.
// The proof never opens a managed database or invokes a real memory writer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { reviewedBoundary } from '../brain-native/reviewed-source.mjs';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';

const TARGET = ['export function learningTarget(', '\nexport function runLearningRuflo(',
  '6b3affba4ba51e6585c07c3815257331cf99a8446347602f8a022d32c21e3c18'];
const CAPTURE = ['export function recordLearningObservation(', "/**\n * The namespace's last distillation",
  'cd00b64ac97b1e72bd0878afb8969e20b3f9414e04099f7f00d44d89d1d47e15'];
export const nativeUserLearningSatisfied = source => !source.includes('ruflo-source-patch (stuinfla/ruvnet-brain#377')
  && reviewedBoundary(source, ...TARGET);
const boundary = (source, [start, end]) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

export function probeNativeUserLearningSource(source) {
  if (!nativeUserLearningSatisfied(source) || !reviewedBoundary(source, ...CAPTURE)) {
    return { state: 'live', evidence: 'native adopted-user ownership or exact capture boundary is unproved' };
  }
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-user-native-')));
  try {
    let nextHome = 0; let mode = 'good'; const resolverCalls = []; const operations = []; const stored = new Map();
    const fixture = () => {
      const home = path.join(sandbox, 'home-' + nextHome++), root = path.join(home, '.claude', 'global-memory');
      const swarm = path.join(root, '.swarm'), db = path.join(swarm, 'memory.db');
      fs.mkdirSync(swarm, { recursive: true });
      // A parent checkout must never route this adopted fixed user store.
      fs.mkdirSync(path.join(home, '.claude', '.git'));
      fs.writeFileSync(db, 'inert fixture, not SQLite');
      return { home, root, swarm, db, context: { enabled: true, scope: 'user', home, projectDir: path.join(home, 'project') } };
    };
    const fixtureKey = source.split('\n').find(line => line.startsWith('export const observationKey = '));
    assert(fixtureKey, 'native capture must retain its deterministic observation key');
    const script = [boundary(source, TARGET), fixtureKey, boundary(source, CAPTURE)]
      .join('\n').replace(/^export /gm, '') + '\n({ learningTarget, recordLearningObservation })';
    const native = vm.runInNewContext(script, {
      fs, path, createHash, process: { env: {} }, LEARNING_NAMESPACE: 'learning-observations',
      loadRuntimePreferences: ({ env }) => ({ values: { learningScope: env.FIXTURE_SCOPE || 'user' } }),
      resolveProjectStore(options) {
        resolverCalls.push(options);
        if (options.requestedStorePath) throw Error('foreign parent Git owner');
        return { canonicalAgentDbPath: path.join(options.projectDir, '.swarm', 'agentdb-memory.db') };
      },
      captureFailureReason: result => result.stderr || 'fixture failure',
      runLearningRuflo(binary, args, db) {
        operations.push({ binary, args, db });
        assert.equal(binary, 'native-ruflo-fixture');
        assert.equal(args[args.indexOf('--path') + 1], db);
        assert.equal(args[args.indexOf('--namespace') + 1], 'learning-observations');
        const key = args[args.indexOf('--key') + 1];
        if (args[1] === 'store') {
          if (mode === 'store-fail' || mode === 'duplicate') return { status: 1, stderr: mode === 'duplicate' ? 'already exists' : 'refused' };
          stored.set(key, args[args.indexOf('--value') + 1]); return { status: 0 };
        }
        assert.equal(args[1], 'retrieve'); assert(args.includes('--value-only'));
        return mode === 'read-fail' ? { status: 1, stderr: 'read refused' }
          : { status: 0, stdout: mode === 'wrong-value' ? 'different bytes' : stored.get(key) || '' };
      },
    }, { timeout: 1000 });
    const first = fixture(); const target = native.learningTarget;
    assert.equal(target(first.context), first.db);
    assert.equal(resolverCalls.length, 0);
    assert.throws(() => target({ ...first.context, enabled: false }), /consent disabled/);
    assert.throws(() => target(first.context, { env: { FIXTURE_SCOPE: 'project' } }), /persisted user consent/);
    assert.equal(target(first.context, { env: { FIXTURE_SCOPE: 'project' }, explicitLegacyApply: true }), first.db);
    const reject = (label, mutate) => {
      const f = fixture(); mutate(f);
      assert.throws(() => target(f.context), undefined, label);
      assert.equal(resolverCalls.length, 0, label + ' must not invoke the project resolver');
    };
    for (const name of ['root', 'swarm', 'db']) {
      reject('missing ' + name, f => fs.rmSync(f[name], { recursive: true }));
      reject('linked ' + name, f => { fs.renameSync(f[name], f[name] + '-outside'); fs.symlinkSync(f[name] + '-outside', f[name]); });
    }
    for (const name of ['root', 'swarm']) reject('regular-file ' + name, f => {
      fs.rmSync(f[name], { recursive: true }); fs.writeFileSync(f[name], 'not a directory');
    });
    reject('directory database', f => { fs.unlinkSync(f.db); fs.mkdirSync(f.db); });
    reject('linked .claude ancestor', f => {
      const claude = path.dirname(f.root); fs.renameSync(claude, claude + '-outside'); fs.symlinkSync(claude + '-outside', claude);
    });
    reject('hardlinked database', f => fs.linkSync(f.db, path.join(f.home, 'other.db')));
    const capture = () => native.recordLearningObservation('native-ruflo-fixture', first.context,
      { tool: 'fixture-read', action: 'validated action', session: 'fixture-session' });
    const captured = capture();
    assert.equal(captured.db, first.db); assert.equal(captured.exactCli, true);
    assert.deepEqual(operations.map(row => row.args[1]), ['store', 'retrieve']);
    assert(operations.every(row => row.db === first.db));
    assert.equal(JSON.parse(stored.get(captured.key)).authoritative, false);
    mode = 'duplicate'; assert.equal(capture().alreadyStored, true);
    for (const failure of ['store-fail', 'read-fail', 'wrong-value']) {
      mode = failure; stored.clear(); assert.throws(capture, /refused|readback failed/, failure);
    }
    assert.equal(resolverCalls.length, 0);
    assert.equal(fs.readFileSync(first.db, 'utf8'), 'inert fixture, not SQLite');
    const project = { ...first.context, scope: 'project' };
    assert.equal(target(project), path.join(project.projectDir, '.swarm', 'agentdb-memory.db'));
    assert.equal(resolverCalls.length, 1); assert.equal(resolverCalls[0].projectDir, project.projectDir);
    assert.equal(resolverCalls[0].gitTimeoutMs, 1000);
    return { state: 'proven', evidence: 'native fixed user ownership, parent-Git independence, consent, unsafe paths, project routing and exact capture/readback refusal cases pass with an inert memory owner' };
  } catch (error) { return { state: 'unknown', evidence: error.message }; }
  finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
}

export function probeUserLearningReplacement({ files } = {}) {
  try {
    const selected = files ?? discoverBrain({ includeOwned: false, allowMissingActive: true })
      .filter(surface => surface.kind === 'full').map(surface => path.join(surface.root, 'scripts/learning-store.mjs'));
    if (!selected.length) return { state: 'unknown', evidence: 'no current native learning store to prove' };
    for (const file of selected) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || existingPathRelative(path.dirname(path.dirname(file)), file) === null)
        return { state: 'unknown', evidence: 'unsafe native learning-store member' };
      const proof = probeNativeUserLearningSource(fs.readFileSync(file, 'utf8'));
      if (proof.state !== 'proven') return proof;
    }
    return { state: 'superseded', evidence: `all ${selected.length} current marker-free native user learners pass fixed ownership, consent, unsafe paths, parent-Git and exact capture/readback behavior with an inert memory owner` };
  } catch (error) { return { state: 'unknown', evidence: error.message }; }
}
