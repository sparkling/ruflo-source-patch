# `lib/dual/`

[← ruflo-source-patch](../../README.md)

The script targets. **These are the only things here that don't patch anything.** They fix *your projects*,
not the library. `install` just materializes them to `~/.ruflo-source-patch/<target>/`; you run them by hand.

## Contents

- [Why `status` byte-compares them](#why-status-byte-compares-them)
- [`dual`](#dual)
- [`dedupe`](#dedupe)

## Why `status` byte-compares them

No patching, no hook, nothing re-applies them. So `status` compares the installed copies against the
packaged ones byte for byte. It used to report `installed` on the entry file merely *existing*, so a copy
that had drifted from the package was indistinguishable from a current one.

## `dual`

One instruction file, two agents.

`ruflo init` writes `CLAUDE.md`. `codex init` writes `AGENTS.md`. They **diverge immediately**
([#2638](https://github.com/ruvnet/ruflo/issues/2638), [#2636](https://github.com/ruvnet/ruflo/issues/2636)).

### The model

One canonical file. No symlinks, no duplication.

- **`AGENTS.md`** is the single source of truth. Codex reads it directly.
- **`CLAUDE.md`** is literally `@AGENTS.md`, plus a short Claude-only overlay.

Edit the shared bulk once; both platforms see it. Each platform's unique bits live only in the file that
platform reads. Nothing to keep in sync, so nothing drifts.

### The scripts

| Script | For |
|---|---|
| `ruflo-new-dual.sh <dir>` | a **fresh** dual project |
| `ruflo-add-codex.sh [dir]` | converting an **existing** ruflo/Claude Code project |

`ruflo-new-dual.sh` uses the **default** `ruflo init` preset (`--with-embeddings`), not `--full`. Note the
default **still bundles** the plugin-duplicated `.claude/{skills,commands,agents}` (~196 files, verified
against `@claude-flow/cli` 3.28.0 on 2026-07-15). `--full` just adds more, and either way `dedupe` is
needed afterward. It also uses `npx --yes` so a missing `@claude-flow/codex` doesn't abort the whole init
([#2635](https://github.com/ruvnet/ruflo/issues/2635)), and gitignores the root `.env` that `ruflo init`
leaves **tracked** ([#2637](https://github.com/ruvnet/ruflo/issues/2637)).

`templates/` holds the `AGENTS.md` / `CLAUDE.md` bodies both scripts write.

Both scripts also **register `ruvnet-brain`'s MCP server for Codex** when that plugin is installed, because
its own installer never does. ruvnet-brain ships a working MCP server (`search_ruvnet`), a `.codex/`
directory, 5 skills and 4 commands, and wires **none** of it to Codex: all 21 `codex` references in its
`bin/install.mjs` merely *read* `~/.codex/auth.json` to classify the user's subscription for cost-routing,
and nothing ever writes `~/.codex/config.toml`. So on a Codex host the brain is entirely absent while
`--doctor` still reports "Grounding PROVEN", which is true for Claude Code and silent about Codex
([ruvnet-brain#42](https://github.com/stuinfla/ruvnet-brain/issues/42)).

Its own `plugin/.mcp.json` cannot be reused verbatim: it uses `${CLAUDE_PLUGIN_ROOT}`, a Claude Code
variable Codex does not expand, so the absolute path is resolved instead. The **marketplace** checkout is
preferred over `plugins/cache/<version>/`, whose path changes on every `/plugin update` and would leave a
stale absolute path behind after each upgrade. Idempotent, skipped when the plugin is absent, never fatal.

## `dedupe`

Delete what the plugins already give you.

**Every** `ruflo init` bundles the `.claude/{skills,commands,agents}` files, default preset included, not
just `--full` (~**196** files on default, ~**260** on `--full`). ~**100%** of the agents and commands and
~**97%** of the skills are **already provided by the installed `ruflo/*` plugins**
([#2640](https://github.com/ruvnet/ruflo/issues/2640)). The project `settings.json` also registers lifecycle
hooks. The ones for events the plugin `hooks.json` also defines (`PreToolUse`, `PostToolUse`, `PreCompact`)
**fire twice** on POSIX, because the plugin's `ruflo-hook.sh` is authoritative and the local copies are only
the Windows-override path ([#2132](https://github.com/ruvnet/ruflo/issues/2132)).

It also removes a duplicate **MCP registration**: `ruflo init` writes a project-local `.mcp.json` standalone
ruflo server, but the `ruflo-core` plugin already provides it, so the project copy is a second writer on one
`.swarm/memory.db` ([#2621](https://github.com/ruvnet/ruflo/issues/2621)). dedupe strips it (by command
*signature*, keeping `ruv-swarm` / `flow-nexus`; the file is deleted if it empties) from **both** channels
(the project `.mcp.json` and `~/.claude.json`'s `projects[<dir>].mcpServers`, where an `ssh` **remote** is a
real capability, not a duplicate, and is kept). By **default** it also SIGTERMs its now-orphaned process,
guarded like [`cleanup`](../cwd/README.md). Only a process whose real cwd is inside the project AND whose env
carries the removed entry's `CLAUDE_FLOW_*` marker is signalled, so the plugin server (same command) is never touched.

```bash
ruflo-dedupe-bundle.sh <project-dir> [--keep-dup-hooks|--keep-dup-mcp|--keep-server|--bundle-only] [--dry-run]
```

By **default** it removes the bundle, strips the duplicate hooks (EVENT-AWARE: only the events the plugins
actually provide), removes the standalone MCP registration and stops its server. `--keep-dup-hooks` skips the
hook step, `--keep-dup-mcp` leaves `.mcp.json` alone, `--keep-server` leaves the process running, and
`--bundle-only` does the `.claude` bundle only.

### Conservative by construction

- A bundle item is removed **only when a plugin actually provides it**; project-unique items are kept.
- A hook is stripped **only for events the plugin `hooks.json` also defines**. `UserPromptSubmit` (routing),
  `SessionStart/End`, `Subagent*`, `Notification`, and the auto-memory hooks are **kept** (no plugin replaces them).
- The MCP server is removed **only when the plugin actually provides one**, matched by command signature so a
  server keyed `ruflo` that runs something else is safe. The process is stopped **only** on the two guards
  (cwd inside the project + the removed entry's env marker); no marker means it can't be told apart from the
  plugin server, so nothing is killed and it says so.
- **`.claude/helpers/` is never touched**. `ruflo init` writes all ~43 of them, and no plugin replaces them.
- Removals are backed up first (or rely on git with `--no-backup`).
Start with `--dry-run`.
