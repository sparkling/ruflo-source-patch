import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { HOME_BASE } from '../lib/cwd/paths.mjs';
import { connectNativeMetadata } from '../lib/hook-failure-log/native-client.mjs';
assert.match(path.basename(HOME_BASE), /^rsp-hook-log-test-/);
const sockets = new Set(); let sequence = 0;
function frame(bytes, opcode = 1, final = true) {
  bytes = Buffer.from(bytes);
  const prefix = Buffer.alloc(bytes.length < 126 ? 2 : 4);
  prefix[0] = opcode | (final ? 128 : 0);
  prefix[1] = bytes.length < 126 ? bytes.length : 126;
  if (prefix.length === 4) prefix.writeUInt16BE(bytes.length, 2);
  return Buffer.concat([prefix, bytes]);
}
async function server(mode = '') {
  const socketPath = path.join(HOME_BASE, 'native-fixture-' + sequence++ + '.sock');
  const requests = [], srv = http.createServer();
  srv.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  srv.on('upgrade', (request, socket) => {
    const hash = crypto.createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${mode === 'bad-handshake' ? 'wrong' : hash}\r\n\r\n`);
    if (mode === 'bad-handshake' || mode === 'stall') return;
    if (mode === 'oversize') {
      const header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(8 * 1024 * 1024 + 1), 2);
      socket.write(header); return;
    }
    let input = Buffer.alloc(0);
    socket.on('data', chunk => {
      input = Buffer.concat([input, chunk]);
      while (input.length >= 2) {
        const opcode = input[0] & 15; let length = input[1] & 127, width = 2;
        assert.ok(input[1] & 128, 'client frames must be masked');
        if (length === 126) { if (input.length < 4) return; length = input.readUInt16BE(2); width = 4; }
        else if (length === 127) { if (input.length < 10) return; length = Number(input.readBigUInt64BE(2)); width = 10; }
        if (input.length < width + 4 + length) return;
        const mask = input.subarray(width, width + 4), data = Buffer.from(input.subarray(width + 4, width + 4 + length));
        input = input.subarray(width + 4 + length);
        for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
        if (opcode === 10) { assert.equal(data.toString(), 'ping'); continue; }
        assert.equal(opcode, 1);
        const message = JSON.parse(data); requests.push(message);
        if (!('id' in message)) continue;
        const result = message.method === 'initialize' ? {} : { value: 'PRIVATE_CONFIG_RESPONSE', padding: 'x'.repeat(1000) };
        const reply = mode === 'error' && message.method !== 'initialize'
          ? { id: message.id, error: { code: -32602, message: 'CREDENTIAL_NATIVE_ERROR' } } : { id: message.id, result };
        socket.write(frame(JSON.stringify({ method: 'thread/unrelated', params: {} })));
        socket.write(frame('ping', 9));
        const bytes = JSON.stringify(reply);
        socket.write(frame(bytes.slice(0, 27), 1, false)); socket.write(frame(bytes.slice(27), 0));
      }
    });
  });
  await new Promise(resolve => srv.listen(socketPath, resolve)); fs.chmodSync(socketPath, 0o600);
  return { socketPath, requests, close: () => new Promise(resolve => { for (const s of sockets) s.destroy(); srv.close(resolve); }) };
}
let srv = await server(), client;
try {
  client = await connectNativeMetadata({ socketPath: srv.socketPath, timeoutMs: 1000 });
  const result = await client.rpc('config/read', { includeLayers: true, cwd: HOME_BASE });
  assert.equal(result.value, 'PRIVATE_CONFIG_RESPONSE');
  await assert.rejects(client.rpc('thread/start', {}), /method refused/);
  assert.deepEqual(srv.requests.filter(r => r.id).map(r => r.method), ['initialize', 'config/read']);
} finally { client?.close(); await srv.close(); }
for (const mode of ['bad-handshake', 'oversize', 'stall', 'error']) {
  srv = await server(mode); client = null;
  try {
    await assert.rejects(async () => {
      client = await connectNativeMetadata({ socketPath: srv.socketPath, timeoutMs: mode === 'stall' ? 60 : 1000 });
      await client.rpc('config/read', {});
    }, error => { assert.equal(error.message.includes('CREDENTIAL_NATIVE_ERROR'), false); return true; });
  } finally { client?.close(); await srv.close(); }
}
srv = await server(); fs.chmodSync(srv.socketPath, 0o666);
try { await assert.rejects(connectNativeMetadata({ socketPath: srv.socketPath }), /ownership invalid/); }
finally { await srv.close(); }
await assert.rejects(connectNativeMetadata({ socketPath: 'relative.sock' }), /options invalid/);
console.log('native metadata socket: masked requests, fragmented replies, notifications/ping, ownership, method bounds, deadlines and private errors passed');
