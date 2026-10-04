// One true pristine for the boundary transaction and other protocol-shell owners.
import path from 'node:path';
import { discover as discoverBrain } from './discovery.mjs';
import { PATCH_MARKER, patchMcp, isPatched, reverseMcp } from './transforms.mjs';
import { composerPreflight } from './patcher.mjs';
export const NAME = 'brain-managed-memory-boundary';
export const descriptor = {
  name: NAME, atomic: true, missingIsIncomplete: true, transactionOwner: true,
  discover: () => discoverBrain({ includeOwned: true, allowMissingActive: true }).map(surface => path.join(surface.root, 'mcp/server.mjs')),
  hasPatch: source => source.includes(PATCH_MARKER),
  isPatched: source => isPatched('mcp', source),
  reverse: reverseMcp,
  patchSource(source) {
    return isPatched('mcp', source) ? { next: source, applied: [], missing: [] } : patchMcp(source);
  },
  preflight: composerPreflight,
};
