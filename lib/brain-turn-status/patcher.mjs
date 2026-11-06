import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { NATIVE } from './native.mjs';
import { turnRecordingStatus } from './runtime.mjs';
export const NAME = 'brain-turn-status';
export const MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#524 turn-status)';
export const REPLACEMENT = '// ' + MARKER + '\nexport ' + turnRecordingStatus.toString();
const count = (s,a) => s.split(a).length - 1;
export const hasPatch = s => s.includes(MARKER);
export const isPatched = s => count(s,REPLACEMENT) === 1 && count(s,'function turnRecordingStatus(') === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || count(source,NATIVE) !== 1 || count(source,'function turnRecordingStatus(') !== 1)
    return { next: source, applied: [], missing: ['reviewed-native-turn-status'] };
  return { next: source.replace(NATIVE,REPLACEMENT), applied: [NAME], missing: [] };
}
export const reverse = source => isPatched(source) ? source.replace(REPLACEMENT,NATIVE) : source;
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [MARKER], ownedRelatives: ['scripts/turn-outcome-capture.mjs'],
}).filter(surface => surface.kind === 'full').map(surface => path.join(surface.root, 'scripts/turn-outcome-capture.mjs'));
export function preflight(files = discover()) {
  const errors = [], blockedFiles = [];
  for (const file of files) try {
    const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('unsafe turn capture source');
    if(patchSource(fs.readFileSync(file,'utf8')).missing.length)throw Error('unreviewed native status boundary');
  } catch(error){errors.push(`${file}: ${error.message}`);blockedFiles.push(file);}
  return {ok:!errors.length,errors,...(errors.length?{blockedFiles}:{})};
}
// Retire only after native active-pending/unknown-owner, scoped history and rotated
// receipt behavior is independently qualified. Missing anchors never prove retirement.
export const descriptor = {name:NAME,atomic:true,missingIsIncomplete:true,discover,preflight,patchSource,hasPatch,isPatched,reverse};
