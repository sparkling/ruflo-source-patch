import fs from 'node:fs';
import path from 'node:path';
import { createMemoryOwnerClient } from './runtime.mjs';
import { createOwnerPolicyProtocol } from './policy.mjs';
import { policyDiagnostic } from './policy-diagnostics.mjs';
import { canonicalEdits, canonicalSchemaEdits } from './canonical.mjs';
import { graphEdits } from './graph.mjs';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
export const NAME = 'ruflo-memory-owner';
export const PATCH_MARKER = 'ruflo-source-patch (ruflo#4654): native owner forwarding';
const runtime = `// ${PATCH_MARKER}\n${createOwnerPolicyProtocol.toString()}\n${createMemoryOwnerClient.toString()}\nexport const rspMemoryOwner = await createMemoryOwnerClient(import.meta.url);\n`;
const release117 = JSON.parse(fs.readFileSync(new URL('./released-4.46.117.json', import.meta.url), 'utf8'));
const released = JSON.parse(fs.readFileSync(new URL('./released-4.46.107.json', import.meta.url), 'utf8'));
const identity = `    {
        name: 'memory_owner_identity',
        description: 'Read the native HTTP owner context before forwarding a memory operation.',
        category: 'memory',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => (await import('../mcp-client.js')).rspMemoryOwner.identity(),
    },
    {
        name: 'memory_owner_release',
        description: 'Schedule retirement of this completed native owner client at the next native initialization.',
        category: 'memory',
        inputSchema: { type: 'object', properties: { clientId: { type: 'string' } },
            required: ['clientId'], additionalProperties: false },
        handler: async input => (await import('../mcp-client.js')).rspMemoryOwner.releaseSession(input.clientId),
    },
    {
        name: 'memory_generate_embedding',
        description: 'Run the native public memory embedding operation and return its exact backend result.',
        category: 'memory',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } },
            required: ['text'], additionalProperties: false },
        handler: async input => (await import('../memory/memory-initializer.js')).generateEmbedding(input.text),
    },
    {
        name: 'memory_index_status',
        description: 'Read native owner embedding/index state; optionally build the native HNSW index.',
        category: 'memory',
        inputSchema: { type: 'object', properties: {
            rebuild: { type: 'boolean' }, loadEmbedding: { type: 'boolean' },
        }, additionalProperties: false },
        handler: async input => {
            const native = await import('../memory/memory-initializer.js');
            const available = input.rebuild ? !!(await native.getHNSWIndex({ forceRebuild: true })) : undefined;
            const embedding = input.loadEmbedding ? await native.loadEmbeddingModel({ verbose: false }) : undefined;
            return { available, embedding, hnsw: native.getHNSWStatus() };
        },
    },
    {
        name: 'memory_purge',
        description: 'Purge one exact namespace through the native memory operation.',
        category: 'memory',
        inputSchema: { type: 'object', properties: {
            namespace: { type: 'string' }, dbPath: { type: 'string' },
            encryptWrites: { type: 'boolean' }, nativeResult: { type: 'boolean' },
        }, required: ['namespace'] },
        handler: async input => {
            const native = await import('../memory/memory-initializer.js');
            const configured = process.env.CLAUDE_FLOW_DB_PATH?.trim();
            if (configured && input.dbPath !== undefined && native.resolveDbPath(input.dbPath) !== native.resolveDbPath(configured))
                throw new Error('Explicit database path conflicts with configured MCP store');
            return native.purgeNamespace({ ...input,
                dbPath: configured ? native.resolveDbPath(configured) : input.dbPath });
        },
    },
`;
const policyClientEdits = [[
  'const decision = await authorizeMcpTool(toolName, input, context, classifyMcpTool(toolName));',
  'const decision = await authorizeMcpTool(toolName, input, context, classifyMcpTool(toolName), rspMemoryOwner.policyEvaluator(context, toolName));',
]];
const priorPolicyRuntimeEdits = [
  ['export async function authorizeMcpTool(toolName, input, context = {}, attributes = {}) {',
    `// ${PATCH_MARKER}: preserve native request construction and individual decisions.\nexport async function authorizeMcpTool(toolName, input, context = {}, attributes = {}, evaluate = evaluatePolicyRequest) {`],
  ['    return evaluatePolicyRequest({\n        identity: resolveMcpCallerIdentity(),',
    '    return evaluate({\n        identity: resolveMcpCallerIdentity(),'],
];
const policyRuntimeEdits = [...priorPolicyRuntimeEdits,
  ['const LOCK_WAIT_MS = 5_000;',
    `// ${PATCH_MARKER}: owner-authorized temporary contention budget; mutual exclusion unchanged.\nconst LOCK_WAIT_MS = 15_000;`],
  ['export async function withPolicyTransaction(projectRoot, operation, options = {}) {',
    `// ${PATCH_MARKER}: private bounded policy timings; no values, credentials or policy changes.\n${policyDiagnostic.toString()}\nexport async function withPolicyTransaction(projectRoot, operation, options = {}) {`],
  ['    const release = await acquireLock(target.lock);\n    try {\n        reapOrphanedPolicyTemps(projectRoot);\n        const loaded = loadPolicyState(projectRoot);',
    `    const diagnostic = policyDiagnostic(projectRoot, target.lock, options.diagnostic);
    diagnostic('waiting');
    let release;
    try { release = await acquireLock(target.lock); }
    catch (error) { diagnostic('failed', error); throw error; }
    diagnostic('acquired');
    try {
        reapOrphanedPolicyTemps(projectRoot);
        const loaded = loadPolicyState(projectRoot);`],
  ['        const gate = reconcileLedger(projectRoot, engine, {});',
    "        diagnostic('state-loaded');\n        const gate = reconcileLedger(projectRoot, engine, {});\n        diagnostic('anchors-verified');"],
  ['        const result = await operation(engine);\n        const verified = engine.verifyLedger();',
    "        const result = await operation(engine);\n        diagnostic('operation-finished');\n        const verified = engine.verifyLedger();"],
  ['        const nextState = engine.exportState();\n        await writePolicyState(projectRoot, target.state, nextState, gate.event, undefined, gate.anchorTip);\n        return result;\n    }\n    finally {\n        release();',
    `        const nextState = engine.exportState();
        diagnostic('publishing');
        await writePolicyState(projectRoot, target.state, nextState, gate.event, undefined, gate.anchorTip);
        diagnostic('committed');
        return result;
    }
    catch (error) { diagnostic('failed', error); throw error; }
    finally {
        release();
        diagnostic('released');`],
  ['return withPolicyTransaction(projectRoot, (engine) => engine.evaluate(request));',
    'return withPolicyTransaction(projectRoot, (engine) => engine.evaluate(request), { diagnostic: { tool: request.action?.tool, inputDigest: request.context?.metadata?.inputDigest } });'],
];
const legacyClientEdits = [
  ['export async function callMCPTool(toolName, input = {}, context) {',
    `export async function callMCPTool(toolName, input = {}, context) {\n    if (rspMemoryOwner.configured()) return rspMemoryOwner.call(toolName, input, context);`],
];
const diagnosticPolicyRuntimeEdits = policyRuntimeEdits.filter(([from]) => from !== 'const LOCK_WAIT_MS = 5_000;');
const release117PolicyEdits = policyRuntimeEdits.map(([from, to]) => [from,
  to.replace(policyDiagnostic.toString(), release117.policyDiagnostic)]);
const release112PolicyEdits = release117PolicyEdits.filter(([from]) => from !== 'const LOCK_WAIT_MS = 5_000;');
export function nativePolicySource(source) {
  for (const changes of [policyRuntimeEdits, release117PolicyEdits, release112PolicyEdits, diagnosticPolicyRuntimeEdits, priorPolicyRuntimeEdits]) {
    if (!changes.every(([,to])=>source.split(to).length===2)) continue;
    const clean=changes.reduceRight((value,[from,to])=>value.replace(to,from),source);
    if (changes.reduce((value,[from,to])=>value.replace(from,()=>to),clean)===source) return clean;
  }
  return source;
}
const priorClientEdits = [
  ...policyClientEdits,
  ['        const result = await tool.handler(input, context);',
    '        const result = rspMemoryOwner.configured()\n            ? await rspMemoryOwner.call(toolName, input, context) : await tool.handler(input, context);'],
];
const clientEdits = [...priorClientEdits, [
  '        // ADR-324: one policy chokepoint for every local CLI/MCP invocation.',
  `        context = rspMemoryOwner.policyContext(context);
        const forwarded = await rspMemoryOwner.tryForward(toolName, input, context);
        if (forwarded.forwarded) return applyContentBoundaryGuardrail(toolName, forwarded.result);
        // ADR-324: one policy chokepoint for every local CLI/MCP invocation.`,
]];
const sessionServerEdits = [
  ['        const registration = mcpServer.registerTools(cliTools);',
    `        // ${PATCH_MARKER}: explicit native session retirement.\n        if (process.env.RUFLO_MEMORY_OWNER_SERVER === '1') owner.attachServer(mcpServer);\n        const registration = mcpServer.registerTools(cliTools);`],
  ...['stdin closed, shutting down...', 'Received SIGINT, shutting down...', 'Received SIGTERM, shutting down...']
    .map(message => [
      '(${sessionId}) ' + message + '`);\n            process.exit(0);',
      '(${sessionId}) ' + message + '`);\n            void import(\'./mcp-client.js\').then(({ rspMemoryOwner }) => rspMemoryOwner.close()).finally(() => process.exit(0));',
    ]),
];
const serverEdits = [
  ...sessionServerEdits,
  ['            ...options,\n        };\n    }\n    /**\n     * Start the MCP server',
    `            ...options,\n        };\n        if (process.env.RUFLO_MEMORY_OWNER_SERVER === '1' && !options.pidFile)\n            this.options.pidFile = path.join(os.tmpdir(), 'claude-flow-mcp-owner-' + Number(this.options.port) + '.pid');\n    }\n    /**\n     * Start the MCP server`],
  ['        try {\n            const { initializeMemoryDatabase, checkMemoryInitialization }',
    `        // ${PATCH_MARKER}: clients verify an owner without opening a local store.\n        if (!(await import('./mcp-client.js')).rspMemoryOwner.configured()) {\n        try {\n            const { initializeMemoryDatabase, checkMemoryInitialization }`],
  ["            console.error(`[${new Date().toISOString()}] WARN [claude-flow-mcp] (${sessionId}) Memory auto-init failed (tools will retry on first call): ${memInitError instanceof Error ? memInitError.message : String(memInitError)}`);\n        }\n        console.error(JSON.stringify({",
    "            console.error(`[${new Date().toISOString()}] WARN [claude-flow-mcp] (${sessionId}) Memory auto-init failed (tools will retry on first call): ${memInitError instanceof Error ? memInitError.message : String(memInitError)}`);\n        }\n        } else {\n            await (await import('./mcp-client.js')).rspMemoryOwner.call('memory_owner_identity');\n            console.error('[claude-flow-mcp] Verified configured native owner; stdio is a client');\n        }\n        console.error(JSON.stringify({"],
  ['    async startHttpServer() {',
    `    async startHttpServer() {\n        const owner = (await import('./mcp-client.js')).rspMemoryOwner;\n        if (owner.configured()) {\n            if (process.env.RUFLO_MEMORY_OWNER_SERVER !== '1')\n                throw new Error('Configured HTTP owner requires explicit RUFLO_MEMORY_OWNER_SERVER=1');\n            await owner.enterServerMode(process.cwd());\n        }`],
];
const publicMemoryEdits = [['//# sourceMappingURL=memory-initializer.js.map', `
// ${PATCH_MARKER}: outside existing export guards, so clients never lock the owner's store.
{
    const forward = (native, name) => async function(options) {
        const owner = (await import('../mcp-client.js')).rspMemoryOwner;
        return owner.configured() ? owner.call(name, options, {}, true) : native.call(this, options);
    };
    storeEntry = forward(storeEntry, 'memory_store');
    getEntry = forward(getEntry, 'memory_retrieve');
    listEntries = forward(listEntries, 'memory_list');
    searchEntries = forward(searchEntries, 'memory_search');
    deleteEntry = forward(deleteEntry, 'memory_delete');
    purgeNamespace = forward(purgeNamespace, 'memory_purge');
    const nativeEmbedding = generateEmbedding;
    generateEmbedding = async function(text) {
        const owner = (await import('../mcp-client.js')).rspMemoryOwner;
        return owner.configured() ? owner.call('memory_generate_embedding', { text }) : nativeEmbedding(text);
    };
}
//# sourceMappingURL=memory-initializer.js.map`]];
const commandEdits = [
  ["        const backend = ctx.flags.backend || 'hybrid';\n        const customPath = ctx.flags.path;",
    "        if ((await import('../mcp-client.js')).rspMemoryOwner.configured()) {\n            output.printError('memory init requires exclusive local administration; routed clients cannot initialize or replace an owned store.');\n            return { success: false, exitCode: 2 };\n        }\n        const backend = ctx.flags.backend || 'hybrid';\n        const customPath = ctx.flags.path;"],
  ['                const index = await getHNSWIndex({ forceRebuild: true });',
    "                const owner = (await import('../mcp-client.js')).rspMemoryOwner;\n                const remoteIndex = owner.configured() ? await owner.call('memory_index_status', { rebuild: true }) : null;\n                const index = remoteIndex ? remoteIndex.available : await getHNSWIndex({ forceRebuild: true });"],
  ['                    const status = getHNSWStatus();',
    '                    const status = remoteIndex ? remoteIndex.hnsw : getHNSWStatus();'],
  ['                const embedding = await loadEmbeddingModel({ verbose: false });\n                const hnsw = getHNSWStatus();',
    "                const owner = (await import('../mcp-client.js')).rspMemoryOwner;\n                const remoteIndex = owner.configured() ? await owner.call('memory_index_status', { loadEmbedding: true }) : null;\n                const embedding = remoteIndex ? remoteIndex.embedding : await loadEmbeddingModel({ verbose: false });\n                const hnsw = remoteIndex ? remoteIndex.hnsw : getHNSWStatus();"],
];
const count = (source, text) => source.split(text).length - 1;
const anchorValue = "        const compound = first === '{' || first === '[';";
const anchorFastValue = `        // ${PATCH_MARKER}: native JSON.parse validates complete one-entry lines.
        // Chunked/pretty values retain the original bounded streaming parser.
        if (first === '{') {
            const end = this.text.indexOf('\\n', this.cursor);
            if (end !== -1) {
                let raw = this.text.slice(this.cursor, end).trimEnd();
                if (raw.endsWith(',')) raw = raw.slice(0, -1);
                if (Buffer.byteLength(raw) > VALUE_LIMIT) throw new Error('policy-anchor-log-record-too-large');
                try {
                    const value = JSON.parse(raw);
                    this.cursor += raw.length;
                    return value;
                } catch { /* Not one complete object; original parser validates it. */ }
            }
        }
${anchorValue}`;
function kind(source) {
  if (source.includes('export function* anchorEntries(file)')) return 'anchor-log';
  if (source.includes('export async function authorizeMcpTool(')) return 'policy-runtime';
  if (source.includes('export async function callMCPTool(')) return 'client';
  if (source.includes('export class MCPServerManager')) return 'server';
  if (source.includes('export const memoryTools = [')) return 'tools';
  if (source.includes('export const agentdbGraphQuery = {')) return 'graph';
  if (source.includes('export async function storeEntry(options) {')) return 'public-memory';
  if (source.includes('export const memoryCommand = {')) return 'commands';
  throw new Error('Unrecognized native owner forwarding surface');
}
function edits(source) {
  const type = kind(source);
  switch (type) {
    case 'anchor-log': return [[anchorValue, anchorFastValue]];
    case 'client': return [['/**\n * V3 CLI MCP Client', runtime + '/**\n * V3 CLI MCP Client'], ...clientEdits];
    case 'server': return serverEdits;
    case 'policy-runtime': return policyRuntimeEdits;
    case 'commands': return commandEdits;
    case 'graph': return graphEdits(source);
    case 'public-memory': return publicMemoryEdits;
    case 'tools': return [
      ['export const memoryTools = [', `export const memoryTools = [\n    // ${PATCH_MARKER}\n${identity}`],
      ...canonicalSchemaEdits(source), ...canonicalEdits,
    ];
  }
}
function releasedEdits(source) {
  const type = kind(source);
  if (!['client', 'server', 'tools'].includes(type)) return null;
  if(type==='client')return [['/**\n * V3 CLI MCP Client',released.runtime+'/**\n * V3 CLI MCP Client'],...legacyClientEdits];
  return edits(source).filter(([from]) => ![...sessionServerEdits,...policyClientEdits].some(([added]) => from === added))
    .map(([from, to]) => [from, to.replace(runtime, released.runtime).replace(identity, released.identity)]);
}
export function recover(source) {
  if (kind(source) === 'policy-runtime') {
    for (const changes of [release117PolicyEdits, release112PolicyEdits, diagnosticPolicyRuntimeEdits, priorPolicyRuntimeEdits]) {
    const candidate = changes.reduceRight((s, [from, to]) => s.replace(to, from), source);
    const verify = clean => changes.reduce((s, [from, to]) => s.replace(from, () => to), clean);
    if (candidate !== source && !hasPatch(candidate) && verify(candidate) === source) return { candidate, verify };
    }
  }
  if (kind(source) === 'client') {
    for (const version of ['4.46.109', '4.46.110', '4.46.111', '4.46.114', '4.46.116', '4.46.117', '4.46.123', '4.46.126', '4.46.128']) {
    const last = JSON.parse(fs.readFileSync(new URL('./released-'+version+'.json', import.meta.url), 'utf8'));
    const priorChanges = [['/**\n * V3 CLI MCP Client',last.runtime+'/**\n * V3 CLI MCP Client'],
      ...(['4.46.123', '4.46.126', '4.46.128'].includes(version) ? clientEdits : priorClientEdits)];
    const priorCandidate = priorChanges.reduceRight((next, [from, to]) => next.replace(to, from), source);
    const priorVerify = clean => priorChanges.reduce((next, [from, to]) => next.replace(from, () => to), clean);
    if (priorCandidate !== source && !hasPatch(priorCandidate) && priorChanges.every(([from]) => count(priorCandidate, from) === 1)
        && priorVerify(priorCandidate) === source) return { candidate: priorCandidate, verify: priorVerify };
    }
    const prior = JSON.parse(fs.readFileSync(new URL('./released-4.46.108.json', import.meta.url), 'utf8'));
    const changes = [['/**\n * V3 CLI MCP Client',prior.runtime+'/**\n * V3 CLI MCP Client'],...legacyClientEdits];
    const candidate = changes.reduceRight((next, [from, to]) => next.replace(to, from), source);
    const verify = clean => changes.reduce((next, [from, to]) => next.replace(from, () => to), clean);
    if (candidate !== source && !hasPatch(candidate) && changes.every(([from]) => count(candidate, from) === 1)
        && verify(candidate) === source) return { candidate, verify };
  }
  const changes = releasedEdits(source);
  if (!changes) return null;
  const candidate = changes.reduceRight((next, [from, to]) => next.replace(to, from), source);
  if (candidate === source || hasPatch(candidate) || changes.some(([from]) => count(candidate, from) !== 1)) return null;
  const verify = clean => changes.reduce((next, [from, to]) => next.replace(from, () => to), clean);
  return verify(candidate) === source ? { candidate, verify } : null;
}
export function reverse(source) {
  return recover(source)?.candidate ?? edits(source).reduceRight((next, [from, to]) => next.replace(to, from), source);
}
export const hasPatch = source => source.includes('ruflo-source-patch (ruflo#4654):')
  || source.includes("rspMemoryOwner.call('memory_index_status'")
  || source.includes("const remoteIndex = owner.configured()");
