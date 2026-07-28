// Behavioral coverage for the RuvNet Brain Codex lifecycle target (#52).

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
const FAKE_CODEX = path.join(SB, 'fake-codex.mjs');
const FAKE_STATE = path.join(CODEX_HOME, 'fake-plugin-state.json');
const HOOK_LOG = path.join(SB, 'hook-log.jsonl');
const STABLE_ADAPTER = path.join(
  HOME, '.ruflo-source-patch', 'lib', 'codex-hooks', 'codex-hook-adapter.mjs',
);

process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.RSP_CODEX_HOME = CODEX_HOME;
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = MARKET;
process.env.RSP_CODEX_BIN = FAKE_CODEX;
process.env.RSP_HOOK_LOG = HOOK_LOG;
process.env.RSP_NO_LAUNCHCTL = '1';

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
  fs.chmodSync(file, mode);
}

function fakeCodexSource() {
  return `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const home = process.env.CODEX_HOME;
const file = path.join(home, 'fake-plugin-state.json');
fs.mkdirSync(home, { recursive: true });
const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { marketplaces: [], plugins: {} }; } };
const save = (s) => fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\\n');
const out = (v) => { process.stdout.write(JSON.stringify(v)); process.exit(0); };
const args = process.argv.slice(2);
const state = load();
if (args[0] !== 'plugin') process.exit(2);
if (args[1] === 'marketplace' && args[2] === 'list') {
  out({ marketplaces: state.marketplaces.map((m) => ({ ...m, marketplaceSource: { sourceType: 'local', source: m.root } })) });
}
if (args[1] === 'marketplace' && args[2] === 'add') {
  const root = path.resolve(args[3]);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
  if (!state.marketplaces.some((m) => m.name === manifest.name)) state.marketplaces.push({ name: manifest.name, root });
  save(state); out({ added: manifest.name });
}
if (args[1] === 'marketplace' && args[2] === 'remove') {
  state.marketplaces = state.marketplaces.filter((m) => m.name !== args[3]);
  save(state); out({ removed: args[3] });
}
if (args[1] === 'list') {
  const installed = [], available = [];
  for (const market of state.marketplaces) {
    const manifest = JSON.parse(fs.readFileSync(path.join(market.root, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
    for (const p of manifest.plugins || []) {
      const pluginId = p.name + '@' + market.name;
      const pluginPath = path.resolve(market.root, p.source.path);
      const pm = JSON.parse(fs.readFileSync(path.join(pluginPath, '.codex-plugin', 'plugin.json'), 'utf8'));
      const row = { pluginId, name: p.name, marketplaceName: market.name, version: pm.version,
        installed: Boolean(state.plugins[pluginId]?.installed), enabled: Boolean(state.plugins[pluginId]?.enabled),
        source: { source: 'local', path: pluginPath } };
      (row.installed ? installed : available).push(row);
    }
  }
  out({ installed, available });
}
if (args[1] === 'add') {
  state.plugins[args[2]] = { installed: true, enabled: true };
  save(state); out({ installed: args[2] });
}
if (args[1] === 'remove') {
  delete state.plugins[args[2]];
  save(state); out({ removed: args[2] });
}
process.stderr.write('unsupported fake codex command: ' + args.join(' '));
process.exit(2);
`;
}

function fakeShimSource() {
  return `#!/usr/bin/env node
import fs from 'node:fs';
let raw = ''; try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let event = null; try { event = JSON.parse(raw); } catch {}
const hook = process.argv[2] || '';
fs.appendFileSync(process.env.RSP_HOOK_LOG, JSON.stringify({ hook, event,
  sid: process.env.CLAUDE_SESSION_ID || null, project: process.env.CLAUDE_PROJECT_DIR || null }) + '\\n');
if (hook === 'hijack-ruvnet') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse',
    permissionDecision: 'defer', additionalContext: 'ground this edit' } }));
} else if (hook === 'route-dispatch' && !event?.tool_input?.model) {
  process.stderr.write('Claude-only model guidance: haiku sonnet opus --harness claude-code\\n');
  process.exit(2);
} else if (hook === 'session-start') {
  process.stdout.write('brain session context');
} else if (hook === 'ground-ruvnet') {
  process.stdout.write('[RuvNet Brain] grounded prompt context');
} else if (hook === 'continuation-gate') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'Stop', additionalContext: 'continue the unfinished task' } }));
} else if (hook === 'unprompted-speech' && process.argv[3] === 'PreToolUse-bash') {
  process.stderr.write('block from lesson\\n'); process.exit(2);
}
`;
}

