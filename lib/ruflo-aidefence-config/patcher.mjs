// Ruflo #4785: expose the native packs option once at the MCP server boundary.
import fs from 'node:fs';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { reviewedBoundary } from '../brain-native/reviewed-source.mjs';

export const NAME = 'ruflo-aidefence-config';
export const MARKER = 'ruflo-source-patch (#4785)';
export const CONFIG_ANCHOR = '// Lazy-loaded AIDefence instance\nlet aidefenceInstance = null;';
export const CONFIG_REPLACEMENT = `// ${MARKER}: server startup configuration; native built-ins and PII stay active.
const rspAIDefenceOptions = (() => {
    const packs = process.env.RUFLO_AIDEFENCE_PACKS;
    if (packs === undefined) return { enableLearning: true };
    if (packs !== 'true' && packs !== 'false')
        throw new Error('RUFLO_AIDEFENCE_PACKS must be "true" or "false", or omitted');
    return { enableLearning: true, packs: packs === 'true' };
})();
${CONFIG_ANCHOR}`;
export const CREATE_ANCHOR = 'aidefence.createAIDefence({ enableLearning: true })';
export const CREATE_REPLACEMENT = 'aidefence.createAIDefence(rspAIDefenceOptions)';
const count = (source, part) => source.split(part).length - 1;
export const hasPatch = source => source.includes(MARKER);
// Qualified native 3.72.2 selector and complete lazy loader; no version-based acceptance.
export const nativeSatisfied = source => !hasPatch(source)
  && !source.includes('rspAIDefenceOptions') && !source.includes(CREATE_ANCHOR)
  && count(source, 'aidefence.createAIDefence(aidefenceOptions())') === 3
  && reviewedBoundary(source, '// Lazy-loaded AIDefence instance\n',
    '/**\n * Scan input for AI manipulation threats\n */',
    '965c95aa7fb502b5327f0902e05f3645955a7a085a0c58e487c3456d4e94f893');
export const isPatched = source => nativeSatisfied(source) || count(source, MARKER) === 1
  && count(source, CONFIG_REPLACEMENT) === 1 && count(source, CREATE_REPLACEMENT) === 3
  && !source.includes(CREATE_ANCHOR);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || source.includes('RUFLO_AIDEFENCE_PACKS') || source.includes('rspAIDefenceOptions')
    || count(source, CONFIG_ANCHOR) !== 1 || count(source, CREATE_ANCHOR) !== 3)
    return { next: source, applied: [], missing: ['native-aidefence-server-config-anchors'] };
  return { next: source.replace(CONFIG_ANCHOR, CONFIG_REPLACEMENT).replaceAll(CREATE_ANCHOR, CREATE_REPLACEMENT),
    applied: [NAME], missing: [] };
}
export const reverse = source => isPatched(source)
  ? source.replaceAll(CREATE_REPLACEMENT, CREATE_ANCHOR).replace(CONFIG_REPLACEMENT, CONFIG_ANCHOR) : source;
export const discover = () => discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'security-tools.js']);
export function preflight(files = discover()) {
  const errors = [], blockedFiles = [];
  for (const file of files) try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe security-tools source');
    if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unproved AIDefence startup configuration anchors');
  } catch (error) { errors.push(`${file}: ${error.message}`); blockedFiles.push(file); }
  return { ok: !errors.length, errors, ...(errors.length ? { blockedFiles } : {}) };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse };
