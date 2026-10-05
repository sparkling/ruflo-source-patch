// Execute native dispatcher + authorization module, with peripheral receipts/runtime fixtures.
// No managed database, installed generation, registry request or updater is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { PATCH_MARKER as BOUNDARY_MARKER, patchMcp } from '../brain-managed-memory-boundary/transforms.mjs';
import { existingPathRelative } from '../path-containment.mjs';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
const write = (file, source) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source); };
const STUBS = {
  'runtime-preferences': 'export const loadRuntimePreferences=()=>({values:{}}); export const runtimeChildEnv=({env})=>env;',
  'project-identity': 'export const projectDirectory=({env})=>env.RUVNET_BRAIN_PROJECT_DIR;',
  'capability-claim-evidence': 'export const recordManagedCliObservation=()=>{}; export const recordRegistryLatestObservation=x=>({observedVersion:x.version,receiptSha256:"fixture"});',
  'session-snapshot-hook': 'export const runSessionSnapshotHook=()=>{throw Error("unexpected live capture")};',
  'project-store-resolver': 'export const resolveProjectStore=()=>{throw Error("unexpected live store")};',
  'project-progression-suspension': 'export const isAutomaticProgressionSuspension=()=>false;',
  'mcp-readiness': 'export const writeOwn=()=>{};',
  'brain-location': 'export const unmountedNotice=()=>null;',
};
export async function exerciseNativeGeneration({ server, dispatcher, managed }, root) {
  fs.mkdirSync(root, { recursive: true }); root = fs.realpathSync(root);
  const brain = path.join(root, 'brain'), shell = path.join(root, '.claude/ruvnet-brain');
  const stage = (target, version) => {
    if (version) write(path.join(target, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruvnet-brain', version }));
    for (const [name, source] of Object.entries(STUBS)) write(path.join(target, 'scripts', name + '.mjs'), source);
    write(path.join(target, 'mcp/managed-cli-generation.mjs'), dispatcher);
    write(path.join(target, 'mcp/managed-cli-interface.mjs'), managed);
    return target;
  };
  const a = stage(path.join(brain, 'versions/0.0.101'), '0.0.101');
  const b = stage(path.join(brain, 'versions/0.0.102'), '0.0.102'); stage(shell);
  write(path.join(shell, 'mcp/server.mjs'), server);
  const active = path.join(brain, 'active.json');
  const select = (version, generation = 1) => write(active, JSON.stringify({ version, generation, codeRoot: 'versions/' + version }));
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin); fs.symlinkSync(process.execPath, path.join(bin, 'ruvector'));
  const script = path.join(root, 'literal.cjs'); write(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  const env = { HOME: root, PATH: bin + path.delimiter + (process.env.PATH || ''), RUVNET_BRAIN_HOME: brain, RUVNET_BRAIN_PROJECT_DIR: root };
  const { createManagedCliDispatcher } = await import(pathToFileURL(path.join(shell, 'mcp/managed-cli-generation.mjs')).href);
  const dispatched = [];
  const call = createManagedCliDispatcher({ fallbackRoot: shell, importModule: async url => {
    const native = await import(url);
    return { callManagedCli: async (...args) => { dispatched.push({ url, args }); return native.callManagedCli(...args); } };
  } });
  const helpArgs = { executable: 'ruvector', argv: [] };
  const runArgs = { executable: 'ruvector', argv: [script, '$(not-a-shell)', 'space value'], extra: { literal: true } };
  const run = (tool, args = helpArgs, caller = call) => caller(tool, args, env, async () => ({ ok: true, text: async () => '{"version":"1.2.3"}' }));
  const good = r => assert.equal(r.isError, false, JSON.stringify(r));
  const bad = r => assert.equal(r.isError, true, JSON.stringify(r));
  bad(await run('ruvnet_cli_help')); // persistent shell has no manifest and cannot bootstrap authority
  select('0.0.101'); bad(await run('ruvnet_cli_run', runArgs)); good(await run('ruvnet_cli_help'));
  const firstStamp = fs.readFileSync(path.join(brain, 'help-read/ruvector'), 'utf8');
  const firstRun = await run('ruvnet_cli_run', runArgs); good(firstRun);
  assert.deepEqual(JSON.parse(firstRun.structuredContent.stdout), runArgs.argv.slice(1));
  assert.deepEqual(dispatched.at(-1).args[1], runArgs, 'dispatcher preserves literal caller input');
  assert(dispatched.at(-1).url.includes('/0.0.101/'));
  select('0.0.102', 2); bad(await run('ruvnet_cli_run', runArgs)); good(await run('ruvnet_cli_help'));
  assert.notEqual(fs.readFileSync(path.join(brain, 'help-read/ruvector'), 'utf8'), firstStamp);
  good(await run('ruvnet_cli_run', runArgs)); assert(dispatched.at(-1).url.includes('/0.0.102/'));
  good(await run('ruvnet_registry_latest')); assert(dispatched.at(-1).url.includes('/0.0.102/'));
  select('0.0.102', 3); bad(await run('ruvnet_cli_run', runArgs));
  const failed = { executable: 'ruvector', argv: ['fail'] };
  bad(await run('ruvnet_cli_help', failed)); bad(await run('ruvnet_cli_run', failed));
  write(path.join(brain, 'help-read/ruvector'), '');
  bad(await run('ruvnet_cli_run', { ...runArgs, generationBinding: 'forged', codeRoot: a }));
  // Actual old-generation help completes after promotion; its receipt cannot authorize the new owner.
  select('0.0.101', 4);
  let entered, release; const imported = new Promise(resolve => { entered = resolve; });
  const delayed = createManagedCliDispatcher({ fallbackRoot: shell, importModule: async url => {
    entered(); await new Promise(resolve => { release = resolve; }); return import(url);
  } });
  const pending = run('ruvnet_cli_help', helpArgs, delayed); await imported;
  assert.equal(fs.readdirSync(path.join(brain, 'leases')).length, 1);
  select('0.0.102', 5); release(); good(await pending);
  bad(await run('ruvnet_cli_run', runArgs)); assert.deepEqual(fs.readdirSync(path.join(brain, 'leases')), []);
  const count = dispatched.length;
  for (const state of [null, {}, { version: '0.0.101', generation: 1, codeRoot: '../.claude/ruvnet-brain' },
    { version: 'wrong', generation: 1, codeRoot: 'versions/0.0.101' }]) {
    write(active, JSON.stringify(state)); bad(await run('ruvnet_cli_help'));
  }
  select('0.0.101'); const manifest = path.join(a, '.claude-plugin/plugin.json'), original = fs.readFileSync(manifest, 'utf8');
  fs.rmSync(manifest); bad(await run('ruvnet_cli_help'));
  write(manifest, '{"name":"foreign","version":"0.0.101"}');
  bad(await run('ruvnet_cli_help', helpArgs, createManagedCliDispatcher({ fallbackRoot: shell }))); write(manifest, original);
  const handler = path.join(a, 'mcp/managed-cli-interface.mjs'), external = path.join(root, 'outside.mjs');
  write(external, managed); fs.rmSync(handler); fs.symlinkSync(external, handler); bad(await run('ruvnet_cli_help'));
  fs.rmSync(handler); write(handler, managed);
  fs.renameSync(path.join(a, 'mcp'), path.join(root, 'outside-mcp')); fs.symlinkSync(path.join(root, 'outside-mcp'), path.join(a, 'mcp'));
  bad(await run('ruvnet_cli_help')); fs.rmSync(path.join(a, 'mcp')); fs.renameSync(path.join(root, 'outside-mcp'), path.join(a, 'mcp'));
  assert.equal(dispatched.length, count, 'invalid identities never reach the real managed handler');
  fs.appendFileSync(handler, '\n// changed immutable generation\n'); bad(await run('ruvnet_cli_help')); write(handler, managed);
  // Run the unmodified native MCP shell too: declarations alone do not establish its dispatch route.
  select('0.0.101', 10);
  const child = spawn(process.execPath, [path.join(shell, 'mcp/server.mjs')], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const waits = new Map(); let seq = 0, stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => { const reply = JSON.parse(line), waiter = waits.get(reply.id); if (waiter) { clearTimeout(waiter.timer); waits.delete(reply.id); waiter.resolve(reply.result); } });
  const rpc = (name, args) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => reject(Error('native shell deadline: ' + stderr)), 1500);
    waits.set(id, { resolve, timer }); child.stdin.write(JSON.stringify({ id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  });
  try {
    bad(await rpc('ruvnet_cli_run', runArgs)); good(await rpc('ruvnet_cli_help', helpArgs)); good(await rpc('ruvnet_cli_run', runArgs));
    select('0.0.102', 11); bad(await rpc('ruvnet_cli_run', runArgs));
    good(await rpc('ruvnet_cli_help', helpArgs)); good(await rpc('ruvnet_cli_run', runArgs));
  } finally {
    for (const waiter of waits.values()) clearTimeout(waiter.timer);
    child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); lines.close();
  }
  return { realNativeStamps: true, promotionRequiresHelp: true, literalArgs: true, nativeShell: true, immutableGenerationRefused: true };
}

export function probeNativeGeneration(serverFile) {
  let temporary;
  try {
    const root = path.dirname(path.dirname(serverFile));
    const read = name => {
      const file = path.join(root, 'mcp', name + '.mjs'), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(root, file) === null) throw Error('unsafe native generation proof member');
      const current = fs.readFileSync(file, 'utf8');
      if (!current.includes('ruflo-source-patch')) return current;
      // This is the one shared server owner supported here. Reuse its exact transform;
      // never strip a marker or invent a diagnostic substitute to make native proof pass.
      if (name !== 'server' || !current.includes(BOUNDARY_MARKER)) throw Error('unproved native generation source ownership');
      const backup = file + '.rsp-backup', saved = fs.lstatSync(backup);
      if (!saved.isFile() || saved.isSymbolicLink() || !saved.size || existingPathRelative(root, backup) === null) throw Error('unsafe native generation pristine');
      const pristine = fs.readFileSync(backup, 'utf8'), composition = patchMcp(pristine);
      if (pristine.includes('ruflo-source-patch') || composition.missing.length || composition.next !== current) throw Error('unproved native generation pristine composition');
      return pristine;
    };
    const input = { server: read('server'), dispatcher: read('managed-cli-generation'), managed: read('managed-cli-interface') };
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-generation-proof-'));
    const fixture = path.join(temporary, 'source.json'); fs.writeFileSync(fixture, JSON.stringify(input));
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import fs from 'node:fs';import {exerciseNativeGeneration} from ${JSON.stringify(import.meta.url)};await exerciseNativeGeneration(JSON.parse(fs.readFileSync(process.argv[1],'utf8')),process.argv[2]);`,
      fixture, path.join(temporary, 'fixture')], { encoding: 'utf8', timeout: 6000, maxBuffer: 1024 * 1024, env: { HOME: temporary, PATH: process.env.PATH || '' } });
    return { ok: !child.error && child.status === 0, evidence: child.error?.message || child.stderr || 'native generation/stamp/shell behavior verified' };
  } catch (error) { return { ok: false, evidence: error.message }; }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
