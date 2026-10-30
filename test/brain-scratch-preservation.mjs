import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-scratch-preservation-')));
const home = path.join(temporary, 'home');
process.env.RUFLO_SOURCE_PATCH_HOME = home;
process.env.RSP_RUVNET_BRAIN_HOME = path.join(home, '.cache/ruvnet-brain');
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = path.join(home, '.claude/plugins/marketplaces/ruvnet-brain');
process.env.RSP_RUVNET_BRAIN_RUNTIME = path.join(home, '.claude/ruvnet-brain');
process.env.RSP_CODEX_HOME = path.join(home, '.codex');
process.env.RUFLO_NPX_ROOT = path.join(temporary, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(temporary, 'global');
const mod = await import('../lib/brain-scratch-preservation/patcher.mjs');
const write = (file, source = 'sentinel: not a database') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source); };
const files = ['memory.db', 'memory.db-wal', 'memory.db-shm', 'agentdb-memory.db', 'agentdb-memory.db.ruvector.db', 'unknown.txt'];
const populate = dir => files.forEach(name => write(path.join(dir, name), name));
const preserved = dir => files.forEach(name => assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), name));
// Native 4.7.21/22 pre/post-call functions and footprint classification, independent of replacement constants.
// The footprint sweep wrapper isolates the scratch branch; optional full-module acceptance follows.
const binSource = [
  "import fs from 'node:fs';",
  "import os from 'node:os';",
  "import path from 'node:path';",
  "import crypto from 'node:crypto';",
  "export function rufloScratchRoot(env = process.env) {",
  "  if (env.RUVNET_RUFLO_CWD_ROOT) return path.resolve(env.RUVNET_RUFLO_CWD_ROOT);",
  "  return path.join(env.RUVNET_BRAIN_HOME || path.join(os.homedir(), '.cache', 'ruvnet-brain'), 'ruflo-cwd');",
  "}",
  "",
  "/** Create-or-verify one private directory: a real directory (not a link), owned by us, mode 0700. */",
  "export function ensurePrivateDir(dir) {",
  "  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error?.code !== 'EEXIST') throw error; }",
  "  const stat = fs.lstatSync(dir);",
  "  if (stat.isSymbolicLink() || !stat.isDirectory()) {",
  "    throw new Error(`ruflo scratch directory ${dir} is not a real directory (symlink or file); refusing to use it`);",
  "  }",
  "  if (process.platform !== 'win32') {",
  "    if (stat.uid !== process.getuid()) {",
  "      throw new Error(`ruflo scratch directory ${dir} is owned by uid ${stat.uid}, not ${process.getuid()}; refusing to use it`);",
  "    }",
  "    if ((stat.mode & 0o777) !== 0o700) {",
  "      fs.chmodSync(dir, 0o700);",
  "      if ((fs.lstatSync(dir).mode & 0o777) !== 0o700) throw new Error(`ruflo scratch directory ${dir} could not be made private (0700)`);",
  "    }",
  "  }",
  "  return dir;",
  "}",
  "",
  "export function rufloCwdFor(storePath, { root = rufloScratchRoot() } = {}) {",
  "  const projectKey = crypto.createHash('sha256').update(path.resolve(storePath)).digest('hex').slice(0, 32);",
  "  fs.mkdirSync(path.dirname(root), { recursive: true });",
  "  ensurePrivateDir(root);",
  "  return ensurePrivateDir(path.join(root, projectKey));",
  "}",
  "",
  "// node_modules / package.json / package-lock.json: ruflo's startup self-update runs `npm install @claude-flow/cli@X",
  "// --save-exact` in its cwd (ruflo v3 @claude-flow/cli dist/src/update/executor.js). Measured 2026-10-22: a 1.3 GB",
  "// install landed here. Every Brain spawn now sets CLAUDE_FLOW_AUTO_UPDATE=false (update/rate-limiter.js reads it);",
  "// these names are the backstop for a ruflo started without it.",
  "export const RUFLO_CWD_ARTIFACTS = Object.freeze(['.swarm', '.claude', '.claude-flow', 'ruvector.db', 'node_modules', 'package.json', 'package-lock.json']);",
  "const STALE_RUN_MS = 3_600_000;",
  "",
  "/**",
  " * One ruflo invocation's working directory: a fresh private `run-*` directory inside the project's",
  " * scratch dir, removed again by the caller after the call. ruflo copies every snapshot it touches into",
  " * `<cwd>/.swarm/hnsw.metadata.json`; with one cwd per call that copy never accumulates (4.4.0 kept one",
  " * per project that grew without bound and outlived the project). Also clears what 4.4.0 left directly",
  " * in the project scratch dir and any `run-*` older than an hour (a call killed before its cleanup).",
  " */",
  "export function rufloRunDir(storePath, { root = rufloScratchRoot(), now = Date.now() } = {}) {",
  "  const projectScratch = rufloCwdFor(storePath, { root });",
  "  for (const name of fs.readdirSync(projectScratch)) {",
  "    const entry = path.join(projectScratch, name);",
  "    let stat;",
  "    try { stat = fs.lstatSync(entry); } catch { continue; }",
  "    const stale = name.startsWith('run-') && stat.isDirectory() && now - stat.mtimeMs > STALE_RUN_MS;",
  "    if (RUFLO_CWD_ARTIFACTS.includes(name) || stale) fs.rmSync(entry, { recursive: true, force: true });",
  "  }",
  "  return fs.mkdtempSync(path.join(projectScratch, 'run-'));",
  "}",
].join('\n');
const hooksSource = [
  "import { resolveRuflo, rufloInvocationOrPlain, rufloRunDir, rufloScratchRoot } from './ruflo-bin.mjs';",
  "export function rufloSpawnOptions(db, env = process.env) {",
  "  let cwd;",
  "  try { cwd = rufloRunDir(db, { root: rufloScratchRoot(env) }); } catch { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ruvnet-ruflo-')); }",
  "  return { cwd, env: { ...env, RUFLO_DAEMON_AUTOSTART: '0', CLAUDE_FLOW_AUTO_UPDATE: 'false' }, cleanup: () => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* swept later as a stale run- dir */ } } };",
  "}",
].join('\n');
const footprintSource = [
  "import { RUFLO_CWD_ARTIFACTS } from './ruflo-bin.mjs';",
  "const RUFLO_DEBRIS = new Set(RUFLO_CWD_ARTIFACTS);",
  "export function inventoryFootprint({ full, now = Date.now() }) {",
  "  const items = []; const add = item => items.push(item);",
  "  const policy = { staleRufloRunMs: 3_600_000 }; const bytes = () => 0;",
  "      for (const project of names(full)) {",
  "        const pp = path.join(full, project); const ps = lstat(pp);",
  "        if (!ps || ps.isSymbolicLink() || !ps.isDirectory()) continue;",
  "        for (const entry of names(pp)) {",
  "          const ep = path.join(pp, entry); const es = lstat(ep);",
  "          if (!es || es.isSymbolicLink()) continue;",
  "          const debris = RUFLO_DEBRIS.has(entry) || (entry.startsWith('run-') && es.isDirectory() && now - es.mtimeMs > policy.staleRufloRunMs);",
  "          if (debris) add({ id: 'ruflo-scratch', path: ep, class: 'must-not-exist', kind: 'ruflo-scratch', action: 'remove', bytes: bytes(ep), reason: 'ruflo working-directory debris (never read back)' });",
  "        }",
  "      }",
  "",
  "  return { items };",
  "}",
  "export function sweepFootprint({ full, apply = false, beforeRemove } = {}) {",
  "  const { items } = inventoryFootprint({ full });",
  "  const removed = [], kept = []; const record = (item, bytes, reason) => removed.push({ ...item, bytes, reason });",
  "  const reArchive = () => false;",
  "  for (const item of items) {",
  "    if (!['remove', 'remove-if-proven', 'rotate', 'truncate'].includes(item.action) && !reArchive(item)) {",
  "      if (item.class === 'must-not-exist' || item.class === 'unowned') kept.push(item);",
  "      continue;",
  "    }",
  "    if (apply) beforeRemove?.(item);",
  "    if (item.action === 'remove') { if (apply) fs.rmSync(item.path, { recursive: true, force: true }); record(item); }",
  "  }",
  "  return { removed, kept };",
  "}",
].join('\n');
const learningSource = `import { rufloInvocation, rufloRunDir, resolveRuflo } from './ruflo-bin.mjs';
export function runLearningRuflo(binary, args, db, { env = process.env, deadline = Date.now() + 18_000, maxStepMs = 6000, maxBuffer = 65536 } = {}) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('learning deadline exhausted');
  const cwd = rufloRunDir(db, { root: env.RUVNET_RUFLO_CWD_ROOT || path.join(env.HOME || env.USERPROFILE || os.homedir(), '.cache', 'ruvnet-brain', 'learning-ruflo') });
  try {
    const invocation = rufloInvocation(binary, args);
    return spawnSync(invocation.executable, invocation.args, { cwd, env: { ...env, RUFLO_DAEMON_AUTOSTART: '0', CLAUDE_FLOW_AUTO_UPDATE: 'false' },
      encoding: 'utf8', shell: false, timeout: Math.min(maxStepMs, remaining), killSignal: 'SIGKILL', maxBuffer, windowsHide: true });
  } finally { fs.rmSync(cwd, { force: true, recursive: true }); }
}`;
const decisionSource = `import { rufloRunDir } from './ruflo-bin.mjs';
function runRuflo(ruflo, db, args, { spawn = spawnSync } = {}) {
  const cwd = rufloRunDir(db);
  try {
    const { executable, args: argv } = rufloInvocation(ruflo, args);
    const r = spawn(executable, argv, { cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true,
      env: { ...process.env, RUFLO_DAEMON_AUTOSTART: '0', CLAUDE_FLOW_AUTO_UPDATE: 'false', CLAUDE_FLOW_MEMORY_PATH: undefined } });
    return { status: Number.isInteger(r.status) ? r.status : 1, stdout: String(r.stdout || ''), output: \`\${r.stderr || ''}\\n\${r.stdout || ''}\${r.error ? \`\\n\${r.error.message}\` : ''}\` };
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}`;
const probeSource = `import { rufloRunDir } from './ruflo-bin.mjs';
function defaultRun(cmd, args) {
  let cwd = null;
  try { cwd = rufloRunDir(path.join(os.tmpdir(), 'ruvnet-durability-probe')); } catch { /* fall back to tmp below */ }
  try {
    return execFileSync(cmd, args, { cwd: cwd || os.tmpdir(), encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RUFLO_DAEMON_AUTOSTART: '0', CLAUDE_FLOW_AUTO_UPDATE: 'false' } });
  } finally {
    if (cwd) { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* swept later as a stale run- dir */ } }
  }
}`;
const batchSource = `import { rufloCwdFor, rufloScratchRoot } from './ruflo-bin.mjs';
function create(scratchFor, store) {
        const cwd = fs.mkdtempSync(path.join(scratchFor(store.path), 'run-'));
        return { cwd, cleanup: () => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* swept later */ } } };
}`;
const searchSource = `import { rufloInvocation, nativeNodeFor } from './ruflo-bin.mjs';
function create(scratchFor, store) {
    const cwd = fs.mkdtempSync(path.join(scratchFor(store.path), 'run-'));
    const cleanup = () => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* swept later as a stale run- dir */ } };
    return { cwd, cleanup };
}`;
const originals = [binSource, hooksSource, footprintSource, learningSource, decisionSource, probeSource, batchSource, searchSource];
const compile = (source, extras = {}) => {
  const context = vm.createContext({ fs, path, os, crypto, process, Buffer, TextDecoder, setTimeout, clearTimeout,
    fileURLToPath, pathToFileURL, isDirectInvocation: () => false,
    names: dir => fs.readdirSync(dir), lstat: file => fs.lstatSync(file), ...extras });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export \{[^\n]+\};\n/gm, '').replace(/export /g, '')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(temporary, 'fixture.mjs')).href)), context, { timeout: 1000 });
  return context;
};
// Execute the original caller bodies with a fake child; only disposable text sentinels exist.
function checkCaller(source, index, bin, root, keep) {
  for (const mode of ['success', 'failed', 'throw', 'empty']) {
    let cwd;
    const failure = Error('fake child failed');
    const child = (_cmd, _args, options) => {
      cwd = options.cwd; assert.equal(options.env.RUFLO_DAEMON_AUTOSTART, '0'); assert.equal(options.env.CLAUDE_FLOW_AUTO_UPDATE, 'false');
      if (mode !== 'empty') populate(path.join(cwd, '.swarm'));
      if (mode === 'throw') throw failure;
      return index === 5 ? 'fake stdout' : { status: mode === 'failed' ? 7 : 0, stdout: 'fake stdout', stderr: 'fake stderr' };
    };
    const context = compile(source, { spawnSync: child, execFileSync: child,
      rufloInvocation: (executable, args) => ({ executable, args }),
      rufloRunDir: db => bin.rufloRunDir(db, { root }), rufloScratchDisposition: bin.rufloScratchDisposition });
    const db = path.join(temporary, 'fake-project/memory.db'), args = ['memory', 'store', '--path', db];
    const call = () => index === 3 ? context.runLearningRuflo('fake-ruflo', args, db)
      : index === 4 ? context.runRuflo('fake-ruflo', db, args) : context.defaultRun('fake-ruflo', args);
    if (mode === 'throw') assert.throws(call, error => error === failure);
    else { const result = call(); assert.equal(index === 5 ? result : result.stdout, 'fake stdout');
      if (index !== 5) assert.equal(result.status, mode === 'failed' ? 7 : 0); }
    assert(cwd, 'the original caller must reach the fake child');
    if (keep && mode !== 'empty') preserved(path.join(cwd, '.swarm'));
    else assert(!fs.existsSync(cwd), mode === 'empty' ? 'empty runs still clean up' : 'unpatched cleanup demonstrates the data-loss regression');
  }
}
async function checkNativeRecall(source, index, bin, root, keep) {
  for (const mode of ['success', 'failed', 'throw', 'empty']) {
    const db = path.join(root, 'project/memory.db'); write(db, 'fake store: never opened');
    let cwd, cleanup;
    const makeOutput = dir => { cwd = dir; if (mode !== 'empty') populate(path.join(cwd, '.swarm')); };
    const context = compile(source, { rufloScratchDisposition: bin.rufloScratchDisposition,
      isHarnessGenerated: () => false, redactText: text => text,
      resolveTurnDb: () => ({ db, projectRoot: path.dirname(db), contentPathExcludes: [] }),
      learningContext: () => ({ enabled: false }),
      process: { ...process, kill: () => { throw Object.assign(Error('fake child gone'), { code: 'ESRCH' }); } },
      openBatchSession: ({ makeCwd }) => { const made = makeCwd(); cleanup = made.cleanup; makeOutput(made.cwd); return { close: cleanup }; },
      spawn: (_cmd, _args, options) => {
        makeOutput(options.cwd); if (mode === 'throw') throw Error('fake spawn failed');
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.pid = 999999; child.kill = () => {};
        queueMicrotask(() => { child.stdout.emit('data', Buffer.from('{"results":[]}')); child.emit('close', mode === 'failed' ? 7 : 0); });
        return child;
      } });
    const scratch = file => bin.rufloCwdFor(file, { root: path.join(root, 'runs') });
    let result;
    if (index === 6) {
      // Keep the complete native recall caller/finally; substitute only its downstream memory query.
      context.consequentialRecall = async () => { if (mode === 'throw') throw Error('fake query failed'); return { outcome: mode }; };
      result = await context.recall({ prompt: 'recall decision', projectDir: path.dirname(db), ruflo: 'fake', scratch,
        env: {}, consequential: true });
      assert.equal(result.outcome, mode === 'throw' ? 'unavailable' : mode); cleanup();
    } else {
      result = await context.searchOnce({ store: { path: db }, args: [], deadline: Date.now() + 1000, env: {}, scratch,
        invocation: { executable: 'fake', args: [] } });
      assert.equal(result.state, mode === 'throw' ? 'unavailable' : mode === 'failed' ? 'failed' : 'ok');
    }
    assert(cwd, 'native recall must reach its owned child boundary');
    if (keep && mode !== 'empty') preserved(path.join(cwd, '.swarm')); else assert(!fs.existsSync(cwd));
  }
}
try {
  for (const [i, source] of originals.entries()) {
    const result = mod.patchSource(source);
    assert.deepEqual(result.missing, []); assert(mod.isPatched(result.next));
    assert.equal(mod.reverseSource(result.next), source);
    assert.deepEqual(mod.patchSource(result.next), { next: result.next, applied: [], missing: [] });
    for (const invalid of [source + source, source + '\n//' + mod.PATCH_MARKER,
      source.replace(mod.SPECS[i].edits[0][1], 'foreign anchor'), result.next.replace('rufloScratchDisposition', 'unknownDisposition')]) {
      assert(!mod.isPatched(invalid)); assert.equal(mod.patchSource(invalid).next, invalid); assert(mod.patchSource(invalid).missing.length);
    }
  }
  const nativeBin = compile(binSource);
  const db = path.join(temporary, 'project/.swarm/memory.db'), baselineRoot = path.join(temporary, 'baseline');
  const baseline = nativeBin.rufloCwdFor(db, { root: baselineRoot }); populate(path.join(baseline, '.swarm'));
  nativeBin.rufloRunDir(db, { root: baselineRoot });
  assert(!fs.existsSync(path.join(baseline, '.swarm')), 'native cleanup destroys disposable sentinels: the regression is real');
  const bin = compile(mod.patchSource(binSource).next);
  for (let i = 3; i < 6; i++) {
    checkCaller(originals[i], i, bin, path.join(temporary, 'caller-native-' + i), false);
    checkCaller(mod.patchSource(originals[i]).next, i, bin, path.join(temporary, 'caller-patched-' + i), true);
  }
  for (let i = 6; i < originals.length; i++) for (const patched of [false, true]) {
    const source = patched ? mod.patchSource(originals[i]).next : originals[i];
    const context = compile(source, bin), scratch = file => bin.rufloCwdFor(file, { root: path.join(temporary, 'recall-' + i) });
    for (const empty of [false, true]) {
      const call = context.create(scratch, { path: db }); if (!empty) populate(call.cwd);
      call.cleanup(); call.cleanup();
      if (patched && !empty) preserved(call.cwd); else assert(!fs.existsSync(call.cwd));
    }
  }
  const root = path.join(temporary, 'preserved'), project = bin.rufloCwdFor(db, { root });
  for (const name of ['.swarm', '.claude-flow', 'run-old', 'unknown']) populate(path.join(project, name));
  fs.utimesSync(path.join(project, 'run-old'), new Date(0), new Date(0));
  write(path.join(project, 'ruvector.db'), 'standalone sentinel'); fs.mkdirSync(path.join(project, '.claude'));
  assert.equal(path.dirname(bin.rufloRunDir(db, { root })), project, 'retention must not cause working-root fallback');
  assert(!fs.existsSync(path.join(project, '.claude')));
  for (const name of ['.swarm', '.claude-flow', 'run-old', 'unknown']) preserved(path.join(project, name));
  assert.equal(fs.readFileSync(path.join(project, 'ruvector.db'), 'utf8'), 'standalone sentinel');
  const hooks = compile(mod.patchSource(hooksSource).next, bin);
  const spawned = hooks.rufloSpawnOptions(db, { RUVNET_RUFLO_CWD_ROOT: root });
  assert.equal(path.dirname(spawned.cwd), project); populate(spawned.cwd);
  assert.equal(spawned.cleanup().removed, false); preserved(spawned.cwd);
  assert.equal(spawned.cleanup().removed, false, 'repeat cleanup never escalates');
  const empty = hooks.rufloSpawnOptions(db, { RUVNET_RUFLO_CWD_ROOT: root }); assert.equal(empty.cleanup().removed, true);
  const outside = path.join(temporary, 'outside'); populate(outside);
  const link = path.join(project, 'linked'); fs.symlinkSync(outside, link);
  assert.equal(bin.rufloScratchDisposition(link, { apply: true }).removed, false); preserved(outside);
  assert(fs.lstatSync(link).isSymbolicLink());
  const alias = path.join(temporary, 'aliased'); fs.symlinkSync(outside, alias); fs.mkdirSync(path.join(outside, 'empty'));
  assert.equal(bin.rufloScratchDisposition(path.join(alias, 'empty'), { apply: true }).removed, false);
  assert(fs.existsSync(path.join(outside, 'empty')));
  for (const dir of [null, 'relative', path.join(temporary, 'missing')]) assert.equal(bin.rufloScratchDisposition(dir, { apply: true }).removed, false);
  // Change the path AFTER the metadata check. Only an atomic empty rmdir may succeed.
  for (const mode of ['data', 'symlink', 'unreadable']) {
    const target = path.join(project, 'race-' + mode); fs.mkdirSync(target);
    const racedFs = Object.create(fs);
    racedFs.rmdirSync = dir => {
      if (mode === 'data') populate(dir);
      if (mode === 'symlink') { fs.rmdirSync(dir); fs.symlinkSync(outside, dir); }
      if (mode === 'unreadable') throw Object.assign(Error('refused'), { code: 'EACCES' });
      return fs.rmdirSync(dir);
    };
    const raced = compile(mod.patchSource(binSource).next, { fs: racedFs });
    assert.equal(raced.rufloScratchDisposition(target, { apply: true }).removed, false);
    if (mode === 'data') preserved(target);
    if (mode === 'symlink') { assert(fs.lstatSync(target).isSymbolicLink()); preserved(outside); }
    assert(fs.existsSync(target));
  }
  const footprint = compile(mod.patchSource(footprintSource).next, { ...bin, RUFLO_CWD_ARTIFACTS: vm.runInContext('RUFLO_CWD_ARTIFACTS', bin) });
  const inventory = footprint.inventoryFootprint({ full: root });
  for (const name of ['.swarm', '.claude-flow', 'ruvector.db', 'unknown', 'linked', 'run-old']) {
    const item = inventory.items.find(i => i.path === path.join(project, name));
    assert(item); assert.equal(item.action, 'report'); assert.match(item.reason, /^KEPT:/);
  }
  const dryEmpty = path.join(project, 'node_modules'); fs.mkdirSync(dryEmpty);
  assert(footprint.sweepFootprint({ full: root }).removed.some(i => i.path === dryEmpty)); assert(fs.existsSync(dryEmpty));
  const swept = footprint.sweepFootprint({ full: root, apply: true, beforeRemove: item => { if (item.path === dryEmpty) populate(dryEmpty); } });
  assert(swept.kept.some(i => i.path === dryEmpty)); preserved(dryEmpty);
  for (const name of ['.swarm', '.claude-flow', 'run-old', 'unknown']) preserved(path.join(project, name));
  // Existing composition owner handles installation and all-or-nothing preflight.
  const activeRoot = path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'versions/4.7.21');
  const { VENDOR_SPECS } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
  const surface = (root, version = '4.7.21') => {
    for (const spec of VENDOR_SPECS) write(path.join(root, spec.relative), 'fixture discovery member');
    write(path.join(root, 'scripts/hook-input.mjs'), 'fixture');
    write(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruvnet-brain', version }));
    mod.SPECS.forEach((spec, i) => write(path.join(root, spec.relative), originals[i])); return root;
  };
  const installer = (root, version = '4.7.21', pluginVersion = version, name = 'ruvnet-brain') => {
    write(path.join(root, 'package.json'), JSON.stringify({ name, version })); write(path.join(root, 'bin/install.mjs'), 'fixture installer');
    return surface(path.join(root, 'plugin'), pluginVersion);
  };
  const npxRoot = path.join(process.env.RUFLO_NPX_ROOT, 'current/node_modules/ruvnet-brain');
  const roots = [surface(activeRoot),
    surface(path.join(home, '.claude/plugins/cache/ruvnet-brain/ruvnet-brain/4.7.21')),
    surface(path.join(process.env.RSP_CODEX_HOME, 'plugins/cache/ruvnet-brain/ruvnet-brain/4.7.21')),
    installer(process.env.RSP_RUVNET_BRAIN_MARKETPLACE), installer(npxRoot),
    installer(path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'kb/.console-runtime'))];
  const consoleRoot = roots.at(-1);
  for (const relative of [...VENDOR_SPECS.map(spec => spec.relative), 'scripts/hook-input.mjs']) {
    if (!mod.SPECS.some(spec => spec.relative === relative)) fs.rmSync(path.join(consoleRoot, relative), { force: true });
  }
  const rejected = [installer(path.join(process.env.RUFLO_NPX_ROOT, 'old/node_modules/ruvnet-brain'), '4.7.20'),
    installer(path.join(process.env.RUFLO_NPX_ROOT, 'mismatch/node_modules/ruvnet-brain'), '4.7.20', '4.7.21'),
    installer(path.join(process.env.RUFLO_NPX_ROOT, 'foreign/node_modules/ruvnet-brain'), '4.7.21', '4.7.21', 'foreign'),
    installer(path.join(process.env.RUFLO_NPX_ROOT, 'unknown/node_modules/ruvnet-brain'), 'unknown')];
  const active = path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'active.json'), selected = '{"version":"4.7.21","codeRoot":"versions/4.7.21"}'; write(active, selected);
  assert.deepEqual(mod.surfaces().map(s => s.root).sort(), [...roots].sort()); assert.equal(mod.preflight().ok, true);
  const consoleMember = path.join(consoleRoot, mod.SPECS.at(-1).relative);
  fs.unlinkSync(consoleMember);
  assert(mod.surfaces().some(s => s.root === consoleRoot)); assert.equal(mod.preflight().ok, false);
  write(consoleMember, originals.at(-1));
  const compose = await import('../lib/plugin-compose.mjs'); assert(compose.COMPOSE_TARGETS.includes(mod.NAME));
  for (const expected of [mod.SPECS.length * roots.length, 0]) {
    const result = compose.applyComposed([mod.NAME]);
    assert.equal(result.errors, 0, result.log.join('\n')); assert.equal(result.incomplete, 0); assert.equal(result.patched, expected);
  }
  assert.deepEqual(compose.statusComposed([mod.NAME])[mod.NAME], { files: 48, patched: 48 });
  const restored = compose.reconcile([], [mod.NAME]); assert.equal(restored.errors, 0);
  for (const root of [...roots, ...rejected]) mod.SPECS.forEach((spec, i) => assert.equal(fs.readFileSync(path.join(root, spec.relative), 'utf8'), originals[i]));
  // Every drifted member in a physical installer copy prevents all writes across all six surfaces.
  for (const [i, spec] of mod.SPECS.entries()) {
    const member = path.join(npxRoot, 'plugin', spec.relative); write(member, originals[i].replace(spec.edits[0][1], 'foreign anchor'));
    assert.equal(mod.preflight().ok, false); assert(compose.applyComposed([mod.NAME]).incomplete > 0);
    for (const root of roots) assert.equal(fs.readFileSync(path.join(root, mod.SPECS[0].relative), 'utf8'),
      root === path.join(npxRoot, 'plugin') && i === 0 ? originals[0].replace(spec.edits[0][1], 'foreign anchor') : binSource);
    write(member, originals[i]);
  }
  // Older installer copies are maintained only once this target already owns their executable bytes.
  const owned = rejected[0], ownedFile = path.join(owned, mod.SPECS[0].relative);
  write(ownedFile, mod.patchSource(binSource).next);
  assert(mod.surfaces().some(s => s.root === owned)); assert.equal(mod.preflight().ok, true);
  write(ownedFile, binSource); assert(!mod.surfaces().some(s => s.root === owned));
  assert.equal(fs.readFileSync(active, 'utf8'), selected, 'native generation identity unchanged');
  // Optional full-source acceptance: read installed executable bytes, execute only in a disposable home.
  const nativeFlag = process.argv.indexOf('--native-source');
  if (nativeFlag !== -1) {
    assert(process.argv[nativeFlag + 1], '--native-source requires an installed plugin root');
    const sourceRoot = fs.realpathSync(process.argv[nativeFlag + 1]), rendered = path.join(temporary, 'native-modules'); fs.mkdirSync(rendered);
    const nativeSources = [];
    for (const spec of mod.SPECS) {
      const observed = fs.readFileSync(path.join(sourceRoot, spec.relative), 'utf8');
      if (mod.hasPatch(observed)) assert(mod.isPatched(observed), 'unknown installed scratch patch must fail closed');
      const native = mod.reverseSource(observed), result = mod.patchSource(native); nativeSources.push(native);
      assert.deepEqual(result.missing, []); assert.equal(mod.reverseSource(result.next), native);
      const executable = result.next.replace(/(from\s+['"])(\.\/[^'"]+)(['"])/g, (all, before, relative, after) =>
        before + pathToFileURL(path.resolve(relative === './ruflo-bin.mjs' ? rendered : path.join(sourceRoot, 'scripts'), relative)).href + after);
      write(path.join(rendered, path.basename(spec.relative)), executable);
    }
    const realBin = await import(pathToFileURL(path.join(rendered, 'ruflo-bin.mjs')));
    for (let i = 3; i < 6; i++) {
      checkCaller(nativeSources[i], i, realBin, path.join(temporary, 'full-native-' + i), false);
      checkCaller(mod.patchSource(nativeSources[i]).next, i, realBin, path.join(temporary, 'full-patched-' + i), true);
    }
    for (let i = 6; i < nativeSources.length; i++) {
      await checkNativeRecall(nativeSources[i], i, realBin, path.join(temporary, 'full-native-' + i), false);
      await checkNativeRecall(mod.patchSource(nativeSources[i]).next, i, realBin, path.join(temporary, 'full-patched-' + i), true);
    }
    const realHooks = await import(pathToFileURL(path.join(rendered, 'ruflo-memory-hooks.mjs')));
    const realFootprint = await import(pathToFileURL(path.join(rendered, 'brain-footprint.mjs')));
    const nativeHome = path.join(temporary, 'native-home'), brain = path.join(nativeHome, '.cache/ruvnet-brain'), env = { RUVNET_BRAIN_HOME: brain };
    const call = realHooks.rufloSpawnOptions(db, env); populate(call.cwd); assert.equal(call.cleanup().removed, false); preserved(call.cwd);
    const parent = path.dirname(call.cwd); populate(path.join(parent, '.swarm'));
    assert.equal(path.dirname(realBin.rufloRunDir(db, { root: path.dirname(parent) })), parent); preserved(path.join(parent, '.swarm'));
    const options = { home: nativeHome, env, now: Date.now() + 7_200_000 };
    const live = path.join(brain, 'kb'), copy = path.join(brain, 'kb.install-preserved-fixture');
    for (const dir of [live, copy]) { write(path.join(dir, 'SOURCE.json'), '{"stores":[]}'); write(path.join(dir, 'fixture.rvf'), 'public sentinel'); }
    write(path.join(copy, 'unique.txt'), 'preserve me');
    const result = realFootprint.sweepFootprint({ ...options, apply: true, archive: true }); assert.deepEqual(result.errors, []);
    assert(result.kept.some(i => i.path === call.cwd)); preserved(call.cwd); preserved(path.join(parent, '.swarm'));
    assert(!fs.existsSync(copy), 'independent native KB archival still releases a proven disposable copy');
    const stamp = fs.readdirSync(path.join(brain, 'kb.archive'))[0];
    assert.equal(fs.readFileSync(path.join(brain, 'kb.archive', stamp, 'kb.install-preserved-fixture/unique.txt'), 'utf8'), 'preserve me');
    console.log('Full installed-source acceptance passed:', sourceRoot);
  }
  console.log('brain-scratch-preservation: pre/post-call, footprint, sentinels, races, composition and pristine recovery passed');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
