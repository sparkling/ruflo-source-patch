// Injected into the native resolver; its two resolver functions remain the owner.
export async function runAutoMemoryHook(action, scope) {
    if (!['prepare', 'import', 'sync'].includes(action) || !['project', 'user'].includes(scope))
        throw new Error('AutoMemory requires action prepare|import|sync and scope project|user');
    const os = await import('node:os');
    const { pathToFileURL } = await import('node:url');
    const { spawnSync } = await import('node:child_process');
    const project = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const relative = path.join('.claude', 'helpers', 'auto-memory-hook.mjs');
    let helper = path.join(scope === 'user' ? os.homedir() : project, relative);
    if (scope === 'project' && !fs.existsSync(helper)) helper = path.join(os.homedir(), relative);
    if (!fs.existsSync(helper) || !fs.statSync(helper).isFile())
        throw new Error('AutoMemory required helper is missing: ' + helper);
    // Match Node's real module location, including the native HOME fallback.
    // Do not redirect data or the canonical MCP owner to this executable root.
    const moduleRoot = path.resolve(path.dirname(fs.realpathSync(helper)), '../..');
    async function usable(distPath) {
        if (!distPath) return false;
        try { return typeof (await import(pathToFileURL(distPath).href)).AutoMemoryBridge === 'function'; }
        catch { return false; }
    }
    let distPath = resolveMemoryPackageFromProject(moduleRoot);
    let repaired = false;
    if (!await usable(distPath)) {
        const record = recordMemoryPackagePath(moduleRoot, 'auto-memory-startup');
        if (!record) throw new Error('AutoMemory package binding could not be recorded from the installed CLI');
        distPath = resolveMemoryPackageFromProject(moduleRoot);
        if (distPath !== record.distPath || !await usable(distPath))
            throw new Error('AutoMemory package binding failed readback or lacks AutoMemoryBridge');
        repaired = true;
    }
    const dataRoot = process.env.CLAUDE_PROJECT_DIR ? project : moduleRoot;
    const data = { schemaVersion: 1, helper, moduleRoot, dataRoot, distPath, repaired };
    if (action === 'prepare') return { success: true, exitCode: 0, data };
    // One ordered operation: preparation completes before the unchanged signed
    // helper starts. No shell, new memory driver, synthetic import or env override.
    const result = spawnSync(process.execPath, [helper, action], {
        stdio: ['inherit', 'pipe', 'pipe'], timeout: 25000, maxBuffer: 8 * 1024 * 1024,
    });
    if (result.stdout?.length) process.stdout.write(result.stdout);
    if (result.stderr?.length) process.stderr.write(result.stderr);
    if (result.error || result.signal)
        throw new Error('AutoMemory helper failed: ' + (result.error?.message || result.signal));
    // #4685: this signed helper's missing-package branch still exits zero.
    // Preserve its warning and refuse that explicit failure if resolution
    // changed between preparation and execution; zero cannot override it.
    const diagnostics = String(result.stdout || '') + String(result.stderr || '');
    if (diagnostics.includes('self-learning imports are DISABLED'))
        throw new Error('AutoMemory helper reported disabled imports after preparation');
    const exitCode = Number.isInteger(result.status) ? result.status : 1;
    return { success: exitCode === 0, exitCode, data };
}
