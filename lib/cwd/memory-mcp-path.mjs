import path from 'node:path';
// Ruflo #2105/#3153: carry the configured store through MCP, not only init.
export const MCP_PATH_ANCHOR = `    return {
        storeEntry,
        searchEntries,
        listEntries,
        getEntry,
        deleteEntry,
        initializeMemoryDatabase,
        checkMemoryInitialization,
    };`;

export const MCP_PATH_REPLACEMENT = `    // ruflo-source-patch: MCP explicit database identity (#2105/#3153).
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

// #2105/#3143: implicit controller calls must share the configured MCP store.
// #2786's separate encrypted sql.js store remains a legacy, explicit distinction.
export const CONTROLLER_PATH_ANCHOR = `function getAgentDbPath() {
    const dbPath = getDbPath();
    if (dbPath === ':memory:')
        return ':memory:';
    return path.join(path.dirname(dbPath), 'agentdb-memory.db');
}`;
export const CONTROLLER_PATH_REPLACEMENT = `function getAgentDbPath() {
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
  const resolve = env => new Function('process', 'path', 'getDbPath', fn + '\nreturn getAgentDbPath();')(
    {env}, path, () => '/project/.swarm/memory.db');
  try {
    for (const value of ['/configured/memory.db', '/outside/user-memory.db', ':memory:']) {
      if (resolve({CLAUDE_FLOW_DB_PATH:value}) !== value) return false;
    }
    if (resolve({}) !== '/project/.swarm/memory.db') return false;
    if (resolve({CLAUDE_FLOW_ENCRYPT_AT_REST:'1'}) !== '/project/.swarm/agentdb-memory.db') return false;
    try { resolve({CLAUDE_FLOW_DB_PATH:'/configured/memory.db',CLAUDE_FLOW_ENCRYPT_AT_REST:'1'}); return false; }
    catch { return true; }
  } catch { return false; }
}
