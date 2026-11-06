import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runAutoMemoryHook } from '../lib/ruflo-worktree-memory/runtime.mjs';
import { EDITS, MARKER, patchSource, reverse, isPatched, preflight } from '../lib/ruflo-worktree-memory/patcher.mjs';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-worktree-memory-')));
const originals = Object.fromEntries(Object.entries(EDITS).map(([name, edits]) => [name,
  ['memory-package-resolver.js', 'helper-commands.js'].includes(name)
    ? fs.readFileSync(new URL(`./fixtures/worktree-memory/${name}`, import.meta.url), 'utf8')
    : edits.map(([anchor]) => anchor).join('\n')]));
try {
  for (const original of Object.values(originals)) {
    const result = patchSource(original);
    assert.deepEqual(result.missing, []);
    assert(isPatched(result.next));
    assert.equal(reverse(result.next), original);
    assert.deepEqual(patchSource(result.next), { next: result.next, applied: [], missing: [] });
    for (const drift of [original + original, result.next.replace(MARKER, MARKER + ' changed')]) {
      assert(patchSource(drift).missing.length);
      assert.equal(patchSource(drift).next, drift);
      assert.equal(reverse(drift), drift);
    }
  }

  // Pure control-flow test. No native package imports, real hooks, stores, root
  // discovery, config, child processes or inherited production environment.
  function harness(options = {}) {
    const events = [], entries = new Set(options.helpers ?? ['/fixture/worktree/.claude/helpers/auto-memory-hook.mjs']);
    let resolved = options.resolved ?? null;
    const env = { ...(options.env ?? {}) };
    const contextFs = { existsSync: p => entries.has(p), statSync: () => ({ isFile: () => true }), realpathSync: p => options.realHelper || p };
    const contextProcess = { env, cwd: () => '/fixture/worktree', execPath: '/fixture/node' };
    const record = (root, reason) => {
      events.push(['record', root, reason]);
      if (options.recordError) return null;
      resolved = options.badReadback ? '/fixture/wrong.js' : '/fixture/cli/memory.js';
      return { distPath: '/fixture/cli/memory.js' };
    };
    const importDependency = async specifier => {
      if (specifier === 'node:os') return { homedir: () => '/fixture/home' };
      if (specifier === 'node:url') return { pathToFileURL };
      if (specifier === 'node:child_process') return { spawnSync: (...args) => { events.push(['spawn', ...args]); return options.child ?? { status: 0 }; } };
      events.push(['import', specifier]);
      if (options.badPackage || specifier === 'file:///fixture/stale.js') throw Error('missing module');
      return options.noExport ? {} : { AutoMemoryBridge: class {} };
    };
    const body = runAutoMemoryHook.toString().replaceAll('await import(', 'await importDependency(');
    const run = new Function('path', 'fs', 'process', 'resolveMemoryPackageFromProject', 'recordMemoryPackagePath', 'importDependency',
      `return (${body});`)(path, contextFs, contextProcess,
      root => { events.push(['resolve', root]); return resolved; }, record, importDependency);
    return { run, events, env };
  }
  for (const action of ['prepare', 'import', 'sync']) for (const resolved of [null, '/fixture/stale.js', '/fixture/healthy.js']) {
    const h = harness({ resolved }); const result = await h.run(action, 'project');
    assert.equal(result.success, true);
    assert.equal(result.data.repaired, resolved !== '/fixture/healthy.js');
    assert.equal(result.data.moduleRoot, '/fixture/worktree');
    assert.equal(result.data.dataRoot, '/fixture/worktree');
    const records = h.events.filter(e => e[0] === 'record');
    assert.equal(records.length, resolved === '/fixture/healthy.js' ? 0 : 1);
    const spawns = h.events.filter(e => e[0] === 'spawn');
    assert.equal(spawns.length, action === 'prepare' ? 0 : 1);
    if (spawns.length) {
      assert.deepEqual(spawns[0].slice(1), ['/fixture/node', ['/fixture/worktree/.claude/helpers/auto-memory-hook.mjs', action], { stdio: 'inherit', timeout: 25000 }]);
      assert.equal(h.events.at(-1)[0], 'spawn', 'preparation and usable export precede execution');
    }
    assert.deepEqual(h.env, {}, 'no blanket environment override');
  }
  for (const scope of ['user', 'project']) {
    const h = harness({ helpers: ['/fixture/home/.claude/helpers/auto-memory-hook.mjs'], env: { CLAUDE_PROJECT_DIR: '/fixture/other' } });
    const result = await h.run('prepare', scope);
    assert.equal(result.data.moduleRoot, '/fixture/home');
    assert.equal(result.data.dataRoot, '/fixture/other');
    assert(h.events.some(e => e[0] === 'record' && e[1] === '/fixture/home'));
    assert(!h.events.some(e => e[0] === 'resolve' && e[1] === '/fixture/other'));
  }
  const pinned = harness();
  await assert.rejects(pinned.run('prepare', 'user'), /required helper is missing/);
  assert.equal(pinned.events.length, 0, 'user scope never executes the project helper');
  for (const options of [{ helpers: [] }, { recordError: true }, { badReadback: true }, { badPackage: true }, { noExport: true }]) {
    const h = harness(options);
    await assert.rejects(h.run('import', 'project'));
    assert(!h.events.some(e => e[0] === 'spawn'), 'failure refuses execution');
  }
  for (const args of [['read', 'project'], ['import', 'invalid'], [undefined, 'user']]) {
    const h = harness(); await assert.rejects(h.run(...args), /requires action/); assert.equal(h.events.length, 0);
  }
  for (const child of [{ error: Error('timeout'), status: null }, { signal: 'SIGTERM', status: null }])
    await assert.rejects(harness({ child }).run('import', 'project'), /helper failed/);
  const failed = await harness({ child: { status: 7 } }).run('import', 'project');
  assert.equal(failed.success, false); assert.equal(failed.exitCode, 7);

  // Exercise the actual native generator and classifier with the patch, including
  // every old generated launch shape. Importing this module performs no I/O.
  const commandsFile = path.join(scratch, 'helper-commands.mjs');
  fs.writeFileSync(commandsFile, patchSource(originals['helper-commands.js']).next + '\nexport { generatedForms, directHelperHookCommand };');
  const generator = await import(pathToFileURL(commandsFile).href);
  for (const sub of ['import', 'sync']) for (const scope of ['project', 'user']) for (const windows of [true, false]) {
    const wanted = `ruflo hooks auto-memory-hook --action ${sub} --scope ${scope}`;
    assert.equal(generator.helperHookCommand('.claude/helpers/auto-memory-hook.mjs', sub, scope, windows), wanted);
    assert(generator.isRufloHelperCommand(wanted));
    for (const legacy of generator.generatedForms('.claude/helpers/auto-memory-hook.mjs', sub)) {
      assert.equal(generator.migrateAutoMemoryHookCommand(legacy, scope), wanted);
      assert.equal(generator.pinToUserHelpers(legacy, windows), `ruflo hooks auto-memory-hook --action ${sub} --scope user`);
    }
  }
  for (const custom of ['node .claude/helpers/auto-memory-hook.mjs import && custom', 'echo auto-memory-hook', 'ruflo hooks auto-memory-hook --action import --scope project; bad'])
    assert.equal(generator.migrateAutoMemoryHookCommand(custom, 'project'), null);
  assert.equal(generator.helperHookCommand('.claude/helpers/hook-handler.cjs', 'route', 'project', false),
    generator.directHelperHookCommand('.claude/helpers/hook-handler.cjs', 'route', 'project', false));

  const mergeSource = fs.readFileSync(new URL('./fixtures/worktree-memory/merge-settings-native.js', import.meta.url), 'utf8');
  const migration = EDITS['executor.js'][1];
  const merge = new Function(...Object.keys(generator), 'formatRiskFindingsAsWarnings', 'scanSettingsForRisk', 'detectPlatform',
    mergeSource.replace('export function', 'function').replace(...migration) + '\nreturn mergeSettingsForUpgrade;')(
    ...Object.values(generator), value => value, () => [], () => ({ os: 'linux' }));
  const legacyImport = generator.directHelperHookCommand('.claude/helpers/auto-memory-hook.mjs', 'import', 'project', false);
  const existing = { env: { CUSTOM: 'preserved' }, hooks: { SessionStart: [{ hooks: [
    { type: 'command', command: legacyImport, timeout: 30, continueOnError: true },
    { type: 'command', command: 'custom start', timeout: 7 },
  ] }] } };
  const upgraded = merge(structuredClone(existing), '/fixture/worktree').merged;
  assert.equal(upgraded.hooks.SessionStart[0].hooks.length, 2, 'no duplicate import');
  assert.deepEqual(upgraded.hooks.SessionStart[0].hooks[0], { ...existing.hooks.SessionStart[0].hooks[0],
    command: 'ruflo hooks auto-memory-hook --action import --scope project' });
  assert.deepEqual(upgraded.hooks.SessionStart[0].hooks[1], existing.hooks.SessionStart[0].hooks[1]);
  assert.equal(upgraded.env.CUSTOM, 'preserved');
  assert.deepEqual(merge(structuredClone(upgraded), '/fixture/worktree').merged, upgraded);

  // Native resolver fixture runs only in an isolated external package tree with
  // inert dependency bytes. No real helper or learning initializer is executed.
  const cli = path.join(scratch, 'external/node_modules/@claude-flow/cli');
  const worktree = path.join(scratch, 'worktree');
  const resolverPath = path.join(cli, 'dist/src/init/memory-package-resolver.mjs');
  const memory = path.join(cli, 'node_modules/@claude-flow/memory');
  fs.mkdirSync(path.dirname(resolverPath), { recursive: true });
  fs.mkdirSync(path.join(memory, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(worktree, '.claude/helpers'), { recursive: true });
  fs.writeFileSync(path.join(memory, 'package.json'), JSON.stringify({ name: '@claude-flow/memory', version: '0.0.0-fixture', type: 'module', main: 'dist/index.js' }));
  fs.writeFileSync(path.join(memory, 'dist/index.js'), 'export class AutoMemoryBridge {}');
  fs.writeFileSync(path.join(worktree, '.claude/helpers/auto-memory-hook.mjs'), 'throw Error("fixture helper must never execute")');
  fs.writeFileSync(resolverPath, patchSource(originals['memory-package-resolver.js']).next);
  const env = { PATH: process.env.PATH, HOME: path.join(scratch, 'home'), CLAUDE_PROJECT_DIR: worktree };
  const proof = `const r=await import(${JSON.stringify(pathToFileURL(resolverPath).href)}); console.log(JSON.stringify(await r.runAutoMemoryHook('prepare','project')));`;
  const first = spawnSync(process.execPath, ['--input-type=module', '-e', proof], { cwd: worktree, env, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).data.repaired, true);
  const sidecar = path.join(worktree, '.claude-flow/memory-package.json');
  const bytes = fs.readFileSync(sidecar, 'utf8');
  assert.equal(JSON.parse(bytes).resolvedBy, 'auto-memory-startup');
  const second = spawnSync(process.execPath, ['--input-type=module', '-e', proof], { cwd: worktree, env, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).data.repaired, false);
  assert.equal(fs.readFileSync(sidecar, 'utf8'), bytes, 'healthy binding not rewritten');
  assert.equal(fs.existsSync(path.join(worktree, '.claude-flow/data')), false);
  assert.equal(fs.existsSync(path.join(worktree, '.swarm')), false);
  fs.writeFileSync(sidecar, JSON.stringify({ distPath: '/nonexistent/other-host/memory.js' }));
  const stale = spawnSync(process.execPath, ['--input-type=module', '-e', proof], { cwd: worktree, env, encoding: 'utf8' });
  assert.equal(stale.status, 0, stale.stderr); assert.equal(JSON.parse(stale.stdout).data.repaired, true);

  const sourceFile = path.join(scratch, 'source.js');
  fs.writeFileSync(sourceFile, originals['memory-package-resolver.js']); assert(preflight([sourceFile]).ok);
  fs.writeFileSync(sourceFile, 'unknown upstream'); assert.equal(preflight([sourceFile]).ok, false);

  const globalRoot = path.join(scratch, 'composition/node_modules');
  const packageRoot = path.join(globalRoot, '@claude-flow/cli');
  const files = Object.fromEntries(Object.keys(originals).map(name => [name,
    path.join(packageRoot, 'dist/src', name === 'hooks.js' ? 'commands' : 'init', name)]));
  for (const [name, file] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, originals[name]);
  }
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@claude-flow/cli', version: '3.71.4', type: 'module' }));
  const patchHome = path.join(scratch, 'patch-home');
  fs.mkdirSync(path.join(patchHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(patchHome, '.claude/settings.json'), '{}');
  const patchEnv = { ...process.env, HOME: patchHome, RUFLO_SOURCE_PATCH_HOME: patchHome,
    RUFLO_GLOBAL_ROOT: globalRoot, RUFLO_NPX_ROOT: path.join(scratch, 'npx'),
    RSP_CODEX_HOME: path.join(patchHome, '.codex'), RSP_NO_SELF_UPDATE: '1',
    RSP_NO_LAUNCHCTL: '1', RSP_NO_MONITOR_RECOVER: '1', RSP_NO_STALE_WRITER_KILL: '1', RSP_NO_HOST_AUTO_UPDATE: '1' };
  const cliFile = new URL('../bin/cli.mjs', import.meta.url).pathname;
  for (const action of ['install', 'install', 'status', 'uninstall']) {
    const result = spawnSync(process.execPath, [cliFile, 'ruflo-worktree-memory', action], { cwd: scratch, env: patchEnv, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const [name, file] of Object.entries(files)) {
      const source = fs.readFileSync(file, 'utf8');
      if (action === 'uninstall') assert.equal(source, originals[name]);
      else assert(isPatched(source), `${action}: ${name}`);
    }
  }
  console.log('PASS worktree memory: native external resolver, missing/stale/healthy binding, no import during prepare, exact legacy migration, project/user trust, distinct data root, write/export/helper failures, child errors/status, exact reversal and drift refusal');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
