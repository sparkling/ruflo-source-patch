// ruvnet/ruflo#3313: the native constructor takes options, not a filename.
// Own only the adapter. Never migrate graph data, steal locks, or kill a holder.
export const GRAPH_OLD = `async function loadGraphNode() {
    if (graphBackendLoaded)
        return graphNodeModule;
    graphBackendLoaded = true;
    try {
        const { createRequire } = await import('module');
        const requireCjs = createRequire(import.meta.url);
        graphNodeModule = requireCjs('@ruvector/graph-node');
        graphBackendAvailable = true;
        return graphNodeModule;
    }
    catch {
        graphBackendAvailable = false;
        return null;
    }
}
/**
 * Get or create the singleton graph database instance
 */
async function getGraphDb() {
    if (graphDb)
        return graphDb;
    const mod = await loadGraphNode();
    if (!mod)
        return null;
    // Use persistent path if available, otherwise in-memory
    const dataDir = join(process.cwd(), '.claude-flow', 'graph');
    try {
        const fs = await import('fs');
        fs.mkdirSync(dataDir, { recursive: true });
        graphDb = new mod.GraphDatabase(join(dataDir, 'agents.db'));
    }
    catch {
        // Fallback to in-memory
        graphDb = new mod.GraphDatabase();
    }
    return graphDb;
}`;

export const GRAPH_NEW = `// ruflo-source-patch (#3313): one initialization and a proven persistent handle.
let __rufloGraphModulePromise = null;
let __rufloGraphDbPromise = null;
let __rufloGraphVerificationFailed = false;
let __rufloGraphPackageVersion = null;
async function loadGraphNode() {
    if (graphBackendLoaded)
        return graphNodeModule;
    if (!__rufloGraphModulePromise) {
        __rufloGraphModulePromise = (async () => {
            try {
                const { createRequire } = await import('module');
                const requireCjs = createRequire(import.meta.url);
                graphNodeModule = requireCjs('@ruvector/graph-node');
                try {
                    __rufloGraphPackageVersion = requireCjs('@ruvector/graph-node/package.json').version;
                } catch { /* an unverified native dependency cannot promise persistence */ }
                graphBackendAvailable = true;
                return graphNodeModule;
            }
            catch {
                graphBackendAvailable = false;
                return null;
            }
            finally {
                graphBackendLoaded = true;
            }
        })();
    }
    return __rufloGraphModulePromise;
}
/**
 * Get the process's singleton at the existing project graph path.
 * Missing optional package stays unavailable; failed persistence never becomes RAM.
 */
async function getGraphDb() {
    if (graphDb)
        return graphDb;
    const dataDir = join(process.cwd(), '.claude-flow', 'graph');
    if (!__rufloGraphDbPromise) {
        __rufloGraphDbPromise = (async () => {
            const mod = await loadGraphNode();
            if (!mod)
                return null;
            const storagePath = join(dataDir, 'agents.db');
            try {
                // Native 2.0.4 can claim persistence yet lose edges after reopen
                // (RuVector #879/#938). Do not hide that second, upstream defect.
                const version = String(__rufloGraphPackageVersion ?? 'unknown');
                const release = /^([0-9]+)[.]([0-9]+)[.]([0-9]+)$/.exec(version);
                if (!release || !(Number(release[1]) > 2
                    || (Number(release[1]) === 2 && Number(release[2]) >= 1)))
                    throw new Error('@ruvector/graph-node >=2.1.0 stable is required for durable edge reopen; found ' + version);
                const fs = await import('fs');
                fs.mkdirSync(dataDir, { recursive: true });
                const candidate = new mod.GraphDatabase({
                    storagePath,
                    dimensions: DEFAULT_EMBEDDING_DIM,
                    distanceMetric: 'Cosine',
                });
                // There is no native close() API. A constructed but unverified
                // handle must not be recreated on every call.
                __rufloGraphVerificationFailed = true;
                if (candidate.isPersistent?.() !== true
                    || candidate.getStoragePath?.() !== storagePath)
                    throw new Error('Native graph did not confirm the requested persistent path');
                graphDb = candidate;
                __rufloGraphVerificationFailed = false;
                return graphDb;
            }
            catch (error) {
                throw new Error('[ruflo-source-patch #3313] Persistent native graph unavailable at '
                    + storagePath + '; no in-memory fallback opened: '
                    + (error instanceof Error ? error.message : String(error)), { cause: error });
            }
        })().catch(error => {
            // A later call may retry after the existing owner releases its lock.
            // Never unlink locks/sidecars or close someone else's native handle.
            if (!__rufloGraphVerificationFailed) __rufloGraphDbPromise = null;
            throw error;
        });
    }
    return __rufloGraphDbPromise;
}`;

// Leave the existing path expression to its owner (including the cwd target).
// Splitting at the join arguments preserves literal proof of BOTH surrounding
// adapter blocks after cwd composes its root resolver. No global proof relaxation.
const pathExpression = "process.cwd(), '.claude-flow', 'graph'";
const oldParts = GRAPH_OLD.split(pathExpression);
const newParts = GRAPH_NEW.split(pathExpression);
if (oldParts.length !== 2 || newParts.length !== 2) throw new Error('Graph path boundary drift');
export const GRAPH_ENTRIES = [{
  id: 'ruflo-graph-persistence/native-constructor',
  target: 'ruflo-graph-persistence',
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'ruvector', 'graph-backend.js'],
  edits: oldParts.map((find, i) => ({ find, replace: newParts[i] })),
}];
