// Ruflo #4887: advertise existing lifecycle identifier validation; no ID rewriting.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';

export const NAME = 'ruflo-hook-id-schema';
export const MARKER = 'ruflo-source-patch (#4887)';
export const RETIREMENT = 'Retire after pristine native schemas pass the same identifier/optional-field equivalence proof against their native validator; never remove or weaken the runtime guard.';
const sha = value => createHash('sha256').update(value).digest('hex');
const count = (source, text) => source.split(text).length - 1;
export const FIELDS = [
  ['taskId', 'Task identifier'],
  ['agent', 'Agent that completed the task'],
  ['parentAgentId', "ID of the parent agent (from Claude Code\\'s parent_agent_id OTel span tag / x-claude-code-parent-agent-id header). Omit for top-level work."],
];
export const edits = FIELDS.map(([name, description]) => {
  const old = `            ${name}: { type: 'string', description: '${description}' },`;
  const pattern = '^[a-zA-Z0-9_][a-zA-Z0-9_.:-]{0,127}$';
  const constraint = name === 'agent' ? `anyOf: [{ const: '' }, { pattern: '${pattern}' }]` : `pattern: '${pattern}'`;
  const detail = name === 'parentAgentId' ? 'Registered native parent agent ID; omit for top-level work.'
    : name === 'agent' ? 'Registered native agent ID; optional. An empty string retains native omitted-agent behavior.' : 'Native task identifier.';
  const next = `            ${name}: { type: 'string', minLength: ${name === 'agent' ? 0 : 1}, maxLength: 128,
                ${constraint}, not: { enum: ['__proto__', 'constructor', 'prototype'] },
                description: '${detail} Start with an ASCII letter, digit or underscore; remaining characters may also include hyphen, dot and colon. Slash-separated host agent paths are not native IDs; do not rewrite identity automatically.' },`;
  return [old, next + (name === 'taskId' ? ` // ${MARKER}` : '')];
});
const block = source => {
  const start = 'export const hooksPostTask = {', end = '\n    handler: async (params) => {';
  const i = source.indexOf(start), j = source.indexOf(end, i);
  return count(source, start) === 1 && j > i ? source.slice(i, j) : '';
};
const guards = source => ['taskId', 'agent', 'parentAgentId'].every(name =>
  source.slice(source.indexOf('export const hooksPostTask = {'), source.indexOf('        const depthRaw = params.depth;'))
    .includes(`const v = validateIdentifier(${name}, '${name}');\n            if (!v.valid)\n                return { success: false, error: v.error };`));
export const hasPatch = source => source.includes(MARKER);
export function nativeSatisfied(source) {
  const start = source.indexOf('const NATIVE_ID_BODY =');
  const end = source.indexOf('    handler: async (params) => {', start);
  return !hasPatch(source) && count(source, 'const NATIVE_ID_BODY =') === 1
    && count(source, 'export const hooksPostTask = {') === 1 && end > start
    && sha(source.slice(start, end)) === 'd0445a041b9771f5e33792c9a1e10cb9537457c68b82a67eff4ebe3c97d8ed30'
    && guards(source);
}
export const isPatched = source => nativeSatisfied(source)
  || count(source, MARKER) === 1 && guards(source)
    && edits.every(([, to]) => count(block(source), to) === 1);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const original = block(source);
  if (hasPatch(source) || !guards(source) || !edits.every(([from]) => count(original, from) === 1))
    return { next: source, applied: [], missing: ['native-post-task-identifier-schema-and-guards'] };
  const next = edits.reduce((value, [from, to]) => value.replace(from, () => to), original);
  return { next: source.replace(original, () => next), applied: [NAME], missing: [] };
}
export const reverse = source => hasPatch(source) && isPatched(source)
  ? edits.reduceRight((value, [from, to]) => value.replace(to, () => from), source) : source;
export const discover = () => discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'hooks-tools.js']);
export function preflight(files = discover()) {
  const errors = [], blockedFiles = [];
  for (const file of files) try {
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw Error('unsafe hooks source');
    if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unproved post-task schema/guards');
    const shim = fs.readFileSync(path.join(path.dirname(file), 'validate-input.js'), 'utf8');
    if (sha(shim) !== '2c9c49c02a0600bad639cc065e238b84edc05824e6b98bfa8d02a011c38e4f82')
      throw Error('unproved native reserved-name validator');
    const core = fs.readFileSync(createRequire(file).resolve('@claude-flow/cli-core/mcp-tools/validate-input'), 'utf8');
    if (sha(core.slice(0, core.indexOf('/**\n * Validate a git ref'))) !== 'f8fafb7475bddcf81f7548b058d5bb6d8d4e015ca497166fe3e56d8bd83b9b34')
      throw Error('unproved native identifier validator');
  } catch (error) { errors.push(`${file}: ${error.message}`); blockedFiles.push(file); }
  return { ok: !errors.length, errors, ...(errors.length ? { blockedFiles } : {}) };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse };
