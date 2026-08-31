// RuvNet Brain #224/#225: protect source symbol routing from inherited JSON-object
// keys and remove unproved package-manager/GitHub repair instructions from generic
// retrieval failures. Only the active shared KB executable is patched; updater,
// version selection, stores, sidecars, models, receipts, and learning data are not.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import {
  probeSymbolRouteSource,
  safeCliFailureGuidance,
  safeMcpFailureGuidance,
} from './probes.mjs';

export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#224/#225)';

export const ROUTE_ANCHOR = `  const push = (m) => { if (m) for (const p of m) out.add(p); };
  for (const t of snake) push(sym.bySymbol[t]);
  for (const t of pkgs) { push(sym.byPackage[t]); push(sym.bySymbol[t]); }
  for (const t of words) { push(sym.bySymbol[t]); push(sym.byStem[t]); }`;

export const ROUTE_REPLACEMENT = `  // ${PATCH_MARKER}: JSON.parse returns ordinary objects. Never route inherited
  // keys such as "constructor", and never iterate a malformed sidecar value.
  const ownList = (table, key) => table
    && Object.hasOwn(table, key)
    && Array.isArray(table[key])
    ? table[key]
    : [];
  const push = (items) => { for (const p of items) out.add(p); };
  for (const t of snake) push(ownList(sym.bySymbol, t));
  for (const t of pkgs) {
    push(ownList(sym.byPackage, t));
    push(ownList(sym.bySymbol, t));
  }
  for (const t of words) {
    push(ownList(sym.bySymbol, t));
    push(ownList(sym.byStem, t));
  }`;

export const MCP_GUIDANCE_ANCHOR = `        const body =
          \`🚨🚨🚨 RUVNET BRAIN IS DOWN — ALL \${repos.length} repos failed to search. 🚨🚨🚨\\n\\n\`
          + \`This is NOT an empty result. Retrieval itself is broken; no RuvNet grounding is possible right now.\\n\`
          + \`First error: \${firstErr}\\n\\n\`
          + \`Most likely fix:  cd ~/.cache/ruvnet-brain/kb && npm i\\n\`
          + \`Then verify:      npx github:stuinfla/ruvnet-brain --doctor\\n\\n\`
          + \`➡ INSTRUCTION TO THE MODEL: tell the user PLAINLY and PROMINENTLY, before anything else, \`
          + \`that the RuvNet Brain is broken and needs the fix above. Do NOT answer RuvNet questions \`
          + \`from memory, and do NOT proceed as if this were a normal empty search.\`;`;

export const MCP_GUIDANCE_REPLACEMENT = `        // ${PATCH_MARKER}: an unclassified exception proves no repair action.
        const body =
          \`🚨🚨🚨 RUVNET BRAIN IS DOWN — ALL \${repos.length} repos failed to search. 🚨🚨🚨\\n\\n\`
          + \`This is NOT an empty result. Retrieval itself is broken; no RuvNet grounding is possible right now.\\n\`
          + \`First error: \${firstErr}\\n\\n\`
          + \`No repair is implied by this unclassified failure. Preserve installed bytes and data; \`
          + \`do not repair, mutate, install, download, or reinstall the Brain automatically.\\n\\n\`
          + \`➡ INSTRUCTION TO THE MODEL: tell the user plainly that source retrieval failed and report \`
          + \`the exact error. Do NOT answer RuvNet questions from memory and do NOT mutate the installed \`
          + \`runtime. Use only the active installation's native diagnostics after user approval.\`;`;

export const CLI_GUIDANCE_ANCHOR = `    console.error('Fix:    cd ~/.cache/ruvnet-brain/kb && npm i');
    console.error('Verify: npx github:stuinfla/ruvnet-brain --doctor\\n');`;

export const CLI_GUIDANCE_REPLACEMENT = `    // ${PATCH_MARKER}: preserve the exact error; generic failure does not prove a repair.
    console.error('No automatic repair is safe for an unclassified retrieval failure.');
    console.error('Do not repair, mutate, install, download, or reinstall the Brain automatically.\\n');`;

const occurrences = (source, needle) => {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    count++;
    offset += needle.length;
  }
  return count;
};

const kindOf = (source) => {
  if (source.includes('function symbolRoute(query, sym)')) return 'router';
  if (source.includes('forge-mcp-all.mjs') || source.includes('function outage(id, repos, firstErr)')) return 'mcp';
  if (source.includes('forge-ask-all.mjs') || source.includes('function outage(failed)')) return 'cli';
  return null;
};

const satisfied = (source, kind) => {
  if (kind === 'router') return probeSymbolRouteSource(source).state === 'proven';
  if (kind === 'mcp') return safeMcpFailureGuidance(source);
  if (kind === 'cli') return safeCliFailureGuidance(source);
  return false;
};

export function patchSource(pristine) {
  const kind = kindOf(pristine);
  if (!kind) return { next: pristine, applied: [], missing: ['unrecognized-brain-search-file'] };
  if (satisfied(pristine, kind)) return { next: pristine, applied: [], missing: [] };

  const [id, find, replace] = kind === 'router'
    ? ['own-symbol-values', ROUTE_ANCHOR, ROUTE_REPLACEMENT]
    : kind === 'mcp'
      ? ['safe-mcp-failure-guidance', MCP_GUIDANCE_ANCHOR, MCP_GUIDANCE_REPLACEMENT]
      : ['safe-cli-failure-guidance', CLI_GUIDANCE_ANCHOR, CLI_GUIDANCE_REPLACEMENT];
  const count = occurrences(pristine, find);
  if (count !== 1) {
    return {
      next: pristine,
      applied: [],
      missing: [count > 1 ? `${id}(AMBIGUOUS: anchor occurs ${count}x)` : id],
    };
  }
  return { next: pristine.replace(find, replace), applied: [id], missing: [] };
}

export function reverseSource(patched) {
  return patched
    .replace(ROUTE_REPLACEMENT, ROUTE_ANCHOR)
    .replace(MCP_GUIDANCE_REPLACEMENT, MCP_GUIDANCE_ANCHOR)
    .replace(CLI_GUIDANCE_REPLACEMENT, CLI_GUIDANCE_ANCHOR);
}

export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => satisfied(source, kindOf(source));

export function kbRoot() {
  if (process.env.RSP_RUVNET_BRAIN_KB) return path.resolve(process.env.RSP_RUVNET_BRAIN_KB);
  const home = process.env.RSP_RUVNET_BRAIN_HOME
    ? path.resolve(process.env.RSP_RUVNET_BRAIN_HOME)
    : path.join(HOME_BASE, '.cache', 'ruvnet-brain');
  return path.join(home, 'kb');
}

export function sourceFiles() {
  const root = kbRoot();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name !== 'ruvnet-brain-kb') return [];
  } catch { return []; }

  return ['forge-ask.mjs', 'forge-mcp-all.mjs', 'forge-ask-all.mjs']
    .map((name) => path.join(root, name))
    .filter((file) => {
      try {
        const stat = fs.lstatSync(file);
        return stat.isFile() && !stat.isSymbolicLink();
      } catch { return false; }
    });
}

export const discover = sourceFiles;

export const descriptor = {
  name: 'brain-search-safety',
  atomic: true,
  missingIsIncomplete: true,
  discover,
  patchSource,
  isPatched,
  hasPatch,
  reverse: reverseSource,
};
