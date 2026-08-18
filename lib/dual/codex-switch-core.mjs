#!/usr/bin/env node

import { once } from "node:events";
import { createHash } from "node:crypto";
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
} from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const REPLAY_TYPES = new Set(["reasoning", "compaction", "context_compaction"]);
export const CODEX_HOME = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
export const STATE_HOME = path.resolve(
  process.env.CODEX_SWITCH_STATE_HOME ||
    path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "codex-switch"),
);
export const STATE_FILE = path.join(STATE_HOME, "state.json");
const BACKUP_HOME = path.join(STATE_HOME, "backups");

async function* readLfLines(source, onChunk) {
  let pending = [];
  let pendingBytes = 0;
  for await (const chunk of source) {
    onChunk?.(chunk);
    let start = 0;
    let newline = chunk.indexOf(0x0a, start);
    while (newline !== -1) {
      const part = chunk.subarray(start, newline);
      const line = pending.length > 0
        ? Buffer.concat([...pending, part], pendingBytes + part.length)
        : part;
      yield line.toString("utf8");
      pending = [];
      pendingBytes = 0;
      start = newline + 1;
      newline = chunk.indexOf(0x0a, start);
    }
    const tail = chunk.subarray(start);
    if (tail.length > 0) {
      const copy = Buffer.from(tail);
      pending.push(copy);
      pendingBytes += copy.length;
    }
  }
  if (pendingBytes > 0) yield Buffer.concat(pending, pendingBytes).toString("utf8");
}

function isSparsePaddingLine(line) {
  return line.includes("\0") && /^[\u0000\s]*$/u.test(line);
}

export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

export async function assertSafeRollout(file) {
  const details = await lstat(file);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Rollout is not a regular non-symlink file: ${file}`);
  if (typeof process.getuid === "function" && details.uid !== process.getuid()) throw new Error(`Rollout is not owned by the current user: ${file}`);
  if (details.size === 0) throw new Error(`Rollout is empty: ${file}`);
  const handle = await open(file, "r");
  try {
    const finalByte = Buffer.alloc(1);
    await handle.read(finalByte, 0, 1, details.size - 1);
    if (finalByte[0] !== 0x0a) throw new Error(`Rollout does not end with a complete JSONL newline: ${file}`);
  } finally {
    await handle.close();
  }
  return details;
}

export async function canonicalCwd() {
  try {
    return await realpath(process.cwd());
  } catch {
    return path.resolve(process.cwd());
  }
}

export async function readState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, "utf8"));
    if ([1, 2, 3].includes(parsed?.version) && parsed.sessions && parsed.lastSessionByCwd) return { ...parsed, version: 3 };
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`Cannot read ${STATE_FILE}: ${error.message}`);
  }
  return { version: 3, sessions: {}, lastSessionByCwd: {} };
}

export async function writeState(state) {
  await mkdir(STATE_HOME, { recursive: true, mode: 0o700 });
  const temporary = `${STATE_FILE}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await syncPath(temporary);
  await rename(temporary, STATE_FILE);
  await chmod(STATE_FILE, 0o600);
  await syncPath(STATE_FILE);
  await syncPath(STATE_HOME, true);
}

async function walkRollouts(directory, output = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return output;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkRollouts(full, output);
    else if (entry.isFile() && /^rollout-.*\.jsonl$/u.test(entry.name)) output.push(full);
  }
  return output;
}

async function readFirstRecord(file) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
    const line = buffer.subarray(0, newline >= 0 ? newline : bytesRead).toString("utf8").trim();
    return line ? JSON.parse(line) : undefined;
  } finally {
    await handle.close();
  }
}

async function readEffectiveCwd(file) {
  const first = await readFirstRecord(file);
  const metadataCwd = first?.type === "session_meta" ? first.payload?.cwd : undefined;
  const fileStat = await stat(file);
  const tailSize = Math.min(fileStat.size, 16 * 1024 * 1024);
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(tailSize);
    await handle.read(buffer, 0, tailSize, fileStat.size - tailSize);
    let text = buffer.toString("utf8");
    if (fileStat.size > tailSize) text = text.slice(text.indexOf("\n") + 1);
    let latest = metadataCwd;
    for (const line of text.split("\n")) {
      if (!line.includes('"turn_context"')) continue;
      try {
        const record = JSON.parse(line);
        if (record.type === "turn_context" && typeof record.payload?.cwd === "string") latest = record.payload.cwd;
      } catch {
        // The first tail fragment is discarded; malformed full records are caught in the full scan.
      }
    }
    if (!latest) return undefined;
    try {
      return await realpath(latest);
    } catch {
      return path.resolve(latest);
    }
  } finally {
    await handle.close();
  }
}

export function sessionIdFromPath(file) {
  const match = path.basename(file).match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/iu);
  return match?.[1]?.toLowerCase();
}

