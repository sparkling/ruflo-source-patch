// Upstream contribution candidate only: signed helper templates MUST NOT be
// locally activated. Upstream must publish a newly signed helper manifest.
import crypto from 'node:crypto';

export const NATIVE_SHA256 = '631fac9d518835e2852a406888316bbbddddb49e7ed8e406d2e971f46833df9a';
export const MARKER = 'AutoMemory verified persistence and exact read';
const digest = source => crypto.createHash('sha256').update(source).digest('hex');

const INITIALIZE = `  _readPersisted() {
    let text;
    try { text = readFileSync(this.filePath, 'utf-8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.storePresent = false;
      return [];
    }
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) throw Error('AutoMemory store must be an array');
    const ids = new Set();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || ids.has(row.id))
        throw Error('AutoMemory store contains invalid or duplicate entry IDs');
      ids.add(row.id);
    }
    this.storePresent = true;
    return rows;
  }

  async initialize() {
    const rows = this._readPersisted();
    this.entries = new Map(rows.map(entry => [entry.id, entry]));
    this.loadedIds = new Set(this.entries.keys());
  }

  verifyPersisted(expected = this.entries) {
    const actual = new Map(this._readPersisted().map(entry => [entry.id, entry]));
    if (!this.storePresent) throw Error('AutoMemory persisted store readback missing');
    for (const [id, entry] of expected) {
      if (!actual.has(id) || JSON.stringify(actual.get(id)) !== JSON.stringify(entry))
        throw Error('AutoMemory persisted entry readback mismatch');
    }
    for (const id of this.deletedIds) {
      if (actual.has(id)) throw Error('AutoMemory persisted deletion readback mismatch');
    }
  }
`;

const PERSIST = `  _persist() {
    withStoreLock(this.filePath, () => {
      // Preserve the native merge policy; fail instead of overwriting unreadable data.
      const merged = new Map(this.entries);
      for (const entry of this._readPersisted()) {
        if (!merged.has(entry.id) && !this.loadedIds.has(entry.id) && !this.deletedIds.has(entry.id))
          merged.set(entry.id, entry);
      }
      writeFileAtomic(this.filePath, JSON.stringify([...merged.values()], null, 2));
      this.verifyPersisted(merged);
      for (const id of merged.keys()) this.loadedIds.add(id);
      this.entries = merged;
    });
  }
`;

const READ = `// ${MARKER}: uses the owning native backend without shutdown/write.
async function doRead() {
  const args = process.argv.slice(3);
  if (args.length !== 2 || args.some(arg => !arg || arg.length > 4096 || arg.includes('\\0')))
    throw Error('Usage: auto-memory-hook.mjs read <namespace> <key>');
  const [namespace, key] = args;
  const backend = new JsonFileBackend(STORE_PATH);
  await backend.initialize();
  const matches = await backend.query({ type: 'exact', namespace, key });
  if (matches.length > 1) throw Error('AutoMemory exact key is ambiguous');
  const entry = await backend.getByKey(key, namespace);
  console.log(JSON.stringify({ schemaVersion: 1, store: STORE_PATH,
    storePresent: backend.storePresent, namespace, key, found: entry !== null, entry }));
}

`;

const MAIN = `// Strict errors are observable even when hooks are configured as non-blocking.
process.on('unhandledRejection', reason => {
  process.stderr.write('[AutoMemory] failed: ' + (reason?.message || String(reason)) + '\\n');
  process.exitCode = 1;
});

try {
  switch (command) {
    case 'import': await doImport(); break;
    case 'sync': await doSync(); break;
    case 'status': await doStatus(); break;
    case 'read': await doRead(); break;
    default: throw Error('Usage: auto-memory-hook.mjs <import|sync|status|read>');
  }
} catch (error) {
  process.stderr.write('[AutoMemory] failed: ' + error.message + '\\n');
  process.exitCode = 1;
}
process.exit(process.exitCode || 0);
`;

// The full pristine hash gates all exact replacements. There is deliberately no
// discovery/descriptor/install path: native Ed25519 publication is required.
export function patchSource(source) {
  if (digest(source) !== NATIVE_SHA256)
    return { next: source, applied: [], missing: ['exact-native-auto-memory-helper'] };
  let next = source;
  function replace(from, to) {
    if (next.split(from).length !== 2) throw Error('AutoMemory candidate anchor is not unique');
    next = next.replace(from, () => to);
  }
  const command = "const COMMANDS = ['import', 'sync', 'status'];\nconst command = process.argv[2] || (COMMANDS.includes(process.argv[1]) ? process.argv[1] : 'status');";
  replace(command, '');
  replace('// Ensure data dir\nif (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });',
    command.replace("'sync', 'status'", "'sync', 'status', 'read'") +
    "\n\n// Exact read must not create directories or flush a backend.\nif (command !== 'read' && !existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });");
  const initStart = source.indexOf('  async initialize() {');
  replace(source.slice(initStart, source.indexOf('  async shutdown()', initStart)), INITIALIZE + '\n');
  const persistStart = source.indexOf('  _persist() {');
  replace(source.slice(persistStart, source.indexOf('\n}\n', persistStart)), PERSIST.trimEnd());
  replace('async function doImport() {', READ + 'async function doImport() {');
  replace("    warnMemoryUnavailable();\n    return;\n  }\n\n  const config = readConfig();\n  const backend = trackBackend(new JsonFileBackend(STORE_PATH));\n  await backend.initialize();\n\n  const bridgeConfig", "    warnMemoryUnavailable();\n    throw Error('AutoMemory import package unavailable');\n  }\n\n  const config = readConfig();\n  const backend = trackBackend(new JsonFileBackend(STORE_PATH));\n  await backend.initialize();\n\n  const bridgeConfig");
  replace('    const result = await bridge.importFromAutoMemory();',
    "    const failures = [];\n    bridge.on?.('import:file-error', () => failures.push('source read failed'));\n    bridge.on?.('import:delete-skipped', () => failures.push('source deletion unverified'));\n    const result = await bridge.importFromAutoMemory();\n    await backend.shutdown();\n    backend.verifyPersisted();\n    if (failures.length || result.errors?.length) throw Error('AutoMemory import incomplete');");
  replace('    dim(`Import failed (non-critical): ${err.message}`);\n  }\n\n  await backend.shutdown();',
    '    throw err;\n  } finally {\n    if (bridge.destroy) bridge.destroy();\n    activeBackend = null;\n  }');
  const mainStart = source.indexOf('// Dynamic import() failures can surface');
  replace(source.slice(mainStart), MAIN);
  return { next, applied: ['native-auto-memory-exact-read-and-verified-persistence'], missing: [] };
}
