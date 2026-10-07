// Brain #391: project live host proof in doctor; attribute failure to its cause.
// Does not change updater execution, receipts, scheduling, trust, or stored memory.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { rspProveFreshCodexHost, LEGACY_SCOPE_GUARD } from './runtime.mjs';
import { discover as discoverConsole } from '../brain-console-lifecycle/discovery.mjs';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { reviewedBoundary } from '../brain-native/reviewed-source.mjs';
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
const historicalInstallerEdits = INSTALLER_EDITS.map(([from, to]) => [from, to.replace(LEGACY_SCOPE_GUARD, '')]);
export const historicalPatchSource = source => ({ next: historicalInstallerEdits.reduce((body, [from, to]) => body.replace(from, to), source) });
const historicalPatched = source => hasPatch(source) && historicalInstallerEdits.every(([, to]) => count(source, to) === 1);
const bundles = [INSTALLER_EDITS, SCHEDULER_EDITS];
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const nativeAttributionSatisfied = source => !hasPatch(source)
  && reviewedBoundary(source, 'export function describeFailedRefreshRun(', 'function sameExecutable(',
    'f50bb4c5170fbb34908f628eda5064177c02095de2823c16a60a73fe060709a7');
// Reviewed public 4.5.8 doctor projection. Hook metadata must never establish MCP/body readiness.
export const nativeHostRecoverySatisfied = source => !hasPatch(source)
  && count(source, "import { probeFreshCodexDeclarations } from '../scripts/codex-fresh-host-proof.mjs';") === 1
  && reviewedBoundary(source, 'export function classifyHostConvergence(', '/** Activation and host readiness',
    '493a208bd179d735e20f8d72f90d380525549122e2ee29f07f483434d9498a48')
  && reviewedBoundary(source, 'export function reconcileFreshCodexDeclarations(', 'const HOST_LABELS',
    '654208a4bb48c687768bd53479d42cda60de6aceab36804759905922be287fc6')
  && reviewedBoundary(source, '      hostConvergence = classifyHostConvergence(recorded);', '      if (hostConvergence.healthy)',
    ['e5eafa4594737da07ccb77b19dd6d7f658471d0e00ee215b6f0b8cd453fb1c15',
      // Brain 4.5.16 moved the fresh-declaration reconciliation branch while
      // preserving the same reviewed host-convergence contract.
      '21ca06f6bee4f57b136d2142d4d766ffc49c1178198869ca9a4ddf4b8fde7c1f']);
export const isPatched = source => nativeAttributionSatisfied(source) || nativeHostRecoverySatisfied(source)
  || (hasPatch(source) && bundles.some(edits => edits.every(([, to]) => count(source, to) === 1)));
export function patchSource(source) {
  if (historicalPatched(source)) return patchSource(reverseSource(source));
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  // A changed native integration must not fall back to the older, broader proof.
  if (/reconcileFreshCodexDeclarations|probeFreshCodexDeclarations/.test(source))
    return { next: source, applied: [], missing: ['reviewed-native-host-recovery-boundaries'] };
  const edits = bundles.find(bundle => bundle.every(([from]) => count(source, from) === 1));
  if (hasPatch(source) || !edits) return { next: source, applied: [], missing: ['unique-native-host-recovery-anchors'] };
  return { next: edits.reduce((body, [from, to]) => body.replace(from, to), source), applied: [NAME], missing: [] };
}
export const reverseSource = source => [...bundles.flat(), ...historicalInstallerEdits].reduceRight((body, [from, to]) => body.replace(to, from), source);
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
export const NATIVE_HELPERS = {
  'codex-fresh-host-proof.mjs': '8beee7f2530b4b298b6a8a37b6634f26104b70f1d05c83190a813441c5ac9238',
  'codex-hook-trust.mjs': '1694b005cd5c118bb96d1cf12b78bbc3f7c276cd176598a75cef0ad6eff8bea2',
  'codex-hook-trust-reconcile.mjs': 'f2cfcdc3a0e8de9956ad4ac1ac55aca103e1ce8de2e6abfafe2212cace3b66d5',
};
export function preflight(files = discover()) {
  const errors = [];
  for (const file of files) try {
    const source = fs.readFileSync(file, 'utf8');
    // A proven older overlay may be removed on this run; prove its native destination too.
    const candidate = hasPatch(source) ? reverseSource(source) : source;
    if (!nativeHostRecoverySatisfied(candidate)) continue;
    const installerStat = fs.lstatSync(file);
    if (!installerStat.isFile() || installerStat.isSymbolicLink()) throw new Error('unsafe native installer');
    const root = fs.realpathSync(path.dirname(path.dirname(file)));
    for (const [name, hash] of Object.entries(NATIVE_HELPERS)) {
      const helper = path.join(root, 'scripts', name), stat = fs.lstatSync(helper);
      if (!stat.isFile() || stat.isSymbolicLink() || !fs.realpathSync(helper).startsWith(root + path.sep)
        || createHash('sha256').update(fs.readFileSync(helper)).digest('hex') !== hash)
        throw new Error('unreviewed or unsafe native fresh-host dependency: ' + name);
    }
  } catch (error) { errors.push(file + ': ' + error.message); }
  return { ok: errors.length === 0, errors };
}
export function applicability(files = discover()) {
  const proof = preflight(files);
  return proof.ok ? { state: 'applicable' } : { state: 'error', reason: proof.errors.join('; ') };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource, historicalPatchSource, preflight, applicability };
