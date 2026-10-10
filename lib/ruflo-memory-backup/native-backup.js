export async function backupMemoryDb(opts = {}) {
    const dbPath = opts.dbPath ?? defaultMemoryDbPath();
    if (!dbPath || !fs.existsSync(dbPath))
        return { backedUp: false, skipped: 'no-db' };
    let Database;
    try {
        const mod = 'better-sqlite3';
        Database = (await import(mod)).default;
    }
    catch {
        return { backedUp: false, skipped: 'better-sqlite3 unavailable' };
    }
    const destDir = opts.destDir ?? path.join(path.dirname(dbPath), 'backups');
    try {
        fs.mkdirSync(destDir, { recursive: true });
    }
    catch { /* */ }
    const destPath = path.join(destDir, `${snapshotPrefix(dbPath)}${fileStamp(opts.timestamp ?? Date.now())}.db`);
    // WAL-safe online backup: read-only source, consistent snapshot to destPath.
    let db;
    try {
        db = new Database(dbPath, { readonly: true });
        await db.backup(destPath);
        db.close();
    }
    catch (e) {
        try {
            db?.close();
        }
        catch { /* */ }
        // #2798 — under CLAUDE_FLOW_ENCRYPT_AT_REST the source is an RFE1
        // blob, not native SQLite, so better-sqlite3's online-backup API
        // throws "file is not a database" and the run was silently recorded
        // as skipped (users with encryption had ZERO backups behind a green
        // status). The online-backup API only exists to avoid tearing a live
        // WAL-mode DB; that concern doesn't apply to the encrypted file (sql.js
        // rewrites it wholesale per flush), so a plain byte copy is a valid
        // snapshot. Fall back to it before giving up.
        try {
            fs.copyFileSync(dbPath, destPath);
            const copiedBytes = fs.statSync(destPath).size;
            if (copiedBytes > 0) {
                // Fall through to rotation/offsite/return below via a flag path.
                // (Mirror the success path's tail by re-using the same code.)
                const keep = typeof opts.keep === 'number' && opts.keep > 0 ? opts.keep : 7;
                const rotatedAway = [];
                try {
                    const snaps = fs.readdirSync(destDir).filter(f => isSnapshotFor(f, dbPath)).sort();
                    while (snaps.length > keep) {
                        const old = snaps.shift();
                        try {
                            fs.rmSync(path.join(destDir, old), { force: true });
                            rotatedAway.push(old);
                        }
                        catch { /* */ }
                    }
                }
                catch { /* */ }
                let gcsUri;
                if (opts.gcs) {
                    try {
                        const { execFileSync } = await import('child_process');
                        const dest = opts.gcs.replace(/\/+$/, '') + '/' + path.basename(destPath);
                        execFileSync('gcloud', ['storage', 'cp', destPath, dest], { stdio: ['ignore', 'ignore', 'inherit'] });
                        gcsUri = dest;
                    }
                    catch { /* offsite failed — local snapshot stands */ }
                }
                if (opts.verbose) {
                    console.log(`memory DB backed up (byte-copy, encrypted-at-rest) → ${destPath} (${Math.round(copiedBytes / 1024)} KB)`);
                }
                return { backedUp: true, path: destPath, sizeBytes: copiedBytes, rotatedAway, gcsUri };
            }
        }
        catch { /* byte-copy also failed — report the original error */ }
        return { backedUp: false, skipped: `backup failed: ${e?.message ?? e}` };
    }
    let sizeBytes = 0;
    try {
        sizeBytes = fs.statSync(destPath).size;
    }
    catch { /* */ }
    // Rotation — ISO-stamped names sort chronologically, so keep the tail.
    const keep = typeof opts.keep === 'number' && opts.keep > 0 ? opts.keep : 7;
    const rotatedAway = [];
    try {
        const snaps = fs.readdirSync(destDir).filter(f => isSnapshotFor(f, dbPath)).sort();
        while (snaps.length > keep) {
            const old = snaps.shift();
            try {
                fs.rmSync(path.join(destDir, old), { force: true });
                rotatedAway.push(old);
            }
            catch { /* */ }
        }
    }
    catch { /* */ }
    // Optional offsite to GCS (best-effort; local backup already succeeded).
    let gcsUri;
    if (opts.gcs) {
        try {
            const { execFileSync } = await import('child_process');
            const dest = opts.gcs.replace(/\/+$/, '') + '/' + path.basename(destPath);
            execFileSync('gcloud', ['storage', 'cp', destPath, dest], { stdio: ['ignore', 'ignore', 'inherit'] });
            gcsUri = dest;
        }
        catch { /* offsite failed — local snapshot stands */ }
    }
    if (opts.verbose) {
        console.log(`memory DB backed up → ${destPath} (${Math.round(sizeBytes / 1024)} KB)` +
            (rotatedAway.length ? `, rotated ${rotatedAway.length} old` : '') +
            (gcsUri ? `, offsite ${gcsUri}` : ''));
    }
    return { backedUp: true, path: destPath, sizeBytes, rotatedAway, gcsUri };
}
