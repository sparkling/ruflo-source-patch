// Serialized into the native CLI module. Storage, authorization and transport
// remain the installed Ruflo handlers and MCP SDK; this is explicit routing only.
// Completed HTTP client lifecycle gap: https://github.com/ruvnet/ruflo/issues/4674
import { createOwnerPolicyProtocol } from './policy.mjs';
export async function createMemoryOwnerClient(moduleUrl) {
  const { existsSync, realpathSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const { randomUUID } = await import('node:crypto');
  const defaultConfig = join(homedir(), '.config', 'ruflo', 'memory-owners.json');
  const configFile = () => process.env.RUFLO_MEMORY_OWNER_CONFIG ?? defaultConfig;
  const sessions = new Map();
  const sessionRefusals = new WeakSet();
  const releasedClients = new Set();
  let nativeServer;
  let shuttingDown = false;
  let serverMode = false, serverIdentity;
  const capability = 'ruflo/native-memory-owner';
  const releaseNotification = 'notifications/ruflo/memory-owner-release';
  const ephemeralCapability = 'ruflo/native-memory-owner-one-call';
  const ephemeralClients = new Map();
  const policy = await createOwnerPolicyProtocol(moduleUrl);
  const validClientId = value => typeof value === 'string'
    && /^ruflo-native-owner-client:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const configured = () => !serverMode && (process.env.RUFLO_MEMORY_OWNER_CONFIG !== undefined || existsSync(defaultConfig));
  const decode = (response, canonical = false) => {
    const text = response.content?.filter(row => row.type === 'text').map(row => row.text).join('\n');
    let result = response.structuredContent;
    if (result === undefined && text) {
      try { result = JSON.parse(text); }
      catch { if (!response.isError) throw new Error('Native memory owner returned invalid JSON'); }
    }
    if (response.isError) {
      // Native public-memory failures are results, not transport exceptions.
      // Preserve them so existing callers retain their own refusal/readback logic.
      if (canonical && result && typeof result === 'object' && !Array.isArray(result)
          && Object.hasOwn(result, 'success') && result.success === false
          && Object.hasOwn(result, 'error') && typeof result.error === 'string' && result.error.trim()) return result;
      const detail = typeof result?.error === 'string' ? result.error
        : typeof result?.error?.message === 'string' ? result.error.message
        : 'MCP tool returned isError without a diagnostic';
      // Never stringify the result: it may echo values, and a pretty JSON opening
      // brace hides the actual refusal from the native hook's line-based redactor.
      throw new Error('Native memory owner refused: ' + detail.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').slice(0, 1024));
    }
    return result;
  };
  async function identity() {
    const { resolve } = await import('node:path');
    return { protocol: 1, cwd: resolve(process.cwd()),
      pin: process.env.CLAUDE_FLOW_DB_PATH?.trim() ? resolve(process.env.CLAUDE_FLOW_DB_PATH) : null };
  }
  async function binding(dbPath) {
    const { readFileSync, lstatSync } = await import('node:fs');
    const { resolve, isAbsolute } = await import('node:path');
    const file = configFile();
    if (!file || !isAbsolute(file)) throw new Error('Memory owner configuration requires an absolute file path');
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || (stat.mode & 0o022))
      throw new Error('Unsafe memory owner configuration file');
    const config = JSON.parse(readFileSync(file, 'utf8'));
    if (config.version !== 1 || !config.owners || !Array.isArray(config.contexts) || !Array.isArray(config.stores))
      throw new Error('Invalid memory owner configuration');
    const here = await identity();
    const matches = dbPath === undefined
      ? config.contexts.filter(row => row.cwd === here.cwd && row.pin === here.pin)
      : config.stores.filter(row => row.dbPath === resolve(dbPath));
    if (matches.length !== 1) throw new Error('Memory owner binding is missing or ambiguous; no local fallback');
    const id = matches[0].owner;
    if (typeof id !== 'string' || !Object.hasOwn(config.owners, id)) throw new Error('Unknown memory owner');
    const owner = config.owners[id];
    if (!owner || typeof owner.cwd !== 'string' || !isAbsolute(owner.cwd)
        || (owner.pin !== null && (typeof owner.pin !== 'string' || !isAbsolute(owner.pin)))
        || typeof owner.tokenFile !== 'string' || !isAbsolute(owner.tokenFile))
      throw new Error('Invalid memory owner identity or token file');
    const url = new URL(owner.url);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.hash || url.search)
      throw new Error('Memory owner must be an authenticated literal loopback endpoint');
    if (dbPath !== undefined && owner.pin !== null && resolve(dbPath) !== resolve(owner.pin))
      throw new Error('Explicit database path conflicts with configured owner authority');
    if (owner.requestTimeoutMs !== undefined && (!Number.isSafeInteger(owner.requestTimeoutMs)
        || owner.requestTimeoutMs < 1 || owner.requestTimeoutMs > 3_600_000))
      throw new Error('Invalid native owner request timeout');
    const tokenStat = lstatSync(owner.tokenFile);
    if (!tokenStat.isFile() || tokenStat.isSymbolicLink() || (tokenStat.mode & 0o077))
      throw new Error('Memory owner token file must be private');
    const { resolveMcpHttpAuthToken } = await import(new URL('./mcp-server.js', moduleUrl));
    return { ...owner, url, token: resolveMcpHttpAuthToken({ tokenFile: owner.tokenFile }) };
  }
  async function connect(owner, ephemeral = false, requirePolicy = false) {
    const { randomUUID } = await import('node:crypto');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const clientId = 'ruflo-native-owner-client:' + randomUUID();
    const client = new Client({ name: clientId, version: '1.0.0' }, { capabilities: ephemeral
      ? { experimental: { [ephemeralCapability]: { version: 1 } } } : {} });
    const connection = { client, clientId, pending: 0, uncertain: false, releaseCapable: false };
    const abort = new AbortController();
    connection.abort = abort;
    const timeout = setTimeout(() => abort.abort(new Error('Native owner handshake timed out')), 30_000);
    const request = { signal: abort.signal, timeout: 30_000 };
    try {
      const transport = new StreamableHTTPClientTransport(owner.url, {
        requestInit: { headers: { Authorization: `Bearer ${owner.token}` }, redirect: 'error' },
        // The SDK's fetch paths merge their own signal; combine it with the
        // bounded request signal instead of permitting a hung initial handshake.
        fetch: async (url, init) => {
          const response = await fetch(url, { ...init, redirect: 'error',
            signal: init?.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal });
          // Match this authenticated POST's refusal, never an error string or tool result.
          if (response.status === 404 && init?.method === 'POST') {
            let request, body;
            try { request = JSON.parse(init.body); body = await response.clone().json(); } catch { /* No proof, no retry. */ }
            const data = body?.error?.data;
            if (request?.method === 'tools/call' && request.id !== undefined && body?.id === request.id
                && body.jsonrpc === '2.0' && body.error?.code === -32002 && new Headers(init.headers).has('mcp-session-id')
                && data?.protocol === 'ruflo/http-session' && data.version === 1
                && data.reason === 'session-not-found' && data.dispatched === false) {
              const error = new Error('Native HTTP session absent before dispatch');
              await response.body?.cancel();
              sessionRefusals.add(error); throw error;
            }
          }
          return response;
        },
      });
      await client.connect(transport, request);
      const experimental = client.getServerCapabilities()?.experimental;
      const advertised = experimental && Object.hasOwn(experimental, capability);
      let actual;
      if (advertised) {
        actual = experimental[capability];
        if (!actual || actual.releaseNotification !== releaseNotification)
          throw new Error('Invalid native owner protocol capability; nothing dispatched');
        connection.releaseCapable = true;
        connection.protocolRelease = true;
        connection.policy = actual.policy;
        if (ephemeral && Object.hasOwn(experimental, ephemeralCapability)) {
          const disposal = experimental[ephemeralCapability];
          if (disposal?.version !== 1 || typeof disposal.token !== 'string'
              || !validClientId('ruflo-native-owner-client:' + disposal.token))
            throw new Error('Invalid one-call owner capability; nothing dispatched');
          connection.ephemeral = { clientId, token: disposal.token };
        }
        if (actual?.protocol !== 1 || actual.cwd !== owner.cwd || actual.pin !== owner.pin)
          throw new Error('Native owner identity does not match configured authority; nothing dispatched');
      }
      if (requirePolicy && !actual?.policy)
        throw new Error('Native owner policy capability is absent or incompatible; nothing evaluated or dispatched');
      // Initialization has already allocated a native session. Learn its modern
      // retirement capability before listTools can fail or time out.
      const tools = await client.listTools(connection.ephemeral
        ? { _meta: { [ephemeralCapability]: connection.ephemeral } } : {}, request);
      if (!advertised) {
        // Exact 4.46.108 compatibility during rolling native owner refresh.
        connection.releaseCapable = tools.tools.some(tool => tool.name === 'memory_owner_release');
        if (!connection.releaseCapable)
          throw new Error('Native owner session retirement capability is absent; nothing dispatched');
        if (!tools.tools.some(tool => tool.name === 'memory_owner_identity'))
          throw new Error('Owner identity capability is absent; nothing dispatched');
        actual = decode(await client.callTool({ name: 'memory_owner_identity', arguments: {} }, undefined, request));
      }
      if (actual?.protocol !== 1 || actual.cwd !== owner.cwd || actual.pin !== owner.pin)
        throw new Error('Native owner identity does not match configured authority; nothing dispatched');
      return { ...connection, tools: tools.tools };
    } catch (error) {
      await retire(connection);
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function retire(connection, force = false) {
    connection.closing = true;
    if (connection.retired || (connection.pending && !force)) return;
    connection.retired = true;
    // A cancelled/timed-out operation may still be executing on the server.
    // Never assert completion from a client-side timeout. Opted-in one-call
    // sessions are retired by the server only after its actual handler settles.
    if (connection.pending) connection.uncertain = true;
    try {
      if (!connection.uncertain && !connection.sessionAbsent && connection.releaseCapable && !connection.oneCallCompleted) {
        if (connection.protocolRelease) {
          // SDK notifications have no request timeout; bound their actual fetch.
          const timer = setTimeout(() => connection.abort.abort(new Error('Native owner retirement timed out')), 5000);
          try { await connection.client.notification({ method: releaseNotification,
            params: { clientId: connection.clientId, ...(connection.ephemeral ? { token: connection.ephemeral.token } : {}) } }); }
          finally { clearTimeout(timer); }
        } else decode(await connection.client.callTool({ name: 'memory_owner_release',
          arguments: { clientId: connection.clientId } }, undefined, { timeout: 5000 }));
      }
    } catch (error) {
      console.error('Native owner session retirement unavailable: ' + error.message);
    } finally {
      try { await connection.client.close(); }
      catch (error) { console.error('Native owner transport close failed: ' + error.message); }
    }
  }
  async function call(name, options = {}, context = {}, canonical = false, coalesced = false, inventory, retryAuthority) {
    if (shuttingDown) throw new Error('Native owner client is shutting down; nothing dispatched');
    if (context.signal?.aborted) throw context.signal.reason || new Error('Owner request cancelled');
    const { resolve } = await import('node:path');
    const here = await identity();
    const original = inventory ? structuredClone(options) : options;
    if (inventory) options = original;
    if (context.transport === 'stdio' && options.dbPath !== undefined) {
      if (here.pin !== null && resolve(options.dbPath) !== here.pin)
        throw new Error('Explicit database path conflicts with configured MCP client authority');
    }
    const graph = ['agentdb_graph-query', 'agentdb_graph-pathfinder'].includes(name);
    const scoped = graph || (name.startsWith('memory_') && !['memory_owner_identity', 'memory_index_status', 'memory_generate_embedding'].includes(name));
    if (options.dbPath === undefined && here.pin !== null && scoped)
      options = { ...options, dbPath: here.pin };
    const owner = await binding(options.dbPath);
    const authority = JSON.stringify([owner.url.href, owner.cwd, owner.pin, owner.token]);
    if (retryAuthority !== undefined && retryAuthority !== authority)
      throw new Error('Native owner authority changed during session recovery; nothing dispatched');
    // Preserve the original native request and digest. An inferred path need
    // not cross the wire when both native contexts have the identical pin/cwd.
    let projection, explicitStoreRead = false;
    if (coalesced) {
      // These native handlers use an explicit dbPath as their sole store source.
      // Keep the original selector and policy request; inferred defaults and
      // controller/write operations still require identical owner/client pins.
      const selectedPath = Object.getOwnPropertyDescriptor(original, 'dbPath');
      if (inventory) {
        if (!configured() || !policy.eligible(context) || !['memory_list', 'memory_stats', 'memory_export'].includes(name)
            || !selectedPath?.enumerable || !Object.hasOwn(selectedPath, 'value') || selectedPath.value !== inventory.dbPath
            || (here.pin !== null && here.pin !== inventory.dbPath) || realpathSync(owner.cwd) !== inventory.root
            || 'provenanceType' in original || 'provenanceFilter' in original)
          throw new Error('Inventory reader authority changed; nothing dispatched');
        explicitStoreRead = true;
      } else {
      explicitStoreRead = owner.pin === null && here.pin !== null
        && ['memory_list', 'memory_stats', 'memory_export', 'memory_search', 'memory_retrieve'].includes(name)
        && selectedPath?.enumerable === true && Object.hasOwn(selectedPath, 'value')
        && selectedPath.value === here.pin;
      if ((owner.pin !== here.pin && !explicitStoreRead)
          || realpathSync(owner.cwd) !== realpathSync(here.cwd) || 'provenanceType' in original || 'provenanceFilter' in original)
        return { forwarded: false };
      }
      projection = await policy.project(name, original, inventory ? { ...context, projectRoot: inventory.root } : context, owner);
      if (!projection) return { forwarded: false };
    }
    const key = context.sessionId ? JSON.stringify([context.sessionId, authority]) : null;
    if (key && !sessions.has(key)) sessions.set(key, connect(owner, false, coalesced));
    const selected = key ? sessions.get(key) : connect(owner, true, coalesced);
    let connection, counted = false, dispatched = false, received = false;
    try {
      connection = await selected;
      context.signal?.throwIfAborted();
      if (shuttingDown || connection.closing || connection.retired)
        throw new Error('Native owner connection is closing; nothing dispatched');
      if (inventory) {
        const current = await identity(), bound = await binding(inventory.dbPath);
        if (!connection.ephemeral || !configured() || !policy.eligible(context)
            || (current.pin !== null && current.pin !== inventory.dbPath)
            || bound.cwd !== owner.cwd || bound.pin !== owner.pin || bound.url.href !== owner.url.href || bound.token !== owner.token)
          throw new Error('Inventory reader requires current default authority and native one-call retirement');
      }
      connection.pending++;
      counted = true;
      const { client, tools } = connection;
      if (coalesced && !policy.matches(projection.authority, connection.policy))
        throw new Error('Native owner policy capability is absent or incompatible; nothing evaluated or dispatched');
      const schema = tools.find(tool => tool.name === name)?.inputSchema?.properties;
      if (!schema) throw new Error('Native owner does not advertise the requested operation');
      if (explicitStoreRead && !Object.hasOwn(schema, 'dbPath'))
        throw new Error('Native owner lacks explicit read store authority; nothing dispatched');
      if (graph && options.dbPath !== undefined && !Object.hasOwn(schema, 'dbPath'))
        throw new Error('Native owner lacks explicit retained graph authority; nothing dispatched');
      if (canonical) {
        const required = name === 'memory_store'
          ? ['nativeResult', 'requireNative', 'appendOnly', 'appendConditions', 'generateEmbeddingFlag'] : ['nativeResult'];
        if (required.some(field => !Object.hasOwn(schema, field)))
          throw new Error('Native owner lacks canonical operation controls; nothing dispatched');
      }
      const args = { ...(coalesced ? original : options), ...(canonical ? { nativeResult: true } : {}) };
      if (!coalesced && args.dbPath !== undefined) args.dbPath = resolve(args.dbPath);
      if ('provenanceType' in args) { args.provenance_type = args.provenanceType; delete args.provenanceType; }
      if (name === 'memory_search' && 'provenanceFilter' in args) {
        args.provenance_filter = args.provenanceFilter; delete args.provenanceFilter;
      }
      // Only an authenticated pre-dispatch refusal may authorize one reconnect.
      dispatched = true;
      const response = await client.callTool({ name, arguments: args,
        ...((connection.ephemeral || projection) ? { _meta: {
          ...(connection.ephemeral ? { [ephemeralCapability]: connection.ephemeral } : {}),
          ...(projection ? { [policy.key]: projection } : {}),
        } } : {}) }, undefined,
        { signal: context.signal, timeout: owner.requestTimeoutMs ?? 180_000 });
      received = true;
      // Negotiated one-call handlers mark completion before sending the result.
      // A successor may already have removed that session; only close transport.
      if (connection.ephemeral) connection.oneCallCompleted = true;
      const result = decode(response, canonical);
      if (canonical && (!result || typeof result.success !== 'boolean'))
        throw new Error('Native owner returned an invalid canonical result');
      return coalesced ? { forwarded: true, result } : result;
    } catch (error) {
      const absent = sessionRefusals.has(error) || (!dispatched && connection?.sessionAbsent);
      if (key && sessions.get(key) === selected) sessions.delete(key);
      if (connection) {
        connection.closing = true;
        if (absent) connection.sessionAbsent = true;
        if (dispatched && !received && !absent) connection.uncertain = true;
      }
      if (absent && retryAuthority === undefined)
        return call(name, original, context, canonical, coalesced, inventory, authority);
      throw error;
    } finally {
      if (connection) {
        if (counted) connection.pending--;
        if (!key || connection.closing) await retire(connection);
      }
    }
  }
  // A fixed-source read facade may live in another project. Construct its full
  // request through native projectRoot support and verify it at the owner; the
  // ordinary caller's same-cwd forwarding guard above remains unchanged.
  const openInventoryReader = async ({ root, dbPath, signal } = {}) => {
    const { isAbsolute, resolve } = await import('node:path');
    if (!configured() || !policy.eligible() || typeof root !== 'string' || !isAbsolute(root)
        || typeof dbPath !== 'string' || !isAbsolute(dbPath)) throw new Error('Invalid fixed inventory authority');
    const scope = { root: realpathSync(root), dbPath: resolve(dbPath) }, here = await identity();
    if (here.pin !== null && here.pin !== scope.dbPath) throw new Error('Inventory reader conflicts with caller pin');
    signal?.throwIfAborted();
    const owner = await binding(scope.dbPath);
    if (realpathSync(owner.cwd) !== scope.root) throw new Error('Inventory source root conflicts with owner');
    const projected = await policy.project('memory_stats', { dbPath: scope.dbPath }, { projectRoot: scope.root }, owner);
    const connection = await connect(owner, true, true);
    let registry;
    try {
      signal?.throwIfAborted();
      if (!policy.eligible() || !connection.ephemeral || !policy.matches(projected?.authority, connection.policy))
        throw new Error('Inventory owner policy or one-call retirement is unavailable');
      registry = connection.tools.filter(tool => ['memory_list', 'memory_stats', 'memory_export'].includes(tool.name));
      if (registry.length !== 3 || registry.some(tool => !Object.hasOwn(tool.inputSchema?.properties ?? {}, 'dbPath')))
        throw new Error('Inventory owner lacks explicit store schemas');
    } finally { await retire(connection); }
    const active = new Set(); let closed = false;
    return { registry, client: {
      callTool(request, _schema, options = {}) {
        if (closed || active.size >= 4) return Promise.reject(new Error('Inventory reader closed or concurrency bound exceeded'));
        if (!request?.arguments || typeof request.arguments !== 'object' || Array.isArray(request.arguments))
          return Promise.reject(new Error('Invalid inventory read arguments'));
        const ownerTimeout = owner.requestTimeoutMs ?? 180000, timeout = options.timeout ?? ownerTimeout;
        if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3600000)
          return Promise.reject(new Error('Invalid inventory request timeout'));
        const deadline = AbortSignal.timeout(Math.min(timeout, ownerTimeout));
        const requestSignal = AbortSignal.any([signal, options.signal, deadline].filter(Boolean));
        const pending = call(request.name, request.arguments, { signal: requestSignal }, false, true, scope)
          .then(value => { if (!value.forwarded) throw new Error('Inventory policy projection unavailable');
            return { content: [{ type: 'text', text: JSON.stringify(value.result) }] }; });
        active.add(pending); return pending.finally(() => active.delete(pending));
      },
      async close() { closed = true; await Promise.allSettled([...active]); },
    } };
  };
  const tryForward = (name, input, context = {}) => configured() && policy.eligible(context)
    ? call(name, input, context, false, true) : Promise.resolve({ forwarded: false });
  const policyContext = context => serverMode ? policy.context(context) : context;
  const policyBatches = new Map();
  const policyEvaluator = (context, toolName) => serverMode && context?.transport === 'http'
    ? async (request, projectRoot) => {
      const route = await policy.verify(request, projectRoot);
      const queuedAt = Date.now();
      return new Promise((resolve, reject) => {
      let batch = policyBatches.get(projectRoot);
      if (!batch) {
        batch = { requests: [], timer: null, running: false };
        policyBatches.set(projectRoot, batch);
        batch.flush = async () => {
          if (batch.running || policyBatches.get(projectRoot) !== batch) return;
          batch.running = true;
          clearTimeout(batch.timer);
          while (batch.requests.length) {
            const waiting = batch.requests.splice(0, 32);
            try {
              const { withPolicyTransaction } = await import(new URL('./services/policy-runtime.js', moduleUrl));
              // Each request retains native authorization and its receipt. One
              // transaction at a time avoids contending with our own lock holder.
              const decisions = await withPolicyTransaction(projectRoot,
                engine => waiting.map(item => engine.evaluate(item.request)),
                { diagnostic: waiting.map(({ request, route, queuedAt }) => ({ tool: request.action?.tool,
                  inputDigest: request.context?.metadata?.inputDigest, route, queueWaitMs: Date.now() - queuedAt })) });
              waiting.forEach((item, index) => item.resolve(decisions[index]));
            } catch (error) { waiting.forEach(item => item.reject(error)); }
            if (batch.requests.length) await new Promise(resolve => setImmediate(resolve));
          }
          policyBatches.delete(projectRoot);
        };
        batch.timer = setTimeout(batch.flush, 5);
      }
      batch.requests.push({ request, resolve, reject, route, queuedAt });
      if (batch.requests.length === 32) void batch.flush();
      });
    } : undefined;
  const close = async () => {
    shuttingDown = true;
    const current = [...sessions.values()]; sessions.clear();
    await Promise.allSettled(current.map(async pending => retire(await pending, true)));
  };
  const attachServer = server => {
    if (!serverMode) throw new Error('Session retirement requires verified native HTTP server role');
    nativeServer = server;
    const initialize = server.handleInitialize.bind(server);
    server.handleInitialize = request => {
      const declaration = request.params?.capabilities?.experimental?.[ephemeralCapability];
      const clientId = request.params?.clientInfo?.name;
      if (declaration !== undefined && (declaration?.version !== 1 || !validClientId(clientId)
          || typeof server.handleRequest !== 'function'
          || server.getSessions().some(session => session.clientInfo?.name === clientId)))
        return Promise.reject(new Error('Invalid or duplicate one-call owner initialization'));
      // The qualified native initializer has no await before installing its new
      // current session. Keep retirement and that handover in one JS turn.
      if (request.params) {
        const live = server.getSessions();
        for (const [id, entry] of ephemeralClients) {
          if (!entry.pending && !entry.dispatched && Date.now() >= entry.expiresAt) {
            entry.done = true; releasedClients.add(id);
          }
          if (!entry.pending && !live.some(session => session.id === entry.sessionId)) ephemeralClients.delete(id);
        }
        for (const session of server.getSessions())
          if (releasedClients.has(session.clientInfo?.name) && !ephemeralClients.get(session.clientInfo?.name)?.pending) {
            server.terminateSession(session.id); ephemeralClients.delete(session.clientInfo?.name);
          }
        for (const id of releasedClients) if (!ephemeralClients.get(id)?.pending) releasedClients.delete(id);
      }
      return Promise.resolve(initialize(request)).then(async response => {
        if (!response.result) return response;
        let disposal;
        if (declaration !== undefined) {
          const matching = server.getSessions().filter(session => session.clientInfo?.name === clientId);
          if (matching.length !== 1) throw new Error('One-call native session identity is ambiguous');
          const entry = { sessionId: matching[0].id, token: randomUUID(), pending: 0,
            dispatched: false, done: false, expiresAt: Date.now() + 30_000 };
          ephemeralClients.set(clientId, entry); disposal = { version: 1, token: entry.token };
        }
        const policyAuthority = await policy.advertise();
        return { ...response, result: { ...response.result, capabilities: { ...response.result.capabilities,
          experimental: { ...response.result.capabilities?.experimental,
            [capability]: { ...serverIdentity, releaseNotification, ...(policyAuthority ? { policy: policyAuthority } : {}) },
            ...(disposal ? { [ephemeralCapability]: disposal } : {}) } } } };
      });
    };
    if (typeof server.handleRequest === 'function') {
      const handle = server.handleRequest.bind(server);
      server.handleRequest = async request => {
        const metadata = request.params?._meta?.[ephemeralCapability];
        if (metadata === undefined) return policy.run(request, () => handle(request)); // persistent and rolling older clients
        const entry = ephemeralClients.get(metadata?.clientId);
        const requestSession = server.httpSessionContext?.getStore()?.session;
        if ((requestSession && requestSession.id !== entry?.sessionId) || !entry || entry.token !== metadata.token || entry.done || entry.dispatched
            || (!entry.pending && Date.now() >= entry.expiresAt)
            || !server.getSessions().some(session => session.id === entry.sessionId)
            || !['tools/list', 'tools/call'].includes(request.method))
          throw new Error('Invalid, completed or expired one-call owner request');
        entry.pending++;
        if (request.method === 'tools/call') entry.dispatched = true;
        try { return await policy.run(request, () => handle(request)); }
        finally {
          entry.pending--;
          // Completion is known here even when the HTTP client has disappeared.
          // It proves disposal safety, never delivery or a successful write.
          if (entry.dispatched && !entry.pending) { entry.done = true; releasedClients.add(metadata.clientId); }
        }
      };
    }
    const notify = server.handleNotification.bind(server);
    server.handleNotification = notification => notification.method === releaseNotification
      ? releaseSession(notification.params?.clientId, notification.params?.token) : notify(notification);
  };
  const releaseSession = (clientId, token) => {
    if (!nativeServer || !validClientId(clientId))
      throw new Error('Invalid native owner client retirement');
    const entry = ephemeralClients.get(clientId);
    const requestSession = nativeServer.httpSessionContext?.getStore()?.session;
    if (entry && (entry.token !== token || (requestSession && requestSession.id !== entry.sessionId))) throw new Error('Invalid one-call owner retirement');
    if (entry) entry.done = true;
    const matching = nativeServer.getSessions().filter(session => session.clientInfo?.name === clientId);
    if (matching.length) releasedClients.add(clientId);
    return { scheduled: matching.length };
  };
  const enterServerMode = async projectRoot => {
    const owner = await binding();
    const actual = await identity();
    const { resolve } = await import('node:path');
    if (actual.cwd !== owner.cwd || actual.pin !== owner.pin || resolve(projectRoot) !== owner.cwd)
      throw new Error('HTTP server context conflicts with configured native owner');
    await close();
    serverIdentity = actual;
    serverMode = true;
    return owner;
  };
  return { configured, identity, binding, call, close, openInventoryReader, enterServerMode, attachServer, releaseSession,
    policyEvaluator, policyContext, tryForward };
}
