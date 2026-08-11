# ADR-011: dual-codex-claude: one canonical instruction file, no drift

**Status**: accepted
**Date**: 2026-07-14 (corrected 2026-07-25)
**Updated**: 2026-08-11. Ruflo 3.32.36/3.32.37 fixed #2634, #2635, #2636, and
#2637: native dual init now runs both initializers, fetches the adapter, emits canonical backed
skills, and protects root secrets. #2638 remains open: the two hosts still generate divergent
instruction sources, so this script remains the single-source and policy-preserving conversion.
The public `dual run <project>` route now selects the fresh initializer; the separately materialized
`ruflo-add-codex.sh` remains the explicit existing-project conversion.
**Deciders**: Henrik Pettersen
**Tags**: script-target, dual, codex

## Context

Older `ruflo init --dual` produced a Codex-primary layout: `AGENTS.md` canonical, a thin `CLAUDE.md` stub,
and no `.claude/` scaffold or `.mcp.json`. Ruflo 3.32.37 now runs both native initializers, fixing that
scaffold gap. It still leaves two independently generated instruction sources, so the drift problem below
remains.

The naive fix, duplicating the instructions into both files, guarantees drift: two files that must say the
same thing, edited independently, diverging silently.

## Decision

`AGENTS.md` is the ONE canonical instruction file, shared bulk plus Codex-specific notes; Codex reads it
directly. `CLAUDE.md` is `@AGENTS.md` (Claude Code imports the shared bulk) plus a SMALL Claude-only overlay.

The rule: anything that would ALSO be true under Codex belongs in `AGENTS.md`. Only what has no bearing on
Codex stays in `CLAUDE.md` (skill syntax, the `Agent`/`SendMessage` tools, the Claude model tiers, the Bash
tool's commit-template caveat, and the plugin-owned Claude setup).

Shipped as a script (`ruflo-add-codex.sh` for an existing project, `ruflo-new-dual.sh` from scratch) rather
than a source patch, because it produces PROJECT files, not vendor files. The public
`dual run <project>` command dispatches to `ruflo-new-dual.sh`; conversion remains an explicit call to
the materialized `ruflo-add-codex.sh`. It fetches the exact audited
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
failure may remain. On success, only then are the two instruction templates written. The real Codex
executable, resolved before the shim, checks Codex's user-global MCP registry and adds the exact entry
only when absent. `-C <project>` selects the CLI invocation working directory; it does not make the
registration project-scoped or persist a server `cwd`. Existing registry entries are never used as an
update target.

The wrapper removes the adapter's `.gitignore` rewrite, then preserves every existing byte and appends
only its marker-owned `.env`, runtime, and `*.bak` rules. It no longer installs inferred
`.codex/skills/*/skill.toml` manifests and removes only byte-exact historical copies.

## Consequences

### Positive

- Shared instructions live ONCE. Edit them in `AGENTS.md` and both platforms see the change. No drift.
- A single command produces a working dual project with one canonical instruction source; native
  `ruflo init --dual` now produces both host scaffolds but not that single-source contract.
- Existing Codex approval/sandbox policy and repository ignore rules are preserved even during a
  forced conversion.
- Root `.env` and generated backup/runtime paths receive explicit marker-owned ignore rules.
- Adapter failure and interruption restore the pre-run instruction files rather than leaving a partial
  conversion.
- A user-managed `ruflo` MCP registration is preserved.
- No inferred `.codex/skills/*/skill.toml` manifests are installed; Codex discovery uses documented
  `SKILL.md` and MCP surfaces.

### Negative

- Registering an absent `ruflo` MCP entry remains a Codex-owned, user-global configuration side
  effect. Each Codex host launches its own stdio child, which inherits that host's project cwd because
  the global definition stores no fixed `cwd`.
- The wrapper deliberately adds its small ignore block after restoring repository-owned bytes.

### Neutral

- The ordering inside the script is load-bearing and was established by direct test: memory init must
  complete before the daemon starts.

## Links

- Upstream: [#2635](https://github.com/ruvnet/ruflo/issues/2635), [#2636](https://github.com/ruvnet/ruflo/issues/2636), [#2637](https://github.com/ruvnet/ruflo/issues/2637), [#2638](https://github.com/ruvnet/ruflo/issues/2638)
- `lib/dual/`
