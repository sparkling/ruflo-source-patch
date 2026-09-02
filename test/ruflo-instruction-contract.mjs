// Ruflo #3153: every generated host/template must honor one structured-interface contract.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PLATFORM_GENERATOR, SKILLS } from './fixtures/ruflo-instruction-vendor.mjs';

const SANDBOX = fs.realpathSync(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-instructions-')));
const HOME = path.join(SANDBOX, 'home');
const GLOBAL = path.join(SANDBOX, 'global');
const NPX = path.join(SANDBOX, 'npx');
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;
process.env.RUFLO_GLOBAL_ROOT = GLOBAL;
process.env.RUFLO_NPX_ROOT = NPX;
process.env.RSP_NO_LAUNCHCTL = '1';
process.env.RSP_NO_SELF_UPDATE = '1';

const fail = (message) => { console.error(`✘ ${message}`); process.exit(1); };
const check = (label, condition) => { if (!condition) fail(label); };

const policy = `## Ruflo Capability Brain & Implementation Loop

Use guidance_brain and CLI discovery.

## Agent Comms (SendMessage-First Coordination)

Native agents are coordinated automatically.`;
const swarm = `## Swarm & Routing

\`\`\`bash
npx @claude-flow/cli@latest swarm init --topology hierarchical
\`\`\`

### When to Swarm
- YES: 3+ files`;
const memory = `## Memory & Learning

npx @claude-flow/cli@latest memory search --query x

hooks_post-task hooks_worker-dispatch hive-mind_init`;
const quick = `## CLI Quick Reference

npx @claude-flow/cli@latest hooks route --task x`;
const setup = `## Setup

claude mcp add claude-flow -- npx -y ruflo@latest mcp start`;
const hooks = `## Hooks

npx @claude-flow/cli@latest hooks post-task --task-id x`;
const security = `## Security

npx @claude-flow/cli@latest security audit --report`;
const performance = `## Performance

npx @claude-flow/cli@latest performance profile --target x`;
const intelligence = `## Intelligence (SONA + HNSW)

150x faster and always enabled.`;
const federation = `## Federation

npx @claude-flow/cli@latest federation init

Compliance: HIPAA, SOC2, GDPR.`;
const agents = `## Agents

Any string proves a specialized agent.`;
const claudeBodies = {
  minimal: [policy, swarm, quick, setup].join('\n\n'),
  standard: [policy, swarm, memory, agents, quick, setup].join('\n\n'),
  full: [policy, swarm, memory, agents, hooks, intelligence, federation, quick, setup].join('\n\n'),
  security: [policy, swarm, security, memory, agents, quick, setup].join('\n\n'),
  performance: [policy, swarm, performance, memory, agents, intelligence, quick, setup].join('\n\n'),
  solo: [policy, memory, quick, setup].join('\n\n'),
};

const CLAUDE_VENDOR = `const bodies = ${JSON.stringify(claudeBodies)};
export function generateClaudeMd(options, template) {
    const header = '# Ruflo — Claude Code Configuration';
    const body = bodies[template || 'standard'];
    return \`${'${header}'}\\n${'${body}'}\\n\`;
}
// --- Template Composers ---
export const CLAUDE_MD_TEMPLATES = Object.keys(bodies);
`;
const legacyClaudeBodies = Object.fromEntries(Object.keys(claudeBodies)
  .map((template) => [template, `## Legacy ${template}\n\nHistorical template without the modern policy heading.`]));
const CLAUDE_STANDALONE_VENDOR = CLAUDE_VENDOR.replace(
  JSON.stringify(claudeBodies), JSON.stringify(legacyClaudeBodies),
);

const codexPolicy = `## Ruflo + Codex Automated Workflow

Use guidance_brain, CLI discovery, and repository instructions.`;
const coordination = `## Agent Coordination

Invoke a swarm for 3+ files.`;
const execution = `## Execution Model

Ruflo is ledger; Codex executes.`;
const integration = `## MCP Integration

task_orchestrate agent_spawn({type: "coder", name: "dev"}) benchmark_run neural_train({iterations: 10})`;
const codexMemory = `## Memory System

npx @claude-flow/cli memory search --query x`;
const commands = `## Quick Commands

npx @claude-flow/cli hooks route --task x`;
const perf = `## Performance Targets

MCP Response <100ms.`;
const hookSystem = `## Hooks System

npx @claude-flow/cli hooks pre-task --description x`;
const workers = `## Background Workers

npx @claude-flow/cli hooks worker dispatch --trigger audit`;
const intel = `## Intelligence System

SONA is always <0.05ms.`;
const debugging = `## Debugging

npx @claude-flow/cli status`;
const governance = `## Governance

All actions are immutable and SOC2 compliant.`;
const sla = `## Service Level Agreements (SLAs)

99.99% availability.`;
const incident = `## Incident Response

npx @claude-flow/cli agent stop --all --force`;
const recovery = `## Disaster Recovery

npx @claude-flow/cli memory restore --snapshot latest`;
const monitoring = `## Monitoring & Alerting

Alerts are active.`;
const codexBodies = {
  minimal: codexPolicy,
  default: [coordination, execution, codexPolicy, integration, codexMemory, commands].join('\n\n'),
  full: [coordination, execution, codexPolicy, integration, codexMemory, commands, perf, integration, hookSystem, workers, intel, debugging].join('\n\n'),
  enterprise: [coordination, execution, codexPolicy, integration, codexMemory, commands, perf, hookSystem, workers, intel, debugging, governance, sla, incident, recovery, monitoring].join('\n\n'),
};

const CODEX_VENDOR = `const bodies = ${JSON.stringify(codexBodies)};
/**
 * Generate an AGENTS.md file based on the provided options
 */
export async function generateAgentsMd(options) {
    const template = options.template ?? 'default';
    switch (template) {
        case 'minimal':
            return generateMinimal(options);
        case 'full':
            return generateFull(options);
        case 'enterprise':
            return generateEnterprise(options);
        case 'default':
        default:
            return generateDefault(options);
    }
}
function generateMinimal() { return bodies.minimal; }
function generateDefault() { return bodies.default; }
function generateFull() { return bodies.full; }
function generateEnterprise() { return bodies.enterprise; }
`;

function writePackage(root, name) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name, version: '0.0.0-test', type: 'module' })}\n`);
}
function writeCodexPackage(root, { crlf = false } = {}) {
  writePackage(root, '@claude-flow/codex');
  const generator = path.join(root, 'dist', 'generators', 'agents-md.js');
  fs.mkdirSync(path.dirname(generator), { recursive: true });
  fs.writeFileSync(generator, CODEX_VENDOR);
  for (const [name, source] of Object.entries(SKILLS)) {
    const file = path.join(root, '.agents', 'skills', name, 'SKILL.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, crlf ? source.replaceAll('\n', '\r\n') : source);
  }
  return generator;
}
const rufloRoot = path.join(GLOBAL, 'ruflo');
const cliRoot = path.join(rufloRoot, 'node_modules', '@claude-flow', 'cli');
const codexRoot = path.join(cliRoot, 'node_modules', '@claude-flow', 'codex');
writePackage(rufloRoot, 'ruflo');
writePackage(cliRoot, '@claude-flow/cli');
const claudeFile = path.join(cliRoot, 'dist', 'src', 'init', 'claudemd-generator.js');
const codexFile = writeCodexPackage(codexRoot);
fs.mkdirSync(path.dirname(claudeFile), { recursive: true });
fs.writeFileSync(claudeFile, CLAUDE_VENDOR);
const platformFile = path.join(cliRoot, 'dist', 'src', 'commands', 'init.js');
fs.mkdirSync(path.dirname(platformFile), { recursive: true });
fs.writeFileSync(platformFile, PLATFORM_GENERATOR);
const registryFile = path.join(cliRoot, 'dist', 'src', 'mcp-tools', 'contract-tools.js');
fs.mkdirSync(path.dirname(registryFile), { recursive: true });
const registryNames = [
  'guidance_brain', 'guidance_recommend', 'swarm_init', 'memory_search',
  'memory_search_unified', 'memory_store', 'hooks_route', 'hooks-pre-task',
  'hooks-post-task', 'hooks-worker-dispatch', 'performance_profile', 'workflow_run',
  'session_restore', 'claims_list', 'system_status',
];
fs.writeFileSync(registryFile, `export const tools = [
  ${registryNames.map((name) => `{ name: ${JSON.stringify(name)} }`).join(',\n  ')},
  { name: 'agent_spawn', inputSchema: { required: ['agentType'] } },
  { name: 'performance_benchmark', inputSchema: { properties: { suite: { enum: ['all'] } } } },
];\n`);

// A plain @claude-flow/cli npx cache has no obligation to carry the separate
// @claude-flow/codex adapter. It must still receive and prove its Claude surface.
const standaloneCliRoot = path.join(NPX, 'standalone', 'node_modules', '@claude-flow', 'cli');
writePackage(standaloneCliRoot, '@claude-flow/cli');
const standaloneClaudeFile = path.join(standaloneCliRoot, 'dist', 'src', 'init', 'claudemd-generator.js');
fs.mkdirSync(path.dirname(standaloneClaudeFile), { recursive: true });
fs.writeFileSync(standaloneClaudeFile, CLAUDE_STANDALONE_VENDOR);
const standaloneRegistryFile = path.join(standaloneCliRoot, 'dist', 'src', 'mcp-tools', 'contract-tools.js');
fs.mkdirSync(path.dirname(standaloneRegistryFile), { recursive: true });
fs.copyFileSync(registryFile, standaloneRegistryFile);

// A direct @claude-flow/codex npx package is an independent installer source;
// it must not disappear merely because it is not nested below a CLI package.
const directCodexRoot = path.join(NPX, 'codex-only', 'node_modules', '@claude-flow', 'codex');
const directCodexFile = writeCodexPackage(directCodexRoot, { crlf: true });

const sentinelDir = path.join(HOME, 'project', '.swarm');
fs.mkdirSync(sentinelDir, { recursive: true });
const sentinels = ['memory.db', 'memory.db-wal', 'memory.db-shm'].map((name) => path.join(sentinelDir, name));
for (const file of sentinels) fs.writeFileSync(file, `sentinel:${path.basename(file)}\n`);
const sentinelState = sentinels.map((file) => [file, fs.statSync(file).mtimeMs, fs.readFileSync(file, 'utf8')]);

const patcher = await import('../lib/ruflo-instruction-contract/patcher.mjs');
const { applyComposed, composeSource, reconcile, statusComposed } = await import('../lib/plugin-compose.mjs');
const discovered = patcher.discover().sort();
const vendorBytes = new Map(discovered.map((file) => [file, fs.readFileSync(file, 'utf8')]));
check('RIC1 bounded discovery finds generators, platform skill, packaged skills, and direct Codex',
  discovered.length === 15 && discovered.includes(claudeFile) && discovered.includes(codexFile)
    && discovered.includes(platformFile) && discovered.includes(standaloneClaudeFile)
    && discovered.includes(directCodexFile));
check('RIC2 bundle preflight proves every surface present without inventing a Codex requirement',
  patcher.preflight().ok);

for (const [label, source, edits] of [['Claude', CLAUDE_VENDOR, 2], ['Codex', CODEX_VENDOR, 5]]) {
  const result = patcher.patchSource(source);
  check(`RIC3 ${label} pure transform applies every exact anchor`, result.applied.length === edits && result.missing.length === 0);
  check(`RIC4 ${label} pure transform is complete and idempotent`,
    patcher.isPatched(result.next) && patcher.patchSource(result.next).next === result.next);
  check(`RIC5 ${label} transform has a byte-exact inverse`, patcher.reverseSource(result.next) === source);
}
for (const [name, source] of Object.entries(SKILLS)) {
  const result = patcher.patchSource(source);
  check(`RIC5a ${name} skill gets one exact MCP-first replacement`, result.applied.length === 1 && !result.missing.length);
  check(`RIC5b ${name} skill is idempotent and reversible`,
    patcher.isPatched(result.next) && patcher.patchSource(result.next).next === result.next
      && patcher.reverseSource(result.next) === source);
}
const platformResult = patcher.patchSource(PLATFORM_GENERATOR);
check('RIC5c platform skill generator replaces all three contradictory anchors',
  platformResult.applied.length === 3 && !platformResult.missing.length && patcher.isPatched(platformResult.next));
check('RIC5d platform skill generator has a byte-exact inverse',
  patcher.reverseSource(platformResult.next) === PLATFORM_GENERATOR);

const drifted = CODEX_VENDOR.replace('            return generateFull(options);', '            return generateFull(options, true);');
const drift = patcher.patchSource(drifted);
check('RIC6 one missing Codex return anchor is loud and atomic',
  drift.missing.includes('codex-render-2') && composeSource(drifted, ['ruflo-instruction-contract']) === drifted);
const duplicate = CLAUDE_VENDOR + '\n// --- Template Composers ---\n';
check('RIC7 duplicate anchors are ambiguous and refused',
  patcher.patchSource(duplicate).missing.some((item) => item.includes('AMBIGUOUS')));

const applied = applyComposed(['ruflo-instruction-contract']);
check(`RIC8 present generator surfaces apply atomically: ${applied.log.join(' | ')}`,
  !applied.errors && !applied.incomplete && applied.patched === 15);
const state = statusComposed()['ruflo-instruction-contract'];
check('RIC9 status proves every present surface', state.files === 15 && state.patched === 15);
check('RIC10 pristine backups contain exact vendor bytes',
  [...vendorBytes].every(([file, source]) => fs.readFileSync(`${file}.rsp-backup`, 'utf8') === source));

const currentClaudePatch = fs.readFileSync(claudeFile, 'utf8');
fs.writeFileSync(claudeFile, `// ${patcher.PATCH_MARKER}\n// exact prior installed patch revision\n`);
const revisionUpgrade = applyComposed(['ruflo-instruction-contract']);
check(`RIC10a a prior named patch revision upgrades from its proven pristine: ${revisionUpgrade.log.join(' | ')}`,
  !revisionUpgrade.errors && !revisionUpgrade.incomplete
    && fs.readFileSync(claudeFile, 'utf8') === currentClaudePatch);
const { patchPreviousPlatformGenerator } = await import('../lib/ruflo-instruction-contract/skill-contract.mjs');
const currentPlatformPatch = fs.readFileSync(platformFile, 'utf8');
const previousPlatformPatch = patchPreviousPlatformGenerator(vendorBytes.get(platformFile)).next;
fs.writeFileSync(platformFile, previousPlatformPatch);
fs.writeFileSync(`${platformFile}.rsp-backup`, '');
const poisonedRevisionUpgrade = applyComposed(['ruflo-instruction-contract']);
check(`RIC10b an exact v1 platform patch recovers a poisoned pristine before v2: ${poisonedRevisionUpgrade.log.join(' | ')}`,
  !poisonedRevisionUpgrade.errors && !poisonedRevisionUpgrade.incomplete
    && fs.readFileSync(platformFile, 'utf8') === currentPlatformPatch
    && fs.readFileSync(`${platformFile}.rsp-backup`, 'utf8') === vendorBytes.get(platformFile));

const claudeApi = await import(`${pathToFileURL(claudeFile).href}?patched`);
for (const template of Object.keys(claudeBodies)) {
  const output = claudeApi.generateClaudeMd({}, template);
  check(`RIC11 Claude ${template} emits the structured contract`, output.includes('## Ruflo Interface Contract'));
  check(`RIC11a Claude ${template} selects the installed Ruflo executable for managed CLI gaps`,
    output.includes('ruvnet_cli_help({executable: "ruflo", argv:')
      && output.includes('ruvnet_cli_run({executable: "ruflo", argv:')
      && !output.includes('executable: "claude-flow"'));
  check(`RIC12 Claude ${template} keeps valid bootstrap`, output.includes('npx ruflo@latest doctor --fix'));
}
const standaloneClaudeApi = await import(`${pathToFileURL(standaloneClaudeFile).href}?patched`);
for (const template of Object.keys(legacyClaudeBodies)) {
  const output = standaloneClaudeApi.generateClaudeMd({}, template);
  check(`RIC12a standalone Claude ${template} receives a contract without a policy heading`,
    output.includes('## Ruflo Interface Contract') && output.includes(`## Legacy ${template}`));
}
const codexApi = await import(`${pathToFileURL(codexFile).href}?patched`);
for (const template of Object.keys(codexBodies)) {
  const output = await codexApi.generateAgentsMd({ template });
  check(`RIC13 Codex ${template} emits the structured contract`, output.includes('## Ruflo Interface Contract'));
  check(`RIC13a Codex ${template} selects the installed Ruflo executable for managed CLI gaps`,
    output.includes('ruvnet_cli_help({executable: "ruflo", argv:')
      && output.includes('ruvnet_cli_run({executable: "ruflo", argv:')
      && !output.includes('executable: "claude-flow"'));
  check(`RIC14 Codex ${template} has no stale task_orchestrate`, !output.includes('task_orchestrate'));
}
const enterprise = await codexApi.generateAgentsMd({ template: 'enterprise' });
check('RIC15 enterprise policy is labelled as unimplemented scaffolding',
  enterprise.includes('Governance Scaffold (Not an Implemented Control)')
    && enterprise.includes('Service Levels (Unconfigured)'));
const full = await codexApi.generateAgentsMd({ template: 'full' });
check('RIC16 duplicate upstream MCP sections collapse to one contract section',
  full.split('## MCP Integration').length - 1 === 1);
check('RIC17 output mutation guard can fail', (() => {
  try { patcher.transformGeneratedInstructions(`${policy}\n\n## Custom\n\nnpx @claude-flow/cli hooks route --task x\n`, 'claude'); }
  catch (error) { return error.message.includes('raw MCP-capable CLI remains'); }
  return false;
})());

for (const [file, mtime, bytes] of sentinelState) {
  check(`RIC18 patch never touches ${path.basename(file)}`,
    fs.readFileSync(file, 'utf8') === bytes && fs.statSync(file).mtimeMs === mtime);
}

const restored = reconcile([], ['ruflo-instruction-contract']);
check('RIC19 uninstall restores every instruction source byte-for-byte',
  restored.restored === 15 && !restored.errors
    && [...vendorBytes].every(([file, source]) => fs.readFileSync(file, 'utf8') === source));

fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}\n');
const runCli = (...args) => spawnSync(process.execPath, [path.resolve('bin/cli.mjs'), ...args], {
  env: process.env, encoding: 'utf8',
});
const installed = runCli('ruflo-instruction-contract', 'install');
check(`RIC20 public CLI installs and tracks the target: ${installed.stdout} ${installed.stderr}`,
  installed.status === 0 && installed.stdout.includes('re-applied on session start and by the monitor'));
