// RuvNet Brain #79: current bytes must never reuse an incompatible detached Console process.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const SANDBOX = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-brain-console-'));
const HOME = path.join(SANDBOX, 'home');
const NPX = path.join(SANDBOX, 'npx');
const GLOBAL = path.join(SANDBOX, 'global');
const BRAIN_HOME = path.join(HOME, '.cache', 'ruvnet-brain');
const MARKETPLACE = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain');
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.RUFLO_NPX_ROOT = NPX;
process.env.RUFLO_GLOBAL_ROOT = GLOBAL;
process.env.RSP_RUVNET_BRAIN_HOME = BRAIN_HOME;
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = MARKETPLACE;
process.env.RUVNET_BRAIN_HOME = BRAIN_HOME;

const lifecycle = await import('../lib/brain-console-lifecycle/patcher.mjs');
const lockstep = await import('../lib/brain-release-lockstep/patcher.mjs');
const { applyComposed, composeSource, reconcile, statusComposed } = await import('../lib/plugin-compose.mjs');

const fail = (message) => { console.error(`✘ ${message}`); process.exit(1); };
const check = (label, condition) => { if (!condition) fail(label); };
const fixture = lifecycle.fixtureSource();
const combinedInstaller = `${fixture.installer}\n\n${lockstep.fixtureSource()}`;

function writeRoot(root, { console = fixture.console, installer = combinedInstaller, name = 'ruvnet-brain', version = '4.0.2' } = {}) {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name, version })}\n`);
  fs.writeFileSync(path.join(root, 'scripts', 'onboarding-console.mjs'), console);
  fs.writeFileSync(path.join(root, 'bin', 'install.mjs'), installer);
  return [path.join(root, 'scripts', 'onboarding-console.mjs'), path.join(root, 'bin', 'install.mjs')];
}

const roots = [
  MARKETPLACE,
  path.join(HOME, '.codex', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain', '4.0.2'),
  path.join(NPX, 'one', 'node_modules', 'ruvnet-brain'),
  path.join(GLOBAL, 'ruvnet-brain'),
  path.join(BRAIN_HOME, 'kb', '.console-runtime'),
];
const files = roots.flatMap((root) => writeRoot(root));
writeRoot(path.join(BRAIN_HOME, 'versions', '4.0.2'));
writeRoot(path.join(BRAIN_HOME, 'kb', 'backups', '4.0.2'));
writeRoot(path.join(NPX, 'other', 'node_modules', 'not-brain'), { name: 'not-brain' });
const staleNpx = path.join(NPX, 'stale', 'node_modules', 'ruvnet-brain');
writeRoot(staleNpx, { version: '4.0.1' });

check('BC1 discovery is bounded to executable host/npm/persistent surfaces',
  JSON.stringify(lifecycle.discover().sort()) === JSON.stringify([...files].sort()));
check('BC2 immutable version-store and backup copies are never patched',
  !lifecycle.discover().some((file) => file.includes('/versions/') || file.includes('/backups/')));
check('BC2a inactive unowned npx generations do not keep a current patch target falsely red',
  !lifecycle.discover().some((file) => file.startsWith(staleNpx)));

const nativeConsole = `
import { consoleRuntimeDigest } from './console-runtime-identity.mjs';
const RUNTIME_SOURCE_SHA256 = consoleRuntimeDigest(REPO);
const receipt = { sourceSha256: RUNTIME_SOURCE_SHA256 };
const identityKeys = ['scriptRealpath', 'runtimeVersion', 'sourceSha256'];
const request = { path: '/api/runtime/shutdown' };
if (url === '/api/runtime') {}
if (url === '/api/runtime/shutdown') {}
const status = { state: current ? 'current' : 'stale-running' };
const foreign = found ? { state: 'foreign-port' } : null;
const legacy = found ? { state: 'legacy-unowned' } : null;
await requestRuntimeShutdown(receipt.port, receipt.controlToken);
await waitForRuntimeToStop(receipt.port);
export { inspectConsoleRuntime, launchConsole, runtimeReceiptPath, startServer };
`;
const nativeResult = lifecycle.patchSource(nativeConsole);
check('BC2b the native whole-runtime launcher satisfies only the launcher half of the target',
  nativeResult.missing.length === 0 && nativeResult.applied.length === 0
    && nativeResult.next === nativeConsole && lifecycle.isPatched(nativeConsole));
check('BC2c a one-entrypoint digest cannot masquerade as the native #79 replacement',
  !lifecycle.isPatched(nativeConsole.replace(
    'const RUNTIME_SOURCE_SHA256 = consoleRuntimeDigest(REPO);',
    "const RUNTIME_SOURCE_SHA256 = crypto.createHash('sha256').update(fs.readFileSync(RUNTIME_SCRIPT)).digest('hex');",
  )));

for (const [kind, pristine] of Object.entries(fixture)) {
  const transformed = lifecycle.patchSource(pristine);
  check(`BC3 ${kind} exact transform is complete`,
    transformed.missing.length === 0 && transformed.applied.length === (kind === 'console' ? 6 : 3));
  check(`BC4 ${kind} transform has exact ownership and reverse proof`,
    lifecycle.isPatched(transformed.next) && lifecycle.reverseSource(transformed.next) === pristine
      && lifecycle.patchSource(lifecycle.reverseSource(transformed.next)).next === transformed.next);
  if (kind === 'installer') {
    check('BC4a generated doctor preserves its digit and literal-dot regex escapes',
      transformed.next.includes('CONSOLE_PATCH_REVISION = (\\d+);')
        && transformed.next.includes('[0-9a-f]{64}\\.json$'));
  }
}
const partial = fixture.console.replace("      const url = req.url.split('?')[0];", '      const url = req.url;');
check('BC5 one missing Console anchor refuses the entire atomic contribution',
  composeSource(partial, ['brain-console-lifecycle']) === partial);
const ambiguous = `${fixture.console}\n${fixture.console}`;
check('BC6 duplicate anchors are ambiguous and atomically refused',
  lifecycle.patchSource(ambiguous).missing.some((item) => item.includes('AMBIGUOUS'))
    && composeSource(ambiguous, ['brain-console-lifecycle']) === ambiguous);

const applied = applyComposed(['brain-console-lifecycle', 'brain-release-lockstep']);
check('BC7 lifecycle and #77 compose without partial writes', !applied.incomplete && !applied.errors);
const status = statusComposed();
check('BC8 every lifecycle surface is proved patched',
  status['brain-console-lifecycle'].files === files.length
    && status['brain-console-lifecycle'].patched === files.length);
for (const file of files) {
  const pristine = file.endsWith('install.mjs') ? combinedInstaller : fixture.console;
  check(`BC9 pristine backup retained for ${file}`, fs.readFileSync(`${file}.rsp-backup`, 'utf8') === pristine);
}
const withoutLifecycle = reconcile(['brain-release-lockstep'], ['brain-console-lifecycle']);
check('BC10 removing #79 leaves #77 composed and removes only #79',
  !withoutLifecycle.errors && !withoutLifecycle.incomplete
    && lockstep.discover().every((file) => lockstep.isPatched(fs.readFileSync(file, 'utf8')))
    && files.every((file) => !lifecycle.isPatched(fs.readFileSync(file, 'utf8'))));
const restored = reconcile([], ['brain-release-lockstep']);
check('BC11 final reconciliation restores every vendor byte exactly',
  !restored.errors && files.every((file) => fs.readFileSync(file, 'utf8')
    === (file.endsWith('install.mjs') ? combinedInstaller : fixture.console)));

function runnableVendor(generation) {
  return `#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(__dirname); const HOME = os.homedir();
