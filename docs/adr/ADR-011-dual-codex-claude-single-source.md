# ADR-011: dual-codex-claude: one canonical instruction file, no drift

**Status**: accepted
**Date**: 2026-07-14 (corrected 2026-07-25)
**Deciders**: Henrik Pettersen
**Tags**: script-target, dual, codex

## Context

`ruflo init --dual` produces a Codex-primary layout: `AGENTS.md` canonical, a thin `CLAUDE.md` stub, and NO
`.claude/` scaffold and no `.mcp.json`. The two init branches are mutually exclusive (an unconditional early
return), so there is no single command that produces a full native setup for BOTH harnesses.

The naive fix, duplicating the instructions into both files, guarantees drift: two files that must say the
same thing, edited independently, diverging silently.

## Decision

`AGENTS.md` is the ONE canonical instruction file, shared bulk plus Codex-specific notes; Codex reads it
directly. `CLAUDE.md` is `@AGENTS.md` (Claude Code imports the shared bulk) plus a SMALL Claude-only overlay.

The rule: anything that would ALSO be true under Codex belongs in `AGENTS.md`. Only what has no bearing on
Codex stays in `CLAUDE.md` (skill syntax, the `Agent`/`SendMessage` tools, the Claude model tiers, the Bash
tool's commit-template caveat, and the plugin-owned Claude setup).

Shipped as a script (`ruflo-add-codex.sh` for an existing project, `ruflo-new-dual.sh` from scratch) rather
than a source patch, because it produces PROJECT files, not vendor files. It fetches the exact audited
`@claude-flow/codex@3.0.1` package with `npx --yes`, rather than depending on a local adapter install or
silently accepting a future adapter release, and defaults away from the Codex stub-skill templates.

The Codex adapter release audited on 2026-07-25 generated three project files that are not valid
ownership surfaces for this script: inert `.agents/config.toml`, inert
`.codex/AGENTS.override.md`, and an effective `.codex/config.toml` that changed approval and sandbox
policy to `never` / `danger-full-access`. It also changed `.gitignore`, rewrote both instruction files,
and invoked `codex mcp add ruflo`.

The conversion now treats those side effects as a transaction. It snapshots the four user-owned
adapter surfaces plus `AGENTS.md` and `CLAUDE.md`, refuses symlinked protected paths and ancestors, and
runs the adapter with a failing private `codex` shim. The adapter runs in its own process group, so an
interruption terminates and waits for descendants before restoration. Existing instruction-backup
symlinks are refused as well. On failure or interruption it restores all pre-existing protected bytes
and removes adapter-created protected files; supported `.agents/skills` produced before an adapter
failure may remain. On success, only then are the two instruction templates written. The real Codex executable, resolved before the shim and called with
`-C <project>`, checks `mcp get ruflo` and adds the exact entry only when absent. Existing registry
entries are never used as an update target.

The wrapper removes the adapter's `.gitignore` rewrite, then preserves every existing byte and appends
only its marker-owned `.env`, runtime, and `*.bak` rules. It no longer installs inferred
`.codex/skills/*/skill.toml` manifests and removes only byte-exact historical copies. The Brain MCP
fallback uses the same non-overwriting registry rule and only a marketplace `plugin/mcp/server.mjs`
that actually exists. It cannot repair a Brain npm artifact that omitted that file.

## Consequences

### Positive

- Shared instructions live ONCE. Edit them in `AGENTS.md` and both platforms see the change. No drift.
- A single command produces a working dual project, which `ruflo init` cannot.
- Existing Codex approval/sandbox policy and repository ignore rules are preserved even during a
  forced conversion.
- Root `.env` and generated backup/runtime paths receive explicit marker-owned ignore rules.
- Adapter failure and interruption restore the pre-run instruction files rather than leaving a partial
  conversion.
- A user-managed `ruflo` or `ruvnet-brain` MCP registration is preserved.
- No inferred `.codex/skills/*/skill.toml` manifests are installed; Codex discovery uses documented
  `SKILL.md` and MCP surfaces.

### Negative

- Registering an absent `ruflo` or legacy `ruvnet-brain` MCP entry remains a Codex-owned configuration
  side effect. The wrapper documents it, scopes the CLI call with `-C`, and never overwrites an existing
  exact name.
- The wrapper deliberately adds its small ignore block after restoring repository-owned bytes.

### Neutral

- The ordering inside the script is load-bearing and was established by direct test: memory init must
  complete before the daemon starts.

## Links

- Upstream: [#2635](https://github.com/ruvnet/ruflo/issues/2635), [#2636](https://github.com/ruvnet/ruflo/issues/2636), [#2637](https://github.com/ruvnet/ruflo/issues/2637), [#2638](https://github.com/ruvnet/ruflo/issues/2638)
- `lib/dual/`
