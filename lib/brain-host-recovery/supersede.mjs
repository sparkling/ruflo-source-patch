import fs from 'node:fs';
import { discover, hasPatch, nativeHostRecoverySatisfied, nativeAttributionSatisfied, preflight } from './patcher.mjs';

// Reuse the reviewed native boundaries and complete helper-closure proof. An old
// declaration-only implementation is insufficient for terminal retirement.
export function checkHostRecoveryRetirement(files = discover()) {
  if (!files.length) return { state: 'unknown', evidence: 'no installed native recovery surfaces found' };
  try {
    let installers = 0, schedulers = 0;
    for (const file of files) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('unsafe installed host recovery source');
      const source = fs.readFileSync(file, 'utf8');
      if (hasPatch(source)) return { state: 'live', evidence: 'local host recovery overlay is still present' };
      if (file.endsWith('/bin/install.mjs')) {
        if (!nativeHostRecoverySatisfied(source) || !source.includes("import { proveCodexBootSurface, parseChangedPaths } from '../scripts/codex-boot-surface-proof.mjs';"))
          return { state: 'live', evidence: 'native path-specific executable boot recovery is not proven' };
        installers++;
      } else if (file.endsWith('/scripts/nightly-scheduler.mjs') && nativeAttributionSatisfied(source)) schedulers++;
      else return { state: 'live', evidence: 'native refresh-failure attribution is not proven' };
    }
    if (!installers || !schedulers) return { state: 'unknown', evidence: 'installer or scheduler coverage is absent' };
    const proof = preflight(files);
    if (!proof.ok) return { state: 'unknown', evidence: proof.errors.join('; ') };
    return { state: 'superseded', evidence: `${installers} native installers and ${schedulers} schedulers retain reviewed per-path boot proof, complete helper dependencies and causal failure attribution; existing sessions are not claimed refreshed` };
  } catch (error) { return { state: 'unknown', evidence: error.message }; }
}
export const brainHostRecoverySupersession = {
  issue: 'https://github.com/stuinfla/ruvnet-brain/issues/391',
  replacement: 'native path-specific boot recovery with complete reviewed dependencies and causal refresh attribution',
  check: checkHostRecoveryRetirement,
};
