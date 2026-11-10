// Published 3.75.0 retirement proofs execute native code with inert dependencies.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeRootSatisfied, proveNativeRoot } from '../lib/cwd/native-root-contract.mjs';
import { nativeInitSatisfied, proveNativeInit } from '../lib/cwd/native-init-contract.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sb = path.resolve(process.argv[2]);
process.env.RUFLO_SOURCE_PATCH_HOME = path.join(sb, 'home');
process.env.RUFLO_NPX_ROOT = path.join(sb, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(sb, 'global');
const staged = process.env.RSP_NATIVE_375_ROOT || path.join(repo, '.local/ruflo-upgrade-20261110/qualification-runtime/node_modules');
const { findVendorRootWith, pristineBytes } = await import('./fixtures.mjs');
const vendor = fs.existsSync(path.join(staged, '@claude-flow/cli/dist/src/services/project-root.js')) ? staged
  : findVendorRootWith('dist/src/services/project-root.js', ['export function anchorToProjectRoot(dir)']);
const { ENTRIES, apply, inspect, composeCliContribution, nativeOnlyPreflight } = await import('../lib/cwd/patch-library.mjs');
const nm = path.join(process.env.RUFLO_NPX_ROOT, 'native', 'node_modules');
const write = (file, source) => { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, source); };
const copy = rel => { const f = path.join(nm, rel); write(f, pristineBytes(path.join(vendor, rel))); return f; };
const ids = ['cwd/memory-root-delegate', 'cwd/cli-core-getProjectCwd', 'state/memory-ewc-consolidation', 'state/ruvector-lora-adapter', 'state/autopilot'];
const rows = ids.map(id => {
  const entry = ENTRIES.find(e => e.id === id), file = copy(entry.suffix.join('/'));
  return { id, entry, file, source: fs.readFileSync(file, 'utf8') };
});
for (const pkg of ['cli', 'cli-core']) write(path.join(nm, '@claude-flow', pkg, 'package.json'), JSON.stringify({name:'@claude-flow/' + pkg,version:'3.75.0',type:'module'}));
const helper = copy('@claude-flow/cli/dist/src/services/project-root.js');
const memoryRoot = copy('@claude-flow/cli/dist/src/memory/memory-root.js');
const initPaths = {executor:'init/executor.js', mcp:'init/mcp-generator.js', types:'init/types.js', dedup:'init/plugin-dedup.js', registry:'mods/plugin-resolve.js'};
const initFiles = Object.fromEntries(Object.entries(initPaths).map(([k, rel]) => [k, copy('@claude-flow/cli/dist/src/' + rel)]));
const sources = Object.fromEntries(Object.entries(initFiles).map(([k, f]) => [k, fs.readFileSync(f, 'utf8')]));
const snapshot = new Map([...rows.map(r => [r.file, r.source]), ...Object.entries(initFiles).map(([k, f]) => [f,sources[k]])]);
try {
  for (const row of rows) {
    assert.equal(nativeRootSatisfied(row.source, row.file, row.id), true, row.id);
    const composed = composeCliContribution(row.source, [row.entry], {file:row.file});
    assert.equal(composed.next, row.source); assert.deepEqual(composed.applied, []); assert.deepEqual(composed.missing, []);
    const name = {'cwd/memory-root-delegate':'memory','cwd/cli-core-getProjectCwd':'core','state/memory-ewc-consolidation':'ewc','state/ruvector-lora-adapter':'lora','state/autopilot':'autopilot'}[row.id];
    assert.ok(proveNativeRoot(name, row.source, {helper:fs.readFileSync(helper,'utf8'),memoryRoot:fs.readFileSync(memoryRoot,'utf8')}) >= 14);
    const changed = name === 'memory' ? row.source.replace('resolveMemoryRoot(getProjectRoot())','resolveMemoryRoot(process.cwd())') : row.source + '\n// unknown bytes';
    assert.equal(nativeRootSatisfied(changed, row.file, row.id), false, row.id + ' source drift');
  }
  const helperBytes = fs.readFileSync(helper, 'utf8');
  write(helper, helperBytes.replace('return dir;', 'return start;'));
  for (const row of rows.filter(r => r.id !== 'cwd/cli-core-getProjectCwd')) {
    assert.equal(nativeRootSatisfied(row.source, row.file, row.id), false, row.id + ' dependency drift');
    assert.ok(composeCliContribution(row.source, [row.entry], {file:row.file}).missing.length);
  }
  write(helper, helperBytes);
  const memoryBytes = fs.readFileSync(memoryRoot,'utf8');
  write(memoryRoot, memoryBytes + '\n// unknown dependency');
  assert.equal(nativeRootSatisfied(rows[0].source, rows[0].file, rows[0].id), false);
  write(memoryRoot,memoryBytes);
  assert.equal(proveNativeInit(sources), 12);
  for (const key of ['executor','mcp']) assert.equal(nativeInitSatisfied(sources[key],initFiles[key]),true);
  assert.equal(nativeInitSatisfied(sources.executor.replace("from './mcp-generator.js'","from './unqualified.js'"),initFiles.executor),false,'import routing drift');
  for (const key of ['dedup','registry','types','mcp']) {
    write(initFiles[key], sources[key] + '\n// unknown dependency');
    assert.equal(nativeInitSatisfied(sources.executor,initFiles.executor), false, 'init dependency: ' + key);
    assert.equal(nativeOnlyPreflight(initFiles.executor,[ENTRIES.find(e => e.id === 'init/no-bundle')]).ok,false);
    write(initFiles[key],sources[key]);
  }
  const mcpEntry = ENTRIES.find(e => e.id === 'init/no-standalone-mcp');
  fs.renameSync(initFiles.dedup,initFiles.dedup + '.absent');
  const refused = composeCliContribution(sources.mcp,[mcpEntry],{file:initFiles.mcp});
  assert.equal(refused.next,sources.mcp); assert.match(refused.missing.join('\n'),/unqualified native/);
  fs.renameSync(initFiles.dedup + '.absent',initFiles.dedup);
  fs.renameSync(initFiles.executor,initFiles.executor + '.absent');
  const unknownMcp = sources.mcp + '\n// drift with missing executor';
  assert.match(composeCliContribution(unknownMcp,[mcpEntry],{file:initFiles.mcp}).missing.join('\n'),/unqualified native/);
  fs.renameSync(initFiles.executor + '.absent',initFiles.executor);
  const result = apply(['cwd','init']);
  assert.equal(result.errors,0,JSON.stringify(result)); assert.equal(result.skipped,0,JSON.stringify(result));
  for (const [f, bytes] of snapshot) { assert.equal(fs.readFileSync(f,'utf8'),bytes); assert.equal(fs.existsSync(f + '.rsp-backup'),false); }
  const status = inspect(); assert.equal(status.cwd.native,5); assert.equal(status.init.native,2);
  // Retire an already-installed old MCP suppression on the new native executor.
  write(initFiles.mcp + '.rsp-backup', sources.mcp);
  write(initFiles.mcp, sources.mcp.replace(mcpEntry.edits[0].find,mcpEntry.edits[0].replace));
  assert.equal(nativeInitSatisfied(sources.executor,initFiles.executor),true,'ordered sibling restoration proof');
  const restored = apply(['cwd','init']);
  assert.equal(restored.errors,0,JSON.stringify(restored)); assert.equal(restored.skipped,0,JSON.stringify(restored));
  assert.equal(fs.readFileSync(initFiles.mcp,'utf8'),sources.mcp);
  assert.equal(fs.existsSync(initFiles.mcp + '.rsp-backup'),false);
  // npm replaced vendor files, but a previous release's backup survived. An
  // uninstall before the next install must not restore those obsolete bytes.
  const retired = [...rows, ...['executor','mcp'].map(key => ({file:initFiles[key], source:sources[key]}))];
  for (const row of retired) write(row.file + '.rsp-backup', '// older vendor source retained as evidence\n');
  const nativeUninstall = apply([]);
  assert.equal(nativeUninstall.errors,0,JSON.stringify(nativeUninstall));
  assert.equal(nativeUninstall.restored,0,JSON.stringify(nativeUninstall));
  for (const row of retired) {
    assert.equal(fs.readFileSync(row.file,'utf8'),row.source,'uninstall preserves qualified native source');
    assert.equal(fs.readFileSync(row.file + '.rsp-backup','utf8'),'// older vendor source retained as evidence\n','unknown backup remains intact');
    fs.rmSync(row.file + '.rsp-backup');
  }
  // An owned composition still restores its pristine vendor source normally.
  write(initFiles.mcp + '.rsp-backup',sources.mcp);
  write(initFiles.mcp,sources.mcp.replace(mcpEntry.edits[0].find,mcpEntry.edits[0].replace));
  const ownedUninstall = apply([]);
  assert.equal(ownedUninstall.errors,0,JSON.stringify(ownedUninstall));
  assert.equal(fs.readFileSync(initFiles.mcp,'utf8'),sources.mcp);
  assert.equal(fs.existsSync(initFiles.mcp + '.rsp-backup'),false);
  // A complete legacy invocation retains the reversible exact compatibility edit.
  write(path.join(nm,'@claude-flow/cli/package.json'),JSON.stringify({name:'@claude-flow/cli',version:'3.71.4',type:'module'}));
  const legacyExecutor = ENTRIES.find(e => e.id === 'init/no-bundle').edits.map(e => e.find).join('\n');
  write(initFiles.executor,legacyExecutor);
  const legacyMcp = mcpEntry.edits[0].find;
  write(initFiles.mcp,legacyMcp);
  const oldResult = apply(['init']);
  assert.equal(oldResult.errors,0,JSON.stringify(oldResult)); assert.equal(oldResult.skipped,0,JSON.stringify(oldResult));
  assert.ok(fs.readFileSync(initFiles.mcp,'utf8').includes(mcpEntry.edits[0].replace));
  apply([]);
  assert.equal(fs.readFileSync(initFiles.mcp,'utf8'),legacyMcp);
  assert.equal(fs.readFileSync(initFiles.executor,'utf8'),legacyExecutor);
  console.log('Native roots/init: five published consumers, dependency drift, native composition, registry/copy/MCP cases and legacy restoration passed.');
} finally { fs.rmSync(sb,{recursive:true,force:true}); }
