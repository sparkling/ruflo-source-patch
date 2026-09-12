import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { GRAPH_OLD, GRAPH_NEW } from '../lib/ruflo-graph-persistence/patcher.mjs';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'graph-persistence-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
const originalCwd = process.cwd();
const root = path.join(scratch, 'npx', 'fixture', 'node_modules', '@claude-flow', 'cli');
const file = path.join(root, 'dist', 'src', 'ruvector', 'graph-backend.js');
const mockFile = path.join(root, 'node_modules', '@ruvector', 'graph-node', 'index.js');
const project = path.join(scratch, 'project');
const pristine = `import { join } from 'node:path';
let graphDb = null, graphBackendLoaded = false, graphBackendAvailable = false, graphNodeModule = null;
const DEFAULT_EMBEDDING_DIM = 8;
${GRAPH_OLD}
export { getGraphDb, loadGraphNode };
export async function getNeighbors(id, hops) {
  const db = await getGraphDb();
  if (!db) return [];
  return db.kHopNeighbors(id, hops);
}`;
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.mkdirSync(path.dirname(mockFile), { recursive: true });
fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
fs.mkdirSync(path.join(project, 'docs', 'nested'), { recursive: true });
fs.writeFileSync(path.join(project, 'CLAUDE.md'), 'test project marker');
fs.writeFileSync(path.join(root, 'package.json'), '{"name":"@claude-flow/cli","version":"fixture","type":"module"}');
fs.writeFileSync(file, pristine);
fs.writeFileSync(path.join(path.dirname(mockFile), 'package.json'), '{"name":"@ruvector/graph-node","version":"2.1.0"}');
fs.writeFileSync(mockFile, `
const state = { mode: 'ok', calls: 0, options: [] };
class GraphDatabase {
  constructor(options) {
    state.calls++; state.options.push(options); this.options = options;
    if (state.mode === 'locked') throw new Error('Database already open by another owner');
    if (state.mode === 'unsupported') this.isPersistent = undefined;
  }
  isPersistent() { return state.mode !== 'volatile' && typeof this.options === 'object'; }
  getStoragePath() { return state.mode === 'wrong-path' ? '/not-requested.db' : this.options?.storagePath; }
  async kHopNeighbors(id) { return [id, 'retained-neighbor']; }
}
module.exports = { GraphDatabase, state };
`);
const { state } = createRequire(path.join(root, 'package.json'))(mockFile);
const mockMeta = createRequire(path.join(root, 'package.json'))(path.join(path.dirname(mockFile), 'package.json'));
const { apply, inspect } = await import('../lib/cwd/patch-library.mjs');
let cases = 0;
let serial = 0;
const load = () => import(pathToFileURL(file).href + '?case=' + (++serial));
const reset = (mode = 'ok') => { state.mode = mode; state.calls = 0; state.options = []; };
function check() { cases++; }

try {
  process.chdir(project);
  const result = apply(['ruflo-graph-persistence']);
  assert.equal(result.patched, 1);
  assert.equal(result.incomplete, 0);
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), pristine);
  assert.equal(apply(['ruflo-graph-persistence']).patched, 0);
  assert.equal(inspect()['ruflo-graph-persistence'].satisfied, 1);
  assert.equal(spawnSync(process.execPath, ['--check', file]).status, 0);
  check();

  reset();
  const concurrent = await load();
  // Exercise a simultaneous availability probe, not just graph callers.
  const [mod, ...handles] = await Promise.all([
    concurrent.loadGraphNode(),
    ...Array.from({ length: 25 }, () => concurrent.getGraphDb()),
  ]);
  assert.ok(mod.GraphDatabase);
  assert.ok(handles.every(handle => handle === handles[0]));
  assert.equal(state.calls, 1);
  assert.deepEqual(state.options[0], {
    storagePath: path.join(project, '.claude-flow', 'graph', 'agents.db'),
    dimensions: 8, distanceMetric: 'Cosine',
  });
  assert.deepEqual(await concurrent.getNeighbors('source', 2), ['source', 'retained-neighbor']);
  check();

  for (const version of ['2.0.4', 'unknown', '2.1.0-alpha.1', null]) {
    reset();
    mockMeta.version = version;
    await assert.rejects((await load()).getGraphDb(), /2.1.0 stable is required/);
    assert.equal(state.calls, 0, 'known-broken/unverified native version opens no handle');
    check();
  }
  mockMeta.version = '2.1.0';

  reset();
  const moving = await load();
  const first = moving.getGraphDb();
  process.chdir(path.join(project, 'docs', 'nested'));
  await first;
  assert.equal(state.options[0].storagePath, path.join(project, '.claude-flow', 'graph', 'agents.db'),
    'capture the first caller path before asynchronous loading');
  process.chdir(project);
  check();

  for (const mode of ['locked', 'volatile', 'wrong-path', 'unsupported']) {
    reset(mode);
    const adapter = await load();
    await assert.rejects(adapter.getGraphDb(), /#3313.*no in-memory fallback/);
    assert.equal(state.calls, 1, 'must not construct an alternate volatile handle');
    assert.ok(state.options.every(options => typeof options === 'object'));
    state.mode = 'ok';
    if (mode === 'locked') {
      assert.equal((await adapter.getGraphDb()).isPersistent(), true, 'retry can succeed after owner releases');
      assert.equal(state.calls, 2);
    } else {
      for (let i = 0; i < 10; i++)
        await assert.rejects(adapter.getGraphDb(), /#3313.*no in-memory fallback/);
      assert.equal(state.calls, 1, 'unverifiable handles are not repeatedly allocated');
    }
    check();
  }

  reset('locked');
  const locked = await load();
  const failures = await Promise.allSettled(Array.from({ length: 20 }, () => locked.getNeighbors('a', 1)));
  assert.ok(failures.every(r => r.status === 'rejected'));
  assert.equal(state.calls, 1, 'concurrent lock failure is one attempt');
  await assert.rejects(locked.getGraphDb(), /#3313.*no in-memory fallback/);
  assert.equal(state.calls, 2, 'a later constructor failure may be retried');
  check();

  const denied = path.join(scratch, 'blocked-directory');
  fs.mkdirSync(denied);
  fs.writeFileSync(path.join(denied, '.claude-flow'), 'owned test fixture: not a directory');
  process.chdir(denied);
  reset();
  const blocked = await load();
  await assert.rejects(blocked.getGraphDb(), /#3313.*no in-memory fallback/);
  assert.equal(state.calls, 0);
  assert.equal(fs.readFileSync(path.join(denied, '.claude-flow'), 'utf8'), 'owned test fixture: not a directory');
  check();

  process.chdir(path.join(project, 'docs', 'nested'));
  reset();
  assert.equal(apply(['cwd', 'ruflo-graph-persistence']).incomplete, 0);
  await (await load()).getGraphDb();
  assert.equal(state.options[0].storagePath, path.join(project, '.claude-flow', 'graph', 'agents.db'));
  apply(['cwd']);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('no in-memory fallback opened'));
  assert.ok(fs.readFileSync(file, 'utf8').includes('__rufloResolveRoot(process.cwd())'));
  apply(['ruflo-graph-persistence']);
  assert.ok(fs.readFileSync(file, 'utf8').includes(GRAPH_NEW));
  apply([]);
  assert.equal(fs.readFileSync(file, 'utf8'), pristine);
  check();

  for (const changed of [
    pristine.replace('new mod.GraphDatabase(join(dataDir,', 'new mod.GraphDatabaseVNext(join(dataDir,'),
    pristine + '\n' + GRAPH_OLD,
  ]) {
    fs.writeFileSync(file, changed);
    const drift = apply(['ruflo-graph-persistence']);
    assert.ok(drift.incomplete > 0);
    assert.equal(fs.readFileSync(file, 'utf8'), changed, 'unknown/ambiguous source untouched');
    check();
  }
  fs.writeFileSync(file, pristine);
  apply(['ruflo-graph-persistence']);
  const absentRoot = path.join(scratch, 'missing-native');
  fs.mkdirSync(absentRoot);
  const absentFile = path.join(absentRoot, 'graph.mjs');
  fs.writeFileSync(absentFile, pristine.replace(GRAPH_OLD, GRAPH_NEW));
  const absent = await import(pathToFileURL(absentFile));
  assert.equal(await absent.getGraphDb(), null);
  assert.deepEqual(await absent.getNeighbors('not-present', 2), []);
  check();
  // The exact original adapter must fail the persistence criterion.
  const mutationFile = path.join(path.dirname(file), 'old-adapter.js');
  fs.writeFileSync(mutationFile, pristine);
  reset();
  const old = await import(pathToFileURL(mutationFile));
  assert.equal((await old.getGraphDb()).isPersistent(), false);
  check();

  const nativeArg = process.argv.indexOf('--native-cli');
  if (nativeArg !== -1) {
    const nativePackage = process.argv[nativeArg + 1];
    assert.ok(path.isAbsolute(nativePackage || ''), '--native-cli needs an absolute CLI package.json');
    const nativeEntry = createRequire(nativePackage).resolve('@ruvector/graph-node');
    const nativeVersion = createRequire(nativePackage)('@ruvector/graph-node/package.json').version;
    const nativeRoot = path.join(scratch, 'native-fixture');
    const nativeFile = path.join(nativeRoot, 'graph.mjs');
    const alias = path.join(nativeRoot, 'node_modules', '@ruvector', 'graph-node', 'index.js');
    fs.mkdirSync(path.dirname(alias), { recursive: true });
    fs.writeFileSync(alias, 'module.exports = require(' + JSON.stringify(nativeEntry) + ');');
    fs.writeFileSync(path.join(path.dirname(alias), 'package.json'), JSON.stringify({
      name: '@ruvector/graph-node', version: nativeVersion,
    }));
    fs.writeFileSync(nativeFile, pristine.replace(GRAPH_OLD, GRAPH_NEW));
    const childProject = path.join(scratch, 'native-project');
    fs.mkdirSync(childProject);
    if (nativeVersion === '2.0.4') {
      const blocked = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import {getGraphDb} from ${JSON.stringify(pathToFileURL(nativeFile).href)};
try { await getGraphDb(); } catch(error) { console.error(error.message); process.exitCode=8; }`], {
        cwd: childProject, encoding: 'utf8', timeout: 15000,
      });
      assert.equal(blocked.status, 8);
      assert.match(blocked.stderr, /2.1.0 stable is required.*2.0.4/);
      assert.equal(fs.existsSync(path.join(childProject, '.claude-flow')), false);
      console.log('Native graph 2.0.4: explicit pre-open refusal verified; persistence is NOT available.');
      check();
    } else {
    for (const mode of ['writer', 'reader']) {
      const code = `import {getGraphDb} from ${JSON.stringify(pathToFileURL(nativeFile).href)};
const db = await getGraphDb();
if (${JSON.stringify(mode)} === 'writer') {
  await db.createNode({id:'test-source',embedding:new Float32Array(8).fill(0.1)});
  await db.createNode({id:'test-target',embedding:new Float32Array(8).fill(0.1)});
  await db.createEdge({from:'test-source',to:'test-target',description:'supports',
    embedding:new Float32Array(8).fill(0.1)});
}
console.log(JSON.stringify({persistent:db.isPersistent(),path:db.getStoragePath(),
  neighbors:await db.kHopNeighbors('test-source',1)}));`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        cwd: childProject, encoding: 'utf8', timeout: 15000,
      });
      assert.equal(child.status, 0, child.stderr || String(child.error));
      const proof = JSON.parse(child.stdout.trim());
      assert.equal(proof.persistent, true);
      assert.equal(proof.path, path.join(childProject, '.claude-flow', 'graph', 'agents.db'));
      assert.deepEqual(proof.neighbors.sort(), ['test-source', 'test-target']);
      check();
    }
    const ownerCode = `import {getGraphDb} from ${JSON.stringify(pathToFileURL(nativeFile).href)};
await getGraphDb(); console.log('OWNED'); setInterval(()=>{},1000);`;
    const owner = spawn(process.execPath, ['--input-type=module', '-e', ownerCode], {
      cwd: childProject, stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('native owner readiness timed out')), 10000);
        owner.once('error', error => { clearTimeout(timer); reject(error); });
        owner.once('exit', code => { clearTimeout(timer); reject(new Error('owner exited: ' + code)); });
        owner.stdout.on('data', data => {
          if (String(data).includes('OWNED')) { clearTimeout(timer); resolve(); }
        });
      });
      const contender = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import {getGraphDb} from ${JSON.stringify(pathToFileURL(nativeFile).href)};
try { await getGraphDb(); console.log('unexpected opened'); }
catch(error) { console.error(error.message); process.exitCode=7; }`], {
        cwd: childProject, encoding: 'utf8', timeout: 15000,
      });
      assert.equal(contender.status, 7, contender.stderr || String(contender.error));
      assert.match(contender.stderr, /#3313.*no in-memory fallback/);
      assert.equal(owner.exitCode, null, 'existing native holder remains running');
      check();
    } finally {
      // Only this test's own child, never an MCP or a discovered PID.
      owner.kill('SIGTERM');
      await new Promise(resolve => {
        if (owner.exitCode !== null || owner.signalCode !== null) resolve();
        else owner.once('exit', resolve);
      });
    }
    console.log('Native graph integration: two processes, exact patched initializer, retained edge verified.');
    }
  }
  console.log('Graph persistence: ' + cases + ' regression groups passed (no managed project stores touched).');
} finally {
  process.chdir(originalCwd);
}
