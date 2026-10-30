import path from 'node:path';
// Ruflo #2105/#3196: carry the configured store through MCP, not only init.
export const MCP_PATH_ANCHOR = `    return {
        storeEntry,
        searchEntries,
        listEntries,
        getEntry,
        deleteEntry,
        initializeMemoryDatabase,
        checkMemoryInitialization,
    };`;

export const MCP_PATH_PREVIOUS = `    // ruflo-source-patch: MCP explicit database identity (#2105/#3153).
    const configured = process.env.CLAUDE_FLOW_DB_PATH;
    const bindStore = (fn) => async (options = {}) => {
        if (!configured || !configured.trim()) return fn(options);
        const { resolveDbPath } = await import('../memory/memory-initializer.js');
        return fn({ ...options, dbPath: resolveDbPath(configured) });
    };
    return {
        storeEntry: bindStore(storeEntry),
        searchEntries: bindStore(searchEntries),
        listEntries: bindStore(listEntries),
        getEntry: bindStore(getEntry),
        deleteEntry: bindStore(deleteEntry),
        initializeMemoryDatabase: bindStore((options) => initializeMemoryDatabase({
            ...options, ...(configured && configured.trim() ? { migrate: false } : {}),
        })),
        checkMemoryInitialization: async (...args) => {
            if (!configured || !configured.trim()) return checkMemoryInitialization(...args);
            const { resolveDbPath } = await import('../memory/memory-initializer.js');
            return checkMemoryInitialization(resolveDbPath(configured));
        },
    };`;
export const MCP_PATH_REPLACEMENT = MCP_PATH_PREVIOUS.replace('#2105/#3153', '#2105/#3196');

export const MCP_LEGACY_ANCHOR = '        if (hasLegacyStore()) {';
export const MCP_LEGACY_REPLACEMENT = `        // An explicit MCP store must never import the current project's legacy data.
        if (!process.env.CLAUDE_FLOW_DB_PATH?.trim() && hasLegacyStore()) {`;

export const memoryMcpPathEntry = {
  id: 'memory/mcp-configured-store',
  target: 'memory',
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'memory-tools.js'],
  frags: [],
  edits: [
    { find: MCP_PATH_ANCHOR, replace: MCP_PATH_REPLACEMENT },
    { find: MCP_LEGACY_ANCHOR, replace: MCP_LEGACY_REPLACEMENT },
  ],
};

// Upstream #2786/#3155 owns controller resolution independently of the ordinary
// memory binding. Retain the exact historical overlays only to withdraw them.
export const CONTROLLER_PATH_ANCHOR = `function getAgentDbPath() {
    const dbPath = getDbPath();
    if (dbPath === ':memory:')
        return ':memory:';
    return path.join(path.dirname(dbPath), 'agentdb-memory.db');
}`;
// Exact released revision retained only to prove upgrades from the one-store policy.
export const CONTROLLER_PATH_PREVIOUS = `function getAgentDbPath() {
    // ruflo-source-patch: one configured native store (#2105/#3143).
    const configured = process.env.CLAUDE_FLOW_DB_PATH?.trim();
    if (configured) {
        if (configured === ':memory:') return ':memory:';
        if (process.env.CLAUDE_FLOW_ENCRYPT_AT_REST === '1')
            throw new Error('Explicit native CLAUDE_FLOW_DB_PATH conflicts with sql.js encryption; refusing an implicit second store');
        return path.resolve(configured);
    }
    const dbPath = getDbPath();
    if (dbPath === ':memory:') return ':memory:';
    return process.env.CLAUDE_FLOW_ENCRYPT_AT_REST === '1'
        ? path.join(path.dirname(dbPath), 'agentdb-memory.db')
        : dbPath;
}`;
export const CONTROLLER_PATH_REPLACEMENT = CONTROLLER_PATH_PREVIOUS
  .replace('one configured native store (#2105/#3143)', 'explicit native binding; upstream sibling default (#2105/#3155)')
  .replace(`return process.env.CLAUDE_FLOW_ENCRYPT_AT_REST === '1'
        ? path.join(path.dirname(dbPath), 'agentdb-memory.db')
        : dbPath;`, `return path.join(path.dirname(dbPath), 'agentdb-memory.db');`);
export const memoryControllerPathEntry = {
  id: 'memory/controller-configured-store',
  target: 'memory',
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js'],
  nativeSatisfied: nativeControllerPathSatisfied,
  edits: [{ find: CONTROLLER_PATH_ANCHOR, replace: CONTROLLER_PATH_REPLACEMENT }],
};

