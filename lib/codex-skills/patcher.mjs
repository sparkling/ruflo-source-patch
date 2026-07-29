// Codex skill parity for commands that the Ruflo and RuvNet Brain plugins expose to
// Claude Code but Codex cannot run as shipped.
//
// This target deliberately touches only Codex's active, versioned plugin cache. In
// particular it never writes RuvNet Brain's shared Claude marketplace, native version
// store, updater state, or cache/KB. A normal plugin refresh may replace these files;
// the existing SessionStart hook and monitor then re-apply them.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  backupOf, resolvePristine, restoreFromBackup, writeIfChanged,
} from '../pristine.mjs';
import { HOME_BASE } from '../cwd/paths.mjs';

const CODEX_HOME = process.env.RSP_CODEX_HOME
  || process.env.CODEX_HOME
  || path.join(HOME_BASE, '.codex');
const CODEX_BIN = process.env.RSP_CODEX_BIN || 'codex';
const ZERO_HASH = '0'.repeat(64);

const SPECS = {
  'ruflo-codex-skills': {
    pluginId: 'ruflo-core@ruflo',
    marketplace: 'ruflo',
    plugin: 'ruflo-core',
    issue: 'ruvnet/ruflo#2821',
    native: [{ command: 'ruflo-status', skill: 'ruflo-status' }],
    aliases: [],
  },
  'brain-codex-skills': {
    pluginId: 'ruvnet-brain@ruvnet-brain',
    marketplace: 'ruvnet-brain',
    plugin: 'ruvnet-brain',
    issue: 'stuinfla/ruvnet-brain#56',
    native: [
      { command: 'rvbc', skill: 'rvbc' },
      { command: 'whats-new', skill: 'whats-new' },
    ],
    aliases: ['brain-console', 'configure', 'rvcb'],
  },
};

const marker = (issue, digest = ZERO_HASH) =>
  `<!-- ruflo-source-patch ${issue} sha256=${digest} -->`;
const digest = (src) => createHash('sha256').update(src).digest('hex');

function stamp(src, issue) {
  const placeholder = marker(issue);
  if (!src.includes(placeholder)) throw new Error('generated skill has no ownership placeholder');
  return src.replace(placeholder, marker(issue, digest(src)));
}

function isOwned(src, issue) {
  const re = new RegExp(`<!-- ruflo-source-patch ${issue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} sha256=([a-f0-9]{64}) -->`);
  const match = src.match(re);
  if (!match) return false;
  return digest(src.replace(match[0], marker(issue))) === match[1];
}

function parseCommand(src, label) {
  const match = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${label}: command frontmatter is not bounded by ---`);
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1];
  if (!description) throw new Error(`${label}: command has no one-line description`);
  return { description, body: match[2].trim() };
}

function replaceOnce(src, before, after, label) {
  const count = src.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one source anchor, found ${count}`);
  return src.replace(before, after);
}

