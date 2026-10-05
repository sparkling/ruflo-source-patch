import { probeFlywheelEvidenceReplacement } from './probe.mjs';
import { retireComposed } from '../brain-native/supersede.mjs';
export const rufloFlywheelEvidenceSupersession = {
  issue: 'https://github.com/ruvnet/ruflo/issues/3229',
  replacement: 'native canonical fractional evidence with unchanged strict receipt verification',
  check: probeFlywheelEvidenceReplacement,
  retire: context => retireComposed('ruflo-flywheel-evidence', context),
};
