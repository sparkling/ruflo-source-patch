// #3688: Claude Code's function-hook modules are not Codex command hooks.
// Project only verified plugin manifests in Codex's copies; preserve existing
// command hooks, the original module and every Claude Code copy.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import { existingPathRelative } from '../path-containment.mjs';
import { patchSource as applyLogger, reverseSource as reverseLogger } from '../hook-failure-log/patcher.mjs';
import { MANIFESTS, METAHARNESS_040_MANIFEST } from './manifests.mjs';

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
const projections = [...Object.entries(MANIFESTS), ['ruflo-metaharness', METAHARNESS_040_MANIFEST]].map(([plugin, source]) => {
  const value = JSON.parse(source);
  const next = JSON.stringify({ description: `${value.description} ${NOTICE}`, hooks: value.hooks || {} }, null, 2) + '\n';
  return { plugin, source, next, edit: value.hooks ? 'strict-Codex-command-manifest' : 'strict-Codex-no-op-manifest' };
});
const parse = (source) => { try { return JSON.parse(source); } catch { return null; } };
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const count = (source, anchor) => source.split(anchor).length - 1;

// Only the sibling owner's exact reversible wrapper may surround a reviewed command.
function withoutLogger(source) {
  try {
    const plain = reverseLogger(source);
    if (plain === source) return source;
    const wrapped = applyLogger(plain);
    return !wrapped.missing.length && wrapped.next === source ? plain : source;
  } catch { return source; } // malformed hook groups remain unknown input
}

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
export function isPatched(source, file) {
  try { if (file && nativeSelection(surfaceForFile(file))) return !hasPatch(source); }
  catch { return false; }
  source = withoutLogger(source);
  if (projections.some(entry => entry.next === source)) return true;
  if (isNativeSchema(source)) return true;
  const value = parse(source);
  return object(value) && Object.keys(value).join(',') === 'description,hooks'
    && value.description === `${DESCRIPTION} ${NOTICE}` && object(value.hooks)
    && Object.keys(value.hooks).length === 0
    && count(source, DESCRIPTION_REPLACEMENT) === 1 && count(source, MODULE_REPLACEMENT) === 1;
}
function projectSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const plain = withoutLogger(source);
  const knownModule = projections.find(entry => entry.source === plain);
  if (knownModule) return { next: plain === source ? knownModule.next : applyLogger(knownModule.next).next,
    applied: [knownModule.edit], missing: [] };
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
export function reverseSource(source) {
  const plain = withoutLogger(source);
  const projection = projections.find(entry => entry.next === plain);
  if (projection) return plain === source ? projection.source : applyLogger(projection.source).next;
  return hasPatch(source) && isPatched(source)
    ? source.replace(DESCRIPTION_REPLACEMENT, DESCRIPTION_ANCHOR).replace(MODULE_REPLACEMENT, MODULE_ANCHOR) : source;
}

// Keep the old projection as an exact historical composition after a host starts
// selecting its native manifest. Source-only callers retain their old behavior.
export const historicalPatchSource = (source) => projectSource(source);
export function patchSource(source, file) {
  if (!file || !nativeSelection(surfaceForFile(file))) return projectSource(source);
  if (!hasPatch(source)) return { next: source, applied: [], missing: [] };
  const next = reverseSource(source);
  if (next === source || projectSource(next).next !== source) {
    return { next: source, applied: [], missing: ['exact-unselected-module-projection'] };
  }
  return { next, applied: ['restore-unselected-Claude-manifest'], missing: [] };
}

function roots() {
  const result = [];
  for (const plugin of [PLUGIN, ...Object.keys(MANIFESTS)]) {
    result.push({ root: path.join(MARKETPLACE, 'plugins', plugin), owner: MARKETPLACE, plugin });
    const cache = path.join(path.dirname(CACHE), plugin);
    try {
      for (const entry of fs.readdirSync(cache)) {
        if (VERSION.test(entry)) result.push({ root: path.join(cache, entry), owner: cache, version: entry, plugin });
      }
    } catch { /* no installed Codex cache */ }
  }
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

function surfaceForFile(file) {
  const surface = roots().find(({ root }) => existingPathRelative(root, file) === path.join('hooks', 'hooks.json'));
  if (!surface) throw new Error(`unverified Codex hook surface: ${file}`);
  return surface;
}

// These released native guards are already selected by their host manifest. We
// do not replace, execute, or reinterpret them; the logger's exact wrapper is
// the only accepted local composition of these command declarations.
function nativeCommandSchema(source, plugin) {
  const name = { 'ruflo-adr': 'ADR', 'ruflo-ddd': 'DDD', 'ruflo-sparc': 'SPARC' }[plugin];
  if (!name) return false;
  const hooks = Object.fromEntries(['SessionStart', 'PreToolUse'].map(event => [event, [{ hooks: [{
    type: 'command', command: `node "${'${PLUGIN_ROOT}'}/hooks/codex-hook.cjs" ${event}`, timeout: 5,
  }] }]]));
  return source === JSON.stringify({
    description: `Native Codex ${name} secret guard and session status; Claude module hooks remain separate.`, hooks,
  }, null, 2) + '\n';
}

function nativeSelection({ root, owner, version, plugin }) {
  if (existingPathRelative(owner, root) === null) throw new Error(`swarm root escapes selected Codex owner: ${root}`);
  const codex = path.join(root, '.codex-plugin', 'plugin.json');
  try { fs.lstatSync(codex); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  const source = regular(root, codex), manifest = parse(source);
  const claude = parse(regular(root, path.join(root, '.claude-plugin', 'plugin.json')));
  if (manifest?.name !== plugin || !VERSION.test(manifest?.version || '')
      || manifest.version !== claude?.version || (version && manifest.version !== version)) {
    throw new Error(`unverified Codex plugin identity: ${root}`);
  }
  if ([...source.matchAll(/"hooks"\s*:/g)].length !== 1
      || !['./hooks/hooks.json', './hooks/codex-hooks.json'].includes(manifest.hooks)) {
    throw new Error(`unrecognized Codex hooks selector: ${root}`);
  }
  if (manifest.hooks === './hooks/hooks.json') return false;
  const selected = withoutLogger(regular(root, path.resolve(root, manifest.hooks)));
  if (isNativeSchema(selected)) return true;
  if (!nativeCommandSchema(selected, plugin)) throw new Error(`unverified selected native Codex hooks: ${root}`);
  regular(root, path.join(root, 'hooks', 'codex-hook.cjs'));
  return true;
}
export function preflight() {
  const errors = [];
  for (const { root, owner, version, plugin } of roots()) {
    try {
      if (existingPathRelative(owner, root) === null) throw new Error(`swarm root escapes selected Codex owner: ${root}`);
      const manifest = parse(regular(root, path.join(root, '.claude-plugin', 'plugin.json')));
      if (manifest?.name !== plugin || !VERSION.test(manifest?.version || '')
          || (version && manifest.version !== version)) throw new Error(`unverified swarm plugin identity: ${root}`);
      const source = regular(root, path.join(root, 'hooks', 'hooks.json'));
      const native = nativeSelection({ root, owner, version, plugin });
      const transformed = patchSource(source, path.join(root, 'hooks', 'hooks.json'));
      if (transformed.missing.length) throw new Error(`unrecognized swarm hook manifest: ${root}`);
      if (native && !hasPatch(source)) continue;
      const backup = path.join(root, 'hooks', 'hooks.json.rsp-backup');
      if (native && fs.existsSync(backup) && fs.statSync(backup).size > 0) {
        const saved = regular(root, backup);
        if (hasPatch(saved) || withoutLogger(projectSource(saved).next) !== withoutLogger(source)) {
          throw new Error(`unproved historical Codex projection: ${root}`);
        }
      }
      if (!isNativeSchema(source)) {
        const original = withoutLogger(hasPatch(source) ? reverseSource(source) : source);
        if (plugin !== PLUGIN && !projections.some(entry => entry.plugin === plugin && entry.source === original)) {
          throw new Error(`module manifest identity mismatch: ${root}`);
        }
        const module = regular(root, path.join(root, 'hooks', 'register.ts'));
        if (!/import\s+type\s*\{[^}]*(?:EngineInterface|Hook|Register)[^}]*\}\s*from\s*['"]claude-code['"]/.test(module)) {
          throw new Error(`swarm module no longer proves its Claude Code engine dependency: ${root}`);
        }
      }
    } catch (error) { errors.push(error.message); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, fileContext: true,
  discover, patchSource, historicalPatchSource, hasPatch, isPatched, reverse: reverseSource, preflight,
  recover: source => ({ candidate: reverseSource(source), verify: pristine => projectSource(pristine).next }) };

export function probeNativeSwarmHooksReplacement() {
  const files = discover();
  const checked = preflight();
  if (!checked.ok || !files.length) return { state: 'unknown', evidence: checked.errors.join('; ') || 'no installed Codex swarm hook manifests to prove' };
  if (files.some((file) => !nativeSelection(surfaceForFile(file)) && !isNativeSchema(fs.readFileSync(file, 'utf8')))) {
    return { state: 'live', evidence: 'installed Codex swarm copies still require the Claude-only module projection' };
  }
  return { state: 'superseded', evidence: `all ${files.length} verified Codex plugin surfaces select native command-hook manifests without requiring the #3688 projection` };
}
