// Ownership-proven Console lifecycle for RuvNet Brain issue #79.
// Updating a script does not update an already-running Node process. The old launcher accepted any
// branded `/` response as current, so a detached pre-update router could serve new UI
// bytes indefinitely. This target adds a per-project, mode-0600 instance receipt and an authenticated
// shutdown endpoint. It never kills by PID, port, command line, or branding; legacy and foreign
// listeners are preserved. Brain's native updater/runtime activation remains completely unmodified.
import crypto from 'node:crypto';
import { discover } from './discovery.mjs';
import { isNativeConsoleLifecycleSource } from './native.mjs';
export { discover };
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#79)';
const CONSOLE_PRODUCT_MARKER = "const CONSOLE_PRODUCT = 'ruvnet-brain-console';";
const TOKEN_ORIGINAL = "const TOKEN = crypto.randomBytes(24).toString('hex');";
const PATCH_REVISION = 1;
const tokenPatched = (vendorSha256) => `const TOKEN = crypto.randomBytes(24).toString('hex');

// ${PATCH_MARKER}: detached processes are reusable only when their live identity matches these bytes.
const CONSOLE_PRODUCT = 'ruvnet-brain-console';
const CONSOLE_INSTANCE_SCHEMA = 1;
const CONSOLE_API_CONTRACT = 1;
const CONSOLE_PATCH_REVISION = ${PATCH_REVISION};
const CONSOLE_VENDOR_SHA256 = '${vendorSha256}';
const CONSOLE_HOME = process.env.RUVNET_BRAIN_HOME || path.join(HOME, '.cache', 'ruvnet-brain');
const CONSOLE_CONTROL_DIR = path.join(CONSOLE_HOME, 'console-control');
const CONSOLE_INSTANCES = path.join(CONSOLE_CONTROL_DIR, 'instances');
const CONSOLE_LIFECYCLE_LOCK = path.join(CONSOLE_CONTROL_DIR, 'lifecycle.lock');
const CONSOLE_SCRIPT = fs.realpathSync(fileURLToPath(import.meta.url));
const CONSOLE_VERSION = String((readJSON(path.join(REPO, 'package.json')) || {}).version || 'unknown');
const CONSOLE_INSTANCE_ID = crypto.randomUUID();
const CONSOLE_CONTROL_TOKEN = crypto.randomBytes(32).toString('base64url');
let ACTIVE_CONSOLE_INSTANCE = null;

function canonicalConsoleCwd(cwd) {
  try { return fs.realpathSync(cwd); } catch { return path.resolve(cwd); }
}
function consoleScopeKey(cwd) {
  return crypto.createHash('sha256').update(canonicalConsoleCwd(cwd)).digest('hex');
}
function consoleReceiptPath(cwd) { return path.join(CONSOLE_INSTANCES, consoleScopeKey(cwd) + '.json'); }
function validConsoleReceipt(value) {
  return value && value.product === CONSOLE_PRODUCT
    && value.schema === CONSOLE_INSTANCE_SCHEMA && value.apiContract === CONSOLE_API_CONTRACT
    && value.patchRevision === CONSOLE_PATCH_REVISION
    && /^[0-9a-f-]{36}$/i.test(String(value.instanceId || ''))
    && /^[A-Za-z0-9_-]{43}$/.test(String(value.controlToken || ''))
    && /^[0-9a-f]{64}$/i.test(String(value.vendorSha256 || ''))
    && /^[0-9a-f]{64}$/i.test(String(value.scopeKey || ''))
    && Number.isInteger(value.pid) && value.pid > 1
    && Number.isInteger(value.port) && value.port > 0 && value.port < 65536
    && typeof value.cwd === 'string' && path.isAbsolute(value.cwd)
    && value.scopeKey === consoleScopeKey(value.cwd)
    && typeof value.scriptRealpath === 'string' && path.isAbsolute(value.scriptRealpath);
}
function readConsoleReceiptFile(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) return null;
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) return null;
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validConsoleReceipt(value) ? { ...value, _receiptPath: file } : null;
  } catch { return null; }
}
function readConsoleReceipt(cwd) { return readConsoleReceiptFile(consoleReceiptPath(cwd)); }

function writeConsoleReceipt(port, cwd) {
  const canonicalCwd = canonicalConsoleCwd(cwd);
  const file = consoleReceiptPath(canonicalCwd);
  const value = {
    product: CONSOLE_PRODUCT, schema: CONSOLE_INSTANCE_SCHEMA, apiContract: CONSOLE_API_CONTRACT,
    patchRevision: CONSOLE_PATCH_REVISION, vendorSha256: CONSOLE_VENDOR_SHA256,
    instanceId: CONSOLE_INSTANCE_ID, controlToken: CONSOLE_CONTROL_TOKEN,
    pid: process.pid, port, startedAt: new Date().toISOString(), cwd: canonicalCwd,
    scopeKey: consoleScopeKey(canonicalCwd), scriptRealpath: CONSOLE_SCRIPT,
    runtimeVersion: CONSOLE_VERSION,
  };
  fs.mkdirSync(CONSOLE_INSTANCES, { recursive: true, mode: 0o700 });
  const dirStat = fs.lstatSync(CONSOLE_INSTANCES);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()
    || (process.platform !== 'win32' && (dirStat.mode & 0o077) !== 0)
    || (typeof process.getuid === 'function' && dirStat.uid !== process.getuid())) {
    throw new Error('instance directory is not trusted');
  }
  const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
  let fd;
  try {
    fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
      | (fs.constants.O_NOFOLLOW || 0), 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\\n');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file); fs.chmodSync(file, 0o600);
    try { const dirFd = fs.openSync(CONSOLE_INSTANCES, 'r'); fs.fsyncSync(dirFd); fs.closeSync(dirFd); } catch {}
    return { ...value, _receiptPath: file };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
}
function removeConsoleReceipt(instance) {
  if (!instance || !instance._receiptPath) return;
  const current = readConsoleReceiptFile(instance._receiptPath);
  if (current && current.instanceId === instance.instanceId) {
    try { fs.rmSync(instance._receiptPath, { force: true }); } catch {}
  }
}
function publicConsoleIdentity(value) {
  if (!value) return null;
  return {
    product: value.product, schema: value.schema, apiContract: value.apiContract,
    patchRevision: value.patchRevision, vendorSha256: value.vendorSha256,
    instanceId: value.instanceId, pid: value.pid, port: value.port,
    startedAt: value.startedAt, scopeKey: value.scopeKey, runtimeVersion: value.runtimeVersion,
  };
}
function secureConsoleToken(actual, expected) {
  const a = Buffer.from(String(actual || '')); const b = Buffer.from(String(expected || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function loadedConsoleBytesCurrent() {
  try {
    const source = fs.readFileSync(CONSOLE_SCRIPT, 'utf8');
    return source.includes("const CONSOLE_VENDOR_SHA256 = '" + CONSOLE_VENDOR_SHA256 + "';")
      && source.includes('const CONSOLE_PATCH_REVISION = ' + CONSOLE_PATCH_REVISION + ';');
  } catch { return false; }
}
function closeConsoleServer(server, instance) {
  let finished = false;
  const finish = () => {
    if (finished) return; finished = true;
    removeConsoleReceipt(instance); process.exit(0);
  };
  server.close(finish);
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
  setTimeout(finish, 2000).unref();
}

async function acquireConsoleLaunchLock() {
  const lock = CONSOLE_LIFECYCLE_LOCK;
  const ownerFile = path.join(lock, 'owner.json');
  const owner = { pid: process.pid, nonce: crypto.randomBytes(16).toString('hex') };
  fs.mkdirSync(CONSOLE_CONTROL_DIR, { recursive: true, mode: 0o700 });
  const rootStat = fs.lstatSync(CONSOLE_CONTROL_DIR);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
    || (process.platform !== 'win32' && (rootStat.mode & 0o077) !== 0)
    || (typeof process.getuid === 'function' && rootStat.uid !== process.getuid())) return null;
  for (let attempt = 0; attempt < 80; attempt++) {
    let created = false;
    try {
      fs.mkdirSync(lock, { mode: 0o700 }); created = true;
      fs.writeFileSync(ownerFile, JSON.stringify(owner) + '\\n', { mode: 0o600, flag: 'wx' });
      return () => {
        try {
          const current = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
          if (current.nonce === owner.nonce) fs.rmSync(lock, { recursive: true, force: true });
        } catch {}
      };
    } catch (error) {
      if (created) { try { fs.rmSync(lock, { recursive: true, force: true }); } catch {} return null; }
      if (error.code !== 'EEXIST') return null;
      try {
        const lockStat = fs.lstatSync(lock);
        if (!lockStat.isDirectory() || lockStat.isSymbolicLink()
          || (process.platform !== 'win32' && (lockStat.mode & 0o077) !== 0)
          || (typeof process.getuid === 'function' && lockStat.uid !== process.getuid())) return null;
        const current = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
        let alive = true; try { process.kill(current.pid, 0); } catch { alive = false; }
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (!alive && age > 10000) { fs.rmSync(lock, { recursive: true, force: true }); continue; }
      } catch {
        try {
          const stat = fs.lstatSync(lock); const age = Date.now() - stat.mtimeMs;
          if (stat.isDirectory() && !stat.isSymbolicLink() && age > 10000
            && (typeof process.getuid !== 'function' || stat.uid === process.getuid())) {
            fs.rmSync(lock, { recursive: true, force: true }); continue;
          }
        } catch {}
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return null;
}

function consoleRequest(port, route, { method = 'GET', body = null, timeout = 800 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: route, method, timeout,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { if (text.length < 65536) text += chunk; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch {} finish({ status: res.statusCode, json, text }); });
      res.on('error', () => finish(null));
    });
    req.on('error', () => finish(null));
    req.on('timeout', () => { req.destroy(); finish(null); });
    if (payload) req.write(payload);
    req.end();
  });
}
async function probeConsoleRuntime(port) {
  const response = await consoleRequest(port, '/api/runtime');
  return response && response.status === 200 && response.json ? response.json : null;
}
function ownedConsoleInstance(receipt, live) {
  return validConsoleReceipt(receipt) && live && live.product === CONSOLE_PRODUCT
    && live.schema === CONSOLE_INSTANCE_SCHEMA && live.apiContract === CONSOLE_API_CONTRACT
    && live.instanceId === receipt.instanceId && live.pid === receipt.pid && live.port === receipt.port
    && live.scopeKey === receipt.scopeKey && live.vendorSha256 === receipt.vendorSha256
    && live.patchRevision === receipt.patchRevision;
}
function compatibleConsoleInstance(live, cwd) {
  return live && live.vendorSha256 === CONSOLE_VENDOR_SHA256
    && live.patchRevision === CONSOLE_PATCH_REVISION && live.apiContract === CONSOLE_API_CONTRACT
    && live.scopeKey === consoleScopeKey(cwd);
}
async function stopOwnedConsole(receipt, live) {
  if (!ownedConsoleInstance(receipt, live)) return false;
  const response = await consoleRequest(receipt.port, '/api/runtime/shutdown', {
    method: 'POST', body: { instanceId: receipt.instanceId, controlToken: receipt.controlToken }, timeout: 1000,
  });
  if (!response || response.status !== 202) return false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (!(await probeConsoleRuntime(receipt.port))) return true;
  }
  return false;
}
async function consolePortResponds(port) { return Boolean(await consoleRequest(port, '/', { timeout: 500 })); }`;

const START_ORIGINAL = `function startServer({ port = Number(process.env.CONSOLE_PORT) || 7411, open = false, cwd = process.cwd() } = {}) {`;
const START_PATCHED = `function startServer({
  port = Number(process.env.CONSOLE_PORT) || 7411,
  open = false,
  cwd = process.cwd(),
  releaseLaunchLock = null,
} = {}) {`;

const ROUTE_ORIGINAL = `      const url = req.url.split('?')[0];`;
const ROUTE_PATCHED = `      const url = req.url.split('?')[0];
      // ${PATCH_MARKER}: runtime control uses its own mode-0600 token, never the page mutation token.
      if (req.method === 'GET' && url === '/api/runtime') return sendJSON(res, 200, publicConsoleIdentity(ACTIVE_CONSOLE_INSTANCE));
      if (req.method === 'POST' && url === '/api/runtime/shutdown') {
        const body = await readBody(req);
        if (!ACTIVE_CONSOLE_INSTANCE || body.instanceId !== ACTIVE_CONSOLE_INSTANCE.instanceId
          || !secureConsoleToken(body.controlToken, ACTIVE_CONSOLE_INSTANCE.controlToken)) {
          return sendJSON(res, 403, { error: 'bad or missing control token' });
        }
        sendJSON(res, 202, { ok: true, instanceId: ACTIVE_CONSOLE_INSTANCE.instanceId });
        const stopping = ACTIVE_CONSOLE_INSTANCE;
        setTimeout(() => closeConsoleServer(server, stopping), 10);
        return;
      }`;