function renderNative(command, skill, src, issue) {
  const parsed = parseCommand(src, command);
  let body = parsed.body;

  if (command === 'ruflo-status') {
    if (!body.startsWith('$ARGUMENTS\n')) {
      throw new Error('ruflo-status: expected the Claude-only $ARGUMENTS prelude');
    }
    body = body.slice('$ARGUMENTS\n'.length);
    if (!body.includes('doctor') || !body.includes('status') || !body.includes('doctor --fix')) {
      throw new Error('ruflo-status: read-only doctor/status contract changed');
    }
  }

  if (command === 'rvbc') {
    body = replaceOnce(body,
      `## 2. Find the repo

Prefer \`~/Code/ruvnet-brain\`. If \`$CLAUDE_PLUGIN_ROOT\` is set, the repo may be its parent
directory. Use whichever path actually contains \`scripts/onboarding-console.mjs\`.`,
      `## 2. Find the installed source

Run \`codex plugin list --available --json\`, select the installed and enabled
\`ruvnet-brain@ruvnet-brain\` row, and inspect its \`source.path\`. Use that directory or its parent,
whichever contains \`scripts/onboarding-console.mjs\`. If the plugin is absent or neither path contains
the script, report that plainly; do not download, pin, mirror, or substitute Brain.`,
      'rvbc');
  }

  if (command === 'whats-new') {
    body = replaceOnce(body,
      `**First, ground — never recite this from memory (it drifts every release):**
1. Read the running version from \`\${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json\`. State it honestly.`,
      `**First, ground — never recite this from memory (it drifts every release):**
1. Run \`codex plugin list --available --json\`, select the installed and enabled
   \`ruvnet-brain@ruvnet-brain\` row, and read the running version from
   \`<source.path>/.claude-plugin/plugin.json\`. State it honestly.`,
      'whats-new plugin root');
    body = replaceOnce(body,
      `2. Read \`docs/RELEASE-NOTES-4.0.md\` (the curated highlights + its VERSION STATUS banner). Its content is`,
      `2. Read \`docs/RELEASE-NOTES-4.0.md\` from \`source.path\` or its parent, whichever contains it
   (the curated highlights + its VERSION STATUS banner). Its content is`,
      'whats-new notes path');
    body = replaceOnce(body,
      `If they say yes, follow \`rvbc.md\` in this same directory exactly (including the
warm heads-up about the ~20s scan).`,
      `If they say yes, use the \`ruvnet-brain:rvbc\` skill. Do not invent a duration; the Console
reports its own scan progress.`,
      'whats-new console handoff');
  }

  if (body.includes('CLAUDE_PLUGIN_ROOT') || body.includes('rvbc.md` in this same directory')) {
    throw new Error(`${command}: Claude-only path survived the Codex transform`);
  }

  return stamp(`---
name: ${skill}
description: ${parsed.description}
---
${marker(issue)}

${body}
`, issue);
}

function migratedPristine(command, src) {
  const parsed = parseCommand(src, command);
  const description = parsed.description.startsWith('"')
    ? JSON.parse(parsed.description)
    : parsed.description;
  const name = `source-command-${command}`;
  return `---
name: ${JSON.stringify(name)}
description: ${JSON.stringify(description)}
---

# ${name}

Use this skill when the user asks to run the migrated source command \`${command}\`.

## Command Template

${parsed.body}
`;
}

function renderAlias(pristine, command, issue) {
  const parsed = parseCommand(pristine, `migrated ${command}`);
  const name = `source-command-${command}`;
  if (!pristine.includes(`name: ${JSON.stringify(name)}`)) {
    throw new Error(`${name}: migrated skill name changed`);
  }
  return `---
name: ${JSON.stringify(name)}
description: ${parsed.description}
---
${marker(issue)}

# ${name}

Use this compatibility skill when the user asks to open the RuvNet Brain Console.

1. Say one warm sentence that you are opening it now and it will scan live.
2. Run \`codex plugin list --available --json\`; select the installed and enabled
   \`ruvnet-brain@ruvnet-brain\` row. Use its \`source.path\` or parent, whichever contains
   \`scripts/onboarding-console.mjs\`.
3. Start \`node <root>/scripts/onboarding-console.mjs --serve --open\` in the background.
4. Return the printed \`http://127.0.0.1:<port>/\` immediately. The page is read-only until clicked,
   explains every change first, and is reversible. An already-running server is success.
5. Report a real startup error plainly. Never download, pin, mirror, or substitute Brain.
`;
}

