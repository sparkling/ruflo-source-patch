import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-managed-diagnostics-test-')));
const home = path.join(temporary, 'home');
for (const key of ['HOME', 'RUFLO_SOURCE_PATCH_HOME', 'RSP_CODEX_HOME']) process.env[key] = key === 'RSP_CODEX_HOME' ? path.join(home, '.codex') : home;
process.env.RUFLO_NPX_ROOT = path.join(home, '.npm/_npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(home, 'global');
process.env.RSP_RUVNET_BRAIN_HOME = path.join(home, '.cache/ruvnet-brain');
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = path.join(home, '.claude/plugins/marketplaces/ruvnet-brain');
process.env.RSP_RUVNET_BRAIN_RUNTIME = path.join(home, '.claude/ruvnet-brain');
const patcher = await import('../lib/brain-managed-cli-diagnostics/patcher.mjs');
const { probeDiagnosticsBehavior } = await import('../lib/brain-managed-cli-diagnostics/probe.mjs');
const { brainManagedCliDiagnosticsSupersession } = await import('../lib/brain-managed-cli-diagnostics/supersede.mjs');
const fixture = fileURLToPath(new URL('./fixtures/brain-managed-cli-diagnostics/', import.meta.url));
const native = fileURLToPath(new URL('./fixtures/brain-managed-cli-capture/scripts/', import.meta.url));
const write = (file, source) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source); };
const sourceFor = relative => fs.readFileSync(relative === 'scripts/project-progression-hook.mjs'
  || relative === 'scripts/project-progression-contract.mjs' ? path.join(native, path.basename(relative)) : path.join(fixture, relative), 'utf8');
