# ruflo-source-patch

> A zero-dependency Node CLI that source-patches the installed `ruflo` / `@claude-flow/cli` (and its
> `ruflo-adr` / `ruvnet-brain` plugins, plus MetaHarness host packages) by exact literal anchors, and keeps the patches applied across
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
npx github:sparkling/ruflo-source-patch daemon install    # legacy #2877 compatibility; auto-retires on executable native project-root proof (umbrella #2633)
npx github:sparkling/ruflo-source-patch memory install    # canonical path-keyed bridge identity (#3143) + stronger fail-closed memory.db writer boundary above native #2878 + raw WAL refusal (#2735) + integrity/stale-writer guards; stale MCP clients are reported, never killed (ADR-006/ADR-023; RSP_NO_STALE_WRITER_KILL disables daemon restarts)
npx github:sparkling/ruflo-source-patch init install      # keep init plugin-native; legacy #2777 guard retires on bounded upstream bytes (#2640/#2685)
npx github:sparkling/ruflo-source-patch plugin-hosts install # dual-host install/uninstall/sync + automatic host-native updates (#2854/#2870)
npx github:sparkling/ruflo-source-patch ruflo-model-contract install # exact native model IDs; routing tier stays caller/harness allocated (#3215)
npx github:sparkling/ruflo-source-patch ruflo-context-contract install # validated context episodes; preserve real outcomes, never turn plain facts into invented success (#3314)
```

### Plugin/package patches (`ruflo-adr`, `ruvnet-brain`, MetaHarness)

```bash
npx github:sparkling/ruflo-source-patch adr-template install      # legacy creator/parser compatibility; auto-retires on four-copy behavior proof (#2659)
npx github:sparkling/ruflo-source-patch adr-index install         # retired after active native convergence + reindex-route proof (#2660)
npx github:sparkling/ruflo-source-patch adr-io-safety install     # exact installed-Ruflo driver + fail-closed ADR reads/proven writes; refuse purge-first reindex (#3147/#3097)
npx github:sparkling/ruflo-source-patch adr-reindex install       # legacy /adr-reindex; retires only when native skill + purge share one proven lock with every writer (#2666/#2878)
npx github:sparkling/ruflo-source-patch ruflo-hooks-schema install # retired on proven Ruflo 3.32.39 strict manifest + Codex-valid handlers (#2816/PR #2857)
npx github:sparkling/ruflo-source-patch ruflo-codex-skills install # retired on Ruflo's native read-only status skill (#2821)
npx github:sparkling/ruflo-source-patch ruflo-instruction-contract install # generated roots + packaged skills follow live structured interfaces (#3153)
npx github:sparkling/ruflo-source-patch verify-interface install  # reopen ruvnet-brain's unopenable PreToolUse gate (#12). RETIRED as of ruvnet-brain 3.2.9 (auto-retires; see ADR-010)
npx github:sparkling/ruflo-source-patch mcp-prefix install         # legacy #2685 rewrite; auto-retires after proving current Ruflo HEAD + local compositions are native
npx github:sparkling/ruflo-source-patch design-wall install        # legacy #17 fix; auto-retires after verifying upstream's stronger repo-identity gate
npx github:sparkling/ruflo-source-patch flywheel-daily install     # legacy #53 cadence fix; auto-retires on Brain's behavioral replacement
npx github:sparkling/ruflo-source-patch codex-hooks install        # retired; Brain 4.0.2 publishes the native six-event Codex lifecycle (#52)
npx github:sparkling/ruflo-source-patch brain-codex-skills install # retired on Brain 4.0.12+'s executable immutable installed workflow (#76)
npx github:sparkling/ruflo-source-patch brain-console-lifecycle install # native launcher is accepted; repair the still-incomplete live doctor comparison (#79)
npx github:sparkling/ruflo-source-patch brain-console-provider-keys install # retired on staged catalog + explicit degraded-state behavior in Brain 4.0.12+ (#86)
npx github:sparkling/ruflo-source-patch brain-release-lockstep install # fail doctor on bundle/package/Spine/host version drift without touching Brain's updater (#77)
npx github:sparkling/ruflo-source-patch brain-memory-doctor-roots install # retired on shared common/configured-root behavior in Brain 4.0.12+ (#81)
npx github:sparkling/ruflo-source-patch brain-managed-memory-boundary install # preserve Brain 4.0.36's detector; add default raw-SQL refusal + audited exact diagnostic (#102/#103)
npx github:sparkling/ruflo-source-patch brain-search-safety install # ignore inherited symbol keys and refuse unproved automatic repair (#224/#225)
npx github:sparkling/ruflo-source-patch brain-dual-host-receipt install # emit MCP persistence request; never start a second Ruflo memory driver (#272)
npx github:sparkling/ruflo-source-patch brain-dual-host-stdin install # stream large host prompts over stdin; prevent cross-critique E2BIG (#273)
npx github:sparkling/ruflo-source-patch brain-grounding-evidence install # record successful searches for Stop without granting unrelated product writes (#316)
npx github:sparkling/ruflo-source-patch metaharness-codex-hooks install # render declared MetaHarness hooks as native project Codex hooks (#168)
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
npx github:sparkling/ruflo-source-patch ruflo-codex-hooks run        # repair an existing Codex install without touching its global Ruflo MCP (#2801)
npx github:sparkling/ruflo-source-patch codex-switch run copilot      # continue one Codex resume ID on a Copilot proxy instead of the subscription; `openai` switches back, `status` reports (ADR-030)
```

`run` materializes the current script and executes it, forwarding your args, with no separate `install` step.

### Repair a sprawled project

```bash
npx github:sparkling/ruflo-source-patch cleanup . --dry-run   # kill stray daemons + remove subdir .claude-flow/.swarm
```

## Rules

- Do what has been asked; nothing more, nothing less
- Do not apply the Brain's `release-proof` skill to this repository (user instruction, 2026-09-13). Follow this repository's main-only, immutable-semver-tag release process; retain scoped regression tests, disclose existing failures, and verify installation separately from live MCP activation.
- Patch only installed npm/npx package or plugin source bytes through a named, issue-backed patch target.
- Brain executable source, including hooks and MCP handlers in the active installed generation, may be patched by that framework with exact anchors, pristine restoration, monitor re-application, behavioural proof, and an upstream retirement condition.
- NEVER interfere with RuvNet Brain's native KB and release-update plane: do not disable, delay, pin, redirect, shadow, replace, or bypass its downloads, background updater, `active.json`, version selection/promotion, KB/cache data, update receipts, or self-learning data. Do not rewrite Brain version identity or present locally patched bytes as a different upstream release.
- NEVER add Brain environment guards or local runtime substitutes. This includes `RUVNET_BRAIN_IMPORT_ONLY`, dev overrides, manual mirrors/caches, replacement update jobs, or frozen version-specific entrypoints. Never delete or move Brain update/cache assets unless the user explicitly requests that exact upstream-supported operation.
- NEVER download, seed, promote, or otherwise upgrade RuvNet Brain manually. If a newer Brain is required, stop and tell the user; the user will restart the session so Brain's native session lifecycle performs the upgrade.
- A Brain source patch must let the native updater activate its generation first, then patch only the installed executable bytes it owns. It must never drive or impersonate an upgrade. If it cannot coexist with native KB/release updates, stop and ask the user; do not install a workaround.
- NEVER create files unless absolutely necessary; prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root; use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or `.env` files
- Do NOT add a `Co-Authored-By` trailer to user commits unless this project explicitly opts in
- Keep files under 500 lines
- Validate input at system boundaries

**ruflo-interface-contract:v2**

## Ruflo Interface Contract

- Use `search_ruvnet` for RuvNet source and capability claims when the Brain is installed; cite its source.
- Use `guidance_brain` / `guidance_recommend` and the live MCP registry for this process's actual registered, configured, reachable, healthy, and authorized state.
- Prefer a live structured Ruflo MCP tool for coordination, memory, routing, learning, and status. Discover deferred tools and schemas; never guess names or arguments.
- For a genuine Ruflo CLI-only gap, use `ruvnet_cli_help({executable: "ruflo", argv: ["<group>", "<command>"]})`, then `ruvnet_cli_run({executable: "ruflo", argv: [...]})` with the exact literal arguments that help authorized. Never guess `claude-flow` as the executable merely because an old package or instruction used that name.
- Direct shell is for bootstrap and administration that cannot depend on MCP: install/init, first MCP registration/start, diagnostics, and deliberate daemon work.
- Native Claude/Codex agents execute. Ruflo tracks a swarm only after `swarm_init` and `agent_spawn` create records; a native agent alone is not proof.
- Before generic testing or security agents, discover specialized installed QE or adversarial-security capabilities and disclose any fallback.

**ruflo-managed:swarm:v2**

## Swarm & Coordination

Use the smallest capable structure derived from dependency edges, shared-state risk, and required evidence instead of a file count.

- Independent one-shot native agents need no Ruflo swarm.
- For persistent topology, shared memory, or tracked handoffs, discover the live schemas, call `swarm_init`, then register each worker with `agent_spawn({agentType: "...", agentId: "..."})`.
- A tracked record does not launch a native Claude/Codex agent; launch the matching executor separately.
- Give every writer an isolated worktree and non-overlapping ownership; name one integration owner.
- Read-only research may run concurrently. Continue independent work after spawning and wait only on a real dependency.
- Role strings such as `researcher`, `architect`, `coder`, and `reviewer` are labels, not proof of a specialized runtime.

**ruflo-managed:mcp:v2**

## MCP Integration

Use structured MCP tools for normal runtime work, then continue implementation. Coordination calls return immediately. Host-level registration is not proof of a tracked worker or a generated MetaHarness verifier.

| Need | Live structured tools |
|------|-----------------------|
| Guidance | `guidance_brain`, `guidance_recommend` |
| Swarm | `swarm_init`, `swarm_status`, `swarm_health` |
| Agents | `agent_spawn`, `agent_list`, `agent_status` |
| Memory | `memory_store`, `memory_search`, `memory_search_unified` |
| Hooks | `hooks_route`, `hooks_pre_task`, `hooks_post_task`, `hooks_worker_dispatch` |
| Status/performance | `system_status`, `performance_benchmark`, `performance_profile` |

Use AIDefence or other plugin tools only when the live registry reports them configured and reachable. Do not invent Hive-Mind, federation, workflow, claims, or session interfaces; discover the exact installed tool first.

**ruflo-managed:memory:v2**

## Memory & Learning

Memory is optional context, not a delivery gate. Use native Ruflo MCP/AgentDB tools for store, search, retrieve, recall, list, delete, statistics, diagnosis, and verification.

- Never open managed memory through direct SQL, `sqlite3`, `sql.js`, raw file reads/writes, or whole-image operations.
- A live `memory.db-wal` is expected while a native owner is active. Never checkpoint, delete, rename, replace, or unlink database sidecars.
- If recall fails or is safely refused, report it once and continue from repository/source evidence. Do not force a second driver or claim an empty result is healthy.
- Before relevant work, use `memory_search` / `memory_search_unified` and `hooks_route` when available.
- After a validated success, use `memory_store` and `hooks_post_task` when the result is genuinely reusable.
- Dispatch background work through `hooks_worker_dispatch` only after discovering its current schema and confirming that a worker is appropriate.

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
- Codex instructions live in `AGENTS.md`. Trusted projects may also have `.codex/config.toml`; approval and sandbox policy are user-owned. Do not generate, overwrite, or weaken them.

## Links

- Documentation: https://github.com/ruvnet/ruflo
- Issues: https://github.com/ruvnet/ruflo/issues
