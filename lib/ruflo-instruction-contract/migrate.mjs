// Exact-block migration for dual-host project instructions after Ruflo #3153.
// It never invokes Ruflo/Brain/npm or reads runtime state.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SKILL_NAMES,
  patchBuiltInSkill,
  patchPlatformSkill,
  skillContractViolations,
  skillNameForSource,
  skillReplacement,
} from './skill-contract.mjs';

export const SHARED_SECTIONS = {
  'Ruflo Interface Contract': `**ruflo-interface-contract:v1**

## Ruflo Interface Contract

- Use \`search_ruvnet\` for RuvNet source and capability claims when the Brain is installed; cite its source.
- Use \`guidance_brain\` / \`guidance_recommend\` and the live MCP registry for this process's actual registered, configured, reachable, healthy, and authorized state.
- Prefer a live structured Ruflo MCP tool for coordination, memory, routing, learning, and status. Discover deferred tools and schemas; never guess names or arguments.
- For a genuine CLI-only gap, use \`ruvnet_cli_help\`, then \`ruvnet_cli_run\` with literal \`argv\` when that bridge is registered. Exact requested help must authorize the run; parent help or exit code alone is insufficient.
- Direct shell is for bootstrap and administration that cannot depend on MCP: install/init, first MCP registration/start, diagnostics, and deliberate daemon work.
- Native Claude/Codex agents execute. Ruflo tracks a swarm only after \`swarm_init\` and \`agent_spawn\` create records; a native agent alone is not proof.
- Before generic testing or security agents, discover specialized installed QE or adversarial-security capabilities and disclose any fallback.`,
  'Swarm & Coordination': `**ruflo-managed:swarm:v2**

## Swarm & Coordination

Use the smallest capable structure derived from dependency edges, shared-state risk, and required evidence instead of a file count.

- Independent one-shot native agents need no Ruflo swarm.
- For persistent topology, shared memory, or tracked handoffs, discover the live schemas, call \`swarm_init\`, then register each worker with \`agent_spawn({agentType: "...", agentId: "..."})\`.
- A tracked record does not launch a native Claude/Codex agent; launch the matching executor separately.
- Give every writer an isolated worktree and non-overlapping ownership; name one integration owner.
- Read-only research may run concurrently. Continue independent work after spawning and wait only on a real dependency.
- Role strings such as \`researcher\`, \`architect\`, \`coder\`, and \`reviewer\` are labels, not proof of a specialized runtime.`,
  'MCP Integration': `**ruflo-managed:mcp:v2**

## MCP Integration

Use structured MCP tools for normal runtime work, then continue implementation. Coordination calls return immediately. Host-level registration is not proof of a tracked worker or a generated MetaHarness verifier.

| Need | Live structured tools |
|------|-----------------------|
| Guidance | \`guidance_brain\`, \`guidance_recommend\` |
| Swarm | \`swarm_init\`, \`swarm_status\`, \`swarm_health\` |
| Agents | \`agent_spawn\`, \`agent_list\`, \`agent_status\` |
| Memory | \`memory_store\`, \`memory_search\`, \`memory_search_unified\` |
| Hooks | \`hooks_route\`, \`hooks_pre_task\`, \`hooks_post_task\`, \`hooks_worker_dispatch\` |
| Status/performance | \`system_status\`, \`performance_benchmark\`, \`performance_profile\` |

Use AIDefence or other plugin tools only when the live registry reports them configured and reachable. Do not invent Hive-Mind, federation, workflow, claims, or session interfaces; discover the exact installed tool first.`,
  'Memory & Learning': `**ruflo-managed:memory:v2**

## Memory & Learning

Memory is optional context, not a delivery gate. Use native Ruflo MCP/AgentDB tools for store, search, retrieve, recall, list, delete, statistics, diagnosis, and verification.

- Never open managed memory through direct SQL, \`sqlite3\`, \`sql.js\`, raw file reads/writes, or whole-image operations.
- A live \`memory.db-wal\` is expected while a native owner is active. Never checkpoint, delete, rename, replace, or unlink database sidecars.
- If recall fails or is safely refused, report it once and continue from repository/source evidence. Do not force a second driver or claim an empty result is healthy.
- Before relevant work, use \`memory_search\` / \`memory_search_unified\` and \`hooks_route\` when available.
- After a validated success, use \`memory_store\` and \`hooks_post_task\` when the result is genuinely reusable.
- Dispatch background work through \`hooks_worker_dispatch\` only after discovering its current schema and confirming that a worker is appropriate.`,
};

export const CLAUDE_SECTIONS = {
  'Agent comms': `**ruflo-managed:claude-agents:v2**

## Agent comms

The \`Agent\` tool and \`SendMessage\` are Claude Code features; Codex uses its own native agent surface. Named native agents coordinate by messaging, not by polling shared state. Native agents are not automatically Ruflo-tracked.

- Name every agent and tell it who receives which result.
- Launch independent agents together; give writers isolated worktrees and non-overlapping ownership.
- For Ruflo-tracked work, create the structured swarm/agent records before launching matching native agents.
- After spawning, continue independent work. Wait only when a real dependency blocks progress.
- Do not poll repeatedly; agents message back or complete through the native host.`,
  Setup: `**ruflo-managed:claude-setup:v2**

## Setup

\`ruflo-core\` owns the Claude MCP server when the plugin is installed. Do not register a duplicate standalone \`claude-flow\` server because both would write the same project state.

Direct diagnostics remain valid:

\`\`\`bash
npx ruflo@latest doctor --fix
\`\`\``,
};

const KNOWN = {
  'Ruflo Interface Contract': new Set([
    '892e0afb1bb5537bf4300198543c2108fc05c85d86d8f8bcb191b60e19441d2f', // patch v1 HTML-marker wording
  ]),
  'Swarm & Coordination': new Set([
    '54a4402c3ed2a59b853a5a1d0166e07de0c4d549957557500fbf9f01f34a8266', // original scaffold
    '89e29e0bcedd39b984335674b8743952cc09e9ac60f292d241e0b26f5bfbbc70', // compact formatting
    'abdb0b544c969b1207ae5f02824a55c6c3b29c77878dcd51d8c7d7aa04c4e202', // formatter output
    'ced5ede881f612c18c6e2af8a83924dd6a6a0215661983a7717c87338a246641', // patch v1 em-dash wording
  ]),
  'MCP Integration': new Set([
    '739763ad7acdee07b2d970cd8e052838b487f3c228c4094dfe8cd1563859158a', // original scaffold
    '2f06b787295e25a45a477e982bb645c8dacfc0c0036a175723e29a1648d37bc6', // MetaHarness clarification
  ]),
  'Memory & Learning': new Set([
    'e9606098cfd1667b8966e3b30017c730bc3ec2c3dfff10897ef3b855f0a23086', // original scaffold
    '7c556d43cadf44cb5a64cddabaff9f9d4929e8d854c75dc9bf87dcab36ae5791', // compact formatting
    'f934c7bdcf1a944409048242d12663f7ec7673d9c1e6db07b7c01785c46993ef', // WAL-safe MCP-first addition
    '58b7947b73c38ebde4c070eea01268939b159c5908fec53bf6ff080b121e9867', // strict managed-memory addition
  ]),
  'Agent comms': new Set([
    '813160516d37881e81b4df5b88e40ef7e46b482a8eef98bc5b977f03b544c88e',
  ]),
  Setup: new Set([
    'bb71329d836decb6dd9d08261cfb84ff397e8ec1976114637489209637873b15', // plugin-native scaffold
    'fa1c3118dca1cd6cb6998e87f4e5c0d6ba94bdbf20f442d85d9643a040f65119', // duplicate MCP registration
    'ca5a5c45c5d1ae1d47d0ae454a58b65cab81efc93ef9fad13c438b9cb392fbf6', // detailed plugin-native note
  ]),
};

const KNOWN_LEGACY_SKILLS = {
  'memory-management': new Set([
    '95ae048b82560896a4974458c2c298ca93feb355e618542dbbd6c44de471460f',
    '57ecdd02b6079194e6ddea24443685fc5cbe5e445f3c8a4b1ec4d4f58eb9298e',
  ]),
  'swarm-orchestration': new Set([
    '6c039f22a9a6338148a27beb689df5f025cb6abed64da5cb8b30f21ca6ecd57c',
    '6a9ee0ac32c27210b9cb0f4648c0336a817c3a736d86da43b08420aafcd04406',
  ]),
  'sparc-methodology': new Set([
    '930e676fea48a877a9ac2cfeb1ac85bc1ad6566dad024f2e6cb2018f0bfe5e04',
    '9c861dd4ab150aac277b0aa3fbdaa7e208433fac35c28acefee47fff34e9b865',
  ]),
  'performance-analysis': new Set([
    '8d3eac894116542b39f4fd3d0a381b08686507ad83c0e2e491aad51bfa0e7025',
    'd5cd79f0cb91ab97a6a3c4382e0c592e0f7f017a74022a1ccc9534bfe5435630',
    '49a577bbbd5e69554beaf823105adaac1b0275cfd714ffec9ac32bd9b1510120',
  ]),
  'security-audit': new Set([
    '37f7a0551ceb5b75853620d415f32f9cd93940313aa91b7adec8f12bdbeba775',
    '5337a5c98d88ca7b574d921f91807008cb93fb0a1e1e662dad70e2e58266b878',
  ]),
};

