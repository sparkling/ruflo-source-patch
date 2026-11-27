// #5145: ADR-524 stdio has no modern subscriptions/listen implementation.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';

export const NAME = 'ruflo-mcp-subscriptions';
export const MARKER = 'ruflo-source-patch (#5145)';
const digest = source => createHash('sha256').update(source).digest('hex');
// Qualified dependency-free protocol module, identical on the two installed hosts.
const PRISTINE = '54634580e40ca6b1d7fb50e3135bafb6fd1383ff9803ff287b823d1cebc3f9be';
export const ANCHOR = 'function discoverResponse(id, capabilities, identity) {\n    return {';
export const REPLACEMENT = `function discoverResponse(id, capabilities, identity) {
    // ${MARKER}: static catalog; legacy initialize retains its notification contract.
    capabilities = { ...capabilities };
    if (capabilities.tools) {
        capabilities.tools = { ...capabilities.tools };
        delete capabilities.tools.listChanged;
    }
    return {`;
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(MARKER);
export const isPatched = source => count(source, REPLACEMENT) === 1
  && digest(source.replace(REPLACEMENT, ANCHOR)) === PRISTINE;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (digest(source) !== PRISTINE || count(source, ANCHOR) !== 1)
    return { next: source, applied: [], missing: ['qualified-adr524-protocol'] };
  return { next: source.replace(ANCHOR, REPLACEMENT), applied: [NAME], missing: [] };
}
export const reverse = source => isPatched(source) ? source.replace(REPLACEMENT, ANCHOR) : source;
export const discover = () => discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'mcp-protocol.js']);
export function preflight(files = discover()) {
  const errors = [], blockedFiles = [];
  for (const file of files) try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('unsafe protocol source');
    if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unqualified protocol revision');
    const root = path.resolve(path.dirname(file), '../..');
    for (const relative of ['bin/cli.js', 'bin/mcp-server.js', 'dist/src/mcp-server.js']) {
      const caller = fs.readFileSync(path.join(root, relative), 'utf8');
      if (!caller.includes('protocolPreflight(') || !caller.includes('mcp-protocol.js')
        || !/tools: \{ listChanged: true \},\s*resources: \{\}/.test(caller)
        || caller.includes('subscriptions/listen')) throw Error(`unqualified stdio caller ${relative}`);
    }
  } catch (error) { errors.push(`${file}: ${error.message}`); blockedFiles.push(file); }
  return { ok: !errors.length, errors, ...(errors.length ? { blockedFiles } : {}) };
}
// New native implementations must be qualified before retirement; unknown bytes refuse.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse };
