// sparkling/ruflo-source-patch#5. Retire only on equivalent native attributed failure receipts.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE, STABLE_LIB } from '../cwd/paths.mjs';
import { discover as brainSurfaces } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
export const NAME = 'hook-failure-log';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export const PREFIX = `node --require ${quote(path.join(STABLE_LIB, NAME, 'runtime.cjs'))} `;
export const unwrapCommand = command => command.startsWith(PREFIX) ? 'node ' + command.slice(PREFIX.length) : command;
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
function commands(source) {
  const manifest = parse(source), out = [];
  if (!manifest?.hooks || typeof manifest.hooks !== 'object') return out;
  for (const groups of Object.values(manifest.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) for (const hook of group.hooks || []) {
      if (hook.type === 'command' && typeof hook.command === 'string' && hook.command.startsWith('node ')) out.push(hook.command);
    }
  }
  return out;
}
export const hasPatch = source => commands(source).some(c => c.startsWith(PREFIX));
export const isPatched = source => commands(source).length > 0 && commands(source).every(c => c.startsWith(PREFIX));
export function patchSource(source) {
  const entries = commands(source);
  if (!entries.length) return { next: source, applied: [], missing: [] };
  let next = source;
  for (const command of new Set(entries)) {
    if (command.startsWith(PREFIX)) continue;
    if (command.includes('/hook-failure-log/runtime.cjs')) {
      return { next: source, applied: [], missing: ['foreign-hook-logger-preload'] };
    }
    const anchor = JSON.stringify(command);
    if (source.split(anchor).length - 1 !== entries.filter(c => c === command).length) {
      return { next: source, applied: [], missing: ['unique-hook-command-literals'] };
    }
    next = next.split(anchor).join(JSON.stringify(PREFIX + command.slice(5)));
  }
  return { next, applied: next === source ? [] : [NAME], missing: [] };
}
export function reverseSource(source) {
  let next = source;
  for (const command of new Set(commands(source))) {
    if (command.startsWith(PREFIX)) next = next.split(JSON.stringify(command)).join(JSON.stringify(unwrapCommand(command)));
  }
  return next;
}
function rufloRoots() {
  const result = [];
  for (const host of ['.claude', '.codex']) {
    const base = path.join(HOME_BASE, host);
    for (const market of [path.join(base, 'plugins/marketplaces/ruflo/plugins'), path.join(base, '.tmp/marketplaces/ruflo/plugins')]) {
      try { for (const name of fs.readdirSync(market)) if (name.startsWith('ruflo-')) result.push(path.join(market, name)); } catch { /* absent */ }
    }
    const cache = path.join(base, 'plugins/cache/ruflo');
    try {
      for (const name of fs.readdirSync(cache)) if (name.startsWith('ruflo-')) {
        for (const version of fs.readdirSync(path.join(cache, name))) if (/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) result.push(path.join(cache, name, version));
      }
    } catch { /* absent */ }
  }
  return result;
}
export function discover() {
  const roots = [...rufloRoots(), ...brainSurfaces({ includeOwned: true, allowMissingActive: true,
    ownedMarkers: ['/hook-failure-log/runtime.cjs'], ownedRelatives: ['hooks/hooks.json', 'hooks/codex-hooks.json'] }).filter(s => s.kind === 'full').map(s => s.root)];
  const files = new Set();
  for (const root of roots) for (const relative of ['hooks/hooks.json', 'hooks/codex-hooks.json']) {
    const file = path.join(root, relative);
    try {
      if (fs.lstatSync(root).isSymbolicLink() || existingPathRelative(root, file) === null || fs.lstatSync(file).isSymbolicLink()) continue;
      if (commands(fs.readFileSync(file, 'utf8')).length) files.add(file);
    } catch { /* missing hook manifest */ }
  }
  return [...files];
}
export const descriptor = { name: NAME, atomic: true, discover, patchSource, hasPatch, isPatched, reverse: reverseSource };
