// #373 recurrence has its own identity: the original code-grounding retirement stays terminal.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverGrounding } from './patcher.mjs';
import { nativeSatisfied, readNativeGroundingBundle } from './native.mjs';
import { probeGroundingCodeReplacement } from './probe.mjs';
import { hasMultiPatch, isMultiPatched, patchMultiSource, reverseMultiPatch } from './multi-patch.mjs';

export const NAME = 'brain-grounding-multifile';
export function discover() {
  return discoverGrounding().filter(file => path.basename(file) === 'ground-before-write.sh'
    && nativeSatisfied(fs.readFileSync(file, 'utf8')))
    .map(file => path.join(path.dirname(file), 'grounding-code-projection.mjs'));
}
export function preflight(files = discover()) {
  const errors = [];
  for (const file of files) try {
    readNativeGroundingBundle(path.join(path.dirname(file), 'ground-before-write.sh'));
    if (patchMultiSource(fs.readFileSync(file, 'utf8')).missing.length)
      throw Error('native per-file projection anchor is not proved');
  } catch (error) { errors.push(`${file}: ${error.message}`); }
  return { ok: errors.length === 0, errors };
}
export function applicability(files = discover()) {
  const proof = preflight(files);
  return proof.ok ? { state: 'applicable' } : { state: 'error', reason: proof.errors.join('; ') };
}
export const descriptor = {
  name: NAME, atomic: true, missingIsIncomplete: true, discover, preflight, applicability,
  patchSource: patchMultiSource, hasPatch: hasMultiPatch, isPatched: isMultiPatched,
  reverse: reverseMultiPatch,
};
export const probeMultifileReplacement = ({ files = discover() } = {}) => probeGroundingCodeReplacement({
  files: files.map(file => path.join(path.dirname(file), 'ground-before-write.sh')), multiFile: true,
});
