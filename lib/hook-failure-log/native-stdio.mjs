// Supported Codex metadata API fallback when no live native control socket exists.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { __rspResolveHostExecutable, __rspWindowsHostInvocation } from '../plugin-hosts/discovery-fragment.mjs';
export const METADATA_METHODS = new Set(['initialize', 'hooks/list', 'config/read', 'config/batchWrite']);
const MAX = 8 * 1024 * 1024;
export function metadataRequestAllowed(method, params) {
  if (!METADATA_METHODS.has(method)) return false;
  if (method !== 'config/batchWrite') return true;
  return params?.reloadUserConfig === true && path.isAbsolute(params.filePath || '')
    && typeof params.expectedVersion === 'string' && params.expectedVersion.length > 0
    && Array.isArray(params.edits) && params.edits.length > 0 && params.edits.length <= 512
    && params.edits.every(edit => edit.mergeStrategy === 'replace'
      && /^sha256:[a-f0-9]{64}$/.test(edit.value || '')
      && /^hooks\.state\."(?:ruflo-[a-z0-9-]+@ruflo|ruvnet-brain@ruvnet-brain):hooks\/(?:codex-hooks|hooks)\.json:[a-z_]+:\d+:\d+"\.trusted_hash$/.test(edit.keyPath || ''));
}
export async function connectNativeStdio({ nativeBinary, codexHome, cwd, timeoutMs = 10000 } = {}) {
  if (!path.isAbsolute(codexHome || '') || !path.isAbsolute(cwd || '')
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000) throw Error('Native metadata options invalid');
  const resolved = nativeBinary || await __rspResolveHostExecutable('codex');
  if (!path.isAbsolute(resolved)) throw Error('Native metadata executable invalid');
  fs.accessSync(resolved, fs.constants.X_OK);
  if (!fs.statSync(resolved).isFile()) throw Error('Native metadata executable invalid');
  const invocation = __rspWindowsHostInvocation('codex', fs.realpathSync(resolved),
    ['app-server', '--listen', 'stdio://'], fs, path, process.execPath);
  const child = spawn(invocation.executable, invocation.argv, { cwd,
    env: { ...process.env, CODEX_HOME: codexHome }, stdio: ['pipe', 'pipe', 'ignore'] });
  let nextId = 1, buffer = Buffer.alloc(0), closed = false, closing;
  const pending = new Map(), deadline = Date.now() + timeoutMs;
  const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  const rejectAll = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Native metadata stdio unavailable')); } pending.clear(); };
  const waitExit = async () => {
    let timer;
    try { await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 350); })]); }
    finally { clearTimeout(timer); }
  };
  const close = () => {
    if (closing) return closing;
    closed = true; clearTimeout(timer); rejectAll();
    closing = (async () => {
      child.stdin.end(); await waitExit();
      if (child.pid && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await waitExit(); }
      if (child.pid && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await waitExit(); }
      if (child.pid && child.exitCode === null && child.signalCode === null) throw Error('Owned native metadata process exit unverified');
    })();
    return closing;
  };
  const fail = () => { rejectAll(); void close().catch(() => {}); };
  const timer = setTimeout(fail, timeoutMs);
  child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail);
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX) { fail(); return; }
    let end;
    while ((end = buffer.indexOf(10)) !== -1) {
      const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
      let response;
      try { response = JSON.parse(line.toString('utf8')); } catch { fail(); return; }
      const p = pending.get(response.id);
      if (!p) continue;
      pending.delete(response.id); clearTimeout(p.timer);
      if (response.error) p.reject(Error(`Native ${p.method} rejected`));
      else if (!Object.hasOwn(response, 'result')) p.reject(Error('Native metadata response invalid'));
      else p.resolve(response.result);
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    if (!metadataRequestAllowed(method, params)) { reject(Error('Native metadata method refused')); return; }
    const remaining = deadline - Date.now();
    if (closed || remaining <= 0) { reject(Error('Native metadata deadline exceeded')); return; }
    const id = nextId++, requestTimer = setTimeout(() => { pending.delete(id); reject(Error(`Native ${method} timed out`)); }, remaining);
    pending.set(id, { resolve, reject, timer: requestTimer, method });
    const request = JSON.stringify({ id, method, params }) + '\n';
    if (Buffer.byteLength(request) > MAX) { pending.delete(id); clearTimeout(requestTimer); reject(Error('Native metadata request exceeds bound')); return; }
    child.stdin.write(request, error => { if (error) fail(); });
  });
  try {
    await rpc('initialize', { clientInfo: { name: 'ruflo-source-patch-hook-trust', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    return { rpc, close, transport: 'fresh-metadata-stdio' };
  } catch (error) { await close(); throw error; }
}
