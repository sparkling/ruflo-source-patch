// Brain #384: retain the native manifest owner behind the stable MCP shell.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { reviewedBoundary } from '../brain-native/reviewed-source.mjs';
import { probeNativeGeneration } from './native-probe.mjs';
import { existingPathRelative } from '../path-containment.mjs';
export const NAME = 'brain-managed-cli-generation';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#384)';
export const READ_ANCHOR = "const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };";
export const HELPER = `
// ${PATCH_MARKER}: help and execution share the actual native selected owner.
let managedGeneration = null;
let managedHelp = new Set();
function selectedManagedInterface() {
  const active = readJSON(ACTIVE);
  if (!active || typeof active.codeRoot !== 'string' || !active.codeRoot
    || typeof active.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(active.version)) throw new Error('invalid native managed CLI generation');
  const versions = fs.realpathSync(path.join(BRAIN_HOME, 'versions'));
  const root = fs.realpathSync(path.resolve(BRAIN_HOME, active.codeRoot));
  const inside = (owner, file) => { const rel = path.relative(owner, file); return rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
  if (!inside(versions, root)) throw new Error('managed CLI generation escapes native versions');
  const regular = relative => {
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !inside(root, fs.realpathSync(file))) throw new Error('unsafe native managed CLI member: ' + relative);
    return file;
  };
  const manifest = readJSON(regular('.claude-plugin/plugin.json'));
  if (manifest?.name !== 'ruvnet-brain' || manifest.version !== active.version) throw new Error('native managed CLI manifest identity mismatch');
  return pathToFileURL(regular('mcp/managed-cli-interface.mjs')).href;
}
async function callSelectedManagedCli(name, args) {
  try {
    const identity = selectedManagedInterface();
    if (managedGeneration !== identity) { managedGeneration = identity; managedHelp = new Set(); }
    refreshLease();
    const native = await import(identity);
    if (selectedManagedInterface() !== identity) throw new Error('native managed CLI generation changed; retry current help');
    if (typeof native.callManagedCli !== 'function' || typeof native.helpKey !== 'function'
      || typeof native.stampKeysForHelp !== 'function') throw new Error('native managed CLI interface is incomplete');
    if (name === 'ruvnet_cli_run' && !managedHelp.has(native.helpKey(args?.executable, args?.argv ?? []))) {
      return { isError: true, content: [{ type: 'text', text: 'Read the current native generation interface first with ruvnet_cli_help.' }] };
    }
    const keys = name === 'ruvnet_cli_help' ? native.stampKeysForHelp(args?.executable, args?.argv ?? []) : [];
    const result = await native.callManagedCli(name, args);
    if (name === 'ruvnet_cli_help' && result?.isError === false && managedGeneration === identity && selectedManagedInterface() === identity) {
      for (const key of keys) managedHelp.add(key);
    }
    return result;
  } catch (error) { return { isError: true, content: [{ type: 'text', text: 'Managed CLI generation refused: ' + error.message }] }; }
}
`;
export const EDITS = [
  ['native-module-url', "import { fileURLToPath } from 'node:url';", "import { fileURLToPath, pathToFileURL } from 'node:url';"],
  ['native-selected-owner', READ_ANCHOR, READ_ANCHOR + HELPER],
  ['managed-owner-dispatch', 'return clientOk(id, await callManagedCli(params.name, params.arguments || {}));',
    'return clientOk(id, await callSelectedManagedCli(params.name, params.arguments || {}));'],
];
// Native modular dispatch: source identity is necessary; preflight proves its actual siblings too.
export const nativeSatisfied = source => !hasPatch(source)
  && source.split("import { dispatchManagedCli } from './managed-cli-generation.mjs';").length === 2
  && reviewedBoundary(source, "      if (params?.name === 'ruvnet_cli_help' || params?.name === 'ruvnet_cli_run'", "      if (params?.name !== 'search_ruvnet')", 'd4e18d6b26e6dbe06bdaba038f6d4dda8a072279a04073bfc7c7ab47db9a6981');
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => nativeSatisfied(source) || count(source, PATCH_MARKER) === 1 && EDITS.every(([, , next]) => count(source, next) === 1);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || !EDITS.every(([, from]) => count(source, from) === 1)) {
    return { next: source, applied: [], missing: ['unique-native-selected-managed-cli-dispatch'] };
  }
  return { next: EDITS.reduce((body, [, from, next]) => body.replace(from, next), source), applied: EDITS.map(([id]) => id), missing: [] };
}
export const reverseSource = source => EDITS.reduceRight((body, [, from, next]) => body.replace(next, from), source);
export const surfaces = () => discoverBrain({ includeOwned: true, allowMissingActive: true, ownedMarkers: [PATCH_MARKER] });
export const discover = () => surfaces().map(surface => path.join(surface.root, 'mcp/server.mjs'));
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file), root = path.dirname(path.dirname(file));
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(root, file) === null) throw new Error('unsafe native server');
      const source = fs.readFileSync(file, 'utf8');
      if (nativeSatisfied(source)) {
        const proof = probeNativeGeneration(file);
        if (!proof.ok) throw new Error(proof.evidence);
      }
      if (patchSource(source).missing.length) throw new Error('native managed CLI generation anchors do not match');
    } catch (error) { errors.push(file + ': ' + error.message); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, transactionOwner: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource, preflight };
