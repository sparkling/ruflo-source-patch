// Metadata-only native Codex control connection; never starts a thread or turn.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { connectNativeStdio, metadataRequestAllowed } from './native-stdio.mjs';
const MAX = 8 * 1024 * 1024;
export async function connectNativeMetadata(options = {}) {
  try { fs.statSync(options.socketPath); }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw Error('Native control socket unavailable');
    return connectNativeStdio(options);
  }
  return connectNativeSocket(options);
}
export async function connectNativeSocket({ socketPath, timeoutMs = 10000 } = {}) {
  if (!path.isAbsolute(socketPath || '') || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 1 || timeoutMs > 20000) throw Error('Native metadata options invalid');
  const stat = fs.statSync(socketPath);
  if (!stat.isSocket() || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o077))
    throw Error('Native control socket ownership invalid');
  const deadline = Date.now() + timeoutMs, socket = net.createConnection(socketPath);
  const key = crypto.randomBytes(16).toString('base64');
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  let buffer = Buffer.alloc(0), upgraded = false, nextId = 1, fragments = [], fragmentBytes = 0, closed = false;
  const pending = new Map(); let connectedResolve, connectedReject;
  const connected = new Promise((resolve, reject) => { connectedResolve = resolve; connectedReject = reject; });
  const rejectAll = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  const close = () => { if (closed) return; closed = true; clearTimeout(timer); rejectAll(Error('Native metadata connection closed')); socket.destroy(); };
  const fail = () => { connectedReject(Error('Native metadata transport failed')); close(); };
  const timer = setTimeout(fail, timeoutMs);
  function send(payload, opcode = 1) {
    const bytes = Buffer.from(payload);
    if (closed || bytes.length > MAX) throw Error('Native metadata send refused');
    const width = bytes.length < 126 ? 2 : bytes.length <= 65535 ? 4 : 10;
    const frame = Buffer.alloc(width + 4 + bytes.length), mask = crypto.randomBytes(4);
    frame[0] = 0x80 | opcode;
    if (width === 2) frame[1] = 0x80 | bytes.length;
    else if (width === 4) { frame[1] = 0x80 | 126; frame.writeUInt16BE(bytes.length, 2); }
    else { frame[1] = 0x80 | 127; frame.writeBigUInt64BE(BigInt(bytes.length), 2); }
    mask.copy(frame, width);
    for (let i = 0; i < bytes.length; i++) frame[width + 4 + i] = bytes[i] ^ mask[i % 4];
    socket.write(frame);
  }
  function message(payload) {
    let response;
    try { response = JSON.parse(payload.toString('utf8')); } catch { fail(); return; }
    const item = pending.get(response.id);
    if (!item) return; // Host notifications have no effect on this metadata transaction.
    pending.delete(response.id); clearTimeout(item.timer);
    if (response.error) item.reject(Error(`Native ${item.method} rejected`));
    else if (!Object.hasOwn(response, 'result')) item.reject(Error('Native metadata response invalid'));
    else item.resolve(response.result);
  }
  function frames() {
    while (buffer.length >= 2) {
      const first = buffer[0], second = buffer[1], opcode = first & 15, final = Boolean(first & 0x80);
      if ((first & 0x70) || (second & 0x80)) throw Error('Native frame invalid');
      let offset = 2, length = second & 127;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) {
        if (buffer.length < 10) return;
        const wide = buffer.readBigUInt64BE(2); if (wide > BigInt(MAX)) throw Error('Native frame too large');
        length = Number(wide); offset = 10;
      }
      if (length > MAX || (opcode >= 8 && (!final || length > 125))) throw Error('Native frame exceeds bound');
      if (buffer.length < offset + length) return;
      const payload = buffer.subarray(offset, offset + length); buffer = buffer.subarray(offset + length);
      if (opcode === 8) { fail(); return; }
      if (opcode === 9) { send(payload, 10); continue; }
      if (opcode === 10) continue;
      if (![0, 1].includes(opcode) || (opcode === 0 ? !fragments.length : fragments.length)) throw Error('Native frame sequence invalid');
      fragments.push(payload); fragmentBytes += payload.length;
      if (fragmentBytes > MAX) throw Error('Native message exceeds bound');
      if (final) { message(Buffer.concat(fragments)); fragments = []; fragmentBytes = 0; }
    }
  }
  socket.on('error', fail); socket.on('close', fail);
  socket.on('connect', () => socket.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
  socket.on('data', chunk => {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX + 16384) throw Error('Native input exceeds bound');
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) { if (buffer.length > 16384) throw Error('Native handshake exceeds bound'); return; }
        const header = buffer.subarray(0, end).toString('ascii'), lines = header.split('\r\n');
        const headers = new Map(lines.slice(1).map(line => { const i = line.indexOf(':'); return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()]; }));
        if (!/^HTTP\/1\.[01] 101(?: |$)/.test(lines[0]) || headers.get('sec-websocket-accept') !== accept
          || headers.get('upgrade')?.toLowerCase() !== 'websocket') throw Error('Native handshake invalid');
        buffer = buffer.subarray(end + 4); upgraded = true; connectedResolve();
      }
      frames();
    } catch { fail(); }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    if (!metadataRequestAllowed(method, params)) { reject(Error('Native metadata method refused')); return; }
    const remaining = deadline - Date.now();
    if (closed || remaining <= 0) { reject(Error('Native metadata deadline exceeded')); return; }
    const id = nextId++, requestTimer = setTimeout(() => { pending.delete(id); reject(Error(`Native ${method} timed out`)); }, remaining);
    pending.set(id, { resolve, reject, timer: requestTimer, method });
    try { send(JSON.stringify({ id, method, params })); } catch { clearTimeout(requestTimer); pending.delete(id); reject(Error('Native metadata send failed')); }
  });
  try {
    await connected;
    await rpc('initialize', { clientInfo: { name: 'ruflo-source-patch-hook-trust', version: '1' }, capabilities: { experimentalApi: true } });
    send(JSON.stringify({ method: 'initialized' }));
    return { rpc, close, transport: 'existing-control-socket' };
  } catch (error) { close(); throw error; }
}
