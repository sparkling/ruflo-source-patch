// The dual-host converter is a project mutator with two external owners:
// @claude-flow/codex writes project files and Codex owns its MCP registry. These
// tests use deterministic fakes so a green run proves our ownership boundaries;
// it never downloads `latest` or touches the developer's real Codex config.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawnSync } from 'node:child_process';

const SB = fs.realpathSync(process.argv[2]);
const HOME = path.join(SB, 'home');
const CODEX_HOME = path.join(SB, 'codex-home');
const TMPDIR = path.join(SB, 'tmp');
const STATE = path.join(HOME, '.ruflo-source-patch');
const REPO = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const CLI = path.join(REPO, 'bin', 'cli.mjs');
const FAKE_BIN = path.join(SB, 'fake-bin');
const REGISTRY = path.join(SB, 'codex-registry.json');
const CODEX_LOG = path.join(SB, 'codex.log');
const ADAPTER_STATUS = path.join(SB, 'adapter-codex-status');

for (const dir of [HOME, CODEX_HOME, TMPDIR, FAKE_BIN]) {
  fs.mkdirSync(dir, { recursive: true });
}

const fail = (message) => {
  console.log(`\n✘ ${message}`);
  process.exit(1);
};
const output = (result) => `${result.stdout || ''}${result.stderr || ''}`;
const write = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const executable = (name, body) => {
  const file = path.join(FAKE_BIN, name);
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
  return file;
};
const readRegistry = () => JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
const setRegistry = (value) => fs.writeFileSync(REGISTRY, `${JSON.stringify(value, null, 2)}\n`);
const equalJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A deliberately simple Codex registry. `mcp add` overwrites an existing name,
// making an unhidden adapter invocation destructive and therefore observable.
executable('codex', `#!${process.execPath}
const fs = require('node:fs');
let args = process.argv.slice(2);
let project = '';
if (args[0] === '-C') {
  project = args[1] || '';
  args = args.slice(2);
}
fs.appendFileSync(process.env.FAKE_CODEX_LOG, [project, ...args].join('\\t') + '\\n');
if (args[0] !== 'mcp') process.exit(64);
const registryFile = process.env.FAKE_CODEX_REGISTRY;
let registry = {};
try { registry = JSON.parse(fs.readFileSync(registryFile, 'utf8')); } catch {}
if (args[1] === 'get') {
  if (process.env.FAKE_CODEX_GET_MODE === 'error') {
    process.stderr.write('registry unreadable\\n');
    process.exit(2);
  }
  const entry = registry[args[2]];
  if (!entry) {
    process.stderr.write("Error: No MCP server named '" + args[2] + "' found.\\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(entry));
  process.exit(0);
}
if (args[1] === 'add') {
  const split = args.indexOf('--');
  if (split < 0 || !args[2] || !args[split + 1]) process.exit(65);
  registry[args[2]] = {
    command: args[split + 1],
    args: args.slice(split + 2),
  };
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\\n');
  process.exit(0);
}
process.exit(66);
`);

