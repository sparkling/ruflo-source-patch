export function conditionNotice({ swarm, session, condition, message, now = Date.now }) {
  const file = path.join(swarm, NOTICE_STATE);
  let state = {};
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* first notice */ }
  const id = String(session || 'unknown');
  const shown = Array.isArray(state[id]?.conditions) ? state[id].conditions : [];
  if (shown.includes(condition)) return '';
  state[id] = { at: new Date(now()).toISOString(), conditions: [...shown, condition] };
  const recent = Object.entries(state).sort((a, b) => String(b[1]?.at).localeCompare(String(a[1]?.at))).slice(0, 20);
  try { fs.writeFileSync(file, JSON.stringify(Object.fromEntries(recent)), { mode: 0o600 }); } catch { /* still show it once */ }
  return message;
}
export function stopNotice({ journal, status, session }) {
  if (!status?.stuck || !status.problem) return '';
  return conditionNotice({ swarm: journal.swarm, session, condition: status.problem, now: () => journal.now(),
    message: `[RuvNet Brain] ${recordingLine(status, journal.now())}` });
}
function defaultStore() {}