const LEGACY_SCRIPT_ROWS = {
  'memory-management': [
    '| `memory-backup` | `.agents/scripts/memory-backup.sh` | Backup memory to external storage |',
    '| `memory-consolidate` | `.agents/scripts/memory-consolidate.sh` | Consolidate and optimize memory |',
  ],
  'swarm-orchestration': [
    '| `swarm-start` | `.agents/scripts/swarm-start.sh` | Initialize swarm with default settings |',
    '| `swarm-monitor` | `.agents/scripts/swarm-monitor.sh` | Real-time swarm monitoring dashboard |',
  ],
  'sparc-methodology': [
    '| `sparc-init` | `.agents/scripts/sparc-init.sh` | Initialize SPARC workflow for a new feature |',
    '| `sparc-review` | `.agents/scripts/sparc-review.sh` | Run SPARC phase review checklist |',
  ],
  'performance-analysis': [
    '| `perf-baseline` | `.agents/scripts/perf-baseline.sh` | Capture performance baseline |',
    '| `perf-regression` | `.agents/scripts/perf-regression.sh` | Check for performance regressions |',
  ],
  'security-audit': [
    '| `security-scan` | `.agents/scripts/security-scan.sh` | Run full security scan pipeline |',
    '| `cve-remediate` | `.agents/scripts/cve-remediate.sh` | Auto-remediate known CVEs |',
  ],
};

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const normalize = (value) => value.replaceAll('\r\n', '\n');
function stripLegacyScriptReference(source, name) {
  const rows = LEGACY_SCRIPT_ROWS[name];
  if (!rows) return source;
  const block = `## Scripts\n\n| Script | Path | Description |\n|--------|------|-------------|\n${rows.join('\n')}\n\n`;
  return source.split(block).length === 2 ? source.replace(block, '') : source;
}
function sectionRange(source, title) {
  const heading = `## ${title}`;
  const lines = source.split('\n');
  const matches = lines.flatMap((line, index) => line === heading ? [index] : []);
  if (matches.length !== 1) return { error: `${title}: expected one heading, found ${matches.length}` };
  const headingIndex = matches[0];
  const marker = (line) => /^(?:<!-- ruflo-(?:interface-contract|managed):.*-->|\*\*ruflo-(?:interface-contract|managed):.*\*\*)$/.test(line);
  const start = headingIndex > 1 && lines[headingIndex - 1] === '' && marker(lines[headingIndex - 2])
    ? headingIndex - 2
    : headingIndex > 0 && marker(lines[headingIndex - 1]) ? headingIndex - 1 : headingIndex;
  let end = headingIndex + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end++;
  if (end > headingIndex + 2 && lines[end - 1] === '' && marker(lines[end - 2])) end -= 2;
  else if (end > headingIndex + 1 && marker(lines[end - 1])) end--;
  return { lines, start, end, text: lines.slice(headingIndex, end).join('\n').trimEnd() };
}

export function migrateText(source, kind, { known = KNOWN } = {}) {
  const crlf = source.includes('\r\n');
  let next = normalize(source);
  const finalNewline = next.endsWith('\n');
  const replacements = kind === 'agents' ? SHARED_SECTIONS : CLAUDE_SECTIONS;
  if (kind === 'claude' && next.split('\n').find((line) => line.trim())?.trim() !== '@AGENTS.md') {
    return { error: 'CLAUDE.md does not import @AGENTS.md as its first nonblank line' };
  }
  for (const [title, replacement] of Object.entries(replacements)) {
    let range = sectionRange(next, title);
    if (title === 'Ruflo Interface Contract' && range.error) {
      const anchor = '\n## Swarm & Coordination\n';
      if (!next.includes(anchor) || next.split(anchor).length !== 2) return { error: 'cannot place the interface contract unambiguously' };
      next = next.replace(anchor, `\n${replacement}\n\n## Swarm & Coordination\n`);
      continue;
    }
    if (range.error) return { error: range.error };
    const replacementSection = replacement.split('\n')
      .filter((line) => !line.startsWith('<!-- ') && !/^\*\*ruflo-(?:interface-contract|managed):/.test(line))
      .join('\n').trimStart();
    const current = range.text === replacementSection;
    if (!current && !known[title]?.has(digest(range.text))) {
      return { error: `${title}: edited or unknown generated block (${digest(range.text)})` };
    }
    const before = range.lines.slice(0, range.start);
    const after = range.lines.slice(range.end);
    const replacementLines = replacement.split('\n');
    if (after.length && replacementLines.at(-1) !== '' && after[0] !== '') replacementLines.push('');
    next = [...before, ...replacementLines, ...after].join('\n');
  }
  if (finalNewline && !next.endsWith('\n')) next += '\n';
  if (crlf) next = next.replaceAll('\n', '\r\n');
  return { next, changed: next !== source };
}

