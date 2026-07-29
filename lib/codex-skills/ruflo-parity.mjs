// Discover only the Ruflo command workflows that Codex did not expose itself.
// Rendering and ownership stay with patcher.mjs so both Codex skill targets use
// the same exact marker contract.

import fs from 'node:fs';
import path from 'node:path';

const COMMAND_NAME = /^[a-z0-9][a-z0-9-]*$/;

function validNative(source, command) {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
  const rawName = frontmatter?.[1].match(/^name:\s*(.+)$/m)?.[1];
  const description = frontmatter?.[1].match(/^description:\s*(.+)$/m)?.[1];
  if (!rawName || !description) return false;
  try {
    const name = rawName.startsWith('"') ? JSON.parse(rawName) : rawName;
    return name === command;
  } catch {
    return false;
  }
}

function skillState(file, command, issue, assertNoSymlink, isOwned) {
  assertNoSymlink(file);
  if (!fs.existsSync(file)) return { exists: false, owned: false };
  if (!fs.lstatSync(file).isFile()) throw new Error(`skill target is not a file: ${file}`);
  const source = fs.readFileSync(file, 'utf8');
  const marked = source.includes(`ruflo-source-patch ${issue}`);
  const owned = isOwned(source, issue);
  if (marked && !owned) throw new Error(`owned skill was modified: ${file}`);
  if (!owned && !validNative(source, command)) {
    throw new Error(`unowned same-name skill is not valid native parity: ${file}`);
  }
  return { exists: true, owned };
}

function commandFiles(root, assertNoSymlink) {
  const directory = path.join(root, 'commands');
  assertNoSymlink(directory);
  if (!fs.existsSync(directory)) return [];
  if (!fs.lstatSync(directory).isDirectory()) {
    throw new Error(`commands path is not a directory: ${directory}`);
  }
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith('.md'))
    .map((entry) => {
      if (!entry.isFile()) throw new Error(`command source is not a file: ${entry.name}`);
      const command = entry.name.slice(0, -3);
      if (!COMMAND_NAME.test(command)) throw new Error(`unsafe command name: ${entry.name}`);
      const file = path.join(directory, entry.name);
      assertNoSymlink(file);
      return { command, file, source: fs.readFileSync(file, 'utf8') };
    })
    .sort((a, b) => a.command.localeCompare(b.command));
}

function ownedSkillFiles(root, issue, assertNoSymlink, isOwned) {
  const directory = path.join(root, 'skills');
  assertNoSymlink(directory);
  if (!fs.existsSync(directory)) return [];
  if (!fs.lstatSync(directory).isDirectory()) {
    throw new Error(`skills path is not a directory: ${directory}`);
  }
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !COMMAND_NAME.test(entry.name)) continue;
    const file = path.join(directory, entry.name, 'SKILL.md');
    assertNoSymlink(file);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes(`ruflo-source-patch ${issue}`)) continue;
    if (!isOwned(source, issue)) throw new Error(`owned skill was modified: ${file}`);
    files.push({ command: entry.name, file });
  }
  return files;
}

export function discoverRufloEntries(root, issue, helpers) {
  const {
    assertNoSymlink, isMigration, isOwned, render,
  } = helpers;
  const entries = [];
  const handled = new Set();

  for (const command of commandFiles(root, assertNoSymlink)) {
    const file = path.join(root, 'skills', command.command, 'SKILL.md');
    const native = skillState(file, command.command, issue, assertNoSymlink, isOwned);
    const migrated = path.join(root, '.codex-plugin', 'migrated-command-skills',
      `source-command-${command.command}`, 'SKILL.md');
    assertNoSymlink(migrated);
    const hasMigration = fs.existsSync(migrated)
      && fs.lstatSync(migrated).isFile()
      && isMigration(command.command, command.source, fs.readFileSync(migrated, 'utf8'));

    handled.add(file);
    if ((native.exists && !native.owned) || hasMigration) {
      if (native.owned) entries.push({ kind: 'retire', command: command.command, file });
      continue;
    }
    entries.push({
      kind: 'native',
      command: command.command,
      file,
      body: render(command.command, command.source, issue),
    });
  }

  for (const owned of ownedSkillFiles(root, issue, assertNoSymlink, isOwned)) {
    if (!handled.has(owned.file)) entries.push({ kind: 'retire', ...owned });
  }
  return entries;
}
