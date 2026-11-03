// Preserve retained-graph role selection per call while one native owner keeps
// the project's implicit AgentDB controllers. getBridgeDb already owns paths.
const field = "            dbPath: { type: 'string', description: 'Explicit retained graph store; native controller defaults remain unchanged.' },\n";
const validate = `            // ruflo-source-patch (ruflo#4654): explicit retained graph authority.
            const { resolve } = await import('node:path');
            if (params.dbPath !== undefined && (typeof params.dbPath !== 'string' || !params.dbPath.trim()))
                throw new Error('Explicit retained graph path must be a non-empty string');
            const graphDbPath = params.dbPath === undefined ? undefined : resolve(params.dbPath);
            const configuredGraph = process.env.CLAUDE_FLOW_DB_PATH?.trim();
            if (configuredGraph && graphDbPath !== undefined && graphDbPath !== resolve(configuredGraph))
                throw new Error('Explicit retained graph path conflicts with configured MCP store');
`;
export function graphEdits(source) {
  return ['agentdbGraphQuery', 'agentdbGraphPathfinder'].map(symbol => {
    const begin = source.indexOf(`export const ${symbol} = {`);
    const end = source.indexOf('\n};', begin);
    if (begin < 0 || end < 0) throw new Error('Missing native graph tool ' + symbol);
    const current = source.slice(begin, end + 3);
    const from = current.replace(field, '').replace(validate, '')
      .replaceAll('getBridgeDb(graphDbPath)', 'getBridgeDb()')
      .replaceAll('getBridgeDb(graphDbPath,', 'getBridgeDb(undefined,')
      .replaceAll('isBridgeDbEncryptedAtRest(graphDbPath)', 'isBridgeDbEncryptedAtRest()');
    if (!from.includes('        properties: {') || !from.includes('        try {\n')
        || !from.includes('getBridgeDb(')) throw new Error('Native graph path anchors drifted');
    const to = from.replace('        properties: {\n', '        properties: {\n' + field)
      .replace('        try {\n', '        try {\n' + validate)
      .replaceAll('getBridgeDb()', 'getBridgeDb(graphDbPath)')
      .replaceAll('getBridgeDb(undefined,', 'getBridgeDb(graphDbPath,')
      .replaceAll('isBridgeDbEncryptedAtRest()', 'isBridgeDbEncryptedAtRest(graphDbPath)');
    return [from, to];
  });
}
