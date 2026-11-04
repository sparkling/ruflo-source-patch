import fs from 'node:fs';
import { filesForEntry, apply } from '../cwd/patch-library.mjs';
import { readState } from '../cwd/state.mjs';
import { nativeContextSatisfied } from './patcher.mjs';
import { bundles, nativeSatisfied as nativeConsolidation } from '../ruflo-tier-consolidation/patcher.mjs';
import { retireComposed } from '../brain-native/supersede.mjs';

export function checkNativeContext() {
  const files = filesForEntry('ruflo-context-contract/validated-episodes');
  try {
    return files.length && files.every(file => nativeContextSatisfied(fs.readFileSync(file, 'utf8')))
      ? { state: 'superseded', evidence: 'exact published native eligibility helpers and context adapter; no local lineage or result policy remains' }
      : { state: 'unknown', evidence: 'native context source not qualified; historical overlays are removal-only' };
  } catch (error) { return { state: 'unknown', evidence: error.message }; }
}
export const contextIntentSupersessions = {
  'ruflo-context-contract': {
    issue: 'https://github.com/ruvnet/ruflo/issues/3314',
    replacement: 'native validated episode synthesis and honest no-match/error results',
    check: checkNativeContext,
    retire: ({ retiring = new Set() } = {}) => apply(readState().patchTargets
      .filter(target => target !== 'ruflo-context-contract' && !retiring.has(target))),
  },
  'ruflo-tier-consolidation': {
    issue: 'https://github.com/ruvnet/ruflo/issues/2977',
    replacement: 'native explicitly unsupported consolidation; custom tier-copy controller withdrawn',
    check() {
      try {
        const copies = bundles();
        return checkNativeContext().state === 'superseded' && copies.length
          && copies.every(bundle => bundle.files.length === 4 && bundle.files.every(file => nativeConsolidation(fs.readFileSync(file, 'utf8'))))
          ? { state: 'superseded', evidence: 'all four native consolidation surfaces restored; context has no custom consolidation dependency; retained data untouched' }
          : { state: 'unknown', evidence: 'complete native context/consolidation restoration not yet proven' };
      } catch (error) { return { state: 'unknown', evidence: error.message }; }
    },
    retire: context => retireComposed('ruflo-tier-consolidation', context),
  },
};
