// Brain #391: project live host proof in doctor; attribute failure to its cause.
// Does not change updater execution, receipts, scheduling, trust, or stored memory.
import fs from 'node:fs';
import path from 'node:path';
import { rspProveFreshCodexHost } from './runtime.mjs';
import { discover as discoverConsole } from '../brain-console-lifecycle/discovery.mjs';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
export const NAME = 'brain-host-recovery';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#391)';
const marker = `// ${PATCH_MARKER}: read-only recovery evidence.\n`;
export const INSTALLER_EDITS = [
  ['export function classifyHostConvergence(receipt, expectedVersion = PACKAGE_VERSION) {',
    marker + rspProveFreshCodexHost.toString() + '\n\nexport function classifyHostConvergence(receipt, expectedVersion = PACKAGE_VERSION) {'],
  ['      hostConvergence = classifyHostConvergence(recorded);',
    '      hostConvergence = (await rspProveFreshCodexHost(recorded)) || classifyHostConvergence(recorded);'],
  ['  const checks = [',
    "  const checks = [\n    ...(hostConvergence.state === 'fresh-host-ready' ? [check('host-open-sessions', 'Open sessions', true,\n      hostConvergence.notice, 'Reopen an older window if its boot declarations are stale', { advisory: true })] : []),"],
];
export const SCHEDULER_EDITS = [
  ["  const failing = [...receipt.phases].reverse().find((entry) => entry?.status !== 'PASS') || receipt.phases[receipt.phases.length - 1];",
    '  ' + marker + "  const failing = receipt.phases.find((entry) => entry?.required !== false && entry?.status === 'FAIL')\n"
      + "    || receipt.phases.find((entry) => entry?.status === 'FAIL')\n"
      + "    || [...receipt.phases].reverse().find((entry) => entry?.status !== 'PASS') || receipt.phases[receipt.phases.length - 1];"],
  ["failing.evidence?.updateResult?.reason ?? failing.evidence?.reason ?? ''",
    "failing.evidence?.updateResult?.reason ?? failing.evidence?.error ?? failing.evidence?.reason ?? ''"],
];
const bundles = [INSTALLER_EDITS, SCHEDULER_EDITS];
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => hasPatch(source) && bundles.some(edits => edits.every(([, to]) => count(source, to) === 1));
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const edits = bundles.find(bundle => bundle.every(([from]) => count(source, from) === 1));
  if (hasPatch(source) || !edits) return { next: source, applied: [], missing: ['unique-native-host-recovery-anchors'] };
  return { next: edits.reduce((body, [from, to]) => body.replace(from, to), source), applied: [NAME], missing: [] };
}
export const reverseSource = source => bundles.flat().reduceRight((body, [from, to]) => body.replace(to, from), source);
export function discover() {
  const installers = discoverConsole().filter(file => file.endsWith('/bin/install.mjs'));
  const schedulers = installers.map(file => path.join(path.dirname(path.dirname(file)), 'plugin/scripts/nightly-scheduler.mjs'));
  for (const surface of discoverBrain({ includeOwned: true, allowMissingActive: true,
    ownedMarkers: [PATCH_MARKER], ownedRelatives: ['scripts/nightly-scheduler.mjs'] })) {
    if (surface.kind === 'full') schedulers.push(path.join(surface.root, 'scripts/nightly-scheduler.mjs'));
  }
  return [...new Set([...installers, ...schedulers])].filter(file => {
    try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink(); } catch { return false; }
  });
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource };
