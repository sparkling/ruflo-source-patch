// Ruflo #3215: the public agent schema rejects exact host-native model IDs even
// though the handler preserves them, while hooks_model-route presents its
// Claude-era tier aliases as if they were executable model allocation. Keep the
// legacy router intact, expose exact IDs, and make caller-owned allocation clear.

import fs from 'node:fs';
import path from 'node:path';
import { discoverBundles } from '../ruflo-instruction-contract/patcher.mjs';

export const PATCH_MARKER = 'ruflo-source-patch (ruvnet/ruflo#3215)';

export const AGENT_MODEL_ANCHOR = `                model: {
                    type: 'string',
                    enum: ['haiku', 'sonnet', 'opus', 'opus-4.7', 'inherit'],
                    description: 'Claude model alias (haiku=fast/cheap, sonnet=balanced, opus=current Opus 4.8, opus-4.7=prior Opus pin)'
                },`;

export const AGENT_MODEL_REPLACEMENT = `                model: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 256,
                    pattern: '^(?!.*[^A-Za-z0-9._:/@+-])[A-Za-z0-9]',
                    description: 'Legacy routing alias (haiku/sonnet/opus/opus-4.7/inherit) or exact host-native model ID. ${PATCH_MARKER}: Ruflo preserves a non-alias request as modelId; the native executor or caller-owned harness controls availability and allocation, and a tracked record is not execution proof.'
                },`;

export const ROUTE_DESCRIPTION_ANCHOR = "    description: 'Route task to optimal Claude model (haiku/sonnet/opus) based on complexity Use when native Bash hooks (via Claude Code\\'s settings.json) are wrong because you need Ruflo-side state — pattern persistence, neural training signals, model-routing learning, cost tracking, audit chain. For one-off shell commands, plain Bash hooks are fine.',";
export const ROUTE_DESCRIPTION_REPLACEMENT = `    description: 'Return a legacy routing-tier recommendation (haiku/sonnet/opus), not a complete executable-model portfolio. ${PATCH_MARKER}: the native executor or caller-owned harness maps this tier to an exact model such as Astra or Fable; Ruflo does not silently allocate or execute that model. Use for Ruflo-side routing state and learning, not as execution proof.',`;

export const FALLBACK_MODEL_ANCHOR = "                model: complexity > 0.7 ? 'opus' : complexity > 0.4 ? 'sonnet' : 'haiku',";
export const FALLBACK_MODEL_REPLACEMENT = `                model: complexity > 0.7 ? 'opus' : complexity > 0.4 ? 'sonnet' : 'haiku',
                routingTier: complexity > 0.7 ? 'opus' : complexity > 0.4 ? 'sonnet' : 'haiku',
                allocationOwner: 'caller', // ${PATCH_MARKER}`;

export const ROUTER_MODEL_ANCHOR = '            model: result.model,\n            confidence: result.confidence,';
export const ROUTER_MODEL_REPLACEMENT = `            model: result.model,
            routingTier: result.model,
            allocationOwner: 'caller', // ${PATCH_MARKER}
            confidence: result.confidence,`;

const count = (source, needle) => source.split(needle).length - 1;
const replaceUnique = (source, anchor, replacement, id, applied, missing) => {
  if (source.includes(replacement)) return source;
  const occurrences = count(source, anchor);
  if (occurrences !== 1) {
    missing.push(occurrences > 1 ? `${id}(AMBIGUOUS: anchor occurs ${occurrences}x)` : id);
    return source;
  }
  applied.push(id);
  return source.replace(anchor, replacement);
};

