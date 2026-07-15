# ADR-011: dual-codex-claude: one canonical instruction file, no drift

**Status**: accepted
**Date**: 2026-07-14
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
tool's commit-template caveat, `claude mcp add`).

Shipped as a script (`ruflo-add-codex.sh` for an existing project, `ruflo-new-dual.sh` from scratch) rather
than a source patch, because it produces PROJECT files, not vendor files. It also works around the missing
`@claude-flow/codex` package (uses `npx --yes`, which fetches on demand rather than aborting), the Codex stub
skills, and the root `.gitignore` not covering `.env`.

## Consequences

### Positive

- Shared instructions live ONCE. Edit them in `AGENTS.md` and both platforms see the change. No drift.
- A single command produces a working dual project, which `ruflo init` cannot.
- `.env` is reliably gitignored, closing a secret-leak path.

### Negative

- `codex init` runs `codex mcp add ruflo`, which writes to the user's GLOBAL `~/.codex/config.toml`. That is
  a side effect outside the project, and it is documented in the script header rather than suppressed.

### Neutral

- The ordering inside the script is load-bearing and was established by direct test: memory init must
  complete before the daemon starts.

## Links

- Upstream: [#2635](https://github.com/ruvnet/ruflo/issues/2635), [#2636](https://github.com/ruvnet/ruflo/issues/2636), [#2637](https://github.com/ruvnet/ruflo/issues/2637), [#2638](https://github.com/ruvnet/ruflo/issues/2638)
- `lib/dual/`
