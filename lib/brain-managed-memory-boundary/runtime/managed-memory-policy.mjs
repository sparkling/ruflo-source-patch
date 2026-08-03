import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#102/#103)';

const NO_VALUE_FLAGS = new Set([
  '-append', '-ascii', '-bail', '-batch', '-box', '-column', '-csv', '-deserialize', '-echo',
  '-header', '-help', '-html', '-interactive',
  '-json', '-line', '-list', '-markdown', '-noheader', '-nofollow', '-nointeractive', '-quote',
  '-readonly', '-safe', '-stats', '-table', '-tabs', '-version', '-zip',
]);
const ONE_VALUE_FLAGS = new Set([
  '-cmd', '-escape', '-hexkey', '-init', '-key', '-maxsize', '-newline', '-nonce', '-nullvalue',
  '-separator', '-textkey', '-vfs',
]);
const TWO_VALUE_FLAGS = new Set(['-lookaside', '-pagecache']);

function optionName(value) {
  const equals = value.indexOf('=');
  return equals > 0 ? value.slice(0, equals) : value;
}

/** Return SQLite's database operand without mistaking an option value for the path. */
export function sqliteDatabaseArgument(args) {
  if (!Array.isArray(args)) return { state: 'unknown', reason: 'argv is not an array' };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (typeof value !== 'string' || value === '') {
      return { state: 'unknown', reason: 'dynamic or missing argument' };
    }
    if (value === '--') {
      const database = args[index + 1];
      return typeof database === 'string' && database
        ? { state: 'known', database }
        : { state: 'unknown', reason: 'missing database after --' };
    }
    if (value === '-' || !value.startsWith('-')) return { state: 'known', database: value };

    const flag = optionName(value);
    if (NO_VALUE_FLAGS.has(flag) || value.includes('=')) continue;
    const arity = ONE_VALUE_FLAGS.has(flag) ? 1 : TWO_VALUE_FLAGS.has(flag) ? 2 : null;
    if (arity === null) return { state: 'unknown', reason: `unknown sqlite3 option ${flag}` };
    if (index + arity >= args.length) return { state: 'unknown', reason: `missing value for ${flag}` };
    index += arity;
  }
  return { state: 'unknown', reason: 'no database operand' };
}

function homeOf(env) {
  return env.HOME || env.USERPROFILE || os.homedir();
}

function absoluteCandidate(value, cwd, env) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.length > 4096) return null;
  let database = value;
  if (database.startsWith('file:')) {
    try {
      const uri = new URL(database);
      if (uri.protocol !== 'file:' || (uri.hostname && uri.hostname !== 'localhost')) return null;
      database = decodeURIComponent(uri.pathname);
    } catch { return null; }
  }
  const expanded = database === '~' ? homeOf(env)
    : database.startsWith('~/') ? path.join(homeOf(env), database.slice(2))
      : database;
  return path.resolve(cwd, expanded);
}

function canonicalCandidate(value, cwd, env) {
  const absolute = absoluteCandidate(value, cwd, env);
  if (!absolute) return null;
  try { return fs.realpathSync(absolute); } catch { /* a raw sqlite3 command can target a not-yet-created DB */ }
  try {
    return path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
  } catch {
    return absolute;
  }
}

function samePath(left, right) {
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

/** Identify only the configured user store or an ancestor project's exact .swarm/memory.db. */
export function managedStore(value, { cwd = process.cwd(), env = process.env } = {}) {
  const safeCwd = typeof cwd === 'string' && cwd && cwd.length < 4096 ? path.resolve(cwd) : process.cwd();
  const lexical = absoluteCandidate(value, safeCwd, env);
  const candidate = canonicalCandidate(value, safeCwd, env);
  if (!candidate || !lexical) return null;

  const userStore = canonicalCandidate(path.join(homeOf(env), '.claude-flow', 'user-memory.db'), safeCwd, env);
  if (userStore && samePath(candidate, userStore)) {
    return { kind: 'user-memory', path: candidate };
  }

  // `.swarm/memory.db` is Ruflo's managed project-store identity wherever the project lives.
  // Check both the typed path and its canonical target: the former catches a not-yet-created store,
  // while the latter catches a symlinked project root without trusting the symlink's spelling.
  for (const database of [lexical, candidate]) {
    if (path.basename(database) === 'memory.db'
        && path.basename(path.dirname(database)) === '.swarm') {
      return {
        kind: 'project-memory',
        path: candidate,
        projectRoot: path.dirname(path.dirname(database)),
      };
    }
  }
  return null;
}

function privateOwnedDirectory(dir) {
  const stat = fs.lstatSync(dir);
  return stat.isDirectory() && !stat.isSymbolicLink()
    && (process.platform === 'win32' || (stat.mode & 0o077) === 0)
    && (typeof process.getuid !== 'function' || stat.uid === process.getuid());
}

export function pathHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Append a bounded, content-free receipt before a refusal or diagnostic result is reported. */
export function writeAuditReceipt(record, env = process.env) {
  const brainHome = env.RUVNET_BRAIN_HOME || path.join(homeOf(env), '.cache', 'ruvnet-brain');
  const dir = path.join(brainHome, 'audit');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!privateOwnedDirectory(dir)) throw new Error('Brain audit directory is not private and owned');
  const file = path.join(dir, 'managed-memory-boundary.jsonl');
  const flags = fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY
    | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags, 0o600);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()
        || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      throw new Error('Brain audit receipt is not a private owned regular file');
    }
    const value = {
      schema: 1,
      at: new Date().toISOString(),
      pid: process.pid,
      session: String(env.CLAUDE_SESSION_ID || env.CODEX_THREAD_ID || '').slice(0, 128),
      ...record,
    };
    fs.writeSync(fd, `${JSON.stringify(value)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return file;
}

export function databaseSnapshot(database) {
  return [database, `${database}-wal`, `${database}-shm`].map((file) => {
    try {
      const stat = fs.statSync(file);
      return {
        file: path.basename(file), size: stat.size, mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs, dev: stat.dev, ino: stat.ino,
      };
    } catch { return { file: path.basename(file), absent: true }; }
  });
}

export function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function sqlLiteral(value, field) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\0')) {
    throw new Error(`${field} must be a non-empty string of at most 1024 characters without NUL`);
  }
  return `'${value.replaceAll("'", "''")}'`;
}