export function patchSource(source) {
  try {
    if (hasPatch(source)) {
      const previous = recover(source);
      if (previous) return patchSource(previous.candidate);
      const clean = reverse(source);
      if (clean === source || hasPatch(clean)) return { next: source, applied: [], missing: ['modified-owner-forwarding'] };
      const reconstructed = patchSource(clean);
      return reconstructed.next === source ? { next: source, applied: [], missing: [] }
        : { next: source, applied: [], missing: ['modified-owner-forwarding'] };
    }
    const changes = edits(source);
    if (changes.some(([from]) => count(source, from) !== 1)) throw new Error('Absent or ambiguous native owner anchor');
    return { next: changes.reduce((next, [from, to]) => next.replace(from, () => to), source), applied: [NAME], missing: [] };
  } catch (error) { return { next: source, applied: [], missing: [error.message] }; }
}
export const isPatched = source => hasPatch(source) && patchSource(source).missing.length === 0 && patchSource(source).next === source;
const sourceFiles = ['mcp-client.js', 'mcp-server.js', 'mcp-tools/memory-tools.js', 'mcp-tools/agentdb-tools.js',
  'memory/memory-initializer.js', 'commands/memory.js', 'services/policy-runtime.js', 'services/policy-anchor-log.js'];
export const discover = () => sourceFiles
  .flatMap(file => discoverCli(['@claude-flow', 'cli', 'dist', 'src', ...file.split('/')])
    .filter(location => {
      // Older dormant npx packages do not implement the qualified 3.71 native
      // contract. A later candidate still participates and must prove anchors.
      const root = path.resolve(location, ...Array(file.split('/').length + 2).fill('..'));
      let version;
      try { version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      const [major, minor] = String(version).split('.').map(Number);
      return major > 3 || (major === 3 && minor >= 71);
    }));
export function preflight() {
  const roots = new Set(discover().map(file => file.slice(0, file.lastIndexOf(path.join('dist', 'src')))));
  const errors = [];
  for (const root of roots) for (const relative of sourceFiles) {
    const file = path.join(root, 'dist', 'src', relative);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('unsafe native source surface');
      const result = patchSource(fs.readFileSync(file, 'utf8'));
      if (result.missing.length) throw new Error(result.missing.join('; '));
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, discover,
  preflight, patchSource, hasPatch, isPatched, reverse, recover };
