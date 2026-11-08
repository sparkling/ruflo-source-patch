import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeSync, } from 'node:fs';
export function writeFileAtomic(path, data, opts = {}) {
    const mode = opts.mode ?? 0o600;
    const dir = dirname(path);
    const tmp = join(dir, `.${basename(path)}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    let fd;
    try {
        fd = openSync(tmp, 'wx', mode);
        if (data.length > 0)
            writeSync(fd, data, 0, data.length, 0);
        fsyncSync(fd); // durability: force bytes to disk BEFORE the rename
        closeSync(fd);
        fd = undefined;
        renameSync(tmp, path); // atomic swap — readers never see a torn image
        try {
            chmodSync(path, mode);
        }
        catch {
            // Windows / FS without POSIX modes — silently skip.
        }
        // Best-effort: fsync the directory so the rename survives a power loss.
        try {
            const dfd = openSync(dir, 'r');
            try {
                fsyncSync(dfd);
            }
            finally {
                closeSync(dfd);
            }
        }
        catch {
            // Directory fsync unsupported (e.g. Windows) — the rename is still atomic.
        }
    }
    catch (e) {
        if (fd !== undefined) {
            try {
                closeSync(fd);
            }
            catch {
                /* already closed */
            }
        }
        try {
            unlinkSync(tmp);
        }
        catch {
            /* temp never created / already gone */
        }
        throw e;
    }
}