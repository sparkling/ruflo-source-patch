// Explicitly enabled package hygiene on the existing short-lived monitor.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { STABLE_DIR, HOME_BASE, NPX_ROOT } from './paths.mjs';
import { syncedFrom } from './stable.mjs';
import { withPatchMutationLock } from './state.mjs';
import { currentVersion, isNewer } from './update-check.mjs';

const configPath = path.join(STABLE_DIR, 'package-maintenance.json');
const receiptPath = path.join(STABLE_DIR, 'package-maintenance-receipt.json');
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };
const save = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pending = file + '.' + process.pid + '.pending';
  fs.writeFileSync(pending, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(pending, file);
};
const keyIn = text => [...String(text).matchAll(/[/\\]_npx[/\\]([a-f0-9]{16})(?:[/\\]|$)/g)].map(m => m[1]);

export function cacheDisposition(entry, { now, versions, protectedKeys, maxAgeDays = 30 }) {
  if (!/^[a-f0-9]{16}$/.test(entry.key) || entry.unsafe || !entry.packages.length) return 'unclassified';
  if (protectedKeys.has(entry.key)) return 'in-use-or-referenced';
  if (entry.packages.some(p => /ruvnet-brain/.test(p.name))) return 'brain-owned';
  if (entry.managedState) return 'contains-runtime-state';
  if (entry.packages.some(p => versions[p.name] && isNewer(versions[p.name], p.version))) return 'obsolete';
  return now - entry.modifiedAt > maxAgeDays * 86400000 ? 'expired' : 'current';
}

function inventory() {
  let dirs; try { dirs = fs.readdirSync(NPX_ROOT, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return dirs.filter(e => /^[a-f0-9]{16}$/.test(e.name)).map(e => {
    const root = path.join(NPX_ROOT, e.name), stat = fs.lstatSync(root);
    const entry = { key: e.name, modifiedAt: stat.mtimeMs, unsafe: !stat.isDirectory() || stat.isSymbolicLink(), packages: [] };
    if (entry.unsafe) return entry;
    const manifest = read(path.join(root, 'package.json'), {});
    for (const name of Object.keys(manifest.dependencies || {})) {
      if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) { entry.unsafe = true; continue; }
      const pkg = read(path.join(root, 'node_modules', name, 'package.json'), null);
      if (pkg?.name === name && /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(pkg.version)) entry.packages.push({ name, version: pkg.version });
    }
    entry.managedState = ['.swarm', '.claude-flow', 'memory.db', 'agentdb.rvf', 'ruvector.db']
      .some(name => fs.existsSync(path.join(root, name)));
    return entry;
  });
}

function protectedCacheKeys(run) {
  // No process is killed. A failed process/open-file inventory forbids deletion.
  const keys = new Set(keyIn(run('/bin/ps', ['-axo', 'command='])));
  const lsof = process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof';
  for (const key of keyIn(run(lsof, ['-nP', '-Fpfn']))) keys.add(key);
  for (const file of [path.join(HOME_BASE, '.codex/config.toml'), path.join(HOME_BASE, '.claude.json')]) {
    try { for (const key of keyIn(fs.readFileSync(file, 'utf8'))) keys.add(key); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const key of keyIn(syncedFrom() || '')) keys.add(key);
  return keys;
}

export function configurePackageMaintenance({ enabled, npm = path.join(path.dirname(process.execPath), 'npm'), prefixes = [], npmSpec = 'npm@^11' }) {
  if (typeof enabled !== 'boolean' || !path.isAbsolute(npm) || !fs.existsSync(npm)
      || !['npm@latest', 'npm@^11'].includes(npmSpec)
      || !prefixes.length || prefixes.some(p => !path.isAbsolute(p))) throw Error('Invalid explicit npm maintenance configuration');
  const config = { enabled, npm, prefixes: [...new Set(prefixes)], npmSpec, intervalHours: 24, maxAgeDays: 30 };
  save(configPath, config); return config;
}

export const packageMaintenanceStatus = () => ({ config: read(configPath, null), receipt: read(receiptPath, null) });
function maintainPackages({ force = false, run } = {}) {
  const config = read(configPath, null);
  if (!config?.enabled) return { skipped: 'not-enabled' };
  if (!path.isAbsolute(config.npm) || !fs.existsSync(config.npm)
      || !Array.isArray(config.prefixes) || !config.prefixes.length
      || config.prefixes.some(p=>!path.isAbsolute(p)) || config.intervalHours!==24
      || config.maxAgeDays!==30 || !['npm@latest','npm@^11'].includes(config.npmSpec))
    throw Error('Invalid stored package maintenance configuration');
  run ??= (file,args)=>execFileSync(file,args,{encoding:'utf8',timeout:180000,
    maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe'],
    env:{...process.env,PATH:path.dirname(config.npm)+path.delimiter+(process.env.PATH||'')}});
  const previous = read(receiptPath, {}), now = Date.now();
  if (!force && now - Date.parse(previous.attemptedAt || '') < config.intervalHours * 3600000) return { skipped: 'not-due' };
  const receipt = { attemptedAt: new Date(now).toISOString(), status: 'running', removed: [], protected: [], updates: [] };
  save(receiptPath, receipt);
  try {
    const version = run(config.npm, ['view', 'ruflo', 'version']).trim();
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid registry version');
    const versions = { ruflo: version, 'claude-flow': version, '@claude-flow/cli': version,
      '@sparkleideas/ruflo-source-patch': currentVersion() };
    for (const prefix of config.prefixes) {
      run(config.npm, ['install', '--global', '--prefix', prefix, config.npmSpec, '--engine-strict']);
      receipt.updates.push({ prefix, requested: config.npmSpec });
    }
    run(config.npm, ['config', 'set', 'prefer-online', 'true', '--location=user']);
    const protectedKeys = protectedCacheKeys(run);
    const entries = inventory();
    for (const entry of entries) {
      const reason = cacheDisposition(entry, { now, versions, protectedKeys, maxAgeDays: config.maxAgeDays });
      if (!['obsolete', 'expired'].includes(reason)) { receipt.protected.push({ key: entry.key, reason }); continue; }
      // Recheck immediately before native removal; a new owner wins over cleanup.
      if (protectedCacheKeys(run).has(entry.key)) { receipt.protected.push({ key: entry.key, reason: 'became-in-use' }); continue; }
      run(config.npm, ['cache', 'npx', 'rm', entry.key]);
      if(fs.existsSync(path.join(NPX_ROOT,entry.key))) throw Error('Native npm did not remove cache '+entry.key);
      receipt.removed.push({ key: entry.key, reason }); save(receiptPath, receipt);
    }
    receipt.cacheVerification = run(config.npm, ['cache', 'verify']).trim();
    receipt.npmVersion = run(config.npm, ['--version']).trim();
    receipt.status = 'passed';
  } catch (error) { receipt.status = 'failed'; receipt.error = String(error.message).split('\n')[0]; }
  receipt.completedAt = new Date().toISOString(); save(receiptPath, receipt); return receipt;
}

export function runPackageMaintenance(options={}) {
  if(!read(configPath,null)?.enabled)return {skipped:'not-enabled'};
  return withPatchMutationLock(()=>maintainPackages(options));
}
