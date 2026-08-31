// Exact source fragments for the issue-backed ruflo-adr I/O safety patch.
// Separate fragments keep patch discovery small and let tests execute the
// generated vendor code without touching a real AgentDB store.

export const PATCH_MARKER = 'ruflo-source-patch (ruvnet/ruflo#3147/#3097)';

export const COMMON_IMPORT_ANCHOR = "import { spawnSync } from 'node:child_process';";
export const COMMON_IMPORT_REPLACEMENT = `${COMMON_IMPORT_ANCHOR}
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';`;

export const runtimeFragment = (rootAnchor) => `${rootAnchor}

// ${PATCH_MARKER}: scan scope and managed-store identity are distinct.
function validatedDirectory(input, label) {
  const resolved = resolve(input);
  try {
    if (!statSync(resolved).isDirectory()) throw new Error('not a directory');
    return realpathSync(resolved);
  } catch (error) {
    throw new Error(label + ' is not a readable directory: ' + resolved + ' (' + error.message + ')');
  }
}
function projectRoot(scanRoot) {
  let current = validatedDirectory(scanRoot, 'ADR scan root');
  while (true) {
    if (existsSync(join(current, '.ruflo-project'))) return current;
    if (existsSync(join(current, 'CLAUDE.md')) && existsSync(join(current, '.claude'))) return current;
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('ADR scan root has no authoritative project marker; set ADR_DB_ROOT or ADR_DB_PATH explicitly');
}
function explicitDatabasePath(input) {
  const resolved = resolve(input);
  const parent = realpathSync(dirname(resolved));
  const canonical = join(parent, basename(resolved));
  if (existsSync(canonical)) {
    const stat = lstatSync(canonical);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('ADR_DB_PATH must name a regular non-symlink file');
  }
  return canonical;
}
function configuredDatabasePath(root) {
  for (const file of [join(root, 'claude-flow.config.json'), join(root, '.claude-flow', 'config.json')]) {
    if (!existsSync(file)) continue;
    let config;
    try { config = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) { throw new Error('cannot parse managed memory configuration ' + file + ': ' + error.message); }
    const configured = config?.memory?.persistPath ?? config?.memory?.path;
    if (configured === undefined) continue;
    if (typeof configured !== 'string' || configured.length === 0) {
      throw new Error('managed memory path in ' + file + ' must be a nonempty string');
    }
    const candidate = resolve(root, configured);
    return /\\.db$/i.test(candidate) ? candidate : join(candidate, 'memory.db');
  }
  return null;
}
const SCAN_ROOT = validatedDirectory(ROOT, 'ADR scan root');
const explicitPath = process.env.ADR_DB_PATH || null;
const explicitRoot = process.env.ADR_DB_ROOT
  ? validatedDirectory(process.env.ADR_DB_ROOT, 'ADR_DB_ROOT')
  : null;
const authorityRoot = explicitRoot || (
  explicitPath || process.env.CLAUDE_FLOW_DB_PATH || process.env.CLAUDE_FLOW_MEMORY_PATH
    ? null
    : projectRoot(SCAN_ROOT)
);
const selectedPath = explicitPath
  || (explicitRoot ? join(explicitRoot, '.swarm', 'memory.db') : null)
  || process.env.CLAUDE_FLOW_DB_PATH
  || (process.env.CLAUDE_FLOW_MEMORY_PATH ? join(process.env.CLAUDE_FLOW_MEMORY_PATH, 'memory.db') : null)
  || configuredDatabasePath(authorityRoot)
  || join(authorityRoot, '.swarm', 'memory.db');
const DB_PATH = explicitDatabasePath(selectedPath);
const DB_ROOT = authorityRoot || dirname(DB_PATH);
const MEMORY_TIMEOUT_MS = (() => {
  const value = Number(process.env.ADR_MEMORY_TIMEOUT_MS || 30000);
  if (!Number.isInteger(value) || value < 1000 || value > 300000) {
    throw new Error('ADR_MEMORY_TIMEOUT_MS must be an integer from 1000 to 300000');
  }
  return value;
})();
const MEMORY_MAX_ROWS = (() => {
  const value = Number(process.env.ADR_MEMORY_MAX_ROWS || 100000);
  if (!Number.isInteger(value) || value < 1 || value > 1000000) {
    throw new Error('ADR_MEMORY_MAX_ROWS must be an integer from 1 to 1000000');
  }
  return value;
})();
const MANAGED_CLI = (() => {
  const configured = process.env.RUFLO_ADR_CLI;
  if (!configured) return 'ruflo';
  if (!isAbsolute(configured)) throw new Error('RUFLO_ADR_CLI must be an absolute path');
  const canonical = realpathSync(configured);
  if (!statSync(canonical).isFile()) throw new Error('RUFLO_ADR_CLI must resolve to a regular file');
  return canonical;
})();
function stripAnsi(value) {
  return String(value || '').replace(/\\x1b\\[[0-9;]*m/g, '');
}
function commandFailure(result, inspectContent = true) {
  const text = stripAnsi(String(result.stderr || '') + '\\n' + String(result.stdout || '')).trim();
  if (result.error) return (result.error.code || result.error.name || 'spawn') + ': ' + result.error.message;
  if (result.signal) return 'terminated by ' + result.signal + (text ? ': ' + text : '');
  if (result.status !== 0) return 'exit ' + String(result.status) + (text ? ': ' + text : '');
  if (inspectContent && /\\[(?:ERROR|FAIL(?:ED)?)\\]|\\bREFUSING\\b|persistence is not guaranteed/i.test(text)) {
    return text || 'memory command reported failure';
  }
  return null;
}
function runMemory(args, inspectContent = true) {
  // Use the installed Ruflo runtime, which owns the live native AgentDB driver.
  // An npx cache can resolve the same package name without its native optional
  // dependency and silently fall back to sql.js, which cannot read a live WAL.
  const result = spawnSync(MANAGED_CLI, ['memory', ...args, '--path=' + DB_PATH], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', cwd: DB_ROOT,
    timeout: MEMORY_TIMEOUT_MS, killSignal: 'SIGTERM', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CLI_CORE: '', NO_COLOR: '1' },
  });
  const error = commandFailure(result, inspectContent);
  return {
    ok: !error,
    error,
    stdout: String(result.stdout || ''),
    output: stripAnsi(String(result.stderr || '') + '\\n' + String(result.stdout || '')).trim(),
  };
}
function memoryListComplete(namespace) {
  const call = runMemory([
    'list', '--namespace', namespace, '--limit', String(MEMORY_MAX_ROWS + 1), '--format', 'json',
  ]);
  if (!call.ok) throw new Error(namespace + ': ' + call.error);
  let entries;
  try { entries = JSON.parse(stripAnsi(call.stdout).trim()); }
  catch (error) { throw new Error(namespace + ': malformed JSON from memory list: ' + error.message); }
  if (!Array.isArray(entries)) throw new Error(namespace + ': memory list did not return a JSON array');
  if (entries.length > MEMORY_MAX_ROWS) {
    throw new Error(namespace + ': exceeded the bounded ' + MEMORY_MAX_ROWS + '-row proof; completeness is unproved');
  }
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string' || entry.key.length === 0) {
      throw new Error(namespace + ': memory list returned an entry without a nonempty string key');
    }
    if (entry.namespace !== undefined && entry.namespace !== namespace) {
      throw new Error(namespace + ': memory list returned a row from namespace ' + String(entry.namespace));
    }
  }
  return entries;
}
function proveManagedValue(namespace, key, expected) {
  const read = runMemory(['retrieve', '--namespace', namespace, '--key', key, '--value-only'], false);
  if (!read.ok) return 'fresh-process readback failed: ' + read.error;
  if (read.stdout !== expected) return 'fresh-process readback did not byte-match the submitted value';
  return null;
}
function exactKeySet(expected, entries) {
  const wanted = new Set(expected);
  const actual = new Set(entries.map((entry) => entry.key));
  const missing = [...wanted].filter((key) => !actual.has(key));
  const extra = [...actual].filter((key) => !wanted.has(key));
  return { ok: missing.length === 0 && extra.length === 0, missing, extra, expected: wanted.size, actual: actual.size };
}`;

export const VERIFY_CLI_ANCHOR = `const CLI_PKG = process.env.CLI_CORE === '1'
  ? '@claude-flow/cli-core@alpha'
  : '@claude-flow/cli@latest';`;
export const VERIFY_CLI_REPLACEMENT = `const CLI_PKG = '@claude-flow/cli@latest';
if (process.env.CLI_CORE === '1') {
  console.warn('[ruflo-adr] warning: CLI_CORE=1 is ignored; ADR I/O uses the installed Ruflo runtime and one exact managed store (#2781/#3097).');
}`;
export const VERIFY_ROOT_ANCHOR = 'const ROOT = process.env.ADR_ROOT || process.cwd();';
export const VERIFY_IO_ANCHOR = `function memoryListJson(namespace) {
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'list',
    '--namespace', namespace, '--format', 'json',
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', cwd: ROOT });
  if (r.status !== 0) return [];
  const m = /\\[[\\s\\S]*\\]/.exec(r.stdout || '');
  if (!m) return [];
  try { return JSON.parse(m[0]); } catch { return []; }
}
function memoryRetrieve(namespace, key) {
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'retrieve',
    '--namespace', namespace, '--key', key,
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', cwd: ROOT });
  if (r.status !== 0) return null;
  // Strip ANSI / box-drawing
  const txt = (r.stdout || '').replace(/\\x1b\\[[0-9;]*m/g, '');
  return txt;
}

const patternEntries = memoryListJson('adr-patterns');
const edgeEntries = memoryListJson('adr-edges');`;
export const VERIFY_IO_REPLACEMENT = `let patternEntries;
let edgeEntries;
try {
  patternEntries = memoryListComplete('adr-patterns');
  edgeEntries = memoryListComplete('adr-edges');
} catch (error) {
  const failure = { ok: false, readErrors: [error.message], scannedRoot: SCAN_ROOT, databasePath: DB_PATH };
  if (process.env.VERIFY_FORMAT === 'json') console.log(JSON.stringify(failure, null, 2));
  else console.error('ADR graph verification FAILED before graph analysis: ' + error.message);
  process.exit(1);
}`;
export const VERIFY_EDGE_ANCHOR = `  const parsed = parseEdgeKey(k);
  if (parsed) edges.push(parsed);`;
