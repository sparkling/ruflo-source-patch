// Behavioral coverage for the cache-local Codex command parity targets (#2821 / Brain #76).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SB = path.resolve(process.argv[2]);
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = path.join(SB, 'home');
const CODEX_HOME = path.join(HOME, '.codex');
const CACHE = path.join(CODEX_HOME, 'plugins', 'cache');
const BRAIN_SOURCE = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain', 'plugin');
const RUFLO_SOURCE = path.join(CODEX_HOME, '.tmp', 'marketplaces', 'ruflo', 'plugins', 'ruflo-core');
const FAKE_CODEX = path.join(SB, 'codex');
const FAKE_ROWS = path.join(SB, 'plugin-rows.json');
const FAKE_CALLS = path.join(SB, 'codex-calls.log');

process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.RSP_CODEX_HOME = CODEX_HOME;
process.env.RSP_CODEX_BIN = FAKE_CODEX;
process.env.RSP_FAKE_CODEX_CALLS = FAKE_CALLS;

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const occurrences = (src, needle) => src.split(needle).length - 1;

function write(file, body, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
  fs.chmodSync(file, mode);
}

function manifest(name, version) {
  return `${JSON.stringify({ name, version, description: 'fixture' }, null, 2)}\n`;
}

const rufloStatus = `---
name: ruflo-status
description: Show Ruflo system health, MCP server status, and active agents
---
$ARGUMENTS
Run diagnostics and show system status.
\`\`\`bash
npx @claude-flow/cli@latest doctor
npx @claude-flow/cli@latest status
\`\`\`
To auto-fix issues, run \`npx @claude-flow/cli@latest doctor --fix\` separately.
`;

const nativeRufloStatus = `---
name: ruflo-status
description: Diagnose Ruflo health without changing the installation
---

# Ruflo status

## Default read-only workflow

\`\`\`bash
npx @claude-flow/cli@latest doctor
npx @claude-flow/cli@latest status
\`\`\`

Do not repair, reset, start, stop, install, or otherwise change anything.

## Explicit repair workflow

Only when the user explicitly asks to fix or auto-repair the installation:

\`\`\`bash
npx @claude-flow/cli@latest doctor --fix
npx @claude-flow/cli@latest status
\`\`\`

Never infer authorization for repair from a request to diagnose.
`;

function nativeBrainConsole(name) {
  return `---
name: ${name}
description: Open the RuvNet Brain Console
updated: 2026-07-28
---

# Brain Console

1. Say one short sentence: "Opening it now; it scans live while you watch."
2. Resolve the installed runtime at
   \`\${RUVNET_BRAIN_KB:-$HOME/.cache/ruvnet-brain/kb}/.console-runtime/scripts/onboarding-console.mjs\`.
   Never fall back to a guessed \`~/Code\` path.
3. Run \`node <resolved-script> --serve --open\` in the background.
`;
}

const nativeWhatsNew = `---
name: whats-new
description: Explain what is new in the installed RuvNet Brain release
updated: 2026-07-28
---

# What is new

1. Read the installed plugin version from \`.codex-plugin/plugin.json\` relative to this skill's
   plugin root. If that is unavailable, read the current checkout's \`plugin/.codex-plugin/plugin.json\`.
2. Locate \`docs/RELEASE-NOTES-4.0.md\` in the current repository, then
   \`~/Code/ruvnet-brain/docs/RELEASE-NOTES-4.0.md\`. Read it before summarizing.
3. State the installed version exactly.
`;

const releasedWhatsNew = `---
name: whats-new
description: Explain what is new in the installed RuvNet Brain release
updated: 2026-07-28
---

# What is new

1. Run the installed plugin's \`scripts/whats-new.mjs\` executable. It reads the version manifest and
   curated notes from the same immutable plugin payload and exits nonzero if either asset is missing.
   Do not substitute a checkout, download, or another installed version when it fails.
2. Read that command's output before summarizing it.
3. State the installed version exactly.
4. Summarize only the curated highlights.

If the release notes are missing, say they are unavailable and do not fabricate a highlight.
`;

const releasedWhatsNewExecutable = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
const notes = path.join(root, 'docs', 'RELEASE-NOTES-4.0.md');
if (!fs.existsSync(notes)) { console.error('installed release notes are missing'); process.exit(1); }
process.stdout.write('RuvNet Brain ' + manifest.version + '\\n\\n' + fs.readFileSync(notes, 'utf8'));
`;

const rvbc = `---
description: "RvBC — RuvNet Brain Console. Opens the live console page."
updated: 2026-07-20
---