const cliStatus = runCli('ruflo-instruction-contract', 'status');
check('RIC21 public CLI reports both files patched and tracked',
  cliStatus.status === 0 && cliStatus.stdout.includes('15/15 file(s) patched') && cliStatus.stdout.includes('tracked'));
const removed = runCli('ruflo-instruction-contract', 'uninstall');
check('RIC22 public CLI restores every present surface', removed.status === 0 && removed.stdout.includes('restored 15 file(s)'));

const nativeBytes = new Map();
for (const [file, source] of vendorBytes) {
  const native = patcher.patchSource(source).next.replaceAll(patcher.PATCH_MARKER, 'ruflo native');
  nativeBytes.set(file, native);
  fs.writeFileSync(file, native);
}
const nativeClaude = nativeBytes.get(claudeFile);
const nativeCodex = nativeBytes.get(codexFile);
const supersede = await import('../lib/ruflo-instruction-contract/supersede.mjs');
const nativeVerdict = supersede.rufloInstructionContractSupersession.check();
check(`RIC23 marker-free native equivalent passes all-template retirement: ${nativeVerdict.evidence}`,
  nativeVerdict.state === 'superseded');

fs.writeFileSync(claudeFile, nativeClaude.replaceAll('search_ruvnet', 'source_search'));
const regressed = supersede.rufloInstructionContractSupersession.check();
check('RIC24 one host-template authority regression prevents retirement', regressed.state === 'live');
fs.writeFileSync(claudeFile, nativeClaude);
const directMemory = path.join(directCodexRoot, '.agents', 'skills', 'memory-management', 'SKILL.md');
fs.writeFileSync(directMemory, nativeBytes.get(directMemory).replaceAll('memory_search_unified', 'memory_lookup'));
const skillRegressed = supersede.rufloInstructionContractSupersession.check();
check('RIC24a one higher-priority skill regression prevents retirement', skillRegressed.state === 'live');
fs.writeFileSync(directMemory, nativeBytes.get(directMemory));

const { writeState, readState } = await import('../lib/cwd/state.mjs');
const { retireSuperseded } = await import('../lib/supersede.mjs');
writeState({ patchTargets: [], pluginTargets: ['ruflo-instruction-contract'], retired: {}, all: false });
const retirement = retireSuperseded(readState());
const retiredState = readState();
check('RIC25 executable native proof retires terminally without overwriting upstream bytes',
  retirement.retired === 1
    && !retiredState.pluginTargets.includes('ruflo-instruction-contract')
    && retiredState.retired['ruflo-instruction-contract']?.issue
      === 'https://github.com/ruvnet/ruflo/issues/3153'
    && fs.readFileSync(claudeFile, 'utf8') === nativeClaude
    && fs.readFileSync(codexFile, 'utf8') === nativeCodex
    && [...nativeBytes].every(([file, source]) => fs.readFileSync(file, 'utf8') === source));

console.log('✔ Ruflo instruction contract (#3153 all templates, exact anchors, native retirement, exact restore)');
