// Brain #513: bounded first-attempt waiters, still only two executing stores.
// Reuse the existing process-birth/token gate. Bodies remain on stdin/in memory.
const helpers = String.raw`
function turnPendingWorkers(brainHome) {
  const dir = turnWorkerDir(brainHome, 'pending'), rows = [];
  for (let i = 0; i < 8; i++) {
    const slot = path.join(dir, 'slot-' + i);
    try {
      const held = turnWorkerSlotRecord(slot);
      if (turnWorkerOwnerDead(held)) { fs.unlinkSync(slot); continue; }
      if (!Number.isSafeInteger(held.at) || held.at < 0 || typeof held.token !== 'string')
        throw Error('Turn capture pending owner unknown');
      rows.push({ ...held, slot });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return rows.sort((a, b) => a.at - b.at || a.token.localeCompare(b.token));
}
async function turnWaitForExecution(job) {
  // Leave the native operation its own bounded budget. Waiting never opens a DB.
  const waitUntil = Math.min(job.deadlineMs, Date.now() + 60_000);
  while (Date.now() < waitUntil) {
    const admission = withTurnWorkerGate(job.brainHome, () => {
      const pending = turnPendingWorkers(job.brainHome);
      const own = pending.find(row => row.slot === job.slot && row.token === job.token && row.pid === process.pid);
      if (!own) throw Error('Turn capture pending ownership lost');
      // Executing workers retain their pending lease until their exact read ends.
      const dir = turnWorkerDir(job.brainHome, 'slots'), active = [], free = [];
      for (let i = 0; i < 2; i++) {
        const slot = path.join(dir, 'slot-' + i);
        try {
          const held = turnWorkerSlotRecord(slot);
          if (!turnWorkerOwnerDead(held)) { active.push(held.token); continue; }
          fs.unlinkSync(slot);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        free.push(slot);
      }
      if (!free.length || pending.filter(row => !active.includes(row.token))[0]?.token !== job.token) return null;
      const slot = free[0];
      turnWorkerWriteSlot(slot, { pid: process.pid, start: turnWorkerOwnStart, token: job.token }, true);
      return slot;
    });
    if (admission) return admission;
    await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(1, waitUntil - Date.now()))));
  }
  throw Error('Turn capture admission wait expired before dispatch');
}
`;

export function waitingHandoff(source) {
  const edits = [
    ['function launchFreshTurn(', helpers + '\nfunction launchFreshTurn('],
    ["const dir = turnWorkerDir(brainHome, 'slots');\n    for (let i = 0; i < 2; i++) {",
      "const dir = turnWorkerDir(brainHome, 'pending');\n    turnPendingWorkers(brainHome);\n    for (let i = 0; i < 8; i++) {"],
    ['{ pid: process.pid, start: turnWorkerOwnStart, token }, true);',
      '{ pid: process.pid, start: turnWorkerOwnStart, token, at: Date.now() }, true);'],
    ["throw Error('Turn capture worker capacity exhausted before dispatch');",
      "throw Error('Turn capture pending capacity exhausted before dispatch');"],
    ['job.deadlineMs > Date.now() + 30_000', 'job.deadlineMs > Date.now() + 90_000'],
    ["![0, 1].some(i => job.slot === path.join(job.brainHome, 'turn-capture', 'workers', 'slots', 'slot-' + i))",
      "!Array.from({ length: 8 }, (_, i) => i).some(i => job.slot === path.join(job.brainHome, 'turn-capture', 'workers', 'pending', 'slot-' + i))"],
    ['  try {\n    runSteps(job, { projectDir: job.projectDir, brainHome: job.brainHome, deadlineMs: job.deadlineMs });\n  } finally { turnWorkerRelease(job.brainHome, job.slot, job.token, process.pid); }',
      `  let executionSlot;
  try {
    executionSlot = await turnWaitForExecution(job);
    const deadlineMs = Math.min(job.deadlineMs, Date.now() + 30_000);
    runSteps({ ...job, deadlineMs }, { projectDir: job.projectDir, brainHome: job.brainHome, deadlineMs });
  } finally {
    try { if (executionSlot) turnWorkerRelease(job.brainHome, executionSlot, job.token, process.pid); }
    finally { turnWorkerRelease(job.brainHome, job.slot, job.token, process.pid); }
  }`],
  ];
  return edits.reduce((text, [from, to]) => {
    if (text.split(from).length !== 2) throw Error('Unknown first-attempt admission source');
    return text.replace(from, () => to);
  }, source);
}
