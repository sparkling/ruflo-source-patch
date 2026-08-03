// RuvNet Brain #102/#103: structural raw-SQLite detection, host-native refusal, and one audited
// content-free diagnostic must install atomically and survive native generation flips.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const requestedSandbox = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-brain-boundary-')));
const SB = fs.realpathSync(requestedSandbox);
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = path.join(SB, 'home');
const BRAIN = path.join(HOME, '.cache', 'ruvnet-brain');
const RUNTIME = path.join(HOME, '.claude', 'ruvnet-brain');
const MARKET = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain');
const CODEX = path.join(HOME, '.codex');
const VERSION = '9.9.9';
const ACTIVE = path.join(BRAIN, 'versions', VERSION);
const CLAUDE_CACHE = path.join(HOME, '.claude', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain', VERSION);
const CODEX_CACHE = path.join(CODEX, 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain', VERSION);
const MARKET_PLUGIN = path.join(MARKET, 'plugin');

process.env.HOME = HOME;
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.RSP_RUVNET_BRAIN_HOME = BRAIN;
process.env.RSP_RUVNET_BRAIN_RUNTIME = RUNTIME;
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = MARKET;
process.env.RSP_CODEX_HOME = CODEX;
process.env.RSP_NO_LAUNCHCTL = '1';
process.env.RSP_NO_SELF_UPDATE = '1';
process.env.RSP_NO_MONITOR_RECOVER = '1';
process.env.RSP_NO_HOST_AUTO_UPDATE = '1';

const transforms = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
const patcher = await import('../lib/brain-managed-memory-boundary/patcher.mjs');
const policy = await import('../lib/brain-managed-memory-boundary/runtime/managed-memory-policy.mjs');
const fixtures = transforms.fixtureSources();

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`); }
}
function write(file, body, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
}
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const fakeHookInput = `import fs from 'node:fs';
export async function readStdinBounded() { return fs.readFileSync(0); }
export function parseHookEvent(raw) { try { return JSON.parse(String(raw)); } catch { return {}; } }
export const toolName = (event) => typeof event?.tool_name === 'string' ? event.tool_name : '';
export const commandOf = (event) => event?.tool_input?.command || event?.command || '';
export function preToolUseEnvelope(decision, additionalContext) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, additionalContext } });
}
function words(source) {
  const out = []; let current = ''; let quote = ''; let escaped = false;
  for (const char of source) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === '\\\\' && quote !== "'") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; else current += char; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (/\\s/.test(char)) { if (current) { out.push(current); current = ''; } continue; }
    current += char;
  }
  if (current) out.push(current);
  return out;
}
export function findInvocations(command, tools) {
  const argv = words(String(command).trim());
  return argv[0] === 'sqlite3' && tools.includes('sqlite3') ? [{ tool: 'sqlite3', args: argv.slice(1) }] : [];
}
export const payloadOf = (event) => commandOf(event);
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  const raw = fs.readFileSync(0, 'utf8'); const event = parseHookEvent(raw); const mode = process.argv[2];
  if (mode === 'payload') process.stdout.write(payloadOf(event));
  else if (mode === 'emit') process.stdout.write(preToolUseEnvelope(process.argv[3], process.argv[4]));
}
`;

function fullRoot(root, version) {
  write(path.join(root, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'ruvnet-brain', version })}\n`);
  write(path.join(root, 'scripts', 'hijack-ruvnet.sh'), fixtures.hijack, 0o755);
  write(path.join(root, 'scripts', 'hook-shim.mjs'), fixtures.shim, 0o755);
  write(path.join(root, 'scripts', 'hook-input.mjs'), fakeHookInput, 0o644);
  write(path.join(root, 'mcp', 'server.mjs'), fixtures.mcp, 0o755);
  write(path.join(root, 'mcp', 'managed-cli-interface.mjs'), 'export const MANAGED_CLI_TOOLS=[]; export async function callManagedCli(){}\n');
}
function runtimeRoot(root) {
  write(path.join(root, 'mcp', 'server.mjs'), `// ruvnet-brain MCP server\n${fixtures.mcp}`, 0o755);
  write(path.join(root, 'mcp', 'managed-cli-interface.mjs'), 'export const MANAGED_CLI_TOOLS=[]; export async function callManagedCli(){}\n');
}

fs.rmSync(SB, { recursive: true, force: true });
for (const root of [ACTIVE, CLAUDE_CACHE, CODEX_CACHE, MARKET_PLUGIN]) fullRoot(root, VERSION);
runtimeRoot(RUNTIME);
write(path.join(BRAIN, 'active.json'), `${JSON.stringify({ generation: 1, version: VERSION, codeRoot: `versions/${VERSION}` })}\n`);
write(path.join(BRAIN, 'kb', 'SOURCE.json'), '{"releaseTag":"v9.9.9"}\n');
write(path.join(BRAIN, 'native-updater.mjs'), '// native updater sentinel\n');
const kbHash = hash(path.join(BRAIN, 'kb', 'SOURCE.json'));
const updaterHash = hash(path.join(BRAIN, 'native-updater.mjs'));
const originalActive = fs.readFileSync(path.join(BRAIN, 'active.json'), 'utf8');

console.log('\nAtomic patch engine');
const broken = path.join(CODEX_CACHE, 'mcp', 'server.mjs');
const brokenOriginal = fs.readFileSync(broken, 'utf8');
fs.writeFileSync(broken, brokenOriginal.replace('const FALLBACK_TOOLS', 'const RENAMED_TOOLS'));
const refused = patcher.apply();
check('BMB1 one missing anchor refuses the whole multi-surface transaction',
  refused.incomplete === 1 && refused.patched === 0 && /NOTHING WRITTEN/.test(refused.log.join('\n')),
  JSON.stringify(refused));
check('BMB2 atomic refusal creates no sibling backup',
  !fs.existsSync(path.join(ACTIVE, 'scripts', 'hijack-ruvnet.sh.rsp-backup')));
fs.writeFileSync(broken, brokenOriginal);

const applied = patcher.apply();
check('BMB3 all active/matching surfaces and the persistent MCP shell install together',
  applied.patched === 27 && applied.incomplete === 0 && applied.errors === 0, JSON.stringify(applied));
const ready = patcher.status();
check('BMB4 status proves every expected component from its pristine/owned bytes',
  ready.files === 27 && ready.patched === 27, JSON.stringify(ready));
const again = patcher.apply();
check('BMB5 re-apply is idempotent', again.patched === 0 && again.unchanged === 27, JSON.stringify(again));
check('BMB6 patching does not touch active.json, KB bytes, or updater bytes',
  fs.readFileSync(path.join(BRAIN, 'active.json'), 'utf8') === originalActive
    && hash(path.join(BRAIN, 'kb', 'SOURCE.json')) === kbHash
    && hash(path.join(BRAIN, 'native-updater.mjs')) === updaterHash);

console.log('\nDetector and host refusal');
const project = path.join(HOME, 'source', 'project');
const db = path.join(project, '.swarm', 'memory.db');
fs.mkdirSync(path.dirname(db), { recursive: true });
const seeded = spawnSync('sqlite3', [db], {
  input: "CREATE TABLE memory_entries(id TEXT PRIMARY KEY,key TEXT,namespace TEXT,content TEXT,UNIQUE(namespace,key));\nINSERT INTO memory_entries VALUES('1','wanted','patterns','secret-content');\n",
  encoding: 'utf8',
});
check('BMB7 SQLite fixture is available', seeded.status === 0, seeded.stderr);
const gate = path.join(ACTIVE, 'scripts', 'managed-memory-gate.mjs');
const event = (command, tool_name = 'Bash') => JSON.stringify({ tool_name, cwd: project, tool_input: { command } });
const runGate = (command, extra = {}, tool = 'Bash') => spawnSync(process.execPath, [gate], {
  input: event(command, tool), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: project, ...extra },
});
const denied = runGate(`sqlite3 -json -readonly "${db}" "SELECT 1"`);
let denial = null; try { denial = JSON.parse(denied.stdout); } catch {}
check('BMB8 -json/-readonly before the DB produces a host-native deny',
  denied.status === 0 && denial?.hookSpecificOutput?.permissionDecision === 'deny', denied.stdout || denied.stderr);
const sentinel = path.join(SB, 'must-not-run');
if (denial?.hookSpecificOutput?.permissionDecision !== 'deny') fs.writeFileSync(sentinel, 'ran');
check('BMB9 a host honoring the deny never executes the raw command', !fs.existsSync(sentinel));
check('BMB10 quoted prose and unrelated databases do not trigger the managed-store gate',
  runGate(`echo "sqlite3 -readonly ${db}"`).stdout === ''
    && runGate(`sqlite3 -readonly "${path.join(SB, 'ordinary.db')}"`).stdout === '');
check('BMB11 the managed-store boundary stays on when Brain retrieval is off',
  JSON.parse(runGate(`sqlite3 "${db}"`, { RUVNET_BRAIN_OFF: '1' }).stdout)
    .hookSpecificOutput.permissionDecision === 'deny');
check('BMB12 non-Bash hook events are silent', runGate(`sqlite3 "${db}"`, {}, 'Write').stdout === '');

const hijack = path.join(ACTIVE, 'scripts', 'hijack-ruvnet.sh');
const runHijack = (command, extra = {}) => spawnSync('bash', [hijack], {
  input: event(command), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: project, ...extra },
});
check('BMB13 retrieval-off suppresses generic guidance without disabling the managed boundary',
  runHijack('echo pinecone', { RUVNET_BRAIN_OFF: '1' }).stdout === '');
check('BMB14 the obsolete flat Category-4 prose matcher is gone but other advice remains',
  runHijack(`echo "sqlite memory ${db}"`).stdout === ''
    && /permissionDecision/.test(runHijack('echo pinecone').stdout));

console.log('\nSQLite option and store classification');
const noValue = ['-append', '-ascii', '-bail', '-batch', '-box', '-column', '-csv', '-deserialize',
  '-echo', '-header', '-html', '-interactive', '-json', '-line', '-list', '-markdown', '-noheader',
  '-nofollow', '-nointeractive', '-quote', '-readonly', '-safe', '-stats', '-table', '-tabs', '-version', '-zip'];
check('BMB15 every supported no-value flag leaves the database operand visible', noValue.every((flag) =>
  policy.sqliteDatabaseArgument([flag, db]).database === db));
check('BMB16 one- and two-value flags cannot be mistaken for the database',
  policy.sqliteDatabaseArgument(['-cmd', '.timeout 1', '-separator', '|', db]).database === db
    && policy.sqliteDatabaseArgument(['-lookaside', '64', '8', '-pagecache', '4', '16', db]).database === db
    && policy.sqliteDatabaseArgument(['--', db]).database === db);
check('BMB17 unknown/dynamic option shapes fail open rather than guessing a path',
  policy.sqliteDatabaseArgument(['-future', db]).state === 'unknown');
const otherProjectDb = path.join(HOME, 'somewhere-else', '.swarm', 'memory.db');
check('BMB18 exact project and user stores classify outside the current cwd; lookalikes do not',
  policy.managedStore(otherProjectDb, { cwd: project, env: process.env })?.kind === 'project-memory'
    && policy.managedStore(path.join(HOME, '.claude-flow', 'user-memory.db'), { cwd: project, env: process.env })?.kind === 'user-memory'
    && !policy.managedStore(path.join(project, '.swarm', 'other.db'), { cwd: project, env: process.env }));

console.log('\nAudited diagnostic exception');
const diagnosticPath = path.join(ACTIVE, 'mcp', 'managed-memory-diagnostic.mjs');
const diagnostic = await import(`${pathToFileURL(diagnosticPath).href}?test=${Date.now()}`);
const canonicalDb = fs.realpathSync(db);
const beforeDb = hash(db);
const valid = await diagnostic.callManagedMemoryDiagnostic({
  path: canonicalDb, namespace: 'patterns', key: 'wanted', reason: 'verify the exact stored checkpoint',
}, { ...process.env, RUVNET_BRAIN_PROJECT_DIR: project });
check('BMB19 the bounded diagnostic reports only an exact row count, never content',
  !valid.isError && /matched rows = 1/.test(valid.content[0].text) && !valid.content[0].text.includes('secret-content'),
  JSON.stringify(valid));
check('BMB20 the diagnostic leaves the database bytes unchanged', hash(db) === beforeDb);
const audit = path.join(BRAIN, 'audit', 'managed-memory-boundary.jsonl');
const receipts = fs.readFileSync(audit, 'utf8').trim().split('\n').map(JSON.parse);
check('BMB21 refusal + start/completion receipts are private and content-free',
  (fs.statSync(audit).mode & 0o077) === 0
    && receipts.some((row) => row.event === 'raw-sqlite-refused')
    && receipts.some((row) => row.event === 'diagnostic-read-start')
    && receipts.some((row) => row.event === 'diagnostic-read' && row.rowCount === 1)
    && !fs.readFileSync(audit, 'utf8').includes('secret-content')
    && !fs.readFileSync(audit, 'utf8').includes('verify the exact stored checkpoint'));
const auditLines = receipts.length;
const rejected = await diagnostic.callManagedMemoryDiagnostic({
  path: canonicalDb, namespace: 'patterns', key: 'wanted', reason: 'verify one exact row', sql: 'SELECT *',
}, process.env);
check('BMB22 arbitrary SQL/extra arguments are refused before an audit/read',
  rejected.isError && fs.readFileSync(audit, 'utf8').trim().split('\n').length === auditLines);
const injected = await diagnostic.callManagedMemoryDiagnostic({
  path: canonicalDb, namespace: 'patterns', key: "missing' OR 1=1 --", reason: 'prove SQL values stay parameters',
}, process.env);
check('BMB23 quote-bearing values stay data and return zero',
  !injected.isError && /matched rows = 0/.test(injected.content[0].text), JSON.stringify(injected));

console.log('\nNative generation flip and exact removal');
const NEXT_VERSION = '10.0.0';
const nextRoot = path.join(BRAIN, 'versions', NEXT_VERSION);
fullRoot(nextRoot, NEXT_VERSION);
const nextActive = `${JSON.stringify({ generation: 2, version: NEXT_VERSION, codeRoot: `versions/${NEXT_VERSION}` })}\n`;
fs.writeFileSync(path.join(BRAIN, 'active.json'), nextActive);
const afterFlip = patcher.apply();
check('BMB24 a native generation flip is discovered and patched without changing active.json',
  afterFlip.patched === 6 && fs.readFileSync(path.join(BRAIN, 'active.json'), 'utf8') === nextActive,
  JSON.stringify(afterFlip));
check('BMB25 old owned surfaces remain verifiable for sessions that predate the flip',
  patcher.status().files === 33 && patcher.status().patched === 33, JSON.stringify(patcher.status()));
const drifted = path.join(nextRoot, 'scripts', 'hook-shim.mjs');
const exactPatched = fs.readFileSync(drifted, 'utf8');
fs.writeFileSync(drifted, `${exactPatched}\n// foreign drift\n`);
const unsafeRestore = patcher.restore();
check('BMB26 uninstall refuses a modified owned vendor file and restores nothing else',
  unsafeRestore.incomplete === 1 && fs.existsSync(path.join(nextRoot, 'scripts', 'managed-memory-gate.mjs')),
  JSON.stringify(unsafeRestore));
fs.writeFileSync(drifted, exactPatched);
const restored = patcher.restore();
check('BMB27 exact uninstall restores every owned component across both generations',
  restored.restored === 33 && restored.incomplete === 0 && restored.errors === 0, JSON.stringify(restored));
check('BMB28 uninstall leaves native updater/KB bytes and active selection untouched',
  hash(path.join(BRAIN, 'kb', 'SOURCE.json')) === kbHash
    && hash(path.join(BRAIN, 'native-updater.mjs')) === updaterHash
    && fs.readFileSync(path.join(BRAIN, 'active.json'), 'utf8') === nextActive);
check('BMB29 additive files and pristine backups are gone after exact removal',
  !fs.existsSync(path.join(nextRoot, 'scripts', 'managed-memory-gate.mjs'))
    && !fs.existsSync(path.join(nextRoot, 'mcp', 'server.mjs.rsp-backup')));

console.log('\nCLI desired-state lifecycle');
write(path.join(HOME, '.claude', 'settings.json'), '{}\n');
const cli = (action) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), 'brain-managed-memory-boundary', action], {
  env: process.env, encoding: 'utf8', timeout: 30_000,
});
const cliInstall = cli('install');
check('BMB30 CLI install tracks and applies the target', cliInstall.status === 0
  && /ACTION REQUIRED/.test(cliInstall.stdout), cliInstall.stdout + cliInstall.stderr);
const state = JSON.parse(fs.readFileSync(path.join(HOME, '.ruflo-source-patch', 'state.json'), 'utf8'));
check('BMB31 desired state records the target for SessionStart/monitor re-apply',
  state.pluginTargets.includes('brain-managed-memory-boundary'));
const cliStatus = cli('status');
check('BMB32 CLI status reports the active generation + persistent shell ready',
  cliStatus.status === 0 && /9\/9/.test(cliStatus.stdout), cliStatus.stdout + cliStatus.stderr);
const cliRemove = cli('uninstall');
check('BMB33 CLI uninstall removes tracked state only after exact restoration',
  cliRemove.status === 0
    && !JSON.parse(fs.readFileSync(path.join(HOME, '.ruflo-source-patch', 'state.json'), 'utf8')).pluginTargets
      .includes('brain-managed-memory-boundary'), cliRemove.stdout + cliRemove.stderr);

if (failures) process.exit(1);
console.log('\n✓ brain-managed-memory-boundary: detector, denial, diagnostic, updater coexistence, and removal proven');