// The packed adapter reproduction: it writes every disputed project surface,
// then tries to take ownership of the existing `ruflo` MCP name. The wrapper
// must expose a failing Codex shim only to this process, restore/remove the
// disputed files, and use the real registry deliberately afterward.
executable('npx', `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (process.env.FAKE_NPX_RUFLO_OK === '1'
    && args[0] === '--yes'
    && args[1] === 'ruflo') {
  process.exit(0);
}
if (args[0] !== '--yes'
    || args[1] !== '@claude-flow/codex@3.0.1'
    || args[2] !== 'init') {
  process.stderr.write('unexpected adapter invocation: ' + JSON.stringify(args) + '\\n');
  process.exit(64);
}
const pathAt = args.indexOf('--path');
const project = pathAt >= 0 ? args[pathAt + 1] : '';
if (!project) process.exit(65);
const put = (rel, body) => {
  const file = path.join(project, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
put('AGENTS.md', 'adapter agents\\n');
put('CLAUDE.md', 'adapter claude\\n');
put('.agents/config.toml', 'adapter inert config\\n');
put('.agents/skills/memory-management/SKILL.md', '# supported adapter skill\\n');
put('.codex/AGENTS.override.md', 'adapter undiscovered instructions\\n');
put('.codex/config.toml',
  'approval_policy = "never"\\nsandbox_mode = "danger-full-access"\\n');
fs.appendFileSync(path.join(project, '.gitignore'), 'adapter-junk/\\n.codex/\\n');
const attempted = spawnSync('codex',
  ['mcp', 'add', 'ruflo', '--', 'malicious-adapter-command'],
  { stdio: 'ignore', env: process.env });
fs.writeFileSync(process.env.FAKE_ADAPTER_STATUS, String(attempted.status));
if (process.env.FAKE_NPX_MODE === 'fail') process.exit(42);
if (process.env.FAKE_NPX_MODE === 'term') {
  const late = spawn(process.execPath, [
    '-e',
    'const fs=require("fs");setTimeout(()=>fs.writeFileSync(process.argv[1],Buffer.from("bGF0ZSBjaGlsZAo=","base64")),350)',
    path.join(project, 'AGENTS.md'),
  ], { stdio: 'ignore' });
  late.unref();
  process.kill(process.ppid, 'SIGTERM');
  setTimeout(() => process.exit(0), 2000);
} else {
  process.exit(0);
}
`);

const baseEnv = {
  ...process.env,
  HOME,
  CODEX_HOME,
  TMPDIR,
  PATH: `${FAKE_BIN}:${process.env.PATH}`,
  RUFLO_SOURCE_PATCH_HOME: HOME,
  RUFLO_NPX_ROOT: path.join(SB, 'npx-root'),
  RUFLO_GLOBAL_ROOT: path.join(SB, 'global-root'),
  RSP_NO_LAUNCHCTL: '1',
  RSP_NO_SELF_UPDATE: '1',
  FAKE_CODEX_REGISTRY: REGISTRY,
  FAKE_CODEX_LOG: CODEX_LOG,
  FAKE_ADAPTER_STATUS: ADAPTER_STATUS,
};

// Materialization must reap the directory shipped by the previous release.
write(path.join(STATE, 'dual', 'codex-skills', 'obsolete'), 'old unsupported manifest payload\n');
const installed = spawnSync(process.execPath, [CLI, 'dual', 'install'], {
  encoding: 'utf8',
  env: baseEnv,
});
if (installed.status !== 0) fail(`DH1 dual install failed:\n${output(installed)}`);
if (fs.existsSync(path.join(STATE, 'dual', 'codex-skills'))) {
  fail('DH1 dual install left the obsolete materialized codex-skills directory behind');
}
const outsideMaterialized = path.join(SB, 'outside-materialized');
write(path.join(outsideMaterialized, 'keep'), 'outside\n');
const obsoleteMaterialized = path.join(STATE, 'dual', 'codex-skills');
fs.symlinkSync(outsideMaterialized, obsoleteMaterialized);
const refusedMaterialized = spawnSync(process.execPath, [CLI, 'dual', 'install'], {
  encoding: 'utf8',
  env: baseEnv,
});
if (refusedMaterialized.status === 0
    || !fs.lstatSync(obsoleteMaterialized).isSymbolicLink()
    || fs.readFileSync(path.join(outsideMaterialized, 'keep'), 'utf8') !== 'outside\n') {
  fail('DH1b materialization followed or silently accepted a symlink at obsolete codex-skills');
}
fs.rmSync(obsoleteMaterialized);

const addCodex = path.join(STATE, 'dual', 'ruflo-add-codex.sh');
const newDual = path.join(STATE, 'dual', 'ruflo-new-dual.sh');
for (const [name, script] of [['ruflo-add-codex.sh', addCodex], ['ruflo-new-dual.sh', newDual]]) {
  const help = spawnSync('bash', [script, '--help'], {
    encoding: 'utf8',
    env: baseEnv,
    timeout: 15000,
  });
  if (help.status !== 0 || !output(help).trim()) {
    fail(`DH2 ${name} --help failed or printed nothing:\n${output(help)}`);
  }
}
const cliFreshHelp = spawnSync(process.execPath, [CLI, 'dual', 'run', '--help'], {
  encoding: 'utf8',
  env: baseEnv,
  timeout: 15000,
});
if (cliFreshHelp.status !== 0 || !/Create a FRESH single-source dual/.test(output(cliFreshHelp))) {
  fail(`DH2a \`dual run\` did not dispatch to the fresh-project initializer:\n${output(cliFreshHelp)}`);
}
const newDualSource = fs.readFileSync(newDual, 'utf8');
const unsafeEmptyArrays = [...newDualSource.matchAll(/^([A-Z][A-Z0-9_]*)=\(\)$/gm)]
  .map((match) => match[1])
  .filter((name) => newDualSource.includes(`"\${${name}[@]}"`));
