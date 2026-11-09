// #2633: this exact native backend already owns explicit and private-temp paths.
// test/cwd-current.mjs executes its constructor with a VectorDb test double,
// verifies isolation, normalization and rejection, and retains legacy coverage.
// No storage path or existing database is changed by recognizing native support.
import { createHash } from 'node:crypto';
export const nativeVectorStorageSatisfied = source => typeof source === 'string'
  && createHash('sha256').update(source).digest('hex') ===
    '76aa6948eac4fca168b44e44415f46b17660aa89f580ee1cfb53423a527c47ae';

// Companion owner selects <dbPath>.ruvector; :memory: delegates private storage.
// 3.7.2 changes only close() to await closeAsync; constructor behavior is retained.
export const nativeVectorCoreSatisfied = source => typeof source === 'string'
  && [
    'a778fbe2a996f8eaa15d6da57c8049b14f70a0a5c831b2a94b191bb1eeb56ca6',
    '04341e98d2a745dd03da3cf70485a63c96ceec041cbe8810114ca931b23256f1',
  ].includes(createHash('sha256').update(source).digest('hex'));

// Withdrawn on 2026-11-02: forcing a shared companion created cross-process
// lock failures. Retain these edits only to prove exact restoration, never apply.
export const WITHDRAWN_VECTOR_ENTRIES = [
  {
    id: 'cwd/agentdb-vector-storage-path',
    target: 'cwd',
    suffix: ['agentdb', 'dist', 'src', 'core', 'AgentDB.js'],
    frags: [],
    edits: [
      {
        find: "import * as path from 'path';\nimport { fileURLToPath } from 'url';",
        replace: "import * as path from 'path';\nimport os from 'node:os';\nimport { randomUUID } from 'node:crypto';\nimport { fileURLToPath } from 'url';",
      },
      {
        find: "        const vectorDimension = this.config.vectorDimension || 384;\n        // Initialize database with unified fallback system",
        replace: [
          '        const vectorDimension = this.config.vectorDimension || 384;',
          "        const vectorStoragePath = dbPath === ':memory:'",
          "            ? path.join(os.tmpdir(), `agentdb-ruvector-${process.pid}-${randomUUID()}.db`)",
          "            : `${path.resolve(dbPath)}.ruvector.db`;",
          '        // Initialize database with unified fallback system',
        ].join('\n'),
      },
      {
        find: "            dimensions: vectorDimension,\n            metric: 'cosine'",
        replace: "            dimensions: vectorDimension,\n            metric: 'cosine',\n            storagePath: vectorStoragePath",
      },
    ],
  },
  {
    id: 'cwd/agentdb-ruvector-storage',
    target: 'cwd',
    suffix: ['agentdb', 'dist', 'src', 'backends', 'ruvector', 'RuVectorBackend.js'],
    frags: [],
    edits: [
      {
        find: '/**\n * RuVectorBackend - High-Performance Vector Storage',
        replace: "import path from 'node:path';\nimport os from 'node:os';\nimport { randomUUID } from 'node:crypto';\n\n/**\n * RuVectorBackend - High-Performance Vector Storage",
      },
      {
        find: [
          '            // RuVector VectorDB constructor signature',
          '            this.db = new VectorDB({',
          '                dimensions: dimensions, // Note: config object, not positional arg',
        ].join('\n'),
        replace: [
          '            // Never let RuVector select its cwd-relative ./ruvector.db default.',
          '            const storagePath = this.config.storagePath ?? path.join(',
          '                os.tmpdir(),',
          '                `agentdb-ruvector-${process.pid}-${randomUUID()}.db`',
          '            );',
          '            // RuVector VectorDB constructor signature',
          '            this.db = new VectorDB({',
          '                dimensions: dimensions, // Note: config object, not positional arg',
          '                storagePath: storagePath,',
        ].join('\n'),
      },
    ],
  },
];

export function withdrawnVectorPresent(source, entry) {
  if (nativeVectorCoreSatisfied(source) || nativeVectorStorageSatisfied(source)) return false;
  return entry.id === 'cwd/agentdb-vector-storage-path'
    ? source.includes('const vectorStoragePath =') || source.includes('storagePath: vectorStoragePath')
    : source.includes('// Never let RuVector select its cwd-relative ./ruvector.db default.')
      || source.includes('const storagePath = this.config.storagePath ?? path.join(');
}
