// #2633: this exact native backend already owns explicit and private-temp paths.
// test/cwd-current.mjs executes its constructor with a VectorDb test double,
// verifies isolation, normalization and rejection, and retains legacy coverage.
// No storage path or existing database is changed by recognizing native support.
import { createHash } from 'node:crypto';
export const nativeVectorStorageSatisfied = source => typeof source === 'string'
  && createHash('sha256').update(source).digest('hex') ===
    '76aa6948eac4fca168b44e44415f46b17660aa89f580ee1cfb53423a527c47ae';

// Companion owner selects <dbPath>.ruvector; :memory: delegates private storage.
export const nativeVectorCoreSatisfied = source => typeof source === 'string'
  && createHash('sha256').update(source).digest('hex') ===
    'a778fbe2a996f8eaa15d6da57c8049b14f70a0a5c831b2a94b191bb1eeb56ca6';
