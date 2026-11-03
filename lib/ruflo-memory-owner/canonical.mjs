// Expose existing native operation contracts without changing their storage or
// append predicates. Existing presentation remains the default for MCP callers.
const calls = [
  ["                const result = await deleteEntry({ key, namespace, dbPath });", 'deleteEntry'],
  ["                const result = await getEntry({ key, namespace, dbPath });", 'getEntry'],
  [`                const result = await storeEntry({
                    key,
                    value,
                    namespace,
                    generateEmbeddingFlag: true,
                    tags,
                    ttl,
                    upsert,
                    provenanceType,
                    dbPath,
                });`, 'storeEntry'],
  [`                const result = await searchEntries({
                    query,
                    namespace,
                    limit,
                    threshold,
                    provenanceFilter,
                    dbPath,
                });`, 'searchEntries'],
  [`                const result = await listEntries({
                    namespace,
                    tags,
                    limit,
                    offset,
                    dbPath,
                });`, 'listEntries'],
];
export const canonicalEdits = [
  ['export const memoryTools = [', `function rspCanonicalMemoryOptions(input, dbPath) {
    const { nativeResult, provenance_type, provenance_filter, ...options } = input;
    return { ...options, dbPath, provenanceType: provenance_type,
        provenanceFilter: provenance_filter ?? options.provenanceFilter };
}
export const memoryTools = [`],
  ...calls.map(([source, fn]) => {
    let presented = source;
    if (fn === 'storeEntry') presented = presented.replace('                    generateEmbeddingFlag: true,',
      `                    generateEmbeddingFlag: input.generateEmbeddingFlag !== false,
                    requireNative: input.requireNative === true,
                    appendOnly: input.appendOnly === true,
                    appendConditions: input.appendConditions,
                    encryptWrites: input.encryptWrites,`);
    if (fn === 'listEntries') presented = presented.replace('                    dbPath,',
      `                    dbPath,
                    encryptWrites: input.encryptWrites,
                    includeContent: input.includeContent,
                    includeEmbedding: input.includeEmbedding,
                    includeExpired: input.includeExpired,
                    provenanceFilter: input.provenanceFilter,`);
    if (fn === 'deleteEntry') presented = presented.replace('namespace, dbPath }',
      'namespace, dbPath, encryptWrites: input.encryptWrites }');
    return [source,
      presented.replace(`${fn}({`, `${fn}(input.nativeResult === true ? rspCanonicalMemoryOptions(input, dbPath) : {`)
        + '\n                if (input.nativeResult === true) return result;'];
  }),
];
const property = "                dbPath: { type: 'string', description: 'Explicit SQLite store to read/write; omit to use the MCP default (the native/AgentDB sibling).' },";
export function canonicalSchemaEdits(source) {
  return ['memory_store', 'memory_retrieve', 'memory_list', 'memory_search', 'memory_delete'].map(name => {
    const start = source.indexOf(`        name: '${name}',`);
    const end = source.indexOf('        handler: async (input)', start);
    if (start < 0 || end < 0) throw new Error(`Missing native schema: ${name}`);
    let schema = source.slice(start, end);
    if (schema.split(property).length !== 2) throw new Error(`Ambiguous native path schema: ${name}`);
    const fields = ["                nativeResult: { type: 'boolean', description: 'Return the canonical native operation result.' },"];
    fields.push("                encryptWrites: { type: 'boolean' },");
    if (name === 'memory_store') fields.push(
      "                requireNative: { type: 'boolean' }, appendOnly: { type: 'boolean' },",
      "                appendConditions: { type: 'array', items: { type: 'object' } },",
      "                generateEmbeddingFlag: { type: 'boolean' },");
    if (name === 'memory_list') fields.push(
      "                includeContent: { type: 'boolean' }, includeEmbedding: { type: 'boolean' }, includeExpired: { type: 'boolean' },",
      "                provenanceFilter: { type: 'array', items: { type: 'string' } },");
    const addition = property + '\n' + fields.join('\n');
    schema = schema.replace(addition, property);
    return [schema, schema.replace(property, addition)];
  });
}
