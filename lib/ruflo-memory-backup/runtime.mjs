// Serialized into the native service/bridge by the exact-anchor patcher.
// Free names are the native module's existing imports and helpers.
export async function backupMemoryDb(opts = {}) {
    // ruflo-source-patch (#2895): failed snapshots never become byte copies or rotate history.
    const dbPath = path.resolve(opts.dbPath ?? defaultMemoryDbPath());
    if (!dbPath || !fs.existsSync(dbPath)) return { backedUp: false, skipped: 'no-db' };
    let db = opts.existingNativeHandle;
    const borrowed = Boolean(db);
    let destPath;
    let reserved = false;
    let sourceIntegrity;
    try {
        if (!borrowed) {
            const Database = await loadBetterSqlite3();
            db = new Database(dbPath, { readonly: true });
        }
        if (!db || typeof db.backup !== 'function' || typeof db.pragma !== 'function'
            || !db.name || fs.realpathSync(db.name) !== fs.realpathSync(dbPath))
            throw new Error('Native backup handle identity unavailable or mismatched');
        sourceIntegrity = db.pragma('integrity_check', { simple: true });
        if (sourceIntegrity !== 'ok') throw new Error('Source integrity is not ok; snapshot withheld');
        const destDir = opts.destDir ?? path.join(path.dirname(dbPath), 'backups');
        if (!path.isAbsolute(destDir)) throw new Error('Backup destination directory must be absolute');
        fs.mkdirSync(destDir, { recursive: true });
        if (fs.realpathSync(destDir) !== path.resolve(destDir) || !fs.lstatSync(destDir).isDirectory())
            throw new Error('Backup destination directory is indirect or invalid');
        destPath = path.join(destDir, `${snapshotPrefix(dbPath)}${fileStamp(opts.timestamp ?? Date.now())}.db`);
        // Reserve exclusively: never overwrite a prior snapshot on timestamp collision.
        const fd = fs.openSync(destPath, 'wx', 0o600);
        reserved = true;
        fs.closeSync(fd);
        await db.backup(destPath);
        const snapshot = fs.openSync(destPath, 'r');
        try { fs.fsyncSync(snapshot); } finally { fs.closeSync(snapshot); }
        const directory = fs.openSync(destDir, 'r');
        try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
        const sizeBytes = fs.statSync(destPath).size;
        if (sizeBytes <= 0) throw new Error('Native backup returned an empty snapshot');
        // A source check is not an independent snapshot validation. Preserve history.
        const rotatedAway = [];
        let gcsUri;
        let offsiteError;
        if (opts.gcs && !borrowed) {
            try {
                const { execFileSync } = await import('child_process');
                const destination = opts.gcs.replace(/\/+$/, '') + '/' + path.basename(destPath);
                execFileSync('gcloud', ['storage', 'cp', destPath, destination], { stdio: ['ignore', 'ignore', 'ignore'] });
                gcsUri = destination;
            } catch { offsiteError = 'Offsite upload failed; local snapshot retained'; }
        }
        return { backedUp: true, path: destPath, sizeBytes, rotatedAway, gcsUri, offsiteError,
            sourceIntegrity: 'ok-before-backup', snapshotIntegrity: 'not-checked',
            method: 'sqlite-online-backup', borrowedHandle: borrowed, restoreQualified: false,
            rotation: 'withheld-pending-snapshot-validation' };
    } catch (error) {
        return { backedUp: false, skipped: `backup failed: ${error?.message ?? error}`,
            partialPath: reserved ? destPath : undefined, sourceIntegrity: sourceIntegrity === 'ok' ? 'ok-before-backup' : 'unverified',
            rotatedAway: [], restoreQualified: false };
    } finally {
        if (db && !borrowed) { try { db.close(); } catch { /* preserve primary failure */ } }
    }
}

export async function bridgeBackupExisting(options = {}) {
    // ruflo-source-patch (#2895): borrow an already initialized owner; no init, fallback or close.
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeBackupExisting(options));
    try {
        if (typeof options.dbPath !== 'string' || !path.isAbsolute(options.dbPath)
            || typeof options.destDir !== 'string' || !path.isAbsolute(options.destDir))
            throw new Error('Absolute dbPath and existing destDir are required');
        const key = canonicalDbPath(options.dbPath);
        const registry = registryInstances.get(key);
        const agentdb = registry?.getAgentDB();
        const db = agentdb?.database;
        if (!db || agentdb.isWasm !== false || typeof db.backup !== 'function')
            throw new Error('Existing native registry owner unavailable; no connection opened');
        const nfs = await import('node:fs');
        const dir = nfs.lstatSync(options.destDir);
        if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid()
            || nfs.realpathSync(options.destDir) !== path.resolve(options.destDir))
            throw new Error('Destination must be an existing owned canonical directory');
        const { backupMemoryDb } = await import('../services/memory-backup.js');
        const result = await backupMemoryDb({ dbPath: key, destDir: options.destDir, existingNativeHandle: db });
        return { ...result, success: result.backedUp === true,
            ...(result.backedUp === true ? {} : { error: result.skipped || 'Native backup failed' }),
            ownerPid: process.pid, dbPath: key };
    } catch (error) {
        return { success: false, backedUp: false, error: error?.message ?? String(error), restoreQualified: false };
    }
}

export const tool = {
    name: 'memory_backup',
    description: 'Preserve one existing native registry store with SQLite online backup. No new source connection, initialization, raw copy, rotation or restore. Source integrity is checked before backup; snapshot restore remains unqualified. Requires operator-authorized existing destination directory.',
    category: 'memory',
    inputSchema: { type: 'object', additionalProperties: false,
        properties: { dbPath: { type: 'string' }, destDir: { type: 'string' } }, required: ['dbPath', 'destDir'] },
    handler: async (input) => {
        const { bridgeBackupExisting } = await import('../memory/memory-bridge.js');
        return bridgeBackupExisting(input);
    },
};