function fakeHooksSource(withUpdate = false) {
  const shim = (id, suffix = '', advisory = false) => ({
    type: 'command',
    command: `node "\${CLAUDE_PLUGIN_ROOT}/scripts/hook-shim.mjs" ${id}${suffix}${advisory ? ' || true' : ''}`,
    timeout: 5,
  });
  const hooks = {
    SessionStart: [{ matcher: 'startup|resume', hooks: [shim('session-start', '', true)] }],
    UserPromptSubmit: [{ matcher: '.*', hooks: [
      shim('ground-ruvnet', '', true), shim('unprompted-speech', ' UserPromptSubmit'),
    ] }],
    PreToolUse: [
      { matcher: 'Write|Edit|Bash', hooks: [shim('hijack-ruvnet', '', true)] },
      { matcher: 'Task', hooks: [shim('route-dispatch')] },
      { matcher: 'Bash', hooks: [shim('verify-interface'), shim('design-wall')] },
    ],
    PostToolUse: [{ matcher: 'Write|Edit|Bash', hooks: [shim('learn-capture', '', true)] }],
    SessionEnd: [{ matcher: '.*', hooks: [shim('learn-flush', '', true)] }],
    Stop: [{ matcher: '*', hooks: [shim('continuation-gate', '', true)] }],
  };
  if (withUpdate) {
    hooks.PreToolUse.push({ matcher: 'Write|Edit', hooks: [shim('protect-state')] });
    hooks.PostToolUse.push({ matcher: '^Bash$', hooks: [shim('signal-watch', '', true)] });
  }
  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}

function fakeStopSource() {
  return `#!/usr/bin/env node
import fs from 'node:fs';
try { fs.readFileSync(0, 'utf8'); } catch {}
process.stdout.write(JSON.stringify({ hookSpecificOutput: {
  hookEventName: 'Stop', additionalContext: 'continue the unfinished task' } }));
`;
}

function seed() {
  fs.rmSync(SB, { recursive: true, force: true });
  write(FAKE_CODEX, fakeCodexSource(), 0o755);
  const unrelated = path.join(SB, 'unrelated');
  write(path.join(unrelated, '.agents', 'plugins', 'marketplace.json'), `${JSON.stringify({
    name: 'unrelated',
    plugins: [{ name: 'unrelated', source: { source: 'local', path: './plugin' } }],
  })}\n`);
  write(path.join(unrelated, 'plugin', '.codex-plugin', 'plugin.json'), '{"name":"unrelated","version":"1.0.0","description":"fixture"}\n');
  write(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), `${JSON.stringify({
    name: 'ruvnet-brain',
    version: '9.9.9-dev',
    description: 'fixture',
    author: { name: 'fixture' },
    repository: 'https://github.com/stuinfla/ruvnet-brain',
    license: 'MIT',
    keywords: ['brain'],
  }, null, 2)}\n`);
  write(path.join(PLUGIN, 'scripts', 'hook-shim.mjs'), fakeShimSource(), 0o755);
  write(path.join(PLUGIN, 'hooks', 'hooks.json'), fakeHooksSource());
  write(path.join(PLUGIN, 'scripts', 'continuation-gate.mjs'), fakeStopSource(), 0o755);
  write(path.join(HOME, '.claude', 'settings.json'), '{}\n');
  write(FAKE_STATE, `${JSON.stringify({
    marketplaces: [{ name: 'unrelated', root: unrelated }],
    plugins: { 'unrelated@unrelated': { installed: true, enabled: true } },
  }, null, 2)}\n`);
}