export const VERIFY_EDGE_REPLACEMENT = `  const parsed = parseEdgeKey(k);
  if (!parsed) {
    console.error('ADR graph verification FAILED: malformed adr-edges key: ' + k);
    process.exit(1);
  }
  edges.push(parsed);`;

export const IMPORT_ROOT_ANCHOR = 'const ROOT = process.env.ADR_ROOT || process.cwd();';
export const SCAN_CALLS_ANCHOR = `const files = findAdrs(ROOT);
const adrs = files.map((f) => parseAdr(f, ROOT));`;
export const SCAN_CALLS_REPLACEMENT = `const files = findAdrs(SCAN_ROOT);
const adrs = files.map((f) => parseAdr(f, SCAN_ROOT));`;
export const IMPORT_STORE_ANCHOR_START = 'function memoryStore(namespace, key, value) {';
export const IMPORT_STORE_ANCHOR_END = "\n\nconst dryRun = process.env.IMPORT_DRY_RUN === '1';";
export const IMPORT_STORE_REPLACEMENT = `function memoryStore(namespace, key, value) {
  const expected = typeof value === 'string' ? value : JSON.stringify(value);
  const args = memoryStoreArgs(namespace, key, value);
  const call = runMemory(args.slice(2));
  if (!call.ok) return 'error: ' + call.error.slice(0, 500);
  if (!/Data stored successfully/i.test(call.output)) {
    return 'error: memory store returned no success receipt: ' + call.output.slice(0, 300);
  }
  const proofError = proveManagedValue(namespace, key, expected);
  return proofError ? 'error: ' + proofError : 'ok';
}
// Compatibility for a still-installed legacy #2660 composition. Its orphan
// report calls memoryCount(); keep that call on this target's complete,
// explicit-path managed reader instead of restoring the old inferred-cwd read.
function memoryCount(namespace) {
  try { return memoryListComplete(namespace).length; }
  catch { return null; }
}`;
export const IMPORT_LOOP_ANCHOR_START = 'let storedRecords = 0, storedEdges = 0;';
export const IMPORT_LOOP_ANCHOR_END = '\n\nconst danglingRefs = allEdges.filter';
export const IMPORT_LOOP_REPLACEMENT = `let storedRecords = 0, storedEdges = 0;
let attemptedWrites = 0;
let postCondition = null;
const errors = [];
if (!dryRun) {
  try {
    memoryListComplete('adr-patterns');
    memoryListComplete('adr-edges');
  } catch (error) {
    errors.push('managed writer preflight failed before any store: ' + error.message);
  }
  const totalWrites = adrs.length + allEdges.length;
  const progress = () => {
    if (attemptedWrites === totalWrites || attemptedWrites % 25 === 0) {
      console.error('[ruflo-adr] verified ' + (storedRecords + storedEdges) + '/' + totalWrites + ' managed write(s)');
    }
  };
  if (errors.length === 0) {
    for (const a of adrs) {
      const r = memoryStore('adr-patterns', adrRecordKey(a), adrRecordValue(a));
      attemptedWrites++;
      if (r === 'ok') { storedRecords++; progress(); }
      else { errors.push(a.id + ' ' + a.file + ': ' + r); break; }
    }
  }
  if (errors.length === 0) {
    for (const e of allEdges) {
      const r = memoryStore('adr-edges', edgeKey(e), edgeValue(e));
      attemptedWrites++;
      if (r === 'ok') { storedEdges++; progress(); }
      else { errors.push(edgeKey(e) + ': ' + r); break; }
    }
  }
  if (errors.length === 0) {
    try {
      const records = exactKeySet(adrs.map(adrRecordKey), memoryListComplete('adr-patterns'));
      const edges = exactKeySet(allEdges.map(edgeKey), memoryListComplete('adr-edges'));
      postCondition = { ok: records.ok && edges.ok, records, edges };
      if (!postCondition.ok) errors.push('managed post-condition found missing or stale ADR graph keys; safe atomic reindex is not yet available');
    } catch (error) {
      errors.push('managed post-condition failed: ' + error.message);
    }
  }
}
// Preserve the legacy #2660 report contract when that target is still selected.
// The old count heuristic is replaced by the exact final key-set proof above.
const desiredRecords = adrs.length;
const desiredEdges = new Set(allEdges.map(edgeKey)).size;
const orphans = !dryRun && postCondition ? {
  records: postCondition.records.extra.length,
  edges: postCondition.edges.extra.length,
} : null;`;

export const REINDEX_ROOT_ANCHOR = 'const ROOT = process.env.ADR_ROOT || process.cwd();';
export const REINDEX_RESULT_ANCHOR = `  scannedRoot: ROOT,
  total: adrs.length,`;
export const REINDEX_RESULT_REPLACEMENT = `  scannedRoot: SCAN_ROOT,
  databaseRoot: DB_ROOT,
  databasePath: DB_PATH,
  total: adrs.length,`;
export const REINDEX_DRY_RUN_ANCHOR = '  console.log(`Would purge + rebuild \\`adr-patterns\\` and \\`adr-edges\\` from ${result.total} ADR file(s) under ${ROOT}.`);';
export const REINDEX_DRY_RUN_REPLACEMENT = '  console.log(`Inspected ${result.total} ADR file(s) under ${SCAN_ROOT}; live reindex is refused until Ruflo provides atomic managed reconcile (#3097).`);';
export const REINDEX_OUTPUT_ROOT_ANCHOR = '  console.log(`Scanned root: ${ROOT}`);';
export const REINDEX_OUTPUT_ROOT_REPLACEMENT = '  console.log(`Scanned root: ${SCAN_ROOT}`);\n  console.log(`Managed database: ${DB_PATH}`);';
export const REINDEX_MUTATION_ANCHOR_START = '// Step 1: hard-purge both namespaces (drop).';
export const REINDEX_MUTATION_ANCHOR_END = "\n\nif (fmt === 'json') {";
export const REINDEX_MUTATION_REPLACEMENT = `// ${PATCH_MARKER}: current Ruflo has no atomic managed reconcile.
// Refuse before the first purge rather than turn a later failure into data loss.
for (const ns of NAMESPACES) {
  result.purge[ns] = { success: false, error: 'not attempted — live purge-first reindex is unsafe' };
}
result.postCondition = { expected: adrs.length, actual: null, ok: false };
result.errors.push(
  'REFUSING live reindex before any purge: Ruflo lacks a managed atomic reconcile/rollback primitive. ' +
  'Use REINDEX_DRY_RUN=1 for inspection; track ruvnet/ruflo#3097 for the upstream implementation.'
);`;

export function replaceRegion(source, start, end, replacement) {
  const from = source.indexOf(start);
  if (from < 0) return null;
  const to = source.indexOf(end, from + start.length);
  if (to < 0) return null;
  return source.slice(0, from) + replacement + source.slice(to);
}
