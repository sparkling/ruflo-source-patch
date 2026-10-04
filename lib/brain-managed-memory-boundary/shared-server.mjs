// Keep lazy composer helpers separate from its descriptor to avoid import-order
// cycles when the full atomic boundary installer is the entry point.
import { composeSource, COMPOSE_TARGETS, isOurs, isKnownFileComposition } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';
const NAME = 'brain-managed-memory-boundary';
export function serverTargets(includeBoundary = true) {
  const siblings = readState().pluginTargets.filter(target => target !== NAME && COMPOSE_TARGETS.includes(target));
  return includeBoundary ? [NAME, ...siblings] : siblings;
}
export const composeServer = (source, file, includeBoundary = true) => composeSource(source, serverTargets(includeBoundary), { file });
export const hasServerOwner = source => isOurs(source, COMPOSE_TARGETS);
export const knownServerComposition = (pristine, current, file) => isKnownFileComposition(pristine, current, file);