Launch the **RuvNet Brain Console** for the user.

## 2. Find the repo

Prefer \`~/Code/ruvnet-brain\`. If \`$CLAUDE_PLUGIN_ROOT\` is set, the repo may be its parent
directory. Use whichever path actually contains \`scripts/onboarding-console.mjs\`.

## 3. Start it in the BACKGROUND and open the browser

\`\`\`
node <repo>/scripts/onboarding-console.mjs --serve --open
\`\`\`
`;

const whatsNew = `---
description: "What's new in RuvNet Brain"
updated: 2026-07-25
---

# RuvNet-Brain: what's new

**First, ground — never recite this from memory (it drifts every release):**
1. Read the running version from \`\${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json\`. State it honestly.
2. Read \`docs/RELEASE-NOTES-4.0.md\` (the curated highlights + its VERSION STATUS banner). Its content is
the source of truth.

If they say yes, follow \`rvbc.md\` in this same directory exactly (including the
warm heads-up about the ~20s scan).
`;

function aliasCommand(name) {
  return `---
description: "${name} Console alias"
updated: 2026-07-20
---

Open the Brain Console from
\`\${RUVNET_BRAIN_KB:-$HOME/.cache/ruvnet-brain/kb}/.console-runtime/scripts/onboarding-console.mjs\`.
`;
}

function parseCommand(src) {
  const match = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const raw = match[1].match(/^description:\s*(.+)$/m)[1];
  return {
    description: raw.startsWith('"') ? JSON.parse(raw) : raw,
    body: match[2].trim(),
  };
}

function migrated(name, source) {
  const parsed = parseCommand(source);
  return `---
name: "source-command-${name}"
description: ${JSON.stringify(parsed.description)}
---

# source-command-${name}

Use this skill when the user asks to run the migrated source command \`${name}\`.

## Command Template

${parsed.body}
`;
}

function row(pluginId, name, marketplaceName, version, source) {
  return {
    pluginId, name, marketplaceName, version, installed: true, enabled: true,
    source: { source: 'local', path: source },
  };
}

function setRows(rufloVersion = '0.2.4', brainVersion = '3.9.128-dev') {
  write(FAKE_ROWS, `${JSON.stringify({
    installed: [
      row('ruflo-core@ruflo', 'ruflo-core', 'ruflo', rufloVersion, RUFLO_SOURCE),
      row('ruvnet-brain@ruvnet-brain', 'ruvnet-brain', 'ruvnet-brain', brainVersion, BRAIN_SOURCE),
    ],
    available: [],
  }, null, 2)}\n`);
}

function seedPlugin({ marketplace, name, version, source, commands }) {
  const root = path.join(CACHE, marketplace, name, version);
  write(path.join(root, '.claude-plugin', 'plugin.json'), manifest(name, version));
  write(path.join(source, '.claude-plugin', 'plugin.json'), manifest(name, version));
  for (const [command, body] of Object.entries(commands)) {
    write(path.join(root, 'commands', `${command}.md`), body);
  }
  return root;
}

