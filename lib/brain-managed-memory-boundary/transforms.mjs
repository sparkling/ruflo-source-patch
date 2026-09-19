// Exact source transforms for stuinfla/ruvnet-brain#102 and #103.
// The existing structural shell parser remains upstream-owned; this target only wires a managed-
// store decision into the existing hook and exposes one bounded diagnostic through the MCP shell.

export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#102/#103)';

const HIJACK_INPUT = `HOOK_INPUT="$(dirname "$0")/hook-input.mjs"
PAYLOAD=$(printf '%s' "$INPUT" | "$NODE_BIN" "$HOOK_INPUT" payload 2>/dev/null)`;

const HIJACK_GATE = `HOOK_INPUT="$(dirname "$0")/hook-input.mjs"
# ${PATCH_MARKER}: enforce the managed AgentDB boundary before generic advisory matching.
MANAGED_MEMORY_GATE="$(dirname "$0")/managed-memory-gate.mjs"
MANAGED_MEMORY_DECISION=$(printf '%s' "$INPUT" | "$NODE_BIN" "$MANAGED_MEMORY_GATE" 2>/dev/null)
if [ -n "$MANAGED_MEMORY_DECISION" ]; then
  printf '%s' "$MANAGED_MEMORY_DECISION"
  exit 0
fi
# Retrieval may be off; the managed-store boundary may not. Suppress only generic guidance.
[ "\${RUVNET_BRAIN_OFF:-0}" = "1" ] && exit 0
PAYLOAD=$(printf '%s' "$INPUT" | "$NODE_BIN" "$HOOK_INPUT" payload 2>/dev/null)`;

const CATEGORY_FOUR = `# Category 4 — agent memory glue
if printf '%s' "$PAYLOAD" | grep -qiE 'redis[^\\n]*(memory|embedding)|sqlite[^\\n]*(memory|vector)|mem0|zep[- ]memory'; then
  add "For durable agent memory use AgentDB (causal, explainable, 'why did I recall that?') rather than hand-rolled Redis/SQLite glue."
fi
`;

const SHIM_ENTRY = `  'hijack-ruvnet':    { file: 'hijack-ruvnet.sh',    interpreter: 'bash', mode: 'advisory', offBehavior: 'silence' },`;
const SHIM_PATCHED = `  // ${PATCH_MARKER}: retrieval-off still preserves the managed AgentDB boundary.
  'hijack-ruvnet':    { file: 'hijack-ruvnet.sh',    interpreter: 'bash', mode: 'advisory', offBehavior: 'partial' },`;
const NATIVE_SHIM_ENTRY = `  'hijack-ruvnet':    { file: 'hijack-ruvnet.sh',    interpreter: 'bash', mode: 'blocking', offBehavior: 'silence' },`;
const NATIVE_SHIM_PATCHED = `  // ${PATCH_MARKER}: Brain-off still preserves the explicitly installed managed-store boundary.
  'hijack-ruvnet':    { file: 'hijack-ruvnet.sh',    interpreter: 'bash', mode: 'blocking', offBehavior: 'partial' },`;

const MCP_IMPORT = `import { callManagedCli, MANAGED_CLI_TOOLS } from './managed-cli-interface.mjs';`;
const MCP_IMPORT_PATCHED = `${MCP_IMPORT}
// ${PATCH_MARKER}: one audited, content-free exception to the raw managed-store refusal.
import {
  callManagedMemoryDiagnostic, MANAGED_MEMORY_DIAGNOSTIC_TOOL,
} from './managed-memory-diagnostic.mjs';`;
const MCP_TOOLS = `const FALLBACK_TOOLS = [SEARCH_TOOL, ...MANAGED_CLI_TOOLS];`;
const MCP_TOOLS_PATCHED = `const FALLBACK_TOOLS = [SEARCH_TOOL, MANAGED_MEMORY_DIAGNOSTIC_TOOL, ...MANAGED_CLI_TOOLS];`;
const MCP_DISPATCH = `      if (params?.name === 'ruvnet_cli_help' || params?.name === 'ruvnet_cli_run') {
        return clientOk(id, await callManagedCli(params.name, params.arguments || {}));
      }
      if (params?.name !== 'search_ruvnet') return clientErr(id, -32602, \`unknown tool: \${params?.name}\`);`;