function runAdapter(modeArgs, input, extraEnv = {}, adapter = path.join(
  REPO, 'lib', 'codex-hooks', 'codex-hook-adapter.mjs',
)) {
  return spawnSync(process.execPath, [
    adapter,
    ...modeArgs,
  ], {
    input: JSON.stringify(input),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, ...extraEnv },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function hookRows() {
  try {
    return fs.readFileSync(HOOK_LOG, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch { return []; }
}

function waitForHook(name, deadline = Date.now() + 2000) {
  while (Date.now() < deadline) {
    const row = hookRows().find((item) => item.hook === name);
    if (row) return row;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return null;
}

seed();
const patcher = await import(`file://${path.join(REPO, 'lib', 'codex-hooks', 'patcher.mjs')}`);

console.log('\nCodex hook packaging');
const applied = patcher.apply();
check('CH1 apply creates four artifacts and two Codex registrations',
  applied.errors === 0 && applied.incomplete === 0 && applied.patched === 6,
  JSON.stringify(applied));
const ready = patcher.status();
check('CH2 status requires all six lifecycle components', ready.files === 6 && ready.patched === 6,
  JSON.stringify(ready));
const repeat = patcher.apply();
check('CH3 re-apply is byte/config idempotent', repeat.patched === 0 && repeat.unchanged === 6,
  JSON.stringify(repeat));

const fakeState = JSON.parse(fs.readFileSync(FAKE_STATE, 'utf8'));
check('CH4 registration preserves unrelated marketplaces/plugins',
  fakeState.marketplaces.some((m) => m.name === 'unrelated')
    && fakeState.plugins['unrelated@unrelated']?.enabled === true);

const pluginManifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf8'));
const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'codex-hooks.json'), 'utf8'));
check('CH5 plugin is hook-only and cannot duplicate the existing MCP',
  pluginManifest.hooks === './hooks/codex-hooks.json'
    && !('mcpServers' in pluginManifest)
    && !JSON.stringify(pluginManifest).includes('.mcp.json'));
check('CH6 manifest adapts Agent matching and SessionEnd budget',
  hooks.hooks.PreToolUse.some((g) => g.matcher === 'Agent')
    && hooks.hooks.SessionEnd[0].hooks[0].timeout === 3);
check('CH7 hook commands use the stable patch entrypoint, never a versioned plugin path',
  JSON.stringify(hooks).includes(STABLE_ADAPTER)
    && !JSON.stringify(hooks).includes('${CLAUDE_PLUGIN_ROOT}')
    && !JSON.stringify(hooks).includes('/Users/henrik')
    && !JSON.stringify(hooks).includes('/Users/stuart'));
write(path.join(PLUGIN, 'hooks', 'hooks.json'), fakeHooksSource(true));
const shellRefresh = patcher.apply();
const refreshedHooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'codex-hooks.json'), 'utf8'));
check('CH7a a Brain shell update refreshes Codex from the upstream manifest',
  shellRefresh.patched === 1
    && JSON.stringify(refreshedHooks).includes('shim protect-state')
    && JSON.stringify(refreshedHooks).includes('shim signal-watch'));

