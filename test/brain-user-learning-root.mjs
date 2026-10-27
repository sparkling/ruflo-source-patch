// Brain #377: a fixed, adopted user store must not be reinterpreted as a Git project.
// This fixture is the unchanged learningTarget from installed Brain 4.7.14.
// All stores below are inert files; the test never opens a managed database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { nativeUserLearningSatisfied, probeNativeUserLearningSource, probeUserLearningReplacement } from '../lib/brain-user-learning-root/native.mjs';

const SOURCE = `import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectStore } from './project-store-resolver.mjs';
import { loadRuntimePreferences } from './runtime-preferences.mjs';
export function learningTarget(context, { env = process.env, explicitLegacyApply = false } = {}) {
  if (!context.enabled) throw new Error('learning consent disabled');
  if (context.scope === 'project') return resolveProjectStore({ projectDir: context.projectDir, gitTimeoutMs: 1000 }).canonicalAgentDbPath;
  const root = path.join(context.home, '.claude', 'global-memory');
  const chosen = loadRuntimePreferences({ env, cwd: context.projectDir }).values.learningScope === 'user';
  if (!chosen && !explicitLegacyApply) throw new Error('user learning requires persisted user consent or explicit legacy Apply');
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('user learning root is not a real directory');
  const db = path.join(root, '.swarm', 'memory.db');
  if (!fs.lstatSync(db).isFile()) throw new Error('user store not adopted');
  const resolved = resolveProjectStore({ projectDir: root, requestedStorePath: db, gitTimeoutMs: 1000 });
  if (resolved.projectRoot !== root) throw new Error('foreign global learner root');
  return resolved.canonicalAgentDbPath;
}
`;

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-user-learning-')));
const { patchSource, reverseSource, hasPatch, isPatched } = await import('../lib/brain-user-learning-root/patcher.mjs');
const write = (file, source) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
};
const resolverFile = path.join(sandbox, 'project-store-resolver.mjs');
write(resolverFile, `import path from 'node:path';
export const calls = [];
export function resolveProjectStore(options) {
  calls.push(options);
  // A parent Git checkout owns the home directory, reproducing the original failure.
  return { projectRoot: options.requestedStorePath ? path.dirname(options.projectDir) : options.projectDir,
    canonicalAgentDbPath: path.join(options.projectDir, '.swarm', 'agentdb-memory.db') };
}
`);
write(path.join(sandbox, 'runtime-preferences.mjs'), `
export function loadRuntimePreferences({ env }) {
  return { values: { learningScope: env.FIXTURE_SCOPE || 'user' } };
}
`);
const { calls } = await import(pathToFileURL(resolverFile).href);
const load = async (name, source) => {
  const file = path.join(sandbox, name + '.mjs');
  write(file, source);
  return (await import(pathToFileURL(file).href)).learningTarget;
};
let nextHome = 0;
const fixture = () => {
  const home = path.join(sandbox, 'home-' + nextHome++);
  const root = path.join(home, '.claude', 'global-memory');
  const swarm = path.join(root, '.swarm');
  const db = path.join(swarm, 'memory.db');
  write(db, 'inert fixture, not SQLite');
  return { home, root, swarm, db, context: { enabled: true, scope: 'user', home, projectDir: path.join(home, 'project') } };
};

