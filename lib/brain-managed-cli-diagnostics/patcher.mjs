// Brain #386: retain terminal evidence alongside output and native receipts.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
import { reviewedBoundary } from '../brain-native/reviewed-source.mjs';
export const NAME = 'brain-managed-cli-diagnostics';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#386)';
export const SPECS = [
  { relative: 'mcp/managed-cli-interface.mjs', edits: [
    ['terminal-reason-with-output',
      "    const reason = result.error || (normalized.contradictoryFailure ? 'fatal output despite exit 0' : result.code == null ? 'no terminal exit status' : `exit ${result.code}`);\n    return {\n      content: [{ type: 'text', text: output || `${executable} ${argv.join(' ')} failed: ${reason}` }],",
      `    // ${PATCH_MARKER}: output cannot hide observed terminal evidence.\n    const reason = [result.error, result.signal ? \`signal \${result.signal}\` : null].filter(Boolean).join('; ')\n      || (normalized.contradictoryFailure ? 'fatal output despite exit 0' : result.code == null ? 'no terminal exit status' : \`exit \${result.code}\`);\n    return {\n      content: [{ type: 'text', text: [output, \`\${executable} \${argv.join(' ')} failed: \${reason}\`].filter(Boolean).join('\\n') }],`],
  ] },
  { relative: 'scripts/project-progression-hook.mjs', edits: [
    ['shared-observation-terminal-fields',
      '    if (stderr) observation.stderr = stderr;',
      `    if (stderr) observation.stderr = stderr;\n    // ${PATCH_MARKER}: the native snapshot redactor owns durable terminal details.\n    const error = boundedText(responseRecord.error);\n    const signal = boundedText(responseRecord.signal);\n    if (error) observation.error = error;\n    if (signal) observation.signal = signal;`],
  ] },
  { relative: 'scripts/capability-claim-evidence.mjs', edits: [
    ['native-terminal-redaction-import',
      "import path from 'node:path';",
      `import path from 'node:path';\n// ${PATCH_MARKER}: reuse native redaction before the existing receipt writer.\nimport { redactProgression } from './project-progression-contract.mjs';`],
    ['redacted-terminal-health-receipt',
      '      outputSha256: sha256(output),\n      ...fields,',
      `      outputSha256: sha256(output),\n      terminal: redactProgression({\n        ...(Number.isSafeInteger(execution?.code) || execution?.code === null ? { exitCode: execution.code } : {}),\n        ...(typeof execution?.error === 'string' && execution.error ? { error: execution.error.slice(0, 4096) } : {}),\n        ...(typeof execution?.signal === 'string' && execution.signal ? { signal: execution.signal.slice(0, 4096) } : {}),\n      }).value,\n      ...fields,`],
  ] },
];
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
const matching = (source, patched) => SPECS.filter(spec => spec.edits.every(([, from, next]) => count(source, patched ? next : from) === 1));
export const nativeSatisfied = source => !hasPatch(source) && (
  reviewedBoundary(source, 'function resultOf(', 'export async function callManagedCli(',
    '21ea7709c8fe2aab5856a3ebc123f617d7b5d74bcee6d4b4867d92a58f19a541')
  || reviewedBoundary(source, 'function toolAction(', 'export function enrichStateWithObservation(',
    'e625a479c9174fb1ebbf0aa9fd605a0fdff3decc571110880fcbeb56df7decb9')
  || reviewedBoundary(source, 'export function recordManagedCliObservation(', 'export function recordRegistryLatestObservation(',
    '51fbdc02d2a07b28f03622c136b660f9c1d89d4bfb23d2b978e2cd992513b15d'));
export const isPatched = source => nativeSatisfied(source)
  || (hasPatch(source) && count(source, PATCH_MARKER) === 1 && matching(source, true).length === 1);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const specs = matching(source, false);
  if (hasPatch(source) || specs.length !== 1) return { next: source, applied: [], missing: ['unique-native-terminal-diagnostics-bundle'] };
  return { next: specs[0].edits.reduce((body, [, from, next]) => body.replace(from, () => next), source),
    applied: specs[0].edits.map(([id]) => id), missing: [] };
}
export const reverseSource = source => SPECS.flatMap(spec => spec.edits).reduceRight((body, [, from, next]) => body.replace(next, () => from), source);
export const surfaces = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: SPECS.map(spec => spec.relative) });
export const discover = () => surfaces().flatMap(surface => SPECS.map(spec => path.join(surface.root, spec.relative)));
export function preflight() {
  const errors = [];
  for (const surface of surfaces()) for (const spec of SPECS) {
    const file = path.join(surface.root, spec.relative);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(surface.root, file) === null) throw Error('unsafe native diagnostic member');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('native terminal diagnostic anchors do not match');
    } catch (error) { errors.push(file + ': ' + error.message); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, transactionOwner: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource, preflight };
