import path from 'node:path';

// #4291: explicit graph ownership must not alter implicit AgentDB ownership.
export const GRAPH_IMPORT = "import { getMemoryRoot } from './memory-initializer.js';";
export const GRAPH_IMPORT_BOUND = "import { getMemoryRoot, resolveDbPath } from './memory-initializer.js';";
export const GRAPH_PATH = "    const dbPath = customDbPath ?? path.join(getMemoryRoot(), 'memory.db');";
export const GRAPH_PATH_BOUND = `    // ruflo-source-patch: explicit graph store follows native path precedence (#4291).
    const dbPath = customDbPath ?? (process.env.CLAUDE_FLOW_DB_PATH?.trim() === ':memory:'
        ? ':memory:' : resolveDbPath());`;

export const memoryGraphPathEntry = {
  id: 'memory/graph-configured-store', target: 'memory',
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'graph-edge-writer.js'],
  nativeSatisfied: nativeGraphPathSatisfied,
  excludesWhen: "import { resolveDbPath } from './memory-initializer.js';",
  edits: [
    { find: GRAPH_IMPORT, replace: GRAPH_IMPORT_BOUND },
    { find: GRAPH_PATH, replace: GRAPH_PATH_BOUND, all: true },
  ],
};

export function nativeGraphPathSatisfied(source) {
  const expressions = [];
  for (const name of ['isBridgeDbEncryptedAtRest', 'getBridgeDb']) {
    const expression = source.match(new RegExp(`export (?:async )?function ${name}\\(customDbPath[^)]*\\) \\{\\s*(?://[^\\n]*\\n\\s*)*const dbPath = ([^;]+);`))?.[1];
    if (!expression) return false;
    expressions.push(expression);
  }
  try {
    const root = '/project/.swarm';
    for (const configured of [undefined, '', '   ', '/research/agentdb-memory.db', ':memory:']) {
      const env = { CLAUDE_FLOW_DB_PATH: configured };
      const resolveDbPath = value => path.resolve(value?.trim() ? value
        : configured?.trim() ? configured : path.join(root, 'memory.db'));
      for (const custom of [undefined, '/custom/other.db', ':memory:']) {
        const expected = custom ?? (configured?.trim() ? configured : path.join(root, 'memory.db'));
        for (const expression of expressions) {
          const result = new Function('process', 'path', 'getMemoryRoot', 'resolveDbPath', 'customDbPath', 'return ' + expression)(
            { env }, path, () => root, resolveDbPath, custom);
          if (result !== expected) return false;
        }
      }
    }
    return true;
  } catch { return false; }
}

// #4291 is fixed for file bindings in 3.59.1. Its resolver still turns the
// SQLite in-memory sentinel into a filename; retain only that residual guard.
export const GRAPH_NATIVE_PATH = '    const dbPath = resolveDbPath(customDbPath);';
export const GRAPH_NATIVE_SENTINEL = `    // /* ruflo-source-patch:patched */ preserve an explicit SQLite memory sentinel (#4291).
    const dbPath = customDbPath === ':memory:'
        || (customDbPath == null && process.env.CLAUDE_FLOW_DB_PATH?.trim() === ':memory:')
        ? ':memory:' : resolveDbPath(customDbPath);`;
export const memoryGraphNativeSentinelEntry = {
  id: 'memory/graph-native-memory-sentinel', target: 'memory',
  suffix: memoryGraphPathEntry.suffix,
  appliesWhen: "import { resolveDbPath } from './memory-initializer.js';",
  nativeSatisfied: nativeGraphPathSatisfied,
  edits: [{ find: GRAPH_NATIVE_PATH, replace: GRAPH_NATIVE_SENTINEL, all: true }],
};
