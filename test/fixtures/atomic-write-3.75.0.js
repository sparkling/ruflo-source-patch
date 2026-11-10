/**
 * Restricted-permission file helpers.
 *
 * audit_1776853149979: session/memory/terminal stores were written with the
 * process umask, which on most macOS/Linux setups leaves them world-readable
 * (mode 0644). They contain conversation snapshots, agent prompts, and
 * terminal command history — anyone else on the host can read them.
 *
 * These helpers write atomically and force mode 0600 (files) / 0700 (dirs).
 * chmod fails silently on Windows, where POSIX modes don't apply — that's
 * fine, the OS-level ACL surface there is different.
 *
 * ADR-096 Phase 2: optional opt-in encryption-at-rest. When the caller
 * passes `encrypt: true` AND the env-gated vault is enabled, payloads are
 * AES-256-GCM-encrypted before hitting disk. Reads use the magic-byte
 * sniff so legacy plaintext files keep working unchanged during the
 * incremental migration.
 */
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeSync, } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { decryptBuffer, encryptBuffer, getKey, isEncryptedBlob, isEncryptionEnabled, MAGIC, } from './encryption/vault.js';
/**
 * Crash-safe atomic file write (issue #2584).
 *
 * A plain `writeFileSync(dbPath, db.export())` of a large sql.js image is NOT
 * crash-safe: a kill/OOM mid-write — or a second process rewriting the same
 * path concurrently — leaves a half-written image, and reopening it yields
 * `database disk image is malformed`. The corruption window scales with file
 * size, so a 185 MB monolithic flush is especially exposed.
 *
 * This writes to a unique temp sibling, fsyncs the bytes to disk, then
 * `rename()`s over the target. rename() is atomic on POSIX within one
 * filesystem, so a reader/reopen sees either the old complete image or the new
 * complete image — never a torn one. The directory entry is best-effort fsynced
 * so the rename itself survives a crash. On any failure the temp file is
 * removed and the original is left untouched.
 */
export function writeFileAtomic(path, data, opts = {}) {
    const mode = opts.mode ?? 0o600;
    const dir = dirname(path);
    const tmp = join(dir, `.${basename(path)}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    let fd;
    try {
        fd = openSync(tmp, 'wx', mode);
        // writeSync may write fewer bytes than asked (#4888). Loop until every byte
        // is on the temp file, or rename() would publish a truncated image.
        let written = 0;
        while (written < data.length) {
            const n = writeSync(fd, data, written, data.length - written, written);
            if (n <= 0)
                throw new Error(`writeFileAtomic: write made no progress at byte ${written} of ${data.length}`);
            written += n;
        }
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