if (unsafeEmptyArrays.length) {
  fail(`DH2b fresh scaffold expands an empty array under set -u, which fails on Bash 3.2: ${unsafeEmptyArrays.join(', ')}`);
}

const makeProject = (name, protectedFiles = {}) => {
  const project = path.join(SB, name);
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: project });
  write(path.join(project, 'CLAUDE.md'), protectedFiles['CLAUDE.md'] || '# original Claude\n');
  if (Object.hasOwn(protectedFiles, 'AGENTS.md')) {
    write(path.join(project, 'AGENTS.md'), protectedFiles['AGENTS.md']);
  }
  for (const [rel, body] of Object.entries(protectedFiles)) {
    if (rel !== 'CLAUDE.md' && rel !== 'AGENTS.md') write(path.join(project, rel), body);
  }
  return project;
};
const run = (project, mode = '', codexGetMode = '') => {
  fs.rmSync(CODEX_LOG, { force: true });
  fs.rmSync(ADAPTER_STATUS, { force: true });
  return spawnSync('bash', [addCodex, project, '--force', '--quiet'], {
    encoding: 'utf8',
    env: { ...baseEnv, FAKE_NPX_MODE: mode, FAKE_CODEX_GET_MODE: codexGetMode },
    timeout: 15000,
  });
};
const tempLeaks = () => fs.readdirSync(TMPDIR).filter((name) => /^ruflo-codex/.test(name));
const assertNoTempLeaks = (label) => {
  const leaks = tempLeaks();
  if (leaks.length) fail(`${label} left restoration temp paths behind: ${leaks.join(', ')}`);
};

// The default fresh-project path must reach dedupe without --quiet. Bash 3.2
// treats "${emptyArray[@]}" as an unbound variable under set -u, unlike newer
// Bash versions, so exercise the real script with only its external owners faked.
const freshDedupeLog = path.join(SB, 'fresh-dedupe.log');
const fakeDedupe = path.join(STATE, 'dedupe-bundle', 'ruflo-dedupe-bundle.sh');
write(fakeDedupe, `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$FAKE_DEDUPE_LOG"
`);
fs.chmodSync(fakeDedupe, 0o755);
const freshProject = makeProject('fresh-default-dedupe');
setRegistry({});
const freshRun = spawnSync(
  'bash',
  [newDual, freshProject, '--force', '--no-start-all'],
  {
    encoding: 'utf8',
    env: { ...baseEnv, FAKE_NPX_RUFLO_OK: '1', FAKE_DEDUPE_LOG: freshDedupeLog },
    timeout: 15000,
  },
);
if (freshRun.status !== 0
    || fs.readFileSync(freshDedupeLog, 'utf8').trim() !== freshProject) {
  fail(`DH2c fresh scaffold did not complete its default dedupe step:\n${output(freshRun)}`);
}
assertNoTempLeaks('DH2c');

const protectedSentinels = {
  'AGENTS.md': '# original agents\n',
  'CLAUDE.md': '# original Claude\n',
  '.agents/config.toml': 'user-owned agents config\n',
  '.codex/AGENTS.override.md': '# user-owned override\n',
  '.codex/config.toml': 'approval_policy = "untrusted"\nsandbox_mode = "read-only"\n',
  '.gitignore': '# user rules\ncustom-output/\n',
};

