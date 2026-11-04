// CLI contributions for files also claimed by plugin descriptors. The shared
// composer owns their one pristine; the CLI engine owns its existing transforms.
import fs from 'node:fs';
import path from 'node:path';
import { ENTRIES, PATCH_TARGETS, discover, inspect, composeCliContribution, historicalCliContribution, cliClaimApplied, nativeOnlyPreflight } from './patch-library.mjs';
import { WITHDRAWN_VECTOR_ENTRIES, withdrawnVectorPresent } from './native-vector-storage.mjs';

export function physicalFile(file) {
  try { return fs.realpathSync.native(file); }
  catch (error) { if (error?.code === 'ENOENT') return path.resolve(file); throw error; }
}
export function cliSourceFiles(targets = PATCH_TARGETS) {
  return [...new Set(ENTRIES.filter(entry => targets.includes(entry.target))
    .flatMap(entry => discover(entry.suffix)).map(physicalFile))];
}
// apply() also restores unselected CLI edits and withdrawn adapters. Observation
// must cover that same scope; otherwise a failed uninstall could look healthy.
export function cliObservationDescriptors(files, targets) {
  const descriptors = [...cliDescriptors(files, targets), ...WITHDRAWN_VECTOR_ENTRIES.flatMap(entry =>
    discover(entry.suffix).map(candidate => {
      const file = physicalFile(candidate);
      return { name: `cli-withdrawn:${entry.id}:${file}`, discover: () => [file],
        patchSource: source => ({ next: source, applied: [],
          missing: withdrawnVectorPresent(source, entry) ? ['withdrawn vector contribution remains'] : [] }) };
    }))];
  if (targets.length && descriptors.length) descriptors[0].preflight = () => {
    const status = inspect(); // Same postcondition as apply(), in addition to exact bytes.
    return { ok: targets.every(target => status[target]?.files > 0
      && status[target].satisfied === status[target].files) };
  };
  return descriptors;
}
export function cliDescriptors(files, targets = []) {
  const selected = new Set([...files].map(physicalFile));
  const claims = new Map();
  for (const entry of ENTRIES) for (const candidate of discover(entry.suffix)) {
    const file = physicalFile(candidate);
    if (!selected.has(file)) continue;
    if (!claims.has(file)) claims.set(file, []);
    claims.get(file).push(entry);
  }
  return [...claims].map(([file, entries]) => {
    const active = entries.filter(entry => targets.includes(entry.target));
    return {
      name: `cli-source:${file}`, cliOwner: true, missingIsIncomplete: true,
      active: active.length > 0, discover: () => [file],
      ...(active.some(entry => entry.nativeOnly) && { preflight: () => nativeOnlyPreflight(file, active) }),
      patchSource: source => composeCliContribution(source, active, { file }),
      historicalPatchSource: (source, current) => historicalCliContribution(source, current, entries, { file }),
      hasPatch: source => cliClaimApplied(source, entries),
      isPatched: source => cliClaimApplied(source, active),
    };
  });
}
