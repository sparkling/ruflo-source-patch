// Reviewed executable source and the official persisted operator-control interface.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
import { HOME_BASE } from '../cwd/paths.mjs';
export const CONTROL = 'scripts/project-progression-suspension.mjs';
export const REVIEWED = {
  [CONTROL]: '53ac4a36f0ec93549bbe519bc907ebb7275021f8ef9aab81460e98ce1b9c33c8',
  'scripts/project-transition-hook.mjs': ['e18fd22bee1fb098c7458142b810d586545c8906b73ef0e595902abfc346efcc',
    '53d522f20fed253a31f7563f7a38a1f33670d86612bf28f4e0833425ddda305c',
    'b4db452b39e4f2d569f4c68af4dfb3c6ec9d3eb8392f934eb1f9bc19788e8cb9'],
  'scripts/session-snapshot-hook.mjs': ['bc2672928ac7430b92fa1d16e5d00a4f5f296ba05f6b19669c5faa43b47a7a53',
    '60d36796e129d1a9a52417b1b9ad96b990164848ee0cbbc5b855f58aaf8db390',
    '30eee40f28aa09c4887bfbaa41261660b560e8f1b11ab41e3f2bee3aaae7dcea'],
  'scripts/project-progression-session-start.mjs': ['049dad1f320cccc3af6f79daab99864cc3dc62f9a93b16228c01ad9ec9df36ff',
    '1ab0ab7ce71d6ab145a083dc039a8d1a61b0102098eec0f043ef0c3acbbb207b'],
  'scripts/project-capture-queue.mjs': ['abda524a2ec2587ebe79ffce26ebec69495f51e5c123b6a3f2f91da5ab00ccc4',
    '43bfae0c8c0ad9fd1893dab6381e59072945b0f9cd3d6d086476edefdfa137e0'],
  'mcp/managed-cli-interface.mjs': 'e6dec892fa0d67b453b6edafa9e65669cd9ecd428c630258341c0cb94b78f0dd',
  'scripts/project-progression-checkpoint.mjs': '71a65e3f791416a00cf3cb9b4cbd0df7333d2f67ac42ffbce0714ca8e6ae57f6',
};
export const selectedSurfaces = () => discoverBrain({ includeOwned: false });
export const nativeSuspensionSourceSatisfied = source => Object.values(REVIEWED).flat()
  .includes(createHash('sha256').update(source).digest('hex'));
export const reviewedSuspensionMember = (relative, source) => [REVIEWED[relative]].flat()
  .includes(createHash('sha256').update(source).digest('hex'));
export function nativeSurfaceReady(surface) {
  const relatives = surface.kind === 'full' ? Object.keys(REVIEWED) : [CONTROL, 'mcp/managed-cli-interface.mjs'];
  for (const relative of relatives) {
    const file = path.join(surface.root, relative), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(surface.root, file) === null
      || !reviewedSuspensionMember(relative, fs.readFileSync(file))) throw Error(`unproved native suspension source ${file}`);
  }
}
export function nativeControl(surface, action, env) {
  const childEnv = { ...env };
  // Prove persisted state, rather than masking it with an inherited override.
  delete childEnv.RUVNET_BRAIN_PROGRESSION_SUSPENDED;
  const executable = fs.realpathSync.native(path.join(surface.root, CONTROL));
  const run = spawnSync(process.execPath, [executable, action],
    { env: childEnv, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
  if (run.error || run.status !== 0) throw Error(run.error?.message || run.stderr || `native control exited ${run.status}`);
  if (!run.stdout.trim()) throw Error('native control returned no status');
  const result = JSON.parse(run.stdout);
  if (!['enabled', 'operator-suspended'].includes(result.automaticProgression) || result.evidencePreserved !== true
    || result.explicitCheckpointsAvailable !== true) throw Error('native control status not proved');
  return result;
}
export function verifyNativeProgressionSuspensionPreserved({ surfaces = selectedSurfaces(), env = { ...process.env, HOME: HOME_BASE } } = {}) {
  try {
    const surface = surfaces.find(surface => surface.kind === 'full');
    if (!surface) throw Error('no current native suspension control');
    // The control executable itself must remain reviewed even during sibling composition.
    const file = path.join(surface.root, CONTROL), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || existingPathRelative(surface.root, file) === null
      || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== REVIEWED[CONTROL]) throw Error('native control source not proved');
    const result = nativeControl(surface, '--status', env);
    if (result.automaticProgression !== 'operator-suspended' || result.source !== 'operator-state') throw Error('native operator suspension was not retained');
    return { ok: true, evidence: 'native persisted operator suspension remains active after overlay retirement' };
  } catch (error) { return { ok: false, evidence: error.message }; }
}
