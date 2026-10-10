const registryPromises = new Map();
const registryInstances = new Map();
const operationContext = new AsyncLocalStorage();
let activeOperations = 0;
let drained = null;
let shutdownPromise = null;
let testRegistryOverride = null;
const bridgeFailureReasons = new Map();
async function withBridgeOperation(operation) {
    if (operationContext.getStore()?.active)
        return operation();
    // New calls belong to the next lifecycle once retirement starts. A loop
    // also handles another shutdown requested before a queued call resumes.
    while (shutdownPromise)
        await shutdownPromise;
    const lease = { active: true };
    activeOperations++;
    try {
        return await operationContext.run(lease, operation);
    }
    finally {
        lease.active = false;
        if (--activeOperations === 0) {
            drained?.();
            drained = null;
        }
    }
}
export function getBridgeFailureReason(dbPath) {
    if (shouldDisableNativeBridge()) {
        return process.platform === 'win32'
            ? 'AgentDB native bridge disabled on Windows after #3024; set CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS=1 to opt in'
            : 'AgentDB native bridge disabled by CLAUDE_FLOW_DISABLE_BRIDGE=1';
    }
    return bridgeFailureReasons.get(canonicalDbPath(dbPath)) ?? null;
}
export function shutdownBridge() {
    if (shutdownPromise)
        return shutdownPromise;
    // Publish the barrier before any await: no later operation can join the
    // retiring lifecycle. Concurrent callers share the same retirement promise.
    shutdownPromise = (async () => {
        if (activeOperations > 0)
            await new Promise(resolve => { drained = resolve; });
        await Promise.allSettled([...registryPromises.values()]);
        // A failed PERSIST (AGENTDB_LOCK_UNRECOVERABLE: live lock or concurrent
        // writer on a sql.js database) means pending changes were not saved. That
        // is surfaced after cleanup completes; other close errors stay best-effort.
        let persistFailure;
        for (const registry of new Set(registryInstances.values())) {
            try {
                await registry.shutdown();
            }
            catch (err) {
                if (err?.code === 'AGENTDB_LOCK_UNRECOVERABLE')
                    persistFailure ??= err;
            }
        }
        registryInstances.clear();
        registryPromises.clear();
        testRegistryOverride = null;
        bridgeFailureReasons.clear();
        if (persistFailure)
            throw persistFailure;
    })().finally(() => { shutdownPromise = null; });
    return shutdownPromise;
}
