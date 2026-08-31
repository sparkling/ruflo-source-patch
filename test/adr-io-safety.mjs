// Ruflo #3147/#3097: exercise the real patched ADR scripts against a fake
// managed CLI. No test opens SQLite or touches a real memory database.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  VERIFY_CLI_ANCHOR,
  VERIFY_IO_ANCHOR,
  VERIFY_ROOT_ANCHOR,
  VERIFY_EDGE_ANCHOR,
  IMPORT_ROOT_ANCHOR,
  SCAN_CALLS_ANCHOR,
  REINDEX_ROOT_ANCHOR,
  REINDEX_RESULT_ANCHOR,
  REINDEX_MUTATION_ANCHOR_START,
  REINDEX_MUTATION_ANCHOR_END,
} from '../lib/adr-io-safety/fragments.mjs';

const input = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'adr-io-safety-'));
fs.mkdirSync(input, { recursive: true });
const SANDBOX = fs.realpathSync(input);
const ROOT = path.join(SANDBOX, 'plugin');
const SCRIPTS = path.join(ROOT, 'scripts');
const PROJECT = path.join(SANDBOX, 'project');
const DOCS = path.join(PROJECT, 'docs', 'adr');
const BIN = path.join(SANDBOX, 'bin');
const STATE = path.join(SANDBOX, 'memory-state.json');
const LOG = path.join(SANDBOX, 'calls.jsonl');
fs.mkdirSync(path.join(ROOT, '.claude-plugin'), { recursive: true });
fs.mkdirSync(path.join(SCRIPTS, 'lib'), { recursive: true });
fs.mkdirSync(path.join(PROJECT, '.git'), { recursive: true });
fs.mkdirSync(path.join(PROJECT, '.swarm'), { recursive: true });
fs.mkdirSync(DOCS, { recursive: true });
fs.mkdirSync(BIN, { recursive: true });
fs.writeFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), '{"name":"ruflo-adr","version":"test"}\n');
fs.writeFileSync(path.join(PROJECT, '.swarm', 'memory.db'), 'fake-not-sqlite\n');

let failed = 0;
const check = (description, condition) => {
  console.log(`${condition ? '✓' : '✘'} ${description}`);
  if (!condition) failed = 1;
};

const VERIFY_VENDOR = `#!/usr/bin/env node
// adr-verify — fixture
import { spawnSync } from 'node:child_process';
import { parseEdgeKey } from './lib/index-records.mjs';
${VERIFY_CLI_ANCHOR}
${VERIFY_ROOT_ANCHOR}
${VERIFY_IO_ANCHOR}
const adrIds = new Set(patternEntries.map((e) => (e.key || '').split('::')[0]).filter(Boolean));
const edges = [];
for (const e of edgeEntries) {
  const k = e.key || '';
${VERIFY_EDGE_ANCHOR}
}
const danglingRefs = edges.filter((e) => !adrIds.has(e.to));
const danglingFroms = edges.filter((e) => !adrIds.has(e.from));
const graph = new Map();
for (const e of edges.filter((e) => e.relation === 'supersedes')) {
  if (!graph.has(e.from)) graph.set(e.from, []);
  graph.get(e.from).push(e.to);
}
const cycles = [];
function walk(node, visited, stack) {
  if (stack.has(node)) { cycles.push([...stack, node].join(' -> ')); return; }
  if (visited.has(node)) return;
  visited.add(node); stack.add(node);
  for (const next of graph.get(node) || []) walk(next, visited, stack);
  stack.delete(node);
}
for (const node of graph.keys()) walk(node, new Set(), new Set());
const result = { adrCount: adrIds.size, edgeCount: edges.length, danglingRefs, danglingFroms, cycles: [...new Set(cycles)] };
if (process.env.VERIFY_FORMAT === 'json') console.log(JSON.stringify(result));
else console.log('ADRs: ' + result.adrCount + ', edges: ' + result.edgeCount);
const strict = process.env.VERIFY_STRICT === '1';
if (result.cycles.length || (strict && (result.danglingRefs.length || result.danglingFroms.length))) process.exit(1);
`;

const IMPORT_VENDOR = `#!/usr/bin/env node
// One-shot ADR importer fixture
import { spawnSync } from 'node:child_process';
import { findAdrs, parseAdr } from './lib/parse-adrs.mjs';
import {
  adrRecordKey,
  adrRecordValue,
  edgeKey,
  edgeValue,
  memoryStoreArgs,
  uniqueEdges,
} from './lib/index-records.mjs';
${IMPORT_ROOT_ANCHOR}
function memoryStore(namespace, key, value) {
  const r = spawnSync('npx', memoryStoreArgs(namespace, key, value), { encoding: 'utf8', cwd: ROOT });
  return r.status === 0 ? 'ok' : 'error';
}

const dryRun = process.env.IMPORT_DRY_RUN === '1';
const fmt = process.env.IMPORT_FORMAT || 'markdown';
${SCAN_CALLS_ANCHOR}
const byId = new Map();
const parsedEdges = [];
for (const a of adrs) { byId.set(a.id, a); parsedEdges.push(...a.links); }
const allEdges = uniqueEdges(parsedEdges);
let storedRecords = 0, storedEdges = 0;
const errors = [];
if (!dryRun) {
  for (const a of adrs) {
    const r = memoryStore('adr-patterns', adrRecordKey(a), adrRecordValue(a));
    if (r === 'ok') storedRecords++; else errors.push(a.id + ': ' + r);
  }
  for (const e of allEdges) {
    const r = memoryStore('adr-edges', edgeKey(e), edgeValue(e));
    if (r === 'ok') storedEdges++; else errors.push(edgeKey(e) + ': ' + r);
  }
}

const danglingRefs = allEdges.filter((e) => !byId.has(e.to));
const statusMismatches = [];
const byStatus = {}, byRelation = {}, bySource = { docs: adrs.length };
const result = {
  scannedRoot: ROOT,
  total: adrs.length, sourceDirs: 1, storedRecords, storedEdges, dryRun,
  byStatus, byRelation, bySource, edges: allEdges.length, danglingRefs, statusMismatches, errors,
};
if (fmt === 'json') {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log('## ADR Index Summary');
console.log('');
console.log(\`Total ADRs: **\${result.total}** across \${result.sourceDirs} source dirs (root: \${ROOT})\`);
console.log(\`Records stored: \${result.storedRecords}\`);
console.log('### Source breakdown');
for (const [s, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(\`- \${s}: \${n}\`);
`;

const REINDEX_DRY_VENDOR_LINE = '  console.log(`Would purge + rebuild \\`adr-patterns\\` and \\`adr-edges\\` from ${result.total} ADR file(s) under ${ROOT}.`);';
const REINDEX_VENDOR = `#!/usr/bin/env node
// ADR index reconciler fixture
import { spawnSync } from 'node:child_process';
import { findAdrs, parseAdr } from './lib/parse-adrs.mjs';
import { CLI_PKG, adrRecordKey, adrRecordValue, edgeKey, edgeValue, memoryStoreArgs, uniqueEdges } from './lib/index-records.mjs';
${REINDEX_ROOT_ANCHOR}
const dryRun = process.env.REINDEX_DRY_RUN === '1';
const fmt = process.env.REINDEX_FORMAT || 'markdown';
const NAMESPACES = ['adr-patterns', 'adr-edges'];
function purgeNamespace() { return { success: true }; }
function memoryStore() { return 'ok'; }
function memoryListCount() { return 0; }
${SCAN_CALLS_ANCHOR}
const parsedEdges = [];
for (const a of adrs) parsedEdges.push(...a.links);
const allEdges = uniqueEdges(parsedEdges);
const result = {
${REINDEX_RESULT_ANCHOR}
  edges: allEdges.length, dryRun, purge: {}, storedRecords: 0, storedEdges: 0, errors: [], postCondition: null,
};
if (dryRun) {
  if (fmt === 'json') { console.log(JSON.stringify(result)); process.exit(0); }
  console.log('## ADR Reindex (dry run — nothing purged or written)');
${REINDEX_DRY_VENDOR_LINE}
  process.exit(0);
}
${REINDEX_MUTATION_ANCHOR_START}
for (const ns of NAMESPACES) result.purge[ns] = purgeNamespace(ns);
for (const a of adrs) if (memoryStore('adr-patterns', adrRecordKey(a), adrRecordValue(a)) === 'ok') result.storedRecords++;
const recount = memoryListCount('adr-patterns');
result.postCondition = { expected: adrs.length, actual: recount, ok: recount === adrs.length };
${REINDEX_MUTATION_ANCHOR_END}
  console.log(JSON.stringify(result));
} else {
  console.log('## ADR Reindex Summary');
  console.log(\`Scanned root: \${ROOT}\`);
  for (const ns of NAMESPACES) console.log(result.purge[ns].success);
}
process.exit(result.postCondition.ok && result.errors.length === 0 ? 0 : 1);
`;

fs.writeFileSync(path.join(SCRIPTS, 'verify.mjs'), VERIFY_VENDOR);
fs.writeFileSync(path.join(SCRIPTS, 'import.mjs'), IMPORT_VENDOR);
fs.writeFileSync(path.join(SCRIPTS, 'reindex.mjs'), REINDEX_VENDOR);
fs.writeFileSync(path.join(SCRIPTS, 'lib', 'parse-adrs.mjs'), `
import path from 'node:path';
export const findAdrs = (root) => [path.join(root, 'ADR-001.md'), path.join(root, 'ADR-002.md')];
export const parseAdr = (file) => file.includes('002')
  ? { id: 'ADR-002', file, title: 'Two', status: 'accepted', links: [] }
  : { id: 'ADR-001', file, title: 'One', status: 'accepted', links: [{ relation: 'depends-on', from: 'ADR-001', to: 'ADR-002' }] };
`);
fs.writeFileSync(path.join(SCRIPTS, 'lib', 'index-records.mjs'), `
export const CLI_PKG = '@claude-flow/cli@latest';
export const adrRecordKey = (a) => a.id + '::' + a.file.split('/').pop();
export const adrRecordValue = (a) => JSON.stringify({ id: a.id, title: a.title });
export const edgeKey = (e) => e.relation + ':' + e.from + '->' + e.to;
export const edgeValue = (e) => JSON.stringify(e);
export const uniqueEdges = (edges) => [...new Map(edges.map((e) => [edgeKey(e), e])).values()];
export const memoryStoreArgs = (ns, key, value) => [CLI_PKG, 'memory', 'store', '--namespace=' + ns, '--key=' + key, '--upsert', '--value=' + (typeof value === 'string' ? value : JSON.stringify(value))];
export const parseEdgeKey = (key) => { const m = /^([^:]+):(.+)->(.+)$/.exec(key); return m ? { relation: m[1], from: m[2], to: m[3] } : null; };
`);

const FAKE_NPX = `#!/usr/bin/env node
const fs = require('node:fs');
const stateFile = process.env.FAKE_MEMORY_STATE;
const logFile = process.env.FAKE_MEMORY_LOG;
const args = process.argv.slice(2);
fs.appendFileSync(logFile, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
const op = args[2];
const option = (name) => {
  const eq = args.find((v) => v.startsWith('--' + name + '='));
  if (eq) return eq.slice(name.length + 3);
  const at = args.indexOf('--' + name);
  return at >= 0 ? args[at + 1] : undefined;
};
const mode = process.env.FAKE_MEMORY_MODE || 'success';
if (mode === 'timeout') return setTimeout(() => {}, 5000);
if (mode === 'signal') return process.kill(process.pid, 'SIGTERM');
if (mode === 'nonzero') { console.error('managed failure'); process.exit(7); }
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { 'adr-patterns': {}, 'adr-edges': {}, listCalls: 0 };
const ns = option('namespace');
if (op === 'list') {
  state.listCalls++;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  if (mode === 'malformed') { process.stdout.write('diagnostic\\n[]\\n'); process.exit(0); }
  if (mode === 'nonarray') { process.stdout.write('{"entries":[]}\\n'); process.exit(0); }
  if (mode === 'bad-entry') { process.stdout.write('[{}]\\n'); process.exit(0); }
  if (mode === 'wrong-namespace') { process.stdout.write('[{"key":"x","namespace":"other"}]\\n'); process.exit(0); }
  let rows = Object.entries(state[ns] || {}).map(([key]) => ({ key, namespace: ns }));
  if (mode === 'wrong-final' && state.listCalls > 2 && ns === 'adr-patterns' && rows.length) rows[0].key = 'ADR-WRONG::wrong.md';
  const limit = Number(option('limit') || 20);
  process.stdout.write(JSON.stringify(rows.slice(0, limit)) + '\\n');
  process.exit(0);
}
if (op === 'store') {
  if (mode === 'false-success') { console.log('operation finished'); process.exit(0); }
  const key = option('key'), value = option('value');
  state[ns] ||= {}; state[ns][key] = value;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  console.log('Data stored successfully');
  process.exit(0);
}
if (op === 'retrieve') {
  let value = state[ns]?.[option('key')];
  if (value === undefined) process.exit(1);
  if (mode === 'readback-mismatch') value += 'changed';
  process.stdout.write(value);
  process.exit(0);
}
console.error('unexpected fake operation: ' + op); process.exit(9);
`;
fs.writeFileSync(path.join(BIN, 'npx'), FAKE_NPX, { mode: 0o755 });

process.env.RUFLO_SOURCE_PATCH_HOME = SANDBOX;
process.env.RSP_NO_LAUNCHCTL = '1';
process.env.RSP_NO_SELF_UPDATE = '1';
process.env.RSP_RUFLO_ADR_ROOTS = ROOT;
const { patchSource } = await import('../lib/adr-io-safety/patcher.mjs');
const { probeNativeRoot } = await import('../lib/adr-io-safety/probes.mjs');
const { applyComposed, composeSource, reconcile, statusComposed } = await import('../lib/plugin-compose.mjs');

const applied = applyComposed(['adr-io-safety']);
check('AIS1 all three active scripts patch only after bundle preflight',
  applied.patched === 3 && statusComposed()['adr-io-safety'].patched === 3);
check('AIS2 each backup is exact vendor pristine',
  fs.readFileSync(path.join(SCRIPTS, 'verify.mjs.rsp-backup'), 'utf8') === VERIFY_VENDOR
  && fs.readFileSync(path.join(SCRIPTS, 'import.mjs.rsp-backup'), 'utf8') === IMPORT_VENDOR
  && fs.readFileSync(path.join(SCRIPTS, 'reindex.mjs.rsp-backup'), 'utf8') === REINDEX_VENDOR);
const again = applyComposed(['adr-io-safety']);
check('AIS3 re-apply is byte-idempotent', again.patched === 0 && again.unchanged === 3);

const run = (name, extra = {}) => {
  fs.writeFileSync(LOG, '');
  return spawnSync(process.execPath, [path.join(SCRIPTS, name)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: BIN + path.delimiter + process.env.PATH,
      ADR_ROOT: DOCS,
      FAKE_MEMORY_STATE: STATE,
      FAKE_MEMORY_LOG: LOG,
      ...extra,
    },
  });
};
const calls = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const reset = (state = { 'adr-patterns': {}, 'adr-edges': {}, listCalls: 0 }) => fs.writeFileSync(STATE, JSON.stringify(state));

reset();
let result = run('verify.mjs', { VERIFY_FORMAT: 'json' });
check('AIS4 a successfully read empty graph remains valid', result.status === 0 && JSON.parse(result.stdout).adrCount === 0);
check('AIS5 verifier uses one exact path, canonical project cwd, and an explicit cap+1',
  calls().every((call) => call.cwd === PROJECT && call.args.includes('--path=' + path.join(PROJECT, '.swarm', 'memory.db')))
  && calls().every((call) => call.args.includes('100001')));

for (const mode of ['nonzero', 'signal', 'malformed', 'nonarray', 'bad-entry', 'wrong-namespace', 'timeout']) {
  reset();
  result = run('verify.mjs', {
    VERIFY_FORMAT: 'json', FAKE_MEMORY_MODE: mode,
    ...(mode === 'timeout' ? { ADR_MEMORY_TIMEOUT_MS: '1000' } : {}),
  });
  check(`AIS6 verifier fails closed on ${mode}`, result.status !== 0 && result.stdout.includes('readErrors'));
}

const ALT_ROOT = path.join(SANDBOX, 'alternate-project');
fs.mkdirSync(path.join(ALT_ROOT, '.swarm'), { recursive: true });
fs.writeFileSync(path.join(ALT_ROOT, '.swarm', 'memory.db'), 'fake-not-sqlite\n');
reset();
result = run('verify.mjs', { VERIFY_FORMAT: 'json', ADR_DB_ROOT: ALT_ROOT, CLI_CORE: '1' });
check('AIS6 explicit ADR_DB_ROOT controls one path/backend independently of scan scope',
  result.status === 0 && result.stderr.includes('CLI_CORE=1 is ignored')
  && calls().every((call) => call.cwd === ALT_ROOT
    && call.args[0] === '@claude-flow/cli@latest'
    && call.args.includes('--path=' + path.join(ALT_ROOT, '.swarm', 'memory.db'))));

