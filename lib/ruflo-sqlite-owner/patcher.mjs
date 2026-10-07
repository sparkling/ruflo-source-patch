// ruvnet/ruflo#3693: every native handle for one file must use one SQLite
// library identity. POSIX locks belong to the process, not each library copy.
export const ISSUE = 'https://github.com/ruvnet/ruflo/issues/3693';
export const MARKER = 'ruflo-source-patch (#3693)';
export const BRIDGE_ANCHOR = "import { createRequire } from 'node:module';";
export const SQLITE_OWNER_HELPER = `// ${MARKER}: follow ControllerRegistry's real dependency owner.
export function loadAgentDbSqlite() {
    const memoryOwner = import.meta.resolve('@claude-flow/memory');
    const agentDbOwner = createRequire(new URL(memoryOwner)).resolve('agentdb');
    const Database = createRequire(agentDbOwner)('better-sqlite3');
    if (typeof Database !== 'function')
        throw new Error('AgentDB native SQLite constructor unavailable');
    return Database;
}`;
export const BRIDGE_REPLACEMENT = `${BRIDGE_ANCHOR}\n${SQLITE_OWNER_HELPER}`;
export const ATTESTATION_ANCHOR = "                                            const Database = cjsRequire('better-sqlite3');";
export const ATTESTATION_REPLACEMENT = '                                            const Database = loadAgentDbSqlite();';

export const GRAPH_ANCHOR = `            const mod = 'better-sqlite3';
            BetterSqlite3 = (await import(mod)).default;`;
export const GRAPH_REPLACEMENT = `            // ${MARKER}: never open the same file through a second library.
            const { loadAgentDbSqlite } = await import('./memory-bridge.js');
            BetterSqlite3 = loadAgentDbSqlite();`;
export const INITIALIZER_ANCHOR = `        // Module name behind a variable so TS does not statically resolve the
        // optional native dep's types at build time (CI may not install them).
        const mod = 'better-sqlite3';
        Database = (await import(mod)).default;`;
export const INITIALIZER_REPLACEMENT = `        // ${MARKER}: repair/recovery share the registry's native library.
        const { loadAgentDbSqlite } = await import('./memory-bridge.js');
        Database = loadAgentDbSqlite();`;
const suffix = file => ['@claude-flow', 'cli', 'dist', 'src', 'memory', file];
export const SQLITE_OWNER_ENTRIES = [
  {
    id: 'ruflo-sqlite-owner/bridge-loader', target: 'ruflo-sqlite-owner',
    suffix: suffix('memory-bridge.js'),
    nativeSatisfied: source => nativeSqliteOwnerSatisfied(source, 'memory-bridge.js'),
    edits: [
      { find: BRIDGE_ANCHOR, replace: BRIDGE_REPLACEMENT },
      { find: ATTESTATION_ANCHOR, replace: ATTESTATION_REPLACEMENT },
    ],
  },
  {
    id: 'ruflo-sqlite-owner/graph-writer', target: 'ruflo-sqlite-owner',
    suffix: suffix('graph-edge-writer.js'),
    nativeSatisfied: source => nativeSqliteOwnerSatisfied(source, 'graph-edge-writer.js'),
    edits: [{ find: GRAPH_ANCHOR, replace: GRAPH_REPLACEMENT }],
  },
  {
    id: 'ruflo-sqlite-owner/initializer', target: 'ruflo-sqlite-owner',
    suffix: suffix('memory-initializer.js'),
    nativeSatisfied: source => nativeSqliteOwnerSatisfied(source, 'memory-initializer.js'),
    // The exact published block occurs in both recovery and vector repair.
    // Patch every occurrence; no optional/no-other-library fallback.
    edits: [{ find: INITIALIZER_ANCHOR, replace: INITIALIZER_REPLACEMENT, all: true }],
  },
];

export function patchSqliteOwnerSource(source, file) {
  const entry = SQLITE_OWNER_ENTRIES.find(item => item.suffix.at(-1) === file);
  if (!entry) throw new Error('Unknown native SQLite source surface');
  if (nativeSqliteOwnerSatisfied(source, file)) return { next: source, missing: [] };
  let next = source;
  const missing = [];
  for (const edit of entry.edits) {
    if (next.includes(edit.replace)) continue;
    const count = next.split(edit.find).length - 1;
    if (count < 1 || (!edit.all && count !== 1)) {
      missing.push(`${entry.id}: ${count ? 'ambiguous' : 'missing'} anchor`);
      continue;
    }
    next = edit.all ? next.split(edit.find).join(edit.replace) : next.replace(edit.find, edit.replace);
  }
  return { next: missing.length ? source : next, missing };
}

// Ruflo 3.54.x ships the shared-sqlite owner in graph/repair code. It is an
// upstream replacement for this target when the helper is present and all
// three surfaces use it. Do not report old anchors as drift in that case.
export function nativeSqliteOwnerSatisfied(source, file) {
  if (file === 'graph-edge-writer.js') return source.includes("from './shared-sqlite.js'")
    && source.includes('loadBetterSqlite3()');
  if (file === 'memory-initializer.js') return source.includes("from './shared-sqlite.js'")
    && source.includes('Database = await loadBetterSqlite3();');
  if (file === 'memory-bridge.js') return source.includes("from './shared-sqlite.js'")
    && source.includes('resolveAgentdbBetterSqlite3()');
  return false;
}
export function reverseSqliteOwnerSource(source, file) {
  const entry = SQLITE_OWNER_ENTRIES.find(item => item.suffix.at(-1) === file);
  if (!entry) throw new Error('Unknown native SQLite source surface');
  for (const edit of [...entry.edits].reverse()) source = source.split(edit.replace).join(edit.find);
  return source;
}
