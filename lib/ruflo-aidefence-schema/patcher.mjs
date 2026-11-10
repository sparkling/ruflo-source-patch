// Ruflo #4886: advertise the existing native scan bound without changing detection.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';

export const NAME = 'ruflo-aidefence-schema';
export const MARKER = 'ruflo-source-patch (#4886)';
export const ANCHOR = `            input: {
                type: 'string',
                description: 'Text to scan for threats',
            },`;
export const DESCRIPTION = 'Text to scan for threats. Maximum 10000 UTF-16 code units (JavaScript string.length). The schema maxLength counts Unicode code points; native validation additionally enforces the UTF-16 bound. Each call scans only its supplied input; separate chunks are not a whole-document verdict.';
export const NATIVE = `            input: {
                type: 'string',
                maxLength: 10000,
                description: '${DESCRIPTION}',
            },`;
// Published 3.75.0, #4912: equivalent native contract, without our wording.
export const NATIVE_375 = NATIVE.replace(DESCRIPTION, 'Text to scan for threats. Max 10000 UTF-16 code units (JavaScript string length); longer input is refused. JSON Schema maxLength counts code points, so text with astral characters (emoji, some CJK) can pass this schema and still exceed the limit — each such character counts as 2.');
export const REPLACEMENT = NATIVE.replace('maxLength: 10000,', `maxLength: 10000, // ${MARKER}`);
export const GUARD = `            const v = validateText(args.input, 'input');
            if (!v.valid)
                return { content: [{ type: 'text', text: JSON.stringify({ error: v.error }) }], isError: true };`;
const count = (source, part) => source.split(part).length - 1;
const scanBlock = source => {
  const start = 'const aidefenceScanTool = {', end = '\nconst aidefenceAnalyzeTool = {';
  return count(source, start) === 1 && count(source, end) === 1
    ? source.slice(source.indexOf(start), source.indexOf(end)) : '';
};
const qualified = (source, schema) => {
  const block = scanBlock(source);
  return count(block, schema) === 1 && count(block, GUARD) === 1;
};
export const hasPatch = source => source.includes(MARKER);
export const nativeSatisfied = source => !hasPatch(source)
  && [NATIVE, NATIVE_375].some(schema => qualified(source, schema));
export const isPatched = source => nativeSatisfied(source)
  || count(source, MARKER) === 1 && qualified(source, REPLACEMENT);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || !qualified(source, ANCHOR) || count(source, ANCHOR) !== 1)
    return { next: source, applied: [], missing: ['native-scan-schema-and-validation'] };
  return { next: source.replace(ANCHOR, REPLACEMENT), applied: [NAME], missing: [] };
}
export const reverse = source => hasPatch(source) && isPatched(source)
  ? source.replace(REPLACEMENT, ANCHOR) : source;
export const discover = () => discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'security-tools.js']);
export function validatorQualified(source) {
  const start = source.indexOf('export function validateText(');
  const end = source.indexOf('\n/**', start);
  return count(source, 'export function validateText(') === 1 && end > start
    && createHash('sha256').update(source.slice(start, end)).digest('hex')
      === '95dd722b1b357e5ad131bc7fae8640ed4416176f5ceece746e80b7cc09d4df60';
}
export function preflight(files = discover()) {
  const errors = [], blockedFiles = [];
  for (const file of files) try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe security-tools source');
    if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unproved scan schema/guard');
    const shim = path.join(path.dirname(file), 'validate-input.js');
    let validator = fs.readFileSync(shim, 'utf8');
    if (!validator.includes('export function validateText(')) {
      if (!validator.includes("export * from '@claude-flow/cli-core/mcp-tools/validate-input';"))
        throw Error('unproved validator delegation');
      const resolved = createRequire(file).resolve('@claude-flow/cli-core/mcp-tools/validate-input');
      validator = fs.readFileSync(resolved, 'utf8');
    }
    if (!validatorQualified(validator)) throw Error('unproved native UTF-16 validator bound');
  } catch (error) { errors.push(`${file}: ${error.message}`); blockedFiles.push(file); }
  return { ok: !errors.length, errors, ...(errors.length ? { blockedFiles } : {}) };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse };
