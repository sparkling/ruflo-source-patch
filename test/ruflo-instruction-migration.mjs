// Exact-block fleet migration for Ruflo #3153: preserve custom policy and runtime state.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  migrateRoots, migrateText, SHARED_SECTIONS, CLAUDE_SECTIONS,
} from '../lib/ruflo-instruction-contract/migrate.mjs';

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
check('RIM7 dry run reports both files and changes nothing', dry.changed.length === 2
  && fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8') === AGENTS);
const applied = migrateRoots([root], { apply: true, known: KNOWN });
const agentsAfter = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
const claudeAfter = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
check('RIM8 apply changes exactly the two root instruction files', applied.changed.length === 2);
check('RIM9 line endings and modes survive',
  claudeAfter.includes('\r\n')
    && claudeAfter.endsWith('\r\n')
    && (fs.statSync(path.join(root, 'AGENTS.md')).mode & 0o777) === 0o640
    && (fs.statSync(path.join(root, 'CLAUDE.md')).mode & 0o777) === 0o600);
check('RIM10 managed sections retain a blank separator before the next heading',
  agentsAfter.includes('a worker is appropriate.\n\n## Build & Test')
    && claudeAfter.includes('native host.\r\n\r\n## Project-only overlay'));
check('RIM11 second pass is idempotent', migrateRoots([root], { known: KNOWN }).changed.length === 0);
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
