// Ruflo #3153: task-specific skills are higher-priority instructions than the
// generated root policy. Keep their runtime examples on the same MCP-first contract.

export const ISSUE_MARKER = 'ruflo-source-patch (ruvnet/ruflo#3153)';
export const SKILL_NAMES = [
  'memory-management',
  'swarm-orchestration',
  'sparc-methodology',
  'performance-analysis',
  'security-audit',
];

const DEFINITIONS = {
  'memory-management': {
    heading: '# Memory Management Skill',
    original: `## Commands

### Store Data
Store a pattern in memory

\`\`\`bash
npx @claude-flow/cli memory store --key "key" --value "value" --namespace patterns
\`\`\`

### Search Data
Semantic search in memory

\`\`\`bash
npx @claude-flow/cli memory search --query "search terms" --limit 10
\`\`\``,
    patched: `<!-- ${ISSUE_MARKER}:memory-management -->
## Structured Interface

Discover the live schemas, then use \`memory_store\` to persist validated patterns
and \`memory_search\` / \`memory_search_unified\` to recall them. Memory is optional
context, not a delivery gate. Never replace a refused managed read with raw SQL,
whole-file access, or a second npx-resolved memory driver.`,
    required: ['memory_store', 'memory_search', 'memory_search_unified'],
  },
  'swarm-orchestration': {
    heading: '# Swarm Orchestration Skill',
    original: `## Commands

### Initialize Swarm
Start a new swarm with hierarchical topology

\`\`\`bash
npx @claude-flow/cli swarm init --topology hierarchical --max-agents 8
\`\`\`

### Route Task
Route a task to the appropriate agents

\`\`\`bash
npx @claude-flow/cli hooks route --task "[task description]"
\`\`\`

### Monitor Status
Check the current swarm status

\`\`\`bash
npx @claude-flow/cli swarm status
\`\`\``,
    patched: `<!-- ${ISSUE_MARKER}:swarm-orchestration -->
## Structured Interface

Choose topology from dependencies, shared-state risk, and evidence needs—not a file
count. Discover schemas, then use \`swarm_init\`, \`hooks_route\`, and
\`swarm_status\`. A Ruflo agent record does not launch a native host agent: register
tracked workers with \`agent_spawn\`, then launch matching Claude/Codex executors
separately with isolated ownership.`,
    required: ['swarm_init', 'hooks_route', 'swarm_status', 'agent_spawn'],
  },
  'sparc-methodology': {
    heading: '# Sparc Methodology Skill',
    original: `## Commands

### Specification Phase
Define requirements and acceptance criteria

\`\`\`bash
npx @claude-flow/cli hooks route --task "specification: [requirements]"
\`\`\`

### Architecture Phase
Design system structure

\`\`\`bash
npx @claude-flow/cli hooks route --task "architecture: [design]"
\`\`\``,
    patched: `<!-- ${ISSUE_MARKER}:sparc-methodology -->
## Structured Interface

Use native host tools to execute Specification, Pseudocode, Architecture,
Refinement, and Completion. When Ruflo routing is useful, discover and call
\`hooks_route\`; recall prior constraints with \`memory_search\`, and store only
validated reusable outcomes with \`memory_store\`.`,
    required: ['hooks_route', 'memory_search', 'memory_store'],
  },
  'performance-analysis': {
    heading: '# Performance Analysis Skill',
    original: `## Commands

### Run Benchmark Suite

\`\`\`bash
npx @claude-flow/cli performance benchmark --suite all
\`\`\`

### Profile Code

\`\`\`bash
npx @claude-flow/cli performance profile --target ./src
\`\`\``,
    patched: `<!-- ${ISSUE_MARKER}:performance-analysis -->
## Structured Interface

Establish a source-bound baseline. When the live registry exposes them, use
\`performance_benchmark({suite: "all"})\` and
\`performance_profile({target: "./src"})\`. Otherwise use the repository's native
benchmark/profiler; do not invent a Ruflo command or report an unmeasured target.`,
    required: ['performance_benchmark', 'performance_profile'],
  },
  'security-audit': {
    heading: '# Security Audit Skill',
    original: `## Commands

### Full Security Scan
Run comprehensive security analysis

\`\`\`bash
npx @claude-flow/cli security scan --depth full
\`\`\`

### Input Validation Check
Check for input validation issues

\`\`\`bash
npx @claude-flow/cli security scan --check input-validation
\`\`\``,
    previousPatched: `<!-- ${ISSUE_MARKER}:security-audit -->
## Structured Interface

Discover specialized installed security capabilities first. Use
\`aidefence_scan\`, \`aidefence_is_safe\`, and \`aidefence_has_pii\` only when
they are registered and reachable. Ruflo source/dependency scanning is CLI-only:
when the Brain bridge is present, obtain exact subcommand help with
\`ruvnet_cli_help\`, then use \`ruvnet_cli_run\` with literal argv. Otherwise
inspect the installed executable's help; never guess flags or claim a scan ran.`,
    patched: `<!-- ${ISSUE_MARKER}:security-audit -->
## Structured Interface

Discover specialized installed security capabilities first. Use
\`aidefence_scan\`, \`aidefence_is_safe\`, and \`aidefence_has_pii\` only when
they are registered and reachable. Ruflo source/dependency scanning is CLI-only:
when the Brain bridge is present, obtain exact subcommand help with
\`ruvnet_cli_help({executable: "ruflo", argv: ["<group>", "<command>"]})\`,
then use \`ruvnet_cli_run({executable: "ruflo", argv: [...]})\` only with the
authorized literal arguments. Otherwise inspect the installed \`ruflo\`
executable's help; never guess flags or claim a scan ran.`,
    required: ['aidefence_scan', 'ruvnet_cli_help', 'ruvnet_cli_run', 'executable: "ruflo"'],
  },
};

export const skillReplacement = (name) => DEFINITIONS[name]?.patched ?? null;

const normalize = (source) => source.replaceAll('\r\n', '\n');
const restoreEol = (source, crlf) => crlf ? source.replaceAll('\n', '\r\n') : source;
const occurrences = (source, needle) => source.split(needle).length - 1;

export function skillNameForSource(source) {
  const normalized = normalize(source);
  const matches = Object.entries(DEFINITIONS)
    .filter(([, definition]) => normalized.includes(definition.heading))
    .map(([name]) => name);
  return matches.length === 1 ? matches[0] : null;
}

export function skillContractViolations(source, name = skillNameForSource(source), { requireMarker = true } = {}) {
  if (!name || !DEFINITIONS[name]) return ['unknown built-in skill'];
  const normalized = normalize(source);
  const errors = [];
  if (requireMarker && !normalized.includes(`${ISSUE_MARKER}:${name}`)) errors.push('local skill marker absent');
  for (const required of DEFINITIONS[name].required) {
    if (!normalized.includes(required)) errors.push(`required interface absent: ${required}`);
  }
  if (/npx @claude-flow\/cli(?:@latest)?\s+(?:swarm|memory|hooks|performance|security)\b/.test(normalized)) {
    errors.push('raw MCP-capable CLI remains');
  }
  if (normalized.includes('ruvnet_cli_help') && !normalized.includes('executable: "ruflo"')) {
    errors.push('managed Ruflo executable selection absent');
  }
  if (normalized.includes('executable: "claude-flow"')) errors.push('ambiguous legacy managed executable remains');
  return errors;
}

export function patchBuiltInSkill(source) {
  const name = skillNameForSource(source);
  if (!name) return { next: source, applied: [], missing: ['built-in-skill-surface'] };
  const crlf = source.includes('\r\n');
  let next = normalize(source);
  const { original, previousPatched, patched } = DEFINITIONS[name];
  if (occurrences(next, patched) === 1) return { next: source, applied: [], missing: [] };
  if (previousPatched) {
    const previousCount = occurrences(next, previousPatched);
    if (previousCount === 1) {
      next = next.replace(previousPatched, patched);
      const errors = skillContractViolations(next, name);
      if (errors.length) return { next: source, applied: [], missing: errors.map((error) => `${name}(${error})`) };
      return { next: restoreEol(next, crlf), applied: [`skill-${name}-revision`], missing: [] };
    }
    if (previousCount > 1) {
      return { next: source, applied: [], missing: [`${name}(AMBIGUOUS: prior patch occurs ${previousCount}x)`] };
    }
  }
  const count = occurrences(next, original);
  if (count !== 1) {
    return { next: source, applied: [], missing: [count > 1 ? `${name}(AMBIGUOUS: anchor occurs ${count}x)` : name] };
  }
  next = next.replace(original, patched);
  const errors = skillContractViolations(next, name);
  if (errors.length) return { next: source, applied: [], missing: errors.map((error) => `${name}(${error})`) };
  return { next: restoreEol(next, crlf), applied: [`skill-${name}`], missing: [] };
}

export function reverseBuiltInSkill(source) {
  const name = skillNameForSource(source);
  if (!name) return source;
  const crlf = source.includes('\r\n');
  const { original, previousPatched, patched } = DEFINITIONS[name];
  const normalized = normalize(source);
  const next = normalized.includes(patched)
    ? normalized.replace(patched, original)
    : previousPatched ? normalized.replace(previousPatched, original) : normalized;
  return restoreEol(next, crlf);
}

export const isBuiltInSkillPatched = (source) => {
  const name = skillNameForSource(source);
  return Boolean(name) && skillContractViolations(source, name).length === 0;
};

const PLATFORM_INTRO = 'Ruflo is a cross-agent orchestration layer that ships as three npm packages: `ruflo` (thin wrapper), `claude-flow` (umbrella), and `@claude-flow/cli` (implementation). Users invoke it as `npx ruflo <command>`.';
const PLATFORM_INTRO_PATCHED = 'Ruflo is a cross-agent orchestration layer. Direct `npx ruflo` is for bootstrap and administration; once MCP is live, agents use discovered structured tools for runtime coordination, memory, routing, learning, and status.';
const PLATFORM_MCP = `## MCP tools (314 available)

After \`ruflo init\`, Claude Code (or any MCP-compatible agent) auto-loads ruflo's MCP servers. Key namespaces:

- \`mcp__claude-flow__memory_*\` — store/search/list/retrieve with HNSW-indexed semantic search
- \`mcp__claude-flow__swarm_*\` — init hierarchical/mesh swarms with anti-drift topology
- \`mcp__claude-flow__agent_spawn\` — spawn specialized agents (coder, reviewer, tester, security-architect, +55 more)
- \`mcp__claude-flow__hooks_*\` — routing, pattern learning, background worker dispatch
- \`mcp__claude-flow__task_*\` — task lifecycle (create/assign/complete/summary)
- \`mcp__claude-flow__intelligence_*\` — 4-step pipeline (RETRIEVE → JUDGE → DISTILL → CONSOLIDATE)

Full catalog: \`npx ruflo mcp list\`.`;
const PLATFORM_MCP_PATCHED_V1 = `<!-- ${ISSUE_MARKER}:platform-skill -->
## Runtime interface (MCP first)

Use the live tool registry as authority. Discover deferred tools and current schemas;
never guess a prefix, name, argument, capability, count, or health state.

- Source and capability claims: \`search_ruvnet\` when the Brain is installed.
- Runtime guidance: \`guidance_brain\` / \`guidance_recommend\` when registered.
- Memory: \`memory_search\`, \`memory_search_unified\`, \`memory_store\`.
- Coordination: \`swarm_init\`, \`agent_spawn\`, \`swarm_status\`.
- Lifecycle/routing: \`hooks_route\`, \`hooks_pre_task\`, \`hooks_post_task\`.

For a genuine CLI-only gap, use \`ruvnet_cli_help\` and then \`ruvnet_cli_run\`
with literal argv when that managed bridge is registered. Native Claude/Codex agents
perform execution; Ruflo records do not launch them automatically.`;
const PLATFORM_MCP_PATCHED = `<!-- ${ISSUE_MARKER}:platform-skill -->
## Runtime interface (MCP first)

Use the live tool registry as authority. Discover deferred tools and current schemas;
never guess a prefix, name, argument, capability, count, or health state.

- Source and capability claims: \`search_ruvnet\` when the Brain is installed.
- Runtime guidance: \`guidance_brain\` / \`guidance_recommend\` when registered.
- Memory: \`memory_search\`, \`memory_search_unified\`, \`memory_store\`.
- Coordination: \`swarm_init\`, \`agent_spawn\`, \`swarm_status\`.
- Lifecycle/routing: \`hooks_route\`, \`hooks_pre_task\`, \`hooks_post_task\`.

For a genuine Ruflo CLI-only gap, use
\`ruvnet_cli_help({executable: "ruflo", argv: ["<group>", "<command>"]})\`,
then \`ruvnet_cli_run({executable: "ruflo", argv: [...]})\` only with the exact
literal arguments that help authorized. Native Claude/Codex agents perform
execution; Ruflo records do not launch them automatically.`;
const PLATFORM_PLUGIN = 'Full plugin list + descriptions: `npx ruflo plugins list`.';
const PLATFORM_PLUGIN_PATCHED = 'Discover registered plugin-management tools first. During bootstrap administration, inspect the installed Ruflo CLI help before invoking a plugin-management command.';

const PLATFORM_REPLACEMENTS = [
  ['platform-intro', PLATFORM_INTRO, PLATFORM_INTRO_PATCHED],
  ['platform-runtime', PLATFORM_MCP, PLATFORM_MCP_PATCHED, PLATFORM_MCP_PATCHED_V1],
  ['platform-plugin-discovery', PLATFORM_PLUGIN, PLATFORM_PLUGIN_PATCHED],
];

