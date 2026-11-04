// Reuse the staged native HTTP server and actual installed SDK from retirement.
import assert from 'node:assert/strict';
import fs from 'node:fs';

export async function proveSessionRecovery({ native, create, createReleased, moduleUrl, config }) {
  const http = native.transports[0], dispatch = http.requestHandler;
  const baseline = fs.readFileSync(config, 'utf8');
  const clients = [], counts = { read: 0, write: 0 }, events = [];
  let lastSession, fault, hold, enter, release, initializations = 0;
  native.sessionManager.on('session:initialized', () => initializations++);
  for (const kind of ['read', 'write']) native.registerTool({
    name: 'recovery_' + kind, description: 'Disposable recovery boundary',
    inputSchema: { type: 'object', properties: {} }, handler: async (_args, context) => {
      counts[kind]++; lastSession = context.sessionId;
      if (hold) { enter(); await hold; }
      return { success: true, kind, sessionId: context.sessionId };
    },
  });
  const client = async (factory = create) => { const value = await factory(moduleUrl); clients.push(value); return value; };
  const invoke = (value, kind = 'read', options = {}) => value.call('recovery_' + kind, {}, { sessionId: 'persistent-recovery', ...options });
  const expire = () => {
    const session = native.getSession(lastSession); assert(session);
    session.lastActivityAt = new Date(Date.now() - 30 * 60_000 - 1);
    assert.equal(native.sessionManager.cleanupExpiredSessions(), 1);
  };
  http.requestHandler = async (request, context) => {
    if (request.method === 'initialize') events.push('initialize');
    if (request.method === 'tools/call' && request.params.name.startsWith('recovery_')) {
      events.push(request.params.name);
      if (fault) return fault(request, context);
    }
    return dispatch(request, context);
  };
  try {
    const released = await client(createReleased);
    await invoke(released); expire(); const beforeReleased = counts.read;
    await assert.rejects(invoke(released), /HTTP session is absent, expired/);
    assert.equal(counts.read, beforeReleased, 'released client surfaces native pre-dispatch expiry');
    const current = await client(); await invoke(current); expire();
    const before = { ...counts }, initialized = initializations;
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => invoke(current, index % 2 ? 'write' : 'read')));
    assert(results.every(result => result.success));
    assert.equal(initializations, initialized + 1, 'all rejected concurrent calls share one fresh handshake');
    assert.equal(new Set(results.map(result => result.sessionId)).size, 1);
    assert.deepEqual(counts, { read: before.read + 6, write: before.write + 6 }, 'each accepted operation executes exactly once');

    // Principal mismatch is still an unauthorised use of an existing session.
    const mismatched = await client(); await invoke(mismatched);
    native.httpSessionPrincipals.set(native.getSession(lastSession), 'different-principal');
    const mismatchInitializations = initializations, mismatchReads = counts.read;
    await assert.rejects(invoke(mismatched), /HTTP session is absent, expired/);
    assert.equal(initializations, mismatchInitializations); assert.equal(counts.read, mismatchReads);

    const missing = (request, context, overrides = {}) => {
      context.reply.status = 404;
      return { jsonrpc: '2.0', id: request.id, error: { code: -32002, message: 'fixture session absent',
        data: { protocol: 'ruflo/http-session', version: 1, reason: 'session-not-found', dispatched: false, ...overrides } } };
    };
    for (const mode of ['403', 'unreceipted-404', 'wrong-id', 'dispatched', 'malformed', 'lost-response', 'twice']) {
      const isolated = await client(); await invoke(isolated); const starts = initializations, writes = counts.write;
      let attempts = 0;
      fault = async (request, context) => {
        attempts++;
        if (mode === 'lost-response') { await dispatch(request, context); throw new Error('fixture response lost'); }
        if (mode === '403') { context.reply.status = 403; return { jsonrpc: '2.0', id: request.id, error: { code: -32002, message: 'forbidden' } }; }
        const result = missing(request, context, mode === 'dispatched' ? { dispatched: true } : {});
        if (mode === 'unreceipted-404') delete result.error.data;
        if (mode === 'wrong-id') result.id++;
        if (mode === 'malformed') return 'invalid session response';
        return result;
      };
      await assert.rejects(invoke(isolated, 'write'));
      assert.equal(attempts, mode === 'twice' ? 2 : 1, mode + ' has bounded dispatch attempts');
      assert.equal(initializations, starts + (mode === 'twice' ? 1 : 0), mode + ' handshake eligibility');
      assert.equal(counts.write, writes + (mode === 'lost-response' ? 1 : 0), mode + ' never duplicates execution');
      fault = undefined;
    }

    const changed = await client(); await invoke(changed); const starts = initializations;
    fault = (request, context) => {
      const configuration = JSON.parse(baseline); configuration.owners.one.cwd += '/different-owner';
      fs.writeFileSync(config, JSON.stringify(configuration), { mode: 0o600 });
      return missing(request, context);
    };
    await assert.rejects(invoke(changed, 'write'), /authority changed/);
    assert.equal(initializations, starts, 'configuration changes cannot redirect a recovery');
    fault = undefined; fs.writeFileSync(config, baseline, { mode: 0o600 });

    const wrongOwner = await client(); await invoke(wrongOwner); expire();
    const savedInitialize = native.handleInitialize, identityWrites = counts.write;
    native.handleInitialize = async request => {
      const response = await savedInitialize(request);
      response.result.capabilities.experimental['ruflo/native-memory-owner'].cwd += '/wrong-authority';
      return response;
    };
    try { await assert.rejects(invoke(wrongOwner, 'write'), /identity does not match/); }
    finally { native.handleInitialize = savedInitialize; }
    assert.equal(counts.write, identityWrites, 'replacement identity is verified before dispatch');

    const cancelled = await client(); await invoke(cancelled);
    const abort = new AbortController(), cancellationStarts = initializations;
    fault = (request, context) => { abort.abort(new Error('fixture caller cancelled')); return missing(request, context); };
    await assert.rejects(invoke(cancelled, 'write', { signal: abort.signal }), /fixture caller cancelled/);
    assert.equal(initializations, cancellationStarts, 'cancellation cannot initialize a replacement');
    fault = undefined;

    // An older operation can still be executing while this session disappears.
    // Its unknown result must not replay or evict the successful replacement.
    const concurrent = await client(); await invoke(concurrent);
    hold = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { enter = resolve; });
    let first = true;
    fault = async (request, context) => {
      if (first) { first = false; await dispatch(request, context); throw new Error('late response lost'); }
      return dispatch(request, context);
    };
    const writeBefore = counts.write;
    const uncertain = invoke(concurrent, 'write'); const uncertainResult = assert.rejects(uncertain, /late response lost/);
    await entered; native.terminateSession(lastSession); hold = null;
    const recovered = await invoke(concurrent), recoveredStarts = initializations;
    release(); await uncertainResult; fault = undefined;
    const subsequent = await invoke(concurrent);
    assert.equal(recovered.sessionId, subsequent.sessionId);
    assert.equal(initializations, recoveredStarts, 'late old failure cannot evict replacement');
    assert.equal(counts.write, writeBefore + 1, 'unknown in-flight write never replays');
    console.log('shared session recovery: released expiry reproduced; 12 concurrent calls/one handshake; principal/403/404/unknown refusals; bounded retry; authority and late-failure isolation');
  } finally {
    fault = undefined; http.requestHandler = dispatch;
    fs.writeFileSync(config, baseline, { mode: 0o600 });
    if (release) release(); await Promise.allSettled(clients.map(value => value.close()));
    for (const session of native.getSessions()) native.terminateSession(session.id);
  }
}
