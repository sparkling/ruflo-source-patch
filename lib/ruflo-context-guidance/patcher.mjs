// Ruflo #4691: remaining research consumers of the episode-only contract (#4161).
// Guidance only: never alter the native handler, recall, eligibility or results.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';

export const NAME = 'ruflo-context-guidance';
export const MARKER = 'ruflo-source-patch (ruflo#4691)';
const TOOL = 'mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize';
const SEARCH = 'mcp__plugin_ruflo-core_ruflo__memory_search';
const RETRIEVE = 'mcp__plugin_ruflo-core_ruflo__memory_retrieve';
const EPISODES = 'validated task episodes with an explicit task, finite numeric reward and boolean success';

const toolOriginal = `export const agentdbContextSynthesize = {
    name: 'agentdb_context-synthesize',
    description: 'Synthesize context from stored memories for a given query Use when generic memory_* tools are wrong because you need AgentDB-specific controllers (HNSW vector search, hierarchical tiers, causal-graph links, pattern store/recall, RaBitQ quantization). For simple key-value persistence, memory_store/memory_retrieve are simpler. For unrelated file work, native Read/Write are fine.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Query to synthesize context for' },
            maxEntries: { type: 'number', description: 'Maximum entries to include (default: 10)' },
        },
        required: ['query'],
    },`;
const toolCorrected = `export const agentdbContextSynthesize = {
    name: 'agentdb_context-synthesize',
    description: 'Synthesize observed outcomes and critique-derived patterns from recalled ${EPISODES}. For ordinary research documents or graph findings, use memory_search in the owning source, then memory_retrieve for exact records and synthesize from that evidence. No matching or eligible episodes does not mean research records are missing. Never invent outcomes or rewrite facts as episodes.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Task or experience query for validated episode-outcome synthesis' },
            maxEntries: { type: 'number', description: 'Maximum hierarchical entries recalled before episode eligibility checks (default: 10)' },
        },
        required: ['query'],
    },`;
const skillOriginal = `   - \`${TOOL}\` for AI-assisted context building`;
const skillCorrected = `   - \`${RETRIEVE}\` for exact namespace/key readback of useful findings from the same owning source; preserve their evidence and qualifications, then synthesize the report from those records
   - Use \`${TOOL}\` only for questions about actual past task outcomes, from ${EPISODES}. No matching or eligible episodes does not mean research records are missing. Never invent outcomes or rewrite facts as episodes.`;
const researcherOriginal = `6. **Synthesize** — Merge graph findings into a coherent research summary:
   \`\`\`
   ${TOOL}({ query: "TOPIC", maxEntries: 10 })
   \`\`\``;
const researcherCorrected = `6. **Synthesize** — Build the research summary from retrieved graph/source evidence. For ordinary stored research, use \`${SEARCH}\` in the owning source and \`${RETRIEVE}\` for exact namespace/key readback; retain source identities and qualifications.
   For questions about actual past task outcomes only, use ${EPISODES}:
   \`\`\`
   ${TOOL}({ query: "TOPIC", maxEntries: 10 })
   \`\`\`
   No matching or eligible episodes does not mean research records are missing. Never invent outcomes or rewrite facts as episodes.`;
const researcherTool = `- \`${TOOL}\` — merge multi-source findings`;
const researcherToolCorrected = `- \`${TOOL}\` — synthesize validated task outcomes and critique-derived patterns; ordinary research is synthesized from exact source evidence`;

const definitions = [
  { id: 'mcp-description', identity: 'export const agentdbContextSynthesize = {',
    comment: `    // ${MARKER}\n`, edits: [[toolOriginal, toolCorrected]],
    mark: value => value.replace("    name: 'agentdb_context-synthesize',\n", `    name: 'agentdb_context-synthesize',\n    // ${MARKER}\n`) },
  { id: 'research-synthesize', identity: '# Research Synthesize',
    comment: `   <!-- ${MARKER} -->\n`, edits: [[skillOriginal, skillCorrected]],
    mark: value => `   <!-- ${MARKER} -->\n${value}` },
  { id: 'researcher', identity: 'name: researcher\n',
    comment: `<!-- ${MARKER} -->\n`, edits: [[researcherOriginal, researcherCorrected], [researcherTool, researcherToolCorrected]],
    mark: value => `<!-- ${MARKER} -->\n${value}` },
];
// Exact reviewed upstream #4691 metadata (CLI 3.71.3, goals 0.4.6, core 0.2.14).
// Metadata-only recognition; handlers and unknown variants remain untouched.
const upstreamGuidance = {
  "mcp-description": [
    "export const agentdbContextSynthesize = {\n    name: 'agentdb_context-synthesize',\n    description: 'Summarize validated task episodes (task, reward, success, critique) that match a query: observed success rate, reward and critique-derived patterns. Ordinary documents, research notes and graph entities are not episodes, so for them it answers no-memories or no-eligible-episodes; read those with memory_search or memory_retrieve instead. Use when generic memory_* tools are wrong because you need AgentDB-specific controllers (HNSW vector search, hierarchical tiers, causal-graph links, pattern store/recall, RaBitQ quantization). For simple key-value persistence, memory_store/memory_retrieve are simpler. For unrelated file work, native Read/Write are fine.',\n    inputSchema: {\n        type: 'object',\n        properties: {\n            query: { type: 'string', description: 'Task to find matching validated episodes for' },\n            maxEntries: { type: 'number', description: 'Maximum episodes to include (default: 10)' },\n        },\n        required: ['query'],\n    },"
  ],
  "research-synthesize": [
    "   - Synthesize the findings yourself from what the searches return. `mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize` is not a document synthesizer: it summarizes validated task episodes (task, reward, success) and answers `no-memories` or `no-eligible-episodes` for research notes and sources, which is the correct answer, not missing research"
  ],
  "researcher": [
    "6. **Synthesize** \u2014 Write the research summary yourself from the graph findings and the records `memory_search` / `memory_retrieve` returned. Use `agentdb_context-synthesize` only for past task outcomes: it summarizes validated task episodes (task, reward, success) and answers `no-eligible-episodes` for documents and graph entities, which is correct, not a gap in the research.",
    "- `mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize` \u2014 summarize validated task episodes (past task outcomes); not for documents or graph findings"
  ]
};
const count = (source, anchor) => source.split(anchor).length - 1;
const eol = (source, value) => source.includes('\r\n') ? value.replaceAll('\n', '\r\n') : value;
function definition(source) {
  const found = definitions.filter(item => count(source, eol(source, item.identity)) === 1);
  return found.length === 1 ? found[0] : null;
}
function pairs(source, item, marked) {
  return item.edits.map(([before, after], index) => [eol(source, before),
    eol(source, marked && index === 0 ? item.mark(after) : after)]);
}
export const hasPatch = source => source.includes(MARKER);
export function isNative(source) {
  const item = definition(source);
  return Boolean(item) && !hasPatch(source)
    && (pairs(source, item, false).every(([before, after]) => count(source, before) === 0 && count(source, after) === 1)
      || upstreamGuidance[item.id].every(text => count(source, eol(source, text)) === 1)
        && pairs(source, item, false).every(([before]) => count(source, before) === 0));
}
export function isPatched(source) {
  if (isNative(source)) return true;
  const item = definition(source);
  return Boolean(item) && count(source, MARKER) === 1
    && pairs(source, item, true).every(([before, after]) => count(source, before) === 0 && count(source, after) === 1);
}
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const item = definition(source);
  if (!item || hasPatch(source)) return { next: source, applied: [], missing: ['known-context-guidance-surface'] };
  const edits = pairs(source, item, true);
  if (!edits.every(([before, after]) => count(source, before) === 1 && count(source, after) === 0)) {
    return { next: source, applied: [], missing: [`${item.id}:exact-guidance-anchors`] };
  }
  return { next: edits.reduce((value, [before, after]) => value.replace(before, () => after), source),
    applied: [item.id], missing: [] };
}
export function reverseSource(source) {
  if (!hasPatch(source) || !isPatched(source)) return source;
  return pairs(source, definition(source), true).reduceRight((value, [before, after]) => value.replace(after, () => before), source);
}