function seed() {
  fs.rmSync(SB, { recursive: true, force: true });
  write(FAKE_CODEX, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(process.env.RSP_FAKE_CODEX_CALLS, process.argv.slice(2).join(' ') + '\\n');
if (process.argv.slice(2).join(' ') !== 'plugin list --available --json') process.exit(2);
process.stdout.write(fs.readFileSync(process.env.RSP_FAKE_PLUGIN_ROWS, 'utf8'));
`, 0o755);
  process.env.RSP_FAKE_PLUGIN_ROWS = FAKE_ROWS;
  setRows();
  const rufloRoot = seedPlugin({
    marketplace: 'ruflo', name: 'ruflo-core', version: '0.2.4', source: RUFLO_SOURCE,
    commands: { 'ruflo-status': rufloStatus },
  });
  const brainRoot = seedPlugin({
    marketplace: 'ruvnet-brain', name: 'ruvnet-brain', version: '3.9.128-dev',
    source: BRAIN_SOURCE,
    commands: {
      rvbc, 'whats-new': whatsNew,
      'brain-console': aliasCommand('brain-console'),
      configure: aliasCommand('configure'),
      rvcb: aliasCommand('rvcb'),
    },
  });
  for (const name of ['brain-console', 'configure', 'rvcb']) {
    write(path.join(brainRoot, '.codex-plugin', 'migrated-command-skills',
      `source-command-${name}`, 'SKILL.md'), migrated(name, aliasCommand(name)));
  }
  return { rufloRoot, brainRoot };
}

function seedNativeBrain() {
  seed();
  const version = '4.0.2';
  const brainRoot = seedPlugin({
    marketplace: 'ruvnet-brain', name: 'ruvnet-brain', version,
    source: BRAIN_SOURCE,
    commands: {
      rvbc, 'whats-new': 'upstream Claude command changed independently\n',
      'brain-console': aliasCommand('brain-console'),
      configure: aliasCommand('configure'),
      rvcb: aliasCommand('rvcb'),
    },
  });
  for (const name of ['brain-console', 'configure', 'rvcb']) {
    write(path.join(brainRoot, '.codex-plugin', 'migrated-command-skills',
      `source-command-${name}`, 'SKILL.md'), migrated(name, aliasCommand(name)));
  }
  write(path.join(brainRoot, 'skills', 'brain-console', 'SKILL.md'),
    nativeBrainConsole('brain-console'));
  write(path.join(brainRoot, 'skills', 'rvbc', 'SKILL.md'), nativeBrainConsole('rvbc'));
  write(path.join(brainRoot, 'skills', 'whats-new', 'SKILL.md'), nativeWhatsNew);
  setRows('0.2.4', version);
  return brainRoot;
}

function seedReleasedBrain() {
  seed();
  const version = '4.0.12';
  const root = seedPlugin({
    marketplace: 'ruvnet-brain', name: 'ruvnet-brain', version, source: BRAIN_SOURCE,
    commands: { 'whats-new': 'native command\n' },
  });
  write(path.join(root, 'skills', 'whats-new', 'SKILL.md'), releasedWhatsNew);
  write(path.join(root, 'scripts', 'whats-new.mjs'), releasedWhatsNewExecutable, 0o755);
  write(path.join(root, 'docs', 'RELEASE-NOTES-4.0.md'), '# Release notes\n\n- Native installed workflow.\n');
  setRows('0.2.4', version);
  return root;
}

function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else out[path.relative(root, file)] = fs.readFileSync(file, 'utf8');
    }
  };
  walk(root);
  return out;
}

seed();
const patcher = await import(`file://${path.join(REPO, 'lib', 'codex-skills', 'patcher.mjs')}`);
const native = await import(`file://${path.join(REPO, 'lib', 'codex-skills', 'native.mjs')}`);

console.log('\nCodex command skill parity');
const sourceBefore = snapshot(BRAIN_SOURCE);
const rufloApply = patcher.apply('ruflo-codex-skills');
const brainApply = patcher.apply('brain-codex-skills');
check('CS1 both targets apply completely',
  rufloApply.patched === 1 && !rufloApply.incomplete && !rufloApply.errors
    && brainApply.patched === 1 && !brainApply.incomplete && !brainApply.errors,
  JSON.stringify({ rufloApply, brainApply }));

const rufloRoot = path.join(CACHE, 'ruflo', 'ruflo-core', '0.2.4');
const brainRoot = path.join(CACHE, 'ruvnet-brain', 'ruvnet-brain', '3.9.128-dev');
const statusSkill = fs.readFileSync(path.join(rufloRoot, 'skills', 'ruflo-status', 'SKILL.md'), 'utf8');
const newsSkill = fs.readFileSync(path.join(brainRoot, 'skills', 'whats-new', 'SKILL.md'), 'utf8');
check('CS2 Ruflo status stays read-only and drops Claude arguments',
  !statusSkill.includes('$ARGUMENTS') && statusSkill.includes('doctor')
    && statusSkill.includes('status') && statusSkill.includes('doctor --fix` separately'));
check('CS3 Brain whats-new binds the official fallback to the exact installed version',
  newsSkill.includes('codex plugin list --available --json')
    && newsSkill.includes('application/vnd.github.raw+json')
    && newsSkill.includes('RELEASE-NOTES-4.0.md?ref=v<installed-version>')
    && newsSkill.includes('Never use `latest`')
    && newsSkill.includes('`^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$`, then retrieve')
    && occurrences(newsSkill, '# RuvNet-Brain: what\'s new') === 1
    && occurrences(newsSkill, 'codex plugin list --available --json') === 1
    && !newsSkill.includes('CLAUDE_PLUGIN_ROOT')
    && !newsSkill.includes('~/Code/ruvnet-brain'));
check('CS3a replacement payloads preserve JavaScript replacement tokens literally',
  native.replaceOnce('before TARGET after', 'TARGET', "$& $` $' $$", 'literal probe')
    === "before $& $` $' $$ after");
check('CS4 shared Brain source remains byte-identical', JSON.stringify(snapshot(BRAIN_SOURCE)) === JSON.stringify(sourceBefore));

const aliases = ['brain-console', 'configure', 'rvcb'].map((name) =>
  path.join(brainRoot, '.codex-plugin', 'migrated-command-skills',
    `source-command-${name}`, 'SKILL.md'));
check('CS5 native 4.0.2 Console aliases remain byte-identical',
  aliases.every((file) => {
    const body = fs.readFileSync(file, 'utf8');
    return body.includes('.console-runtime/scripts/onboarding-console.mjs')
      && !fs.existsSync(`${file}.rsp-backup`);
  }));
check('CS6 the additive whats-new skill is owned by Brain #76',
  newsSkill.includes('ruflo-source-patch stuinfla/ruvnet-brain#76'));

const repeat = patcher.apply('brain-codex-skills');
const ready = patcher.status('brain-codex-skills');
check('CS7 re-apply is idempotent and strict status is healthy',
  repeat.patched === 0 && repeat.unchanged === 1 && ready.patched === ready.files,
  JSON.stringify({ repeat, ready }));

const brainRestore = patcher.restore('brain-codex-skills');
const rufloRestore = patcher.restore('ruflo-codex-skills');
check('CS8 uninstall removes only the additive skill and preserves native aliases',
  brainRestore.restored === 1 && !brainRestore.incomplete && !brainRestore.errors
    && rufloRestore.restored === 1 && !rufloRestore.incomplete && !rufloRestore.errors
    && !fs.existsSync(path.join(brainRoot, 'skills', 'whats-new', 'SKILL.md'))
    && aliases.every((file, index) =>
      fs.readFileSync(file, 'utf8') === migrated(
        ['brain-console', 'configure', 'rvcb'][index],
        aliasCommand(['brain-console', 'configure', 'rvcb'][index]))));

console.log('\nRefusal and update boundaries');
seed();
const collision = path.join(CACHE, 'ruflo', 'ruflo-core', '0.2.4', 'skills', 'ruflo-status', 'SKILL.md');
write(collision, 'user-owned skill\n');
const collisionApply = patcher.apply('ruflo-codex-skills');
check('CS9 unmarked native collision is loud and untouched',
  collisionApply.incomplete === 1 && fs.readFileSync(collision, 'utf8') === 'user-owned skill\n',
  JSON.stringify(collisionApply));

const unknownRoot = seedNativeBrain();
const unknown = path.join(unknownRoot, 'skills', 'whats-new', 'SKILL.md');
write(unknown, 'unknown native skill\n');
const unknownApply = patcher.apply('brain-codex-skills');
check('CS10 unknown native bytes are loud and untouched',
  unknownApply.incomplete === 1 && fs.readFileSync(unknown, 'utf8') === 'unknown native skill\n',
  JSON.stringify(unknownApply));

seed();
patcher.apply('ruflo-codex-skills');
const owned = path.join(CACHE, 'ruflo', 'ruflo-core', '0.2.4', 'skills', 'ruflo-status', 'SKILL.md');
fs.appendFileSync(owned, 'local edit\n');
const modifiedApply = patcher.apply('ruflo-codex-skills');
check('CS11 modified owned skill is not overwritten',
  modifiedApply.incomplete === 1 && fs.readFileSync(owned, 'utf8').endsWith('local edit\n'),
  JSON.stringify(modifiedApply));

seed();
const nextRoot = seedPlugin({
  marketplace: 'ruflo', name: 'ruflo-core', version: '0.2.5', source: RUFLO_SOURCE,
  commands: { 'ruflo-status': rufloStatus.replace('system status.', 'current system status.') },
});
setRows('0.2.5');
const updated = patcher.apply('ruflo-codex-skills');
check('CS12 active version change targets the new cache without touching the old one',
  updated.patched === 1
    && fs.existsSync(path.join(nextRoot, 'skills', 'ruflo-status', 'SKILL.md'))
    && !fs.existsSync(path.join(CACHE, 'ruflo', 'ruflo-core', '0.2.4', 'skills', 'ruflo-status', 'SKILL.md')),
  JSON.stringify(updated));

const child = spawnSync(process.execPath, ['--check', path.join(REPO, 'lib', 'codex-skills', 'patcher.mjs')]);
check('CS13 patcher parses in a fresh Node process', child.status === 0);

fs.rmSync(FAKE_CALLS, { force: true });
const registry = await import(`file://${path.join(REPO, 'lib', 'plugin-registry.mjs')}`);
const emptyInspection = registry.inspectPlugins([]);
check('CS14 drift inspection does not query Codex for uninstalled targets',
  Object.keys(emptyInspection).length === 0 && !fs.existsSync(FAKE_CALLS));

console.log('\nNative Ruflo status retirement');
seed();
const nativeStatusFile = path.join(
  CACHE, 'ruflo', 'ruflo-core', '0.2.4', 'skills', 'ruflo-status', 'SKILL.md',
);
write(nativeStatusFile, nativeRufloStatus.replace(
  'Only when the user explicitly asks',
  'Repair whenever useful',
));
const state = await import(`file://${path.join(REPO, 'lib', 'cwd', 'state.mjs')}`);
const supersede = await import(`file://${path.join(REPO, 'lib', 'supersede.mjs')}`);
state.writeState({
  patchTargets: [], pluginTargets: ['ruflo-codex-skills'], retired: {}, all: false,
});
check('CS15 a status-looking skill without explicit repair authorization cannot trigger retirement',
  supersede.evaluate('ruflo-codex-skills').state === 'live');

write(nativeStatusFile, nativeRufloStatus);
const nativeApply = patcher.apply('ruflo-codex-skills');
const nativeReady = patcher.status('ruflo-codex-skills');
check('CS16 native read-only status is accepted as ready without being overwritten',
  nativeApply.patched === 0
    && nativeApply.unchanged === 1
    && nativeReady.patched === nativeReady.files
    && fs.readFileSync(nativeStatusFile, 'utf8') === nativeRufloStatus,
  JSON.stringify({ nativeApply, nativeReady }));
const retirement = supersede.retireSuperseded(state.readState());
const retiredState = state.readState();
check('CS17 native behavior proof retires #2821 and preserves the upstream skill',
  retirement.retired === 1
    && !retiredState.pluginTargets.includes('ruflo-codex-skills')
    && retiredState.retired['ruflo-codex-skills']?.issue === 'https://github.com/ruvnet/ruflo/issues/2821'
    && fs.readFileSync(nativeStatusFile, 'utf8') === nativeRufloStatus,
  JSON.stringify({ retirement, retiredState }));

console.log('\nNative Brain skill repair');
const nativeBrainRoot = seedNativeBrain();
const nativeNewsFile = path.join(nativeBrainRoot, 'skills', 'whats-new', 'SKILL.md');
const passThroughFiles = [
  path.join(nativeBrainRoot, 'skills', 'brain-console', 'SKILL.md'),
  path.join(nativeBrainRoot, 'skills', 'rvbc', 'SKILL.md'),
  ...['brain-console', 'configure', 'rvcb'].map((name) => path.join(
    nativeBrainRoot, '.codex-plugin', 'migrated-command-skills',
    `source-command-${name}`, 'SKILL.md',
  )),
];
const passThroughBytes = new Map(passThroughFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]));
const nativeBrainApply = patcher.apply('brain-codex-skills');
const nativeBrainStatus = patcher.status('brain-codex-skills');
check('CS18 the one remaining native runtime gap is repaired as a complete target',
  nativeBrainApply.patched === 1
    && !nativeBrainApply.incomplete
    && !nativeBrainApply.errors
    && nativeBrainStatus.patched === nativeBrainStatus.files,
  JSON.stringify({ nativeBrainApply, nativeBrainStatus }));
