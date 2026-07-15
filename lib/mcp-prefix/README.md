# `mcp-prefix`

Rewrites the ruflo plugins' bundled MCP tool references from the legacy standalone prefix
`mcp__claude-flow__*` to the plugin-namespaced form `mcp__plugin_ruflo-core_ruflo__*`
([ruvnet/ruflo#2685](https://github.com/ruvnet/ruflo/issues/2685)).

## The bug

Every `ruflo` Claude Code plugin bundles skills, agents, commands and hooks that name the MCP tools
`mcp__claude-flow__<tool>`. That prefix resolves only when the server is registered **standalone** under
the key `claude-flow` (`claude mcp add claude-flow …`, [#2206](https://github.com/ruvnet/ruflo/issues/2206)).
When ruflo is used **as a plugin** (the marketplace install path), Claude Code namespaces the plugin's own
bundled MCP server, so the same tools are exposed as `mcp__plugin_ruflo-core_ruflo__<tool>`. Per Claude
Code's [MCP reference](https://code.claude.com/docs/en/mcp): *"A hook matcher written against the bare
server key … never fires for a plugin-bundled server."*

So under plugin loading the bundled `allowed-tools` globs grant nothing (every call needs manual approval)
and prompt-embedded tool names name tools that don't exist. The platform won't bridge it:
[anthropics/claude-code#29360](https://github.com/anthropics/claude-code/issues/29360) and
[#15145](https://github.com/anthropics/claude-code/issues/15145) are both **closed as not planned**.

## Why a uniform replacement is correct

Measured on a current install: **3,482 occurrences across 474 files in ~30 `ruflo-*` packages**. Only
`ruflo-core` ships an `.mcp.json` (server key `ruflo`); no other plugin ships its own. So every reference
resolves to that one server, and the plugin-namespaced name for all of them is uniformly
`mcp__plugin_ruflo-core_ruflo__<tool>`. The edit is a single literal applied to every occurrence
(ADR-001's `all` case), not a per-site anchor table.

## Safety

- Only touches files **under the `ruflo` plugin trees**, which load only when the plugin is enabled. When
  it's enabled, the plugin-namespaced prefix is the one that resolves, so the rewrite is correct where it
  takes effect and inert where the plugin isn't loaded.
- Same pristine-backup discipline as every other target: back up to `<file>.rsp-backup` first, restore
  byte-for-byte on `uninstall`, re-baseline when a `/plugin update` lands a fresh copy, refuse an empty file
  or a poisoned (empty) backup.
- Scoped to the `ruflo` marketplace only; forks under other marketplace names are out of scope by design.
- A **plugin** target, so the SessionStart hook and the monitor re-apply it. A `/plugin update` otherwise
  restores the bare refs silently.

## Usage

```bash
npx github:sparkling/ruflo-source-patch mcp-prefix install
npx github:sparkling/ruflo-source-patch mcp-prefix status
npx github:sparkling/ruflo-source-patch mcp-prefix uninstall
```

## Not in scope

The CLI init generators (`settings-generator.js`, `mcp-generator.js`) emit the same bare prefix into **user
project** files. Those serve projects where the plugin may be off and the standalone `claude-flow`
registration is correct, so the prefix there is genuinely environment-dependent. Out of scope, and not a
gap. This target fixes the plugin-native path Claude Code's own docs prescribe.
