// source-patch#12: discovery must describe the authenticated executing owner.
// Serialized with the client. No filter translation, store access or new driver.
export function createOwnerInventoryContract({ configured, eligible, identity, binding, connect, retire }) {
  const names = new Set(['agentdb_hierarchical-list', 'agentdb_hierarchical-get']);
  const advertised = new Map();
  const canonical = value => JSON.stringify(value, function (_key, item) {
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
  });
  const authority = owner => canonical([owner.cwd, owner.pin, owner.url.href, owner.token]);
  const contract = tool => tool ? canonical({ description: tool.description, inputSchema: tool.inputSchema }) : null;
  const fail = () => { throw new Error('Native inventory owner contract changed; refresh client discovery before dispatch'); };
  function verify(name, tools, owner, dispatch = true) {
    const previous = advertised.get(name);
    if (previous && (previous.authority !== authority(owner)
        || previous.contract !== contract(tools.find(tool => tool.name === name)))) fail();
    if (dispatch && previous?.contract === null) throw new Error('Native owner does not advertise the requested inventory operation');
  }
  async function project(tools) {
    if (!configured() || !eligible() || !tools.some(tool => names.has(tool.name))) return tools;
    const here = await identity(), owner = await binding();
    // Use the same scope requirement as ordinary owner forwarding. No schema
    // from a different configured project or explicit-store binding may leak in.
    if (here.cwd !== owner.cwd || here.pin !== owner.pin)
      throw new Error('Inventory discovery conflicts with configured native owner authority');
    let connection;
    try {
      connection = await connect(owner, true, true);
      const next = new Map();
      for (const tool of tools.filter(tool => names.has(tool.name))) {
        verify(tool.name, connection.tools, owner, false);
        const matches = connection.tools.filter(item => item.name === tool.name);
        if (matches.length > 1 || matches.some(item => typeof item.description !== 'string'
            || item.inputSchema?.type !== 'object' || !item.inputSchema.properties))
          throw new Error('Invalid native owner inventory metadata');
        next.set(tool.name, matches[0]);
      }
      for (const [name, tool] of next)
        advertised.set(name, { authority: authority(owner), contract: contract(tool) });
      return tools.flatMap(tool => !names.has(tool.name) ? [tool] : next.get(tool.name)
        ? [{ ...tool, description: next.get(tool.name).description,
          inputSchema: structuredClone(next.get(tool.name).inputSchema) }] : []);
    } finally { if (connection) await retire(connection); }
  }
  return { project, verify };
}
