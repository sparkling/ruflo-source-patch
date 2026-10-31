import fs from 'node:fs';
import { discover, hasPatch } from './patcher.mjs';
import { nativeOwnershipSatisfied } from './native.mjs';

export function checkWrapperOwnershipRetirement(files = discover()) {
  if (!files.length) return { state: 'unknown', evidence: 'no installed wrapper ownership boundary found' };
  try {
    for (const file of files) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('unsafe installed ownership source');
      const source = fs.readFileSync(file, 'utf8');
      if (hasPatch(source) || !nativeOwnershipSatisfied(source))
        return { state: 'live', evidence: 'an installed ownership boundary still needs the local overlay or lacks native behavioral proof' };
    }
    return { state: 'superseded', evidence: `${files.length} marker-free native ownership boundaries pass historical/current, edited, path, owner and link behavior` };
  } catch (error) { return { state: 'unknown', evidence: error.message }; }
}
export const brainWrapperOwnershipSupersession = {
  issue: 'https://github.com/stuinfla/ruvnet-brain/issues/420',
  replacement: 'native published-history and retained-generation wrapper ownership verification',
  check: checkWrapperOwnershipRetirement,
};
