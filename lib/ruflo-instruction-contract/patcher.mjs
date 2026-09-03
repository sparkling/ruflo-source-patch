// Ruflo #3153: generated root instructions and higher-priority skills contradict
// their own MCP-first policy. Patch only installed instruction source surfaces;
// runtime, Brain, hooks, and memory remain untouched.

import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_ROOTS, NPX_ROOT } from '../cwd/paths.mjs';
import {
  ISSUE_MARKER,
  SKILL_NAMES,
  isBuiltInSkillPatched,
  isPlatformGeneratorPatched,
  patchBuiltInSkill,
  patchPlatformGenerator,
  recoverPlatformGenerator,
  reverseBuiltInSkill,
  reversePlatformGenerator,
  skillNameForSource,
} from './skill-contract.mjs';

export const PATCH_MARKER = ISSUE_MARKER;

const COMMON_POLICY = `**ruflo-interface-contract:v2**

## Ruflo Interface Contract

- Use \`search_ruvnet\` for RuvNet source/capability claims when the Brain is
  installed; cite its source. Local tool registration is not source evidence.
- Use \`guidance_brain\` / \`guidance_recommend\` and the live MCP registry for
  this process's registered, configured, reachable, healthy, and authorized state.
- Use a structured Ruflo MCP tool whenever the live registry exposes the operation.
  Discover deferred tools and current schemas; never guess prefixes, names, or args.
- For a genuine Ruflo CLI-only gap, use
  \`ruvnet_cli_help({executable: "ruflo", argv: ["<group>", "<command>"]})\`,
  then \`ruvnet_cli_run({executable: "ruflo", argv: [...]})\` with the exact
  literal arguments that help authorized. Never guess \`claude-flow\` as the
  executable merely because an old package or instruction used that name.
- Direct shell is for bootstrap/administration that cannot depend on running MCP:
  install/init, first MCP registration/start, diagnostics, and deliberate daemon work.
- Native Claude/Codex agents execute. Ruflo tracks a swarm only after
  \`swarm_init\` and \`agent_spawn\` create records; a native agent alone is not proof.
- Before generic testing/security agents, discover specialized installed QE or
  adversarial-security capabilities. Disclose any fallback.`;
const rspCommonPolicy = COMMON_POLICY;