function pluginList() {
  const run = spawnSync(CODEX_BIN, ['plugin', 'list', '--available', '--json'], {
    env: { ...process.env, CODEX_HOME },
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (run.error) throw new Error(`cannot run Codex: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`codex plugin list failed: ${(run.stderr || run.stdout).trim()}`);
  try {
    return JSON.parse(run.stdout);
  } catch (err) {
    throw new Error(`codex plugin list returned invalid JSON: ${err.message}`);
  }
}

function assertNoSymlink(root, file) {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`target escapes active Codex cache: ${file}`);
  }
  let cursor = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) continue;
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`refusing symlinked cache path: ${cursor}`);
  }
}

function resolveActive(spec) {
  const listing = pluginList();
  const rows = [...(listing.installed || []), ...(listing.available || [])];
  const row = rows.find((item) => item.pluginId === spec.pluginId);
  if (!row?.installed || !row?.enabled) {
    throw new Error(`${spec.pluginId} is not installed and enabled in Codex`);
  }
  if (row.name !== spec.plugin || row.marketplaceName !== spec.marketplace
      || !/^[A-Za-z0-9._+-]+$/.test(row.version || '')) {
    throw new Error(`${spec.pluginId} returned unexpected plugin identity/version`);
  }

  const cacheBase = path.resolve(CODEX_HOME, 'plugins', 'cache');
  const root = path.resolve(cacheBase, spec.marketplace, spec.plugin, row.version);
  if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()
      || !fs.realpathSync(root).startsWith(`${fs.realpathSync(cacheBase)}${path.sep}`)) {
    throw new Error(`active Codex cache is missing or unsafe: ${root}`);
  }

  for (const candidate of [root, path.resolve(row.source?.path || '')]) {
    const manifestFile = path.join(candidate, '.claude-plugin', 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest.name !== spec.plugin || manifest.version !== row.version) {
      throw new Error(`plugin manifest does not match ${spec.pluginId}: ${manifestFile}`);
    }
  }
  return root;
}

function commandSource(root, command) {
  const file = path.join(root, 'commands', `${command}.md`);
  assertNoSymlink(root, file);
  if (!fs.lstatSync(file).isFile()) throw new Error(`command source is not a file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function nativeEntries(root, spec) {
  return spec.native.map(({ command, skill }) => {
    const body = renderNative(command, skill, commandSource(root, command), spec.issue);
    const file = path.join(root, 'skills', skill, 'SKILL.md');
    assertNoSymlink(root, file);
    return { kind: 'native', command, file, body };
  });
}

function aliasEntries(root, spec) {
  return spec.aliases.map((command) => {
    const source = commandSource(root, command);
    const expected = migratedPristine(command, source);
    const file = path.join(root, '.codex-plugin', 'migrated-command-skills',
      `source-command-${command}`, 'SKILL.md');
    assertNoSymlink(root, file);
    return { kind: 'alias', command, file, expected };
  });
}

export function expectedFiles(target) {
  const spec = SPECS[target];
  if (!spec) throw new Error(`unknown Codex skill target: ${target}`);
  return spec.native.length + spec.aliases.length;
}

export function apply(target) {
  const spec = SPECS[target];
  const out = { patched: 0, unchanged: 0, skipped: 0, incomplete: 0, errors: 0, log: [] };
  if (!spec) throw new Error(`unknown Codex skill target: ${target}`);
  let root;
  try { root = resolveActive(spec); } catch (err) {
    out.incomplete++;
    out.log.push(`INCOMPLETE ${err.message}`);
    return out;
  }

  let entries;
  try { entries = [...nativeEntries(root, spec), ...aliasEntries(root, spec)]; } catch (err) {
    out.incomplete++;
    out.log.push(`INCOMPLETE ${err.message}`);
    return out;
  }

  for (const entry of entries) {
    try {
      if (entry.kind === 'native') {
        if (fs.existsSync(entry.file)) {
          const current = fs.readFileSync(entry.file, 'utf8');
          if (current === entry.body) { out.unchanged++; continue; }
          if (!isOwned(current, spec.issue)) {
            out.incomplete++;
            out.log.push(`skip:not-ours ${entry.file}`);
            continue;
          }
        }
        fs.mkdirSync(path.dirname(entry.file), { recursive: true });
        writeIfChanged(entry.file, entry.body);
      } else {
        if (!fs.existsSync(entry.file)) {
          out.incomplete++;
          out.log.push(`INCOMPLETE Codex did not generate ${entry.file}`);
          continue;
        }
        const current = fs.readFileSync(entry.file, 'utf8');
        const backup = backupOf(entry.file);
        if (current.includes(`ruflo-source-patch ${spec.issue}`)) {
          if (!fs.existsSync(backup)
              || renderAlias(fs.readFileSync(backup, 'utf8'), entry.command, spec.issue) !== current) {
            out.incomplete++;
            out.log.push(`skip:modified ${entry.file}`);
            continue;
          }
        } else if (current !== entry.expected) {
          out.incomplete++;
          out.log.push(`skip:unknown-migration ${entry.file}`);
          continue;
        }
        const patch = (src) => renderAlias(src, entry.command, spec.issue);
        const resolved = resolvePristine(entry.file, patch, {
          isOurs: (src) => src.includes(`ruflo-source-patch ${spec.issue}`),
        });
        if (!resolved.pristine) {
          out.incomplete++;
          out.log.push(`INCOMPLETE no trustworthy pristine for ${entry.file}`);
          continue;
        }
        if (!writeIfChanged(entry.file, patch(resolved.pristine))) {
          out.unchanged++;
          continue;
        }
      }
      out.patched++;
      out.log.push(`patched ${entry.file}`);
    } catch (err) {
      out.errors++;
      out.log.push(`error ${entry.file}: ${err.message}`);
    }
  }
  return out;
}

export function restore(target) {
  const spec = SPECS[target];
  const out = { restored: 0, preserved: 0, incomplete: 0, errors: 0, log: [] };
  if (!spec) throw new Error(`unknown Codex skill target: ${target}`);
  let root;
  try { root = resolveActive(spec); } catch (err) {
    out.incomplete++;
    out.log.push(`INCOMPLETE ${err.message}`);
    return out;
  }

  let entries;
  try { entries = [...nativeEntries(root, spec), ...aliasEntries(root, spec)]; } catch (err) {
    out.incomplete++;
    out.log.push(`INCOMPLETE ${err.message}`);
    return out;
  }

  for (const entry of entries) {
    try {
      if (entry.kind === 'native') {
        if (!fs.existsSync(entry.file)) continue;
        const current = fs.readFileSync(entry.file, 'utf8');
        if (!isOwned(current, spec.issue)) {
          out.preserved++;
          out.log.push(`preserved:not-ours ${entry.file}`);
          continue;
        }
        fs.rmSync(entry.file);
        try { fs.rmdirSync(path.dirname(entry.file)); } catch {}
        out.restored++;
        out.log.push(`restored ${entry.file} (removed owned additive skill)`);
        continue;
      }

      const patch = (src) => renderAlias(src, entry.command, spec.issue);
      const result = restoreFromBackup(entry.file, {
        isKnownPatched: (pristine, current) => patch(pristine) === current,
        hasPatch: (src) => src.includes(`ruflo-source-patch ${spec.issue}`),
      });
      if (result.unresolved) {
        out.incomplete++;
        out.log.push(`INCOMPLETE ${entry.file}: ${result.reason}`);
      } else if (result.restored) {
        out.restored++;
        out.log.push(`restored ${entry.file}`);
      } else {
        out.preserved++;
      }
    } catch (err) {
      out.errors++;
      out.log.push(`error ${entry.file}: ${err.message}`);
    }
  }
  return out;
}

export function status(target) {
  const spec = SPECS[target];
  const out = { files: expectedFiles(target), patched: 0, log: [] };
  let root;
  try { root = resolveActive(spec); } catch (err) {
    out.log.push(`not-patched ${err.message}`);
    return out;
  }

  let entries;
  try { entries = [...nativeEntries(root, spec), ...aliasEntries(root, spec)]; } catch (err) {
    out.log.push(`not-patched ${err.message}`);
    return out;
  }
  for (const entry of entries) {
    try {
      const current = fs.readFileSync(entry.file, 'utf8');
      const ready = entry.kind === 'native'
        ? current === entry.body
        : fs.existsSync(backupOf(entry.file))
          && renderAlias(fs.readFileSync(backupOf(entry.file), 'utf8'), entry.command, spec.issue) === current;
      if (ready) {
        out.patched++;
        out.log.push(`patched ${entry.file}`);
      } else {
        out.log.push(`not-patched ${entry.file}`);
      }
    } catch {
      out.log.push(`not-patched ${entry.file}`);
    }
  }
  return out;
}