try {
  const old = await load('original', SOURCE);
  const first = fixture();
  assert.throws(() => old(first.context), /foreign global learner root/,
    'unmodified source must reproduce the parent Git root rejection');
  assert.equal(calls.length, 1);

  const result = patchSource(SOURCE);
  assert.deepEqual(result.missing, []);
  assert.ok(result.applied.length > 0);
  assert.equal(hasPatch(SOURCE), false);
  assert.equal(isPatched(SOURCE), false);
  assert.equal(hasPatch(result.next), true);
  assert.equal(isPatched(result.next), true);
  assert.equal(reverseSource(result.next), SOURCE, 'uninstall preserves every original byte');
  assert.deepEqual(patchSource(result.next), { next: result.next, applied: [], missing: [] });
  const patched = await load('patched', result.next);
  calls.length = 0;
  assert.equal(patched(first.context), first.db, 'user scope retains its fixed adopted store');
  assert.equal(calls.length, 0, 'a user store is not resolved as a Git project');
  assert.equal(fs.readFileSync(first.db, 'utf8'), 'inert fixture, not SQLite');

  assert.throws(() => patched({ ...first.context, enabled: false }), /learning consent disabled/);
  assert.throws(() => patched(first.context, { env: { FIXTURE_SCOPE: 'project' } }), /persisted user consent/);
  assert.equal(patched(first.context, { env: { FIXTURE_SCOPE: 'project' }, explicitLegacyApply: true }), first.db);

  const reject = (description, mutate) => {
    const f = fixture();
    mutate(f);
    assert.throws(() => patched(f.context), undefined, description);
    assert.equal(calls.length, 0, description + ' must fail without project routing');
  };
  reject('absent user root', f => fs.rmSync(f.root, { recursive: true }));
  reject('absent swarm directory', f => fs.rmSync(f.swarm, { recursive: true }));
  reject('absent adopted database', f => fs.unlinkSync(f.db));
  reject('user root replaced by a regular file', f => {
    fs.rmSync(f.root, { recursive: true }); write(f.root, 'not a directory');
  });
  reject('swarm replaced by a regular file', f => {
    fs.rmSync(f.swarm, { recursive: true }); write(f.swarm, 'not a directory');
  });
  reject('database replaced by a directory', f => {
    fs.unlinkSync(f.db); fs.mkdirSync(f.db);
  });
  for (const key of ['root', 'swarm', 'db']) {
    reject('symlinked ' + key, f => {
      const outside = f[key] + '-outside';
      fs.renameSync(f[key], outside);
      fs.symlinkSync(outside, f[key]);
    });
  }
  reject('symlinked ancestor of user root', f => {
    const claude = path.dirname(f.root);
    fs.renameSync(claude, claude + '-outside');
    fs.symlinkSync(claude + '-outside', claude);
  });
  reject('hardlinked database', f => fs.linkSync(f.db, path.join(f.home, 'other.db')));

  const project = { ...first.context, scope: 'project' };
  assert.equal(patched(project), path.join(project.projectDir, '.swarm', 'agentdb-memory.db'));
  assert.deepEqual(calls, [{ projectDir: project.projectDir, gitTimeoutMs: 1000 }],
    'project scope retains the native resolver arguments and result');

  for (const drift of [SOURCE + SOURCE, SOURCE.replace('  const resolved =', '  const  resolved ='),
    result.next.replace('  return db;', '  return "unsafe replacement";')]) {
    const refused = patchSource(drift);
    assert.equal(refused.next, drift, 'anchor drift must never produce a partial patch');
    assert.ok(refused.missing.length > 0);
    assert.deepEqual(refused.applied, []);
  }
  const nativeSource = fs.readFileSync(new URL('./fixtures/brain-user-learning-root/learning-store-native-4.7.21.mjs', import.meta.url), 'utf8');
  assert.equal(nativeUserLearningSatisfied(nativeSource), true);
  assert.equal(hasPatch(nativeSource), false);
  assert.equal(isPatched(nativeSource), true);
  assert.deepEqual(patchSource(nativeSource), { next: nativeSource, applied: [], missing: [] });
  assert.equal(reverseSource(nativeSource), nativeSource, 'native replacement is never locally rewritten');
  const nativeFile = path.join(sandbox, 'native/scripts/learning-store.mjs'); write(nativeFile, nativeSource);
  assert.equal(probeNativeUserLearningSource(nativeSource).state, 'proven');
  assert.equal(probeUserLearningReplacement({ files: [nativeFile] }).state, 'superseded');
  assert.equal(probeUserLearningReplacement({ files: [] }).state, 'unknown');
  for (const drift of [nativeSource + nativeSource,
    nativeSource.replace('dbStat.nlink !== 1', 'false'),
    nativeSource.replace("if (!exact) throw new Error('canonical exact CLI readback failed');", 'if (!exact) return {};')]) {
    assert.notEqual(probeNativeUserLearningSource(drift).state, 'proven', 'changed ownership/capture cannot authorize retirement');
    write(nativeFile, drift);
    assert.notEqual(probeUserLearningReplacement({ files: [nativeFile] }).state, 'superseded');
  }
  write(nativeFile, nativeSource);
  const linkedFile = path.join(sandbox, 'linked-learning-store.mjs'); fs.symlinkSync(nativeFile, linkedFile);
  assert.equal(probeUserLearningReplacement({ files: [linkedFile] }).state, 'unknown');
  write(nativeFile, result.next);
  assert.equal(probeUserLearningReplacement({ files: [nativeFile] }).state, 'live', 'our own overlay cannot establish native retirement');
  write(nativeFile, nativeSource);
  const { brainNativeSupersessions } = await import('../lib/brain-native/supersede.mjs');
  assert.equal(brainNativeSupersessions['brain-user-learning-root'].check, probeUserLearningReplacement);
  assert.equal(brainNativeSupersessions['brain-user-learning-root'].check({ files: [nativeFile] }).state, 'superseded');
  console.log('✓ Brain #377: original parent-Git failure, exact user store, consent, unsafe/missing path refusals, project scope and reversible anchors');
  console.log('✓ Brain 4.7.21: native user-learning ownership and exact capture behavior, drift/linked-file refusal and terminal retirement registration');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
