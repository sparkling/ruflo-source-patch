// Ruflo #3147/#3097: fail-closed ADR graph reads and managed, proven writes.
// No raw SQLite, WAL manipulation, updater override, or destructive fallback.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import {
  PATCH_MARKER,
  COMMON_IMPORT_ANCHOR,
  COMMON_IMPORT_REPLACEMENT,
  runtimeFragment,
  VERIFY_CLI_ANCHOR,
  VERIFY_CLI_REPLACEMENT,
  VERIFY_ROOT_ANCHOR,
  VERIFY_IO_ANCHOR,
  VERIFY_IO_REPLACEMENT,
  VERIFY_EDGE_ANCHOR,
  VERIFY_EDGE_REPLACEMENT,
  IMPORT_ROOT_ANCHOR,
  SCAN_CALLS_ANCHOR,
  SCAN_CALLS_REPLACEMENT,
  IMPORT_STORE_ANCHOR_START,
  IMPORT_STORE_ANCHOR_END,
  IMPORT_STORE_REPLACEMENT,
  IMPORT_LOOP_ANCHOR_START,
  IMPORT_LOOP_ANCHOR_END,
  IMPORT_LOOP_REPLACEMENT,
  REINDEX_ROOT_ANCHOR,
  REINDEX_RESULT_ANCHOR,
  REINDEX_RESULT_REPLACEMENT,
  REINDEX_DRY_RUN_ANCHOR,
  REINDEX_DRY_RUN_REPLACEMENT,
  REINDEX_OUTPUT_ROOT_ANCHOR,
  REINDEX_OUTPUT_ROOT_REPLACEMENT,
  REINDEX_MUTATION_ANCHOR_START,
  REINDEX_MUTATION_ANCHOR_END,
  REINDEX_MUTATION_REPLACEMENT,
  replaceRegion,
} from './fragments.mjs';

export { PATCH_MARKER };

const SCRIPT_NAMES = ['verify.mjs', 'import.mjs', 'reindex.mjs'];

const occurrences = (source, needle) => {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    count++;
    offset += needle.length;
  }
  return count;
};

function replaceExact(source, id, find, replacement, applied, missing) {
  if (source.includes(replacement)) return source;
  const count = occurrences(source, find);
  if (count !== 1) {
    missing.push(count > 1 ? `${id}(AMBIGUOUS:${count})` : id);
    return source;
  }
  applied.push(id);
  return source.replace(find, replacement);
}

function replaceBounded(source, id, start, end, replacement, applied, missing) {
  if (source.includes(replacement)) return source;
  if (occurrences(source, start) !== 1 || occurrences(source, end) !== 1) {
    missing.push(id);
    return source;
  }
  const next = replaceRegion(source, start, end, replacement);
  if (next === null) {
    missing.push(id);
    return source;
  }
  applied.push(id);
  return next;
}

function patchVerify(pristine) {
  const applied = [], missing = [];
  let next = pristine;
  next = replaceExact(next, 'managed-imports', COMMON_IMPORT_ANCHOR, COMMON_IMPORT_REPLACEMENT, applied, missing);
  next = replaceExact(next, 'same-managed-cli', VERIFY_CLI_ANCHOR, VERIFY_CLI_REPLACEMENT, applied, missing);
  next = replaceExact(next, 'scan-store-identity', VERIFY_ROOT_ANCHOR, runtimeFragment(VERIFY_ROOT_ANCHOR), applied, missing);
  next = replaceExact(next, 'complete-fail-closed-read', VERIFY_IO_ANCHOR, VERIFY_IO_REPLACEMENT, applied, missing);
  next = replaceExact(next, 'malformed-edge-failure', VERIFY_EDGE_ANCHOR, VERIFY_EDGE_REPLACEMENT, applied, missing);
  return { next, applied, missing };
}

