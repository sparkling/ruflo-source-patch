// Minimal source-faithful fixtures for the @claude-flow/codex packaged skills
// and the @claude-flow/cli platform-skill generator implicated by Ruflo #3153.

const skill = (name, title, commands) => `---
name: ${name}
---

# ${title}

## Purpose
fixture

${commands}



## Best Practices
1. fixture
`;

export const SKILLS = {
  'memory-management': skill('memory-management', 'Memory Management Skill', `## Commands

### Store Data
Store a pattern in memory

\`\`\`bash
npx @claude-flow/cli memory store --key "key" --value "value" --namespace patterns
\`\`\`

### Search Data
Semantic search in memory

\`\`\`bash
npx @claude-flow/cli memory search --query "search terms" --limit 10
\`\`\``),
  'swarm-orchestration': skill('swarm-orchestration', 'Swarm Orchestration Skill', `## Commands

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
\`\`\``),
  'sparc-methodology': skill('sparc-methodology', 'Sparc Methodology Skill', `## Commands

### Specification Phase
Define requirements and acceptance criteria

\`\`\`bash
npx @claude-flow/cli hooks route --task "specification: [requirements]"
\`\`\`

### Architecture Phase
Design system structure

\`\`\`bash
npx @claude-flow/cli hooks route --task "architecture: [design]"
\`\`\``),
  'performance-analysis': skill('performance-analysis', 'Performance Analysis Skill', `## Commands

### Run Benchmark Suite

\`\`\`bash
npx @claude-flow/cli performance benchmark --suite all
\`\`\`

### Profile Code

\`\`\`bash
npx @claude-flow/cli performance profile --target ./src
\`\`\``),
  'security-audit': skill('security-audit', 'Security Audit Skill', `## Commands

### Full Security Scan
Run comprehensive security analysis

\`\`\`bash
npx @claude-flow/cli security scan --depth full
\`\`\`

### Input Validation Check
Check for input validation issues

\`\`\`bash
npx @claude-flow/cli security scan --check input-validation
\`\`\``),
};

export const PLATFORM_MARKDOWN = `---
name: ruflo
---

# Ruflo

Ruflo is a cross-agent orchestration layer that ships as three npm packages: \`ruflo\` (thin wrapper), \`claude-flow\` (umbrella), and \`@claude-flow/cli\` (implementation). Users invoke it as \`npx ruflo <command>\`.

## Getting started (three commands)

\`npx ruflo init\`, \`npx ruflo doctor --fix\`, and \`npx ruflo discover-plugins\`.

## MCP tools (314 available)

After \`ruflo init\`, Claude Code (or any MCP-compatible agent) auto-loads ruflo's MCP servers. Key namespaces:

- \`mcp__claude-flow__memory_*\` — store/search/list/retrieve with HNSW-indexed semantic search
- \`mcp__claude-flow__swarm_*\` — init hierarchical/mesh swarms with anti-drift topology
- \`mcp__claude-flow__agent_spawn\` — spawn specialized agents (coder, reviewer, tester, security-architect, +55 more)
- \`mcp__claude-flow__hooks_*\` — routing, pattern learning, background worker dispatch
- \`mcp__claude-flow__task_*\` — task lifecycle (create/assign/complete/summary)
- \`mcp__claude-flow__intelligence_*\` — 4-step pipeline (RETRIEVE → JUDGE → DISTILL → CONSOLIDATE)

Full catalog: \`npx ruflo mcp list\`.

## Plugin discovery

Full plugin list + descriptions: \`npx ruflo plugins list\`.
`;

export const PLATFORM_GENERATOR = `const RUFLO_PLATFORM_SKILL_MD = \`${PLATFORM_MARKDOWN.replaceAll('`', '\\`').trimEnd()}
\`;
// #2777
`;
