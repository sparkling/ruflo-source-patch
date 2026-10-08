// #3147/#3097 + Ruflo #3570: one safe ADR edge identity across every transport.
// The shared helper owns both importer writes and verifier reads. Do not relax
// Ruflo's memory-key guard to accommodate the plugin's former arrow separator.
export const EDGE_MARKER = 'ruflo-source-patch ADR edge identity (#3147/#3097/#3570)';

export const EDGE_HELPER_ANCHOR = `export function edgeKey(edge) {
  return \`\${edge.relation}:\${edge.from}->\${edge.to}\`;
}`;

export const EDGE_PARSE_ANCHOR = String.raw`export function parseEdgeKey(key) {
  const match = /^([\w-]+):([^:]+)->([^:]+?)(?::\d+-[a-z0-9]+)?$/i.exec(key);
  if (!match) return null;
  return { relation: match[1], from: match[2], to: match[3], key };
}`;

export const EDGE_HELPER_054 = `export function edgeKey(edge) {
  // '->' is rejected by the memory key validator ('>' is in DANGEROUS_KEY_PATTERN).
  return \`\${edge.relation}:\${edge.from}__\${edge.to}\`;
}`;
export const EDGE_PARSE_054 = String.raw`export function parseEdgeKey(key) {
  const match = /^([\w-]+):([^:]+?)(?:->|__)([^:]+?)(?::\d+-[a-z0-9]+)?$/i.exec(key);
  if (!match) return null;
  return { relation: match[1], from: match[2], to: match[3], key };
}`;

export const EDGE_HELPER_REPLACEMENT = `// ${EDGE_MARKER}
const edgeAtom = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,255}$/;
function validEdge(edge) {
  return edge && ['relation', 'from', 'to'].every((field) =>
    typeof edge[field] === 'string' && edge[field].trim() === edge[field] && edgeAtom.test(edge[field]));
}
export function edgeKey(edge) {
  if (!validEdge(edge)) throw new Error('Invalid ADR edge identity');
  return [edge.relation, edge.from, edge.to].join(':');
}`;

export const EDGE_PARSE_REPLACEMENT = String.raw`export function parseEdgeKey(key) {
  if (typeof key !== 'string' || key.length > 1024 || key.trim() !== key) return null;
  // Canonical memory-safe triple; read legacy arrow/timestamp keys unchanged.
  let match = /^([\w.-]+):([\w.-]+):([\w.-]+)$/.exec(key);
  if (!match) match = /^([\w.-]+):([\w.-]+?)__([\w.-]+)$/.exec(key);
  if (!match) match = /^([\w-]+):([^:]+)->([^:]+?)(?::\d+-[a-z0-9]+)?$/i.exec(key);
  // Historical MCP-safe BA keys use numeric ADR IDs; anchored boundaries make
  // this compatibility shape unambiguous. Unknown formats remain fatal.
  if (!match) match = /^(depends-on|supersedes|amends|related)-(ADR-\d+)-to-(ADR-\d+)$/.exec(key);
  if (!match) return null;
  const parsed = { relation: match[1], from: match[2], to: match[3], key };
  return validEdge(parsed) ? parsed : null;
}`;

function replaceOne(source, find, replacement, id, applied, missing) {
  if (source.includes(replacement)) return source;
  const count = source.split(find).length - 1;
  if (count !== 1) { missing.push(id + (count > 1 ? '(AMBIGUOUS)' : '')); return source; }
  applied.push(id);
  return source.replace(find, replacement);
}

export function patchEdgeHelpers(source) {
  const applied = [], missing = [];
  const helper = source.includes(EDGE_HELPER_054) ? EDGE_HELPER_054 : EDGE_HELPER_ANCHOR;
  const parser = source.includes(EDGE_PARSE_054) ? EDGE_PARSE_054 : EDGE_PARSE_ANCHOR;
  let next = replaceOne(source, helper, EDGE_HELPER_REPLACEMENT,
    'memory-safe-edge-key', applied, missing);
  next = replaceOne(next, parser, EDGE_PARSE_REPLACEMENT,
    'compatible-edge-key-parser', applied, missing);
  return { next, applied, missing };
}

export const edgeHelpersPatched = (source) => source.includes(EDGE_HELPER_REPLACEMENT)
  && source.includes(EDGE_PARSE_REPLACEMENT);

// An accepted legacy key alone must not certify a conflicting or empty value.
// Read the full value through the installed managed CLI, never a truncated list.
export const VERIFIED_EDGE_REPLACEMENT = `  const parsed = parseEdgeKey(k);
  if (!parsed) {
    console.error('ADR graph verification FAILED: malformed adr-edges key: ' + k);
    process.exit(1);
  }
  // ${EDGE_MARKER}: require persisted semantic identity to match the key.
  const read = runMemory(['retrieve', '--namespace', 'adr-edges', '--key', k, '--value-only'], false);
  let value;
  try {
    if (!read.ok) throw new Error(read.error);
    value = JSON.parse(read.stdout);
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !['relation', 'from', 'to'].every((field) => value[field] === parsed[field])) {
      throw new Error('edge value does not match key identity');
    }
  } catch (error) {
    console.error('ADR graph verification FAILED: invalid adr-edges value: ' + k + ': ' + error.message);
    process.exit(1);
  }
  edges.push(parsed);`;
