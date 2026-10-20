// Exact published 3.59.1 backupMemoryDb function; SHA-256 526f22b5303f6c04d709a17ca1a779994ed1f8ee130135cef8ca24a60e5cae55
export async function backupMemoryDb(opts = {}) {
    const dbPath = opts.dbPath ?? defaultMemoryDbPath();
    if (!dbPath || !fs.existsSync(dbPath))
        return { backedUp: false, skipped: 'no-db' };
    const destDir = opts.destDir ?? path.join(path.dirname(dbPath), 'backups');
    try {
        fs.mkdirSync(destDir, { recursive: true });
    }
    catch { /* */ }
    const destPath = path.join(destDir, `${snapshotPrefix(dbPath)}${fileStamp(opts.timestamp ?? Date.now())}.db`);
    let Database = opts.Database;
    let nativeError = null;
    if (!Database) {
        try {
            const mod = 'better-sqlite3';
            Database = (await import(mod)).default;
        }
        catch {
            nativeError = 'better-sqlite3 unavailable';
        }
    }
    if (!nativeError) {
        // WAL-safe online backup: read-only source, consistent snapshot to destPath.
        let db;
        try {
            db = new Database(dbPath, { readonly: true });
            await db.backup(destPath);
            db.close();
            let sizeBytes = 0;
            try {
                sizeBytes = fs.statSync(destPath).size;
            }
            catch { /* */ }
            return await finishBackup(destPath, dbPath, destDir, opts, 'native-online-backup', sizeBytes);
        }
        catch (e) {
            try {
                db?.close();
            }
            catch { /* */ }
            try {
                fs.rmSync(destPath, { force: true });
            }
            catch { /* a native backup() that throws mid-write can leave a torn destPath */ }
            nativeError = e?.message ?? String(e);
        }
    }
    // #2798 — under CLAUDE_FLOW_ENCRYPT_AT_REST the source is an RFE1 blob, not
    // native SQLite, so better-sqlite3's online-backup API throws "file is not
    // a database" (or isn't even importable on a WASM-only host). The
    // online-backup API exists to avoid tearing a live WAL-mode DB; that
    // concern doesn't apply to the encrypted file (sql.js rewrites it wholesale
    // per flush), so a plain byte copy IS a valid snapshot there.
    //
    // But this fallback must never fire for an ORDINARY (non-encrypted) source
    // just because the native backup threw — SQLITE_BUSY, a disk error, or any
    // other native-backup failure on a perfectly normal database must fail
    // closed, not silently report `backedUp: true` off a raw copy. Positively
    // verify encryption (4-byte RFE1 magic sniff) before ever taking this path;
    // "the native backup threw" is never by itself evidence the source is
    // encrypted.
    if (existingFileIsEncrypted(dbPath) !== true) {
        return { backedUp: false, skipped: `native backup failed: ${nativeError}` };
    }
    // Even for a confirmed-encrypted source, refuse the raw-copy fallback if
    // there's an active WAL — a plain copy of the main file alone would miss
    // uncommitted WAL frames and silently produce an inconsistent snapshot.
    if (hasActiveWal(dbPath)) {
        return { backedUp: false, skipped: 'active WAL present — refusing raw-copy fallback (would be inconsistent)' };
    }
    try {
        fs.copyFileSync(dbPath, destPath);
        const copiedBytes = fs.statSync(destPath).size;
        if (copiedBytes > 0) {
            return await finishBackup(destPath, dbPath, destDir, opts, 'raw-copy-fallback', copiedBytes);
        }
    }
    catch { /* byte-copy also failed — report the original native error below */ }
    try {
        fs.rmSync(destPath, { force: true });
    }
    catch { /* */ }
    return { backedUp: false, skipped: `native backup failed: ${nativeError}` };
}
