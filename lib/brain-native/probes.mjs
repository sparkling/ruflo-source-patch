// Executable retirement proofs for Brain replacements delivered through the native persistent
// Console runtime. Remote issue state and version strings are never sufficient: these probes copy
// the active runtime, remove only locally owned overlays in that copy, and execute the vendor bytes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { HOME_BASE } from '../cwd/paths.mjs';

const PATCH_TEXT = 'ruflo-source-patch';

function cleanEnv(home, extra = {}) {
  const env = { HOME: home, RUVNET_CONSOLE_ROOT: home, ...extra };
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'ComSpec', 'PATHEXT']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function walkFiles(root, visit) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`refusing symlinked native runtime path: ${file}`);
    if (entry.isDirectory()) walkFiles(file, visit);
    else if (entry.isFile()) visit(file);
  }
}

function copyVendorRuntime() {
  const brainHome = path.resolve(process.env.RSP_RUVNET_BRAIN_HOME
    || path.join(HOME_BASE, '.cache', 'ruvnet-brain'));
  const source = path.join(brainHome, 'kb', '.console-runtime');
  const stat = fs.lstatSync(source);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`native persistent Console runtime is not a regular directory: ${source}`);
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-brain-native-proof-'));
  const runtime = path.join(temporary, 'runtime');
  fs.cpSync(source, runtime, { recursive: true, force: false, errorOnExist: true });

  // A composed live file can contain several local targets. Its one .rsp-backup is the exact vendor
  // baseline. Restore it only when the copied live file still carries local ownership; otherwise an
  // in-place upstream replacement outranks a potentially stale backup.
  const backups = [];
  walkFiles(runtime, (file) => { if (file.endsWith('.rsp-backup')) backups.push(file); });
  for (const backup of backups) {
    const target = backup.slice(0, -'.rsp-backup'.length);
    const saved = fs.readFileSync(backup, 'utf8');
    if (!saved.length) throw new Error(`empty native pristine backup: ${backup}`);
    let current = '';
    try { current = fs.readFileSync(target, 'utf8'); } catch { /* absent additive target */ }
    if (current.includes(PATCH_TEXT)) fs.writeFileSync(target, saved);
    fs.rmSync(backup, { force: true });
  }
  return { temporary, runtime };
}

function runJson(script, env, timeout = 30_000) {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024,
  });
  if (run.error || run.status !== 0) {
    throw new Error(run.error?.message || (run.stderr || run.stdout || `exit ${run.status}`).trim());
  }
  const line = run.stdout.trim().split('\n').filter(Boolean).at(-1);
  try { return JSON.parse(line); }
  catch (error) { throw new Error(`native probe returned invalid JSON: ${error.message}`); }
}

function nativeInstallerFile() {
  const file = path.resolve(process.env.RSP_RUVNET_BRAIN_INSTALLER
    || path.join(process.env.RSP_RUVNET_BRAIN_MARKETPLACE
      || path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain'),
    'bin', 'install.mjs'));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
    throw new Error(`native installer is not a regular file: ${file}`);
  }
  return file;
}

export function probeProviderCatalogReplacement() {
  let staged;
  try {
    staged = copyVendorRuntime();
    const home = path.join(staged.temporary, 'home');
    const cache = path.join(staged.temporary, 'candidate-cache');
    fs.mkdirSync(home, { recursive: true });
    const installerUrl = pathToFileURL(nativeInstallerFile()).href;
    const consoleUrl = pathToFileURL(path.join(staged.runtime, 'scripts', 'onboarding-console.mjs')).href;
    const runtimeArg = JSON.stringify(staged.runtime);
    const cacheArg = JSON.stringify(cache);
    const installerArg = JSON.stringify(installerUrl);
    const consoleArg = JSON.stringify(consoleUrl);
    const env = cleanEnv(home, {
      OPENAI_API_KEY: 'rsp-openai-provider-proof',
      GEMINI_API_KEY: 'rsp-gemini-provider-proof',
    });

    const transaction = runJson(`
      const mod = await import(${installerArg});
      const tx = mod.beginConsoleRuntimeTransaction(${cacheArg}, ${runtimeArg});
      const result = { version: tx.identity.runtimeVersion, digest: tx.identity.sourceSha256 };
      tx.rollback();
      console.log(JSON.stringify(result));
    `, env);
    const positive = runJson(`
      const mod = await import(${consoleArg});
      const value = mod.gatherRouterEngine();
      console.log(JSON.stringify({ keys: value.keys, subscriptions: value.subscriptions, catalog: value.providerCatalog }));
    `, env);

    const app = fs.readFileSync(path.join(staged.runtime, 'console', 'app.js'), 'utf8');
    fs.rmSync(path.join(staged.runtime, 'data', 'model-catalog.json'));
    const negative = runJson(`
      const mod = await import(${consoleArg});
      const value = mod.gatherRouterEngine();
      console.log(JSON.stringify({ keys: value.keys, subscriptions: value.subscriptions, catalog: value.providerCatalog }));
    `, env);
    const rejected = runJson(`
      const mod = await import(${installerArg});
      try {
        const tx = mod.beginConsoleRuntimeTransaction(${cacheArg}, ${runtimeArg});
        tx.rollback();
        console.log(JSON.stringify({ rejected: false }));
      } catch (error) {
        console.log(JSON.stringify({ rejected: /model-catalog|missing data/.test(String(error.message)) }));
      }
    `, env);

    const ok = /^[a-f0-9]{64}$/.test(transaction.digest || '')
      && positive.keys?.openai === true && positive.keys?.google === true
      && positive.catalog?.status === 'ok' && positive.catalog?.keysVerified === true
      && negative.catalog?.status === 'degraded' && negative.catalog?.keysVerified === false
      && negative.subscriptions?.openai?.apiKey === true
      && negative.subscriptions?.google?.apiKey === true
      && rejected.rejected === true
      && app.includes('catalogHealth.keysVerified !== false')
      && app.includes('Not checked — Brain could not load its provider catalog');
    return ok
      ? { state: 'superseded', evidence: `native Console runtime ${transaction.version} stages and validates its catalog, detects synthetic OpenAI/Google keys, and reports missing catalog data as not checked` }
      : { state: 'live', evidence: 'the active native provider-catalog workflow failed its staged, positive, degraded, or UI behavior proof' };
  } catch (error) {
    return { state: 'unknown', evidence: `could not execute the native provider-catalog proof: ${error.message}` };
  } finally {
    if (staged?.temporary) fs.rmSync(staged.temporary, { recursive: true, force: true });
  }
}

export function probeMemoryDoctorRootsReplacement() {
  let staged;
  try {
    staged = copyVendorRuntime();
    const home = path.join(staged.temporary, 'home');
    const sourceStore = path.join(home, 'source', 'alpha', '.swarm', 'memory.db');
    const workStore = path.join(home, 'work', 'beta', '.swarm', 'memory.db');
    const customStore = path.join(home, 'custom', 'gamma', '.swarm', 'memory.db');
    for (const file of [sourceStore, workStore, customStore]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'fixture');
    }
    const config = path.join(home, '.claude', 'ruvnet-brain', 'config.json');
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(config, `${JSON.stringify({ scanRoots: [path.join(home, 'custom')] })}\n`);

    const doctorUrl = pathToFileURL(path.join(staged.runtime, 'scripts', 'memory-doctor.mjs')).href;
    const doctorArg = JSON.stringify(doctorUrl);
    const configArg = JSON.stringify(config);
    const invalidConfig = JSON.stringify('{"scanRoots":["missing"]}\n');
    const malformedConfig = JSON.stringify('{bad json\n');
    const result = runJson(`
      import fs from 'node:fs';
      const mod = await import(${doctorArg});
      const roots = mod.candidateRoots();
      const stores = mod.findStores();
      const scoped = mod.findStores(${JSON.stringify(path.join(home, 'custom'))});
      fs.writeFileSync(${configArg}, ${invalidConfig});
      let invalidFailed = false;
      try { mod.candidateRoots(); } catch { invalidFailed = true; }
      fs.writeFileSync(${configArg}, ${malformedConfig});
      const malformedFallback = mod.candidateRoots();
      console.log(JSON.stringify({ roots, stores, scoped, invalidFailed, malformedFallback }));
    `, cleanEnv(home));
    const consoleSource = fs.readFileSync(path.join(staged.runtime, 'scripts', 'onboarding-console.mjs'), 'utf8');
    const ok = [sourceStore, workStore, customStore].every((file) => result.stores.includes(fs.realpathSync(file)))
      && result.scoped.length === 1 && result.scoped[0] === fs.realpathSync(customStore)
      && result.invalidFailed === true
      && result.malformedFallback.includes(fs.realpathSync(path.join(home, 'source')))
      && result.malformedFallback.includes(fs.realpathSync(path.join(home, 'work')))
      && consoleSource.includes('candidateRoots({ home: CONSOLE_ROOT, configPath: CONFIG_PATH })')
      && consoleSource.includes('const stores = findStores();');
    return ok
      ? { state: 'superseded', evidence: `native memory doctor scans common/configured roots, preserves exact-root scope, fails invalid configured roots, and shares discovery with the Console` }
      : { state: 'live', evidence: 'the active native memory-doctor workflow failed its common/configured, scoped, invalid-config, or Console-convergence proof' };
  } catch (error) {
    return { state: 'unknown', evidence: `could not execute the native memory-doctor proof: ${error.message}` };
  } finally {
    if (staged?.temporary) fs.rmSync(staged.temporary, { recursive: true, force: true });
  }
}
