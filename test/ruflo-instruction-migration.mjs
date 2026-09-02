// Exact-block fleet migration for Ruflo #3153: preserve custom policy and runtime state.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  migrateInterfaceRevisionRoots, migrateInterfaceRevisionText, migrateRoots, migrateSkillRoots,
  migrateSkillText, migrateText, SHARED_SECTIONS, CLAUDE_SECTIONS,
} from '../lib/ruflo-instruction-contract/migrate.mjs';
import { PLATFORM_MARKDOWN, SKILLS } from './fixtures/ruflo-instruction-vendor.mjs';

const SANDBOX = fs.realpathSync(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-instruction-migrate-')));
let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) return;
  failures++;
  console.error(`✘ ${label}${detail ? `\n  ${detail}` : ''}`);
};
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

const OLD = {
  'Swarm & Coordination': `## Swarm & Coordination

legacy tracked swarm guidance`,
  'MCP Integration': `## MCP Integration

legacy MCP guidance`,
  'Memory & Learning': `## Memory & Learning

legacy npx memory guidance`,
  'Agent comms': `## Agent comms

After spawning: STOP, tell the user and wait`,
  Setup: `## Setup

claude mcp add claude-flow -- npx -y ruflo@latest mcp start`,
};
const KNOWN = Object.fromEntries(Object.entries(OLD).map(([title, text]) => [title, new Set([digest(text)])]));
const AGENTS = `# fixture

## Project policy

CUSTOM-AGENTS-BEFORE

${OLD['Swarm & Coordination']}

${OLD['MCP Integration']}

${OLD['Memory & Learning']}

## Build & Test

CUSTOM-AGENTS-AFTER
`;
const CLAUDE = `@AGENTS.md

# Claude overlay

${OLD['Agent comms']}

## Project-only overlay

CUSTOM-CLAUDE-MIDDLE

${OLD.Setup}
`;

const pureAgents = migrateText(AGENTS, 'agents', { known: KNOWN });
check('RIM1 known generated blocks migrate', pureAgents.changed && !pureAgents.error, pureAgents.error);
check('RIM2 custom AGENTS bytes survive',
  pureAgents.next.includes('CUSTOM-AGENTS-BEFORE') && pureAgents.next.includes('CUSTOM-AGENTS-AFTER'));
check('RIM3 shared contract and marker are installed',
  pureAgents.next.includes(SHARED_SECTIONS['Ruflo Interface Contract'])
    && pureAgents.next.includes('**ruflo-managed:memory:v2**'));
check('RIM4 routine raw npx and stale hyphenated tools disappear',
  !pureAgents.next.includes('npx @claude-flow/cli')
    && !pureAgents.next.includes('hooks_post-task'));
check('RIM4a managed CLI gaps select ruflo rather than guessing the legacy package name',
  pureAgents.next.includes('ruvnet_cli_help({executable: "ruflo", argv:')
    && pureAgents.next.includes('ruvnet_cli_run({executable: "ruflo", argv:')
    && !pureAgents.next.includes('executable: "claude-flow"'));
const CONTRACT_V1 = `**ruflo-interface-contract:v1**

## Ruflo Interface Contract

- Use \`search_ruvnet\` for RuvNet source and capability claims when the Brain is installed; cite its source.
- Use \`guidance_brain\` / \`guidance_recommend\` and the live MCP registry for this process's actual registered, configured, reachable, healthy, and authorized state.
- Prefer a live structured Ruflo MCP tool for coordination, memory, routing, learning, and status. Discover deferred tools and schemas; never guess names or arguments.
- For a genuine CLI-only gap, use \`ruvnet_cli_help\`, then \`ruvnet_cli_run\` with literal \`argv\` when that bridge is registered. Exact requested help must authorize the run; parent help or exit code alone is insufficient.
- Direct shell is for bootstrap and administration that cannot depend on MCP: install/init, first MCP registration/start, diagnostics, and deliberate daemon work.
- Native Claude/Codex agents execute. Ruflo tracks a swarm only after \`swarm_init\` and \`agent_spawn\` create records; a native agent alone is not proof.
- Before generic testing or security agents, discover specialized installed QE or adversarial-security capabilities and disclose any fallback.`;
const priorRoot = pureAgents.next.replace(SHARED_SECTIONS['Ruflo Interface Contract'], CONTRACT_V1);
const upgradedRoot = migrateText(priorRoot, 'agents');
check('RIM4b the exact installed v1 contract upgrades without replacing custom policy',
  upgradedRoot.changed && !upgradedRoot.error
    && upgradedRoot.next.includes('**ruflo-interface-contract:v2**')
    && upgradedRoot.next.includes('executable: "ruflo"')
    && upgradedRoot.next.includes('CUSTOM-AGENTS-BEFORE'));
const customV1 = priorRoot.replace(
  '\n**ruflo-managed:swarm:v2**',
  '\nCustom project qualification rules remain authoritative.\n\n**ruflo-managed:swarm:v2**',
);
const customRevision = migrateInterfaceRevisionText(customV1);
check('RIM4c a custom contract section upgrades only the exact v1 marker and CLI sentence',
  customRevision.changed && !customRevision.error
    && customRevision.next.includes('Custom project qualification rules remain authoritative.')
    && customRevision.next.includes('**ruflo-interface-contract:v2**')
    && customRevision.next.includes('executable: "ruflo"'));
check('RIM4d mixed or edited interface revisions are refused',
  Boolean(migrateInterfaceRevisionText(customV1.replace('genuine CLI-only gap', 'custom CLI gap')).error));

const pureClaude = migrateText(CLAUDE, 'claude', { known: KNOWN });
check('RIM5 Claude overlay keeps project-only content and continues after spawning',
  pureClaude.changed
    && pureClaude.next.includes('CUSTOM-CLAUDE-MIDDLE')
    && pureClaude.next.includes('continue independent work')
    && !pureClaude.next.includes('After spawning: STOP'));
check('RIM6 plugin-native setup removes duplicate standalone registration',
  pureClaude.next.includes(CLAUDE_SECTIONS.Setup)
    && !pureClaude.next.includes('claude mcp add claude-flow'));

function makeRoot(name, { agents = AGENTS, claude = CLAUDE, crlf = false } = {}) {
  const root = path.join(SANDBOX, name);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), agents);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), crlf ? claude.replaceAll('\n', '\r\n') : claude);
  for (const [skillName, source] of [...Object.entries(SKILLS), ['ruflo', PLATFORM_MARKDOWN]]) {
    const file = path.join(root, '.agents', 'skills', skillName, 'SKILL.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, crlf ? source.replaceAll('\n', '\r\n') : source);
  }
  fs.chmodSync(path.join(root, 'AGENTS.md'), 0o640);
  fs.chmodSync(path.join(root, 'CLAUDE.md'), 0o600);
  return root;
}

const root = makeRoot('valid', { crlf: true });
const stateDir = path.join(root, '.swarm');
fs.mkdirSync(stateDir);
const stateFiles = ['memory.db', 'memory.db-wal', 'memory.db-shm'].map((name) => path.join(stateDir, name));
for (const file of stateFiles) fs.writeFileSync(file, `sentinel:${path.basename(file)}\n`);
const state = stateFiles.map((file) => [file, fs.readFileSync(file), fs.statSync(file).mtimeMs]);

const dry = migrateRoots([root], { known: KNOWN });
check('RIM7 dry run reports root and skill files and changes nothing', dry.changed.length === 8
  && fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8') === AGENTS);
const applied = migrateRoots([root], { apply: true, known: KNOWN });
const agentsAfter = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
const claudeAfter = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
check('RIM8 apply changes exactly the two root and six skill instruction files', applied.changed.length === 8);
check('RIM9 line endings and modes survive',
  claudeAfter.includes('\r\n')
    && claudeAfter.endsWith('\r\n')
    && (fs.statSync(path.join(root, 'AGENTS.md')).mode & 0o777) === 0o640
    && (fs.statSync(path.join(root, 'CLAUDE.md')).mode & 0o777) === 0o600);
check('RIM10 managed sections retain a blank separator before the next heading',
  agentsAfter.includes('a worker is appropriate.\n\n## Build & Test')
    && claudeAfter.includes('native host.\r\n\r\n## Project-only overlay'));
check('RIM11 second pass is idempotent', migrateRoots([root], { known: KNOWN }).changed.length === 0);
const memorySkill = fs.readFileSync(path.join(root, '.agents', 'skills', 'memory-management', 'SKILL.md'), 'utf8');
const platformSkill = fs.readFileSync(path.join(root, '.agents', 'skills', 'ruflo', 'SKILL.md'), 'utf8');
check('RIM11a task and platform skills are MCP-first with CRLF preserved',
  memorySkill.includes('memory_search_unified') && !memorySkill.includes('npx @claude-flow/cli')
    && platformSkill.includes('Runtime interface (MCP first)') && !platformSkill.includes('mcp__claude-flow__')
    && memorySkill.includes('\r\n') && platformSkill.includes('\r\n'));
const securitySkill = fs.readFileSync(path.join(root, '.agents', 'skills', 'security-audit', 'SKILL.md'), 'utf8');
const securityV1 = securitySkill.replace(
  '`ruvnet_cli_help({executable: "ruflo", argv: ["<group>", "<command>"]})`,\r\n'
    + 'then use `ruvnet_cli_run({executable: "ruflo", argv: [...]})` only with the\r\n'
    + 'authorized literal arguments. Otherwise inspect the installed `ruflo`\r\n'
    + "executable's help; never guess flags or claim a scan ran.",
  '`ruvnet_cli_help`, then use `ruvnet_cli_run` with literal argv. Otherwise\r\n'
    + "inspect the installed executable's help; never guess flags or claim a scan ran.",
);
const upgradedSecurity = migrateSkillText(securityV1, 'security-audit');
const platformV1 = platformSkill.replace(
  'For a genuine Ruflo CLI-only gap, use\r\n'
    + '`ruvnet_cli_help({executable: "ruflo", argv: ["<group>", "<command>"]})`,\r\n'
    + 'then `ruvnet_cli_run({executable: "ruflo", argv: [...]})` only with the exact\r\n'
    + 'literal arguments that help authorized. Native Claude/Codex agents perform\r\n'
    + 'execution; Ruflo records do not launch them automatically.',
  'For a genuine CLI-only gap, use `ruvnet_cli_help` and then `ruvnet_cli_run`\r\n'
    + 'with literal argv when that managed bridge is registered. Native Claude/Codex agents\r\n'
    + 'perform execution; Ruflo records do not launch them automatically.',
);
const upgradedPlatform = migrateSkillText(platformV1, 'ruflo');
check('RIM11b exact v1 security and platform skills upgrade to executable-specific v2',
  securityV1 !== securitySkill && platformV1 !== platformSkill
    && upgradedSecurity.changed && !upgradedSecurity.error
    && upgradedPlatform.changed && !upgradedPlatform.error
    && upgradedSecurity.next.includes('executable: "ruflo"')
    && upgradedPlatform.next.includes('executable: "ruflo"'));
for (const [file, bytes, mtime] of state) {
  check(`RIM12 runtime state untouched: ${path.basename(file)}`,
    fs.readFileSync(file).equals(bytes) && fs.statSync(file).mtimeMs === mtime);
}

const validBeforeError = makeRoot('valid-before-error');
const unknown = makeRoot('unknown', { agents: AGENTS.replace('legacy MCP guidance', 'user-edited unknown guidance') });
let preflightError = '';
try { migrateRoots([validBeforeError, unknown], { apply: true, known: KNOWN }); }
catch (error) { preflightError = error.message; }
check('RIM13 one unknown block refuses the fleet before the first write',
  preflightError.includes('edited or unknown')
    && fs.readFileSync(path.join(validBeforeError, 'AGENTS.md'), 'utf8') === AGENTS);

const unsupportedSkill = SKILLS['memory-management'].replace('npx @claude-flow/cli memory search', 'custom-memory-driver search');
const unsupported = migrateSkillText(unsupportedSkill, 'memory-management');
check('RIM13a edited built-in skill is refused rather than overwritten', Boolean(unsupported.error));
const legacyMemory = SKILLS['memory-management']
  .replace('### Store Data\nStore a pattern in memory', '### Legacy Store\nVendor revision with the old command block')
  .replace('### Search Data\nSemantic search in memory', '### Legacy Search\nVendor revision with the old search block')
  .replace('## Best Practices', `## Scripts

| Script | Path | Description |
|--------|------|-------------|
| \`memory-backup\` | \`.agents/scripts/memory-backup.sh\` | Backup memory to external storage |
| \`memory-consolidate\` | \`.agents/scripts/memory-consolidate.sh\` | Consolidate and optimize memory |

## Best Practices`);
const legacy = { 'memory-management': new Set([digest(legacyMemory)]) };
const migratedLegacy = migrateSkillText(legacyMemory, 'memory-management', { legacy });
check('RIM13b an allowlisted legacy skill migrates only its Commands section',
  migratedLegacy.changed
    && !migratedLegacy.error
    && migratedLegacy.next.includes('## Structured Interface')
    && migratedLegacy.next.includes('## Best Practices\n1. fixture')
    && !migratedLegacy.next.includes('memory-backup.sh')
    && !migratedLegacy.next.includes('npx @claude-flow/cli'));
const customRoot = makeRoot('custom-root', { agents: '# fully custom\n', claude: '@AGENTS.md\n\n# custom\n' });
const skillOnly = migrateSkillRoots([customRoot], { apply: true });
check('RIM13c skill-only migration preserves custom root instructions',
  skillOnly.changed.length === 6
    && fs.readFileSync(path.join(customRoot, 'AGENTS.md'), 'utf8') === '# fully custom\n'
    && fs.readFileSync(path.join(customRoot, 'CLAUDE.md'), 'utf8') === '@AGENTS.md\n\n# custom\n');
const customRevisionRoot = makeRoot('custom-revision', { agents: customV1 });
const revisionRootResult = migrateInterfaceRevisionRoots([customRevisionRoot], { apply: true });
check('RIM13d custom-root revision mode changes only AGENTS through the atomic writer',
  revisionRootResult.changed.length === 1
    && fs.readFileSync(path.join(customRevisionRoot, 'AGENTS.md'), 'utf8') === customRevision.next
    && fs.readFileSync(path.join(customRevisionRoot, 'CLAUDE.md'), 'utf8') === CLAUDE);

const noImport = migrateText(CLAUDE.replace('@AGENTS.md', '# no import'), 'claude', { known: KNOWN });
check('RIM14 missing canonical import refuses Claude migration', Boolean(noImport.error));
const symlinkRoot = makeRoot('symlink');
fs.unlinkSync(path.join(symlinkRoot, 'CLAUDE.md'));
fs.symlinkSync(path.join(root, 'CLAUDE.md'), path.join(symlinkRoot, 'CLAUDE.md'));
let symlinkError = '';
try { migrateRoots([symlinkRoot], { known: KNOWN }); } catch (error) { symlinkError = error.message; }
check('RIM15 symlinked instruction files are refused', symlinkError.includes('non-symlink'));

const source = fs.readFileSync(new URL('../lib/ruflo-instruction-contract/migrate.mjs', import.meta.url), 'utf8');
check('RIM16 migrator has no process or Ruflo/Brain runtime dependency',
  !source.includes('node:child_process') && !/\b(?:spawn|exec)(?:Sync)?\b/.test(source));

if (failures) process.exit(1);
console.log('✔ Ruflo instruction migration (#3153 exact blocks, custom-byte preservation, no runtime state)');
