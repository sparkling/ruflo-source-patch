// #3688: Claude Code's function-hook modules are not Codex command hooks.
// Project only the verified modules-only swarm manifest in Codex's copies;
// preserve the original module and every Claude Code copy.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import { existingPathRelative } from '../path-containment.mjs';

export const NAME = 'ruflo-swarm-codex-hooks';
export const MARKER = 'ruflo-source-patch (ruvnet/ruflo#3688)';
export const DESCRIPTION = "The live swarm pane: one tile per agent lit by its reads and writes, the topology, the task and claims board, cost and tokens, the router's last pick and hive-mind votes, with buttons that act through the ruflo CLI. Without function hooks nothing here loads and the plugin's commands, skills and agents behave as before.";
const NOTICE = `${MARKER}: Claude Code function-hook modules are unsupported in Codex; commands, skills, agents and the module source remain unchanged.`;
const DESCRIPTION_ANCHOR = `  "description": ${JSON.stringify(DESCRIPTION)},`;
const DESCRIPTION_REPLACEMENT = `  "description": ${JSON.stringify(`${DESCRIPTION} ${NOTICE}`)},`;
const MODULE_ANCHOR = '  "modules": ["./register.ts"]';
const MODULE_REPLACEMENT = '  "hooks": {}';
const PLUGIN = 'ruflo-swarm';
const VERSION = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
const CODEX_HOME = process.env.RSP_CODEX_HOME || (process.env.RUFLO_SOURCE_PATCH_HOME
  ? path.join(HOME_BASE, '.codex') : process.env.CODEX_HOME || path.join(HOME_BASE, '.codex'));
const MARKETPLACE = process.env.RSP_RUFLO_CODEX_MARKETPLACE
  || path.join(CODEX_HOME, '.tmp', 'marketplaces', 'ruflo');
const CACHE = path.join(CODEX_HOME, 'plugins', 'cache', 'ruflo', PLUGIN);
const parse = (source) => { try { return JSON.parse(source); } catch { return null; } };
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const count = (source, anchor) => source.split(anchor).length - 1;

// A bounded native replacement proof: an empty command-hook manifest has no
// unsupported engine dependency. Nonempty new hooks require a separate review.
export function isNativeSchema(source) {
  const value = parse(source);
  return object(value) && Object.keys(value).every((key) => ['description', 'hooks'].includes(key))
    && (value.description === undefined || typeof value.description === 'string')
    && object(value.hooks) && Object.keys(value.hooks).length === 0 && !hasPatch(source)
    && [...source.matchAll(/"hooks"\s*:/g)].length === 1
    && [...source.matchAll(/"description"\s*:/g)].length <= 1;
}
export const hasPatch = (source) => source.includes(MARKER);
export function isPatched(source) {
  if (isNativeSchema(source)) return true;
  const value = parse(source);
  return object(value) && Object.keys(value).join(',') === 'description,hooks'
    && value.description === `${DESCRIPTION} ${NOTICE}` && object(value.hooks)
    && Object.keys(value.hooks).length === 0
    && count(source, DESCRIPTION_REPLACEMENT) === 1 && count(source, MODULE_REPLACEMENT) === 1;
}
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const value = parse(source);
  const known = object(value) && Object.keys(value).join(',') === 'description,modules'
    && value.description === DESCRIPTION && JSON.stringify(value.modules) === '["./register.ts"]'
    && !hasPatch(source) && count(source, DESCRIPTION_ANCHOR) === 1 && count(source, MODULE_ANCHOR) === 1
    && [...source.matchAll(/"modules"\s*:/g)].length === 1;
  if (!known) return { next: source, applied: [], missing: ['known-Claude-only-swarm-function-module'] };
  const next = source.replace(DESCRIPTION_ANCHOR, DESCRIPTION_REPLACEMENT).replace(MODULE_ANCHOR, MODULE_REPLACEMENT);
  if (!isPatched(next)) return { next: source, applied: [], missing: ['strict-Codex-projection-proof'] };
  return { next, applied: ['strict-Codex-no-op-manifest'], missing: [] };
}
export const reverseSource = (source) => source.replace(DESCRIPTION_REPLACEMENT, DESCRIPTION_ANCHOR)
  .replace(MODULE_REPLACEMENT, MODULE_ANCHOR);

function roots() {
  const result = [{ root: path.join(MARKETPLACE, 'plugins', PLUGIN), owner: MARKETPLACE }];
  try {
    for (const entry of fs.readdirSync(CACHE)) {
      if (VERSION.test(entry)) result.push({ root: path.join(CACHE, entry), owner: CACHE, version: entry });
    }
  } catch { /* no installed Codex cache */ }
  return result.filter(({ root }) => fs.existsSync(path.join(root, 'hooks', 'hooks.json')));
}
export const discover = () => [...new Set(roots().map(({ root }) => path.join(root, 'hooks', 'hooks.json')))];
function regular(owner, file) {
  const relative = existingPathRelative(owner, file);
  if (relative === null || relative === '') throw new Error(`swarm file escapes selected Codex owner: ${file}`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`unsafe or empty swarm file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}
export function preflight() {
  const errors = [];
  for (const { root, owner, version } of roots()) {
    try {
      if (existingPathRelative(owner, root) === null) throw new Error(`swarm root escapes selected Codex owner: ${root}`);
      const manifest = parse(regular(root, path.join(root, '.claude-plugin', 'plugin.json')));
      if (manifest?.name !== PLUGIN || !VERSION.test(manifest?.version || '')
          || (version && manifest.version !== version)) throw new Error(`unverified swarm plugin identity: ${root}`);
      const source = regular(root, path.join(root, 'hooks', 'hooks.json'));
      const transformed = patchSource(source);
      if (transformed.missing.length) throw new Error(`unrecognized swarm hook manifest: ${root}`);
      if (!isNativeSchema(source)) {
        const module = regular(root, path.join(root, 'hooks', 'register.ts'));
        if (!/import\s+type\s*\{[^}]*EngineInterface[^}]*\}\s*from\s*['"]claude-code['"]/.test(module)) {
          throw new Error(`swarm module no longer proves its Claude Code engine dependency: ${root}`);
        }
      }
    } catch (error) { errors.push(error.message); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource, preflight };

export function probeNativeSwarmHooksReplacement() {
  const files = discover();
  const checked = preflight();
  if (!checked.ok || !files.length) return { state: 'unknown', evidence: checked.errors.join('; ') || 'no installed Codex swarm hook manifests to prove' };
  if (files.some((file) => !isNativeSchema(fs.readFileSync(file, 'utf8')))) {
    return { state: 'live', evidence: 'installed Codex swarm copies still require the Claude-only module projection' };
  }
  return { state: 'superseded', evidence: `all ${files.length} verified Codex swarm copies publish native empty command-hook manifests without the #3688 patch` };
}