const realCodex = spawnSync('codex', ['--version'], { encoding: 'utf8' });
if (realCodex.status === 0) {
  const actualHome = path.join(SB, 'actual-codex-home');
  fs.mkdirSync(actualHome, { recursive: true });
  const env = { ...process.env, CODEX_HOME: actualHome };
  const marketAdd = spawnSync('codex', ['plugin', 'marketplace', 'add', MARKET, '--json'], { env, encoding: 'utf8' });
  const pluginAdd = spawnSync('codex', ['plugin', 'add', 'ruvnet-brain@ruvnet-brain', '--json'], { env, encoding: 'utf8' });
  const listed = spawnSync('codex', ['plugin', 'list', '--json'], { env, encoding: 'utf8' });
  let found = false;
  try {
    found = JSON.parse(listed.stdout).installed.some((p) =>
      p.pluginId === 'ruvnet-brain@ruvnet-brain' && p.enabled);
  } catch { /* failure reported below */ }
  check('CH8 real Codex CLI accepts and enables the generated marketplace/plugin',
    marketAdd.status === 0 && pluginAdd.status === 0 && listed.status === 0 && found,
    `${marketAdd.stderr}${pluginAdd.stderr}${listed.stderr}`);
} else {
  console.log('  · CH8 real Codex CLI validation skipped (codex not installed)');
}

console.log('\nCodex hook ABI adapter');
fs.rmSync(HOOK_LOG, { force: true });
const baseEvent = {
  session_id: 'session-a',
  cwd: path.join(SB, 'project'),
  hook_event_name: 'PreToolUse',
  tool_name: 'apply_patch',
  tool_input: {
    command: '*** Begin Patch\n*** Update File: README.md\n+x\n*** Update File: src/a.js\n+y\n*** End Patch\n',
  },
};

const hijack = runAdapter(['shim', 'hijack-ruvnet'], baseEvent);
let hijackJson = {};
try { hijackJson = JSON.parse(hijack.stdout); } catch {}
check('CH9 advisory hijack removes invalid Codex permissionDecision:defer',
  hijack.status === 0
    && hijackJson.hookSpecificOutput?.additionalContext === 'ground this edit'
    && !('permissionDecision' in (hijackJson.hookSpecificOutput || {})));
const hijackRow = hookRows().find((row) => row.hook === 'hijack-ruvnet');
check('CH10 apply_patch content and Codex session env reach the Brain',
  hijackRow?.event?.tool_input?.content.includes('Update File: README.md')
    && hijackRow.sid === 'session-a'
    && hijackRow.project === baseEvent.cwd);

const route = runAdapter(['shim', 'route-dispatch'], {
  ...baseEvent,
  tool_name: 'spawn_agent',
  tool_input: { task_name: 'research', message: 'trace hooks' },
});
check('CH11 spawn_agent is normalized and a route denial keeps exit-2 semantics',
  route.status === 2
    && /Claude-only model guidance/.test(route.stderr));
const routeRow = hookRows().find((row) => row.hook === 'route-dispatch');
check('CH12 route payload becomes Brain-compatible Agent/description fields',
  routeRow?.event?.tool_name === 'Agent'
    && routeRow.event.tool_input.description === 'research');
const allowedRoute = runAdapter(['shim', 'route-dispatch'], {
  ...baseEvent,
  tool_name: 'spawn_agent',
  tool_input: { task_name: 'research', message: 'trace hooks', model: 'gpt-5.6-terra' },
});
check('CH13 explicit-model spawn remains allowed', allowedRoute.status === 0);

runAdapter(['shim', 'learn-capture'], baseEvent);
const learned = hookRows().filter((row) => row.hook === 'learn-capture').at(-1);
check('CH14 apply_patch learning is normalized to Edit with a contained file path',
  learned?.event?.tool_name === 'Edit'
    && learned.event.tool_input.file_path === path.join(baseEvent.cwd, 'README.md'));

const stampBefore = hookRows().filter((row) => row.hook === 'md-stamp').length;
runAdapter(['shim', 'md-stamp'], baseEvent);
const stampRows = hookRows().filter((row) => row.hook === 'md-stamp').slice(stampBefore);
check('CH15 adapter passes md-stamp through without inventing a multi-file edit model',
  stampRows.length === 1
    && stampRows[0].event.tool_name === 'apply_patch'
    && !stampRows[0].event.tool_input.file_path);

