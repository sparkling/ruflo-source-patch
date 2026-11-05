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
  ...canonicalCalls(true),
];
// Released through 4.46.151: the store branch forwarded the raw MCP value. An
// object then reached the native SQLite binding and failed before any write.
export const priorCanonicalEdits = [canonicalEdits[0], ...canonicalCalls(false)];
function canonicalCalls(normalizedValue) {
  return calls.map(([source, fn]) => {
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
    // Native validation runs on the handler's string value; forward exactly that.
    const options = fn === 'storeEntry' && normalizedValue
      ? '{ ...rspCanonicalMemoryOptions(input, dbPath), value }' : 'rspCanonicalMemoryOptions(input, dbPath)';
    return [source,
      presented.replace(`${fn}({`, `${fn}(input.nativeResult === true ? ${options} : {`)
        + '\n                if (input.nativeResult === true) return result;'];
  });
}
const property = "                dbPath: { type: 'string', description: 'Explicit SQLite store to read/write; omit to use the MCP default (the native/AgentDB sibling).' },";
export function canonicalSchemaEdits(source) {
  return ['memory_store', 'memory_retrieve', 'memory_list', 'memory_search', 'memory_delete'].map(name => {
    const start = source.indexOf(`        name: '${name}',`);
    const nextTool = source.indexOf("        name: '", start + 1);
    const ends = ['        handler: async (input) => {', '        handler: async (input, context) => {']
      .map(anchor => source.indexOf(anchor, start)).filter(index => index >= 0 && (nextTool < 0 || index < nextTool));
    if (start < 0 || ends.length !== 1) throw new Error(`Missing or ambiguous native schema: ${name}`);
    const end = ends[0];
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