const patchedNews = fs.readFileSync(nativeNewsFile, 'utf8');
check('CS19 exact-tag fallback is installed while all five native replacements stay untouched',
  patchedNews.includes('RELEASE-NOTES-4.0.md?ref=v<installed-version>')
    && patchedNews.includes('application/vnd.github.raw+json')
    && patchedNews.includes('`^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$`, then retrieve')
    && occurrences(patchedNews, '# What is new') === 1
    && occurrences(patchedNews, 'codex plugin list --available --json') === 1
    && native.isNativeBrainReady('whats-new', patchedNews)
    && !patchedNews.includes('~/Code/ruvnet-brain')
    && fs.readFileSync(`${nativeNewsFile}.rsp-backup`, 'utf8') === nativeWhatsNew
    && passThroughFiles.every((file) => fs.readFileSync(file, 'utf8') === passThroughBytes.get(file)
      && !fs.existsSync(`${file}.rsp-backup`)));

const brainIssue = 'stuinfla/ruvnet-brain#76';
const parsedNews = native.parseCommand(patchedNews, 'patched whats-new');
const legacyPrefix = parsedNews.body.slice(0, parsedNews.body.indexOf('2. Look first'));
const zeroedNews = patchedNews.replace(/<!-- ruflo-source-patch .*? -->/, native.marker(brainIssue));
const malformedNews = native.stamp(zeroedNews.replace(
  '`^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$`, then retrieve only that exact tag with:',
  `\`^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?${legacyPrefix}, then retrieve only that exact tag with:`,
), brainIssue);
write(nativeNewsFile, malformedNews);
const migrationApply = patcher.apply('brain-codex-skills');
check('CS19a owned malformed output migrates from its pristine backup',
  native.isOwned(malformedNews, brainIssue) && !native.isNativeBrainReady('whats-new', malformedNews)
    && migrationApply.patched === 1 && !migrationApply.incomplete && !migrationApply.errors
    && fs.readFileSync(nativeNewsFile, 'utf8') === patchedNews
    && fs.readFileSync(`${nativeNewsFile}.rsp-backup`, 'utf8') === nativeWhatsNew);

