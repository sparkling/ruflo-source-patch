// Brain #420: recognize exact published wrappers during native host convergence.
// The native updater still owns replacement, scheduling and generation selection.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { discover as discoverInstallers } from '../brain-console-lifecycle/discovery.mjs';
export const NAME = 'brain-wrapper-ownership';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#420)';
// Independently fetched from public release tags. No local cache establishes trust.
// v4.5.16 blob 9061b34ad3436857124debf0135498a80994de48;
// v4.5.17/v4.6.0/v4.6.1 blob dcdcf18abd1cbb7983cc73bcaa98236b1edc5eed.
export const HASHES = [
  'd3ee284722aadd9699ba7b7ece624cd59c5dd4a773cd2d7300340d1a662d0a15',
  'ea953c7329ea7c99ad681ae216a2bc537ff9ae3d75a1bb8b5ab69706df9ea6d3',
];
const anchor = "    if (fs.readFileSync(wrapperPath).equals(fs.readFileSync(source))) return { state: 'verified' };";
const replacement = `    // ${PATCH_MARKER}: published historical bytes only; native ownership guards above remain mandatory.
    const wrapperBytes = fs.readFileSync(wrapperPath);
    if (wrapperBytes.equals(fs.readFileSync(source))
      || ${JSON.stringify(HASHES)}.includes(crypto.createHash('sha256').update(wrapperBytes).digest('hex')))
      return { state: 'verified' };`;
const count = (s, needle) => s.split(needle).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => count(source, replacement) === 1
  && nativeOwnership(source.replace(replacement, anchor));
const nativeOwnership = source => {
  const start = source.indexOf('function legacyBrainWrapperOwnership(');
  const end = source.indexOf('\nexport function wireCodexHost', start);
  const body = end < 0 ? source.slice(start) : source.slice(start, end);
  return start >= 0 && createHash('sha256').update(body).digest('hex') === 'c1c385c2cdbf296e145240ef9c386e752e235eee68cf9b666987863534208b7e';
};
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || count(source, anchor) !== 1 || !nativeOwnership(source))
    return { next: source, applied: [], missing: ['unique-native-wrapper-ownership-anchor'] };
  return { next: source.replace(anchor, replacement), applied: [NAME], missing: [] };
}
export const reverseSource = source => source.replace(replacement, anchor);
export const discover = () => discoverInstallers({ ownedMarker: PATCH_MARKER, allInstallerVersions: true })
  .filter(file => file.endsWith('/bin/install.mjs')
    && fs.readFileSync(file, 'utf8').includes('function legacyBrainWrapperOwnership('));
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource };
