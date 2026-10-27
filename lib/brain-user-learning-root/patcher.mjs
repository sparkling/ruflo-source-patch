// Brain #377: the explicitly adopted user store is independent of a parent Git checkout.
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { nativeUserLearningSatisfied } from './native.mjs';
export const NAME = 'brain-user-learning-root';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#377 user-learning-root)';
export const FROM = `  if (!fs.lstatSync(db).isFile()) throw new Error('user store not adopted');
  const resolved = resolveProjectStore({ projectDir: root, requestedStorePath: db, gitTimeoutMs: 1000 });
  if (resolved.projectRoot !== root) throw new Error('foreign global learner root');
  return resolved.canonicalAgentDbPath;`;
export const TO = `  // ${PATCH_MARKER}: fixed user ownership must not inherit ~/.claude's Git root.
  const swarm = path.dirname(db);
  const swarmStat = fs.lstatSync(swarm);
  const dbStat = fs.lstatSync(db);
  if (!swarmStat.isDirectory() || swarmStat.isSymbolicLink()
    || fs.realpathSync.native(root) !== root || fs.realpathSync.native(swarm) !== swarm
    || !dbStat.isFile() || dbStat.isSymbolicLink() || dbStat.nlink !== 1
    || fs.realpathSync.native(db) !== db) throw new Error('user store not adopted or unsafe');
  return db;`;
const count = (source, anchor) => source.split(anchor).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => nativeUserLearningSatisfied(source)
  || count(source, TO) === 1 && count(source, PATCH_MARKER) === 1 && !source.includes(FROM);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || count(source, FROM) !== 1) return { next: source, applied: [], missing: ['unique-user-learning-root-boundary'] };
  return { next: source.replace(FROM, () => TO), applied: ['user-learning-root-boundary'], missing: [] };
}
export const reverseSource = source => source.replace(TO, () => FROM);
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: ['scripts/learning-store.mjs'],
}).filter(surface => surface.kind === 'full').map(surface => path.join(surface.root, 'scripts/learning-store.mjs'));
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource };
