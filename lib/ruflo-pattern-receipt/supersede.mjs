import { probePatternReceiptReplacement } from './probe.mjs';
import { retireComposed } from '../brain-native/supersede.mjs';
export const patternReceiptSupersessions = {
  'ruflo-pattern-receipt': {
    issue: 'https://github.com/ruvnet/ruflo/issues/3691',
    replacement: 'native checked pattern fallback with exact namespace/key/value readback',
    check: probePatternReceiptReplacement,
    retire: context => retireComposed('ruflo-pattern-receipt', context),
  },
};
