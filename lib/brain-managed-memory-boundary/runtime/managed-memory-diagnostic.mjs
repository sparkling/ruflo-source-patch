import { spawn } from 'node:child_process';
import path from 'node:path';
// ruflo-source-patch (stuinfla/ruvnet-brain#102/#103)
import {
  PATCH_MARKER, databaseSnapshot, managedStore, pathHash, sameSnapshot, sqlLiteral,
  writeAuditReceipt,
} from '../scripts/managed-memory-policy.mjs';

void PATCH_MARKER;
export const MANAGED_MEMORY_DIAGNOSTIC_TOOL = Object.freeze({
  name: 'agentdb_diagnostic_read',
  description: 'Audited read-only confirmation that one exact namespace/key exists in a managed AgentDB store. Returns no memory content and accepts no SQL.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', description: 'Canonical absolute path to a managed AgentDB memory.db.' },
      namespace: { type: 'string', maxLength: 1024 },
      key: { type: 'string', maxLength: 1024 },
      reason: { type: 'string', minLength: 8, maxLength: 1000 },
    },
    required: ['path', 'namespace', 'key', 'reason'],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
});

function runSqlite(database, sql, env) {
  return new Promise((resolve) => {
    const child = spawn('sqlite3', ['-batch', '-readonly', '-json', database], {
      env, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = []; const stderr = []; let bytes = 0; let settled = false; let timer;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const keep = (list, chunk) => {
      const remaining = 65536 - bytes;
      if (remaining > 0) list.push(chunk.subarray(0, remaining));
      bytes += Math.min(chunk.length, Math.max(remaining, 0));
    };
    child.stdout.on('data', (chunk) => keep(stdout, chunk));
    child.stderr.on('data', (chunk) => keep(stderr, chunk));
    child.once('error', (error) => finish({ error: error.message }));
    child.once('close', (code) => finish({
      code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(),
    }));
    timer = setTimeout(() => { child.kill('SIGTERM'); finish({ error: 'sqlite3 diagnostic timed out' }); }, 5000);
    child.stdin.end(`${sql}\n`);
  });
}

const failure = (text) => ({ content: [{ type: 'text', text }], isError: true });

export async function callManagedMemoryDiagnostic(args, env = process.env) {
  try {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return failure('arguments must be an object');
    }
    const extras = Object.keys(args).filter((key) => !['path', 'namespace', 'key', 'reason'].includes(key));
    if (extras.length) return failure(`unsupported diagnostic argument(s): ${extras.join(', ')}`);
    if (typeof args?.path !== 'string' || !path.isAbsolute(args.path)) {
      return failure('path must be a canonical absolute managed-store path');
    }
    if (typeof args.reason !== 'string' || args.reason.trim().length < 8 || args.reason.length > 1000) {
      return failure('reason must explain the diagnostic need in 8–1000 characters');
    }
    const cwd = env.RUVNET_BRAIN_PROJECT_DIR || process.cwd();
    const store = managedStore(args.path, { cwd, env });
    if (!store || store.path !== args.path) return failure('path is not a canonical managed AgentDB store');

    const namespace = sqlLiteral(args.namespace, 'namespace');
    const key = sqlLiteral(args.key, 'key');
    const reasonHash = pathHash(`reason:${args.reason.trim()}`);
    writeAuditReceipt({
      event: 'diagnostic-read-start', store: store.kind, pathHash: pathHash(store.path),
      reasonHash, operation: 'exact-namespace-key-count',
    }, env);
    const before = databaseSnapshot(store.path);
    const result = await runSqlite(
      store.path,
      `SELECT COUNT(*) AS matched_rows FROM memory_entries WHERE namespace=${namespace} AND key=${key};`,
      env,
    );
    const after = databaseSnapshot(store.path);
    if (result.error || result.code !== 0) {
      return failure(result.error || result.stderr || `sqlite3 diagnostic exited ${result.code}`);
    }
    if (!sameSnapshot(before, after)) return failure('read-only diagnostic changed the database or a sidecar');
    let rows;
    try { rows = JSON.parse(result.stdout || '[]'); } catch { return failure('sqlite3 returned invalid JSON'); }
    const matchedRows = Number(rows?.[0]?.matched_rows);
    if (!Number.isSafeInteger(matchedRows) || matchedRows < 0) {
      return failure('diagnostic returned an impossible row count');
    }
    writeAuditReceipt({
      event: 'diagnostic-read', store: store.kind, pathHash: pathHash(store.path),
      reasonHash, operation: 'exact-namespace-key-count',
      rowCount: matchedRows,
    }, env);
    return {
      content: [{ type: 'text', text: `Audited read-only diagnostic completed: matched rows = ${matchedRows}; no memory content was returned.` }],
      isError: false,
    };
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}
