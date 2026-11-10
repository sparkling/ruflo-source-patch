// Qualified published 3.75.0 root consumers (#2633). No live filesystem probe:
// execute the actual, hash-qualified helper and consumer expressions against an
// in-memory filesystem. Legacy patches stay available for older source shapes.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

export const nativeHash = text => createHash('sha256').update(text).digest('hex');
export function nativeFunction(source, name) {
  const expression = new RegExp('(?:export )?(?:async )?function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}', 'g');
  const matches = [...source.matchAll(expression)];
  if (matches.length !== 1) throw new Error('ambiguous native function: ' + name);
  return matches[0][0];
}
export const nativeScript = source => source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const HASHES = {
  "core": "69a5f879c4492983cacb8bf287b7ae966b8897074d3fd943b667baa576a5ea5f",
  "helper": "2b4a0b6e1b4238ba78993222f7a0ffbddaa9f032cc7a8e83fd90eb20ed078093",
  "memoryRoot": "b9eb7638144a36ffa1c4c651385c8ff4e8c2dac0d5497d8d8352075f25f4b79b",
  "memory": "6611e31b3ceb69e8bca0eb07f0c6024f66ffe2aff4e2c887b4997628fa3f25cd",
  "ewc": "c10bac742a75e26aae942bc3fd694bcdcd898945dbd69036e684649f26f758cb",
  "lora": "ac1325698798bc10c953780437db49e0f0f46d64139cdee112a4305801e7b310",
  "autopilot": "afd3f941e28f28ef14b693c106ea4c808f8e0bb72e3b5b87c287ef9e346fe15a"
};
const cached = new Map();
const names = {
  'cwd/memory-root-delegate': 'memory',
  'cwd/cli-core-getProjectCwd': 'core',
  'state/memory-ewc-consolidation': 'ewc',
  'state/ruvector-lora-adapter': 'lora',
  'state/autopilot': 'autopilot',
};

function dependencies(name, file) {
  if (name === 'core') return {};
  const dir = path.dirname(file);
  const helper = path.join(dir, name === 'autopilot' ? 'services/project-root.js' : '../services/project-root.js');
  const result = { helper: fs.readFileSync(helper, 'utf8') };
  if (name === 'memory') result.memoryRoot = fs.readFileSync(path.join(dir, 'memory-root.js'), 'utf8');
  return result;
}

// These are executions of the published consumer expressions, not replacement
// implementations. Hash qualification above them covers every consumer callsite.
function consumerCode(name, source) {
  if (name === 'core') return 'function consume() { return [getProjectCwd()]; }';
  if (name === 'memory') return `let _memoryRootCache;
${nativeScript(nativeFunction(source, 'getMemoryRoot'))}
function consume() { _memoryRootCache = undefined; return [getMemoryRoot()]; }`;
  if (name === 'ewc') {
    const config = source.match(/const DEFAULT_EWC_CONFIG = \{[\s\S]*?\n\};/)[0];
    return `function consume() { ${config}; return [DEFAULT_EWC_CONFIG.storagePath]; }`;
  }
  if (name === 'lora') {
    const constants = source.match(/export const (?:DEFAULT_RANK|INPUT_DIM|OUTPUT_DIM|DEFAULT_ALPHA) = \d+;/g).join('\n');
    const config = source.match(/const DEFAULT_CONFIG = \{[\s\S]*?\n\};/)[0];
    return nativeScript(constants) + '\n' + nativeFunction(source, 'checkpointDirs')
      + `
function consume() { ${config}; return [DEFAULT_CONFIG.weightsPath, ...checkpointDirs()]; }`;
  }
  const constants = source.match(/export const (?:STATE_DIR|STATE_FILE|LOG_FILE) = .*;/g).join('\n');
  return nativeScript(constants) + '\n' + nativeFunction(source, 'statePath')
    + `
function consume() { return [STATE_DIR, STATE_FILE, LOG_FILE, '.claude-flow/swarm-tasks.json', '.claude-flow/data/checklist.json'].map(statePath); }`;
}

