# ADR-018: mcp-prefix: rewrite bundled tool refs to the plugin-namespaced form

**Status**: accepted
**Date**: 2026-07-15
**Updated**: 2026-07-15 (ADR-020): the sweep crossed files adr-template/adr-index own and corrupted their shared backup; discovery is now a positive prefix signal and overlaps compose from one pristine.
**Deciders**: Henrik Pettersen
**Tags**: patch-target, plugin, mcp

## Context

Every `ruflo` Claude Code plugin bundles skills, agents, commands and hooks that name the MCP tools
`mcp__claude-flow__<tool>`. That prefix only resolves when the server is registered STANDALONE under the
key `claude-flow` (`claude mcp add claude-flow …`, ruvnet/ruflo#2206). When ruflo is used AS A PLUGIN (the
marketplace install path), Claude Code namespaces the plugin's own bundled MCP server, so the same tools
are exposed as `mcp__plugin_ruflo-core_ruflo__<tool>`. Claude Code's MCP reference is explicit: "A hook
matcher written against the bare server key … NEVER fires for a plugin-bundled server." So under plugin
loading the bundled `allowed-tools` globs grant nothing (every call needs manual approval), and
prompt-embedded tool names name tools that do not exist.

The platform will NOT bridge this. anthropics/claude-code#29360 (plugin namespacing breaks `allowed-tools`)
and #15145 (servers wrongly namespaced under the plugin) are both CLOSED AS NOT PLANNED, and #27105 (ship a
plugin MCP server default-disabled) is open, so you cannot even ship the skills without the server. The fix
has to live in the plugin content.

Measured on a current install: **3,482 occurrences across 474 files in ~30 `ruflo-*` packages**. Only
`ruflo-core` ships an `.mcp.json` (server key `ruflo`); no other plugin ships its own server. So every
reference resolves to that ONE server, and the plugin-namespaced name for all of them is uniformly
`mcp__plugin_ruflo-core_ruflo__<tool>`.

This is NOT the standalone `claude-flow` registration path (ADR-011's `dual` template, #2206). That path
keeps the bare refs working by registering a second server, but running the plugin's server AND a standalone
`claude-flow` server against one project root is two writers on one `memory.db` (ADR-006, #2621). This target
fixes the plugin-native path instead, which Claude Code's own docs prescribe ("use the full name").

## Decision

Add a `mcp-prefix` PLUGIN target that rewrites `mcp__claude-flow__` to `mcp__plugin_ruflo-core_ruflo__`
across the bundled text files under the `ruflo` marketplace's plugin trees
(`~/.claude/plugins/cache/ruflo/**`, `~/.claude/plugins/marketplaces/ruflo/**`).

- **One literal, applied to every occurrence** (ADR-001's `all` case), never a per-site anchor table:
  the replacement is uniform because there is exactly one server. `REPLACEMENT` does not contain `ANCHOR`,
  so `patchOnly` is idempotent and re-baseline recognises our own output.
- **Recursive discovery** over the two ruflo roots, filtered to known text extensions, including files that
  already carry a `.rsp-backup` so `status`/`restore` still see a patched file after the anchor is gone.
- **Same pristine-backup discipline** as the other plugin targets (ADR-001): back up before writing, restore
  byte-for-byte on uninstall, re-baseline when a `/plugin update` lands a fresh copy, refuse an empty file or
  a poisoned (empty) backup.
- A PLUGIN target, not a script one, because the files live inside someone else's plugins: a `/plugin update`
  re-fetches them and silently restores the bare refs, so the SessionStart hook and the monitor must re-apply
  it, exactly like the other plugin targets.

## Consequences

### Positive

- Under plugin loading, the bundled `allowed-tools`, subagent `tools`, hook matchers and prompt tool names
  resolve, with no separate standalone registration and therefore no second server per root.
- Correct wherever it takes effect and inert where it doesn't: the files only load when the plugin is
  enabled, and then the plugin-namespaced prefix is the one that resolves.
- Fully reversible: `uninstall` restores byte-identical originals.

### Negative

- The widest blast radius of any target: ~474 files across ~30 packages, so ~474 `.rsp-backup` files, and
  the monitor walks the ruflo plugin trees each tick. Steady state is a scan plus byte-compares, no writes.
- A blanket literal replace also rewrites `mcp__claude-flow__` inside prose, comments and a plugin's own test
  fixtures. Functionally harmless (the plugin-namespaced name is the accurate one), but broader than the
  `allowed-tools`/matcher fields Claude Code's docs strictly require.
- It patches authored plugin CONTENT, so an upstream rewording is a `/plugin update` away; the monitor
  re-applies, and the byte-check reports honestly.

### Neutral

- Does not touch the CLI init generators (`settings-generator.js`, `mcp-generator.js`) that emit the same
  bare prefix into USER project files: those serve projects where the plugin may be OFF and the standalone
  `claude-flow` registration is correct, so that prefix is genuinely environment-dependent and out of scope.
- Superseded the moment upstream fixes ruvnet/ruflo#2685 (bundled refs become namespace-agnostic or
  plugin-prefixed); the anchor stops matching and `status` reports `0` to patch.

## Links

- Upstream: [ruvnet/ruflo#2685](https://github.com/ruvnet/ruflo/issues/2685)
- Platform (won't-fix): [anthropics/claude-code#29360](https://github.com/anthropics/claude-code/issues/29360), [#15145](https://github.com/anthropics/claude-code/issues/15145), [#27105](https://github.com/anthropics/claude-code/issues/27105)
- [ADR-001](ADR-001-source-patch-by-literal-anchors.md), [ADR-006](ADR-006-memory-write-lock-and-wal-coherent-reads.md), [ADR-011](ADR-011-dual-codex-claude-single-source.md)
- `lib/mcp-prefix/`
