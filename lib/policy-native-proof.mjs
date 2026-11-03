// Exact native artifacts exercised by test/policy-native-restoration.mjs.
// Ruflo 3.57 bounds the hot ledger and audits authenticated history separately;
// its bounded export is preferable to imposing our older storage format.
import { createHash } from 'node:crypto';
import { nativePolicySource } from './ruflo-memory-owner/patcher.mjs';
const hash = source => createHash('sha256').update(source).digest('hex');
// Each listed artifact passed the same 5,000-receipt native conversion/audit.
const runtimeHashes = new Set([
  'e5f607b43ad16a50c56083c41333c1db81ae48de3443ff6365ae93d0dbea2a84',
  'b7ede050bc79b903b4247c210faa6e90a8fcb4d0f03b7974203cdaba0d88c27a',
  '8bb6cbe7eeb99f7941f1c42de1ba40a445569c802fdf06186c38925253cb43b6', // 3.59.17 (#4343).
  // HZ AI runtime: exact preceding artifact with LOCK_WAIT_MS 5_000 -> 30_000.
  // Local variant, not an upstream release. Qualified 2026-11-02; no other differences.
  '69f00c8ba63439c96df34231a57a2c251d983b48cf1a1460129ed59c3693a7c5',
]);
export const nativePolicyRuntimeSatisfied = source => runtimeHashes.has(hash(nativePolicySource(source)));
export const nativePolicyEngineSatisfied = source => hash(source) ===
  '5f11ef7f0a6a60225a6a5a4a659af6ceaedc27f8ac7099dae9d290c8474145a8';
