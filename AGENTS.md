# ruflo-source-patch

> A zero-dependency Node CLI that source-patches the installed `ruflo` / `@claude-flow/cli` (and its
> `ruflo-adr` / `ruvnet-brain` plugins) by exact literal anchors, and keeps the patches applied across
> npx re-fetches via a SessionStart hook plus a launchd/cron monitor. The governing thesis: **a failure
> must never look like success.** Architecture and rationale live in [`docs/adr/`](docs/adr/).
>
> **This file (`AGENTS.md`) is the single CANONICAL, shared instruction source for
> BOTH OpenAI Codex and Claude Code.** Codex reads it directly; Claude Code imports
> it via `@AGENTS.md` at the top of `CLAUDE.md`. Edit SHARED instructions HERE.
> Claude-Code-only guidance lives in `CLAUDE.md` (below its `@AGENTS.md` line).

## Commands

All via `npx github:sparkling/ruflo-source-patch <target> <action>` (a global install exposes the same as
`ruflo-source-patch <target> <action>`). Actions are `install | uninstall | status` unless noted.

### Everything at once

```bash
npx github:sparkling/ruflo-source-patch all install      # every patch + plugin target + the monitor
npx github:sparkling/ruflo-source-patch all uninstall    # revert them all + bring the monitor down
npx github:sparkling/ruflo-source-patch all status       # the full readout in one call
```

`make install` / `make uninstall` (clone path) just delegate to `all`, so both paths run identical code.

### Patch targets (`@claude-flow/cli`)

```bash
npx github:sparkling/ruflo-source-patch cwd install       # anchor .claude-flow/.swarm + durable state to the project root (#2633)
npx github:sparkling/ruflo-source-patch daemon install    # one daemon per project root, not per subdirectory (#2633/#2407/#2484)
npx github:sparkling/ruflo-source-patch memory install    # memory.db write lock (#2621) + WAL-coherent reads (#2584) + integrity gate (refuse a torn-image flush) + stale-writer guard: kills every pre-patch writer, daemon AND MCP client, to force fresh code; a killed MCP client needs a manual /mcp reconnect after, so it warns loudly, machine-wide (#2621/ADR-023; RSP_NO_STALE_WRITER_KILL disables the kill)
```

### Plugin patches (`ruflo-adr`, `ruvnet-brain`)

```bash
npx github:sparkling/ruflo-source-patch adr-template install      # adr-create writes metadata adr-index can parse (#2659)
npx github:sparkling/ruflo-source-patch adr-index install         # adr-index converges instead of faking success (#2660)
npx github:sparkling/ruflo-source-patch adr-reindex install       # adds /adr-reindex (needs `memory`). SUPERSEDED: self-retires on @claude-flow/cli 3.29.0+, kept for older CLIs (#2666)
npx github:sparkling/ruflo-source-patch verify-interface install  # reopen ruvnet-brain's unopenable PreToolUse gate (#12). RETIRED as of ruvnet-brain 3.2.9 (auto-retires; see ADR-010)
npx github:sparkling/ruflo-source-patch mcp-prefix install         # rewrite bundled mcp__claude-flow__* refs to mcp__plugin_ruflo-core_ruflo__* — dead under plugin loading (#2685)
npx github:sparkling/ruflo-source-patch design-wall install        # scope ruvnet-brain's design-grade commit gate to its own repo — it fires on ANY repo's README otherwise (ruvnet-brain#17)
```

### Keep it live (actions add `run | check`)

```bash
npx github:sparkling/ruflo-source-patch monitor install   # schedule the launchd/cron re-apply
npx github:sparkling/ruflo-source-patch monitor check     # exit 1 if anything has drifted
```

### Script targets (project scaffolding; action adds `run <args…>`)

```bash
npx github:sparkling/ruflo-source-patch dual run <project>          # single-source dual Claude Code + Codex (alias: dual)
npx github:sparkling/ruflo-source-patch plugin-only run . --dry-run  # strip the ~260 duplicated files + hooks + MCP registration (aliases: dedupe, dedupe-bundle)
```

`run` materializes the current script and executes it, forwarding your args, with no separate `install` step.

### Repair a sprawled project

```bash
npx github:sparkling/ruflo-source-patch cleanup . --dry-run   # kill stray daemons + remove subdir .claude-flow/.swarm
```

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary; prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root; use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or `.env` files
- Do NOT add a `Co-Authored-By` trailer to user commits unless this project explicitly opts in
- Keep files under 500 lines
- Validate input at system boundaries

## Swarm & Coordination

| Setting | Value | Purpose |
|---------|-------|---------|
| Topology | `hierarchical` | Queen-led coordination (anti-drift) |
| Max Agents | 8 | Optimal team size |
| Strategy | `specialized` | Clear role boundaries |
| Consensus | `raft` | Leader-based consistency |

```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

### When to use a swarm

- **YES**: 3+ files, new features, cross-module refactoring, API changes with tests, security-related changes, performance optimization
- **NO**: single-file edits, one- or two-line fixes, documentation updates, configuration changes, questions

### Agent types

| Type | Role |
|------|------|
| `researcher` | Requirements analysis, understanding scope |
| `architect` / `system-architect` | System design, planning structure |
| `coder` / `backend-dev` | Implementation |
| `tester` | Test creation, quality assurance |
| `reviewer` | Code review, security and quality |

Also: `security-architect`, `security-auditor`, `performance-engineer`, `perf-analyzer`,
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`, `pr-manager`,
`code-review-swarm`, `issue-tracker`, `release-manager`. Any string works as a custom agent type.

## MCP Integration

Use MCP tools for coordination, then keep working. Coordination calls return instantly.

| Category | Key tools |
|----------|-----------|
| **Swarm** | `swarm_init`, `swarm_status`, `swarm_health` |
| **Agents** | `agent_spawn`, `agent_list`, `agent_status` |
| **Memory** | `memory_store`, `memory_search`, `memory_search_unified` |
| **Hooks** | `hooks_route`, `hooks_post-task`, `hooks_worker-dispatch` |
| **Security** | `aidefence_scan`, `aidefence_is_safe`, `aidefence_has_pii` |
| **Hive-Mind** | `hive-mind_init`, `hive-mind_consensus`, `hive-mind_spawn` |

## Memory & Learning

### Before any task

```bash
npx @claude-flow/cli@latest memory search --query "[task keywords]" --namespace patterns
npx @claude-flow/cli@latest hooks route --task "[task description]"
```

### After success

```bash
npx @claude-flow/cli@latest memory store --namespace patterns --key "[name]" --value "[what worked]"
npx @claude-flow/cli@latest hooks post-task --task-id "[id]" --success true --store-results true
```

### Background workers

| Worker | When |
|--------|------|
| `audit` | After security changes |
| `optimize` | After performance work |
| `testgaps` | After adding features |
| `map` | Every 5+ file changes |
| `document` | After API changes |

```bash
npx @claude-flow/cli@latest hooks worker dispatch --trigger audit
```

## Code Standards

- File organization: never save to root; use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- Files under 500 lines
- No hardcoded secrets or API keys
- Input validation at boundaries; typed interfaces for public APIs
- TDD (London School / mock-first) preferred

### Commit messages

```
<type>(<scope>): <description>

[optional body]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`.
(Do NOT append a `Co-Authored-By` trailer to user commits unless the project opts in.)

## Security

- NEVER commit secrets, credentials, or `.env` files; NEVER hardcode API keys
- Always validate user input; use parameterized queries for SQL; sanitize output (XSS)
- Path security: validate all file paths, prevent directory traversal (`../`), use absolute paths internally

## Build & Test

- ALWAYS run tests after code changes; ALWAYS verify the build before committing

```bash
npm run build && npm test
```

## Codex platform notes

- **Skill syntax**: invoke skills with `$skill-name`. (Claude Code uses `/skill-name`; see `CLAUDE.md`.)
- **Execution model**: `claude-flow` = LEDGER (coordinates memory, routing, swarm state); **Codex = EXECUTOR** (writes code, runs tests, creates files). Coordination commands return instantly, so DON'T STOP after them; continue immediately with the next implementation step.
- Codex config lives in `.agents/config.toml` (project) and `.codex/config.toml` (local overrides, gitignored).

## Links

- Documentation: https://github.com/ruvnet/ruflo
- Issues: https://github.com/ruvnet/ruflo/issues
