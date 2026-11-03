// Serialized into the native CLI module. Storage, authorization and transport
// remain the installed Ruflo handlers and MCP SDK; this is explicit routing only.
export async function createMemoryOwnerClient(moduleUrl) {
  const { existsSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const defaultConfig = join(homedir(), '.config', 'ruflo', 'memory-owners.json');
  const configFile = () => process.env.RUFLO_MEMORY_OWNER_CONFIG ?? defaultConfig;
  const sessions = new Map();
  let serverMode = false;
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
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'ruflo-native-owner-client', version: '1.0.0' }, { capabilities: {} });
    const abort = new AbortController();
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
      if (!tools.tools.some(tool => tool.name === 'memory_owner_identity'))
        throw new Error('Owner identity capability is absent; nothing dispatched');
      const actual = decode(await client.callTool({ name: 'memory_owner_identity', arguments: {} }, undefined, request));
      if (actual?.protocol !== 1 || actual.cwd !== owner.cwd || actual.pin !== owner.pin)
        throw new Error('Native owner identity does not match configured authority; nothing dispatched');
      return { client, tools: tools.tools };
    } catch (error) {
      await client.close();
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function call(name, options = {}, context = {}, canonical = false) {
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
    let connection;
    try {
      connection = await (key ? sessions.get(key) : connect(owner));
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
      const result = decode(await client.callTool({ name, arguments: args }, undefined,
        { signal: context.signal, timeout: owner.requestTimeoutMs ?? 180_000 }));
      if (canonical && (!result || typeof result.success !== 'boolean'))
        throw new Error('Native owner returned an invalid canonical result');
      return result;
    } catch (error) {
      if (key) sessions.delete(key);
      await connection?.client.close();
      throw error;
    } finally {
      if (!key) await connection?.client.close();
    }
  }
  const close = async () => {
    const current = [...sessions.values()]; sessions.clear();
    await Promise.allSettled(current.map(async pending => (await pending).client.close()));
  };
  const enterServerMode = async projectRoot => {
    const owner = await binding();
    const actual = await identity();
    const { resolve } = await import('node:path');
    if (actual.cwd !== owner.cwd || actual.pin !== owner.pin || resolve(projectRoot) !== owner.cwd)
      throw new Error('HTTP server context conflicts with configured native owner');
    await close();
    serverMode = true;
    return owner;
  };
  return { configured, identity, binding, call, close, enterServerMode };
}