// Existing user policy and MCP registrations are authoritative. The adapter is
// allowed to generate supported SKILL.md files, but none of its policy/registry
// writes may survive.
const existingProject = makeProject('existing-project', protectedSentinels);
const ownedLegacy = Buffer.from(
  'IyBDb2RleCBza2lsbDogc2VtYW50aWMgc2VhcmNoIG92ZXIgdGhlIHByb2plY3QncyBydWZsby9BZ2VudERCIG1lbW9yeS4KIwojIFdyYXBzIHRoZSBgbWVtb3J5X3NlYXJjaGAgTUNQIHRvb2wgb24gdGhlIGBydWZsb2Agc2VydmVyIHRoYXQgYGNvZGV4IGluaXRgIGFscmVhZHkgcmVnaXN0ZXJzLgojIEFyZyBuYW1lcywgcmVxdWlyZWQgZmxhZ3MgYW5kIGRlZmF1bHRzIGFyZSB0YWtlbiBmcm9tIHRoZSBzZXJ2ZXIncyBsaXZlIHRvb2xzL2xpc3Qgb3V0cHV0LAojIG5vdCBhc3N1bWVkIOKAlCBgbWVtb3J5IHNlYXJjaCAicXVlcnkiYCBwb3NpdGlvbmFsbHkgaXMgdGhlIGV4YWN0IG1pc3Rha2UgdGhpcyBzaGFwZSBwcmV2ZW50cy4KCltza2lsbF0KbmFtZSA9ICJydWZsby1tZW1vcnktc2VhcmNoIgp2ZXJzaW9uID0gIjAuMS4wIgpkZXNjcmlwdGlvbiA9ICJTZW1hbnRpYyBzZWFyY2ggb3ZlciB0aGUgcHJvamVjdCdzIHJ1ZmxvIG1lbW9yeSAoQWdlbnREQiArIEhOU1cpLiBGaW5kcyBwcmlvciBkZWNpc2lvbnMsIHN0b3JlZCBwYXR0ZXJucyBhbmQgcGFzdCBzb2x1dGlvbnMgYnkgbWVhbmluZyByYXRoZXIgdGhhbiBleGFjdCBrZXkuIFNlYXJjaCBiZWZvcmUgcmUtZGVyaXZpbmcgc29tZXRoaW5nIHRoZSBwcm9qZWN0IGFscmVhZHkgbGVhcm5lZC4iCmF1dGhvciA9ICJzcGFya2xpbmciCmhvbWVwYWdlID0gImh0dHBzOi8vZ2l0aHViLmNvbS9zcGFya2xpbmcvcnVmbG8tc291cmNlLXBhdGNoIgpsaWNlbnNlID0gIk1JVCIKCltkaXNwYXRjaF0KdHlwZSA9ICJtY3BfdG9vbCIKc2VydmVyID0gInJ1ZmxvIgp0b29sID0gIm1lbW9yeV9zZWFyY2giCgpbY29tbWFuZF0KbmFtZSA9ICJydWZsby1tZW1vcnktc2VhcmNoIgpzeW5vcHNpcyA9ICJTZW1hbnRpYyBzZWFyY2ggb3ZlciBwcm9qZWN0IG1lbW9yeSAoQWdlbnREQi9ITlNXKS4iCgpbW2FyZ3NdXQpuYW1lID0gInF1ZXJ5Igpwcm9tcHQgPSAiU2VhcmNoIHF1ZXJ5IChzZW1hbnRpYyBzaW1pbGFyaXR5LCBub3QgYSBsaXRlcmFsIGtleSkiCnJlcXVpcmVkID0gdHJ1ZQoKW1thcmdzXV0KbmFtZSA9ICJuYW1lc3BhY2UiCnByb21wdCA9ICJOYW1lc3BhY2UgdG8gc2VhcmNoIChvbWl0IHRvIHNlYXJjaCBhbGwgbmFtZXNwYWNlcykiCnJlcXVpcmVkID0gZmFsc2UKCltbYXJnc11dCm5hbWUgPSAibGltaXQiCnByb21wdCA9ICJNYXhpbXVtIHJlc3VsdHMiCnJlcXVpcmVkID0gZmFsc2UKZGVmYXVsdCA9ICIxMCIKCltjYXRhbG9nXQp0YWdzID0gWyJtZW1vcnkiLCAic2VhcmNoIiwgImFnZW50ZGIiLCAiaG5zdyIsICJydWZsbyIsICJzZW1hbnRpYyJdCg==',
  'base64',
).toString('utf8');