export async function resolveRollout(options, cwd, state) {
  const sessionsHome = path.join(CODEX_HOME, "sessions");
  const rollouts = await walkRollouts(sessionsHome);
  if (options.sessionId) {
    const matches = rollouts.filter((file) => sessionIdFromPath(file) === options.sessionId);
    if (matches.length === 0) throw new Error(`Session ${options.sessionId} was not found under ${sessionsHome}.`);
    if (matches.length > 1) throw new Error(`Session ${options.sessionId} has ${matches.length} rollout files; refusing an ambiguous rewrite.`);
    return matches[0];
  }
  const pinnedId = state.lastSessionByCwd[cwd];
  const pinned = pinnedId ? state.sessions[pinnedId]?.rolloutPath : undefined;
  if (pinned && (await exists(pinned))) return pinned;
  const ranked = await Promise.all(rollouts.map(async (file) => ({ file, modified: (await stat(file)).mtimeMs })));
  ranked.sort((left, right) => right.modified - left.modified);
  for (const candidate of ranked) {
    if ((await readEffectiveCwd(candidate.file)) === cwd) return candidate.file;
  }
  throw new Error(`No Codex session matched the current project ${cwd}. Use --session UUID once to pin it.`);
}

function hasOwnEncryptedContent(value) {
  return Boolean(value && typeof value === "object" && typeof value.encrypted_content === "string" && value.encrypted_content.length > 0);
}

function inferProvider(item) {
  if (!hasOwnEncryptedContent(item)) return undefined;
  if (typeof item.id === "string" && (item.id.startsWith("rs_") || item.id.startsWith("cmp_"))) return "openai";
  if (item.encrypted_content.startsWith("gAAA")) return "openai";
  return "copilot";
}

function inspectResponseItem(item, analysis, location) {
  let recognized = 0;
  if (!item || typeof item !== "object") return recognized;
  if (REPLAY_TYPES.has(item.type) && hasOwnEncryptedContent(item)) {
    analysis.replayItems += 1;
    analysis.providers.add(inferProvider(item));
    analysis.locations[location] = (analysis.locations[location] || 0) + 1;
    recognized += 1;
  }
  if ((item.type === "agent_message" || item.type === "message") && Array.isArray(item.content)) {
    for (const block of item.content) {
      if (block?.type === "encrypted_content" && hasOwnEncryptedContent(block)) {
        analysis.protectedMessageBlocks += 1;
        recognized += 1;
      }
    }
  }
  return recognized;
}

function countEncryptedKeys(value) {
  if (!value || typeof value !== "object") return 0;
  let count = hasOwnEncryptedContent(value) ? 1 : 0;
  for (const [key, child] of Object.entries(value)) {
    if (key !== "encrypted_content") count += countEncryptedKeys(child);
  }
  return count;
}

export async function analyzeRollout(file) {
  const retainedDigest = createHash("sha256");
  const analysis = {
    lines: 0,
    firstRecordType: undefined,
    sessionMetaCount: 0,
    droppedPaddingLines: 0,
    sessionId: undefined,
    alternateSessionId: undefined,
    originProvider: undefined,
    effectiveCwd: undefined,
    replayItems: 0,
    protectedMessageBlocks: 0,
    unknownEncryptedLocations: 0,
    providers: new Set(),
    locations: {},
    visibleRecords: {},
  };
  for await (const line of readLfLines(createReadStream(file))) {
    analysis.lines += 1;
    if (!line.trim()) continue;
    if (isSparsePaddingLine(line)) { analysis.droppedPaddingLines += 1; continue; }
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`Malformed JSONL at ${file}:${analysis.lines}: ${error.message}`);
    }
    analysis.firstRecordType ||= record.type;
    if (record.type === "session_meta") {
      analysis.sessionMetaCount += 1;
      if (analysis.sessionMetaCount === 1) {
        analysis.sessionId = record.payload?.id;
        analysis.alternateSessionId = record.payload?.session_id;
        analysis.originProvider = record.payload?.model_provider;
        analysis.effectiveCwd = record.payload?.cwd;
      }
    }
    if (record.type === "turn_context" && typeof record.payload?.cwd === "string") analysis.effectiveCwd = record.payload.cwd;
    let recognized = 0;
    if (record.type === "response_item") {
      const type = record.payload?.type || "unknown";
      if (!REPLAY_TYPES.has(type)) analysis.visibleRecords[type] = (analysis.visibleRecords[type] || 0) + 1;
      recognized += inspectResponseItem(record.payload, analysis, "response_item.payload");
    } else if (record.type === "compacted" && Array.isArray(record.payload?.replacement_history)) {
      for (const item of record.payload.replacement_history) recognized += inspectResponseItem(item, analysis, "compacted.replacement_history");
    }
    analysis.unknownEncryptedLocations += Math.max(0, countEncryptedKeys(record) - recognized);
    const retained = sanitizeRecord(record, { droppedRecords: 0, droppedReplayItems: 0 });
    if (retained) retainedDigest.update(`${retained === record ? line : JSON.stringify(retained)}\n`);
  }
  analysis.providers.delete(undefined);
  analysis.retainedHash = retainedDigest.digest("hex");
  return analysis;
}

function sanitizeResponseItem(item, stats) {
  if (!item || typeof item !== "object") return item;
  if (REPLAY_TYPES.has(item.type) && hasOwnEncryptedContent(item)) {
    stats.droppedReplayItems += 1;
    return undefined;
  }
  return item;
}

function sanitizeRecord(record, stats) {
  if (record.type === "response_item") {
    const payload = sanitizeResponseItem(record.payload, stats);
    if (!payload) {
      stats.droppedRecords += 1;
      return undefined;
    }
    if (payload !== record.payload) return { ...record, payload };
  }
  if (record.type === "compacted" && Array.isArray(record.payload?.replacement_history)) {
    const replacementHistory = [];
    for (const item of record.payload.replacement_history) {
      const sanitized = sanitizeResponseItem(item, stats);
      if (sanitized) replacementHistory.push(sanitized);
    }
    if (replacementHistory.length !== record.payload.replacement_history.length) {
      return { ...record, payload: { ...record.payload, replacement_history: replacementHistory } };
    }
  }
  return record;
}

async function writeLine(output, line) {
  if (!output.write(`${line}\n`)) await once(output, "drain");
}

async function backupOriginal(file, sessionId, expectedHash) {
  const directory = path.join(BACKUP_HOME, sessionId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backup = path.join(directory, `${path.basename(file)}.${timestamp}-${process.pid}.bak`);
  await copyFile(file, backup, fsConstants.COPYFILE_EXCL);
  await chmod(backup, 0o600);
  await syncPath(backup);
  await syncPath(directory, true);
  const backupHash = await hashFile(backup);
  if (backupHash !== expectedHash) throw new Error("Backup verification failed: SHA-256 differs from the original rollout.");
  return { path: backup, sha256: backupHash };
}

async function syncPath(target, directory = false) {
  const handle = await open(target, "r");
  try {
    await handle.sync().catch((error) => {
      if (!(directory && ["EINVAL", "ENOTSUP", "EBADF"].includes(error?.code))) throw error;
    });
  } finally {
    await handle.close();
  }
}

async function requireRewriteSpace(file, bytes) {
  const space = await statfs(path.dirname(file));
  const available = BigInt(space.bavail) * BigInt(space.bsize);
  const required = BigInt(bytes) * 2n;
  if (available < required) throw new Error(`Insufficient free space: provider switching requires ${required} bytes, but ${available} are available.`);
}

export async function restoreBackup(backup, file, mode) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.codex-switch-restore-${process.pid}.tmp`);
  await copyFile(backup, temporary, fsConstants.COPYFILE_EXCL);
  await chmod(temporary, mode & 0o777);
  await syncPath(temporary);
  await rename(temporary, file);
  await syncPath(file);
  await syncPath(path.dirname(file), true);
}

export async function sanitizeRollout(file, before, dryRun) {
  const stats = { droppedRecords: 0, droppedReplayItems: 0, droppedPaddingLines: 0 };
  if (dryRun) {
    return { ...stats, wouldRemove: before.replayItems, backup: undefined };
  }
  const sourceStat = await stat(file);
  await requireRewriteSpace(file, sourceStat.size);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.codex-switch-${process.pid}.tmp`);
  const output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
  const sourceHash = createHash("sha256");
  let backup;
  let replaced = false;
  let lineNumber = 0;
  try {
    const source = createReadStream(file);
    for await (const line of readLfLines(source, (chunk) => sourceHash.update(chunk))) {
      lineNumber += 1;
      if (!line.trim()) {
        await writeLine(output, line);
        continue;
      }
      if (isSparsePaddingLine(line)) { stats.droppedPaddingLines += 1; continue; }
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        throw new Error(`Malformed JSONL at ${file}:${lineNumber}: ${error.message}`);
      }
      const sanitized = sanitizeRecord(record, stats);
      if (!sanitized) continue;
      await writeLine(output, sanitized === record ? line : JSON.stringify(sanitized));
    }
    output.end();
    await once(output, "close");
    await syncPath(temporary);
    const originalHash = sourceHash.digest("hex");
    backup = await backupOriginal(file, before.sessionId, originalHash);
    const backupStat = await stat(backup.path);
    if (backupStat.size !== sourceStat.size) throw new Error("Backup verification failed: size differs from the original rollout.");
    await rename(temporary, file);
    replaced = true;
    await chmod(file, sourceStat.mode & 0o777);
    await syncPath(file);
    await syncPath(path.dirname(file), true);
    return { ...stats, backup: backup.path, originalHash, sourceMode: sourceStat.mode };
  } catch (error) {
    output.destroy();
    if (replaced && backup) {
      await restoreBackup(backup.path, file, sourceStat.mode).catch((restoreError) => {
        throw new Error(`${error.message}; automatic restore failed: ${restoreError.message}; exact backup: ${backup.path}`);
      });
    }
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") console.error(`Warning: could not remove ${temporary}: ${cleanupError.message}`);
    }
    throw error;
  }
}

export function sameVisibleRecords(left, right) {
  return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
}