function patchImport(pristine) {
  const applied = [], missing = [];
  let next = pristine;
  next = replaceExact(next, 'managed-imports', COMMON_IMPORT_ANCHOR, COMMON_IMPORT_REPLACEMENT, applied, missing);
  next = replaceExact(next, 'cli-package-import', "import {\n  adrRecordKey,", "import {\n  CLI_PKG,\n  adrRecordKey,", applied, missing);
  next = replaceExact(next, 'scan-store-identity', IMPORT_ROOT_ANCHOR, runtimeFragment(IMPORT_ROOT_ANCHOR), applied, missing);
  next = replaceExact(next, 'canonical-scan-root', SCAN_CALLS_ANCHOR, SCAN_CALLS_REPLACEMENT, applied, missing);
  next = replaceBounded(next, 'store-and-fresh-readback', IMPORT_STORE_ANCHOR_START, IMPORT_STORE_ANCHOR_END, IMPORT_STORE_REPLACEMENT, applied, missing);
  next = replaceBounded(next, 'preflight-fail-fast-and-postcondition', IMPORT_LOOP_ANCHOR_START, IMPORT_LOOP_ANCHOR_END, IMPORT_LOOP_REPLACEMENT, applied, missing);
  next = replaceExact(next, 'result-roots', '  scannedRoot: ROOT,', '  scannedRoot: SCAN_ROOT,\n  databaseRoot: DB_ROOT,\n  databasePath: DB_PATH,\n  requestedWrites: adrs.length + allEdges.length,\n  attemptedWrites,\n  verifiedWrites: storedRecords + storedEdges,\n  postCondition,', applied, missing);
  next = replaceExact(next, 'json-exit', "  process.exit(0);\n}\n\nconsole.log('## ADR Index Summary');", "  process.exit(errors.length === 0 ? 0 : 1);\n}\n\nconsole.log('## ADR Index Summary');", applied, missing);
  next = replaceExact(next, 'markdown-db-path', "console.log(`Total ADRs: **${result.total}** across ${result.sourceDirs} source dirs (root: ${ROOT})`);", "console.log(`Total ADRs: **${result.total}** across ${result.sourceDirs} source dirs (scan: ${SCAN_ROOT})`);\nconsole.log(`Managed database: ${DB_PATH}`);", applied, missing);
  const finalLine = "for (const [s, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`- ${s}: ${n}`);";
  next = replaceExact(next, 'markdown-exit', finalLine, `${finalLine}\nprocess.exit(errors.length === 0 ? 0 : 1);`, applied, missing);
  return { next, applied, missing };
}

function patchReindex(pristine) {
  const applied = [], missing = [];
  let next = pristine;
  next = replaceExact(next, 'managed-imports', COMMON_IMPORT_ANCHOR, COMMON_IMPORT_REPLACEMENT, applied, missing);
  next = replaceExact(next, 'scan-store-identity', REINDEX_ROOT_ANCHOR, runtimeFragment(REINDEX_ROOT_ANCHOR), applied, missing);
  next = replaceExact(next, 'canonical-scan-root', SCAN_CALLS_ANCHOR, SCAN_CALLS_REPLACEMENT, applied, missing);
  next = replaceExact(next, 'result-roots', REINDEX_RESULT_ANCHOR, REINDEX_RESULT_REPLACEMENT, applied, missing);
  next = replaceExact(next, 'honest-dry-run', REINDEX_DRY_RUN_ANCHOR, REINDEX_DRY_RUN_REPLACEMENT, applied, missing);
  next = replaceBounded(next, 'refuse-destructive-reindex', REINDEX_MUTATION_ANCHOR_START, REINDEX_MUTATION_ANCHOR_END, REINDEX_MUTATION_REPLACEMENT, applied, missing);
  next = replaceExact(next, 'report-store-identity', REINDEX_OUTPUT_ROOT_ANCHOR, REINDEX_OUTPUT_ROOT_REPLACEMENT, applied, missing);
  return { next, applied, missing };
}

export function kindOf(source) {
  if (source.includes('// adr-verify —')) return 'verify';
  if (source.includes('// One-shot ADR importer')) return 'import';
  if (source.includes('// ADR index reconciler')) return 'reindex';
  return null;
}