const TOKEN = crypto.randomBytes(24).toString('hex');
function readJSON(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function sendJSON(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); }); }
function openBrowser() {}
function startServer({ port = Number(process.env.CONSOLE_PORT) || 7411, open = false, cwd = process.cwd() } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = req.url.split('?')[0];
      if (req.method === 'GET' && url === '/') { res.writeHead(200); res.end('RuvNet Brain ${generation}'); return; }
      res.writeHead(404); res.end('not found');
    } catch { res.writeHead(500); res.end('error'); }
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && port !== 0) { console.error(\`  port \${port} busy — trying a free one…\`); startServer({ port: 0, open, cwd }); }
    else { console.error(\`  server error: \${e.message}\`); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    const actual = server.address().port;
    const url = \`http://127.0.0.1:\${actual}/\`;
    console.log(url);
  });
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--noop')) {}
  else if (args.includes('--serve') || args.length === 0) {
    // Hitting the command again should land on the console you already have, not spawn a second
    // server on a random port and a second tab. If one is already up, just point the browser at it.
    const port = Number(process.env.CONSOLE_PORT) || 7411;
    const open = args.includes('--open');
    const url = \`http://127.0.0.1:\${port}/\`;
    const alive = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 800 }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; if (b.length > 4096) res.destroy(); });
        res.on('end', () => resolve(res.statusCode === 200 && /RuvNet Brain/.test(b)));
        res.on('error', () => resolve(false));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (alive) {
      console.log(\`\\n  🧠  RuvNet Brain — Onboarding Console (already running)\\n      \${url}\\n\`);
      if (open) openBrowser(url);
    } else { startServer({ port, open, cwd: process.cwd() }); }
  }
}
main();
// ${generation}
`;
}

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const get = (port, route, body = null) => new Promise((resolve) => {
  const payload = body && JSON.stringify(body); const req = http.request({ host: '127.0.0.1', port,
    path: route, method: payload ? 'POST' : 'GET', timeout: 1000,
    headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, (res) => {
    let text = ''; res.on('data', (chunk) => { text += chunk; });
    res.on('end', () => { let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, text, json }); });
  });
  req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null); });
  if (payload) req.write(payload); req.end();
});
const waitForOutput = (child, pattern) => new Promise((resolve, reject) => {
  let output = ''; const timer = setTimeout(() => reject(new Error(`timed out waiting for ${pattern}: ${output}`)), 5000);
  const onData = (chunk) => { output += chunk; if (pattern.test(output)) { clearTimeout(timer); resolve(output); } };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.once('exit', (code) => { if (!pattern.test(output)) { clearTimeout(timer); reject(new Error(`child exited ${code}: ${output}`)); } });
});
const waitExit = (child) => new Promise((resolve) => {
  if (child.exitCode !== null) resolve(child.exitCode); else child.once('exit', resolve);
});

