import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { observeComposition } from '../lib/composition-proof.mjs';
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
const { checkDrift } = await import('../lib/cwd/monitor.mjs');
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
  // SessionStart followers prove the exact installed source once the writer
  // releases; they never take turns doing the same full mutating qualification.
  reset(); state.addTargets(['init']); state.addPluginTargets([plugin]);
  healthy(cli.apply(['init'])); healthy(compose.applyComposed([plugin]));
  assert.equal(compose.installedCompositionHealthy(state.readState()), true);
  assert.equal(compose.installedCompositionHealthy({ patchTargets: [], pluginTargets: [plugin] }), false,
    'an unselected CLI contribution must be restored, even on a shared plugin file');
  const withdrawn = path.join(roots[0], 'agentdb/dist/src/core/AgentDB.js');
  write(withdrawn, 'const vectorStoragePath = "withdrawn fixture";');
  assert.equal(compose.installedCompositionHealthy(state.readState()), false,
    'withdrawn adapter outside active CLI entry table must not be hidden by observation');
  fs.rmSync(withdrawn);
  const { reapply } = await import('../lib/cwd/commands.mjs');
  assert.equal(reapply({ observe: true }).observed, true);
  const hook = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import fs from 'node:fs';
    let candidates = 0; const open = fs.openSync;
    fs.openSync = (file, ...args) => { if (String(file).includes('.mutation.lock.candidate-')) candidates++; return open(file, ...args); };
    process.once('exit', () => console.log('__OBSERVATION__'+JSON.stringify({ candidates })));
    await import(${JSON.stringify(new URL('../lib/cwd/session-start.mjs', import.meta.url).href)});
  `], { env: process.env, cwd: sandbox, encoding: 'utf8', timeout: 15000 });
  assert.equal(hook.status, 0, hook.stdout + hook.stderr);
  assert(hook.stdout.includes('__OBSERVATION__{"candidates":0}'), 'actual SessionStart entry must use the observation path: ' + hook.stdout);
  const leaderRelease = state.acquirePatchMutationLock();
  const childSource = `
    import fs from 'node:fs';
    import { reapply } from ${JSON.stringify(new URL('../lib/cwd/commands.mjs', import.meta.url).href)};
    let candidates = 0; const open = fs.openSync;
    fs.openSync = (file, ...args) => { if (String(file).includes('.mutation.lock.candidate-')) candidates++; return open(file, ...args); };
    console.log('ready');
    try { console.log(JSON.stringify({ result: reapply({ observe: true }), candidates })); }
    catch(error) { console.log(JSON.stringify({ error: error.message, candidates })); process.exitCode = 1; }
  `;
  const followers = Array.from({ length: 6 }, () => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
      env: { ...process.env, RSP_PATCH_LOCK_TIMEOUT_MS: '5000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', stderr = '', ready;
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    const started = new Promise(resolve => { ready = resolve; });
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('ready\n')) ready(); });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const done = new Promise(resolve => child.on('close', code => { clearTimeout(timer); ready(); resolve({ code, output, stderr }); }));
    return { started, done };
  });
  try { await Promise.all(followers.map(child => child.started)); }
  finally { leaderRelease(); }
  for (const row of await Promise.all(followers.map(child => child.done))) {
    assert.equal(row.code, 0, row.output + row.stderr);
    const result = JSON.parse(row.output.trim().split('\n').at(-1));
    assert.equal(result.result.observed, true, row.output);
    assert.equal(result.candidates, 0, 'healthy follower must never publish a mutation claim');
  }
  // A writer disappearing between polling reads must not let a follower skip
  // its proof and publish a redundant mutation claim instead.
  const exists = fs.existsSync; let sawOwner = false, observationCalls = 0;
  fs.existsSync = file => {
    if (file === state.PATCH_MUTATION_LOCK_PATH && !sawOwner) { sawOwner = true; return true; }
    return exists(file);
  };
  try {
    const release = state.acquirePatchMutationLock({ observe: () => { observationCalls++; return true; } });
    try { assert.equal(release, null); } finally { release?.(); }
    assert.equal(observationCalls, 1);
  } finally { fs.existsSync = exists; }
  write(files[0], legacy); // A genuinely dropped patch still requires the writer.
  assert.equal(compose.installedCompositionHealthy(state.readState()), false);
  assert.notEqual(reapply({ observe: true }).observed, true);
  expectFiles(combined(legacy));

  // The pure proof cannot accept markers, missing dependencies or an unstable
  // discovery/source observation. No mutation/recovery hook is invoked.
  const member = path.join(sandbox, 'proof-member.mjs');
  write(member, 'pristine + patch'); write(backup(member), 'pristine');
  const descriptor = { name: 'proof-fixture', hasPatch: source => source.includes(' + patch'),
    patchSource: source => ({ next: source + ' + patch', applied: ['patch'], missing: [] }),
    prepare: () => { throw Error('observation must not mutate'); }, preflight: () => ({ ok: true }) };
  const discovery = () => new Map([[member, [descriptor]]]);
  const observe = () => observeComposition([descriptor], discovery);
  assert.equal(observe(), true);
  descriptor.preflight = () => ({ ok: false }); assert.equal(observe(), false);
  descriptor.preflight = () => { write(member, 'pristine + patch + foreign'); return { ok: true }; };
  assert.equal(observe(), false, 'source changes during dependency checking invalidate proof');
  descriptor.preflight = () => ({ ok: true });
  assert.equal(observe(), false, 'marker-preserving foreign edit is not exact source');
  write(member, 'pristine + patch'); fs.rmSync(backup(member));
  assert.equal(observe(), false, 'missing pristine cannot infer patched provenance');
  write(backup(member), 'pristine + patch'); assert.equal(observe(), false, 'poisoned pristine refuses');
  write(backup(member), 'pristine');
  descriptor.patchSource = source => ({ next: source, applied: [], missing: ['unknown anchor'] });
  assert.equal(observe(), false);
  descriptor.patchSource = source => ({ next: source + ' + patch', applied: ['patch'], missing: [] });
  let discoveries = 0;
  assert.equal(observeComposition([descriptor], () => ++discoveries === 1 ? discovery() : new Map()), false);
  assert.equal(observeComposition([{ ...descriptor, name: 'missing' }], discovery), false);
  assert.equal(observeComposition([{ name: 'absent', applicability: () => ({ state: 'not-applicable' }) }], () => new Map()), true);
  console.log('✓ SessionStart: six followers observe exact source without mutation; drift repairs under lock; unknown/dependency/stability failures refuse');
  reset(); state.addTargets(['init']); state.addPluginTargets([plugin]);
  const { patchPreviousPlatformGenerator } = await import('../lib/ruflo-instruction-contract/skill-contract.mjs');
  for (const file of files) { write(file, patchPreviousPlatformGenerator(cliOnly(legacy)).next); write(backup(file), legacy); }
  healthy(cli.apply(['init'])); expectFiles(combined(legacy));

  reset(PLATFORM_GENERATOR);
  state.addPluginTargets([plugin]); healthy(compose.applyComposed([plugin]));
  assert.equal(compose.installedCompositionHealthy({ patchTargets: ['init'], pluginTargets: [plugin] }), false,
    'a discovered file with zero applicable CLI entries must retain the ordinary incomplete-target postcondition');
  state.writeState({ patchTargets: [], pluginTargets: [plugin], retired: { init: { reason: 'fixture native bounded init replacement' } } });
  healthy(cli.apply([])); expectFiles(instruction.patchSource(PLATFORM_GENERATOR).next);
  for (const file of files) assert.equal(fs.readFileSync(backup(file), 'utf8'), PLATFORM_GENERATOR);

  reset(); state.addTargets(['init']); state.addPluginTargets([plugin]); healthy(compose.applyComposed([plugin]));
  const updated = legacy + '// genuine upstream replacement\n';
  for (const file of files) write(file, updated);
  healthy(cli.apply(['init'])); expectFiles(combined(updated));
  for (const file of files) assert.equal(fs.readFileSync(backup(file), 'utf8'), updated);

  const external = combined(updated) + '// external change retained local markers\n';
  const cleanStatus = compose.statusComposed([plugin])[plugin];
  assert.equal(cleanStatus.patched, cleanStatus.files, 'known CLI/plugin composition remains healthy');
  assert(!checkDrift().drifting.some(reason => reason.startsWith(plugin + ':')), 'monitor accepts proven composition');
  for (const file of files) write(file, external);
  const drift = cli.apply(['init']);
  assert(drift.incomplete, 'marker-preserving external edits need exact composition proof');
  const driftStatus = compose.statusComposed([plugin])[plugin];
  assert.equal(driftStatus.files - driftStatus.patched, files.length,
    'read-only status must reject the same unrecognised marked compositions as install');
  assert(checkDrift().drifting.some(reason => reason.startsWith(plugin + ':')), 'monitor reports unproved composition');
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
  const { nativeCandidate } = await import('../lib/brain-release-lockstep/native.mjs');
  assert(!nativeCandidate(consolePristine), 'legacy host classifier alone does not imply the current structured doctor');
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
  // Exact current compositions need one forward chain, not every historical subset.
  // The same public proof must retain subset/history and reject unknown bytes.
  consoleFixture();
  const proofOwners = [lifecycle, lockstep, hostRecovery].map(module => module.descriptor);
  const originals = proofOwners.map(owner => owner.patchSource);
  const proofCalls = [];
  for (const [index, owner] of proofOwners.entries()) owner.patchSource = (...args) => {
    proofCalls.push(owner.name); return originals[index](...args);
  };
  try {
    assert(compose.isKnownFileComposition(consolePristine, consoleBytes, copied, consoleTargets));
    assert.deepEqual(proofCalls, consoleTargets, 'complete current proof runs each ordered contribution once');
    proofCalls.length = 0;
    const subset = originals[0](consolePristine).next;
    assert(compose.isKnownFileComposition(consolePristine, subset, copied, consoleTargets),
      'partial prior composition still uses the existing historical subset proof');
    assert(proofCalls.length > consoleTargets.length, 'subset mismatch reaches the exhaustive fallback');
    assert(!compose.isKnownFileComposition(consolePristine, consoleBytes + '// unknown edit', copied, consoleTargets));
    assert(!compose.isKnownFileComposition(consolePristine + '// unknown pristine', consoleBytes, copied, consoleTargets));
    assert(!compose.isKnownFileComposition(consolePristine, consolePristine, copied, consoleTargets),
      'unmodified vendor bytes are not invented patch provenance');
    const healthyForward = hostRecovery.descriptor.patchSource;
    hostRecovery.descriptor.patchSource = source => ({ next: consoleBytes, applied: [], missing: ['fixture-unknown-anchor'] });
    assert(!compose.isKnownFileComposition(consolePristine, consoleBytes, copied, consoleTargets),
      'an atomic missing-anchor contribution cannot manufacture an exact full proof');
    hostRecovery.descriptor.patchSource = healthyForward;
  } finally { proofOwners.forEach((owner, index) => { owner.patchSource = originals[index]; }); }
  // The shortcut is inside provenance only; complete native bundle preflight still runs.
  const priorPreflight = hostRecovery.descriptor.preflight;
  hostRecovery.descriptor.preflight = () => ({ ok: false, errors: ['fixture native dependency unavailable'] });
  try {
    const result = applyCopy(); assert(result.incomplete > 0);
    assert(result.log.some(line => line.includes('fixture native dependency unavailable')));
    assert.equal(fs.readFileSync(copied, 'utf8'), consoleBytes);
    assert(!fs.existsSync(backup(copied)), 'failed preflight never enters pristine recovery');
  } finally {
    if (priorPreflight === undefined) delete hostRecovery.descriptor.preflight;
    else hostRecovery.descriptor.preflight = priorPreflight;
  }
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
