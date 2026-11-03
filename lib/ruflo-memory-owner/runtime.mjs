// Serialized into the native CLI module. Storage, authorization and transport
// remain the installed Ruflo handlers and MCP SDK; this is explicit routing only.
// Completed HTTP client lifecycle gap: https://github.com/ruvnet/ruflo/issues/4674
export async function createMemoryOwnerClient(moduleUrl) {
  const { existsSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const defaultConfig = join(homedir(), '.config', 'ruflo', 'memory-owners.json');
  const configFile = () => process.env.RUFLO_MEMORY_OWNER_CONFIG ?? defaultConfig;
  const sessions = new Map();
  const releasedClients = new Set();
  let nativeServer;
  let shuttingDown = false;
  let serverMode = false, serverIdentity;
  const capability = 'ruflo/native-memory-owner';
  const releaseNotification = 'notifications/ruflo/memory-owner-release';
  const configured = () => !serverMode && (process.env.RUFLO_MEMORY_OWNER_CONFIG !== undefined || existsSync(defaultConfig));
  const decode = response => {
    if (response.isError) throw new Error('Native memory owner refused: ' +
      response.content?.filter(row => row.type === 'text').map(row => row.text).join('\n'));
    return response.structuredContent ?? JSON.parse(response.content.find(row => row.type === 'text')?.text);
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
  async function connect(owner) {
    const { randomUUID } = await import('node:crypto');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const clientId = 'ruflo-native-owner-client:' + randomUUID();
    const client = new Client({ name: clientId, version: '1.0.0' }, { capabilities: {} });
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
        fetch: (url, init) => fetch(url, { ...init, redirect: 'error',
          signal: init?.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal }),
      });
      await client.connect(transport, request);
      const tools = await client.listTools({}, request);
      const experimental = client.getServerCapabilities()?.experimental;
      const advertised = experimental && Object.hasOwn(experimental, capability);
      let actual;
      if (advertised) {
        actual = experimental[capability];
        if (!actual || actual.releaseNotification !== releaseNotification)
          throw new Error('Invalid native owner protocol capability; nothing dispatched');
        connection.releaseCapable = true;
        connection.protocolRelease = true;
      } else {
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
    // Retain its native session until expiry; never release on an uncertain write.
    if (connection.pending) connection.uncertain = true;
    try {
      if (!connection.uncertain && connection.releaseCapable) {
        if (connection.protocolRelease) {
          // SDK notifications have no request timeout; bound their actual fetch.
          const timer = setTimeout(() => connection.abort.abort(new Error('Native owner retirement timed out')), 5000);
          try { await connection.client.notification({ method: releaseNotification,
            params: { clientId: connection.clientId } }); }
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
  async function call(name, options = {}, context = {}, canonical = false) {
    if (shuttingDown) throw new Error('Native owner client is shutting down; nothing dispatched');
    if (context.signal?.aborted) throw context.signal.reason || new Error('Owner request cancelled');
    const { resolve } = await import('node:path');
    const here = await identity();
    if (context.transport === 'stdio' && options.dbPath !== undefined) {
      if (here.pin !== null && resolve(options.dbPath) !== here.pin)
        throw new Error('Explicit database path conflicts with configured MCP client authority');
    }
    const graph = ['agentdb_graph-query', 'agentdb_graph-pathfinder'].includes(name);
    const scoped = graph || (name.startsWith('memory_') && !['memory_owner_identity', 'memory_index_status', 'memory_generate_embedding'].includes(name));
    if (options.dbPath === undefined && here.pin !== null && scoped)
      options = { ...options, dbPath: here.pin };
    const owner = await binding(options.dbPath);
    // Preserve a stdio caller's session across its successive remote calls.
    // Standalone CLI operations have no persistent session and close afterward.
    const key = context.sessionId ? JSON.stringify([context.sessionId, owner.url.href,
      owner.cwd, owner.pin, owner.token]) : null;
    if (key && !sessions.has(key)) sessions.set(key, connect(owner));
    const selected = key ? sessions.get(key) : connect(owner);
    let connection, counted = false, dispatched = false, received = false;
    try {
      connection = await selected;
      if (shuttingDown || connection.closing || connection.retired)
        throw new Error('Native owner connection is closing; nothing dispatched');
      connection.pending++;
      counted = true;
      const { client, tools } = connection;
      const schema = tools.find(tool => tool.name === name)?.inputSchema?.properties;
      if (!schema) throw new Error('Native owner does not advertise the requested operation');
      if (graph && options.dbPath !== undefined && !Object.hasOwn(schema, 'dbPath'))
        throw new Error('Native owner lacks explicit retained graph authority; nothing dispatched');
      if (canonical) {
        const required = name === 'memory_store'
          ? ['nativeResult', 'requireNative', 'appendOnly', 'appendConditions', 'generateEmbeddingFlag'] : ['nativeResult'];
        if (required.some(field => !Object.hasOwn(schema, field)))
          throw new Error('Native owner lacks canonical operation controls; nothing dispatched');
      }
      const args = { ...options, ...(canonical ? { nativeResult: true } : {}) };
      if (args.dbPath !== undefined) args.dbPath = resolve(args.dbPath);
      if ('provenanceType' in args) { args.provenance_type = args.provenanceType; delete args.provenanceType; }
      if (name === 'memory_search' && 'provenanceFilter' in args) {
        args.provenance_filter = args.provenanceFilter; delete args.provenanceFilter;
      }
      // Dispatch once. Unknown write outcomes remain errors; neither reconnect
      // nor a local database open is an admissible retry.
      dispatched = true;
      const response = await client.callTool({ name, arguments: args }, undefined,
        { signal: context.signal, timeout: owner.requestTimeoutMs ?? 180_000 });
      received = true;
      const result = decode(response);
      if (canonical && (!result || typeof result.success !== 'boolean'))
        throw new Error('Native owner returned an invalid canonical result');
      return result;
    } catch (error) {
      if (key && sessions.get(key) === selected) sessions.delete(key);
      if (connection) {
        connection.closing = true;
        if (dispatched && !received) connection.uncertain = true;
      }
      throw error;
    } finally {
      if (connection) {
        if (counted) connection.pending--;
        if (!key || connection.closing) await retire(connection);
      }
    }
  }
  const policyBatches = new Map();
  const policyEvaluator = (context, toolName) => serverMode && context?.transport === 'http'
    && toolName.startsWith('memory_')
    ? (request, projectRoot) => new Promise((resolve, reject) => {
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
                engine => waiting.map(item => engine.evaluate(item.request)));
              waiting.forEach((item, index) => item.resolve(decisions[index]));
            } catch (error) { waiting.forEach(item => item.reject(error)); }
            if (batch.requests.length) await new Promise(resolve => setImmediate(resolve));
          }
          policyBatches.delete(projectRoot);
        };
        batch.timer = setTimeout(batch.flush, 5);
      }
      batch.requests.push({ request, resolve, reject });
      if (batch.requests.length === 32) void batch.flush();
    }) : undefined;
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
      // The qualified native initializer has no await before installing its new
      // current session. Keep retirement and that handover in one JS turn.
      if (request.params) {
        for (const session of server.getSessions())
          if (releasedClients.has(session.clientInfo?.name)) server.terminateSession(session.id);
        releasedClients.clear();
      }
      return Promise.resolve(initialize(request)).then(response => response.result ? {
        ...response, result: { ...response.result, capabilities: { ...response.result.capabilities,
          experimental: { ...response.result.capabilities?.experimental,
            [capability]: { ...serverIdentity, releaseNotification } } } },
      } : response);
    };
    const notify = server.handleNotification.bind(server);
    server.handleNotification = notification => notification.method === releaseNotification
      ? releaseSession(notification.params?.clientId) : notify(notification);
  };
  const releaseSession = clientId => {
    if (!nativeServer || typeof clientId !== 'string'
        || !/^ruflo-native-owner-client:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clientId))
      throw new Error('Invalid native owner client retirement');
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
  return { configured, identity, binding, call, close, enterServerMode, attachServer, releaseSession, policyEvaluator };
}
