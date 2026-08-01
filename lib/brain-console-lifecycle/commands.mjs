// Command boundary for the ownership-proven Brain Console lifecycle patch (#79).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { runPluginCommand } from '../plugin-command.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const brainHome = () => process.env.RUVNET_BRAIN_HOME
  || path.join(os.homedir(), '.cache', 'ruvnet-brain');

function trustedDirectory(dir) {
  const stat = fs.lstatSync(dir);
  return stat.isDirectory() && !stat.isSymbolicLink()
    && (process.platform === 'win32' || (stat.mode & 0o077) === 0)
    && (typeof process.getuid !== 'function' || stat.uid === process.getuid());
}

async function acquireLifecycleLock() {
  const control = path.join(brainHome(), 'console-control');
  const lock = path.join(control, 'lifecycle.lock');
  const ownerFile = path.join(lock, 'owner.json');
  const owner = { pid: process.pid, nonce: crypto.randomBytes(16).toString('hex') };
  fs.mkdirSync(control, { recursive: true, mode: 0o700 });
  if (!trustedDirectory(control)) throw new Error('Console control directory is not private and owned');
  for (let attempt = 0; attempt < 80; attempt++) {
    let created = false;
    try {
      fs.mkdirSync(lock, { mode: 0o700 }); created = true;
      fs.writeFileSync(ownerFile, JSON.stringify(owner) + '\n', { mode: 0o600, flag: 'wx' });
      return () => {
        try {
          const current = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
          if (current.nonce === owner.nonce) fs.rmSync(lock, { recursive: true, force: true });
        } catch { /* another owner is never removed */ }
      };
    } catch (error) {
      if (created) {
        try { fs.rmSync(lock, { recursive: true, force: true }); } catch {}
        throw new Error(`cannot record Console lifecycle lock owner: ${error.message}`);
      }
      if (error.code !== 'EEXIST') throw error;
      try {
        if (!trustedDirectory(lock)) throw new Error('untrusted lifecycle lock');
        const current = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
        let alive = true; try { process.kill(current.pid, 0); } catch { alive = false; }
        if (!alive && Date.now() - fs.statSync(lock).mtimeMs > 10000) {
          fs.rmSync(lock, { recursive: true, force: true }); continue;
        }
      } catch {
        try {
          const stat = fs.lstatSync(lock);
          if (trustedDirectory(lock) && Date.now() - stat.mtimeMs > 10000) {
            fs.rmSync(lock, { recursive: true, force: true }); continue;
          }
        } catch {}
      }
      await wait(50);
    }
  }
  throw new Error('another Console lifecycle operation did not finish within four seconds');
}

function readReceipts() {
  const dir = path.join(brainHome(), 'console-control', 'instances');
  try {
    if (!trustedDirectory(dir)) throw new Error('receipt directory is not private and owned');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return fs.readdirSync(dir).filter((name) => /^[0-9a-f]{64}\.json$/i.test(name)).map((name) => {
    const file = path.join(dir, name); const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384
      || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      throw new Error(`untrusted Console receipt: ${name}`);
    }
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const scope = typeof value.cwd === 'string' && path.isAbsolute(value.cwd)
      ? crypto.createHash('sha256').update(value.cwd).digest('hex') : null;
    if (value.product !== 'ruvnet-brain-console' || value.schema !== 1 || value.apiContract !== 1
      || !Number.isInteger(value.patchRevision) || !/^[0-9a-f]{64}$/i.test(String(value.vendorSha256 || ''))
      || !Number.isInteger(value.pid) || value.pid <= 1
      || value.scopeKey !== scope || name !== `${scope}.json`
      || !/^[0-9a-f-]{36}$/i.test(String(value.instanceId || ''))
      || !/^[A-Za-z0-9_-]{43}$/.test(String(value.controlToken || ''))
      || !Number.isInteger(value.port) || value.port <= 0 || value.port >= 65536) {
      throw new Error(`invalid Console receipt: ${name}`);
    }
    return { ...value, file };
  });
}

function request(receipt, route, body = null) {
  return new Promise((resolve) => {
    const payload = body === null ? null : JSON.stringify(body); let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const req = http.request({ host: '127.0.0.1', port: receipt.port, path: route,
      method: payload ? 'POST' : 'GET', timeout: 800,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, (res) => {
      let text = ''; res.on('data', (chunk) => { if (text.length < 8192) text += chunk; });
      res.on('end', () => { try { finish({ status: res.statusCode, json: JSON.parse(text) }); } catch { finish(null); } });
    });
    req.on('error', () => finish(null)); req.on('timeout', () => { req.destroy(); finish(null); });
    if (payload) req.write(payload); req.end();
  });
}

const sameInstance = (receipt, response) => response?.status === 200
  && response.json?.product === receipt.product && response.json?.instanceId === receipt.instanceId
  && response.json?.pid === receipt.pid && response.json?.port === receipt.port
  && response.json?.scopeKey === receipt.scopeKey;

async function stopOwnedInstances() {
  for (const receipt of readReceipts()) {
    const live = await request(receipt, '/api/runtime');
    if (!sameInstance(receipt, live)) throw new Error(`cannot prove ownership of Console on port ${receipt.port}`);
    const stopped = await request(receipt, '/api/runtime/shutdown', {
      instanceId: receipt.instanceId, controlToken: receipt.controlToken,
    });
    if (stopped?.status !== 202) throw new Error(`Console on port ${receipt.port} refused authenticated shutdown`);
    let stillLive = true;
    for (let attempt = 0; attempt < 50; attempt++) {
      await wait(50);
      if (!sameInstance(receipt, await request(receipt, '/api/runtime'))) { stillLive = false; break; }
    }
    if (stillLive) throw new Error(`Console on port ${receipt.port} did not stop`);
  }
  if (readReceipts().length) throw new Error('Console receipts remain after authenticated shutdown');
}

export async function brainConsoleLifecycleCommand(action) {
  if (action !== 'uninstall' && action !== 'remove') {
    return runPluginCommand('brain-console-lifecycle', action);
  }
  let release;
  try {
    release = await acquireLifecycleLock();
    await stopOwnedInstances();
    return runPluginCommand('brain-console-lifecycle', action);
  } catch (error) {
    console.error(`[brain-console-lifecycle] INCOMPLETE — ${error.message}; target remains installed`);
    process.exitCode = 1;
    return true;
  } finally { release?.(); }
}
