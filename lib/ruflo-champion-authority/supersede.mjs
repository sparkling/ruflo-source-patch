import { probeChampionAuthorityReplacement } from './probe.mjs';
import { retireComposed } from '../brain-native/supersede.mjs';
export const rufloChampionAuthoritySupersession = {
  issue: 'https://github.com/ruvnet/ruflo/issues/2579',
  replacement: 'ADR-322A local promotion authority preserved during native framework startup application; #2579 is source context',
  check: probeChampionAuthorityReplacement,
  retire: context => retireComposed('ruflo-champion-authority', context),
};