const PLUGINS = [['ruflo-goals', 'skills/research-synthesize/SKILL.md'], ['ruflo-core', 'agents/researcher.md']];
const codexHome = process.env.RSP_CODEX_HOME || (process.env.RUFLO_SOURCE_PATCH_HOME
  ? path.join(HOME_BASE, '.codex') : process.env.CODEX_HOME || path.join(HOME_BASE, '.codex'));
const directories = root => {
  try { return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(root, entry.name)); }
  catch { return []; }
};
function selectedCaches(plugin, claudeCache, codexCache, codexMarket) {
  const roots = [];
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(HOME_BASE, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    for (const entry of registry.plugins?.[`${plugin}@ruflo`] || []) {
      if (entry.enabled !== false && (entry.scope !== 'project' || fs.existsSync(entry.projectPath || ''))
          && existingPathRelative(claudeCache, entry.installPath)) roots.push(entry.installPath);
    }
  } catch { roots.push(...directories(claudeCache)); }
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(codexMarket, '.claude-plugin', 'plugin.json'), 'utf8'));
    if (manifest.name !== plugin || !/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(manifest.version)) throw Error('unverified selected plugin');
    roots.push(path.join(codexCache, manifest.version));
  } catch { roots.push(...directories(codexCache)); }
  return roots;
}
function pluginFiles() {
  const files = [], errors = [];
  for (const [plugin, relative] of PLUGINS) {
    const codexMarket = path.join(process.env.RSP_RUFLO_CODEX_MARKETPLACE || path.join(codexHome, '.tmp', 'marketplaces', 'ruflo'), 'plugins', plugin);
    const candidates = [
      path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', 'ruflo', 'plugins', plugin),
      codexMarket,
      ...selectedCaches(plugin, path.join(HOME_BASE, '.claude', 'plugins', 'cache', 'ruflo', plugin),
        path.join(codexHome, 'plugins', 'cache', 'ruflo', plugin), codexMarket),
    ];
    for (const root of candidates) {
      try {
        const manifest = path.join(root, '.claude-plugin', 'plugin.json');
        if (existingPathRelative(root, manifest) !== path.join('.claude-plugin', 'plugin.json')) continue;
        if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name !== plugin) continue;
        const file = path.join(root, relative);
        if (!fs.existsSync(file) || existingPathRelative(root, file) === path.normalize(relative)) files.push(file);
        else errors.push(`${file}: selected guidance escapes its plugin owner`);
      } catch { /* absent or unverified plugin */ }
    }
  }
  return { files, errors };
}
export const discover = () => [...new Set([
  ...discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'agentdb-tools.js']), ...pluginFiles().files,
])];
export function preflight() {
  const errors = pluginFiles().errors;
  const cliFiles = new Set(discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'agentdb-tools.js']));
  const blockedFiles = [];
  let globalFailure = errors.length > 0;
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw Error('unsafe or empty context guidance source');
      const result = patchSource(fs.readFileSync(file, 'utf8'));
      if (result.missing.length) throw Error(result.missing.join(', '));
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
      if (cliFiles.has(file)) blockedFiles.push(file);
      else globalFailure = true;
    }
  }
  // An unknown CLI cache cannot block a separately verified installed package.
  // Selected shared plugin guidance retains its existing all-file boundary.
  return { ok: errors.length === 0, errors,
    ...(!globalFailure && errors.length && { blockedFiles }) };
}
export function probeNativeGuidance() {
  const files = discover(), kinds = new Set();
  try {
    const ready = preflight();
    if (!ready.ok) return { state: 'unknown', evidence: ready.errors.join('; ') };
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8'), item = definition(source);
      if (!item || !isNative(source)) return { state: 'live', evidence: `${file}: corrected native guidance not proven` };
      kinds.add(item.id);
    }
    if (kinds.size !== definitions.length) return { state: 'unknown', evidence: 'all three native guidance surfaces must be present for retirement' };
    return { state: 'fixed', evidence: `${files.length} installed sources carry the exact corrected guidance without local markers` };
  } catch (error) { return { state: 'unknown', evidence: error.message }; }
}
export const descriptor = { name: NAME, atomic: true, discover, preflight, patchSource,
  hasPatch, isPatched, reverse: reverseSource };
