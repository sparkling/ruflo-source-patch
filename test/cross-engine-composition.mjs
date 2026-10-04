import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLATFORM_GENERATOR } from './fixtures/ruflo-instruction-vendor.mjs';

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-cross-engine-')));
const roots = [path.join(sandbox, 'user'), path.join(sandbox, 'system')];
process.env.RUFLO_SOURCE_PATCH_HOME = path.join(sandbox, 'home');
process.env.RUFLO_GLOBAL_ROOT = roots.join(path.delimiter);
process.env.RUFLO_NPX_ROOT = path.join(sandbox, 'npx');
const plugin = 'ruflo-instruction-contract';
const legacy = PLATFORM_GENERATOR + `
function maybeInstallSkillsSh(ctx) {
        if (ctx.flags['no-skills-sh'] === true)
            return;
        spawnSync(npxCmd, ['--yes', 'skills', 'add', 'ruvnet/ruflo', '--skill', 'ruflo', '--yes']);
}
`;
const claude = "export function generateClaudeMd() {\n    const header = ''; const body = '';\n    return `${header}\\n${body}\\n`;\n}\n// --- Template Composers ---\n";
const files = roots.map(root => path.join(root, '@claude-flow/cli/dist/src/commands/init.js'));
const backup = file => file + '.rsp-backup';
const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const cli = await import('../lib/cwd/patch-library.mjs');
const compose = await import('../lib/plugin-compose.mjs');
const state = await import('../lib/cwd/state.mjs');
const instruction = await import('../lib/ruflo-instruction-contract/patcher.mjs');
const entry = cli.ENTRIES.find(candidate => candidate.id === 'init/no-skills-sh');
const cliOnly = source => cli.composeCliContribution(source, [entry]).next;
const combined = source => instruction.patchSource(cliOnly(source)).next;
const healthy = result => { assert.equal(result.errors, 0, result.log.join('\n')); assert.equal(result.incomplete, 0, result.log.join('\n')); };
const expectFiles = bytes => { for (const file of files) assert.equal(fs.readFileSync(file, 'utf8'), bytes); };
function reset(source = legacy) {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  for (const [index, root] of roots.entries()) {
    const pkg = path.join(root, '@claude-flow/cli');
    write(path.join(pkg, 'package.json'), JSON.stringify({ name: '@claude-flow/cli', version: '3.51.1' }));
    write(path.join(pkg, 'dist/src/init/claudemd-generator.js'), claude);
    write(files[index], source);
  }
  state.writeState({ patchTargets: [], pluginTargets: [] });
}
try {
  for (const mode of ['cli-only', 'shared']) for (const kind of ['missing', 'ambiguous']) {
    const broken = kind === 'missing' ? legacy.replace(entry.edits[0].find, '// native anchor moved')
      : legacy + '\n' + entry.edits[0].find;
    reset(broken); state.addTargets(['init']);
    if (mode === 'shared') state.addPluginTargets([plugin]);
    const refused = cli.apply(['init']);
    assert(refused.incomplete, `${mode} ${kind} must refuse an unsatisfied CLI entry`);
    assert(refused.log.some(line => line.includes(kind === 'missing' ? 'skip:anchor-not-found' : 'skip:ambiguous-anchor')), refused.log.join('\n'));
    assert(!refused.log.some(line => /file is not defined|ReferenceError/.test(line)), 'extracted selection retains file context');
    assert(refused.log.some(line => line.includes(files[0])), 'failure names the actual physical file');
  }
  for (const first of ['cli', 'plugin']) {
    reset();
    if (first === 'cli') { state.addTargets(['init']); healthy(cli.apply(['init'])); }
    else { state.addPluginTargets([plugin]); healthy(compose.applyComposed([plugin])); }
    state.addTargets(['init']); state.addPluginTargets([plugin]);
    healthy(cli.apply(['init'])); healthy(compose.applyComposed([plugin]));
    expectFiles(combined(legacy));
    for (const file of files) assert.equal(fs.readFileSync(backup(file), 'utf8'), legacy, `${first}: one vendor pristine`);
    const snapshots = files.map(file => [fs.statSync(file), fs.statSync(backup(file))]);
    const originals = { openSync: fs.openSync, renameSync: fs.renameSync, rmSync: fs.rmSync };
    let attempted = 0;
    const deny = file => {
      if (!String(file).startsWith(roots[1] + path.sep)) return;
      attempted++; const error = new Error('fixture root-owned system source'); error.code = 'EACCES'; throw error;
    };
    fs.openSync = (file, flags, ...args) => { if (flags !== 'r' && flags !== fs.constants.O_RDONLY) deny(file); return originals.openSync(file, flags, ...args); };
    fs.renameSync = (from, to) => { deny(to); return originals.renameSync(from, to); };
    fs.rmSync = (file, ...args) => { deny(file); return originals.rmSync(file, ...args); };
    try { for (let tick = 0; tick < 3; tick++) { healthy(cli.apply(['init'])); healthy(compose.applyComposed([plugin])); } }
    finally { Object.assign(fs, originals); }
    assert.equal(attempted, 0, 'steady state never attempts a write in the protected system directory');
    files.forEach((file, index) => {
      assert.equal(fs.statSync(file).ino, snapshots[index][0].ino);
      assert.equal(fs.statSync(backup(file)).ino, snapshots[index][1].ino);
      assert.equal(fs.statSync(backup(file)).mtimeMs, snapshots[index][1].mtimeMs);
    });
    state.removeTargets(['init']); healthy(cli.apply([]));
    expectFiles(instruction.patchSource(legacy).next);
    state.addTargets(['init']); healthy(cli.apply(['init']));
    healthy(compose.reconcile([], [plugin])); state.removePluginTargets([plugin]);
    expectFiles(cliOnly(legacy));
    state.removeTargets(['init']); healthy(cli.apply([])); expectFiles(legacy);
    for (const file of files) assert(!fs.existsSync(backup(file)), 'last claimant restores and removes shared backup');
  }
  reset(); state.addTargets(['init']); state.addPluginTargets([plugin]);
  const { patchPreviousPlatformGenerator } = await import('../lib/ruflo-instruction-contract/skill-contract.mjs');
  for (const file of files) { write(file, patchPreviousPlatformGenerator(cliOnly(legacy)).next); write(backup(file), legacy); }
  healthy(cli.apply(['init'])); expectFiles(combined(legacy));

  reset(PLATFORM_GENERATOR);
  state.addPluginTargets([plugin]); healthy(compose.applyComposed([plugin]));
  state.writeState({ patchTargets: [], pluginTargets: [plugin], retired: { init: { reason: 'fixture native bounded init replacement' } } });
  healthy(cli.apply([])); expectFiles(instruction.patchSource(PLATFORM_GENERATOR).next);
  for (const file of files) assert.equal(fs.readFileSync(backup(file), 'utf8'), PLATFORM_GENERATOR);

  reset(); state.addTargets(['init']); state.addPluginTargets([plugin]); healthy(compose.applyComposed([plugin]));
  const updated = legacy + '// genuine upstream replacement\n';
  for (const file of files) write(file, updated);
  healthy(cli.apply(['init'])); expectFiles(combined(updated));
  for (const file of files) assert.equal(fs.readFileSync(backup(file), 'utf8'), updated);

  const external = combined(updated) + '// external change retained local markers\n';
  for (const file of files) write(file, external);
  const drift = cli.apply(['init']);
  assert(drift.incomplete, 'marker-preserving external edits need exact composition proof');
  expectFiles(external);
  for (const file of files) assert.equal(fs.readFileSync(backup(file), 'utf8'), updated, 'unproved marked edits cannot poison the vendor backup');

  reset(PLATFORM_GENERATOR); state.addPluginTargets([plugin]); healthy(compose.applyComposed([plugin]));
  for (const file of files) write(backup(file), fs.readFileSync(file, 'utf8'));
  healthy(cli.apply([]));
  for (const file of files) assert.equal(fs.readFileSync(backup(file), 'utf8'), PLATFORM_GENERATOR, 'existing exact native revision recovery repairs a plugin-only poisoned backup');

  reset(); state.addTargets(['init']); state.addPluginTargets([plugin]); healthy(compose.applyComposed([plugin]));
  for (const file of files) write(backup(file), fs.readFileSync(file, 'utf8'));
  const refused = cli.apply(['init']);
  assert(refused.errors || refused.incomplete, 'ambiguous multi-engine poisoned pristine fails closed');
  expectFiles(combined(legacy));
  for (const file of files) assert.equal(fs.readFileSync(backup(file), 'utf8'), combined(legacy), 'unproved pristine is preserved, never guessed');
  // Two exact CLI transforms can overlap: the later edit removes the earlier
  // replacement needle, so historical per-entry detection alone is incomplete.
  reset();
  const overlap = { id: 'fixture/overlapping-cli-edit', target: 'init', suffix: entry.suffix,
    edits: [{ find: "if (ctx.flags['no-skills-sh'] === true)", replace: "if (ctx.flags['fixture-skip'] === true)" }] };
  cli.ENTRIES.push(overlap);
  try {
    state.addTargets(['init']);
    const cliBytes = cli.composeCliContribution(legacy, [entry, overlap]).next;
    for (const file of files) { write(file, cliBytes); write(backup(file), legacy); }
    expectFiles(cliBytes);
    assert.notEqual(cli.historicalCliContribution(legacy, cliBytes, [entry, overlap]).next, cliBytes,
      'fixture must reproduce incomplete historical detection');
    state.addPluginTargets([plugin]); healthy(compose.applyComposed([plugin]));
    expectFiles(instruction.patchSource(cliBytes).next);
    for (const file of files) assert.equal(fs.readFileSync(backup(file), 'utf8'), legacy);
    for (const file of files) write(file, instruction.patchSource(cliBytes).next + '// unproved foreign edit');
    assert(compose.applyComposed([plugin]).incomplete, 'complete byte proof still rejects foreign changes');
  } finally { cli.ENTRIES.pop(); }
  console.log('✓ shared CLI/plugin pristine: both install orders, protected steady state, selective uninstall, native retirement, real upstream replacement and poisoned-backup proof/refusal');
} finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
