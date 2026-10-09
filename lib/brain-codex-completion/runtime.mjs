// Injected into Brain's existing completion-claim-evidence.mjs. No transcript code is executed.
export function codexTurnEvents(lines) {
  let turnId = null;
  let records = [];
  let malformed = false;
  for (const line of lines || []) {
    if (!String(line).trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { malformed = true; continue; }
    const p = row?.payload;
    if (row.type === 'event_msg' && p?.type === 'task_started') {
      turnId = typeof p.turn_id === 'string' && p.turn_id ? p.turn_id : null;
      records = []; malformed = false;
    } else if (turnId) records.push(row);
  }
  // A bounded tail without its native turn boundary cannot prove freshness.
  if (!turnId || malformed) return null;
  const events = [];
  const seen = new Set();
  const pending = new Set();
  const passive = new Set(['AgentMessage', 'UserMessage', 'Reasoning', 'ContextCompaction', 'Plan']);
  for (const row of records) {
    const p = row.payload;
    if (row.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(p?.type)) {
      if (!p.call_id || pending.has(p.call_id)) return null;
      pending.add(p.call_id);
    } else if (row.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(p?.type)) {
      pending.delete(p.call_id);
    }
    if (row.type !== 'event_msg' || p?.type !== 'item_completed') continue;
    if (p.turn_id !== turnId) continue;
    const item = p.item;
    if (!item || passive.has(item.type)) continue;
    if (typeof item.id !== 'string' || seen.has(item.id)) return null;
    seen.add(item.id);
    const start = p.started_at_ms, end = p.completed_at_ms;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
    const change = what => events.push({ kind: 'change', what, start, end });
    if (item.type !== 'CommandExecution') {
      // FileChange, agents, MCP and unknown native tools may mutate state. No inferred success.
      change(item.type || 'unsupported native item');
      continue;
    }
    const argv = item.command;
    const command = typeof argv === 'string' ? argv
      : Array.isArray(argv) && argv.length === 3 && /(?:^|\/)(?:ba|z|da)?sh$/.test(argv[0])
        && /^-[a-z]*c$/.test(argv[1]) ? argv[2] : null;
    if (typeof command !== 'string' || !command.trim()) return null;
    // Reuse native mutation/trivial classification, but accept only recognizable check commands.
    // A shell script, inline code, pipe or compound command is not proved read-only here.
    const simple = !/[\n;|&<>`]|\$\(/.test(command);
    const check = simple && !segmentMutates(command) && (
      /^(?:npm|pnpm|yarn)\s+(?:test|run\s+(?:test(?::[\w-]+)?|lint(?::[\w-]+)?|check(?::[\w-]+)?))\b/.test(command)
      || /^node\s+(?:--test\b|--check\b)/.test(command)
      || /^(?:python3?\s+-m\s+)?pytest\b/.test(command)
    ) && !/\s(?:--fix|--write|--updateSnapshot|-u)\b/.test(command);
    if (check) {
      events.push({ kind: 'check', what: command.slice(0, 120), name: checkName(command), start, end,
        present: typeof item.aggregated_output === 'string' && item.aggregated_output.trim().length > 0,
        error: item.status !== 'completed' || item.exit_code !== 0 });
    } else if (!(simple && TRIVIAL.test(command) && !segmentMutates(command))) change(command.slice(0, 120));
  }
  if (pending.size || !events.length) return null;
  // Concurrent checks that began before the final mutation completed are stale evidence too.
  const lastChangeEnd = Math.max(-Infinity, ...events.filter(e => e.kind === 'change').map(e => e.end));
  events.sort((a, b) => a.end - b.end);
  for (const e of events) if (e.kind === 'check' && e.start <= lastChangeEnd) e.error = true;
  const latest = new Map();
  for (const e of events) if (e.kind === 'check') {
    if (latest.has(e.what)) latest.get(e.what).error = true;
    latest.set(e.what, e);
  }
  return { boundaryFound: true, events };
}

export function readCodexTurn(transcriptPath, { read = readSettledTranscript } = {}) {
  if (typeof transcriptPath !== 'string' || !/\.jsonl$/i.test(transcriptPath)) return null;
  try { return codexTurnEvents(read(transcriptPath, { maxMs: 0 })); } catch { return null; }
}