const start = runAdapter(['shim', 'session-start'], {
  session_id: 'session-a', cwd: baseEvent.cwd, hook_event_name: 'SessionStart', source: 'startup',
});
let startJson = {};
try { startJson = JSON.parse(start.stdout); } catch {}
check('CH16 SessionStart context becomes explicit valid Codex JSON',
  start.status === 0
    && startJson.hookSpecificOutput?.hookEventName === 'SessionStart'
    && startJson.hookSpecificOutput?.additionalContext === 'brain session context');

const grounding = runAdapter(['shim', 'ground-ruvnet'], {
  session_id: 'session-a',
  cwd: baseEvent.cwd,
  hook_event_name: 'UserPromptSubmit',
  prompt: 'diagnostic prompt',
});
let groundingJson = {};
try { groundingJson = JSON.parse(grounding.stdout); } catch {}
check('CH17 bracket-prefixed grounding text becomes valid Codex UserPromptSubmit JSON',
  grounding.status === 0
    && groundingJson.hookSpecificOutput?.hookEventName === 'UserPromptSubmit'
    && groundingJson.hookSpecificOutput?.additionalContext === '[RuvNet Brain] grounded prompt context');

const blocked = runAdapter(['shim', 'unprompted-speech', 'PreToolUse-bash'], {
  ...baseEvent, tool_name: 'Bash', tool_input: { command: 'danger' },
});
check('CH18 blocking lesson preserves exit 2 plus stderr', blocked.status === 2 && /block from lesson/.test(blocked.stderr));

const stop = runAdapter(['stop'], {
  session_id: 'session-a', cwd: baseEvent.cwd, hook_event_name: 'Stop',
});
let stopJson = {};
try { stopJson = JSON.parse(stop.stdout); } catch {}
check('CH19 Claude Stop context becomes Codex decision:block + reason',
  stop.status === 0 && stopJson.decision === 'block' && /unfinished task/.test(stopJson.reason));

fs.rmSync(HOOK_LOG, { force: true });
const flushStarted = Date.now();
const flush = runAdapter(['detach-flush'], {
  session_id: 'session-b', cwd: baseEvent.cwd, hook_event_name: 'SessionEnd',
});
const flushRow = waitForHook('learn-flush');
check('CH20 SessionEnd returns inside Codex budget and keeps session identity',
  flush.status === 0 && Date.now() - flushStarted < 3000 && flushRow?.sid === 'session-b');

console.log('\nOwnership and command lifecycle');
const driftedAdapter = path.join(PLUGIN, 'scripts', 'codex-hook-adapter.mjs');
fs.appendFileSync(driftedAdapter, '\n// user-owned drift\n');
const refused = patcher.restore();
check('CH21 uninstall refuses drifted/non-exact artifacts and leaves registration live',
  refused.unresolved === 1
    && JSON.parse(fs.readFileSync(FAKE_STATE, 'utf8')).plugins['ruvnet-brain@ruvnet-brain']?.enabled);
patcher.apply();
const restored = patcher.restore();
check('CH22 exact uninstall removes only the six owned components',
  restored.errors === 0 && restored.incomplete === 0 && restored.unresolved === 0 && restored.restored === 6,
  JSON.stringify(restored));
const after = JSON.parse(fs.readFileSync(FAKE_STATE, 'utf8'));
check('CH23 exact uninstall preserves unrelated Codex state',
  after.marketplaces.some((m) => m.name === 'unrelated')
    && after.plugins['unrelated@unrelated']?.enabled
    && !fs.existsSync(path.join(PLUGIN, '.codex-plugin', 'plugin.json')));