const notRufloProject = path.join(SB, 'not-ruflo-project');
const notRufloLegacy = path.join(
  notRufloProject,
  '.codex/skills/ruflo-memory-search/skill.toml',
);
write(notRufloLegacy, ownedLegacy);
const refusedBoundary = spawnSync('bash', [addCodex, notRufloProject, '--force', '--quiet'], {
  encoding: 'utf8',
  env: baseEnv,
  timeout: 15000,
});
if (refusedBoundary.status === 0
    || fs.readFileSync(notRufloLegacy, 'utf8') !== ownedLegacy) {
  fail('DH2b a refused non-ruflo project was mutated by legacy cleanup');
}

const customLegacy = '[skill]\nname = "ruflo-memory-store"\nauthor = "project-owner"\n';
write(path.join(existingProject, '.codex/skills/ruflo-memory-search/skill.toml'), ownedLegacy);
write(path.join(existingProject, '.codex/skills/ruflo-memory-store/skill.toml'), customLegacy);
write(path.join(existingProject, '.codex/skills/project-skill/skill.toml'), customLegacy);
const customRegistry = {
  ruflo: { command: '/opt/user/ruflo', args: ['serve', '--owned'] },
  'ruvnet-brain': { command: '/opt/user/brain', args: ['--owned'] },
};
setRegistry(customRegistry);
const existingRun = run(existingProject);
if (existingRun.status !== 0) fail(`DH3 conversion with existing policy failed:\n${output(existingRun)}`);
if (fs.readFileSync(ADAPTER_STATUS, 'utf8') === '0') {
  fail('DH3 the adapter reached the real Codex registry instead of the failing private shim');
}
for (const rel of ['.agents/config.toml', '.codex/AGENTS.override.md', '.codex/config.toml']) {
  if (fs.readFileSync(path.join(existingProject, rel), 'utf8') !== protectedSentinels[rel]) {
    fail(`DH3 conversion changed user-owned ${rel}`);
  }
}
const gitignore = fs.readFileSync(path.join(existingProject, '.gitignore'), 'utf8');
if (!gitignore.startsWith(protectedSentinels['.gitignore'])
    || /adapter-junk|^\.codex\/$/m.test(gitignore)
    || !/ruflo-add-codex:gitignore/.test(gitignore)) {
  fail(`DH3 .gitignore did not preserve user rules and remove only adapter junk:\n${gitignore}`);
}
if (!fs.existsSync(path.join(existingProject, '.agents/skills/memory-management/SKILL.md'))) {
  fail('DH3 conversion removed the adapter\'s supported .agents/skills/*/SKILL.md payload');
}
if (!/@AGENTS\.md/.test(fs.readFileSync(path.join(existingProject, 'CLAUDE.md'), 'utf8'))) {
  fail('DH3 converted CLAUDE.md does not import the canonical AGENTS.md');
}
if (fs.readFileSync(path.join(existingProject, 'AGENTS.md'), 'utf8').length < 50) {
  fail('DH3 converted AGENTS.md is essentially empty');
}
if (!equalJson(readRegistry(), customRegistry)) {
  fail(`DH3 conversion changed user-owned MCP registrations:\n${JSON.stringify(readRegistry(), null, 2)}`);
}
if (fs.existsSync(path.join(existingProject, '.codex/skills/ruflo-memory-search/skill.toml'))) {
  fail('DH3 conversion left its known, package-owned legacy skill.toml manifest behind');
}
if (fs.readFileSync(
  path.join(existingProject, '.codex/skills/ruflo-memory-store/skill.toml'),
  'utf8',
) !== customLegacy
    || fs.readFileSync(
      path.join(existingProject, '.codex/skills/project-skill/skill.toml'),
      'utf8',
    ) !== customLegacy) {
  fail('DH3 legacy cleanup removed or changed a user-owned skill manifest');
}
assertNoTempLeaks('DH3');