const ORPHAN_SCAN = path.join(SANDBOX, 'unowned-scan');
fs.mkdirSync(ORPHAN_SCAN, { recursive: true });
reset();
result = run('verify.mjs', { VERIFY_FORMAT: 'json', ADR_ROOT: ORPHAN_SCAN });
check('AIS6 an unowned scan root fails before any managed read', result.status !== 0 && calls().length === 0);

const capped = {};
for (let i = 1; i <= 21; i++) capped[`ADR-${String(i).padStart(3, '0')}::x.md`] = '{}';
reset({ 'adr-patterns': capped, 'adr-edges': {}, listCalls: 0 });
result = run('verify.mjs', { VERIFY_FORMAT: 'json', ADR_MEMORY_MAX_ROWS: '20' });
check('AIS6 a cap-plus-one response refuses to claim completeness',
  result.status !== 0 && result.stdout.includes('completeness is unproved'));

const patterns = {}, edges = {};
for (let i = 1; i <= 30; i++) patterns[`ADR-${String(i).padStart(3, '0')}::x.md`] = '{}';
edges['supersedes:ADR-029->ADR-030'] = '{}';
edges['supersedes:ADR-030->ADR-029'] = '{}';
reset({ 'adr-patterns': patterns, 'adr-edges': edges, listCalls: 0 });
result = run('verify.mjs', { VERIFY_FORMAT: 'json' });
check('AIS7 verifier sees corruption beyond the old 20-row default', result.status === 1 && JSON.parse(result.stdout).cycles.length > 0);

reset({ 'adr-patterns': { 'ADR-001::x.md': '{}' }, 'adr-edges': { malformed: '{}' }, listCalls: 0 });
result = run('verify.mjs', { VERIFY_FORMAT: 'json' });
check('AIS7 verifier rejects malformed edge identities',
  result.status !== 0 && result.stderr.includes('malformed adr-edges key'));

reset();
result = run('import.mjs', { IMPORT_FORMAT: 'json', IMPORT_DRY_RUN: '1' });
check('AIS8 importer dry-run performs no managed memory operation', result.status === 0 && calls().length === 0);

reset();
result = run('import.mjs', { IMPORT_FORMAT: 'json' });
let report = JSON.parse(result.stdout);
check('AIS8 importer proves each write in a fresh process and exact final key sets',
  result.status === 0 && report.verifiedWrites === 3 && report.postCondition.ok
  && calls().filter((call) => call.args[2] === 'store').length === 3
  && calls().filter((call) => call.args[2] === 'retrieve').length === 3);

for (const mode of ['false-success', 'readback-mismatch', 'wrong-final']) {
  reset();
  result = run('import.mjs', { IMPORT_FORMAT: 'json', FAKE_MEMORY_MODE: mode });
  report = JSON.parse(result.stdout);
  check(`AIS9 importer reports ${mode} as failure`, result.status !== 0 && report.errors.length > 0);
}
reset();
result = run('import.mjs', { FAKE_MEMORY_MODE: 'false-success' });
check('AIS9 Markdown import shares fail-closed exit semantics', result.status !== 0);

reset();
result = run('reindex.mjs', { REINDEX_FORMAT: 'json' });
check('AIS10 live reindex refuses before any managed operation or purge',
  result.status !== 0 && JSON.parse(result.stdout).errors[0].includes('REFUSING') && calls().length === 0);
reset();
result = run('reindex.mjs', { REINDEX_DRY_RUN: '1' });
check('AIS11 reindex dry-run remains non-mutating and explains the atomicity gap',
  result.status === 0 && result.stdout.includes('atomic managed reconcile') && calls().length === 0);

const restored = reconcile([], ['adr-io-safety']);
check('AIS12 uninstall restores all three vendor files byte-for-byte', restored.errors === 0
  && fs.readFileSync(path.join(SCRIPTS, 'verify.mjs'), 'utf8') === VERIFY_VENDOR
  && fs.readFileSync(path.join(SCRIPTS, 'import.mjs'), 'utf8') === IMPORT_VENDOR
  && fs.readFileSync(path.join(SCRIPTS, 'reindex.mjs'), 'utf8') === REINDEX_VENDOR);

