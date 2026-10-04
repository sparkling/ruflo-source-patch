import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-swarm-codex-hooks-'));
const home = path.join(temporary, 'home');
process.env.RUFLO_SOURCE_PATCH_HOME = home;
const mod = await import('../lib/ruflo-swarm-codex-hooks/patcher.mjs');
const write = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
const original = `{\n  "description": ${JSON.stringify(mod.DESCRIPTION)},\n  "modules": ["./register.ts"]\n}\n`;
const module = "import type { EngineInterface, On, PluginOptions } from 'claude-code'\nexport default function register($: EngineInterface) {}\n";
const native = '{"description":"Native unsupported-host no-op","hooks":{}}\n';
const plugin = 'ruflo-swarm';
const roots = [path.join(home, '.codex/.tmp/marketplaces/ruflo/plugins', plugin),
  path.join(home, '.codex/plugins/cache/ruflo', plugin, '0.3.1')];
const claudeRoot = path.join(home, '.claude/plugins/cache/ruflo', plugin, '0.3.1');
const populate = (root, body = original, name = plugin) => {
  write(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name, version: '0.3.1' }));
  write(path.join(root, 'hooks/hooks.json'), body);
  write(path.join(root, 'hooks/register.ts'), module);
};
try {
  const fixed = mod.patchSource(original);
  assert.deepEqual(fixed.missing, []);
  assert.equal(mod.isPatched(fixed.next), true);
  const parsed = JSON.parse(fixed.next);
  assert.deepEqual(Object.keys(parsed), ['description', 'hooks']);
  assert.deepEqual(parsed.hooks, {});
  assert.ok(parsed.description.startsWith(mod.DESCRIPTION));
  assert.equal(mod.reverseSource(fixed.next), original);
  assert.deepEqual(mod.patchSource(fixed.next), { next: fixed.next, applied: [], missing: [] });
  assert.equal(mod.hasPatch(native), false);
  assert.equal(mod.isPatched(native), true, 'native empty manifests satisfy the bounded requirement');
  assert.deepEqual(mod.patchSource(native), { next: native, applied: [], missing: [] });
  for (const bad of [
    original.replace('./register.ts', './different.ts'),
    original.replace('"modules":', '"hooks": {}, "modules":'),
    original.replace('"modules":', '"metadata": {}, "modules":'),
    original.replace('"description":', '"description": "duplicate", "description":'),
    original.replace('"modules":', '"modules": [], "modules":'),
    original.replace(mod.DESCRIPTION, 'unknown module intent'),
    original.replace('  "modules":', ' "modules":'),
    fixed.next.replace('commands, skills, agents', 'changed notice'),
    '{"hooks":{},"hooks":{}}',
    '{"description":"x","description":"y","hooks":{}}',
    '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"unreviewed"}]}]}}',
  ]) {
    const refused = mod.patchSource(bad);
    assert.equal(refused.next, bad);
    assert.equal(refused.missing.length, 1, `unknown manifest must remain unchanged: ${bad}`);
  }
  roots.forEach((root) => populate(root)); populate(claudeRoot);
  const files = roots.map((root) => path.join(root, 'hooks/hooks.json'));
  assert.deepEqual(mod.discover(), files);
  assert.deepEqual(mod.preflight(), { ok: true, errors: [] });
  assert.equal(mod.probeNativeSwarmHooksReplacement().state, 'live');
  populate(roots[1], original, 'other-plugin');
  assert.equal(mod.preflight().ok, false, 'wrong plugin identity blocks the entire bundle');
  populate(roots[1]);
  write(path.join(roots[1], 'hooks/register.ts'), 'export default function unknownEngine() {}');
  assert.equal(mod.preflight().ok, false, 'missing Claude engine evidence cannot project the module');
  populate(roots[1]);
  const outside = path.join(temporary, 'outside'); populate(outside);
  fs.rmSync(roots[1], { recursive: true }); fs.symlinkSync(outside, roots[1]);
  assert.equal(mod.preflight().ok, false, 'plugin root symlink escaping the Codex cache is refused');
  fs.unlinkSync(roots[1]); populate(roots[1]);
  const alias = path.join(temporary, 'home-alias'); fs.symlinkSync(home, alias);
  const { existingPathRelative } = await import('../lib/path-containment.mjs');
  assert.equal(existingPathRelative(alias, files[0]), path.relative(home, files[0]), 'physical home aliases are accepted');
  // The shared composition engine, rather than this target, owns writes/backups.
  const compose = await import('../lib/plugin-compose.mjs');
  assert.ok(compose.COMPOSE_TARGETS.includes(mod.NAME), 'new target must be registered with the shared composition owner');
  const applied = compose.applyComposed([mod.NAME]);
  assert.equal(applied.errors, 0); assert.equal(applied.incomplete, 0); assert.equal(applied.patched, 2);
  for (const file of files) {
    assert.equal(fs.readFileSync(file, 'utf8'), fixed.next);
    assert.equal(fs.readFileSync(`${file}.rsp-backup`, 'utf8'), original);
  }
  assert.equal(fs.readFileSync(path.join(claudeRoot, 'hooks/hooks.json'), 'utf8'), original, 'Claude retains its function-hook manifest');
  for (const root of [...roots, claudeRoot]) assert.equal(fs.readFileSync(path.join(root, 'hooks/register.ts'), 'utf8'), module);
  assert.equal(mod.probeNativeSwarmHooksReplacement().state, 'live', 'our projection cannot prove upstream retirement');
  const restored = compose.reconcile([], [mod.NAME]); assert.equal(restored.errors, 0);
  for (const file of files) assert.equal(fs.readFileSync(file, 'utf8'), original);
  for (const file of files) write(file, native);
  assert.equal(mod.probeNativeSwarmHooksReplacement().state, 'superseded');
  assert.equal(compose.applyComposed([mod.NAME]).errors, 0);
  assert.deepEqual(compose.statusComposed([mod.NAME])[mod.NAME], { files: 2, patched: 2 });
  for (const file of files) assert.equal(fs.readFileSync(file, 'utf8'), native);
  const { MANIFESTS } = await import('../lib/ruflo-swarm-codex-hooks/manifests.mjs');
  const extraFiles = [];
  for (const [name, source] of Object.entries(MANIFESTS)) {
    const projected = mod.patchSource(source);
    assert.deepEqual(projected.missing, []);
    assert.equal(mod.isPatched(projected.next), true);
    assert.equal(mod.reverseSource(projected.next), source);
    assert.deepEqual(JSON.parse(projected.next).hooks, {});
    assert.equal(mod.patchSource(source.replace('./register.ts', './unknown.ts')).missing.length, 1);
    const root = path.join(home, '.codex/plugins/cache/ruflo', name, '0.3.1');
    populate(root, source, name);
    write(path.join(root, 'hooks/register.ts'), "import type { Hook, Register } from 'claude-code'\n");
    extraFiles.push(path.join(root, 'hooks/hooks.json'));
  }
  assert.equal(mod.preflight().ok, true);
  assert.equal(mod.probeNativeSwarmHooksReplacement().state, 'live', 'new affected plugins prevent premature retirement');
  const expanded = compose.applyComposed([mod.NAME]);
  assert.equal(expanded.errors, 0); assert.equal(expanded.incomplete, 0);
  for (const file of extraFiles) {
    assert.equal(mod.isPatched(fs.readFileSync(file, 'utf8')), true);
    assert.equal(fs.readFileSync(`${file}.rsp-backup`, 'utf8'), MANIFESTS[path.basename(path.dirname(path.dirname(path.dirname(file))))]);
  }
  assert.equal(compose.reconcile([], [mod.NAME]).errors, 0);
  for (const file of extraFiles) assert.equal(mod.hasPatch(fs.readFileSync(file, 'utf8')), false);
  console.log('✓ Swarm #3688: Codex-only strict no-op, retained Claude modules, exact restoration, unsafe/mixed-module refusal and bounded native retirement');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