const transform = source => { const result = patcher.patchSource(source); return result.missing.length ? source : result.next; };
try {
  const native457 = fileURLToPath(new URL('./fixtures/brain-managed-cli-native-457/', import.meta.url));
  assert.equal(probeDiagnosticsBehavior(native457).state, 'proven', 'tagged native 4.5.7 preserves complete terminal and durable evidence');
  for (const spec of patcher.SPECS) {
    const source = fs.readFileSync(path.join(native457, spec.relative), 'utf8');
    assert(patcher.nativeSatisfied(source));
    assert.deepEqual(patcher.patchSource(source), { next: source, applied: [], missing: [] });
    assert(!patcher.hasPatch(source));
    const mutated = source.replace('function resultOf(', 'function alteredResult(')
      .replace('function toolAction(', 'function alteredAction(')
      .replace('export function recordManagedCliObservation(', 'export function alteredObservation(');
    assert(!patcher.nativeSatisfied(mutated), 'unknown native boundary cannot masquerade as satisfaction');
  }
  const staged = path.join(temporary, 'native');
  for (const relative of [...patcher.SPECS.map(spec => spec.relative), 'scripts/project-progression-contract.mjs']) write(path.join(staged, relative), sourceFor(relative));
  assert.equal(probeDiagnosticsBehavior(staged).state, 'live', 'native output masks actual timeout despite nonempty output');
  assert.equal(probeDiagnosticsBehavior(staged, { transform }).state, 'proven', 'native reporting, exact progression and durable receipt keep redacted error/signal evidence');
  for (const spec of patcher.SPECS) {
    const source = sourceFor(spec.relative), result = patcher.patchSource(source);
    assert.deepEqual(result.missing, []); assert(patcher.isPatched(result.next));
    assert.equal(patcher.reverseSource(result.next), source);
    assert.deepEqual(patcher.patchSource(result.next), { next: result.next, applied: [], missing: [] });
    for (const invalid of [source + source, source.replace(spec.edits[0][1], '/* upstream drift */'), result.next + result.next]) {
      assert(!patcher.isPatched(invalid)); assert.equal(patcher.patchSource(invalid).next, invalid); assert.equal(patcher.patchSource(invalid).missing.length, 1);
    }
    write(path.join(staged, spec.relative), result.next);
  }
  assert.equal(probeDiagnosticsBehavior(staged).state, 'proven');
  const hook = path.join(staged, 'scripts/project-progression-hook.mjs'), hookSource = fs.readFileSync(hook, 'utf8');
  write(hook, hookSource.replace('if (error) observation.error = error;', '/* lost terminal error */'));
  assert.notEqual(probeDiagnosticsBehavior(staged).state, 'proven', 'missing durable error is rejected'); write(hook, hookSource);
  const health = path.join(staged, 'scripts/capability-claim-evidence.mjs'), healthSource = fs.readFileSync(health, 'utf8');
  write(health, healthSource.replace('terminal: redactProgression({', 'terminal: ((value) => ({ value }))({'));
  assert.notEqual(probeDiagnosticsBehavior(staged).state, 'proven', 'unredacted independent receipt is rejected'); write(health, healthSource);
  const cli = path.join(staged, 'mcp/managed-cli-interface.mjs'), cliSource = fs.readFileSync(cli, 'utf8');
  write(cli, cliSource.replace("if (execution?.signal) return { outcome: 'interrupted'", "if (execution?.signal) return { outcome: 'success'"));
  assert.notEqual(probeDiagnosticsBehavior(staged).state, 'proven', 'native outcome mutation cannot retire'); write(cli, cliSource);
  // Composition uses only a fully isolated synthetic native generation.
  const brain = path.join(home, '.cache/ruvnet-brain'), activeRoot = path.join(brain, 'versions/4.5.4');
  const { VENDOR_SPECS } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
  for (const spec of VENDOR_SPECS) write(path.join(activeRoot, spec.relative), 'fixture native discovery member');
  write(path.join(activeRoot, 'scripts/hook-input.mjs'), 'export const parseHookEvent=()=>null;');
  write(path.join(activeRoot, '.claude-plugin/plugin.json'), '{"name":"ruvnet-brain","version":"4.5.4"}');
  for (const relative of [...patcher.SPECS.map(spec => spec.relative), 'scripts/project-progression-contract.mjs']) write(path.join(activeRoot, relative), sourceFor(relative));
  const active = path.join(brain, 'active.json'), activeBytes = '{"version":"4.5.4","codeRoot":"versions/4.5.4"}'; write(active, activeBytes);
  assert(patcher.discover().length === 3);
  assert(patcher.discover().every(file => file.startsWith(temporary + path.sep)), 'never discover or mutate live paths');
  assert.equal(patcher.preflight().ok, true);
  const compose = await import('../lib/plugin-compose.mjs');
  assert(compose.COMPOSE_TARGETS.includes(patcher.NAME));
  const applied = compose.applyComposed([patcher.NAME]);
  assert.equal(applied.errors, 0, applied.log.join('\n')); assert.equal(applied.incomplete, 0); assert.equal(applied.patched, 3);
  assert.equal(probeDiagnosticsBehavior(activeRoot).state, 'proven');
  assert.equal(brainManagedCliDiagnosticsSupersession().check().state, 'live', 'locally patched bytes cannot prove native retirement');
  const restored = compose.reconcile([], [patcher.NAME]); assert.equal(restored.errors, 0, restored.log.join('\n'));
  for (const spec of patcher.SPECS) assert.equal(fs.readFileSync(path.join(activeRoot, spec.relative), 'utf8'), sourceFor(spec.relative));
  // Other native observation targets share one pristine hook; either install
  // order and either selective removal preserves every surviving contribution.
  const capture = await import('../lib/brain-managed-cli-capture/patcher.mjs');
  const collision = await import('../lib/brain-progression-collision/patcher.mjs');
  write(path.join(activeRoot, 'scripts/project-progression-producer.mjs'), fs.readFileSync(path.join(native, 'project-progression-producer.mjs'), 'utf8'));
  write(path.join(activeRoot, 'scripts/project-progression-store.mjs'), fs.readFileSync(fileURLToPath(new URL('./fixtures/brain-progression-collision/project-progression-store.mjs', import.meta.url)), 'utf8'));
  const siblings = [capture.NAME, collision.NAME];
  for (const diagnosticFirst of [true, false]) {
    let result = compose.applyComposed(diagnosticFirst ? [patcher.NAME] : siblings);
    assert.equal(result.errors, 0, result.log.join('\n')); assert.equal(result.incomplete, 0);
    result = compose.applyComposed([patcher.NAME, ...siblings]);
    assert.equal(result.errors, 0, result.log.join('\n')); assert.equal(result.incomplete, 0);
    const shared = path.join(activeRoot, 'scripts/project-progression-hook.mjs');
    const combined = fs.readFileSync(shared, 'utf8');
    assert(patcher.isPatched(combined) && capture.isPatched(combined) && collision.isPatched(combined));
    assert.equal(fs.readFileSync(shared + '.rsp-backup', 'utf8'), sourceFor('scripts/project-progression-hook.mjs'), 'one true native pristine');
    const remaining = diagnosticFirst ? siblings : [patcher.NAME], removed = diagnosticFirst ? [patcher.NAME] : siblings;
    result = compose.reconcile(remaining, removed); assert.equal(result.errors, 0, result.log.join('\n'));
    const selected = fs.readFileSync(shared, 'utf8');
    assert.equal(patcher.hasPatch(selected), !diagnosticFirst);
    assert.equal(capture.hasPatch(selected), diagnosticFirst); assert.equal(collision.hasPatch(selected), diagnosticFirst);
    result = compose.reconcile([], remaining); assert.equal(result.errors, 0, result.log.join('\n'));
    assert.equal(fs.readFileSync(shared, 'utf8'), sourceFor('scripts/project-progression-hook.mjs'));
  }
  const member = path.join(activeRoot, patcher.SPECS[1].relative), original = fs.readFileSync(member, 'utf8');
  write(member, original.replace(patcher.SPECS[1].edits[0][1], '/* anchor drift */'));
  const blocked = compose.applyComposed([patcher.NAME]); assert(blocked.incomplete > 0);
  assert.equal(fs.readFileSync(path.join(activeRoot, patcher.SPECS[0].relative), 'utf8'), sourceFor(patcher.SPECS[0].relative), 'incomplete bundle leaves other member unchanged');
  for (const spec of patcher.SPECS) write(path.join(activeRoot, spec.relative), transform(sourceFor(spec.relative)).split('\n').filter(line => !line.includes(patcher.PATCH_MARKER)).join('\n'));
  assert.equal(brainManagedCliDiagnosticsSupersession().check().state, 'superseded', 'marker-free native behavior, not version, proves retirement');
  assert.equal(fs.readFileSync(active, 'utf8'), activeBytes, 'native selected generation untouched');
  // Native promotion must keep old owned source discoverable without selecting
  // or modifying its version identity. Unowned generations remain excluded.
  const discovery = await import('../lib/brain-managed-memory-boundary/discovery.mjs');
  for (const invalid of [[], Array(33).fill('mcp/server.mjs'), ['../outside'], ['/absolute'], ['C:/absolute'], ['x\\y'], ['x//y'], ['x/../y'], ['.'], ['x\0y']]) {
    assert.throws(() => discovery.discover({ ownedRelatives: invalid }), /normalized relative paths/);
  }
  const promoted = path.join(brain, 'versions/4.5.5'); fs.cpSync(activeRoot, promoted, { recursive: true });
  write(path.join(promoted, '.claude-plugin/plugin.json'), '{"name":"ruvnet-brain","version":"4.5.5"}');
  for (const spec of patcher.SPECS) write(path.join(promoted, spec.relative), sourceFor(spec.relative));
  write(active, '{"version":"4.5.5","codeRoot":"versions/4.5.5"}');
  const oldMember = path.join(activeRoot, patcher.SPECS[0].relative);
  write(oldMember, transform(sourceFor(patcher.SPECS[0].relative)));
  assert(patcher.surfaces().some(surface => surface.root === activeRoot), 'owned old generation retained after native promotion');
  write(oldMember, sourceFor(patcher.SPECS[0].relative));
  assert(!patcher.surfaces().some(surface => surface.root === activeRoot), 'unowned old generation excluded');
  const external = path.join(temporary, 'external.mjs'); write(external, patcher.PATCH_MARKER);
  fs.rmSync(oldMember); fs.symlinkSync(external, oldMember);
  assert(!patcher.surfaces().some(surface => surface.root === activeRoot), 'external marker symlink cannot confer ownership');
  fs.rmSync(oldMember); fs.renameSync(path.join(activeRoot, 'mcp'), path.join(activeRoot, 'old-mcp'));
  const externalDirectory = path.join(temporary, 'outside-mcp'); fs.mkdirSync(externalDirectory); write(path.join(externalDirectory, 'managed-cli-interface.mjs'), patcher.PATCH_MARKER);
  fs.symlinkSync(externalDirectory, path.join(activeRoot, 'mcp'));
  assert(!patcher.surfaces().some(surface => surface.root === activeRoot), 'parent symlink escape cannot confer ownership');
  console.log('✓ Brain #386: terminal output and true reasons, native outcomes, exact redacted progression/health receipts, atomic composition, pristine restoration and behavioral retirement');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