export function migrateSkillText(source, name, { legacy = KNOWN_LEGACY_SKILLS } = {}) {
  const crlf = source.includes('\r\n');
  let result = name === 'ruflo' ? patchPlatformSkill(source) : patchBuiltInSkill(source);
  if (name !== 'ruflo' && skillNameForSource(source) !== name) {
    return { error: `${name}: file identity does not match its built-in skill` };
  }
  if (name !== 'ruflo' && result.missing.length
      && legacy[name]?.has(digest(normalize(source)))) {
    const normalized = normalize(source);
    const start = normalized.indexOf('## Commands\n');
    const end = normalized.indexOf('\n## ', start + 1);
    const replacement = skillReplacement(name);
    if (start >= 0 && end > start && replacement) {
      const next = normalized.slice(0, start) + replacement + '\n' + normalized.slice(end);
      const errors = skillContractViolations(next, name);
      if (!errors.length) {
        result = { next: source.includes('\r\n') ? next.replaceAll('\n', '\r\n') : next, missing: [] };
      }
    }
  }
  if (result.missing.length) return { error: `${name}: edited, unknown, or unsupported skill (${result.missing.join(', ')})` };
  const normalized = normalize(result.next);
  const withoutLegacyScripts = name === 'ruflo' ? normalized : stripLegacyScriptReference(normalized, name);
  const next = crlf ? withoutLegacyScripts.replaceAll('\n', '\r\n') : withoutLegacyScripts;
  return { next, changed: next !== source };
}

function regular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${file} is not a regular non-symlink file`);
  return stat;
}
function planRoot(root, known, { instructions = true, skills = true } = {}) {
  if (!path.isAbsolute(root)) throw new Error(`root must be absolute: ${root}`);
  const resolved = path.resolve(root);
  if (fs.realpathSync(resolved) !== resolved) throw new Error(`root must be canonical and non-symlinked: ${root}`);
  const git = fs.lstatSync(path.join(resolved, '.git'));
  if (!git.isDirectory() || git.isSymbolicLink()) throw new Error(`root lacks a regular .git directory: ${root}`);
  const files = [];
  if (instructions) {
    for (const [name, kind] of [['AGENTS.md', 'agents'], ['CLAUDE.md', 'claude']]) {
      const file = path.join(resolved, name);
      const stat = regular(file);
      const source = fs.readFileSync(file, 'utf8');
      const result = migrateText(source, kind, { known });
      if (result.error) throw new Error(`${file}: ${result.error}`);
      files.push({ file, source, next: result.next, stat, changed: result.changed });
    }
  }
  if (skills) {
    for (const name of [...SKILL_NAMES, 'ruflo']) {
      const file = path.join(resolved, '.agents', 'skills', name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const stat = regular(file);
      const source = fs.readFileSync(file, 'utf8');
      const result = migrateSkillText(source, name);
      if (result.error) throw new Error(`${file}: ${result.error}`);
      files.push({ file, source, next: result.next, stat, changed: result.changed });
    }
  }
  return { root: resolved, files };
}
function atomicWrite(item, bytes) {
  const current = regular(item.file);
  if (current.dev !== item.stat.dev || current.ino !== item.stat.ino
      || current.size !== item.stat.size || current.mtimeMs !== item.stat.mtimeMs) {
    throw new Error(`${item.file} changed after preflight`);
  }
  const temp = path.join(path.dirname(item.file), `.rsp-instructions-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
  const fd = fs.openSync(temp, 'wx', item.stat.mode & 0o777);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(temp, item.file); } catch (error) { try { fs.unlinkSync(temp); } catch { /* best effort */ } throw error; }
}

export function migrateRoots(roots, { apply = false, known = KNOWN } = {}) {
  const plans = roots.map((root) => planRoot(root, known)); // complete fleet preflight before the first write
  const changed = plans.flatMap((plan) => plan.files.filter((file) => file.changed));
  if (apply) for (const item of changed) atomicWrite(item, item.next);
  return { roots: plans.length, files: plans.reduce((n, plan) => n + plan.files.length, 0), changed: changed.map((item) => item.file), applied: apply };
}

export function migrateSkillRoots(roots, { apply = false } = {}) {
  const plans = roots.map((root) => planRoot(root, KNOWN, { instructions: false, skills: true }));
  const changed = plans.flatMap((plan) => plan.files.filter((file) => file.changed));
  if (apply) for (const item of changed) atomicWrite(item, item.next);
  return { roots: plans.length, files: plans.reduce((n, plan) => n + plan.files.length, 0), changed: changed.map((item) => item.file), applied: apply };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const apply = args[0] === '--apply';
  const roots = apply ? args.slice(1) : args;
  if (!roots.length) throw new Error('usage: migrate.mjs [--apply] /absolute/project ...');
  console.log(JSON.stringify(migrateRoots(roots, { apply }), null, 2));
}
