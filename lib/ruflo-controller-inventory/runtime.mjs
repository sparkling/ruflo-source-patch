// ruvnet/ruflo#4707: bind existing public controllers, never open a second owner.
// Retire after equivalent upstream owner bindings pass pagination, exact read,
// identity/refusal and live-consumer proof; a matching tool name is insufficient.
export const BRIDGE_RUNTIME = String.raw`// ruflo-source-patch (controller-inventory bridge)
export async function bridgeControllerInventory(operation, options = {}) {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeControllerInventory(operation, options));
    const methods = {
        patterns: ['reasoningBank', 'listPatterns'],
        skills: ['skills', 'listSkills'],
        skill: ['skills', 'getSkill'],
        tiers: ['hierarchicalMemory', 'getTierStats'],
    };
    if (!Object.hasOwn(methods, operation)) return { success: false, error: 'invalid-inventory-operation', reason: 'invalid-inventory-operation' };
    const [controller, method] = methods[operation];
    try {
        const expected = canonicalDbPath(options.dbPath);
        const registry = await getControllerRegistry(options.dbPath);
        if (!registry || registry.dbPath !== expected)
            return { success: false, error: 'native-registry-identity-mismatch', reason: 'native-registry-identity-mismatch', expectedDbPath: expected, actualDbPath: registry?.dbPath ?? null };
        const native = registry.get(controller);
        if (!native || typeof native[method] !== 'function')
            return { success: false, error: 'native-inventory-unsupported', reason: 'native-inventory-unsupported', controller, method };
        const identity = { controller, dbPath: registry.dbPath };
        if (operation === 'tiers') {
            return { success: true, ...identity, coverage: 'count-only',
                ...describeHierarchicalStore(native, getHierarchicalFallback(registry)),
                tierStats: await native.getTierStats(),
                persistedRows: typeof native.countPersisted === 'function' ? await native.countPersisted() : null,
                limitation: 'Native tier counts and persisted row count describe different representations; no record enumeration or exact hierarchical read is provided.' };
        }
        if (operation === 'skill') {
            const skill = await native.getSkill(options.skillId);
            if (skill !== null && (!skill || typeof skill !== 'object' || Array.isArray(skill)))
                return { success: false, error: 'invalid-native-skill', reason: 'invalid-native-skill', ...identity };
            return { success: true, ...identity, found: skill !== null, skill };
        }
        const { dbPath, ...query } = options;
        const page = await native[method](query);
        if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0
            || !Number.isSafeInteger(page.limit) || page.limit < 1 || !Number.isSafeInteger(page.offset) || page.offset < 0)
            return { success: false, error: 'invalid-native-inventory', reason: 'invalid-native-inventory', ...identity };
        return { success: true, ...identity, coverage: 'native-paginated-inventory', page };
    } catch (error) {
        return { success: false, reason: 'native-inventory-failed', controller, method,
            error: error instanceof Error ? error.message.replace(/\/[^\s:]+\//g, '<path>/').slice(0, 500) : 'Native controller failure' };
    }
}
`;
export const TOOL_RUNTIME = String.raw`// ruflo-source-patch (controller-inventory tools)
const rspInventoryPage = {
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
    offset: { type: 'integer', minimum: 0, default: 0 },
};
function rspInventoryTool(name, operation, description, properties, required = []) {
    return { name, description, annotations: { readOnlyHint: true, destructiveHint: false },
        inputSchema: { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) },
        handler: async (params = {}) => {
            if (!params || typeof params !== 'object' || Array.isArray(params)
                || Object.keys(params).some(key => !Object.hasOwn(properties, key))
                || required.some(key => params[key] === undefined))
                return { success: false, error: 'invalid-inventory-arguments', reason: 'invalid-inventory-arguments' };
            for (const [key, value] of Object.entries(params)) {
                const schema = properties[key];
                if (schema.type === 'integer' && (!Number.isSafeInteger(value) || value < schema.minimum || (schema.maximum !== undefined && value > schema.maximum))
                    || schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))
                    || schema.type === 'string' && (typeof value !== 'string' || value.length > schema.maxLength))
                    return { success: false, error: 'invalid-inventory-arguments', reason: 'invalid-inventory-arguments', field: key };
            }
            return (await getBridge()).bridgeControllerInventory(operation, params);
        },
    };
}
export const agentdbPatternList = rspInventoryTool('agentdb_pattern-list', 'patterns',
    'Read-only native ReasoningBank inventory, newest ID first. page.total counts every matching taskType; page limit/offset are not a semantic top-K. Pages are live reads, not a snapshot across concurrent writes.',
    { ...rspInventoryPage, taskType: { type: 'string', maxLength: 1000 } });
export const agentdbSkillList = rspInventoryTool('agentdb_skill-list', 'skills',
    'Read-only native SkillLibrary inventory, newest ID first. page.total counts every matching minSuccessRate; preserves native backend refusal. Pages are live reads, not a snapshot across concurrent writes.',
    { ...rspInventoryPage, minSuccessRate: { type: 'number' } });
export const agentdbSkillGet = rspInventoryTool('agentdb_skill-get', 'skill',
    'Read one exact native SkillLibrary record by positive native ID; found:false only when the public controller returns null. Preserves native backend refusal.',
    { skillId: { type: 'integer', minimum: 1 } }, ['skillId']);
export const agentdbHierarchicalStats = rspInventoryTool('agentdb_hierarchical-stats', 'tiers',
    'Count-only native hierarchical/tier statistics, with durability, fallback and persisted-row qualifiers. Not record enumeration, an exact hierarchical read, or a semantic top-K census.', {});
`;