const runtimeRoot = path.join(SANDBOX, 'runtime');
const runtimeScript = path.join(runtimeRoot, 'scripts', 'onboarding-console.mjs');
const project = path.join(SANDBOX, 'project');
fs.mkdirSync(path.dirname(runtimeScript), { recursive: true }); fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(runtimeRoot, 'package.json'), '{"name":"ruvnet-brain","version":"4.0.2"}\n');
const port = await freePort();
const childEnv = { ...process.env, CONSOLE_PORT: String(port), RUVNET_BRAIN_HOME: BRAIN_HOME };
let currentChild;
try {
  const patchedA = lifecycle.patchSource(runnableVendor('A'));
  check('BC12 runnable fixture accepts all six exact Console edits', patchedA.missing.length === 0);
  const generationA = patchedA.next;
  fs.writeFileSync(runtimeScript, generationA);
  currentChild = spawn(process.execPath, [runtimeScript, '--serve'], { cwd: project, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForOutput(currentChild, /http:\/\/127\.0\.0\.1:/);
  const first = await get(port, '/api/runtime');
  check('BC12a live identity is cheap, versioned, scoped, and redacts secrets and paths',
    first?.status === 200 && first.json?.apiContract === 1 && first.json?.patchRevision === 1
      && !JSON.stringify(first.json).includes('controlToken') && !JSON.stringify(first.json).includes(project)
      && !JSON.stringify(first.json).includes(runtimeScript));
  const receiptFile = path.join(BRAIN_HOME, 'console-control', 'instances', `${crypto.createHash('sha256').update(fs.realpathSync(project)).digest('hex')}.json`);
  check('BC13 receipt is mode 0600 and carries a separate 256-bit control token',
    (fs.statSync(receiptFile).mode & 0o777) === 0o600
      && /^[A-Za-z0-9_-]{43}$/.test(JSON.parse(fs.readFileSync(receiptFile, 'utf8')).controlToken));

  const repeat = spawnSync(process.execPath, [runtimeScript, '--serve'], { cwd: project, env: childEnv, encoding: 'utf8', timeout: 5000 });
  check(`BC14 an exact current instance is reused without a duplicate (${JSON.stringify({ status: repeat.status, stdout: repeat.stdout, stderr: repeat.stderr })})`,
    repeat.status === 0 && repeat.stdout.includes('verified current')
      && (await get(port, '/api/runtime')).json.pid === first.json.pid);

  const generationB = lifecycle.patchSource(runnableVendor('B')).next;
  fs.writeFileSync(runtimeScript, generationB);
  const replacement = spawn(process.execPath, [runtimeScript, '--serve'], { cwd: project, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForOutput(replacement, /http:\/\/127\.0\.0\.1:/);
  await waitExit(currentChild); currentChild = replacement;
  const second = await get(port, '/api/runtime');
  check('BC15 new bytes authenticate shutdown and replace the stale in-memory generation',
    second?.status === 200 && second.json.pid !== first.json.pid
      && second.json.vendorSha256 !== first.json.vendorSha256);
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  check('BC16 an unauthenticated shutdown is rejected',
    (await get(port, '/api/runtime/shutdown', { instanceId: receipt.instanceId, controlToken: 'wrong' }))?.status === 403);
  check('BC17 the receipt-proven instance accepts authenticated graceful shutdown',
    (await get(port, '/api/runtime/shutdown', receipt))?.status === 202);
  await waitExit(currentChild); currentChild = null;
  check('BC18 graceful shutdown removes only its own receipt', !fs.existsSync(receiptFile));
} finally {
  if (currentChild && currentChild.exitCode === null) currentChild.kill('SIGTERM');
}

const foreignPort = await freePort();
const foreign = http.createServer((_req, res) => { res.writeHead(200); res.end('foreign service'); });
await new Promise((resolve) => foreign.listen(foreignPort, '127.0.0.1', resolve));
const foreignProject = path.join(SANDBOX, 'foreign-project'); fs.mkdirSync(foreignProject);
const foreignScope = crypto.createHash('sha256').update(fs.realpathSync(foreignProject)).digest('hex');
const foreignReceipt = path.join(BRAIN_HOME, 'console-control', 'instances', `${foreignScope}.json`);
let fallbackChild;
try {
  fallbackChild = spawn(process.execPath, [runtimeScript, '--serve'], {
    cwd: foreignProject, env: { ...childEnv, CONSOLE_PORT: String(foreignPort) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForOutput(fallbackChild, /http:\/\/127\.0\.0\.1:/);
  const receipt = JSON.parse(fs.readFileSync(foreignReceipt, 'utf8'));
  check('BC19 a foreign default-port listener is preserved while Console binds a free port',
    receipt.port !== foreignPort && (await get(foreignPort, '/'))?.text === 'foreign service');
  await get(receipt.port, '/api/runtime/shutdown', receipt); await waitExit(fallbackChild); fallbackChild = null;
} finally {
  if (fallbackChild && fallbackChild.exitCode === null) fallbackChild.kill('SIGTERM');
  await new Promise((resolve) => foreign.close(resolve));
}

const mutated = lifecycle.patchSource(fixture.console).next.replace('body.instanceId !== ACTIVE_CONSOLE_INSTANCE.instanceId', 'false');
check('BC20 mutation test: deleting instance-bound shutdown invalidates patch evidence', !lifecycle.isPatched(mutated));

const runCli = (...args) => spawnSync(process.execPath, [path.resolve('bin/cli.mjs'), ...args], {
  env: { ...process.env, RSP_NO_LAUNCHCTL: '1', RSP_NO_SELF_UPDATE: '1' }, encoding: 'utf8',
});
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}\n');
const installed = runCli('brain-console-lifecycle', 'install');
check('BC21 public CLI installs and tracks every lifecycle surface',
  installed.status === 0 && installed.stdout.includes('re-applied on session start and by the monitor'));
const cliStatus = runCli('brain-console-lifecycle', 'status');
check('BC22 public CLI reports tracked patch evidence', cliStatus.status === 0 && cliStatus.stdout.includes('tracked'));

const uninstallPort = await freePort();
const uninstallChild = spawn(process.execPath, [runtimeScript, '--serve'], {
  cwd: project, env: { ...childEnv, CONSOLE_PORT: String(uninstallPort) }, stdio: ['ignore', 'pipe', 'pipe'],
});
await waitForOutput(uninstallChild, /http:\/\/127\.0\.0\.1:/);
const removed = runCli('brain-console-lifecycle', 'uninstall');
await waitExit(uninstallChild);
check('BC23 public CLI authenticates and stops owned instances before restoring bytes',
  removed.status === 0 && uninstallChild.exitCode === 0);
check('BC24 public CLI uninstalls only after the owned-instance preflight',
  removed.status === 0 && removed.stdout.includes('restored'));

console.log('✔ brain Console lifecycle (#79 immutable identity, private per-project receipts, authenticated replacement, atomic composition, exact restore)');
