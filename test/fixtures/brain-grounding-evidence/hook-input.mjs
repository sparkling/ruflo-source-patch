// Verbatim readStdinBounded export from Brain 4.3.28 scripts/hook-input.mjs.
// Unrelated parser/CLI exports omitted; this is the only export used by these fixtures.
export function readStdinBounded({ maxBytes = 65536, idleMs = 50, emptyMs = 250 } = {}) {
  if (process.stdin.isTTY) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    let idleTimer;
    let emptyTimer;

    const cleanup = () => {
      clearTimeout(idleTimer);
      clearTimeout(emptyTimer);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      process.stdin.pause();
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, bytes));
    };
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, idleMs);
    };
    const onData = (chunk) => {
      clearTimeout(emptyTimer);
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxBytes - bytes;
      if (remaining > 0) {
        const kept = buf.subarray(0, remaining);
        chunks.push(kept);
        bytes += kept.length;
      }
      if (bytes >= maxBytes) finish();
      else armIdle();
    };
    const onEnd = () => finish();
    const onError = () => finish();

    process.stdin.on('data', onData);
    process.stdin.once('end', onEnd);
    process.stdin.once('error', onError);
    emptyTimer = setTimeout(finish, emptyMs);
    process.stdin.resume();
  });
}