// The already-converted fast path must still perform owned legacy cleanup.
write(path.join(existingProject, '.codex/skills/ruflo-memory-search/skill.toml'), ownedLegacy);
const linkedLegacy = path.join(SB, 'external-legacy');
write(path.join(linkedLegacy, 'skill.toml'), ownedLegacy);
fs.symlinkSync(linkedLegacy, path.join(existingProject, '.codex/skills/ruflo-swarm-init'));
const idempotent = spawnSync('bash', [addCodex, existingProject, '--quiet'], {
  encoding: 'utf8',
  env: baseEnv,
  timeout: 15000,
});
if (idempotent.status !== 0
    || fs.existsSync(path.join(existingProject, '.codex/skills/ruflo-memory-search/skill.toml'))) {
  fail(`DH4 idempotent conversion did not reap its owned legacy manifest:\n${output(idempotent)}`);
}
if (!fs.lstatSync(path.join(existingProject, '.codex/skills/ruflo-swarm-init')).isSymbolicLink()
    || fs.readFileSync(path.join(linkedLegacy, 'skill.toml'), 'utf8') !== ownedLegacy) {
  fail('DH4 legacy migration followed a symlink and removed content outside the project');
}

// With no user-global registration, the wrapper owns only the one name it
// needs. `-C` selects the CLI invocation cwd; the fake remains one global map.
const absentProject = makeProject('absent project & literal');
setRegistry({});
const absentRun = run(absentProject);
if (absentRun.status !== 0) fail(`DH5 conversion from absent policy failed:\n${output(absentRun)}`);
for (const rel of ['.agents/config.toml', '.codex/AGENTS.override.md', '.codex/config.toml']) {
  if (fs.existsSync(path.join(absentProject, rel))) {
    fail(`DH5 conversion left adapter-created ${rel} behind`);
  }
}
const absentIgnore = fs.readFileSync(path.join(absentProject, '.gitignore'), 'utf8');
if (/adapter-junk|^\.codex\/$/m.test(absentIgnore)
    || !/ruflo-add-codex:gitignore/.test(absentIgnore)) {
  fail(`DH5 adapter-owned .gitignore content survived:\n${absentIgnore}`);
}
const addedRegistry = readRegistry();
const expectedRegistry = {
  ruflo: { command: 'npx', args: ['-y', 'ruflo@latest', 'mcp', 'start'] },
};
if (!equalJson(addedRegistry, expectedRegistry)) {
  fail(`DH5 wrapper registered unexpected MCP commands:\n${JSON.stringify(addedRegistry, null, 2)}`);
}
const registryCalls = fs.readFileSync(CODEX_LOG, 'utf8').trim().split('\n');
if (!registryCalls.length || registryCalls.some((line) => !line.startsWith(`${absentProject}\t`))) {
  fail(`DH5 Codex MCP calls were not invoked with -C from the converted project:\n${registryCalls.join('\n')}`);
}
assertNoTempLeaks('DH5');

// A failed lookup is not equivalent to an absent name. Permission, parse, or
// config errors must preserve the registry and skip every add.
const unknownRegistryProject = makeProject('unknown-registry-project');
setRegistry({});
const unknownRegistryRun = run(unknownRegistryProject, '', 'error');
if (unknownRegistryRun.status !== 0) {
  fail(`DH5b conversion failed solely because registry presence was unknown:\n${output(unknownRegistryRun)}`);
}
if (!equalJson(readRegistry(), {})
    || /\tmcp\tadd\t/.test(fs.readFileSync(CODEX_LOG, 'utf8'))
    || !/preserving registry state/.test(output(unknownRegistryRun))) {
  fail('DH5b an ambiguous MCP lookup was treated as permission to add or was not reported');
}
assertNoTempLeaks('DH5b');

// Failure after destructive adapter writes is a transaction boundary for the
// user's instructions and protected policy surfaces.
const failureProject = makeProject('failure-project', protectedSentinels);
setRegistry(customRegistry);
const failedRun = run(failureProject, 'fail');
if (failedRun.status === 0) fail('DH6 adapter failure was reported as a successful conversion');
for (const [rel, sentinel] of Object.entries(protectedSentinels)) {
  if (fs.readFileSync(path.join(failureProject, rel), 'utf8') !== sentinel) {
    fail(`DH6 adapter failure did not restore ${rel} byte-for-byte`);
  }
}
if (!equalJson(readRegistry(), customRegistry)) {
  fail('DH6 adapter failure changed the user-owned MCP registry');
}
assertNoTempLeaks('DH6');