const CLAUDE_SECTIONS = {
  'Ruflo Capability Brain & Implementation Loop': `${COMMON_POLICY}

### Implementation loop

1. Recall relevant project memory and accepted ADR constraints when available.
2. Inspect source, runtime, dependencies, policy, and health independently.
3. Select the smallest capable topology from dependencies, risk, and shared state.
4. Define acceptance criteria, authority, ownership, and failure behavior.
5. Execute through native agents in isolated scopes; record only real Ruflo state.
6. Run focused, regression, security, and failure-path checks.
7. Bind conclusions to exact source/build evidence and disclose limitations.
8. Publish only through a separately authorized release gate.`,
  'Swarm & Routing': `## Swarm & Routing

Choose the smallest capable topology from dependency edges, shared-state risk, and
required evidence instead of a file count. Independent one-shot native agents need no
Ruflo swarm. For persistent topology, shared memory, or tracked handoffs, discover
the live schemas, then call \`swarm_init\` and register workers with \`agent_spawn\`.
One writer per worktree; one integration owner.`,
  'Agent Comms (SendMessage-First Coordination)': `## Agent Comms (SendMessage-First Coordination)

Named native Claude agents coordinate through \`SendMessage\`, not polling. They are
execution workers, not automatically Ruflo-tracked workers.

For a tracked graph, first call \`swarm_init\`, then register each worker with
\`agent_spawn({agentType: "...", agentId: "..."})\`. Launch matching native agents
only after those records exist. Continue independent work after spawning and wait
only when a real dependency blocks progress.

- Give every writer its own worktree and non-overlapping file ownership.
- Name agents and state who receives each result.
- Read-only research may run concurrently.
- Do not repeatedly poll; agents report or complete through the native host.`,
  'Memory & Learning': `## Memory & Learning

Use live structured tools after discovering their schemas:

| Need | Structured tool |
|------|-----------------|
| Recall project patterns | \`memory_search\` / \`memory_search_unified\` |
| Persist a validated pattern | \`memory_store\` |
| Route work | \`hooks_route\` |
| Record task start/end | \`hooks_pre_task\` / \`hooks_post_task\` |
| Dispatch a real worker | \`hooks_worker_dispatch\` |

Memory is optional context, not a delivery gate. A failed or safely refused read must
not become raw database access, a second npx driver, or a claim that empty is healthy.`,
  'Agents': `## Agents

Choose roles from the live registry and dependency graph. Common Ruflo roles include
\`researcher\`, \`architect\`, \`coder\`, and \`reviewer\`, but an arbitrary role
string does not prove a specialized runtime. Discover specialized QE and adversarial
security capabilities before substituting generic tester/security roles.`,
  'CLI Quick Reference': `## Interface Quick Reference

### Structured runtime

\`swarm_init\`, \`agent_spawn\`, \`memory_search\`, \`memory_store\`,
\`hooks_route\`, \`hooks_pre_task\`, \`hooks_post_task\`,
\`hooks_worker_dispatch\`, \`performance_benchmark\`, \`system_status\`.

### Direct bootstrap and diagnostics

\`ruflo init\`, first MCP registration/start, \`ruflo doctor\`, and a deliberately
chosen \`ruflo daemon\` lifecycle may run directly. Discover other CLI-only work
through managed help/run; do not invent flags.`,
  'Setup': `## Setup

Direct setup is allowed before MCP exists:

\`\`\`bash
claude mcp add claude-flow -- npx -y ruflo@latest mcp start
npx ruflo@latest doctor --fix
\`\`\`

The daemon is optional and can consume model capacity through workers. Start it only
by explicit choice after checking \`ruflo daemon --help\`. Runtime coordination uses
MCP; native host tools perform file, code, test, and git work.`,
  'Security': `## Security

- Never hardcode or commit secrets; validate inputs and file paths at boundaries.
- Use \`aidefence_scan\`, \`aidefence_is_safe\`, and \`aidefence_has_pii\` only
  when the live registry reports them configured and reachable.
- Ruflo code/dependency audit is CLI-only. With the Brain bridge, require exact
  \`ruvnet_cli_help({executable: "ruflo", argv: ["<group>", "<command>"]})\`
  before literal-argv \`ruvnet_cli_run({executable: "ruflo", argv: [...]})\`;
  otherwise inspect the installed executable's help. Do not guess \`--report\`.
- A template does not prove a security control or compliance posture.`,
  'Performance': `## Performance

- Establish a source-bound baseline before optimization.
- Use \`performance_benchmark({suite: "all"})\` for Ruflo measurements and
  \`performance_profile({target: "..."})\` for a registered component.
- Bind speed, latency, and memory claims to the tested build and workload.`,
  'Hooks': `## Hooks

Use live structured tools: \`hooks_pre_task\`, \`hooks_post_task\`,
\`hooks_session_start\`, \`hooks_session_end\`, \`hooks_route\`, and
\`hooks_worker_dispatch\`. Validate current schemas. Hyphenated spellings are not
MCP tool names.`,
  'Intelligence (SONA + HNSW)': `## Intelligence (SONA + HNSW)

Discover installed intelligence and memory capabilities before using them. Do not
infer embeddings, HNSW, SONA, a memory bridge, or latency from this template. Record
model-routing outcomes only when those live tools are configured and reachable.`,
  'Federation': `## Federation

This template configures no federation, trust tiers, transport security, PII
handling, or compliance. Do not run guessed \`federation\` subcommands. Discover
source and the live registry, require explicit peer/network authority, and name the
exact installed interface before making a federation claim.`,
};

