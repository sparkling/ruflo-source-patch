// Mixed-rollout coverage for RuvNet Brain's upstream-native Codex lifecycle (#52).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SB = path.resolve(process.argv[2]);
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = path.join(SB, 'home');
const CODEX_HOME = path.join(HOME, '.codex');
const MARKET = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain');
const PLUGIN = path.join(MARKET, 'plugin');
const BRAIN_HOME = path.join(HOME, '.cache', 'ruvnet-brain');
const ACTIVE = path.join(BRAIN_HOME, 'versions', '9.9.9-dev');
const FAKE_CODEX = path.join(SB, 'fake-codex.mjs');

process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.RSP_CODEX_HOME = CODEX_HOME;
process.env.RSP_RUVNET_BRAIN_HOME = BRAIN_HOME;
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = MARKET;
process.env.RSP_CODEX_BIN = FAKE_CODEX;

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function write(file, body, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
}

fs.rmSync(SB, { recursive: true, force: true });
write(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), '{"name":"ruvnet-brain","version":"9.9.9-dev"}\n');
write(path.join(PLUGIN, 'hooks', 'hooks.json'), '{"hooks":{}}\n');
write(path.join(PLUGIN, '.codex-plugin', 'plugin.json'), `${JSON.stringify({
  name: 'ruvnet-brain',
  version: '9.9.9-dev',
  hooks: './hooks/codex-hooks.json',
  mcpServers: './.mcp.json',
}, null, 2)}\n`);
const command = 'node "$HOME/.cache/ruvnet-brain/codex-hook.mjs" ';
const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionEnd', 'Stop'];
write(path.join(PLUGIN, 'hooks', 'codex-hooks.json'), `${JSON.stringify({
  hooks: Object.fromEntries(events.map((event) => [
    event,
    [{ hooks: [{ type: 'command', command: `${command}${event}` }] }],
  ])),
}, null, 2)}\n`);
const adapter = "const env = { RUVNET_HOOK_HOST: 'codex' };\nconst shim = 'hook-shim.mjs';\n";
write(path.join(PLUGIN, 'scripts', 'codex-hook-adapter.mjs'), adapter);
write(path.join(ACTIVE, 'scripts', 'codex-hook-adapter.mjs'), adapter);
write(path.join(BRAIN_HOME, 'active.json'), `${JSON.stringify({
  version: '9.9.9-dev',
  codeRoot: path.relative(BRAIN_HOME, ACTIVE),
}, null, 2)}\n`);
write(FAKE_CODEX, `#!/usr/bin/env node
const args = process.argv.slice(2);
const root = ${JSON.stringify(MARKET)};
if (args[0] !== 'plugin') process.exit(2);
if (args[1] === 'marketplace' && args[2] === 'list') {
  process.stdout.write(JSON.stringify({ marketplaces: [{ name: 'ruvnet-brain', root }] }));
} else if (args[1] === 'list') {
  process.stdout.write(JSON.stringify({ installed: [{
    pluginId: 'ruvnet-brain@ruvnet-brain', installed: true, enabled: true,
    source: { path: root + '/plugin' },
  }], available: [] }));
} else process.exit(2);
`, 0o755);

const patcher = await import(`file://${path.join(REPO, 'lib', 'codex-hooks', 'patcher.mjs')}`);