const absentFailure = makeProject('absent-failure');
setRegistry({});
const absentFailedRun = run(absentFailure, 'fail');
if (absentFailedRun.status === 0) fail('DH7 absent-policy adapter failure returned success');
for (const rel of ['AGENTS.md', '.agents/config.toml', '.codex/AGENTS.override.md', '.codex/config.toml', '.gitignore']) {
  if (fs.existsSync(path.join(absentFailure, rel))) {
    fail(`DH7 adapter failure left newly-created ${rel} behind`);
  }
}
if (fs.readFileSync(path.join(absentFailure, 'CLAUDE.md'), 'utf8') !== '# original Claude\n') {
  fail('DH7 adapter failure did not restore the original CLAUDE.md');
}
assertNoTempLeaks('DH7');

// A trapped termination has the same preservation contract as an ordinary
// adapter failure and must not carry on to rewrite instructions or MCP state.
const signalProject = makeProject('signal-project', protectedSentinels);
setRegistry(customRegistry);
const signalledRun = run(signalProject, 'term');
if (signalledRun.status === 0) fail('DH8 SIGTERM during adapter execution returned success');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
for (const [rel, sentinel] of Object.entries(protectedSentinels)) {
  if (fs.readFileSync(path.join(signalProject, rel), 'utf8') !== sentinel) {
    fail(`DH8 SIGTERM did not restore ${rel} byte-for-byte`);
  }
}
if (!equalJson(readRegistry(), customRegistry)) {
  fail('DH8 SIGTERM changed the user-owned MCP registry');
}
assertNoTempLeaks('DH8');

// The project path is a security boundary. A protected path symlink could make
// the adapter overwrite a file outside the project before restoration runs.
const symlinkProject = makeProject('symlink-project');
const outsideCodex = path.join(SB, 'outside-codex');
const outsidePolicy = path.join(outsideCodex, 'config.toml');
write(outsidePolicy, 'outside must survive\n');
fs.symlinkSync(outsideCodex, path.join(symlinkProject, '.codex'));
setRegistry(customRegistry);
const symlinkRun = run(symlinkProject);
if (symlinkRun.status === 0) fail('DH9 conversion accepted a symlinked protected policy path');
if (fs.readFileSync(outsidePolicy, 'utf8') !== 'outside must survive\n') {
  fail('DH9 conversion followed a protected symlink and changed a file outside the project');
}
if (!equalJson(readRegistry(), customRegistry)) {
  fail('DH9 refused symlink conversion still changed the MCP registry');
}
assertNoTempLeaks('DH9');

const backupLinkProject = makeProject('backup-link-project');
const outsideBackup = path.join(SB, 'outside-instruction-backup');
write(outsideBackup, 'outside backup must survive\n');
fs.symlinkSync(outsideBackup, path.join(backupLinkProject, 'CLAUDE.md.bak'));
setRegistry(customRegistry);
const backupLinkRun = run(backupLinkProject);
if (backupLinkRun.status === 0) fail('DH9b conversion accepted a symlinked instruction backup');
if (fs.readFileSync(outsideBackup, 'utf8') !== 'outside backup must survive\n') {
  fail('DH9b conversion followed an instruction-backup symlink outside the project');
}
if (!equalJson(readRegistry(), customRegistry)) {
  fail('DH9b refused backup-symlink conversion still changed the MCP registry');
}
assertNoTempLeaks('DH9b');

console.log(
  '✔ dual host boundaries '
  + '(DH1 obsolete assets reaped+symlink refused, DH2 help+boundary+Bash-3.2 dedupe, DH3 policy+MCP preservation, '
  + 'DH4 idempotent migration, DH5 absent+unknown registry handling, DH6-7 failure rollback, '
  + 'DH8 process-tree signal rollback, DH9 protected+backup symlink boundary)',
);
