// One true pristine for the boundary transaction and other protocol-shell owners.
import path from 'node:path';
import { discover as discoverBrain } from './discovery.mjs';
import { PATCH_MARKER, patchMcp, patchShim, patchHijack, isPatched, reverseMcp, reverseShim, reverseHijack } from './transforms.mjs';
import { composerPreflight } from './patcher.mjs';
export const NAME = 'brain-managed-memory-boundary';
export const descriptor = {
  name: NAME, atomic: true, missingIsIncomplete: true, transactionOwner: true,
  discover: () => discoverBrain({ includeOwned: true, allowMissingActive: true }).flatMap(surface => (surface.kind === 'full' ? ['mcp/server.mjs', 'scripts/hook-shim.mjs', 'scripts/hijack-ruvnet.sh'] : ['mcp/server.mjs']).map(relative => path.join(surface.root, relative))),
  hasPatch: source => source.includes(PATCH_MARKER),
  isPatched: source => isPatched('mcp', source) || isPatched('shim', source) || isPatched('hijack', source),
  reverse: source => reverseHijack(reverseShim(reverseMcp(source))),
  patchSource(source) {
    const kind = source.includes('HOOK_INPUT=') ? 'hijack'
      : source.includes("'hijack-ruvnet':") ? 'shim' : 'mcp';
    return isPatched(kind, source) ? { next: source, applied: [], missing: [] }
      : kind === 'hijack' ? patchHijack(source) : kind === 'shim' ? patchShim(source) : patchMcp(source);
  },
  preflight: composerPreflight,
};
