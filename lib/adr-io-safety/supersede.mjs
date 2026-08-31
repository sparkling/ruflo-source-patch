import { reconcile } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';
import { activeRoots } from './patcher.mjs';
import { probeNativeRoot } from './probes.mjs';

function check() {
  const roots = activeRoots();
  if (!roots.length) return { state: 'unknown', evidence: 'no active ruflo-adr root could be identified' };
  for (const root of roots) {
    const proof = probeNativeRoot(root);
    if (proof.state === 'unknown') return proof;
    if (proof.state !== 'proven') return proof;
  }
  return {
    state: 'superseded',
    evidence: `all ${roots.length} active ruflo-adr root(s) passed complete-read, proven-batch-write, exact-store, and atomic-reindex probes`,
  };
}

export const adrIoSafetySupersession = {
  issue: 'https://github.com/ruvnet/ruflo/issues/3147',
  replacement: 'native fail-closed ADR I/O (#3147) plus managed proven batch import and atomic reconcile (#3097)',
  check,
  retire: () => {
    const remaining = readState().pluginTargets.filter((target) => target !== 'adr-io-safety');
    return reconcile(remaining, ['adr-io-safety']);
  },
};
