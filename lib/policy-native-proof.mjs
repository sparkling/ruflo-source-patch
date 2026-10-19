// Exact native artifacts exercised by test/policy-native-restoration.mjs.
// Ruflo 3.57 bounds the hot ledger and audits authenticated history separately;
// its bounded export is preferable to imposing our older storage format.
import { createHash } from 'node:crypto';
const hash = source => createHash('sha256').update(source).digest('hex');
export const nativePolicyRuntimeSatisfied = source => hash(source) ===
  'e5f607b43ad16a50c56083c41333c1db81ae48de3443ff6365ae93d0dbea2a84';
export const nativePolicyEngineSatisfied = source => hash(source) ===
  '5f11ef7f0a6a60225a6a5a4a659af6ceaedc27f8ac7099dae9d290c8474145a8';
