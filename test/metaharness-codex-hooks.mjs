// MetaHarness #168: declared hooks must reach Codex without weakening matchers or trust.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SANDBOX = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-metaharness-hooks-'));
const HOME = path.join(SANDBOX, 'home');
const NPX = path.join(SANDBOX, 'npx');
const GLOBAL = path.join(SANDBOX, 'global');
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.RUFLO_NPX_ROOT = NPX;
process.env.RUFLO_GLOBAL_ROOT = GLOBAL;
process.env.RSP_NO_LAUNCHCTL = '1';
process.env.RSP_NO_SELF_UPDATE = '1';

const hostFixture = `// metaharness dist fixture
/**
 * Emit the config files for a single host. Returns [] for claude-code (handled
 * by the templates) and for any unknown host id.
 */
export function hostConfigFiles(host, cfg) {
    switch (host) {
        case 'codex': {
            const toml = '# test\\n';
            return [
                { path: '.codex/config.toml', content: toml },
                { path: 'AGENTS.md', content: cfg.description },
            ];
        }
        default:
            return [];
    }
}
`;

const adapterFixture = `// @metaharness/host-codex dist fixture
export const adapter = {
  name: 'codex',
  generateConfig: (spec) => {
    const out = { '.codex/config.toml': '# test\\n' };
    // ADR-044: emit AGENTS.md (system prompt + agent roster).
    if (spec.description) out['AGENTS.md'] = spec.description;
    return out;
  },
};
export default adapter;
`;