function transformPlatformMarkdown(source, reverse = false) {
  const crlf = source.includes('\r\n');
  let next = normalize(source);
  const applied = [];
  const missing = [];
  for (const [id, original, patched, previousPatched] of PLATFORM_REPLACEMENTS) {
    const target = reverse ? original : patched;
    if (occurrences(next, target) === 1) continue;
    const candidates = reverse
      ? [patched, previousPatched].filter(Boolean)
      : [previousPatched, original].filter(Boolean);
    const matches = candidates.map((candidate) => [candidate, occurrences(next, candidate)])
      .filter(([, count]) => count > 0);
    const total = matches.reduce((sum, [, count]) => sum + count, 0);
    if (total !== 1) missing.push(total > 1 ? `${id}(AMBIGUOUS: anchors occur ${total}x)` : id);
    else { next = next.replace(matches[0][0], target); applied.push(id); }
  }
  return { next: restoreEol(next, crlf), applied, missing };
}

export function patchPlatformSkill(source) {
  if (!normalize(source).includes('# Ruflo')) return { next: source, applied: [], missing: ['platform-skill-surface'] };
  const result = transformPlatformMarkdown(source);
  if (!result.missing.length && (!result.next.includes(`${ISSUE_MARKER}:platform-skill`)
      || result.next.includes('mcp__claude-flow__'))) {
    return { next: source, applied: [], missing: ['unsafe-platform-skill-output'] };
  }
  return result;
}

export const isPlatformSkillPatched = (source) => platformContractViolations(source).length === 0;

export function platformContractViolations(source, { requireMarker = true } = {}) {
  const normalized = normalize(source);
  const errors = [];
  if (requireMarker && !normalized.includes(`${ISSUE_MARKER}:platform-skill`)) errors.push('local platform marker absent');
  for (const required of ['search_ruvnet', 'guidance_brain', 'ruvnet_cli_help', 'ruvnet_cli_run', 'memory_search', 'swarm_init']) {
    if (!normalized.includes(required)) errors.push(`required interface absent: ${required}`);
  }
  if (!normalized.includes('executable: "ruflo"')) errors.push('managed Ruflo executable selection absent');
  if (normalized.includes('executable: "claude-flow"')) errors.push('ambiguous legacy managed executable remains');
  if (normalized.includes('mcp__claude-flow__')) errors.push('stale fixed MCP prefix remains');
  if (/npx ruflo (?:mcp list|plugins list)/.test(normalized)) errors.push('raw runtime/discovery CLI remains');
  return errors;
}

export function reversePlatformSkill(source) {
  const result = transformPlatformMarkdown(source, true);
  return result.missing.length ? source : result.next;
}

const PLATFORM_START = 'const RUFLO_PLATFORM_SKILL_MD = `';
const PLATFORM_END = '\n`;\n// #2777';

function platformLiteral(source) {
  const start = source.indexOf(PLATFORM_START);
  if (start < 0 || source.indexOf(PLATFORM_START, start + 1) >= 0) return null;
  const bodyStart = start + PLATFORM_START.length;
  const end = source.indexOf(PLATFORM_END, bodyStart);
  if (end < 0 || source.indexOf(PLATFORM_END, end + 1) >= 0) return null;
  return { start: bodyStart, end, markdown: source.slice(bodyStart, end).replaceAll('\\`', '`') };
}

export function platformMarkdownFromGenerator(source) {
  return platformLiteral(source)?.markdown ?? null;
}

export function patchPlatformGenerator(source) {
  const literal = platformLiteral(source);
  if (!literal) return { next: source, applied: [], missing: ['platform-generator-surface'] };
  const result = patchPlatformSkill(literal.markdown);
  if (result.missing.length) return { next: source, applied: [], missing: result.missing };
  const embedded = result.next.replaceAll('`', '\\`');
  return {
    next: source.slice(0, literal.start) + embedded + source.slice(literal.end),
    applied: result.applied,
    missing: [],
  };
}

export const isPlatformGeneratorPatched = (source) => {
  const literal = platformLiteral(source);
  return Boolean(literal) && isPlatformSkillPatched(literal.markdown);
};

export function reversePlatformGenerator(source) {
  const literal = platformLiteral(source);
  if (!literal) return source;
  const markdown = reversePlatformSkill(literal.markdown).replaceAll('`', '\\`');
  return source.slice(0, literal.start) + markdown + source.slice(literal.end);
}