console.log('\nUpstream-native Codex lifecycle rollout');
const sourceManifest = fs.readFileSync(path.join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf8');
const incomplete = patcher.apply();
check('CHN1 source-only upstream rollout is not reported healthy',
  incomplete.incomplete === 1 && /stable wrapper/.test(incomplete.log.join('\n')),
  JSON.stringify(incomplete));
check('CHN2 incomplete rollout is never overwritten by the compatibility patch',
  fs.readFileSync(path.join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf8') === sourceManifest);

write(path.join(BRAIN_HOME, 'codex-hook.mjs'),
  "const active = 'active.json';\nconst adapter = 'codex-hook-adapter.mjs';\n");
const ready = patcher.status();
check('CHN3 full native source, stable wrapper, active adapter, and registration are healthy',
  ready.files === 6 && ready.patched === 6, JSON.stringify(ready));
const applied = patcher.apply();
check('CHN4 native re-apply is a six-component no-op',
  applied.patched === 0 && applied.unchanged === 6 && applied.incomplete === 0 && applied.errors === 0,
  JSON.stringify(applied));

const state = await import(`file://${path.join(REPO, 'lib', 'cwd', 'state.mjs')}`);
const supersede = await import(`file://${path.join(REPO, 'lib', 'supersede.mjs')}`);
state.writeState({ patchTargets: [], pluginTargets: ['codex-hooks'], retired: {}, all: false });
const retirement = supersede.retireSuperseded(state.readState());
const retiredState = state.readState();
check('CHN5 complete native lifecycle retires the compatibility target without touching upstream',
  retirement.retired === 1
    && !retiredState.pluginTargets.includes('codex-hooks')
    && retiredState.retired['codex-hooks']?.issue === 'https://github.com/stuinfla/ruvnet-brain/issues/52'
    && fs.readFileSync(path.join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf8') === sourceManifest,
  JSON.stringify({ retirement, retiredState }));

const restored = patcher.restore();
check('CHN6 compatibility uninstall preserves native files and registration',
  restored.errors === 0
    && fs.readFileSync(path.join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf8') === sourceManifest
    && spawnSync(FAKE_CODEX, ['plugin', 'list', '--json']).status === 0,
  JSON.stringify(restored));

write(path.join(ACTIVE, 'scripts', 'codex-hook-adapter.mjs'), `${adapter}// drift\n`);
const drift = patcher.status();
check('CHN7 an active/source adapter mismatch returns to honest drift', drift.patched === 5,
  JSON.stringify(drift));

const retiredRegistry = JSON.stringify({
  description: 'RuvNet Brain automatic host hooks are intentionally retired. This schema-valid empty registry is shipped so install and update converge old hook-bearing generations to zero implicit lifecycle handlers.',
  hooks: {},
}, null, 2);
write(path.join(PLUGIN, 'hooks', 'codex-hooks.json'), `${retiredRegistry}\n`);
fs.rmSync(path.join(BRAIN_HOME, 'codex-hook.mjs'));
state.writeState({ patchTargets: [], pluginTargets: ['codex-hooks'], retired: {}, all: false });
const nativeRetired = patcher.apply();
check('CHN8 explicit native empty registry is preserved without resurrecting lifecycle hooks',
  nativeRetired.patched === 0 && nativeRetired.incomplete === 0
    && fs.readFileSync(path.join(PLUGIN, 'hooks', 'codex-hooks.json'), 'utf8') === `${retiredRegistry}\n`,
  JSON.stringify(nativeRetired));
check('CHN9 deliberate hook retirement reports native satisfaction', patcher.status().patched === 6);
const emptyRetirement = supersede.retireSuperseded(state.readState());
check('CHN10 deliberate native retirement removes the obsolete target from monitoring',
  emptyRetirement.retired === 1 && !state.readState().pluginTargets.includes('codex-hooks'),
  JSON.stringify(emptyRetirement));
write(path.join(PLUGIN, 'hooks', 'codex-hooks.json'), '{"hooks":{}}\n');
state.writeState({ patchTargets: [], pluginTargets: ['codex-hooks'], retired: {}, all: false });
check('CHN11 unexplained empty hooks cannot prove upstream retirement',
  supersede.retireSuperseded(state.readState()).retired === 0
    && state.readState().pluginTargets.includes('codex-hooks'));
write(path.join(PLUGIN, 'hooks', 'codex-hooks.json'), `${retiredRegistry}\n`);
write(path.join(HOME, '.claude', 'settings.json'), '{}\n');
const retiredInstall = spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), 'codex-hooks', 'install'], {
  env: process.env, encoding: 'utf8',
});
check('CHN12 installation does not request trust for hooks Brain intentionally removed',
  retiredInstall.status === 0
    && /no hook trust action is required/.test(retiredInstall.stdout)
    && !/ACTION REQUIRED/.test(retiredInstall.stdout),
  `${retiredInstall.stdout}\n${retiredInstall.stderr}`);

if (failures) process.exit(1);
console.log('\n✓ codex-hooks-native: mixed rollout is fail-safe and ownership-preserving');
