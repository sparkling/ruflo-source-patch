#!/usr/bin/env node
// plugin/scripts/hook-input.mjs — the ONE parser every PreToolUse gate uses to read Claude Code's
// hook event.
//
// WHY (2026-07-18, ADR-0021). Every gate hand-rolled a bash regex to pull fields out of the JSON
// payload: field() { local re="\"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\""; ... }. `([^"]*)` cannot
// cross a `"`, and a JSON-escaped `\"` is still a literal `"` byte in the raw text — so ANY command
// containing a quote was silently TRUNCATED at the first one. That fails OPEN on exactly the commands
// most worth inspecting (issue #13 fixed this in verify-interface.sh, but design-wall.sh — written
// AFTER — reintroduced the identical bug, because the fix lived in one file's inline `node -e` instead
// of a shared, tested module). JSON string escaping is not a regular language; only a real parser is
// correct. This is that parser, in ONE place, with ONE known-bad fixture test (hook-input.test.mjs),
// imported by every gate.
//
// CLI (what the bash gates call — mirrors the inline `node -e` they used to each carry):
//   printf '%s' "$INPUT" | node hook-input.mjs tool_name        -> prints event.tool_name
//   printf '%s' "$INPUT" | node hook-input.mjs command          -> prints tool_input.command (|| .command)
//   printf '%s' "$INPUT" | node hook-input.mjs field a.b.c      -> prints an arbitrary dotted path
//   printf '%s' "$INPUT" | node hook-input.mjs invocations a,b  -> one TAB-separated line per
//                                                                   EXECUTABLE invocation of any
//                                                                   named tool, anywhere in the
//                                                                   command: `tool<TAB>arg…`
//                                                                   (issues #12/#17/#41/#44)
//
// CONTRACT: prints "" and exits 0 on ANY parse failure or missing field. It NEVER throws to the caller
// and NEVER exits nonzero on bad input — a gate that breaks the shell protects nothing, so fail-open
// (empty string, exit 0) is the invariant. The gate decides policy from the (possibly empty) value.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── GROK CLI PAYLOADS (4.5) ──────────────────────────────────────────────────────────────────────
//
// Grok CLI runs Claude-format hooks (its docs: ~/.grok/docs/user-guide/10-hooks.md, "Hook Locations"
// and "Tool Name Aliases"), but its payload is not Claude's. Captured from grok 1.0.13
// (tests/fixtures/hook-payloads/grok/):
//   · event names are snake_case: hook_event_name "pre_tool_use", "stop", "user_prompt_submit";
//   · tool names are Grok's own: the measured file tool is `write` (docs also name `search_replace`,
//     and `run_terminal_command` / `run_terminal_cmd` for the shell);
//   · camelCase fields (hookEventName, toolName, toolInput, toolResult, stopHookActive,
//     lastAssistantMessage) with snake_case duplicates for SOME of them only — the Stop payload has no
//     `stop_hook_active` and no `last_assistant_message` at all.
// A Grok matcher written with Claude names still fires (Grok aliases Write→its tool in the MATCHER), but
// the payload keeps the native name — so every policy that compared tool_name to "Write" saw "write" and
// silently allowed. Normalising HERE, in the one parser, means every consumer reads Claude's shape.
// Only a payload that is recognisably Grok's is rewritten; a Claude or Codex payload comes back untouched.
export const GROK_TOOL_ALIASES = Object.freeze({
  write: 'Write', search_replace: 'Edit', edit: 'Edit', multi_edit: 'MultiEdit',
  run_terminal_command: 'Bash', run_terminal_cmd: 'Bash', read_file: 'Read', grep: 'Grep',
  list_dir: 'Glob', web_search: 'WebSearch', web_fetch: 'WebFetch', spawn_subagent: 'Task', task: 'Task',
});

/** True for a payload in Grok's shape (camelCase envelope, or a snake_case lowercase event name). */
export function isGrokEvent(ev) {
  if (!ev || typeof ev !== 'object') return false;
  if (typeof ev.hookEventName === 'string') return true;
  return typeof ev.hook_event_name === 'string' && /^[a-z]+(?:_[a-z]+)+$|^stop$/.test(ev.hook_event_name);
}

const pascalEvent = (e) => String(e).split('_').filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1)).join('');

/** Claude's tool name for a host tool name (Grok's `write` → `Write`); unknown names pass through. */
export function canonicalToolName(name) {
  const s = typeof name === 'string' ? name : '';
  return Object.prototype.hasOwnProperty.call(GROK_TOOL_ALIASES, s) ? GROK_TOOL_ALIASES[s] : s;
}

/**
 * Is this a FILE-WRITE tool, on any host? Case-insensitive, so a host that spells Write in another case
 * (Grok's `write`) can never walk past a write guard again. apply_patch is Codex's raw name.
 */
const WRITE_TOOLS = new Set(['write', 'edit', 'multiedit', 'multi_edit', 'notebookedit', 'search_replace', 'apply_patch']);
export function isWriteTool(name) {
  return typeof name === 'string' && WRITE_TOOLS.has(name.toLowerCase());
}

/** A Claude-shaped copy of a Grok payload; any other payload is returned as-is (same object). */
export function normalizeHostEvent(ev) {
  if (!isGrokEvent(ev)) return ev;
  const out = { ...ev };
  const set = (snake, camel) => { if (out[snake] === undefined && ev[camel] !== undefined) out[snake] = ev[camel]; };
  out.hook_event_name = pascalEvent(ev.hook_event_name || ev.hookEventName || '');
  set('session_id', 'sessionId');
  set('transcript_path', 'transcriptPath');
  set('permission_mode', 'permissionMode');
  set('tool_input', 'toolInput');
  set('tool_response', 'toolResult');
  set('tool_use_id', 'toolUseId');
  set('stop_hook_active', 'stopHookActive');
  set('last_assistant_message', 'lastAssistantMessage');
  const native = typeof ev.tool_name === 'string' ? ev.tool_name : (typeof ev.toolName === 'string' ? ev.toolName : undefined);
  if (native !== undefined) {
    out.tool_name = canonicalToolName(native);
    if (out.tool_name !== native) out.host_tool_name = native;
  }
  out.host = 'grok';
  return out;
}

/** The raw payload TEXT, rewritten to Claude's shape only when it is a Grok payload (else unchanged bytes). */