const nativeBrainRestore = patcher.restore('brain-codex-skills');
check('CS20 uninstall restores the upstream native skill exactly',
  nativeBrainRestore.restored === 1
    && !nativeBrainRestore.incomplete
    && !nativeBrainRestore.errors
    && fs.readFileSync(nativeNewsFile, 'utf8') === nativeWhatsNew
    && !fs.existsSync(`${nativeNewsFile}.rsp-backup`)
    && passThroughFiles.every((file) => fs.readFileSync(file, 'utf8') === passThroughBytes.get(file)),
  JSON.stringify(nativeBrainRestore));

console.log('\nReleased Brain skill retirement');
const releasedRoot = seedReleasedBrain();
const releasedSkill = path.join(releasedRoot, 'skills', 'whats-new', 'SKILL.md');
const releasedExecutable = path.join(releasedRoot, 'scripts', 'whats-new.mjs');
state.writeState({ patchTargets: [], pluginTargets: ['brain-codex-skills'], retired: {}, all: false });
const releasedApply = patcher.apply('brain-codex-skills');
check('CS21 the immutable installed workflow is accepted without a local edit',
  releasedApply.unchanged === 1 && !releasedApply.patched
    && patcher.status('brain-codex-skills').patched === 1
    && !fs.existsSync(`${releasedSkill}.rsp-backup`));
write(releasedExecutable, "console.log('RuvNet Brain 4.0.12\\n\\nmade up notes');\n", 0o755);
check('CS22 a script that cannot fail closed on missing notes cannot retire the patch',
  supersede.evaluate('brain-codex-skills').state === 'live');
write(releasedExecutable, releasedWhatsNewExecutable, 0o755);
const releasedRetirement = supersede.retireSuperseded(state.readState());
const releasedState = state.readState();
check('CS23 executable native proof retires #76 and preserves every upstream byte',
  releasedRetirement.retired === 1
    && !releasedState.pluginTargets.includes('brain-codex-skills')
    && releasedState.retired['brain-codex-skills']?.issue === 'https://github.com/stuinfla/ruvnet-brain/issues/76'
    && fs.readFileSync(releasedSkill, 'utf8') === releasedWhatsNew
    && fs.readFileSync(releasedExecutable, 'utf8') === releasedWhatsNewExecutable,
  JSON.stringify({ releasedRetirement, releasedState }));

if (failures) {
  console.error(`\n${failures} Codex skill test(s) failed`);
  process.exit(1);
}
console.log('\nAll Codex skill tests passed');