function modelSchemaBlock(source) {
  const match = source.match(/\n\s+model:\s*\{[\s\S]*?\n\s+\},\n\s+task:\s*\{/);
  return match?.[0] || '';
}

function hooksModelRouteBlock(source) {
  const start = source.indexOf("name: 'hooks_model-route'");
  if (start < 0) return '';
  const nextExport = source.indexOf('\nexport const ', start);
  return source.slice(start, nextExport < 0 ? source.length : nextExport);
}

export function nativeAgentContract(source) {
  const block = modelSchemaBlock(source);
  const openExactId = block.includes("type: 'string'")
    && (!block.includes('enum:') || (block.includes('gpt-6-astra') && block.includes('claude-fable-5')))
    && block.includes('minLength: 1') && block.includes('maxLength: 256')
    && block.includes('pattern:');
  const preservesExactId = source.includes('config.model = input.model')
    && source.includes("return { model: 'sonnet', routedBy: 'explicit', modelId: explicitModel };");
  return openExactId && preservesExactId;
}

export function nativeHooksContract(source) {
  const block = hooksModelRouteBlock(source);
  const description = block.match(/description:\s*'([^']|'\\')*'/)?.[0] || '';
  const tierLanguage = /tier/i.test(description);
  const allocationClaims = block.match(/allocationOwner:\s*['"]caller['"]/g) || [];
  const externalAllocation = allocationClaims.length >= 2
    || (block.match(/allocationOwnedBy:\s*['"](?:caller|harness|executor)['"]/g) || []).length >= 2;
  const returnsTier = (block.match(/(routingTier|recommendedTier|routeTier):/g) || []).length >= 2;
  return tierLanguage && externalAllocation && returnsTier;
}

export function patchSource(source) {
  if (source.includes("name: 'agent_spawn'")) {
    if (nativeAgentContract(source)) return { next: source, applied: [], missing: [] };
    const applied = [];
    const missing = [];
    const next = replaceUnique(source, AGENT_MODEL_ANCHOR, AGENT_MODEL_REPLACEMENT,
      'open-exact-agent-model-id', applied, missing);
    return { next, applied, missing };
  }
  if (source.includes("name: 'hooks_model-route'")) {
    if (nativeHooksContract(source)) return { next: source, applied: [], missing: [] };
    const applied = [];
    const missing = [];
    let next = replaceUnique(source, ROUTE_DESCRIPTION_ANCHOR, ROUTE_DESCRIPTION_REPLACEMENT,
      'tier-not-portfolio-description', applied, missing);
    next = replaceUnique(next, FALLBACK_MODEL_ANCHOR, FALLBACK_MODEL_REPLACEMENT,
      'fallback-routing-tier', applied, missing);
    next = replaceUnique(next, ROUTER_MODEL_ANCHOR, ROUTER_MODEL_REPLACEMENT,
      'router-routing-tier', applied, missing);
    return { next, applied, missing };
  }
  return { next: source, applied: [], missing: ['recognized-model-contract-surface'] };
}

export function reverseSource(source) {
  return source
    .replace(AGENT_MODEL_REPLACEMENT, AGENT_MODEL_ANCHOR)
    .replace(ROUTE_DESCRIPTION_REPLACEMENT, ROUTE_DESCRIPTION_ANCHOR)
    .replace(FALLBACK_MODEL_REPLACEMENT, FALLBACK_MODEL_ANCHOR)
    .replace(ROUTER_MODEL_REPLACEMENT, ROUTER_MODEL_ANCHOR);
}

const regularFile = (file) => {
  try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink(); }
  catch { return false; }
};

export function discoverPairs() {
  return discoverBundles().map(({ cliRoot }) => ({
    cliRoot,
    agent: path.join(cliRoot, 'dist', 'src', 'mcp-tools', 'agent-tools.js'),
    hooks: path.join(cliRoot, 'dist', 'src', 'mcp-tools', 'hooks-tools.js'),
  }));
}

export function discover() {
  return discoverPairs().flatMap(({ agent, hooks }) => [agent, hooks]).filter(regularFile);
}

export function preflight() {
  const pairs = discoverPairs();
  const errors = [];
  if (!pairs.length) errors.push('no authenticated @claude-flow/cli installation found');
  for (const pair of pairs) {
    for (const kind of ['agent', 'hooks']) {
      const file = pair[kind];
      if (!regularFile(file)) { errors.push(`${pair.cliRoot}: missing regular ${kind} tool source`); continue; }
      try {
        const current = fs.readFileSync(file, 'utf8');
        const backup = `${file}.rsp-backup`;
        const source = current.includes(PATCH_MARKER) && regularFile(backup)
          ? fs.readFileSync(backup, 'utf8') : current;
        const result = patchSource(source);
        if (result.missing.length) errors.push(`${file}: ${result.missing.join(', ')}`);
      } catch (error) { errors.push(`${file}: ${error.message}`); }
    }
  }
  return { ok: errors.length === 0, errors };
}

export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => hasPatch(source)
  && (source.includes("name: 'agent_spawn'") ? nativeAgentContract(source) : nativeHooksContract(source));

export const descriptor = {
  name: 'ruflo-model-contract', missingIsIncomplete: true,
  discover, preflight, patchSource, reverse: reverseSource, hasPatch, isPatched,
};
