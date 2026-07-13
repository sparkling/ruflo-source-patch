// The problem record: what the monitor found, so the notifier can tell you about it.
//
// WHY A FILE. The monitor runs as a detached scheduled job — it has no way to reach your
// session. It can only leave a note. Previously that note was a line in monitor.log, which
// is a note nobody reads. This one is picked up by a UserPromptSubmit hook and surfaced on
// your next prompt, so the worst case between "patch broke" and "you know" is one monitor
// tick (default 5 min) plus one keystroke.
//
// RATE-LIMITED, because a warning shown on every single prompt is a warning you learn to
// scroll past. Re-announce only when the problem set CHANGES, or after a quiet period.

import fs from 'node:fs';
import { PROBLEMS_PATH, NOTIFY_STATE_PATH, STABLE_DIR } from './paths.mjs';

const REANNOUNCE_MS = 30 * 60 * 1000; // 30 min

const signatureOf = (problems) => problems.slice().sort().join('\n');

/** Called by the monitor / hook after re-applying. Records problems, or clears the record. */
export function recordProblems(problems) {
  try {
    if (!problems.length) {
      fs.rmSync(PROBLEMS_PATH, { force: true }); // fixed itself (e.g. we re-anchored) — say nothing
      return;
    }
    fs.mkdirSync(STABLE_DIR, { recursive: true });

    // Preserve `shownAt` when the problem set is unchanged, so an unchanged problem doesn't
    // re-announce on every tick — but a NEW problem always announces immediately.
    let shownAt = 0;
    try {
      const prev = JSON.parse(fs.readFileSync(PROBLEMS_PATH, 'utf8'));
      if (prev.signature === signatureOf(problems)) shownAt = prev.shownAt || 0;
    } catch { /* no prior record */ }

    fs.writeFileSync(PROBLEMS_PATH, `${JSON.stringify({
      at: new Date().toISOString(),
      signature: signatureOf(problems),
      problems,
      shownAt,
    }, null, 2)}\n`);
  } catch { /* best-effort; a notifier must never break the thing it watches */ }
}

/** Called by the notifier hook. Returns the problems to announce now, or []. */
export function takeProblemsToAnnounce(now = Date.now()) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(PROBLEMS_PATH, 'utf8')); } catch { return []; }
  if (!rec?.problems?.length) return [];

  const due = !rec.shownAt || (now - rec.shownAt) > REANNOUNCE_MS;
  if (!due) return [];

  try {
    fs.writeFileSync(PROBLEMS_PATH, `${JSON.stringify({ ...rec, shownAt: now }, null, 2)}\n`);
  } catch { /* if we can't record it, better to re-announce than to go quiet */ }

  return rec.problems;
}

// Same rate-limit discipline, for warnings computed LIVE in the hook rather than recorded by
// the monitor. Monitor-health is exactly that: if the monitor is dead it cannot leave us a
// note about being dead, so the hook has to work it out for itself — and then not nag.
export function takeLiveToAnnounce(kind, items, now = Date.now()) {
  if (!items.length) {
    try {
      const st = JSON.parse(fs.readFileSync(NOTIFY_STATE_PATH, 'utf8'));
      delete st[kind];
      fs.writeFileSync(NOTIFY_STATE_PATH, `${JSON.stringify(st, null, 2)}\n`);
    } catch { /* nothing recorded */ }
    return [];
  }

  const signature = signatureOf(items);
  let st = {};
  try { st = JSON.parse(fs.readFileSync(NOTIFY_STATE_PATH, 'utf8')); } catch { /* first time */ }

  const prev = st[kind];
  const due = !prev || prev.signature !== signature || (now - (prev.shownAt || 0)) > REANNOUNCE_MS;
  if (!due) return [];

  try {
    fs.mkdirSync(STABLE_DIR, { recursive: true });
    st[kind] = { signature, shownAt: now };
    fs.writeFileSync(NOTIFY_STATE_PATH, `${JSON.stringify(st, null, 2)}\n`);
  } catch { /* re-announcing beats going quiet */ }

  return items;
}