const CODEX_SECTIONS = {
  'Ruflo + Codex Automated Workflow': `${COMMON_POLICY}

### Execution loop

Recall → inspect → route → plan → execute → test → validate → benchmark → receipt.
Use isolated worktrees for concurrent writers, one integration owner, and exact
source evidence. Coordination returns immediately; continue executor work until a
real dependency blocks.`,
  'Agent Coordination': `## Agent Coordination

Use the smallest capable structure from dependency edges, shared-state risk, and
required evidence instead of a file count. Independent one-shot native agents need no Ruflo
swarm. For persistent topology/shared memory/tracked handoffs, call \`swarm_init\`,
then \`agent_spawn({agentType: "coder", agentId: "dev-1"})\` before matching native
Codex agents. One writer per worktree; one integration owner.`,
  'Execution Model': `## Execution Model

- **Ruflo MCP** records coordination, memory, routing, learning, and runtime status.
- **Codex native tools/agents** edit files, run commands/tests, and perform git work.
- Coordination is not implementation and returns immediately.
- A native agent is not Ruflo-tracked until structured Ruflo records exist.`,
  'MCP Integration': `## MCP Integration

Discover live tools and schemas before calling them:

| Need | Valid structured example |
|------|--------------------------|
| Tracked swarm | \`swarm_init({topology: "hierarchical"})\` |
| Tracked worker | \`agent_spawn({agentType: "coder", agentId: "dev-1"})\` |
| Memory | \`memory_search({query: "..."})\`, \`memory_store({key: "...", value: "..."})\` |
| Lifecycle | \`hooks_route({task: "..."})\`, \`hooks_post_task({taskId: "..."})\` |
| Benchmark | \`performance_benchmark({suite: "all"})\` |
| Workflow/session | \`workflow_run({task: "..."})\`, \`session_restore({sessionId: "..."})\` |
| Claims/status | \`claims_list({status: "all"})\`, \`system_status({verbose: true})\` |`,
  'Memory System': `## Memory System

Use \`memory_search\` / \`memory_search_unified\` for recall and \`memory_store\`
for validated decisions. Memory is optional context. Never switch a safely refused
store to raw SQL, sql.js, or another npx-resolved driver.`,
  'Quick Commands': `## Structured Runtime Examples

\`memory_search({query: "relevant patterns"})\`

\`hooks_route({task: "current task description"})\`

\`swarm_init({topology: "hierarchical"})\`

\`hooks_pre_task({taskId: "task-1", description: "task summary"})\``,
  'Performance Targets': `## Performance Evidence

No universal target is established by this template. Use \`performance_benchmark\`
/ \`performance_profile\` against a source-bound baseline and report measured data.`,
  'Hooks System': `## Hooks System

Use \`hooks_pre_task\`, \`hooks_post_task\`, \`hooks_session_start\`,
\`hooks_session_end\`, \`hooks_route\`, and \`hooks_worker_dispatch\`. Discover
schemas first; do not turn them into raw CLI or guessed hyphenated tool names.`,
  'Background Workers': `## Background Workers

Use \`hooks_worker_list\`, \`hooks_worker_status\`, and
\`hooks_worker_dispatch({trigger: "audit"})\`. Do not infer worker count,
reachability, or continuous execution from generated documentation.`,
  'Intelligence System': `## Intelligence System

Treat SONA, MoE, HNSW, EWC, embeddings, and routing as independently configured.
Discover live tools and bind performance/learning claims to runtime evidence.`,
  'Debugging': `## Debugging

Use direct \`ruflo doctor\` for CLI diagnostics and \`system_status\` for Ruflo
runtime state. Native shell tools remain appropriate for OS/process diagnostics.`,
  'Governance': `## Governance Scaffold (Not an Implemented Control)

This checklist creates no approval policy, RBAC, immutable audit log, retention,
compliance evidence, or release authority. Define those in repository-owned policy
and prove them against deployment. \`claims_list\` inspects configured Ruflo claims;
it does not prove organizational authorization.`,
  'Service Level Agreements (SLAs)': `## Service Levels (Unconfigured)

No uptime, response-time, RTO, RPO, escalation, or support commitment is created by
this template. Add measured objectives only after owners and telemetry exist.`,
  'Incident Response': `## Incident Response Scaffold

Require explicit authority before containment, termination, rollback, or deployment.
List tracked agents, then terminate one exact ID with
\`agent_terminate({agentId: "..."})\`. Persistent work may use \`workflow_run\`.
Deployment rollback is CLI-only: discover exact help through the managed bridge and
never invent flags. Preserve evidence and recoverability.`,
  'Disaster Recovery': `## Disaster Recovery Scaffold

This template creates no backups, checkpoints, retention, RTO, or RPO. Use
\`session_restore({sessionId: "..."})\` only for a previously saved session. No
generic AgentDB \`memory restore\` is promised; use a tested store-specific runbook.`,
  'Monitoring & Alerting': `## Monitoring & Alerting Scaffold

Generated metric names/thresholds are examples, not active monitors. Bind alerts to
real telemetry, owners, escalation, and tested failure modes before claiming coverage.`,
};

const rspInstructionSections = { claude: CLAUDE_SECTIONS, codex: CODEX_SECTIONS };