const MCP_DISPATCH_PATCHED = `      if (params?.name === 'ruvnet_cli_help' || params?.name === 'ruvnet_cli_run') {
        return clientOk(id, await callManagedCli(params.name, params.arguments || {}));
      }
      if (params?.name === MANAGED_MEMORY_DIAGNOSTIC_TOOL.name) {
        return clientOk(id, await callManagedMemoryDiagnostic(params.arguments || {}));
      }
      if (params?.name !== 'search_ruvnet') return clientErr(id, -32602, \`unknown tool: \${params?.name}\`);`;
// Brain 4.3.10 added registry currency lookup to the same dispatch. Preserve
// that native route byte-for-byte while inserting only the diagnostic branch.
const MCP_DISPATCH_4310 = `      if (params?.name === 'ruvnet_cli_help' || params?.name === 'ruvnet_cli_run'
        || params?.name === 'ruvnet_registry_latest') {
        return clientOk(id, await callManagedCli(params.name, params.arguments || {}));
      }
      if (params?.name !== 'search_ruvnet') return clientErr(id, -32602, \`unknown tool: \${params?.name}\`);`;
const MCP_DISPATCH_PATCHED_4310 = MCP_DISPATCH_4310.replace(
  "      if (params?.name !== 'search_ruvnet')",
  `      if (params?.name === MANAGED_MEMORY_DIAGNOSTIC_TOOL.name) {
        return clientOk(id, await callManagedMemoryDiagnostic(params.arguments || {}));
      }
      if (params?.name !== 'search_ruvnet')`);

const count = (source, needle) => source.split(needle).length - 1;
function edit(source, id, find, replace) {
  const occurrences = count(source, find);
  if (occurrences !== 1) {
    return { source, applied: [], missing: [occurrences > 1 ? `${id}(AMBIGUOUS:${occurrences})` : id] };
  }
  return { source: source.replace(find, replace), applied: [id], missing: [] };
}

function edits(source, definitions) {
  let next = source;
  const applied = [];
  const missing = [];
  for (const definition of definitions) {
    const result = edit(next, ...definition);
    next = result.source;
    applied.push(...result.applied);
    missing.push(...result.missing);
  }
  return { next, applied, missing };
}

export function patchHijack(source) {
  const gated = edit(source, 'managed-gate', HIJACK_INPUT, HIJACK_GATE);
  if (gated.missing.length) return gated;
  if (count(gated.source, CATEGORY_FOUR) === 1) {
    const legacy = edit(gated.source, 'remove-flat-category-four', CATEGORY_FOUR, '');
    return { next: legacy.source, applied: [...gated.applied, ...legacy.applied], missing: legacy.missing };
  }
  const nativeDetector = gated.source.includes("_direct_managed_access=0")
    && gated.source.includes("_cmd_pos='(^|[;&|(]|&&|\\|\\||[[:space:]]-c[[:space:]]|`|\\$\\()[[:space:]]*'")
    && gated.source.includes('--managed-memory-boundary')
    && gated.source.includes('exit 2');
  return nativeDetector
    ? { next: gated.source, applied: gated.applied, missing: [] }
    : { next: source, applied: [], missing: ['native-structural-detector'] };
}

export function patchShim(source) {
  if (count(source, SHIM_ENTRY) === 1) return edits(source, [['off-contract', SHIM_ENTRY, SHIM_PATCHED]]);
  return edits(source, [['off-contract', NATIVE_SHIM_ENTRY, NATIVE_SHIM_PATCHED]]);
}

export function patchMcp(source) {
  const current = count(source, MCP_DISPATCH_4310) === 1;
  return edits(source, [
    ['diagnostic-import', MCP_IMPORT, MCP_IMPORT_PATCHED],
    ['diagnostic-list', MCP_TOOLS, MCP_TOOLS_PATCHED],
    ['diagnostic-dispatch', current ? MCP_DISPATCH_4310 : MCP_DISPATCH,
      current ? MCP_DISPATCH_PATCHED_4310 : MCP_DISPATCH_PATCHED],
  ]);
}