export function proveNativeRoot(name, source, deps) {
  const files = new Map();
  const marker = dir => files.set(path.join(dir, '.claude-flow/config.json'), '{}');
  let cwd = '/proof/project/pkg/src';
  const env = { HOME: '/proof/home' };
  const context = vm.createContext({
    fs: {
      existsSync: p => files.has(p),
      readFileSync: p => { if (!files.has(p)) throw new Error('absent'); return files.get(p); },
    },
    path, join: path.join, resolve: path.resolve,
    os: { homedir: () => '/proof/home' },
    process: { cwd: () => cwd, env, platform: 'linux' },
  });
  const helper = name === 'core' ? source : deps.helper;
  vm.runInContext(nativeScript(helper) + '\n' + nativeScript(deps.memoryRoot || '') + '\n' + consumerCode(name, source), context, { timeout: 1000 });
  const suffixes = {
    core: [''], memory: ['.swarm'], ewc: ['.swarm/ewc-fisher.json'],
    lora: ['.swarm/lora-weights.json', '.claude-flow/neural'],
    autopilot: ['.claude-flow/data', '.claude-flow/data/autopilot-state.json', '.claude-flow/data/autopilot-log.json', '.claude-flow/swarm-tasks.json', '.claude-flow/data/checklist.json'],
  };
  let checks = 0;
  const check = (expected, suffix = suffixes[name]) => {
    const actual = vm.runInContext('consume()', context, { timeout: 1000 });
    const wanted = suffix.map(s => path.join(expected, s));
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${name}: ${JSON.stringify(actual)} != ${JSON.stringify(wanted)}`);
    checks++;
  };
  marker('/proof/project'); check('/proof/project');
  marker('/proof/project/pkg'); check('/proof/project/pkg');
  files.clear(); marker('/proof'); files.set('/proof/project/.git', 'directory'); check(cwd);
  files.set('/proof/project/.git', 'gitdir: /elsewhere'); check(cwd);
  files.clear(); check(cwd);
  files.set('/proof/project/.ruflo-project', ''); check(cwd);
  files.set('/proof/project/.claude', 'directory'); files.set('/proof/project/CLAUDE.md', ''); check(cwd);
  files.clear(); files.set('/proof/project/.claude-flow', 'directory'); check(cwd);
  files.set('/proof/project/.claude/settings.json', '{bad'); check(cwd);
  files.set('/proof/project/.claude/settings.json', '{"claudeFlow":{}}'); check('/proof/project');
  for (const server of ['ruflo', 'claude-flow']) {
    files.clear(); files.set('/proof/project/.mcp.json', JSON.stringify({mcpServers:{[server]:{}}})); check('/proof/project');
  }
  for (const markerFile of ['.claude-flow/config.yaml', '.claude-flow/config.yml', 'claude-flow.config.json', '.swarm/memory.db']) {
    files.clear(); files.set(path.join('/proof/project',markerFile),'{}'); check('/proof/project');
  }
  files.clear(); cwd = '/proof/home/deep'; marker('/proof/home'); check(cwd);
  files.clear(); marker('/'); check(cwd);
  cwd = '/proof/home'; check(cwd);
  files.clear(); cwd = '/proof/project/pkg/src'; marker('/proof/project');
  if (name === 'core') {
    env.CLAUDE_FLOW_CWD = '/proof/explicit'; check('/proof/explicit');
    env.CLAUDE_FLOW_CWD = '/proof/home'; check('/proof/project');
    env.CLAUDE_FLOW_CWD = '/'; check('/proof/project');
  }
  if (name === 'memory') {
    env.CLAUDE_FLOW_MEMORY_PATH = 'owned-memory'; check('/proof/project', ['owned-memory']);
    delete env.CLAUDE_FLOW_MEMORY_PATH;
    marker('/proof/project'); files.set('/proof/project/.claude-flow/config.json', '{"memory":{"path":"custom"}}');
    check('/proof/project', ['custom']);
  }
  return checks;
}

export function nativeRootSatisfied(source, file, id) {
  try {
    const name = names[id];
    if (!name || !file) return false;
    const surface = name === 'memory' ? nativeFunction(source, 'getMemoryRoot') : source;
    if (nativeHash(surface) !== HASHES[name]) return false;
    if (name === 'memory' && (!source.includes("import { resolveMemoryRoot } from './memory-root.js';") || !source.includes('let _memoryRootCache;'))) return false;
    if (name !== 'core') {
      const from = name === 'autopilot' ? './services/project-root.js' : '../services/project-root.js';
      if (!source.includes(`import { getProjectRoot } from '${from}';`)) return false;
    }
    const deps = dependencies(name, file);
    for (const [key, value] of Object.entries(deps)) if (nativeHash(value) !== HASHES[key]) return false;
    const key = name + ':' + nativeHash(JSON.stringify(deps));
    if (!cached.has(key)) cached.set(key, proveNativeRoot(name, source, deps) >= 14);
    return cached.get(key);
  } catch { return false; }
}
