// Behavior-based retirement for released Brain #81/#86 replacements.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SB = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-brain-native-retire-')));
const HOME = path.join(SB, 'home');
const BRAIN_HOME = path.join(HOME, '.cache', 'ruvnet-brain');
const RUNTIME = path.join(BRAIN_HOME, 'kb', '.console-runtime');
const MARKETPLACE = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain');
const INSTALLER = path.join(MARKETPLACE, 'bin', 'install.mjs');
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.RUFLO_NPX_ROOT = path.join(SB, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(SB, 'global');
process.env.RSP_RUVNET_BRAIN_HOME = BRAIN_HOME;
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = MARKETPLACE;
process.env.RSP_RUVNET_BRAIN_INSTALLER = INSTALLER;

const write = (file, body, mode = 0o644) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
};
const check = (label, condition, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`);
  console.log(`  ✓ ${label}`);
};

const memoryDoctor = `import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const HOME = os.homedir();
const DEFAULT_SCAN_ROOTS = ['Code', 'code', 'src', 'source', 'projects', 'dev', 'work'];
const canonical = (value) => { try { return fs.realpathSync(value); } catch { return null; } };
export function candidateRoots({ home = HOME, configPath = path.join(home, '.claude', 'ruvnet-brain', 'config.json') } = {}) {
  let configured = []; let configuredCount = 0;
  try { const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); if (Array.isArray(cfg.scanRoots)) { configuredCount = cfg.scanRoots.length; configured = cfg.scanRoots.filter((v) => typeof v === 'string' && v.trim()); } } catch {}
  const out = new Set();
  const add = (value) => { const found = canonical(path.isAbsolute(value) ? value : path.join(home, value)); if (found && fs.statSync(found).isDirectory()) { out.add(found); return true; } return false; };
  DEFAULT_SCAN_ROOTS.forEach(add); let valid = 0; for (const value of configured) if (add(value)) valid++;
  if (configuredCount > 0 && valid === 0) throw new Error('configured scanRoots contain no existing directories');
  return [...out].sort();
}
function below(root) { const out = []; const walk = (dir, depth) => { if (depth > 4) return; let entries=[]; try { entries=fs.readdirSync(dir,{withFileTypes:true}); } catch { return; } for (const e of entries) { if (!e.isDirectory() || e.name === 'node_modules' || e.name === '.git') continue; if (e.name === '.swarm') { const db=canonical(path.join(dir,'.swarm','memory.db')); if (db) out.push(db); continue; } if (!e.name.startsWith('.')) walk(path.join(dir,e.name),depth+1); } }; walk(root,0); return out; }
export function findStores(root) { const roots = root === undefined ? candidateRoots() : [root]; return [...new Set(roots.flatMap(below))].sort(); }
`;

const consoleSource = `import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateRoots, findStores } from './memory-doctor.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONSOLE_ROOT = os.homedir(); const CONFIG_PATH = path.join(CONSOLE_ROOT,'.claude','ruvnet-brain','config.json');
function consoleCandidateRoots() { return candidateRoots({ home: CONSOLE_ROOT, configPath: CONFIG_PATH }); }
function scanFleet() { const stores = findStores(); return stores; }
function subscriptions() { return { openai:{apiKey:!!process.env.OPENAI_API_KEY}, google:{apiKey:!!(process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY)} }; }
export function gatherRouterEngine() {
  const subs = subscriptions(); let keys = { openrouter:false, openai:subs.openai.apiKey, google:subs.google.apiKey };
  let providerCatalog = { status:'degraded', keysVerified:false, detail:'provider catalog unavailable' };
  try { const cat=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','model-catalog.json'),'utf8')); if (!cat.providers) throw new Error('missing'); providerCatalog={status:'ok',keysVerified:true}; } catch {}
  return { keys, subscriptions: subs, providerCatalog };
}
`;

const installer = `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export function beginConsoleRuntimeTransaction(cache, source) {
  const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
  const cat=JSON.parse(fs.readFileSync(path.join(source,'data','model-catalog.json'),'utf8'));
  if (!cat.providers || !Object.keys(cat.providers).length) throw new Error('model-catalog providers missing');
  return { identity:{runtimeVersion:pkg.version,sourceSha256:crypto.createHash('sha256').update(JSON.stringify(cat)).digest('hex')}, rollback(){} };
}
`;

fs.rmSync(SB, { recursive: true, force: true });
write(path.join(RUNTIME, 'package.json'), '{"name":"ruvnet-brain","version":"4.0.12"}\n');
write(path.join(RUNTIME, 'scripts', 'memory-doctor.mjs'), memoryDoctor);
write(path.join(RUNTIME, 'scripts', 'onboarding-console.mjs'), consoleSource);
write(path.join(RUNTIME, 'bin', 'install.mjs'), installer);
write(path.join(RUNTIME, 'data', 'model-catalog.json'), '{"providers":{"openai":{},"google":{}}}\n');
write(path.join(RUNTIME, 'console', 'app.js'), "const keysVerified = catalogHealth.keysVerified !== false; const note = 'Not checked — Brain could not load its provider catalog';\n");
write(path.join(MARKETPLACE, 'package.json'), '{"name":"ruvnet-brain","version":"4.0.12"}\n');
write(INSTALLER, installer);

const probes = await import('../lib/brain-native/probes.mjs');
const provider = probes.probeProviderCatalogReplacement();
const memory = probes.probeMemoryDoctorRootsReplacement();
check('BNR1 provider replacement passes staged, positive, degraded, and UI behavior', provider.state === 'superseded', JSON.stringify(provider));
check('BNR2 memory replacement passes common/configured, scoped, and invalid-config behavior', memory.state === 'superseded', JSON.stringify(memory));

const consoleFile = path.join(RUNTIME, 'scripts', 'onboarding-console.mjs');
write(consoleFile, consoleSource.replace("keysVerified:false", "keysVerified:true"));
check('BNR3 degraded catalog output cannot falsely authorize provider retirement',
  probes.probeProviderCatalogReplacement().state === 'live');
write(consoleFile, consoleSource);
const doctorFile = path.join(RUNTIME, 'scripts', 'memory-doctor.mjs');
write(doctorFile, memoryDoctor.replace("'source', 'projects', 'dev', 'work'", "'projects'"));
check('BNR4 a regression to roots that miss source/work cannot authorize memory retirement',
  probes.probeMemoryDoctorRootsReplacement().state === 'live');
write(doctorFile, memoryDoctor);

fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
write(path.join(HOME, '.claude', 'settings.json'), '{}\n');
const state = await import('../lib/cwd/state.mjs');
const supersede = await import('../lib/supersede.mjs');
state.writeState({
  patchTargets: [],
  pluginTargets: ['brain-console-provider-keys', 'brain-memory-doctor-roots'],
  retired: {}, all: false,
});
const retired = supersede.retireSuperseded(state.readState());
const finalState = state.readState();
check('BNR5 both released replacements retire terminally on executable local proof',
  retired.retired === 2
    && finalState.pluginTargets.length === 0
    && finalState.retired['brain-console-provider-keys']?.issue.endsWith('/86')
    && finalState.retired['brain-memory-doctor-roots']?.issue.endsWith('/81'),
  JSON.stringify({ retired, finalState }));

console.log('✔ Brain native retirement (#81/#86 executable delivery and mutation proof)');
