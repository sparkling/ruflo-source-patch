// Brain #526: apply the native inspection bound while reading, not after a whole line.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';

export const NAME = 'brain-policy-input';
export const MARKER = 'ruflo-source-patch brain#526';
export const SPECS = [
  { relative: 'scripts/protect-brain-state.sh', cap: 65536 },
  { relative: 'scripts/ground-before-write.sh', cap: 65536 },
  { relative: 'scripts/hijack-ruvnet.sh', cap: 32768 },
];
const anchor = 'while IFS= read -r -t 2 _l; do';
// Bash 3 counts multibyte input differently in read -n and substring expansion.
// Bound work by the maximum UTF-8 width plus one boundary character, then retain
// the native substring below. This must never shorten the inspected prefix.
const replacement = cap => `# ${MARKER}: bound read work by the remaining native inspection capacity.
while IFS= read -r -t 2 -n "$(( 4 * (${cap} - \${#INPUT}) + 4 ))" _l; do`;
const count = (source, text) => source.split(text).length - 1;
const capOf = source => [65536, 32768].find(cap =>
  count(source, `INPUT="\${INPUT:0:${cap}}"`) === 1
  && count(source, `[ \${#INPUT} -ge ${cap} ] && break`) === 1);
export const hasPatch = source => source.includes(MARKER);
export const isPatched = source => !!capOf(source)
  && count(source, replacement(capOf(source))) === 1 && count(source, anchor) === 0;
export const reverseSource = source => [65536, 32768]
  .reduce((s, cap) => s.replace(replacement(cap), anchor), source);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const cap = capOf(source);
  if (!cap || hasPatch(source) || count(source, anchor) !== 1)
    return { next: source, applied: [], missing: ['native bounded shell input loop'] };
  return { next: source.replace(anchor, replacement(cap)), applied: [NAME], missing: [] };
}
const surfaces = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [MARKER], ownedRelatives: SPECS.map(s => s.relative),
  requiredRelatives: ['scripts/hook-input.mjs', 'mcp/server.mjs'],
}).filter(surface => surface.kind === 'full');
export const discover = () => surfaces().flatMap(surface =>
  SPECS.map(spec => path.join(surface.root, spec.relative)));
export function preflight() {
  const errors = [];
  for (const surface of surfaces()) for (const spec of SPECS) {
    const file = path.join(surface.root, spec.relative);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
          || existingPathRelative(surface.root, file) === null) throw Error('unsafe policy source');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length)
        throw Error('native shell inspection anchors do not match');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
// Retire on native bounded-read work, byte-equivalent inspection and preserved refusal proofs.
// Existing content limits remain; this target does not claim complete large-content inspection.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
