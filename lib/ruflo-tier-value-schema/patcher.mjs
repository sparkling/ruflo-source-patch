// Ruflo #4892: publish the existing native tier value contract; never truncate or raise it.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { validatorQualified } from '../ruflo-aidefence-schema/patcher.mjs';

export const NAME = 'ruflo-tier-value-schema';
export const MARKER = 'ruflo-source-patch (#4892)';
export const ANCHOR = "            value: { type: 'string', description: 'Memory entry value' },";
export const DESCRIPTION = 'Memory entry value, non-empty and at most 10000 UTF-16 code units (JavaScript string.length). JSON Schema maxLength counts Unicode code points; native validation additionally enforces the UTF-16 bound. Values are never truncated automatically.';
export const NATIVE = `            value: { type: 'string', minLength: 1, maxLength: 10000, description: '${DESCRIPTION}' },`;
export const REPLACEMENT = NATIVE + ` // ${MARKER}`;
export const OLD_ERROR = "error: 'value is required (non-empty string, max 100KB)'";
export const ERROR = "error: 'value is required (non-empty string, max 10000 UTF-16 code units)'";
export const GUARD = `            const vValue = validateText(params.value, 'value');
            if (!vValue.valid)
                return { success: false, error: vValue.error };`;
const count = (source, text) => source.split(text).length - 1;
const block = source => {
  const start = 'export const agentdbHierarchicalStore = {', end = '\n// ===== agentdb_hierarchical_recall';
  return count(source, start) === 1 && count(source, end) === 1
    ? source.slice(source.indexOf(start), source.indexOf(end)) : '';
};
const qualified = (source, schema, error) => {
  const body = block(source);
  return count(body, schema + '\n') === 1 && count(body, error) === 1 && count(body, GUARD) === 1
    && body.indexOf(GUARD) < body.indexOf('const bridge = await getBridge();')
    && body.includes("const value = validateString(params.value, 'value');")
    && source.includes(`function validateString(value, name, maxLen = MAX_STRING_LENGTH) {
    if (typeof value !== 'string' || value.length === 0)
        return null;
    if (value.length > maxLen)
        return null;
    return value;
}`) && source.includes('const MAX_STRING_LENGTH = 100_000;');
};
export const hasPatch = source => source.includes(MARKER);
export const nativeSatisfied = source => !hasPatch(source) && qualified(source, NATIVE, ERROR);
export const isPatched = source => nativeSatisfied(source)
  || count(source, MARKER) === 1 && qualified(source, REPLACEMENT, ERROR);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || !qualified(source, ANCHOR, OLD_ERROR))
    return { next: source, applied: [], missing: ['native-tier-value-schema-and-guards'] };
  const before = block(source), after = before.replace(ANCHOR, REPLACEMENT).replace(OLD_ERROR, ERROR);
  return { next: source.replace(before, () => after), applied: [NAME], missing: [] };
}
export const reverse = source => hasPatch(source) && isPatched(source)
  ? source.replace(REPLACEMENT, ANCHOR).replace(ERROR, OLD_ERROR) : source;
export const discover = () => discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'agentdb-tools.js']);
export function preflight(files = discover()) {
  const errors = [], blockedFiles = [];
  for (const file of files) try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe AgentDB tool source');
    if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unproved tier value schema/guards');
    let validator = fs.readFileSync(path.join(path.dirname(file), 'validate-input.js'), 'utf8');
    if (!validator.includes('export function validateText(')) {
      if (!validator.includes("export * from '@claude-flow/cli-core/mcp-tools/validate-input';"))
        throw Error('unproved native validator delegation');
      validator = fs.readFileSync(createRequire(file).resolve('@claude-flow/cli-core/mcp-tools/validate-input'), 'utf8');
    }
    if (!validatorQualified(validator)) throw Error('unproved native UTF-16 value bound');
  } catch (error) { errors.push(`${file}: ${error.message}`); blockedFiles.push(file); }
  return { ok: !errors.length, errors, ...(errors.length ? { blockedFiles } : {}) };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse };
