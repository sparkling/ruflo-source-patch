// ===== #4712: persisted inventory of the hierarchical (tiered) store =====
/** Smallest @claude-flow/memory that ships TieredMemoryStore.listEntries/getEntry. */
const TIERED_INVENTORY_MIN_MEMORY = '3.3.0';
/**
 * Run a read-only inventory call against the `hierarchicalMemory` controller
 * inside one bridge operation. Refuses, never fabricates: a native agentdb
 * controller, an older @claude-flow/memory without the API, a volatile store
 * and a failed read each come back as `success: false` with the reason.
 */
async function withHierarchicalInventory(operation, read) {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => withHierarchicalInventory(operation, read));
    const registry = await getRegistry();
    if (!registry)
        return null;
    let hm;
    try {
        hm = registry.get('hierarchicalMemory');
    }
    catch (e) {
        return { success: false, error: `HierarchicalMemory not available: ${e?.message ?? e}` };
    }
    if (!hm)
        return { success: false, error: 'HierarchicalMemory not available' };
    if (typeof hm.getStats === 'function' && typeof hm.promote === 'function') {
        return {
            success: false,
            controller: 'native-unsupported',
            error: `hierarchical-${operation} reads the tiered_memory table; the native agentdb HierarchicalMemory has no inventory API`,
        };
    }
    const info = describeHierarchicalStore(hm, getHierarchicalFallback(registry));
    if (typeof hm.listEntries !== 'function' || typeof hm.getEntry !== 'function') {
        return {
            success: false,
            ...info,
            code: 'unsupported',
            error: `the installed @claude-flow/memory predates TieredMemoryStore.listEntries/getEntry (needs >= ${TIERED_INVENTORY_MIN_MEMORY})`,
        };
    }
    try {
        return { success: true, ...info, ...read(hm) };
    }
    catch (e) {
        return {
            success: false,
            ...info,
            ...(typeof e?.code === 'string' ? { code: e.code } : {}),
            error: String(e?.message ?? e),
        };
    }
}
/** Page through every persisted hierarchical-memory entry (#4712). */
export async function bridgeHierarchicalList(params) {
    return withHierarchicalInventory('list', hm => hm.listEntries({
        tier: params.tier,
        status: params.status,
        limit: params.limit,
        cursor: params.cursor,
    }));
}
/** Exact read of one hierarchical-memory entry by its stable id (#4712). */
export async function bridgeHierarchicalGet(params) {
    return withHierarchicalInventory('get', hm => {
        const entry = hm.getEntry(params.id, { includeInactive: params.includeInactive === true });
        return { found: entry !== null, entry };
    });
}
// ===== #4707: read-only pattern / skill inventory and hierarchical counts =====
/** Smallest agentdb whose ReasoningBank/SkillLibrary ship listPatterns/listSkills/getSkill. */
const AGENTDB_INVENTORY_MIN = '3.3.0';
/**
 * Run one read against a registry controller inside a bridge operation.
 * Refuses, never fabricates: a missing controller and a controller without
 * the method both come back as `success: false, code: 'unsupported'` naming
 * the method, so neither can be read as an empty inventory. A native error
 * (bad page arguments, the graph-adapter refusal) keeps its own code.
 */
async function withInventoryController(controllerName, method, read) {
    if (!operationContext.getStore()?.active) {
        return withBridgeOperation(() => withInventoryController(controllerName, method, read));
    }
    const registry = await getRegistry();
    if (!registry)
        return null;
    let controller;
    try {
        controller = registry.get(controllerName);
    }
    catch (e) {
        return { success: false, controller: controllerName, code: 'unsupported', error: `${controllerName} not available, so ${method} cannot run: ${e?.message ?? e}` };
    }
    if (!controller) {
        return { success: false, controller: controllerName, code: 'unsupported', error: `${controllerName} controller is not available, so ${method} cannot run` };
    }
    if (typeof controller[method] !== 'function') {
        return {
            success: false,
            controller: controllerName,
            code: 'unsupported',
            error: `the active ${controllerName} controller has no ${method}() (needs agentdb >= ${AGENTDB_INVENTORY_MIN})`,
        };
    }
    try {
        return { success: true, controller: controllerName, ...read(controller) };
    }
    catch (e) {
        return {
            success: false,
            controller: controllerName,
            ...(typeof e?.code === 'string' ? { code: e.code } : {}),
            ...(typeof e?.field === 'string' ? { field: e.field } : {}),
            error: String(e?.message ?? e),
        };
    }
}
/** Native list result envelope, passed through unchanged. */
function pageOf(page) {
    return { items: page?.items, total: page?.total, limit: page?.limit, offset: page?.offset };
}
/** Page through ReasoningBank patterns, newest first (#4707). */
export async function bridgeListPatterns(params) {
    return withInventoryController('reasoningBank', 'listPatterns', rb => pageOf(rb.listPatterns({ taskType: params.taskType, limit: params.limit, offset: params.offset })));
}
/** Page through SkillLibrary skills, newest first (#4707). */
export async function bridgeListSkills(params) {
    return withInventoryController('skills', 'listSkills', sk => pageOf(sk.listSkills({ minSuccessRate: params.minSuccessRate, limit: params.limit, offset: params.offset })));
}
/** Exact read of one skill by its numeric id (#4707). */
export async function bridgeGetSkill(params) {
    return withInventoryController('skills', 'getSkill', sk => {
        const skill = sk.getSkill(params.id);
        return { found: skill != null, skill: skill ?? null };
    });
}
/**
 * Count-only view of the hierarchical store (#4707). `tiers` is the
 * in-memory tier map sizes from getTierStats(); `persistedRows` is the
 * tiered_memory row count from countPersisted() (null on a volatile store).
 * They measure different things and are reported side by side.
 */
export async function bridgeHierarchicalStats() {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeHierarchicalStats());
    const registry = await getRegistry();
    if (!registry)
        return null;
    let hm;
    try {
        hm = registry.get('hierarchicalMemory');
    }
    catch (e) {
        return { success: false, code: 'unsupported', error: `HierarchicalMemory not available, so getTierStats/countPersisted cannot run: ${e?.message ?? e}` };
    }
    if (!hm) {
        return { success: false, code: 'unsupported', error: 'HierarchicalMemory not available, so getTierStats/countPersisted cannot run' };
    }
    const isNative = typeof hm.getStats === 'function' && typeof hm.promote === 'function';
    const missing = ['getTierStats', 'countPersisted'].filter(m => typeof hm[m] !== 'function');
    if (isNative || missing.length > 0) {
        return {
            success: false,
            controller: isNative ? 'hierarchicalMemory' : 'tieredMemoryStore',
            code: 'unsupported',
            error: isNative
                ? 'the native agentdb HierarchicalMemory has no getTierStats()/countPersisted()'
                : `the active hierarchical store has no ${missing.join('()/')}() (the installed @claude-flow/memory predates it)`,
        };
    }
    const info = describeHierarchicalStore(hm, getHierarchicalFallback(registry));
    try {
        return { success: true, ...info, tiers: hm.getTierStats(), persistedRows: hm.countPersisted() };
    }
    catch (e) {
        return { success: false, ...info, error: String(e?.message ?? e) };
    }
}
//# sourceMappingURL=memory-bridge.js.map