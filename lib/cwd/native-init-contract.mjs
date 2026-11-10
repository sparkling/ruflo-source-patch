// #2640 native capability-aware init qualification. Only published contract
// bytes plus a real executable registry/copy/MCP proof retire legacy suppression.
// All probe writes go to an in-memory fixture, never a user's plugin registry.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { nativeHash, nativeFunction, nativeScript } from './native-root-contract.mjs';

const HASHES = {
  "executor": "31f5ca6fde3e7768e0d47e2480b4c20891c16de2ca0a1ca0b0038bc83fb81b2e",
  "dedup": "e812e9f3f5a24f47703d6c5bc8a1abd9c9d9b2dce622581af7f463484a31c4f7",
  "registry": "31dbb314b50d4378ed81de5c95f2675db1f208b9659af81bfc80cf54a4f7f3fa",
  "types": "47c20ee8f0361ae96929039eb0af2dc994aeaa002b7390e702486f9e034caf6a",
  "mcp": "e03ce1aea0afe27318043a43c2c0c329a5bc7d9d5a491f6e1a95d47253c36b67"
};
const FUNCTIONS = ["executeInit", "writeMCPConfig", "copySkills", "copyCommands", "copyAgents", "copyDirSkipping", "copyDirRecursive", "countFiles"];
const cache = new Map();
const surface = source => FUNCTIONS.map(name => nativeFunction(source, name)).join('\n');

function memoryFs() {
  const files = new Map(), dirs = new Set(['/']);
  const mkdir = dir => { for (let d = dir; !dirs.has(d); d = path.dirname(d)) dirs.add(d); };
  const write = (file, data) => { mkdir(path.dirname(file)); files.set(file, String(data)); };
  const read = file => { if (!files.has(file)) throw new Error('absent: ' + file); return files.get(file); };
  const list = dir => {
    const entries = new Map();
    for (const f of files.keys()) if (path.dirname(f) === dir) entries.set(path.basename(f), false);
    for (const d of dirs) if (d !== dir && path.dirname(d) === dir) entries.set(path.basename(d), true);
    return [...entries].map(([name, directory]) => ({ name, isDirectory: () => directory }));
  };
  return { files, dirs, write, fs: {
    existsSync: f => files.has(f) || dirs.has(f), readFileSync: read, writeFileSync: write,
    mkdirSync: mkdir, copyFileSync: (from, to) => write(to, read(from)), readdirSync: list,
    statSync: f => ({ isDirectory: () => dirs.has(f) }), realpathSync: f => f,
  } };
}

