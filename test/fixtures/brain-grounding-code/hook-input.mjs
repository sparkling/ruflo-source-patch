// Verbatim native Brain 4.5.2 event parser and its host normalization dependencies.
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
export function normalizePayloadText(raw) {
  const ev = (() => { try { const j = JSON.parse(raw); return j && typeof j === 'object' ? j : null; } catch { return null; } })();
  return ev && isGrokEvent(ev) ? JSON.stringify(normalizeHostEvent(ev)) : raw;
}

/** Parse the raw stdin payload into the hook event object (Claude-shaped), or null if it isn't valid JSON. */
export function parseHookEvent(raw) {
  try {
    const j = JSON.parse(raw);
    return j && typeof j === 'object' ? normalizeHostEvent(j) : null;
  } catch {
    return null;
  }
}