export function instructionContractViolations(result) {
  const errors = [];
  if (!result.includes('## Ruflo Interface Contract')) errors.push('interface contract absent');
  for (const required of ['search_ruvnet', 'guidance_brain', 'ruvnet_cli_help', 'ruvnet_cli_run']) {
    if (!result.includes(required)) errors.push(`required authority absent: ${required}`);
  }
  for (const required of [
    'ruvnet_cli_help({executable: "ruflo", argv:',
    'ruvnet_cli_run({executable: "ruflo", argv:',
  ]) {
    if (!result.includes(required)) errors.push(`managed Ruflo executable selection absent: ${required}`);
  }
  if (result.includes('executable: "claude-flow"')) errors.push('ambiguous legacy managed executable remains');
  if (!/structured Ruflo MCP/i.test(result)) errors.push('structured MCP preference absent');
  if (/npx @claude-flow\/cli(?:@latest)?\s+(?:swarm|memory|hooks|performance|claims|agent|logs|workflow|session|status)\b/.test(result)) errors.push('raw MCP-capable CLI remains');
  for (const stale of ['task_orchestrate', 'benchmark_run', 'hooks_post-task', 'hooks_worker-dispatch', 'hive-mind_init', 'hive-mind_consensus', 'hive-mind_spawn']) {
    if (result.includes(stale)) errors.push('stale interface remains: ' + stale);
  }
  if (/agent_spawn\(\{\s*type\s*:/.test(result)) errors.push('stale agent_spawn schema remains');
  if (/neural_train\(\{\s*iterations\s*:/.test(result)) errors.push('stale neural_train schema remains');
  if (/99\.99% availability|HIPAA, SOC2, GDPR|immutable and SOC2 compliant/i.test(result)) errors.push('unproved enterprise claim remains');
  return errors;
}

function rspInstructionContract(markdown, host) {
  if (typeof markdown !== 'string') throw new TypeError('generated instructions must be a string');
  const replacements = rspInstructionSections[host];
  if (!replacements) throw new Error('unknown instruction host: ' + host);
  const lines = markdown.split('\n');
  const output = [];
  const seen = new Set();
  for (let index = 0; index < lines.length;) {
    const match = /^## (.+)$/.exec(lines[index]);
    if (!match) { output.push(lines[index]); index++; continue; }
    let end = index + 1;
    while (end < lines.length && !/^## /.test(lines[end])) end++;
    const title = match[1].trim();
    if (!Object.prototype.hasOwnProperty.call(replacements, title)) output.push(...lines.slice(index, end));
    else if (!seen.has(title)) { output.push(...replacements[title].split('\n')); seen.add(title); }
    index = end;
  }
  let result = output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  if (!result.includes('## Ruflo Interface Contract')) {
    const resultLines = result.trimEnd().split('\n');
    const section = resultLines.findIndex((line) => /^## /.test(line));
    const insertion = section >= 0 ? section : Math.min(1, resultLines.length);
    resultLines.splice(insertion, 0, ...rspCommonPolicy.split('\n'), '');
    result = resultLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }
  const errors = instructionContractViolations(result);
  if (errors.length) throw new Error('unsafe generated instructions: ' + errors.join('; '));
  return result;
}

export const transformGeneratedInstructions = rspInstructionContract;

const RUNTIME = `// ${PATCH_MARKER}\nconst rspCommonPolicy = ${JSON.stringify(rspCommonPolicy)};\nconst rspInstructionSections = ${JSON.stringify(rspInstructionSections)};\n${instructionContractViolations.toString()}\n${rspInstructionContract.toString()}`;

const CLAUDE_RUNTIME = '// --- Template Composers ---';
const CLAUDE_RUNTIME_PATCHED = `${RUNTIME}\n\n${CLAUDE_RUNTIME}`;
const CLAUDE_RETURN = '    return `${header}\\n${body}\\n`;';
const CLAUDE_RETURN_PATCHED = '    return rspInstructionContract(`${header}\\n${body}\\n`, \'claude\');';
const CODEX_RUNTIME = `/**\n * Generate an AGENTS.md file based on the provided options`;
const CODEX_RUNTIME_PATCHED = `${RUNTIME}\n\n${CODEX_RUNTIME}`;
const CODEX_RETURNS = [
  ['            return generateMinimal(options);', '            return rspInstructionContract(generateMinimal(options), \'codex\');'],
  ['            return generateFull(options);', '            return rspInstructionContract(generateFull(options), \'codex\');'],
  ['            return generateEnterprise(options);', '            return rspInstructionContract(generateEnterprise(options), \'codex\');'],
  ['            return generateDefault(options);', '            return rspInstructionContract(generateDefault(options), \'codex\');'],
];

const occurrences = (source, needle) => source.split(needle).length - 1;
function replaceUnique(source, original, patched, id, applied, missing) {
  if (occurrences(source, patched) === 1) return source;
  const count = occurrences(source, original);
  if (count !== 1) { missing.push(count > 1 ? `${id}(AMBIGUOUS: anchor occurs ${count}x)` : id); return source; }
  applied.push(id);
  return source.replace(original, () => patched);
}

export function patchSource(source) {
  if (skillNameForSource(source)) return patchBuiltInSkill(source);
  if (source.includes('const RUFLO_PLATFORM_SKILL_MD = `')) return patchPlatformGenerator(source);
  const applied = [];
  const missing = [];
  let next = source;
  const claude = source.includes(CLAUDE_RUNTIME) || source.includes(CLAUDE_RUNTIME_PATCHED) || source.includes(CLAUDE_RETURN_PATCHED);
  const codex = source.includes(CODEX_RUNTIME) || source.includes(CODEX_RUNTIME_PATCHED) || CODEX_RETURNS.some(([, patched]) => source.includes(patched));
  if (claude && !codex) {
    next = replaceUnique(next, CLAUDE_RUNTIME, CLAUDE_RUNTIME_PATCHED, 'claude-runtime', applied, missing);
    next = replaceUnique(next, CLAUDE_RETURN, CLAUDE_RETURN_PATCHED, 'claude-render', applied, missing);
  } else if (codex && !claude) {
    next = replaceUnique(next, CODEX_RUNTIME, CODEX_RUNTIME_PATCHED, 'codex-runtime', applied, missing);
    for (const [index, pair] of CODEX_RETURNS.entries()) next = replaceUnique(next, pair[0], pair[1], `codex-render-${index + 1}`, applied, missing);
  } else missing.push(claude && codex ? 'generator-surface(AMBIGUOUS)' : 'generator-surface');
  return { next, applied, missing };
}

export function reverseSource(source) {
  if (skillNameForSource(source)) return reverseBuiltInSkill(source);
  if (source.includes('const RUFLO_PLATFORM_SKILL_MD = `')) return reversePlatformGenerator(source);
  let next = source.replace(CLAUDE_RETURN_PATCHED, CLAUDE_RETURN)
    .replace(CLAUDE_RUNTIME_PATCHED, CLAUDE_RUNTIME)
    .replace(CODEX_RUNTIME_PATCHED, CODEX_RUNTIME);
  for (const [original, patched] of CODEX_RETURNS) next = next.replace(patched, original);
  return next;
}

export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => hasPatch(source)
  && (isBuiltInSkillPatched(source)
    || isPlatformGeneratorPatched(source)
    || (source.includes(CLAUDE_RUNTIME_PATCHED) && source.includes(CLAUDE_RETURN_PATCHED))
    || (source.includes(CODEX_RUNTIME_PATCHED) && CODEX_RETURNS.every(([, patched]) => source.includes(patched))));

function packageName(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name; }
  catch { return null; }
}
function regularFile(file) {
  try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink(); }
  catch { return false; }
}
function addBundle(found, nodeModules, cliRoot) {
  if (packageName(cliRoot) !== '@claude-flow/cli') return;
  const claude = path.join(cliRoot, 'dist', 'src', 'init', 'claudemd-generator.js');
  const codexRoots = [
    path.join(cliRoot, 'node_modules', '@claude-flow', 'codex'),
    path.join(nodeModules, '@claude-flow', 'codex'),
    path.join(nodeModules, 'ruflo', 'node_modules', '@claude-flow', 'codex'),
  ];
  const codexRoot = codexRoots.find((root) => packageName(root) === '@claude-flow/codex');
  const codex = codexRoot && path.join(codexRoot, 'dist', 'generators', 'agents-md.js');
  const init = path.join(cliRoot, 'dist', 'src', 'commands', 'init.js');
  let platform = null;
  try {
    if (fs.readFileSync(init, 'utf8').includes('const RUFLO_PLATFORM_SKILL_MD = `')) platform = init;
  } catch { /* older CLI without the platform skill */ }
  found.set(cliRoot, { cliRoot, claude, codexRoot, codex, platform });
}
function addNodeModules(found, nodeModules) {
  addBundle(found, nodeModules, path.join(nodeModules, '@claude-flow', 'cli'));
  addBundle(found, nodeModules, path.join(nodeModules, 'ruflo', 'node_modules', '@claude-flow', 'cli'));
}
export function discoverBundles() {
  const found = new Map();
  for (const root of GLOBAL_ROOTS) addNodeModules(found, root);
  try { for (const hash of fs.readdirSync(NPX_ROOT)) addNodeModules(found, path.join(NPX_ROOT, hash, 'node_modules')); }
  catch { /* no npx cache */ }
  return [...found.values()];
}

function addCodexRoot(found, root) {
  if (packageName(root) === '@claude-flow/codex') found.add(root);
}
function addCodexRoots(found, nodeModules) {
  for (const root of [
    path.join(nodeModules, '@claude-flow', 'codex'),
    path.join(nodeModules, '@claude-flow', 'cli', 'node_modules', '@claude-flow', 'codex'),
    path.join(nodeModules, 'ruflo', 'node_modules', '@claude-flow', 'codex'),
    path.join(nodeModules, 'ruflo', 'node_modules', '@claude-flow', 'cli', 'node_modules', '@claude-flow', 'codex'),
  ]) addCodexRoot(found, root);
}
export function discoverCodexRoots() {
  const found = new Set();
  for (const root of GLOBAL_ROOTS) addCodexRoots(found, root);
  try {
    for (const hash of fs.readdirSync(NPX_ROOT)) addCodexRoots(found, path.join(NPX_ROOT, hash, 'node_modules'));
  } catch { /* no npx cache */ }
  return [...found];
}
function codexSurfaces(root) {
  const files = [path.join(root, 'dist', 'generators', 'agents-md.js')];
  for (const name of SKILL_NAMES) files.push(path.join(root, '.agents', 'skills', name, 'SKILL.md'));
  return files.filter(regularFile);
}
export function discover() {
  const files = new Set();
  for (const bundle of discoverBundles()) {
    for (const file of [bundle.claude, bundle.platform]) if (regularFile(file)) files.add(file);
  }
  for (const root of discoverCodexRoots()) for (const file of codexSurfaces(root)) files.add(file);
  return [...files];
}
export function preflight() {
  const bundles = discoverBundles();
  const errors = [];
  const codexRoots = discoverCodexRoots();
  if (!bundles.length && !codexRoots.length) errors.push('no authenticated Ruflo instruction source found');
  for (const bundle of bundles) {
    const surfaces = [['claude', bundle.claude]];
    if (bundle.platform) surfaces.push(['platform skill', bundle.platform]);
    for (const [host, file] of surfaces) {
      if (!file || !regularFile(file)) { errors.push(`${bundle.cliRoot}: missing regular ${host} generator`); continue; }
    }
  }
  for (const root of codexRoots) {
    const generator = path.join(root, 'dist', 'generators', 'agents-md.js');
    if (!regularFile(generator)) errors.push(`${root}: missing regular Codex generator`);
    for (const name of ['memory-management', 'swarm-orchestration', 'sparc-methodology', 'security-audit']) {
      const file = path.join(root, '.agents', 'skills', name, 'SKILL.md');
      if (!regularFile(file)) errors.push(`${root}: missing regular built-in skill ${name}`);
    }
  }
  for (const file of discover()) {
    try {
      const current = fs.readFileSync(file, 'utf8');
      const backup = `${file}.rsp-backup`;
      // A monitor may be upgrading a prior revision of this same named patch. Its
      // live bytes no longer satisfy the new contract, but composition still owns
      // one exact vendor pristine. Preflight that pristine; apply subsequently
      // re-proves ownership and composes from the same backup.
      const source = current.includes(PATCH_MARKER) && regularFile(backup) && fs.statSync(backup).size > 0
        ? fs.readFileSync(backup, 'utf8') : current;
      const result = patchSource(source);
      if (result.missing.length) errors.push(`${file}: ${result.missing.join(', ')}`);
      else if (!isPatched(result.next)) errors.push(`${file}: transform did not produce a complete patch`);
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}

export const descriptor = {
  name: 'ruflo-instruction-contract', atomic: true,
  discover, preflight, patchSource, hasPatch, reverse: reverseSource, isPatched,
  recover: (source) => recoverPlatformGenerator(source),
};
