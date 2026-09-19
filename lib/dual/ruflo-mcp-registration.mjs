// #3306 recovery: repair only the missing global launchers used by our old workaround.
// Shared by explicit patch installation and dual init; never run by the monitor.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function accountHome() {
  try { return os.userInfo().homedir; } catch { return os.homedir(); }
}

export function repairRegistrationSource(source, home, exists = fs.existsSync) {
  const lines = source.split('\n');
  const headers = lines.flatMap((line, index) =>
    /^\s*\[mcp_servers\.ruflo\]\s*(?:#[^\n]*)?$/.test(line) ? [index] : []);
  if (!headers.length) return source;
  if (headers.length !== 1) throw new Error('ambiguous Ruflo MCP tables; preserving config');
  const start = headers[0];
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  const section = lines.slice(start + 1, end);
  const entries = key => section.flatMap((line, offset) =>
    new RegExp('^\\s*' + key + '\\s*=').test(line) ? [start + 1 + offset] : []);
  const commands = entries('command'), args = entries('args'), enabled = entries('enabled');
  if (commands.length > 1 || args.length > 1 || enabled.length > 1) {
    throw new Error('duplicate Ruflo MCP keys; preserving config');
  }
  if (enabled.length && !/^\s*enabled\s*=\s*true\s*(?:#[^\n]*)?$/.test(lines[enabled[0]])) return source;
  if (commands.length !== 1 || args.length !== 1) return source;
  const commandMatch = lines[commands[0]].match(/^(\s*command\s*=\s*)("(?:[^"\\]|\\.)*")(\s*(?:#[^\n]*)?)$/);
  const argsMatch = lines[args[0]].match(/^(\s*args\s*=\s*)(\[.*\])(\s*(?:#[^\n]*)?)$/);
  if (!commandMatch || !argsMatch) return source; // custom/multiline TOML is not ours
  let command, argv;
  try { command = JSON.parse(commandMatch[2]); argv = JSON.parse(argsMatch[2]); }
  catch { return source; }
  const cli = path.join(home, '.npm-global/lib/node_modules/@claude-flow/cli/bin/cli.js');
  const wrapper = path.join(home, '.npm-global/bin/ruflo');
  const direct = path.basename(command) === 'node' && Array.isArray(argv)
    && JSON.stringify(argv) === JSON.stringify([cli, 'mcp', 'start']);
  const wrapped = command === wrapper && JSON.stringify(argv) === '["mcp","start"]';
  if ((!direct && !wrapped) || exists(direct ? cli : wrapper)) return source;
  // Preserve every other setting, environment block, comment and line ending.
  lines[commands[0]] = commandMatch[1] + '"npx"' + commandMatch[3];
  lines[args[0]] = argsMatch[1] + '["-y", "ruflo@latest", "mcp", "start"]' + argsMatch[3];
  const timeouts = entries('startup_timeout_sec');
  if (timeouts.length > 1) throw new Error('duplicate Ruflo timeout; preserving config');
  if (!timeouts.length) lines.splice(end, 0, 'startup_timeout_sec = 120' + (source.includes('\r\n') ? '\r' : ''));
  else {
    const at = timeouts[0];
    const match = lines[at].match(/^(\s*startup_timeout_sec\s*=\s*)(\d+(?:\.\d+)?)(\s*(?:#[^\n]*)?)$/);
    if (!match) throw new Error('unrecognized Ruflo timeout; preserving config');
    if (Number(match[2]) < 120) lines[at] = match[1] + '120' + match[3];
  }
  return lines.join('\n');
}

export function repairLegacyRufloMcp({
  home = process.env.RUFLO_SOURCE_PATCH_HOME || accountHome(),
  codexHome = (process.env.RUFLO_SOURCE_PATCH_HOME ? null : process.env.CODEX_HOME) || path.join(home, '.codex'),
} = {}) {
  if (!path.isAbsolute(home) || !path.isAbsolute(codexHome)) throw new Error('absolute account/config paths required');
  const file = path.join(codexHome, 'config.toml');
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!stat.isFile() || fs.realpathSync(file) !== file) throw new Error('refusing linked/non-regular Codex config');
  const source = fs.readFileSync(file, 'utf8');
  const exists = target => {
    try { fs.statSync(target); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  const next = repairRegistrationSource(source, home, exists);
  if (next === source) return false;
  const suffix = '.rsp-3306-npx-' + randomUUID();
  const backup = file + suffix + '.bak', temporary = file + suffix + '.tmp';
  fs.writeFileSync(backup, source, { flag: 'wx', mode: 0o600 });
  try {
    fs.writeFileSync(temporary, next, { flag: 'wx', mode: stat.mode & 0o777 });
    const current = fs.lstatSync(file);
    if (!current.isFile() || current.ino !== stat.ino || fs.readFileSync(file, 'utf8') !== source) {
      throw new Error('Codex config changed during repair; preserving concurrent changes');
    }
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  console.log('[ruflo-wrapper-guard] restored missing legacy MCP launcher to npx; backup: ' + backup);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { repairLegacyRufloMcp(); }
  catch (error) { console.error('[ruflo-wrapper-guard] ' + error.message); process.exitCode = 1; }
}