export function patchSource(pristine) {
  if (hasPatch(pristine)) {
    return isPatched(pristine)
      ? { next: pristine, applied: [], missing: [] }
      : { next: pristine, applied: [], missing: ['partial-owned-patch'] };
  }
  const kind = kindOf(pristine);
  if (kind === 'verify') return patchVerify(pristine);
  if (kind === 'import') return patchImport(pristine);
  if (kind === 'reindex') return patchReindex(pristine);
  return { next: pristine, applied: [], missing: ['unrecognized-ruflo-adr-script'] };
}

export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => {
  if (!hasPatch(source) || !source.includes("'--path=' + DB_PATH")) return false;
  const kind = kindOf(source);
  if (kind === 'verify') return source.includes("patternEntries = memoryListComplete('adr-patterns')")
    && source.includes('malformed adr-edges key') && source.includes("const CLI_PKG = '@claude-flow/cli@latest'");
  if (kind === 'import') return source.includes('proveManagedValue(namespace, key, expected)')
    && source.includes('managed writer preflight failed before any store')
    && source.includes('process.exit(errors.length === 0 ? 0 : 1);');
  if (kind === 'reindex') return source.includes('REFUSING live reindex before any purge')
    && !source.includes('// Step 1: hard-purge both namespaces (drop).');
  return false;
};

export function activeRoots() {
  if (process.env.RSP_RUFLO_ADR_ROOTS) {
    return process.env.RSP_RUFLO_ADR_ROOTS.split(path.delimiter).filter(Boolean).map((root) => path.resolve(root));
  }
  const roots = [];
  const add = (root, boundary = root) => {
    const resolved = path.resolve(root);
    const base = path.resolve(boundary);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) return;
    if (fs.existsSync(path.join(resolved, '.claude-plugin', 'plugin.json'))) roots.push(resolved);
  };
  const claudeCache = path.join(HOME_BASE, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-adr');
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(HOME_BASE, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    for (const entry of registry?.plugins?.['ruflo-adr@ruflo'] || []) {
      const liveProjectScope = entry?.scope !== 'project'
        || (typeof entry?.projectPath === 'string' && fs.existsSync(entry.projectPath));
      if (entry?.enabled !== false && liveProjectScope && typeof entry?.installPath === 'string') {
        add(entry.installPath, claudeCache);
      }
    }
  } catch { /* Claude host absent or unreadable */ }
  const claudeMarket = path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', 'ruflo', 'plugins', 'ruflo-adr');
  add(claudeMarket);
  const codexHome = process.env.CODEX_HOME || path.join(HOME_BASE, '.codex');
  const codexMarket = path.join(codexHome, '.tmp', 'marketplaces', 'ruflo', 'plugins', 'ruflo-adr');
  add(codexMarket);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(codexMarket, '.claude-plugin', 'plugin.json'), 'utf8'));
    if (/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(manifest.version)) {
      const codexCache = path.join(codexHome, 'plugins', 'cache', 'ruflo', 'ruflo-adr');
      add(path.join(codexCache, manifest.version), codexCache);
    }
  } catch { /* Codex host absent or unreadable */ }
  return [...new Set(roots)];
}

export function discover() {
  return activeRoots().flatMap((root) => SCRIPT_NAMES.map((name) => path.join(root, 'scripts', name)));
}

export function preflight() {
  const errors = [];
  const roots = activeRoots();
  if (roots.length === 0) errors.push('no active ruflo-adr root could be identified');
  for (const root of roots) {
    for (const name of SCRIPT_NAMES) {
      const file = path.join(root, 'scripts', name);
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular non-symlink file');
        const outcome = patchSource(fs.readFileSync(file, 'utf8'));
        if (outcome.missing.length) throw new Error('missing exact anchors: ' + outcome.missing.join(', '));
      } catch (error) {
        errors.push(`${file}: ${error.message}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export const descriptor = {
  name: 'adr-io-safety', atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, isPatched, hasPatch,
};