export function proveNativeInit(sources) {
  const disk = memoryFs();
  const home = '/proof/home', config = path.join(home, '.claude'), project = '/proof/project';
  const api = disk.fs;
  const context = vm.createContext({
    fs: api, ...api, path, join: path.join, resolve: path.resolve,
    homedir: () => home, os: { homedir: () => home, platform: () => 'linux', arch: () => 'x64' },
    process: { env: {}, platform: 'linux', cwd: () => project },
    MARKETPLACE_NAME: 'ruflo', MARKETPLACE_SOURCE: {}, MOD_PLUGINS: [],
    findSourceDir: kind => '/proof/source/' + kind,
    SKILLS_MAP: { core: ['provided', 'remaining'] },
    COMMANDS_MAP: { core: ['category'] }, AGENTS_MAP: { core: ['category'] },
    detectExistingRufloMCP: () => null,
  }, { microtaskMode: 'afterEvaluate' });
  const run = code => vm.runInContext(code, context, { timeout: 1000 });
  run(`Object.assign(globalThis, (() => { ${nativeScript(sources.registry)}\n; return { installedState, claudeConfigDir, nodeReadFs }; })());`);
  run(`Object.assign(globalThis, (() => { ${nativeScript(sources.dedup)}\n; return { detectRufloPlugins, emptyDedupReport }; })());`);
  run(nativeScript(sources.types));
  run(nativeScript(sources.mcp));
  run(FUNCTIONS.filter(n => n !== 'executeInit').map(n => nativeScript(nativeFunction(sources.executor, n))).join('\n'));
  // Exact native dispatch block: detection, MCP, skills, commands and agents.
  const dispatch = sources.executor.slice(sources.executor.indexOf('    const c = options.components;'), sources.executor.indexOf('        // Generate helpers'));
  if (!dispatch.includes('result.pluginDedup = dedup;')) throw new Error('missing dispatch');
  run(`async function exercise(full = false) {
    const options = { ...(full ? FULL_INIT_OPTIONS : DEFAULT_INIT_OPTIONS), targetDir: '${project}', force: true,
      components: { mcp:true, skills:true, commands:true, agents:true, settings:false },
      skills: { all:true }, commands:{ all:true }, agents:{ all:true },
      mcp: { claudeFlow:true, ruvSwarm:true, flowNexus:false } };
    const targetDir = options.targetDir;
    const result = { created:{ files:[] }, skipped:[], errors:[], summary:{ skillsCount:0, commandsCount:0, agentsCount:0 } };
    ${dispatch}
    } catch (error) { throw error; }
    return result;
  }
  async function createDirectories() {}`);
  for (const kind of ['agents', 'commands']) {
    disk.write(`/proof/source/${kind}/category/provided.md`, 'provided');
    disk.write(`/proof/source/${kind}/category/remaining.md`, 'remaining');
    disk.write(`/proof/plugin/${kind}/provided.md`, 'plugin copy');
  }
  for (const skill of ['provided', 'remaining']) disk.write(`/proof/source/skills/${skill}/SKILL.md`, skill);
  disk.write('/proof/plugin/skills/provided/SKILL.md', 'plugin skill');
  const registry = { plugins: { 'ruflo-core@ruflo': [{ scope:'user', installPath:'/proof/plugin' }] } };
  const registryPath = path.join(config, 'plugins/installed_plugins.json');
  const settingsPath = path.join(config, 'settings.json');
  let checks = 0;
  const check = (dedup, full = false, allProvided = false) => {
    for (const f of disk.files.keys()) if (f.startsWith(project + '/')) disk.files.delete(f);
    for (const d of disk.dirs) if (d.startsWith(project + '/')) disk.dirs.delete(d);
    run(`globalThis.proofResult = undefined; globalThis.proofError = undefined;
      exercise(${full}).then(r => { globalThis.proofResult = r; }, e => { globalThis.proofError = e.message; });`);
    if (context.proofError || !context.proofResult) throw new Error(context.proofError || 'unfinished native dispatch');
    const result = context.proofResult;
    if (result.errors.length) throw new Error(result.errors.join(';'));
    for (const kind of ['agents', 'commands']) {
      if (disk.files.has(`${project}/.claude/${kind}/category/provided.md`) === dedup) throw new Error('provided ' + kind);
      if (disk.files.has(`${project}/.claude/${kind}/category/remaining.md`) === allProvided) throw new Error('remaining ' + kind);
    }
    if (disk.files.has(`${project}/.claude/skills/provided/SKILL.md`) === dedup) throw new Error('provided skill');
    if (disk.files.has(`${project}/.claude/skills/remaining/SKILL.md`) === allProvided) throw new Error('remaining skill');
    const mcp = JSON.parse(disk.files.get(`${project}/.mcp.json`)).mcpServers;
    if (('claude-flow' in mcp) === dedup || !('ruv-swarm' in mcp)) throw new Error('MCP preservation');
    if (Boolean(result.pluginDedup) !== dedup) throw new Error('dedup receipt');
    checks++;
  };
  check(false); // absent registry
  disk.write(registryPath, '{bad'); check(false);
  disk.files.delete(registryPath);
  disk.write(path.join(home, '.codex/plugins/installed_plugins.json'), JSON.stringify(registry)); check(false);
  disk.write(registryPath, JSON.stringify(registry)); check(true); // partial bundle
  disk.write(settingsPath, JSON.stringify({ enabledPlugins: { 'ruflo-core@ruflo': false } })); check(false);
  disk.write(settingsPath, JSON.stringify({ enabledPlugins: { 'ruflo-core@ruflo': true } })); check(true);
  check(false, true); // explicit --full preserves unconditionally requested files/MCP
  // A second enabled plugin covers the remaining capabilities; a disabled one
  // cannot suppress them. Fully provided directories are not materialized.
  for (const kind of ['agents','commands']) disk.write(`/proof/second/${kind}/remaining.md`, 'second');
  disk.write('/proof/second/skills/remaining/SKILL.md', 'second');
  registry.plugins['ruflo-agent@ruflo'] = [{scope:'user',installPath:'/proof/second'}];
  disk.write(registryPath,JSON.stringify(registry)); check(true,false,true);
  disk.write(settingsPath,JSON.stringify({enabledPlugins:{'ruflo-agent@ruflo':false}})); check(true);
  delete registry.plugins['ruflo-agent@ruflo'];
  disk.write(registryPath,JSON.stringify(registry));
  // Project/local setting precedence and project-scope registry ownership, via actual detector.
  disk.write(project + '/.claude/settings.json', JSON.stringify({ enabledPlugins: { 'ruflo-core@ruflo': false } }));
  if (run(`detectRufloPlugins('${project}')`) !== null) throw new Error('project disable');
  disk.write(project + '/.claude/settings.local.json', JSON.stringify({ enabledPlugins: { 'ruflo-core@ruflo': true } }));
  if (run(`detectRufloPlugins('${project}')`) === null) throw new Error('local enable');
  registry.plugins['ruflo-core@ruflo'][0] = { scope:'project', projectPath:'/elsewhere', installPath:'/proof/plugin' };
  disk.write(registryPath, JSON.stringify(registry));
  if (run(`detectRufloPlugins('${project}')`) !== null) throw new Error('foreign project');
  checks += 3;
  return checks;
}

