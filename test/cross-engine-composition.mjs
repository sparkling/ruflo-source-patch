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
process.env.RSP_RUVNET_BRAIN_HOME = path.join(process.env.RUFLO_SOURCE_PATCH_HOME, '.cache/ruvnet-brain');
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = path.join(process.env.RUFLO_SOURCE_PATCH_HOME, '.claude/plugins/marketplaces/ruvnet-brain');
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
  const lifecycle = await import('../lib/brain-console-lifecycle/patcher.mjs');
  const lockstep = await import('../lib/brain-release-lockstep/patcher.mjs');
  const hostRecovery = await import('../lib/brain-host-recovery/patcher.mjs');
  const consoleTargets = [lifecycle, lockstep, hostRecovery].map(module => module.descriptor.name);
  const consolePristine = lifecycle.fixtureSource().installer + '\n\n' + lockstep.fixtureSource() + '\n\n'
    + fs.readFileSync(new URL('./fixtures/brain-host-recovery/installer.mjs', import.meta.url), 'utf8');
  const consoleBytes = [lifecycle, lockstep, hostRecovery].reduce((source, module) => {
    const result = module.patchSource(source); assert.deepEqual(result.missing, []); return result.next;
  }, consolePristine);
  const copiedRoot = path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'kb/.console-runtime');
  const peerRoots = [process.env.RSP_RUVNET_BRAIN_MARKETPLACE, path.join(process.env.RUFLO_NPX_ROOT, 'brain/node_modules/ruvnet-brain')];
  const copied = path.join(copiedRoot, 'bin/install.mjs');
  const peerFile = root => path.join(root, 'bin/install.mjs');
  function consoleFixture(peers = peerRoots) {
    for (const root of [copiedRoot, ...peerRoots]) fs.rmSync(root, { recursive: true, force: true });
    state.writeState({ patchTargets: [], pluginTargets: consoleTargets });
    for (const root of [copiedRoot, ...peers]) {
      write(path.join(root, 'package.json'), JSON.stringify({ name: 'ruvnet-brain', version: '4.5.7' }));
      write(peerFile(root), consoleBytes);
      if (root !== copiedRoot) write(backup(peerFile(root)), consolePristine);
    }
  }
  const applyCopy = () => compose.applyComposed(consoleTargets, { files: [copied] });
  // Native Console promotion copies bin/install.mjs without its adjacent backup.
  // Multiple actual patch owners require a matching healthy peer, never a guess.
  consoleFixture();
  const peerSnapshots = peerRoots.map(root => [fs.statSync(peerFile(root)).ino, fs.statSync(backup(peerFile(root))).ino]);
  healthy(applyCopy());
  assert.equal(fs.readFileSync(copied, 'utf8'), consoleBytes);
  assert.equal(fs.readFileSync(backup(copied), 'utf8'), consolePristine);
  peerRoots.forEach((root, index) => {
    assert.equal(fs.statSync(peerFile(root)).ino, peerSnapshots[index][0], 'peer executable remains read-only');
    assert.equal(fs.statSync(backup(peerFile(root))).ino, peerSnapshots[index][1], 'peer pristine remains read-only');
  });
  write(copied, consoleBytes + '// foreign change after recovery\n');
  assert(applyCopy().incomplete, 'recovered ownership still requires exact provenance on later ticks');
  assert.equal(fs.readFileSync(copied, 'utf8'), consoleBytes + '// foreign change after recovery\n');
  assert.equal(fs.readFileSync(backup(copied), 'utf8'), consolePristine);
  for (const invalidBackup of ['', consoleBytes]) {
    consoleFixture(); write(backup(copied), invalidBackup);
    healthy(applyCopy());
    assert.equal(fs.readFileSync(backup(copied), 'utf8'), consolePristine, 'a poisoned copy backup uses the same proved peer path');
    assert.equal(fs.readFileSync(copied, 'utf8'), consoleBytes);
  }
  consoleFixture();
  healthy(compose.applyComposed([consoleTargets[0]], { files: [copied] }));
  assert.equal(fs.readFileSync(backup(copied), 'utf8'), consolePristine,
    'a selected subset must account for every actual historical Console owner');
  assert.equal(fs.readFileSync(copied, 'utf8'), lifecycle.patchSource(consolePristine).next);
  for (const order of [consoleTargets, [...consoleTargets].reverse()]) {
    consoleFixture(); healthy(applyCopy());
    let remaining = [...consoleTargets];
    for (const removed of order) {
      remaining = remaining.filter(name => name !== removed);
      healthy(compose.reconcile(remaining, [removed])); state.removePluginTargets([removed]);
      assert.equal(fs.readFileSync(copied, 'utf8'), compose.composeSource(consolePristine, remaining, { file: copied }));
    }
    assert.equal(fs.readFileSync(copied, 'utf8'), consolePristine);
    assert(!fs.existsSync(backup(copied)), 'last owner removes only its proved backup');
  }
  const refusalCases = {
    'no peer': () => { for (const root of peerRoots) fs.rmSync(root, { recursive: true, force: true }); },
    'wrong package name': () => { for (const root of peerRoots) write(path.join(root, 'package.json'), JSON.stringify({ name: 'not-brain', version: '4.5.7' })); },
    'wrong version': () => { for (const root of peerRoots) write(path.join(root, 'package.json'), JSON.stringify({ name: 'ruvnet-brain', version: '4.5.6' })); },
    'empty backup': () => { for (const root of peerRoots) write(backup(peerFile(root)), ''); },
    'marked backup': () => { for (const root of peerRoots) write(backup(peerFile(root)), consoleBytes); },
    'unproved backup': () => { for (const root of peerRoots) write(backup(peerFile(root)), consolePristine + '// foreign baseline\n'); },
    'foreign current edit': () => write(copied, consoleBytes + '// foreign live edit\n'),
    'different peer bytes': () => { for (const root of peerRoots) write(peerFile(root), consoleBytes + '// foreign peer edit\n'); },
    'symlink backup': () => { const external = path.join(sandbox, 'unowned-pristine'); write(external, consolePristine);
      for (const root of peerRoots) { fs.rmSync(backup(peerFile(root))); fs.symlinkSync(external, backup(peerFile(root))); } },
    'escaped executable': () => { const external = path.join(sandbox, 'unowned-bin'); fs.mkdirSync(external, { recursive: true });
      write(path.join(external, 'install.mjs'), consoleBytes); write(path.join(external, 'install.mjs.rsp-backup'), consolePristine);
      for (const root of peerRoots) { fs.rmSync(path.join(root, 'bin'), { recursive: true }); fs.symlinkSync(external, path.join(root, 'bin')); } },
  };
  for (const [label, corrupt] of Object.entries(refusalCases)) {
    consoleFixture(); corrupt();
    const before = fs.readFileSync(copied, 'utf8');
    const refusal = applyCopy();
    assert(refusal.incomplete || refusal.errors, `${label}: unavailable peer proof must be a failed gate`);
    assert.equal(fs.readFileSync(copied, 'utf8'), before, `${label}: preserve live bytes`);
    assert(!fs.existsSync(backup(copied)), `${label}: never seed an unproved backup`);
  }
  consoleFixture([]); write(backup(copied), consoleBytes);
  assert(applyCopy().incomplete, 'unproved poisoned backups also fail loudly');
  assert.equal(fs.readFileSync(backup(copied), 'utf8'), consoleBytes, 'retain unproved poisoned bytes');
  fs.rmSync(backup(copied));
  assert(compose.applyComposed([consoleTargets[0]], { files: [copied] }).incomplete,
    'selected subset cannot reverse one owner and preserve siblings inside an unproved backup');
  assert(!fs.existsSync(backup(copied)));
  // Model a genuinely non-injective known contribution. Even individually
  // valid peer roundtrips may not select between two different vendor baselines.
  consoleFixture();
  const originalPatch = hostRecovery.descriptor.patchSource;
  const discardedHeader = '// fixture canonicalized header\n';
  hostRecovery.descriptor.patchSource = source => {
    const result = originalPatch(source);
    return { ...result, next: result.next.replace(discardedHeader, '') };
  };
  try {
    write(backup(peerFile(peerRoots[1])), discardedHeader + consolePristine);
    assert.equal(compose.composeSource(discardedHeader + consolePristine, consoleTargets, { file: copied }), consoleBytes);
    const ambiguous = applyCopy();
    assert(ambiguous.incomplete, 'multiple distinct exactly proved peer baselines are ambiguous');
    assert.equal(fs.readFileSync(copied, 'utf8'), consoleBytes);
    assert(!fs.existsSync(backup(copied)), 'ambiguous peers never create a backup');
  } finally { hostRecovery.descriptor.patchSource = originalPatch; }
  console.log('✓ shared CLI/plugin pristine: both install orders, protected steady state, selective uninstall, native retirement, real upstream replacement and poisoned-backup proof/refusal');
} finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