// Retire only on behaviour, not the disappearance of an old anchor.
export function nativeControllerPathSatisfied(source) {
  const fn = source.match(/function getAgentDbPath\(\) \{[\s\S]*?\n\}/)?.[0];
  if (!fn) return false;
  const resolve = (env, dbPath) => new Function('process', 'path', 'getDbPath', fn + '\nreturn getAgentDbPath();')(
    {env}, path, () => dbPath);
  try {
    for (const dbPath of ['/project/.swarm/memory.db', '/outside/research.db', ':memory:']) {
      const expected = dbPath === ':memory:' ? dbPath : path.join(path.dirname(dbPath), 'agentdb-memory.db');
      for (const configured of [undefined, '/configured/memory.db', '/outside/user-memory.db', ':memory:']) {
        for (const encryption of [undefined, '1']) {
          if (resolve({CLAUDE_FLOW_DB_PATH:configured, CLAUDE_FLOW_ENCRYPT_AT_REST:encryption}, dbPath) !== expected)
            return false;
        }
      }
    }
    return true;
  } catch { return false; }
}

// #3196: the bridge already owns a path-keyed embedding API. The legacy HNSW
// singleton and its metadata/removal helpers have no database ownership key.
// An explicit operation must never fall through to, or invalidate, that index.
const auxiliaryPathComment = 'ruflo-source-patch: preserve auxiliary database identity (#3196).';
export const memoryAuxiliaryPathEntry = {
  id: 'memory/auxiliary-explicit-store', target: 'memory',
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js'],
  appliesWhen: 'export async function addToHNSWIndex(',
  edits: [
    {
      find: `export async function addToHNSWIndex(id, embedding, entry) {
    // ADR-053: Try AgentDB v3 bridge first
    const bridge = await getBridge();
    if (bridge) {
        const bridgeResult = await bridge.bridgeAddEmbedding(id, embedding, entry);
        if (bridgeResult === true)
            return true;
    }
    const index = await getHNSWIndex({ dimensions: embedding.length });`,
      replace: `export async function addToHNSWIndex(id, embedding, entry, dbPath) {
    // ${auxiliaryPathComment}
    try {
        const bridge = await getBridge();
        if (bridge) {
            const bridgeResult = await bridge.bridgeAddEmbedding(id, embedding, entry, dbPath);
            if (bridgeResult === true)
                return true;
        }
    } catch (error) {
        if (dbPath == null) throw error;
        return false;
    }
    // Native primary writes already persist their embedding. No path-scoped
    // fallback exists here; failure must not write a different store/index.
    if (dbPath != null) return false;
    const index = await getHNSWIndex({ dimensions: embedding.length });`,
    },
    {
      find: 'function removeHNSWEntriesByKey(key, namespace) {',
      replace: `function removeHNSWEntriesByKey(key, namespace, dbPath) {
    // ${auxiliaryPathComment}
    if (dbPath != null) return 0;`,
    },
    {
      find: '                removeHNSWEntriesByKey(options.key, ns);',
      replace: '                removeHNSWEntriesByKey(options.key, ns, options.dbPath);',
    },
    {
      find: `                    content: options.value,
                }).catch(() => { });`,
      replace: `                    content: options.value,
                }, options.dbPath).catch(() => { });`,
    },
    {
      find: '            if (upsert)\n                removeHNSWEntriesByKey(key, namespace);',
      replace: '            if (upsert)\n                removeHNSWEntriesByKey(key, namespace, customPath);',
    },
    {
      find: '            if (hnswIndex?.entries)\n                removeHNSWEntriesByKey(key, namespace);',
      replace: '            if (hnswIndex?.entries)\n                removeHNSWEntriesByKey(key, namespace, customPath);',
    },
    {
      find: `                content: value
            });`,
      replace: `                content: value
            }, customPath);`,
    },
    {
      find: "                removeHNSWEntriesByKey(options.key, options.namespace ?? 'default');",
      replace: "                removeHNSWEntriesByKey(options.key, options.namespace ?? 'default', options.dbPath);",
    },
    {
      find: '                if (bridgeResult.deletedCount > 0 && hnswIndex?.entries) {',
      replace: '                if (customPath == null && bridgeResult.deletedCount > 0 && hnswIndex?.entries) {',
    },
    {
      find: '            if (deletedCount > 0 && hnswIndex?.entries) {',
      replace: '            if (customPath == null && deletedCount > 0 && hnswIndex?.entries) {',
    },
  ],
};

export const memoryPatternAuxiliaryPathEntry = {
  id: 'memory/pattern-auxiliary-explicit-store', target: 'memory',
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js'],
  appliesWhen: "const { addToHNSWIndex } = await import('./memory-initializer.js');",
  edits: [{
    find: `                    namespace: 'pattern',
                    content: patternValue,
                });`,
    replace: `                    namespace: 'pattern',
                    content: patternValue,
                }, options.dbPath); // ${auxiliaryPathComment}`,
  }],
};
