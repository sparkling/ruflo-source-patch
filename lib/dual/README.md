# `lib/dual/`

[← ruflo-source-patch](../../README.md)

The script targets. **These are the only things here that don't patch anything.** They fix *your projects*,
not the library. `install` just materializes them to `~/.ruflo-source-patch/<target>/`; you run them by hand.

## Contents

- [Why `status` byte-compares them](#why-status-byte-compares-them)
- [`dual`](#dual)
- [`ruflo-codex-hooks`](#ruflo-codex-hooks)
- [`codex-switch`](#codex-switch)
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
needed; the fresh-project script runs it by default and `--no-dedupe` opts out. The Codex conversion fetches the exact audited
`@claude-flow/codex@3.0.1` adapter with `npx --yes`, so a missing local adapter package does not abort
the whole init ([#2635](https://github.com/ruvnet/ruflo/issues/2635)).

`templates/` holds the `AGENTS.md` / `CLAUDE.md` bodies both scripts write.

The adapter runs behind a private, failing `codex` shim. It therefore cannot add, replace, or remove the
user's real `ruflo` MCP registration. After initialization, the wrapper calls the Codex executable it
resolved before installing the shim and runs `mcp add` only when the **user-global** registry says the
exact entry is absent. `-C` selects the CLI invocation cwd; it does not make the registry entry
project-scoped or store a fixed server `cwd`.

The scripts do **not** install `.codex/skills/*/skill.toml`: that shape was inferred from a
MetaHarness-local convention, not a Codex discovery contract, and is inert. An upgrade removes only the
four byte-exact project manifests this package historically shipped, plus the obsolete package-owned
materialized `codex-skills` directory. Customized files are preserved.

The conversion treats `.agents/config.toml`, `.codex/AGENTS.override.md`, `.codex/config.toml`, and
`.gitignore` as user-owned adapter boundaries. Pre-existing bytes are restored exactly and
adapter-created copies are removed. `AGENTS.md` and `CLAUDE.md` have the same rollback guarantee on
adapter failure or interruption; the adapter runs in a separate process group, so descendants are
stopped before restoration. Supported `.agents/skills` written before an adapter failure may remain.
Only a successful conversion replaces the instruction files with the templates. Symlinked protected
ancestors and instruction-backup destinations are refused. After restoration, the wrapper preserves existing
`.gitignore` rules and appends only its marker-owned `.env`, runtime, and `*.bak` entries. Claude's MCP
server remains owned by the installed `ruflo-core` plugin rather than a second standalone registration.

## `ruflo-codex-hooks`

One-shot repair for an existing Codex installation ([ruvnet/ruflo#2801](https://github.com/ruvnet/ruflo/issues/2801)):

```bash
npx github:sparkling/ruflo-source-patch ruflo-codex-hooks run
```

It registers the canonical `ruvnet/ruflo` marketplace and installs `ruflo-core@ruflo` through Codex's
plugin CLI. It preserves disabled and unrelated plugin state, refuses a marketplace-name collision, and
never invokes `codex mcp`. Ruflo v3.32.24 / `@claude-flow/codex` 3.0.2 handles new initializations
upstream; this script remains for systems initialized earlier.

## `codex-switch`

Continue ONE Codex resume ID while changing which account pays for it ([ADR-030](../../docs/adr/ADR-030-codex-switch-one-resume-id-across-providers.md)):

```bash
npx github:sparkling/ruflo-source-patch codex-switch run status
npx github:sparkling/ruflo-source-patch codex-switch run copilot
```

Three files: `codex-switch.sh` (the `bash` entry every script target needs), `codex-switch.mjs` (CLI,
locking, the boundary decision, launch) and `codex-switch-core.mjs`, which is the part that must never
lose history: rollout analysis, sanitization, backup and restore. `codex-switch-profile.toml` is a
template you copy to `~/.codex/copilot.config.toml`; it is not installed, because it is user-level
Codex config naming a proxy endpoint.

The whole design is one rule: **the visible thread is untouchable.** Only provider-private encrypted
replay items may be dropped, only at a provider boundary, only after the original is backed up and the
backup's SHA-256 verified, and only if a re-analysis afterwards shows the same UUID, the same visible
record counts and the same retained-content hash. Anything else restores the backup and aborts.

Two things it refuses that look like they should "just work", both because succeeding would be worse:
an **active** session (a held writer lock; exit Codex first), and an **undefined** Copilot profile.
Codex silently ignores an unknown `--profile` and falls back to the subscription, so a missing profile
would otherwise mean a Copilot switch that quietly bills the subscription account and reports success.

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