function writePackage(root, name, relative, source) {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name, version: '0.0.0-test' })}\n`);
  fs.writeFileSync(path.join(root, relative), source);
  return path.join(root, relative);
}

const hostFile = writePackage(path.join(GLOBAL, 'metaharness'), 'metaharness', 'dist/host-config.js', hostFixture);
const adapterFile = writePackage(path.join(GLOBAL, '@metaharness', 'host-codex'), '@metaharness/host-codex', 'dist/index.js', adapterFixture);
writePackage(path.join(GLOBAL, 'impostor'), 'not-metaharness', 'dist/host-config.js', hostFixture);
writePackage(path.join(NPX, 'one', 'node_modules', 'metaharness'), 'metaharness', 'dist/host-config.js', hostFixture);

const patcher = await import('../lib/metaharness-codex-hooks/patcher.mjs');
const { applyComposed, composeSource, reconcile, statusComposed } = await import('../lib/plugin-compose.mjs');

const fail = (message) => { console.error(`✘ ${message}`); process.exit(1); };
const check = (label, condition) => { if (!condition) fail(label); };

const discovered = patcher.discover().sort();
check('MCH1 discovery includes exact authenticated global and npx package surfaces',
  discovered.length === 3 && discovered.includes(hostFile) && discovered.includes(adapterFile));
check('MCH2 discovery rejects a package-name impostor',
  !discovered.some((file) => file.includes(`${path.sep}impostor${path.sep}`)));

const hostPure = patcher.patchSource(hostFixture);
const adapterPure = patcher.patchSource(adapterFixture);
check('MCH3 both exact runtime edits apply to the CLI renderer',
  hostPure.applied.length === 2 && hostPure.missing.length === 0 && patcher.isPatched(hostPure.next));
check('MCH4 both exact runtime edits apply to the host adapter',
  adapterPure.applied.length === 2 && adapterPure.missing.length === 0 && patcher.isPatched(adapterPure.next));
check('MCH5 both transforms have byte-exact inverses',
  patcher.reverseSource(hostPure.next) === hostFixture
    && patcher.reverseSource(adapterPure.next) === adapterFixture);
check('MCH6 patching is idempotent',
  patcher.patchSource(hostPure.next).next === hostPure.next
    && patcher.patchSource(adapterPure.next).next === adapterPure.next);

const drifted = hostFixture.replace('            return [', '            return Array.from([');
const drift = patcher.patchSource(drifted);
check('MCH7 a missing renderer anchor is loud and atomic',
  drift.missing.includes('host-renderer')
    && composeSource(drifted, ['metaharness-codex-hooks']) === drifted);
const ambiguous = hostFixture.replace('export function hostConfigFiles', 'export function other') + hostFixture;
const duplicate = patcher.patchSource(ambiguous);
check('MCH8 duplicate anchors are ambiguous and atomically refused',
  duplicate.missing.some((item) => item.includes('AMBIGUOUS'))
    && composeSource(ambiguous, ['metaharness-codex-hooks']) === ambiguous);

const hostRuntime = path.join(SANDBOX, 'host-runtime.mjs');
const adapterRuntime = path.join(SANDBOX, 'adapter-runtime.mjs');
fs.writeFileSync(hostRuntime, hostPure.next);
fs.writeFileSync(adapterRuntime, adapterPure.next);
const hostApi = await import(`${pathToFileURL(hostRuntime).href}?host`);
const adapterApi = await import(`${pathToFileURL(adapterRuntime).href}?adapter`);
const base = { name: 'demo', description: 'Demo', mcp: 'off' };
check('MCH9 hook-free CLI scaffolds do not gain invented hook files',
  hostApi.hostConfigFiles('codex', base).every((file) => !file.path.includes('hooks')));
check('MCH10 hook-free adapter scaffolds do not gain invented hook files',
  !Object.keys(adapterApi.default.generateConfig(base)).some((file) => file.includes('hooks')));

const hooks = [
  { event: 'PreToolUse', matcher: 'Bash(rm *)', handler: 'block-rm' },
  { event: 'PostToolUse', matcher: 'Write(*)', handler: 'record-write' },
  { event: 'Stop', handler: 'checkpoint' },
];
const generated = hostApi.hostConfigFiles('codex', { ...base, hooks });
const generatedMap = Object.fromEntries(generated.map((file) => [file.path, file.content]));
const manifest = JSON.parse(generatedMap['.codex/hooks.json']);
check('MCH11 declared hooks emit only strict top-level manifest keys',
  JSON.stringify(Object.keys(manifest).sort()) === JSON.stringify(['description', 'hooks']));
check('MCH12 Bash inner matchers become a native tool regex plus bridge predicate',
  manifest.hooks.PreToolUse[0].matcher === '^Bash$'
    && manifest.hooks.PreToolUse[0].hooks[0].type === 'command');
check('MCH13 write aliases include Codex apply_patch without dropping host aliases',
  manifest.hooks.PostToolUse[0].matcher === '^(?:Write|Edit|apply_patch)$');
check('MCH14 matcher-less lifecycle hooks stay matcher-less',
  !Object.hasOwn(manifest.hooks.Stop[0], 'matcher'));
check('MCH15 adapter output uses the identical manifest and bridge bytes', (() => {
  const output = adapterApi.default.generateConfig({ ...base, hooks });
  return output['.codex/hooks.json'] === generatedMap['.codex/hooks.json']
    && output['.codex/hooks/metaharness-hook.cjs'] === generatedMap['.codex/hooks/metaharness-hook.cjs'];
})());
check('MCH16 unsupported events fail instead of disappearing', (() => {
  try { hostApi.hostConfigFiles('codex', { ...base, hooks: [{ event: 'FileChanged', handler: 'x' }] }); }
  catch (error) { return error.message.includes('unsupported Codex hook event'); }
  return false;
})());
check('MCH17 non-command handler kinds fail explicitly', (() => {
  try { hostApi.hostConfigFiles('codex', { ...base, hooks: [{ event: 'Stop', handler: 'prompt:hello' }] }); }
  catch (error) { return error.message.includes('command hook handlers only'); }
  return false;
})());
check('MCH18 traversal-shaped helper names fail at generation', (() => {
  try { hostApi.hostConfigFiles('codex', { ...base, hooks: [{ event: 'Stop', handler: '../escape' }] }); }
  catch (error) { return error.message.includes('plain .codex/helpers handler name'); }
  return false;
})());

const project = path.join(SANDBOX, 'project');
for (const [relative, content] of Object.entries(generatedMap)) {
  const file = path.join(project, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
const helpers = path.join(project, '.codex', 'helpers');
fs.mkdirSync(helpers, { recursive: true });
const decision = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'blocked by fixture' } };
fs.writeFileSync(path.join(helpers, 'block-rm.cjs'), `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify(decision))}));\n`);
const nested = path.join(project, 'src', 'deep');
fs.mkdirSync(nested, { recursive: true });
const command = manifest.hooks.PreToolUse[0].hooks[0].command;
const runHook = (commandLine, input) => spawnSync(commandLine, {
  cwd: nested, shell: true, input: `${JSON.stringify(input)}\n`, encoding: 'utf8',
});
const matching = runHook(command, { hook_event_name: 'PreToolUse', cwd: nested, tool_name: 'Bash', tool_input: { command: 'rm -rf tmp' } });
check(`MCH19 a nested-cwd invocation resolves the project helper: ${matching.stderr}`,
  matching.status === 0 && JSON.parse(matching.stdout).hookSpecificOutput.permissionDecision === 'deny');
const nonmatching = runHook(command, { hook_event_name: 'PreToolUse', cwd: nested, tool_name: 'Bash', tool_input: { command: 'ls -la' } });
check('MCH20 the inner command predicate skips a nonmatching Bash invocation',
  nonmatching.status === 0 && nonmatching.stdout === '');

const realHelpers = path.join(project, '.codex', 'helpers-real');
fs.renameSync(helpers, realHelpers);
fs.symlinkSync('helpers-real', helpers, 'dir');
const symlinked = runHook(command, { hook_event_name: 'PreToolUse', cwd: nested, tool_name: 'Bash', tool_input: { command: 'rm -rf tmp' } });
check('MCH21 a symlinked helper directory is refused before handler execution',
  symlinked.status === 2 && symlinked.stderr.includes('non-symlink directory'));
fs.rmSync(helpers);
fs.renameSync(realHelpers, helpers);

const mutatedBridge = generatedMap['.codex/hooks/metaharness-hook.cjs']
  .replace("if (!glob(spec.inner, subject)) process.exit(0);", "if (false) process.exit(0);");
fs.writeFileSync(path.join(project, '.codex', 'hooks', 'metaharness-hook.cjs'), mutatedBridge);
const mutation = runHook(command, { hook_event_name: 'PreToolUse', cwd: nested, tool_name: 'Bash', tool_input: { command: 'ls -la' } });
check('MCH22 mutation proof catches removal of the inner matcher enforcement',
  mutation.status === 0 && mutation.stdout !== '');
fs.writeFileSync(path.join(project, '.codex', 'hooks', 'metaharness-hook.cjs'), generatedMap['.codex/hooks/metaharness-hook.cjs']);

const applied = applyComposed(['metaharness-codex-hooks']);
check('MCH23 every authenticated package copy patches atomically',
  !applied.errors && !applied.incomplete && applied.patched === discovered.length);
const status = statusComposed()['metaharness-codex-hooks'];
check('MCH24 status proves every discovered package copy',
  status.files === discovered.length && status.patched === discovered.length);
check('MCH25 vendor pristine backups are exact',
  fs.readFileSync(`${hostFile}.rsp-backup`, 'utf8') === hostFixture
    && fs.readFileSync(`${adapterFile}.rsp-backup`, 'utf8') === adapterFixture);
const restored = reconcile([], ['metaharness-codex-hooks']);
check('MCH26 uninstall restores every claimed file byte-for-byte',
  restored.restored === discovered.length && !restored.errors && !restored.unresolved
    && fs.readFileSync(hostFile, 'utf8') === hostFixture
    && fs.readFileSync(adapterFile, 'utf8') === adapterFixture);

fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}\n');
const runCli = (...args) => spawnSync(process.execPath, [path.resolve('bin/cli.mjs'), ...args], {
  env: process.env, encoding: 'utf8',
});
const installed = runCli('metaharness-codex-hooks', 'install');
check(`MCH27 public CLI installs and tracks the target: ${installed.stderr}`,
  installed.status === 0 && installed.stdout.includes('re-applied on session start and by the monitor'));
const cliStatus = runCli('metaharness-codex-hooks', 'status');
check('MCH28 public CLI reports every copy patched and tracked',
  cliStatus.status === 0 && cliStatus.stdout.includes(`${discovered.length}/${discovered.length} file(s) patched`)
    && cliStatus.stdout.includes('tracked'));
const removed = runCli('metaharness-codex-hooks', 'uninstall');
check('MCH29 public CLI restores the target cleanly',
  removed.status === 0 && removed.stdout.includes(`restored ${discovered.length} file(s)`));

console.log('✔ MetaHarness Codex hooks (#168 strict renderer, matcher bridge, bounded discovery, mutation proof, exact restore)');