export function nativeInitExpected(source, file) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(file), '../../../package.json'), 'utf8'));
    const [major, minor] = String(pkg.version).split('.').map(Number);
    // Version is only a refusal boundary, never acceptance evidence. A modern
    // owner missing its native dependencies must not receive legacy suppression.
    if (pkg.name === '@claude-flow/cli' && (major > 3 || (major === 3 && minor >= 75))) return true;
  } catch { /* exact native signals below also cover reduced fixtures */ }
  if (source.includes("import { detectRufloPlugins, emptyDedupReport } from './plugin-dedup.js';")) return true;
  try {
    const executor = fs.readFileSync(path.join(path.dirname(file), 'executor.js'), 'utf8');
    if (executor.includes('detectRufloPlugins')) return true;
    // A complete legacy bundle call is evidence for compatibility, not a
    // missing native dependency. Unknown/missing modern dependencies refuse.
    if (executor.includes('await copySkills(targetDir, options, result);')) return false;
  } catch { /* missing dependency is not proof of the legacy implementation */ }
  return nativeHash(source) === HASHES.mcp;
}

const LEGACY_MCP = "    if (false && config.claudeFlow) { // ruflo-source-patch(init): the ruflo plugin already provides this server; a project-local standalone copy double-writes .swarm/memory.db (#2621) and its bare tool refs don't resolve under plugin loading (#2685)\n        mcpServers['claude-flow'] = createMCPServerEntry(['ruflo@latest', 'mcp', 'start'], {";
const NATIVE_MCP = "    if (config.claudeFlow) {\n        mcpServers['claude-flow'] = createMCPServerEntry(['ruflo@latest', 'mcp', 'start'], {";

export function nativeInitSatisfied(source, file) {
  try {
    if (!file) return false;
    const dir = path.dirname(file);
    const read = name => {
      if (path.basename(file) === name) return source;
      const value = fs.readFileSync(path.join(dir, name), 'utf8');
      // During one ordered apply the sibling MCP file may still carry our
      // exact old suppression. Qualify only its hash-proven reversible bytes.
      return name === 'mcp-generator.js' ? value.replace(LEGACY_MCP, NATIVE_MCP) : value;
    };
    const sources = {
      executor: read('executor.js'), mcp: read('mcp-generator.js'), types: read('types.js'),
      dedup: read('plugin-dedup.js'), registry: fs.readFileSync(path.join(dir, '../mods/plugin-resolve.js'), 'utf8'),
    };
    for (const [key, value] of Object.entries(sources)) {
      if (nativeHash(key === 'executor' ? surface(value) : value) !== HASHES[key]) return false;
    }
    const imports = ["import * as fs from 'fs';", "import * as path from 'path';",
      "import { detectPlatform, DEFAULT_INIT_OPTIONS } from './types.js';",
      "import { generateMCPJson } from './mcp-generator.js';",
      "import { detectRufloPlugins, emptyDedupReport } from './plugin-dedup.js';"];
    if (imports.some(line => sources.executor.split(line).length !== 2)
      || !sources.executor.includes('await writeHelpers(targetDir, options, result);')) return false;
    const key = nativeHash(JSON.stringify(sources));
    if (!cache.has(key)) cache.set(key, proveNativeInit(sources) >= 12);
    return cache.get(key);
  } catch { return false; }
}
