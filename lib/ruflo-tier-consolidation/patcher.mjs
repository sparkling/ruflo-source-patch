import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { TIER_METHOD, REGISTRY_METHOD, TOOL_SCHEMA } from './runtime.mjs';
export const NAME = 'ruflo-tier-consolidation';
export const MARKER = 'ruflo-source-patch (#2977 scoped-tier-consolidation)';
const REGISTRY_CASE = `            case 'memoryConsolidation': {
                // MemoryConsolidation was exported by agentdb 3.0.0-alpha.10 (ADR-066
                // Phase P2-3) and removed at alpha.14 — no installable range exports
                // it, and it requires a working HierarchicalMemory instance to
                // construct, which is itself dead (see hierarchicalMemory above,
                // #2977). The no-op stub is therefore the only implementation that
                // has ever worked here; it is promoted to first-class instead of
                // attempting a dynamic import that never resolves.
                return this.createConsolidationStub();
            }`;
const REGISTRY_STUB = `    /**
     * No-op consolidation stub — the first-class implementation for
     * \`memoryConsolidation\` since agentdb has never shipped a working native
     * MemoryConsolidation on any installable range (#2977). \`promoted: 0,
     * pruned: 0\` on its own reads as "ran and found nothing to do"; \`source\`
     * and \`note\` make it explicit that consolidation never actually ran.
     */
    createConsolidationStub() {
        return {
            consolidate() {
                return {
                    promoted: 0,
                    pruned: 0,
                    timestamp: Date.now(),
                    source: 'stub',
                    note: 'no-op: native MemoryConsolidation is unavailable (agentdb never exports a working implementation, #2977) — nothing was consolidated, this did not run',
                };
            },
        };
    }`;
const BRIDGE_OLD = `/** Run consolidation when a real controller is available. */
export async function bridgeConsolidate(params) {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeConsolidate(params));
    // No installed consolidation API accepts these historical options. Reject
    // them explicitly rather than silently claiming their limits were applied.
    if (params.minAge !== undefined || params.maxEntries !== undefined) {
        return { success: false, status: 'unsupported', error: 'minAge and maxEntries are not supported by the consolidation controller' };
    }
    const registry = await getRegistry();
    if (!registry)
        return null;
    try {
        const mc = registry.get('memoryConsolidation');
        if (!mc)
            return { success: false, error: 'MemoryConsolidation not available' };
        const result = await mc.consolidate();
        if (result?.source === 'stub') {
            return { success: false, status: 'unsupported', error: 'Memory consolidation is unavailable; no consolidation ran', consolidated: result };
        }
        return { success: true, consolidated: result };
    }
    catch (e) {
        return { success: false, error: e.message };
    }
}`;
const BRIDGE_NEW = `// ${MARKER}: the native owner validates and transacts the exact requested scope.
export async function bridgeConsolidate(params) {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeConsolidate(params));
    const registry = await getRegistry();
    if (!registry) return { success: false, error: 'AgentDB registry not available' };
    try {
        const mc = registry.get('memoryConsolidation');
        if (!mc || typeof mc.consolidate !== 'function') throw new Error('MemoryConsolidation not available');
        const result = await mc.consolidate(params);
        if (result?.source !== 'tiered-memory' || result.pruned !== 0
            || !Number.isSafeInteger(result.promoted) || result.promoted < 0)
            throw new Error('Unverified scoped consolidation result');
        return { success: true, consolidated: result, dbPath: registry.dbPath };
    } catch (e) { return { success: false, error: e.message }; }
}`;
const TOOL_OLD = `    description: 'Request memory consolidation. Use when checking whether AgentDB can consolidate retained memories; native file edits cannot perform controller consolidation. Currently returns unsupported when the installed controller is a no-op stub; no entries are promoted or compressed in that case.',
    inputSchema: {
        type: 'object',
        properties: {},
    },
    handler: async (params) => {
        try {
            if (Object.keys(params).length > 0) {
                return { success: false, status: 'unsupported', error: 'agentdb_consolidate does not support options' };
            }
            const bridge = await getBridge();
            const result = await bridge.bridgeConsolidate({});`;
const TOOL_NEW = `    // ${MARKER}: no blanket consolidation, inferred outcomes, pruning or compression.
    description: 'Preserve explicit evaluated episodic keys in the semantic tier. sources selects 1..32 exact keys. dryRun defaults true and returns sourceSha256; apply with dryRun:false requires each expectedSha256. Original raw values, outcomes and temporal fields are preserved. Repeats are idempotent. This is scoped tier promotion, not summary generation, procedural learning or evidence of quality gain.',
    inputSchema: {
${TOOL_SCHEMA}
    },
    handler: async (params) => {
        try {
            const bridge = await getBridge();
            const result = await bridge.bridgeConsolidate(params);`;
export const SPECS = [
  { file: 'tiered-memory.js', edits: [
    ['const TABLE_DDL = `', `// ${MARKER}\nimport { createHash as rspTierHash } from 'node:crypto';\nconst TABLE_DDL = \``],
    ['    /** True when writes are persisted to the backing table. */', `    ${TIER_METHOD}\n    /** True when writes are persisted to the backing table. */`],
  ] },
  { file: 'controller-registry.js', edits: [
    [REGISTRY_CASE, `            case 'memoryConsolidation': {\n                // ${MARKER}: share hierarchicalMemory's existing owner.\n                return this.createConsolidationController();\n            }`],
    [REGISTRY_STUB, REGISTRY_METHOD],
  ] },
  { file: 'memory-bridge.js', edits: [[BRIDGE_OLD, BRIDGE_NEW]] },
  { file: 'agentdb-tools.js', edits: [[TOOL_OLD, TOOL_NEW]] },
];
const count = (source, text) => source.split(text).length - 1;
const matching = (source, patched) => SPECS.filter(spec => spec.edits.every(([from, to]) => count(source, patched ? to : from) === 1));
export const hasPatch = source => source.includes(MARKER);
export const isPatched = source => hasPatch(source) && matching(source, true).length === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const specs = matching(source, false);
  if (hasPatch(source) || specs.length !== 1) return { next: source, applied: [], missing: ['unique-scoped-tier-consolidation-boundary'] };
  return { next: specs[0].edits.reduce((body, [from, to]) => body.replace(from, () => to), source), applied: [NAME], missing: [] };
}
export const reverse = source => SPECS.flatMap(spec => spec.edits).reduceRight((body, [from, to]) => body.replace(to, () => from), source);
export function bundles() {
  return discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js']).map(bridge => {
    const root = path.resolve(path.dirname(bridge), '../../..');
    const files = [bridge, path.join(root, 'dist/src/mcp-tools/agentdb-tools.js')];
    try {
      const memory = createRequire(path.join(root, 'package.json')).resolve('@claude-flow/memory');
      files.push(...['tiered-memory.js', 'controller-registry.js'].map(name => path.join(path.dirname(memory), name)));
    } catch { /* preflight refuses a bridge without its actual memory owner */ }
    return { root, files };
  });
}
export const discover = () => [...new Set(bundles().flatMap(bundle => bundle.files))];
export function preflight() {
  const errors = [], blockedFiles = [];
  for (const { root, files } of bundles()) {
    const failures = [];
    if (files.length !== 4) failures.push(root + ': complete native controller/store/bridge/tool bundle required');
    for (const file of files) try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe native consolidation member');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('native consolidation anchors changed');
    } catch (error) { failures.push(file + ': ' + error.message); }
    if (failures.length) { errors.push(...failures); blockedFiles.push(...files); }
  }
  return { ok: !errors.length, errors, ...(errors.length && { blockedFiles: [...new Set(blockedFiles)] }) };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse };
