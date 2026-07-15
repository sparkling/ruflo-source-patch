// Dispatch for the `mcp-prefix` target — rewrites the ruflo plugins' bundled MCP tool references from
// `mcp__claude-flow__*` to the plugin-namespaced `mcp__plugin_ruflo-core_ruflo__*` (ruvnet/ruflo#2685).
// See patcher.mjs. The install/uninstall/status flow and the shared composition engine live in
// ../plugin-command.mjs (ADR-020) — so this sweep composes with adr-template/adr-index on a shared file
// instead of corrupting their backup.

import { runPluginCommand } from '../plugin-command.mjs';

export const mcpPrefixCommand = (action) => runPluginCommand('mcp-prefix', action);