const ERROR_ORIGINAL = `  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && port !== 0) { console.error(\`  port \${port} busy — trying a free one…\`); startServer({ port: 0, open, cwd }); }
    else { console.error(\`  server error: \${e.message}\`); process.exit(1); }
  });`;
const ERROR_PATCHED = `  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && port !== 0) {
      console.error(\`  port \${port} busy — trying a free one…\`);
      startServer({ port: 0, open, cwd, releaseLaunchLock });
    } else {
      if (releaseLaunchLock) releaseLaunchLock();
      console.error(\`  server error: \${e.message}\`); process.exit(1);
    }
  });`;

const LISTEN_ORIGINAL = `    const actual = server.address().port;
    const url = \`http://127.0.0.1:\${actual}/\`;`;
const LISTEN_PATCHED = `    const actual = server.address().port;
    try { ACTIVE_CONSOLE_INSTANCE = writeConsoleReceipt(actual, cwd); }
    catch (error) {
      if (releaseLaunchLock) releaseLaunchLock();
      console.error('  cannot publish a secure Console instance receipt: ' + error.message);
      server.close(() => process.exit(1)); return;
    }
    if (releaseLaunchLock) releaseLaunchLock();
    const closeOwned = () => closeConsoleServer(server, ACTIVE_CONSOLE_INSTANCE);
    process.once('SIGINT', closeOwned); process.once('SIGTERM', closeOwned);
    process.once('exit', () => removeConsoleReceipt(ACTIVE_CONSOLE_INSTANCE));
    const url = \`http://127.0.0.1:\${actual}/\`;`;

