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
