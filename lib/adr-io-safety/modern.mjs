// Exact native ruflo-adr 0.4.1/0.5.4 variants, preserving the managed I/O owner.
import { IMPORT_ROOT_ANCHOR, VERIFY_IO_ANCHOR, VERIFY_CLI_ANCHOR } from './fragments.mjs';
const IMPORT_ROOT = "const ROOT = resolve(process.env.ADR_ROOT || process.cwd());\n\n// ADR_ROOT limits which files are scanned; it is not necessarily the project\n// root from which the memory CLI resolves .swarm/memory.db. Prefer the nearest\n// repository/runtime marker, then a package root for projects without Git.\nfunction projectRoot(scanRoot) {\n  if (process.env.ADR_DB_ROOT) return resolve(process.env.ADR_DB_ROOT);\n  let dir = scanRoot;\n  let packageRoot;\n  while (true) {\n    if (existsSync(join(dir, '.git')) || existsSync(join(dir, '.swarm'))) return dir;\n    if (!packageRoot && existsSync(join(dir, 'package.json'))) packageRoot = dir;\n    const parent = dirname(dir);\n    if (parent === dir) return packageRoot || scanRoot;\n    dir = parent;\n  }\n}\n\nconst DB_ROOT = projectRoot(ROOT);\n\n";
const VERIFY_READ = "// The CLI has no cursor/offset flag. Request one more than our maximum and\n// refuse a full response, since its default --limit=20 cannot prove a graph.\nconst MAX_ROWS = 10_000;\nconst READ_LIMIT = MAX_ROWS + 1;\nconst READ_TIMEOUT_MS = Math.min(120_000, Math.max(100,\n  Number(process.env.ADR_VERIFY_TIMEOUT_MS) || 60_000));\nconst MAX_BUFFER = 32 * 1024 * 1024;\n\nfunction memoryListJson(namespace) {\n  const r = spawnSync('npx', [\n    CLI_PKG, 'memory', 'list',\n    `--namespace=${namespace}`, '--format=json', `--limit=${READ_LIMIT}`,\n  ], {\n    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', cwd: ROOT,\n    timeout: READ_TIMEOUT_MS, maxBuffer: MAX_BUFFER,\n  });\n  const fail = (error) => ({ ok: false, namespace, error });\n  if (r.error) return fail(`memory list failed: ${r.error.message}`);\n  if (r.signal) return fail(`memory list terminated by ${r.signal}`);\n  if (r.status !== 0) {\n    const detail = (r.stderr || r.stdout || '').trim().slice(0, 300);\n    return fail(`memory list exited ${r.status}${detail ? `: ${detail}` : ''}`);\n  }\n  let entries;\n  try {\n    entries = JSON.parse((r.stdout || '').trim());\n  } catch (error) {\n    return fail(`memory list returned invalid JSON: ${error.message}`);\n  }\n  if (!Array.isArray(entries)) return fail('memory list returned JSON other than an array');\n  if (entries.length >= READ_LIMIT) {\n    return fail(`memory list reached ${READ_LIMIT} rows; completeness cannot be proven`);\n  }\n  for (const [index, entry] of entries.entries()) {\n    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||\n        typeof entry.key !== 'string' || !entry.key.trim()) {\n      return fail(`memory list row ${index} has no valid key`);\n    }\n    if (entry.namespace !== undefined && entry.namespace !== namespace) {\n      return fail(`memory list row ${index} belongs to ${entry.namespace}, not ${namespace}`);\n    }\n  }\n  return { ok: true, entries };\n}\n\nconst patternRead = memoryListJson('adr-patterns');\nconst edgeRead = memoryListJson('adr-edges');\nconst readErrors = [patternRead, edgeRead].filter((read) => !read.ok)\n  .map(({ namespace, error }) => ({ namespace, error }));\nif (readErrors.length === 0) {\n  for (const [index, entry] of edgeRead.entries.entries()) {\n    if (!parseEdgeKey(entry.key)) {\n      readErrors.push({ namespace: 'adr-edges', error: `row ${index} has an invalid edge key: ${entry.key}` });\n    }\n  }\n}\nif (readErrors.length) {\n  if (process.env.VERIFY_FORMAT === 'json') {\n    console.log(JSON.stringify({ scannedRoot: ROOT, readErrors }, null, 2));\n  } else {\n    console.log('## ADR Graph Verification FAILED');\n    console.log('');\n    for (const { namespace, error } of readErrors) console.log(`- ${namespace}: ${error}`);\n  }\n  process.exit(1);\n}\n\nconst patternEntries = patternRead.entries;\nconst edgeEntries = edgeRead.entries;\n";
export function normalizeNativeAdr(source, kind) {
  let next = source;
  // #3558 (0.5.4) replaces npx dispatch with this exact installed-CLI helper.
  // Normalize only its known call forms; the existing owner then installs the
  // stronger explicit-path/readback boundary without a second driver.
  const helperImport = "import { spawnCliSync } from './lib/ruflo-cli.mjs';";
  if (source.split(helperImport).length === 2) {
    next = next.replace(helperImport, "import { spawnSync } from 'node:child_process';")
      .replaceAll('spawnCliSync([', "spawnSync('npx', [")
      .replace('spawnCliSync(memoryStoreArgs(', "spawnSync('npx', memoryStoreArgs(");
  }
  if (kind === 'import' && next.includes(IMPORT_ROOT)) {
    next = next.replace("import { existsSync } from 'node:fs';\n", '')
      .replace("import { dirname, join, resolve } from 'node:path';\n", '')
      .replace(IMPORT_ROOT, IMPORT_ROOT_ANCHOR + '\n\n');
  }
  if (kind === 'verify' && next.includes(VERIFY_READ)) {
    next = next.replace("import { CLI_PKG, parseEdgeKey } from './lib/index-records.mjs';",
      "import { parseEdgeKey } from './lib/index-records.mjs';\n" + VERIFY_CLI_ANCHOR)
      .replace(VERIFY_READ, VERIFY_IO_ANCHOR + '\n');
  }
  return next;
}
