import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-scratch-preservation-')));
const home = path.join(temporary, 'home');
process.env.RUFLO_SOURCE_PATCH_HOME = home;
process.env.RSP_RUVNET_BRAIN_HOME = path.join(home, '.cache/ruvnet-brain');
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = path.join(home, '.claude/plugins/marketplaces/ruvnet-brain');
process.env.RSP_RUVNET_BRAIN_RUNTIME = path.join(home, '.claude/ruvnet-brain');
process.env.RSP_CODEX_HOME = path.join(home, '.codex');
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
const originals = [binSource, hooksSource, footprintSource];
const compile = (source, extras = {}) => {
  const context = vm.createContext({ fs, path, os, crypto, process,
    names: dir => fs.readdirSync(dir), lstat: file => fs.lstatSync(file), ...extras });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/export /g, ''), context, { timeout: 1000 });
  return context;
};
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
  for (const spec of VENDOR_SPECS) write(path.join(activeRoot, spec.relative), 'fixture discovery member');
  write(path.join(activeRoot, 'scripts/hook-input.mjs'), 'fixture');
  write(path.join(activeRoot, '.claude-plugin/plugin.json'), '{"name":"ruvnet-brain","version":"4.7.21"}');
  const active = path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'active.json'), selected = '{"version":"4.7.21","codeRoot":"versions/4.7.21"}'; write(active, selected);
  mod.SPECS.forEach((spec, i) => write(path.join(activeRoot, spec.relative), originals[i])); assert.equal(mod.preflight().ok, true);
  const compose = await import('../lib/plugin-compose.mjs'); assert(compose.COMPOSE_TARGETS.includes(mod.NAME));
  for (const expected of [3, 0]) {
    const result = compose.applyComposed([mod.NAME]);
    assert.equal(result.errors, 0, result.log.join('\n')); assert.equal(result.incomplete, 0); assert.equal(result.patched, expected);
  }
  assert.deepEqual(compose.statusComposed([mod.NAME])[mod.NAME], { files: 3, patched: 3 });
  const restored = compose.reconcile([], [mod.NAME]); assert.equal(restored.errors, 0);
  mod.SPECS.forEach((spec, i) => assert.equal(fs.readFileSync(path.join(activeRoot, spec.relative), 'utf8'), originals[i]));
  const member = path.join(activeRoot, mod.SPECS[1].relative); write(member, hooksSource.replace('fs.rmSync', 'foreignCleanup'));
  assert.equal(mod.preflight().ok, false); assert(compose.applyComposed([mod.NAME]).incomplete > 0);
  assert.equal(fs.readFileSync(path.join(activeRoot, mod.SPECS[0].relative), 'utf8'), binSource);
  assert.equal(fs.readFileSync(active, 'utf8'), selected, 'native generation identity unchanged');
  // Optional full-source acceptance: read installed executable bytes, execute only in a disposable home.
  const nativeFlag = process.argv.indexOf('--native-source');
  if (nativeFlag !== -1) {
    assert(process.argv[nativeFlag + 1], '--native-source requires an installed plugin root');
    const sourceRoot = fs.realpathSync(process.argv[nativeFlag + 1]), rendered = path.join(temporary, 'native-modules'); fs.mkdirSync(rendered);
    for (const spec of mod.SPECS) {
      const native = fs.readFileSync(path.join(sourceRoot, spec.relative), 'utf8'), result = mod.patchSource(native);
      assert.deepEqual(result.missing, []); assert.equal(mod.reverseSource(result.next), native);
      const executable = result.next.replace(/(from\s+['"])(\.\/[^'"]+)(['"])/g, (all, before, relative, after) =>
        before + pathToFileURL(path.resolve(relative === './ruflo-bin.mjs' ? rendered : path.join(sourceRoot, 'scripts'), relative)).href + after);
      write(path.join(rendered, path.basename(spec.relative)), executable);
    }
    const realBin = await import(pathToFileURL(path.join(rendered, 'ruflo-bin.mjs')));
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