const CLI_ORIGINAL = `  else if (args.includes('--serve') || args.length === 0) {
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
  }`;
const CLI_PATCHED = `  else if (args.includes('--serve') || args.length === 0) {
    // ${PATCH_MARKER}: serialize one scope and reuse only an exact receipt/live identity pair.
    const requestedPort = Number(process.env.CONSOLE_PORT) || 7411;
    const open = args.includes('--open'); const cwd = canonicalConsoleCwd(process.cwd());
    const releaseLaunchLock = await acquireConsoleLaunchLock();
    if (!releaseLaunchLock) {
      console.error('  another Console launch for this project did not finish; refusing to spawn an untracked duplicate.');
      process.exitCode = 1;
    } else {
      let handedOff = false;
      try {
        const receipt = readConsoleReceipt(cwd);
        const live = receipt ? await probeConsoleRuntime(receipt.port) : null;
        if (ownedConsoleInstance(receipt, live) && compatibleConsoleInstance(live, cwd)) {
          const url = 'http://127.0.0.1:' + receipt.port + '/';
          console.log('\\n  🧠  RuvNet Brain — Onboarding Console (verified current)\\n      ' + url + '\\n');
          if (open) openBrowser(url);
        } else {
          let mayStart = true;
          if (ownedConsoleInstance(receipt, live)) {
            console.error('  Console generation changed — replacing this project\\'s owned stale instance…');
            if (!(await stopOwnedConsole(receipt, live))) {
              console.error('  authenticated shutdown failed; preserving it and refusing to orphan the owned instance.');
              process.exitCode = 1; mayStart = false;
            }
          }
          if (mayStart && !loadedConsoleBytesCurrent()) {
            console.error('  Console bytes changed during launch; run the command again from the current installation.');
            process.exitCode = 1; mayStart = false;
          }
          if (mayStart) {
            const occupied = await consolePortResponds(requestedPort);
            if (occupied) console.error('  port ' + requestedPort + ' is unowned here — preserving it and using a free port.');
            startServer({ port: occupied ? 0 : requestedPort, open, cwd, releaseLaunchLock });
            handedOff = true;
          }
        }
      } finally { if (!handedOff) releaseLaunchLock(); }
    }
  }`;

const DOCTOR_ANCHOR = `// ── \`--doctor\`: a standalone health check the user can run any time ───────────────────────────────`;
const DOCTOR_HELPER = `// ${PATCH_MARKER}: read-only comparison of persistent bytes and every receipt-owned live instance.
async function consoleRuntimeStatus(cacheDir) {
  const entry = path.join(cacheDir, '.console-runtime', 'scripts', 'onboarding-console.mjs');
  let vendorSha256; let patchRevision;
  try {
    const stat = fs.lstatSync(entry);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
    const source = fs.readFileSync(entry, 'utf8');
    vendorSha256 = source.match(/const CONSOLE_VENDOR_SHA256 = '([0-9a-f]{64})';/)?.[1];
    patchRevision = Number(source.match(/const CONSOLE_PATCH_REVISION = (\\d+);/)?.[1]);
    if (!vendorSha256 || !Number.isInteger(patchRevision)) return { state: 'unpatched-runtime', healthy: false };
  } catch { return { state: 'missing-runtime', healthy: false }; }
  const home = process.env.RUVNET_BRAIN_HOME || path.join(os.homedir(), '.cache', 'ruvnet-brain');
  const dir = path.join(home, 'console-control', 'instances');
  const request = async (port, route) => {
    try {
      const response = await fetch('http://127.0.0.1:' + port + route, { signal: AbortSignal.timeout(800) });
      const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch {}
      return { status: response.status, text: text.slice(0, 8192), json };
    } catch { return null; }
  };
  const receipts = [];
  try {
    const dirStat = fs.lstatSync(dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return { state: 'invalid-receipt', healthy: false };
    for (const name of fs.readdirSync(dir).filter((item) => /^[0-9a-f]{64}\\.json$/i.test(item))) {
      const file = path.join(dir, name); const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384
        || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
        return { state: 'invalid-receipt', healthy: false };
      }
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      const scope = typeof value.cwd === 'string' && path.isAbsolute(value.cwd)
        ? crypto.createHash('sha256').update(value.cwd).digest('hex') : null;
      if (value.product !== 'ruvnet-brain-console' || value.schema !== 1 || value.apiContract !== 1
        || !Number.isInteger(value.patchRevision) || !/^[0-9a-f]{64}$/i.test(String(value.vendorSha256 || ''))
        || !/^[0-9a-f-]{36}$/i.test(String(value.instanceId || ''))
        || !/^[A-Za-z0-9_-]{43}$/.test(String(value.controlToken || ''))
        || !/^[0-9a-f]{64}$/i.test(String(value.scopeKey || ''))
        || value.scopeKey !== scope || name !== scope + '.json'
        || !Number.isInteger(value.pid) || value.pid <= 1
        || !Number.isInteger(value.port) || value.port <= 0 || value.port >= 65536) {
        return { state: 'invalid-receipt', healthy: false };
      }
      receipts.push(value);
    }
  } catch (error) { if (error.code !== 'ENOENT') return { state: 'invalid-receipt', healthy: false }; }
  const currentPorts = new Set();
  for (const receipt of receipts) {
    const live = await request(receipt.port, '/api/runtime');
    if (!live) return { state: 'stale-receipt', healthy: false, port: receipt.port };
    const value = live.json;
    const owned = live.status === 200 && value && value.product === 'ruvnet-brain-console'
      && value.instanceId === receipt.instanceId && value.pid === receipt.pid
      && value.port === receipt.port && value.scopeKey === receipt.scopeKey
      && value.vendorSha256 === receipt.vendorSha256 && value.patchRevision === receipt.patchRevision;
    if (!owned) return { state: 'legacy-unowned', healthy: false, port: receipt.port };
    if (value.vendorSha256 !== vendorSha256 || value.patchRevision !== patchRevision) {
      return { state: 'stale-running', healthy: false, port: receipt.port };
    }
    currentPorts.add(receipt.port);
  }
  const defaultPort = Number(process.env.CONSOLE_PORT) || 7411;
  if (!currentPorts.has(defaultPort)) {
    const runtime = await request(defaultPort, '/api/runtime');
    if (runtime && runtime.status === 200) return { state: 'legacy-unowned', healthy: false, port: defaultPort };
    const root = await request(defaultPort, '/');
    if (root && /RuvNet Brain/.test(root.text)) return { state: 'legacy-unowned', healthy: false, port: defaultPort };
    if (root) return { state: receipts.length ? 'current-with-foreign-port' : 'foreign-port', healthy: true, port: defaultPort };
  }
  return receipts.length ? { state: 'current', healthy: true, instances: receipts.length } : { state: 'stopped', healthy: true };
}

${DOCTOR_ANCHOR}`;
const DOCTOR_OUTPUT_ORIGINAL = `  // Extraction no longer needs an external binary at all — kb/zip-extract.mjs does it with node:zlib`;
const DOCTOR_OUTPUT_PATCHED = `  const consoleRuntime = await consoleRuntimeStatus(cacheDir);
  if (consoleRuntime.state === 'current') ok('Brain Console runtime is current across ' + consoleRuntime.instances + ' live project scope(s)');
  else if (consoleRuntime.state === 'stopped') info('Brain Console runtime is current on disk and not running');
  else if (consoleRuntime.healthy) warn('Brain Console lifecycle: ' + consoleRuntime.state + ' — its default port is preserved');
  else warn('Brain Console lifecycle: ' + consoleRuntime.state + ' — launch /rvbc to activate current bytes safely');
  // Extraction no longer needs an external binary at all — kb/zip-extract.mjs does it with node:zlib`;
const FAILED_ORIGINAL = `    || Boolean(rufloOperational && !rufloOperational.healthy);`;
const FAILED_PATCHED = `    || Boolean(rufloOperational && !rufloOperational.healthy)
    || !consoleRuntime.healthy;`;

const consoleEdits = (vendorSha256) => [
  ['instance-contract', TOKEN_ORIGINAL, tokenPatched(vendorSha256), (s) => s.includes(CONSOLE_PRODUCT_MARKER)
    && s.includes('const CONSOLE_PATCH_REVISION = 1;')
    && s.includes("crypto.randomBytes(32).toString('base64url')")],
  ['server-lock-handoff', START_ORIGINAL, START_PATCHED, (s) => s.includes('releaseLaunchLock = null')],
  ['runtime-api', ROUTE_ORIGINAL, ROUTE_PATCHED, (s) => s.includes("url === '/api/runtime/shutdown'")
    && s.includes('body.instanceId !== ACTIVE_CONSOLE_INSTANCE.instanceId')
    && s.includes('secureConsoleToken(body.controlToken, ACTIVE_CONSOLE_INSTANCE.controlToken)')],
  ['port-race-handoff', ERROR_ORIGINAL, ERROR_PATCHED, (s) => s.includes('startServer({ port: 0, open, cwd, releaseLaunchLock })')],
  ['receipt-on-listen', LISTEN_ORIGINAL, LISTEN_PATCHED, (s) => s.includes('writeConsoleReceipt(actual, cwd)')],
  ['verified-launcher', CLI_ORIGINAL, CLI_PATCHED, (s) => s.includes('Onboarding Console (verified current)')
    && s.includes('loadedConsoleBytesCurrent()') && s.includes('stopOwnedConsole(receipt, live)')],
];
const INSTALLER_EDITS = [
  ['doctor-classifier', DOCTOR_ANCHOR, DOCTOR_HELPER, (s) => s.includes('async function consoleRuntimeStatus(cacheDir)')
    && s.includes("source.match(/const CONSOLE_PATCH_REVISION = (\\d+);/)")],
  ['doctor-output', DOCTOR_OUTPUT_ORIGINAL, DOCTOR_OUTPUT_PATCHED, (s) => s.includes("consoleRuntime.state === 'current'")],
  ['doctor-gate', FAILED_ORIGINAL, FAILED_PATCHED, (s) => s.includes('|| !consoleRuntime.healthy;')],
];
const occurrences = (source, needle) => {
  let count = 0; let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) { count++; offset += needle.length; }
  return count;
};
function editsFor(source) {
  if (isNativeConsoleLifecycleSource(source)) return [];
  if (source.includes('function startServer({ port =') || source.includes(CONSOLE_PRODUCT_MARKER)) {
    const embedded = source.match(/const CONSOLE_VENDOR_SHA256 = '([0-9a-f]{64})';/)?.[1];
    return consoleEdits(embedded || crypto.createHash('sha256').update(source).digest('hex'));
  }
  if (source.includes('export function installConsoleRuntime(') || source.includes('async function consoleRuntimeStatus(cacheDir)')) return INSTALLER_EDITS;
  return null;
}
export function patchSource(pristine) {
  const edits = editsFor(pristine);
  if (!edits) return { next: pristine, applied: [], missing: ['unrecognised-brain-console-file'] };
  let next = pristine; const applied = []; const missing = [];
  for (const [id, find, replace, done] of edits) {
    if (done(next)) continue;
    const count = occurrences(next, find);
    if (count === 1) { next = next.replace(find, replace); applied.push(id); }
    else missing.push(count > 1 ? id + '(AMBIGUOUS: anchor occurs ' + count + 'x)' : id);
  }
  return { next, applied, missing };
}
export function reverseSource(patched) {
  const edits = editsFor(patched); if (!edits) return patched;
  let candidate = patched;
  for (const [, find, replace] of [...edits].reverse()) {
    if (occurrences(candidate, replace) === 1) candidate = candidate.replace(replace, find);
  }
  return candidate;
}
export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => {
  const edits = editsFor(source); return Boolean(edits && edits.every(([, , , done]) => done(source)));
};
export const fixtureSource = () => ({
  console: [TOKEN_ORIGINAL, START_ORIGINAL, ROUTE_ORIGINAL, ERROR_ORIGINAL, LISTEN_ORIGINAL, CLI_ORIGINAL].join('\n'),
  installer: ['export function installConsoleRuntime() {}', DOCTOR_ANCHOR, DOCTOR_OUTPUT_ORIGINAL, FAILED_ORIGINAL].join('\n'),
});
export const descriptor = {
  name: 'brain-console-lifecycle', atomic: true, discover, patchSource,
  hasPatch, reverse: reverseSource, isPatched,
};