console.log('\nStale-session upgrade survival');
const brainHome = path.join(HOME, '.cache', 'ruvnet-brain');
const activeRoot = path.join(brainHome, 'versions', '9.9.9-dev');
const staleRoot = path.join(
  CODEX_HOME, 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain', '9.9.8-dev',
);
write(path.join(activeRoot, 'scripts', 'hook-shim.mjs'), fakeShimSource(), 0o755);
write(path.join(brainHome, 'active.json'), `${JSON.stringify({
  version: '9.9.9-dev',
  codeRoot: activeRoot,
  previous: { version: '9.9.8-dev' },
}, null, 2)}\n`);
const env = { ...process.env };
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), ...args], {
  env, encoding: 'utf8',
});
const install = cli(['codex-hooks', 'install']);
let tracked = {};
try { tracked = JSON.parse(fs.readFileSync(path.join(HOME, '.ruflo-source-patch', 'state.json'), 'utf8')); } catch {}
check('CH24 CLI install tracks the target and materializes stable plus stale-session entrypoints',
  install.status === 0
    && tracked.pluginTargets?.includes('codex-hooks')
    && fs.existsSync(STABLE_ADAPTER)
    && fs.existsSync(path.join(staleRoot, 'scripts', 'codex-hook-adapter.mjs'))
    && /ACTION REQUIRED/.test(install.stdout)
    && /start a new Codex session, run \/hooks/.test(install.stdout),
  `${install.stdout}${install.stderr}`);
const staleStart = runAdapter(['shim', 'session-start'], {
  session_id: 'session-stale',
  cwd: baseEvent.cwd,
  hook_event_name: 'SessionStart',
  source: 'startup',
}, {
  CLAUDE_PLUGIN_ROOT: staleRoot,
  RUVNET_BRAIN_HOME: brainHome,
}, STABLE_ADAPTER);
const staleGrounding = runAdapter(['shim', 'ground-ruvnet'], {
  session_id: 'session-stale',
  cwd: baseEvent.cwd,
  hook_event_name: 'UserPromptSubmit',
  prompt: 'after an automatic Brain update',
}, {
  CLAUDE_PLUGIN_ROOT: staleRoot,
  RUVNET_BRAIN_HOME: brainHome,
}, STABLE_ADAPTER);
const staleSpeech = runAdapter(['shim', 'unprompted-speech', 'UserPromptSubmit'], {
  session_id: 'session-stale',
  cwd: baseEvent.cwd,
  hook_event_name: 'UserPromptSubmit',
  prompt: 'after an automatic Brain update',
}, {
  CLAUDE_PLUGIN_ROOT: staleRoot,
  RUVNET_BRAIN_HOME: brainHome,
}, STABLE_ADAPTER);
let staleGroundingJson = {};
try { staleGroundingJson = JSON.parse(staleGrounding.stdout); } catch {}
let staleStartJson = {};
try { staleStartJson = JSON.parse(staleStart.stdout); } catch {}
check('CH25 the installed stable entrypoint survives deletion of the boot-time plugin root',
  staleStart.status === 0
    && staleStartJson.hookSpecificOutput?.hookEventName === 'SessionStart'
    && staleStartJson.hookSpecificOutput?.additionalContext === 'brain session context'
    && staleGrounding.status === 0
    && staleGroundingJson.hookSpecificOutput?.hookEventName === 'UserPromptSubmit'
    && staleSpeech.status === 0,
  `${staleStart.stderr}${staleGrounding.stderr}${staleSpeech.stderr}`);

const status = cli(['codex-hooks', 'status']);
check('CH26 CLI status reports installed/enabled without claiming hook trust',
  status.status === 0 && /6\/6/.test(status.stdout) && /\/hooks/.test(status.stdout));
const uninstall = cli(['codex-hooks', 'uninstall']);
let finalState = {};
try { finalState = JSON.parse(fs.readFileSync(path.join(HOME, '.ruflo-source-patch', 'state.json'), 'utf8')); } catch {}
check('CH27 CLI uninstall clears target state and its compatibility bridge after safe removal',
  uninstall.status === 0
    && !finalState.pluginTargets?.includes('codex-hooks')
    && !fs.existsSync(path.join(staleRoot, 'scripts', 'codex-hook-adapter.mjs')),
  `${uninstall.stdout}${uninstall.stderr}`);

if (failures) {
  console.log(`\n✘ codex-hooks: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ codex-hooks: packaging, registration, ABI translation, ownership, and CLI lifecycle verified');
