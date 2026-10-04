import { probePolicySerializationReplacement } from './probe.mjs';
import { retireComposed } from '../brain-native/supersede.mjs';
export const rufloPolicySerializationSupersession = {
  issue: 'https://github.com/ruvnet/ruflo/issues/3164',
  replacement: 'native immutable complete verified policy serialization without a full-ledger clone',
  check: probePolicySerializationReplacement,
  retire: context => retireComposed('ruflo-policy-serialization', context),
};