fs.renameSync(path.join(SCRIPTS, 'reindex.mjs'), path.join(SCRIPTS, 'reindex.missing'));
const before = fs.readFileSync(path.join(SCRIPTS, 'verify.mjs'), 'utf8');
const blocked = applyComposed(['adr-io-safety']);
check('AIS13 a missing bundle member reports 0/3 and blocks every write',
  blocked.incomplete > 0 && blocked.patched === 0
  && fs.readFileSync(path.join(SCRIPTS, 'verify.mjs'), 'utf8') === before
  && statusComposed()['adr-io-safety'].files === 3
  && statusComposed()['adr-io-safety'].patched === 0);
fs.renameSync(path.join(SCRIPTS, 'reindex.missing'), path.join(SCRIPTS, 'reindex.mjs'));

const mutation = VERIFY_VENDOR.replace(VERIFY_EDGE_ANCHOR, VERIFY_EDGE_ANCHOR + '\n' + VERIFY_EDGE_ANCHOR);
const mutationResult = patchSource(mutation);
check('AIS14 ambiguous exact anchors are refused, not guessed',
  mutationResult.missing.some((entry) => entry.includes('AMBIGUOUS')));

fs.mkdirSync(path.join(SANDBOX, '.claude'), { recursive: true });
fs.writeFileSync(path.join(SANDBOX, '.claude', 'settings.json'), '{}\n');
const cli = path.resolve('bin/cli.mjs');
const cliEnv = {
  ...process.env,
  RUFLO_SOURCE_PATCH_HOME: SANDBOX,
  RSP_RUFLO_ADR_ROOTS: ROOT,
  RSP_NO_LAUNCHCTL: '1',
  RSP_NO_SELF_UPDATE: '1',
};
const install = spawnSync(process.execPath, [cli, 'adr-io-safety', 'install'], { env: cliEnv, encoding: 'utf8' });
const status = spawnSync(process.execPath, [cli, 'adr-io-safety', 'status'], { env: cliEnv, encoding: 'utf8' });
const uninstall = spawnSync(process.execPath, [cli, 'adr-io-safety', 'uninstall'], { env: cliEnv, encoding: 'utf8' });
check('AIS15 public install/status/uninstall tracks 3/3 and restores exactly',
  install.status === 0 && status.status === 0 && status.stdout.includes('3/3 file(s) patched')
  && uninstall.status === 0
  && fs.readFileSync(path.join(SCRIPTS, 'verify.mjs'), 'utf8') === VERIFY_VENDOR
  && fs.readFileSync(path.join(SCRIPTS, 'import.mjs'), 'utf8') === IMPORT_VENDOR
  && fs.readFileSync(path.join(SCRIPTS, 'reindex.mjs'), 'utf8') === REINDEX_VENDOR);
if (install.status !== 0 || status.status !== 0 || uninstall.status !== 0) {
  console.log(JSON.stringify({ install, status, uninstall }, null, 2));
}

check('AIS16 current marker-free vendor cannot falsely retire on source text alone',
  probeNativeRoot(ROOT).state === 'live');

const legacyCompatibleVendor = IMPORT_VENDOR.replace(
  `function memoryStore(namespace, key, value) {
  const r = spawnSync('npx', memoryStoreArgs(namespace, key, value), { encoding: 'utf8', cwd: ROOT });
  return r.status === 0 ? 'ok' : 'error';
}`,
  `// #2660: pass --upsert explicitly.
function memoryStore(namespace, key, value) {
  const r = spawnSync('npx', memoryStoreArgs(namespace, key, value), { encoding: 'utf8', cwd: ROOT });
  if (r.status !== 0) {
    return 'error: ' + (r.stderr || r.stdout || '').slice(0, 100);
  }
  return 'ok';
}`,
).replace(
  "console.log('### Source breakdown');",
  "console.log(`- Storage errors: ${errors.length}`);\nconsole.log('### Source breakdown');",
);
const composedImporter = composeSource(legacyCompatibleVendor, ['adr-index', 'adr-io-safety']);
fs.writeFileSync(path.join(SCRIPTS, 'import.mjs'), composedImporter);
reset();
result = run('import.mjs', { IMPORT_FORMAT: 'json' });
check('AIS17 legacy adr-index and adr-io-safety compose into one runnable exact-path importer',
  result.status === 0
  && composedImporter.includes('ruflo-source-patch (#2660)')
  && composedImporter.includes('memoryListComplete(namespace)')
  && calls().every((call) => call.args.includes('--path=' + path.join(PROJECT, '.swarm', 'memory.db'))));

process.exit(failed);
