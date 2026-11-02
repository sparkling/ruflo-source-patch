// Ruflo #4666: retained HZ ordinary-entry capture adapter. Downstream, not upstream.
// Retire after native concurrent-owner capture and exact readback replace this route.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {discover as discoverBrain, resolveActive} from '../brain-managed-memory-boundary/discovery.mjs';
import {HOME_BASE} from '../cwd/paths.mjs';
import {makeSurface, makeDescriptor} from './transform.mjs';

export const NAME = 'ruflo-memory-entries-only';
export const BRAIN_RELATIVE = 'scripts/turn-outcome-capture.mjs';
const specs = JSON.parse(fs.readFileSync(new URL('./edits.json', import.meta.url), 'utf8'));

const NATIVE_RESOLVER_RELATIVE = 'scripts/ruflo-bin.mjs';
const BRIDGE_ENV = '__RUFLO_BRIDGE_PAYLOAD__';
const BRIDGE_MARKER = '__RUFLO_BRIDGE_RESULT__';
const BRIDGE_TIMEOUT_MS = 30000;
const BRIDGE_MAX_BUFFER = 4 * 1024 * 1024;

// Node >= 18 cannot synchronously require() an ESM module and discover() must stay
// synchronous, so the active Brain's public resolveRuflo export is invoked through a
// bounded child process that performs the dynamic import. The child only locates the
// native binary through that export; it never executes the resolved CLI and never
// touches SQLite.
const BRIDGE_SOURCE = `
const MARKER = ${JSON.stringify(BRIDGE_MARKER)};
const PAYLOAD_ENV = ${JSON.stringify(BRIDGE_ENV)};
let result;
try {
  const payload = JSON.parse(process.env[PAYLOAD_ENV] || 'null');
  delete process.env[PAYLOAD_ENV];
  if (!payload || typeof payload.moduleURL !== 'string' || !payload.moduleURL)
    throw Error('Native Ruflo resolver bridge payload is invalid');
  const native = await import(payload.moduleURL);
  if (typeof native?.resolveRuflo !== 'function')
    result = {ok: false, message: 'Active Brain has no public resolveRuflo export'};
  else {
    const binary = native.resolveRuflo({env: process.env, home: payload.home});
    result = binary
      ? {ok: true, binary}
      : {ok: false, message: 'Active Brain cannot resolve its native Ruflo executable'};
  }
} catch (error) {
  result = {ok: false, message: error?.message ? String(error.message) : String(error)};
}
process.exitCode = result.ok ? 0 : 1;
process.stdout.write(MARKER + JSON.stringify(result) + '\\n');
`;

function resolveNativeBinary(nativeResolverPath) {
  const payload = JSON.stringify({moduleURL: pathToFileURL(nativeResolverPath).href, home: HOME_BASE});
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', BRIDGE_SOURCE], {
    env: {...process.env, [BRIDGE_ENV]: payload},
    encoding: 'utf8',
    timeout: BRIDGE_TIMEOUT_MS,
    maxBuffer: BRIDGE_MAX_BUFFER
  });
  if (child.error) throw Error(`Native Ruflo resolver bridge failed (${child.error.code ?? 'unknown'}): ${child.error.message}`);
  const stdout = typeof child.stdout === 'string' ? child.stdout : '';
  const markerAt = stdout.lastIndexOf(BRIDGE_MARKER);
  if (markerAt === -1) {
    const detail = [child.stderr, child.signal ? `signal ${child.signal}` : null]
      .filter(Boolean).map(value => String(value).trim()).join(', ');
    throw Error(`Active Brain native resolver bridge produced no result (status ${child.status ?? 'null'}${detail ? `: ${detail}` : ''})`);
  }
  const start = markerAt + BRIDGE_MARKER.length;
  const end = stdout.indexOf('\n', start);
  let result;
  try {
    result = JSON.parse(end === -1 ? stdout.slice(start) : stdout.slice(start, end));
  } catch (error) {
    throw Error(`Active Brain native resolver bridge output is not valid JSON: ${error.message}`);
  }
  if (result && result.ok === true) {
    if (child.status !== 0 || child.signal)
      throw Error(`Active Brain native resolver bridge terminated unsuccessfully (status ${child.status ?? 'null'}, signal ${child.signal ?? 'none'})`);
    if (typeof result.binary !== 'string' || !result.binary)
      throw Error('Active Brain native resolver bridge returned an invalid binary path');
    return result.binary;
  }
  if (result && result.ok === false && typeof result.message === 'string' && result.message)
    throw Error(result.message);
  throw Error('Active Brain native resolver bridge returned an unexpected result');
}

export function discover() {
  const surfaces = discoverBrain({includeOwned:false, allowMissingActive:true});
  if (!surfaces.length) return [];
  let active;
  try {
    active = resolveActive();
  } catch (error) {
    // Absence of active.json is not-applicable; malformed active state stays visible.
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const activeSurface = active?.surface;
  if (!activeSurface?.root) return [];
  const nativeResolverPath = path.join(activeSurface.root, NATIVE_RESOLVER_RELATIVE);
  let nativeStat;
  try {
    nativeStat = fs.lstatSync(nativeResolverPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (!nativeStat.isFile()) throw Error(`Active Brain native resolver is not a regular file: ${nativeResolverPath}`);
  const binary = resolveNativeBinary(nativeResolverPath);
  const entry = fs.realpathSync(binary);
  const manifestFile = createRequire(entry).resolve('@claude-flow/cli/package.json');
  if (JSON.parse(fs.readFileSync(manifestFile, 'utf8')).name !== '@claude-flow/cli')
    throw Error('Resolved native Ruflo CLI package identity mismatch');
  const cli = path.join(path.dirname(manifestFile), 'dist/src/memory/memory-bridge.js');
  const memoryTools = path.join(path.dirname(manifestFile), 'dist/src/mcp-tools/memory-tools.js');
  const candidates = [cli, memoryTools, ...surfaces.filter(surface => surface.kind === 'full')
    .map(surface => path.join(surface.root, BRAIN_RELATIVE))];
  const unique = new Set();
  for (const file of candidates) {
    if (!fs.lstatSync(file).isFile()) throw Error(`Capture source is not a regular file: ${file}`);
    unique.add(fs.realpathSync(file));
  }
  return [...unique];
}
export function applicability() {
  return discover().length ? {state:'applicable'}
    : {state:'not-applicable', reason:'no active Brain native Ruflo resolver'};
}
const base = makeDescriptor({name:NAME, discover, surfaces:specs.map(makeSurface)});
// The retained prototype initializes intelligence, then declines every controller
// it produced in purpose mode. That second model load consumes the readback budget.
const coldFrom = 'const initResult = await intelligence.initializeIntelligence();';
const coldTo = 'const initResult = memoryEntriesOnly ? {} : await intelligence.initializeIntelligence();';
const bridgeSource = source => source.includes(specs[0].identity);
const modelFrom = '        await embedder.initialize();';
const previousModelTo = `        // Exact reads do not need a model; preserve native role-aware generation on first embedding.
        if (typeof embedder.embedFor !== 'function' || typeof embedder.initialize !== 'function')
            throw new Error('memory-entries-only mode: native embedding lifecycle unavailable');
        const nativeEmbedFor = embedder.embedFor.bind(embedder);
        let embeddingReady;
        embedder.embedFor = (...args) => {
            embeddingReady ??= embedder.initialize();
            return embeddingReady.then(() => nativeEmbedFor(...args));
        };`;
const modelTo = `        // Exact reads need no embedding model. Native embedding and rescue run before a write embeds.
        let embeddingReady;
        const prepareEmbedding = () => {
            embeddingReady ??= embedder.initialize().then(() => rescueAgentdbEmbedder({ embedder }));
            return embeddingReady;
        };`;
export const captureCostEdits = [
  [coldFrom, coldTo], [modelFrom, modelTo],
  ['return { database, embedder, isWasm: false, close() {',
   'return { database, embedder, prepareEmbedding, isWasm: false, close() {'],
  ['    rescueAgentdbEmbedder(agentdb).catch(() => { });',
   "    if (typeof agentdb.prepareEmbedding !== 'function') rescueAgentdbEmbedder(agentdb).catch(() => { });"],
  ['async function embedForBridge(agentdb, text) {',
   'async function embedForBridge(agentdb, text) {\n    await agentdb?.prepareEmbedding?.();'],
];
const reverseCost = source => captureCostEdits.reduceRight((s, [from, to]) => s.replace(to, () => from), source)
  .replace(previousModelTo, () => modelFrom);
// Upstream bridgeStoreEntry permits legacy stores without vector_indexes.
// Retain the exact old requirement only for historical composition/reversal.
export const legacySchemaCheck = "        if (!database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vector_indexes'`).get())\n            throw new Error('memory-entries-only mode: vector_indexes table missing');\n";
const embeddingAnchor = '        const embedder = new EmbeddingService({';
const normalizeLegacy = source => reverseCost(source).replace(legacySchemaCheck, '');
// Owner correction: restore the retained baseline. These renditions exist only
// to recognize and undo the withdrawn startup changes, never to reinstall them.
export const descriptor = { ...base, applicability,
  historicalPatchSource: (source, current = '') => {
    const result = base.patchSource(source); let next = result.next;
    if (captureCostEdits.every(([, to]) => current.includes(to)))
      next = captureCostEdits.reduce((s, [from, to]) => s.replace(from, () => to), next);
    else {
      if (current.includes(coldTo)) next = next.replace(coldFrom, () => coldTo);
      if (current.includes(previousModelTo)) next = next.replace(modelFrom, () => previousModelTo);
    }
    if (current.includes(legacySchemaCheck)) next = next.replace(embeddingAnchor, () => legacySchemaCheck + embeddingAnchor);
    return { ...result, next };
  },
  hasPatch: source => base.hasPatch(normalizeLegacy(source)),
  isPatched: source => base.isPatched(source) && !captureCostEdits.some(([, to]) => source.includes(to)),
  reverse: source => base.reverse(normalizeLegacy(source)),
  patchSource(source) {
    const result = base.patchSource(normalizeLegacy(source));
    return { ...result, applied: result.next === source ? [] : [...result.applied, 'restore-native-initialization'] };
  },
};
