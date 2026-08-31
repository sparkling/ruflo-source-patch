// Executable native-retirement proof for #3147/#3097. Candidate scripts run
// only against a fake `npx`; the probe never opens a real AgentDB store.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PATCH_MARKER } from './fragments.mjs';

const FAKE_NPX = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const option = (name) => {
  const eq = args.find((v) => v.startsWith('--' + name + '='));
  if (eq) return eq.slice(name.length + 3);
  const at = args.indexOf('--' + name);
  return at >= 0 ? args[at + 1] : undefined;
};
const op = args[2], mode = process.env.PROBE_MODE;
fs.appendFileSync(process.env.PROBE_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
let state = fs.existsSync(process.env.PROBE_STATE)
  ? JSON.parse(fs.readFileSync(process.env.PROBE_STATE, 'utf8'))
  : { 'adr-patterns': {}, 'adr-edges': {} };
const save = () => fs.writeFileSync(process.env.PROBE_STATE, JSON.stringify(state));
const ns = option('namespace');
if (op === 'list') {
  if (mode === 'malformed') return process.stdout.write('diagnostic\\n[]\\n');
  if (mode === 'cycle') {
    if (ns === 'adr-patterns') {
      const rows = Array.from({ length: 30 }, (_, i) => ({ key: 'ADR-' + String(i + 1).padStart(3, '0') + '::x.md', namespace: ns }));
      return process.stdout.write(JSON.stringify(rows) + '\\n');
    }
    return process.stdout.write(JSON.stringify([
      { key: 'supersedes:ADR-029->ADR-030', namespace: ns },
      { key: 'supersedes:ADR-030->ADR-029', namespace: ns },
    ]) + '\\n');
  }
  const rows = Object.keys(state[ns] || {}).map((key) => ({ key, namespace: ns }));
  const limit = Number(option('limit') || 20);
  return process.stdout.write(JSON.stringify(rows.slice(0, limit)) + '\\n');
}
if (op === 'store') {
  if (mode === 'false-success') return console.log('operation finished');
  if (mode === 'receipt-only') return console.log('Data stored successfully');
  state[ns] ||= {}; state[ns][option('key')] = option('value'); save();
  return console.log('Data stored successfully');
}
if (op === 'retrieve') {
  const value = state[ns]?.[option('key')];
  if (value === undefined) process.exit(1);
  return process.stdout.write(value);
}
if (op === 'purge') { console.error('purge is not atomic'); process.exit(8); }
if (op === 'reconcile' || op === 'upsert-batch' || op === 'import') {
  state['adr-patterns'] = {};
  for (let i = 1; i <= 30; i++) {
    const id = 'ADR-' + String(i).padStart(3, '0');
    state['adr-patterns'][id + '::' + id + '.md'] = JSON.stringify({ id });
  }
  state['adr-edges'] = {}; save();
  return console.log(JSON.stringify({ requested: 30, written: 30, failed: 0, errors: [] }));
}
console.error('unsupported managed operation: ' + op); process.exit(9);
`;

function run(file, env) {
  return spawnSync(process.execPath, [file], {
    env, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024,
  });
}

function calls(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch { return []; }
}

function storedKeys(file, namespace) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Object.keys(state[namespace] || {}).sort();
  } catch { return []; }
}

const verdict = (state, evidence) => ({ state, evidence });

export function probeNativeRoot(root) {
  const names = ['verify.mjs', 'import.mjs', 'reindex.mjs'];
  const sources = {};
  for (const name of names) {
    const file = path.join(root, 'scripts', name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return verdict('unknown', `${file} is not a regular non-symlink file`);
      sources[name] = fs.readFileSync(file, 'utf8');
      if (sources[name].includes(PATCH_MARKER)) return verdict('live', `${file} still carries the local #3147/#3097 patch`);
      const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 5000 });
      if (syntax.error || syntax.status !== 0) return verdict('unknown', `${file} fails syntax validation`);
    } catch (error) {
      return verdict('unknown', `could not inspect ${file}: ${error.message}`);
    }
  }

  // A public purge followed by a separate rebuild can never meet the atomic replacement contract.
  if (/['"]purge['"]/.test(sources['reindex.mjs'])
      || /better-sqlite3|sql\.js|wal_checkpoint|unlinkSync|renameSync/.test(sources['reindex.mjs'])) {
    return verdict('live', 'native reindex still exposes purge-first or raw-database behavior rather than atomic managed reconcile');
  }

  let temp;
  try {
    temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-adr-io-native-')));
    const plugin = path.join(temp, 'plugin');
    const project = path.join(temp, 'project');
    const docs = path.join(project, 'docs', 'adr');
    const bin = path.join(temp, 'bin');
    const log = path.join(temp, 'calls.jsonl');
    const state = path.join(temp, 'state.json');
    fs.cpSync(root, plugin, { recursive: true });
    fs.mkdirSync(path.join(project, '.git'), { recursive: true });
    fs.mkdirSync(path.join(project, '.swarm'), { recursive: true });
    fs.mkdirSync(docs, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(project, '.swarm', 'memory.db'), 'fake-not-sqlite\n');
    for (let i = 1; i <= 30; i++) {
      const id = `ADR-${String(i).padStart(3, '0')}`;
      fs.writeFileSync(path.join(docs, `${id}.md`), `# ${id}: Probe\n\n**Status**: Accepted\n`);
    }
    fs.writeFileSync(path.join(bin, 'npx'), FAKE_NPX, { mode: 0o755 });
    const base = {
      ...process.env,
      PATH: bin + path.delimiter + process.env.PATH,
      ADR_ROOT: docs,
      PROBE_LOG: log,
      PROBE_STATE: state,
      NO_COLOR: '1',
    };
    const reset = () => { fs.writeFileSync(log, ''); fs.writeFileSync(state, '{"adr-patterns":{},"adr-edges":{}}'); };
    const script = (name) => path.join(plugin, 'scripts', name);

    reset();
    let result = run(script('verify.mjs'), { ...base, PROBE_MODE: 'empty', VERIFY_FORMAT: 'json' });
    if (result.status !== 0) return verdict('live', 'native verifier rejects a successfully read empty graph');
    reset();
    result = run(script('verify.mjs'), { ...base, PROBE_MODE: 'malformed', VERIFY_FORMAT: 'json' });
    if (result.status === 0) return verdict('live', 'native verifier still accepts malformed list output as a healthy graph');
    reset();
    result = run(script('verify.mjs'), { ...base, PROBE_MODE: 'cycle', VERIFY_FORMAT: 'json' });
    if (result.status === 0) return verdict('live', 'native verifier still misses graph corruption beyond the default 20 rows');

    for (const mode of ['false-success', 'receipt-only']) {
      reset();
      result = run(script('import.mjs'), { ...base, PROBE_MODE: mode, IMPORT_FORMAT: 'json' });
      const observed = calls(log);
      if (result.status === 0 || observed.filter((call) => call.args[2] === 'store').length > 1) {
        return verdict('live', `native importer does not fail fast on ${mode}`);
      }
    }

    reset();
    result = run(script('import.mjs'), { ...base, PROBE_MODE: 'success', IMPORT_FORMAT: 'json' });
    const importCalls = calls(log);
    const exactPath = '--path=' + path.join(project, '.swarm', 'memory.db');
    const expectedRecords = Array.from(
      { length: 30 },
      (_, index) => `ADR-${String(index + 1).padStart(3, '0')}::ADR-${String(index + 1).padStart(3, '0')}.md`,
    ).sort();
    if (result.status !== 0 || importCalls.length > 12
        || importCalls.length === 0
        || importCalls.some((call) => call.cwd !== project || !call.args.includes(exactPath))
        || JSON.stringify(storedKeys(state, 'adr-patterns')) !== JSON.stringify(expectedRecords)) {
      return verdict('live', 'native importer lacks bounded batch startup count or exact managed-store identity');
    }

    reset();
    result = run(script('reindex.mjs'), { ...base, PROBE_MODE: 'success', REINDEX_FORMAT: 'json' });
    const reindexCalls = calls(log);
    if (result.status !== 0 || reindexCalls.length === 0
        || reindexCalls.some((call) => call.args[2] === 'purge') || reindexCalls.length > 12
        || reindexCalls.some((call) => call.cwd !== project || !call.args.includes(exactPath))
        || JSON.stringify(storedKeys(state, 'adr-patterns')) !== JSON.stringify(expectedRecords)
        || storedKeys(state, 'adr-edges').length !== 0) {
      return verdict('live', 'native reindex is not a bounded successful atomic managed reconcile');
    }
    return verdict('proven', 'complete verifier, fail-fast proven batch import, and atomic managed reindex all passed executable probes');
  } catch (error) {
    return verdict('unknown', `native ADR I/O probe could not run: ${error.message}`);
  } finally {
    if (temp) {
      try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}
