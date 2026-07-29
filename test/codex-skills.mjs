// Behavioral coverage for the cache-local Codex command parity targets (#2821 / #56).

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

Alias of \`/rvbc\`. Follow \`rvbc.md\` in this same directory exactly.
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

console.log('\nCodex command skill parity');
const sourceBefore = snapshot(BRAIN_SOURCE);
const rufloApply = patcher.apply('ruflo-codex-skills');
const brainApply = patcher.apply('brain-codex-skills');
check('CS1 both targets apply completely',
  rufloApply.patched === 1 && !rufloApply.incomplete && !rufloApply.errors
    && brainApply.patched === 5 && !brainApply.incomplete && !brainApply.errors,
  JSON.stringify({ rufloApply, brainApply }));

const rufloRoot = path.join(CACHE, 'ruflo', 'ruflo-core', '0.2.4');
const brainRoot = path.join(CACHE, 'ruvnet-brain', 'ruvnet-brain', '3.9.128-dev');
const statusSkill = fs.readFileSync(path.join(rufloRoot, 'skills', 'ruflo-status', 'SKILL.md'), 'utf8');
const rvbcSkill = fs.readFileSync(path.join(brainRoot, 'skills', 'rvbc', 'SKILL.md'), 'utf8');
const newsSkill = fs.readFileSync(path.join(brainRoot, 'skills', 'whats-new', 'SKILL.md'), 'utf8');
check('CS2 Ruflo status stays read-only and drops Claude arguments',
  !statusSkill.includes('$ARGUMENTS') && statusSkill.includes('doctor')
    && statusSkill.includes('status') && statusSkill.includes('doctor --fix` separately'));
check('CS3 Brain native skills resolve through Codex without Claude-only paths',
  rvbcSkill.includes('codex plugin list --available --json')
    && newsSkill.includes('codex plugin list --available --json')
    && !rvbcSkill.includes('CLAUDE_PLUGIN_ROOT')
    && !newsSkill.includes('CLAUDE_PLUGIN_ROOT')
    && !newsSkill.includes('rvbc.md` in this same directory'));
check('CS4 shared Brain source remains byte-identical', JSON.stringify(snapshot(BRAIN_SOURCE)) === JSON.stringify(sourceBefore));

const aliases = ['brain-console', 'configure', 'rvcb'].map((name) =>
  path.join(brainRoot, '.codex-plugin', 'migrated-command-skills',
    `source-command-${name}`, 'SKILL.md'));
check('CS5 all visible migrated aliases are self-contained',
  aliases.every((file) => {
    const body = fs.readFileSync(file, 'utf8');
    return body.includes('codex plugin list --available --json')
      && !body.includes('CLAUDE_PLUGIN_ROOT') && !body.includes('rvbc.md');
  }));
check('CS6 alias pristines are backed up exactly',
  aliases.every((file, index) =>
    fs.readFileSync(`${file}.rsp-backup`, 'utf8')
      === migrated(['brain-console', 'configure', 'rvcb'][index],
        aliasCommand(['brain-console', 'configure', 'rvcb'][index]))));

const repeat = patcher.apply('brain-codex-skills');
const ready = patcher.status('brain-codex-skills');
check('CS7 re-apply is idempotent and strict status is healthy',
  repeat.patched === 0 && repeat.unchanged === 5 && ready.patched === ready.files,
  JSON.stringify({ repeat, ready }));

const brainRestore = patcher.restore('brain-codex-skills');
const rufloRestore = patcher.restore('ruflo-codex-skills');
check('CS8 uninstall removes only additive skills and restores all aliases',
  brainRestore.restored === 5 && !brainRestore.incomplete && !brainRestore.errors
    && rufloRestore.restored === 1 && !rufloRestore.incomplete && !rufloRestore.errors
    && !fs.existsSync(path.join(brainRoot, 'skills', 'rvbc', 'SKILL.md'))
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

seed();
const unknown = path.join(CACHE, 'ruvnet-brain', 'ruvnet-brain', '3.9.128-dev',
  '.codex-plugin', 'migrated-command-skills', 'source-command-configure', 'SKILL.md');
write(unknown, 'unknown Codex migration\n');
const unknownApply = patcher.apply('brain-codex-skills');
check('CS10 unknown migrated bytes are loud and untouched',
  unknownApply.incomplete === 1 && fs.readFileSync(unknown, 'utf8') === 'unknown Codex migration\n',
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

if (failures) {
  console.error(`\n${failures} Codex skill test(s) failed`);
  process.exit(1);
}
console.log('\nAll Codex skill tests passed');
