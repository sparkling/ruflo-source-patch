// Codex skill parity for plugin commands Codex cannot run as shipped. This touches only
// Codex's active versioned cache; plugin refreshes are repaired by SessionStart/monitor.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  backupOf, resolvePristine, restoreFromBackup, writeIfChanged,
} from '../pristine.mjs';
import { HOME_BASE } from '../cwd/paths.mjs';
import {
  isNativeBrainReady, isNativeRufloStatus, isOwned, marker, parseCommand,
  renderNativeAdditive, renderNativeBrainEdit,
} from './native.mjs';
const CODEX_HOME = process.env.RSP_CODEX_HOME
  || process.env.CODEX_HOME
  || path.join(HOME_BASE, '.codex');
const CODEX_BIN = process.env.RSP_CODEX_BIN || 'codex';
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
      { command: 'brain-console', skill: 'brain-console' },
      { command: 'rvbc', skill: 'rvbc' },
      { command: 'whats-new', skill: 'whats-new' },
    ],
    aliases: ['brain-console', 'configure', 'rvcb'],
  },
};

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
    const body = renderNativeAdditive(command, skill, commandSource(root, command), spec.issue);
    const file = path.join(root, 'skills', skill, 'SKILL.md');
    assertNoSymlink(root, file);
    return {
      kind: 'native',
      command,
      file,
      body,
      editPatch: spec === SPECS['brain-codex-skills']
        ? (src) => renderNativeBrainEdit(command, skill, src, spec.issue)
        : null,
      nativeReady: spec === SPECS['ruflo-codex-skills']
        ? isNativeRufloStatus
        : (src) => isNativeBrainReady(command, src),
    };
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
          const owned = isOwned(current, spec.issue);
          if (current === entry.body || (!owned && entry.nativeReady?.(current))) {
            out.unchanged++;
            continue;
          }
          const backup = backupOf(entry.file);
          if (owned && !fs.existsSync(backup)) {
            out.incomplete++;
            out.log.push(`skip:modified ${entry.file}`);
            continue;
          }
          if (!entry.editPatch) {
            out.incomplete++;
            out.log.push(`skip:not-ours ${entry.file}`);
            continue;
          }
          if (!owned) {
            try {
              entry.editPatch(current);
            } catch {
              out.incomplete++;
              out.log.push(`skip:not-ours ${entry.file}`);
              continue;
            }
          }
          const resolved = resolvePristine(entry.file, entry.editPatch, {
            isOurs: (src) => isOwned(src, spec.issue),
          });
          if (!resolved.pristine) {
            out.incomplete++;
            out.log.push(`INCOMPLETE no trustworthy pristine for ${entry.file}`);
            continue;
          }
          if (!writeIfChanged(entry.file, entry.editPatch(resolved.pristine))) {
            out.unchanged++;
            continue;
          }
          out.patched++;
          out.log.push(`patched ${entry.file}`);
          continue;
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
        if (fs.existsSync(backupOf(entry.file)) && entry.editPatch) {
          const result = restoreFromBackup(entry.file, {
            isKnownPatched: (pristine, patched) => entry.editPatch(pristine) === patched,
            hasPatch: (src) => isOwned(src, spec.issue),
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
          || (!isOwned(current, spec.issue) && entry.nativeReady?.(current))
          || (entry.editPatch && fs.existsSync(backupOf(entry.file))
            && entry.editPatch(fs.readFileSync(backupOf(entry.file), 'utf8')) === current)
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

export const rufloCodexSkillsSupersession = {
  issue: 'https://github.com/ruvnet/ruflo/issues/2821',
  replacement: 'ruflo-core native read-only ruflo-status skill for Codex',
  retire: () => restore('ruflo-codex-skills'),
  check() {
    let root;
    try {
      root = resolveActive(SPECS['ruflo-codex-skills']);
    } catch (err) {
      return { state: 'unknown', evidence: err.message };
    }
    const file = path.join(root, 'skills', 'ruflo-status', 'SKILL.md');
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (err) {
      return { state: 'live', evidence: `native ruflo-status is absent or unreadable: ${err.message}` };
    }
    if (!isNativeRufloStatus(source)) {
      return {
        state: 'live',
        evidence: 'ruflo-status is present but does not prove a read-only default plus explicit-only doctor --fix path',
      };
    }
    return {
      state: 'superseded',
      evidence: 'active ruflo-core ships a native ruflo-status skill whose default doctor/status workflow '
        + 'is read-only and whose doctor --fix path requires explicit repair intent',
    };
  },
};
