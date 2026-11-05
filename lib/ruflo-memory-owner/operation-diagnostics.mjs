// Ruflo #3164: observations only; no input serialization, authorization or polling.
// Serialized beside the existing native owner binding, not into a second process.
export async function createOperationDiagnostics() {
  const inactive = () => { const trace = () => {}; trace.wrap = evaluate => evaluate; return trace; };
  try {
    const fs = await import('node:fs'), { join, resolve } = await import('node:path');
    const { userInfo } = await import('node:os'), { createHash, randomUUID } = await import('node:crypto');
    const { performance } = await import('node:perf_hooks');
    const hash = text => createHash('sha256').update(text).digest('hex');
    const begin = (tool, context) => {
      if (process.env.RSP_OPERATION_DIAGNOSTICS === 'off' || process.env.RSP_POLICY_DIAGNOSTICS === 'off') return inactive();
      try {
        const start = performance.now(), cpu = process.cpuUsage(), loop = performance.eventLoopUtilization();
        const row = { schemaVersion: 1, invocation: randomUUID(), pid: process.pid,
          startedAt: new Date().toISOString(), tool: typeof tool === 'string' && /^[a-z0-9_-]{1,80}$/.test(tool) ? tool : null,
          project: hash(resolve(typeof context?.projectRoot === 'string' ? context.projectRoot : process.cwd())).slice(0, 16),
          projectSource: 'call-context', inputDigest: null, digestSource: 'unavailable',
          metricScope: 'process-interval-including-overlapping-calls', phases: [] };
        if (typeof context?.diagnosticClient === 'string' && context.diagnosticClient.length <= 256)
          row.clientDigest = hash(context.diagnosticClient);
        if (typeof context?.sessionId === 'string' && context.sessionId.length <= 256)
          row.sessionDigest = hash(context.sessionId);
        const name = 'operation-' + (parseInt(hash(row.invocation).slice(0, 8), 16) % 128) + '.json';
        const seen = new Set();
        const persist = () => {
          let fd;
          try {
            let dir = process.env.RUFLO_SOURCE_PATCH_HOME || userInfo().homedir;
            for (const part of ['.ruflo-source-patch', 'mcp-operation-diagnostics']) {
              dir = join(dir, part);
              try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') return; }
              const s = fs.lstatSync(dir);
              if (!s.isDirectory() || s.isSymbolicLink() || (part === 'mcp-operation-diagnostics' && (s.mode & 0o077))
                  || (process.getuid && s.uid !== process.getuid())) return;
            }
            const bytes = Buffer.from(JSON.stringify(row) + '\n');
            if (bytes.length > 8192) return;
            fd = fs.openSync(join(dir, name), fs.constants.O_CREAT | fs.constants.O_WRONLY
              | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0), 0o600);
            const s = fs.fstatSync(fd);
            if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid())) return;
            for (let at = 0; at < bytes.length;) {
              const written = fs.writeSync(fd, bytes, at, bytes.length - at, at);
              if (!written) return;
              at += written;
            }
            fs.ftruncateSync(fd, bytes.length);
          } catch { /* A missing, unsafe, read-only or racing sink changes no call. */ }
          finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
        };
        const trace = (phase, details) => {
          try {
            if (!['entered', 'policy-request', 'authorized', 'handler-start', 'handler-end',
              'forward-start', 'forward-end', 'return', 'error', 'lag-sample'].includes(phase) || seen.has(phase)) return;
            seen.add(phase);
            const used = process.cpuUsage(cpu), elapsed = performance.eventLoopUtilization(loop);
            const item = { phase, elapsedMs: Math.max(0, performance.now() - start),
              cpuUserMicros: used.user, cpuSystemMicros: used.system,
              loopActiveMs: Math.max(0, elapsed.active), loopIdleMs: Math.max(0, elapsed.idle) };
            if (phase === 'error' && typeof details?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(details.code)) item.errorCode = details.code;
            if (phase === 'lag-sample') item.immediateDelayMs = item.elapsedMs;
            row.phases.push(item); persist();
          } catch { /* Observations never throw into native dispatch. */ }
        };
        trace.wrap = evaluate => {
          if (typeof evaluate !== 'function') return evaluate;
          return (request, root) => {
            try {
              const digest = request?.context?.metadata?.inputDigest;
              if (typeof digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(digest)) {
                row.inputDigest = digest; row.digestSource = 'native-policy-request';
              }
              if (typeof root === 'string') { row.project = hash(resolve(root)).slice(0, 16); row.projectSource = 'native-policy'; }
              trace('policy-request');
            } catch { /* Preserve the exact original evaluator call and arguments. */ }
            return evaluate(request, root);
          };
        };
        trace('entered');
        // One scheduling sample per call, not a global monitor or polling loop.
        setImmediate(() => trace('lag-sample')).unref();
        return trace;
      } catch { return inactive(); }
    };
    begin.initialize = server => {
      const initialize = server.handleInitialize;
      server.handleInitialize = function (request) {
        let trace = inactive();
        try { trace = begin('initialize', { diagnosticClient: request?.params?.clientInfo?.name }); } catch {}
        try {
          trace('handler-start');
          const result = Reflect.apply(initialize, this, [request]);
          return Promise.resolve(result).then(value => {
            trace('handler-end'); trace('return'); return value;
          }, error => { trace('error', error); throw error; });
        } catch (error) { trace('error', error); throw error; }
      };
    };
    return begin;
  } catch { return inactive; }
}