export const VENDOR_SPECS = Object.freeze([
  { id: 'hijack', relative: 'scripts/hijack-ruvnet.sh', patch: patchHijack, edits: [1, 2] },
  { id: 'shim', relative: 'scripts/hook-shim.mjs', patch: patchShim, edits: 1 },
  { id: 'mcp', relative: 'mcp/server.mjs', patch: patchMcp, edits: 3 },
]);

export const isPatched = (id, source) => {
  if (!source.includes(PATCH_MARKER)) return false;
  if (id === 'hijack') {
    return source.includes('managed-memory-gate.mjs')
      && source.includes('RUVNET_BRAIN_OFF:-0')
      && (!source.includes('# Category 4 — agent memory glue')
        || (source.includes('_direct_managed_access=0')
          && source.includes('--managed-memory-boundary') && source.includes('exit 2')));
  }
  if (id === 'shim') return source.includes("'hijack-ruvnet':") && source.includes("offBehavior: 'partial'");
  if (id === 'mcp') {
    return source.includes('MANAGED_MEMORY_DIAGNOSTIC_TOOL')
      && source.includes('callManagedMemoryDiagnostic(params.arguments || {})');
  }
  return false;
};

// Minimal upstream-shaped sources for portable patch-engine tests.
export const fixtureSources = () => ({
  hijack: `#!/bin/sh
INPUT=$(cat)
NODE_BIN=$(command -v node 2>/dev/null)
${HIJACK_INPUT}
[ -z "$PAYLOAD" ] && exit 0
MSG=""
add() { MSG="\${MSG}\${MSG:+ }$1"; }
if printf '%s' "$PAYLOAD" | grep -qiE 'pinecone'; then add "Use RuVector."; fi
${CATEGORY_FOUR}
[ -z "$MSG" ] && exit 0
"$NODE_BIN" "$HOOK_INPUT" emit defer "$MSG"
`,
  shim: `const TABLE = {
${SHIM_ENTRY}
};
`,
  nativeHijack: `#!/bin/sh
INPUT=$(cat)
NODE_BIN=$(command -v node 2>/dev/null)
${HIJACK_INPUT}
_managed_store='(\\.swarm/|agentdb|memory\\.db|ruvnet-brain.*\\.db)'
_cmd_pos='(^|[;&|(]|&&|\\|\\||[[:space:]]-c[[:space:]]|\`|\\$\\()[[:space:]]*'
_direct_managed_access=0
if printf '%s' "$PAYLOAD" | grep -qiE "\${_cmd_pos}(sqlite3?|redis-cli)([[:space:]]|$).*\${_managed_store}"; then
  _direct_managed_access=1
fi
# Category 4 — agent memory glue
if [ "$_direct_managed_access" = "1" ]; then
  _boundary=$("$NODE_BIN" "$(dirname "$0")/runtime-preferences.mjs" --managed-memory-boundary 2>/dev/null) || _boundary="advise"
  if [ "$_boundary" = "block" ]; then exit 2; fi
fi
`,
  nativeShim: `const TABLE = {
${NATIVE_SHIM_ENTRY}
};
`,
  mcp: `${MCP_IMPORT}
const SEARCH_TOOL = { name: 'search_ruvnet' };
${MCP_TOOLS}
async function handleClient(params, id) {
  const clientOk = (a, b) => ({ a, b });
  const clientErr = (a, b, c) => ({ a, b, c });
${MCP_DISPATCH}
}
`,
  mcp4310: `${MCP_IMPORT}
const SEARCH_TOOL = { name: 'search_ruvnet' };
${MCP_TOOLS}
async function handleClient(params, id) {
  const clientOk = (a, b) => ({ a, b });
  const clientErr = (a, b, c) => ({ a, b, c });
${MCP_DISPATCH_4310}
}
`,
});
