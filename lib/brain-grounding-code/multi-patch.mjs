// Brain #373: keep the native code projector, but select its exact Add File operation.
// The host adapter independently gates every path; no sibling operation grants an exemption.
export const MULTI_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#373 per-file grounding)';
export const MULTI_ANCHOR = "    const lines = input.new_string.trimEnd().split(/\\r?\\n/);";
export const MULTI_REPLACEMENT = `    // ${MULTI_MARKER}
    let lines = input.new_string.trimEnd().split(/\\r?\\n/);
    if (lines[0] !== '*** Begin Patch' || lines.at(-1) !== '*** End Patch') throw new Error('Ambiguous patch');
    const additions = new Map();
    let current;
    for (const line of lines.slice(1, -1)) {
      const header = /^\\*\\*\\* Add File: (.+)$/.exec(line);
      if (header) {
        const name = header[1];
        if (name !== name.trim() || additions.has(name)) throw new Error('Ambiguous patch');
        current = [line]; additions.set(name, current);
      } else if (current && line.startsWith('+')) current.push(line);
      else throw new Error('Ambiguous patch');
    }
    if (!additions.has(file)) throw new Error('Ambiguous patch');
    lines = ['*** Begin Patch', ...additions.get(file), '*** End Patch'];`;
const count = (source, part) => source.split(part).length - 1;
export const hasMultiPatch = source => source.includes(MULTI_MARKER);
export const isMultiPatched = source => count(source, MULTI_REPLACEMENT) === 1
  && count(source, MULTI_MARKER) === 1 && !source.includes(MULTI_ANCHOR);
export const reverseMultiPatch = source => source.replace(MULTI_REPLACEMENT, MULTI_ANCHOR);
export function patchMultiSource(source) {
  if (isMultiPatched(source)) return { next: source, applied: [], missing: [] };
  if (count(source, MULTI_ANCHOR) !== 1 || hasMultiPatch(source)) {
    return { next: source, applied: [], missing: ['per-file-grounding (absent, ambiguous or modified anchor)'] };
  }
  return { next: source.replace(MULTI_ANCHOR, MULTI_REPLACEMENT), applied: ['per-file-grounding'], missing: [] };
}
