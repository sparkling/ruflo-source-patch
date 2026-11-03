// Brain #521: bounded admission waiting, never a payload queue or a write retry.
export const WAIT_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#521 capture-backpressure)';
const helper = String.raw`
// ruflo-source-patch (stuinfla/ruvnet-brain#521 capture-backpressure)
const CAPTURE_WAITERS = 8;
const CAPTURE_WAIT_MS = 7000;
function captureWaitStage(file) {
  // Only called under the metadata gate. These fixed names contain unpublished ownership
  // metadata, never observations. A previous gate holder cannot still be publishing them.
  const staged = file + '.staged';
  let stat; try { stat = fs.lstatSync(staged); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096 || ![1, 2].includes(stat.nlink)
    || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw Error('capture waiter ownership unknown');
  if (stat.nlink === 2) {
    const published = fs.lstatSync(file);
    if (!published.isFile() || published.isSymbolicLink() || published.dev !== stat.dev || published.ino !== stat.ino)
      throw Error('capture waiter ownership unknown');
  }
  fs.unlinkSync(staged); // Also completes native link publication interrupted before unlink.
}
function captureWaitRead(file) {
  let fd;
  try {
    const before = fs.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink()) throw Error('capture waiter ownership unknown');
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 || (stat.mode & 0o077)
      || (process.getuid && stat.uid !== process.getuid())) throw Error('capture waiter ownership unknown');
    const bytes = new Uint8Array(4097), size = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (size > 4096) throw Error('capture waiter ownership unknown');
    let owner;
    try { owner = JSON.parse(String.fromCharCode(...bytes.subarray(0, size))); }
    catch { throw Error('capture waiter ownership unknown'); }
    if (!Number.isInteger(owner?.pid) || owner.pid < 1 || typeof owner.token !== 'string' || owner.token.length !== 36
      || !Number.isSafeInteger(owner.at) || owner.at < 0) throw Error('capture waiter ownership unknown');
    // Native ownership validation includes Linux process birth identity; unknown/live owners stay.
    const dead = captureOwnerDead(owner);
    return { owner, dead };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function captureWaiters(brainHome) {
  const dir = learnDir(brainHome, 'waiters'), stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)
    || (process.getuid && stat.uid !== process.getuid())) throw Error('capture waiter ownership unknown');
  const rows = [];
  // Fixed filenames bound reads and owned storage. Never enumerate an unbounded directory.
  for (let i = 0; i < CAPTURE_WAITERS; i++) {
    const file = path.join(dir, 'waiter-' + i + '.json');
    captureWaitStage(file);
    try {
      const held = captureWaitRead(file);
      if (held.dead) fs.unlinkSync(file); // Gate held, complete dead-owner identity proved.
      else rows.push({ file, ...held.owner });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { dir, rows: rows.sort((a, b) => a.at - b.at || a.token.localeCompare(b.token)) };
}
function captureWaitClaim(brainHome, owner) {
  const { dir, rows } = captureWaiters(brainHome);
  if (rows.length >= CAPTURE_WAITERS) throw Error('capture admission wait capacity exhausted');
  for (let i = 0; i < CAPTURE_WAITERS; i++) {
    const file = path.join(dir, 'waiter-' + i + '.json');
    if (rows.some(row => row.file === file)) continue;
    captureWriteSlot(file, owner, true, file + '.staged');
    return file;
  }
  throw Error('capture admission wait capacity exhausted');
}
function captureWaitRelease(brainHome, file, token) {
  if (!file) return;
  withCaptureGate(brainHome, () => {
    try { if (captureWaitRead(file).owner.token === token) fs.unlinkSync(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  });
}
function captureWaitDeadline(env = process.env) {
  const now = Date.now();
  // The native Claude shim plans inside its 8.5s watchdog. Count imports/setup too.
  const handed = Number(env.RUVNET_CODEX_BUDGET_MS);
  const bodyBudget = Number.isFinite(handed) && handed > 0 ? Math.min(8000, Math.max(0, handed - 300)) : 8000;
  const processBudget = now + Math.max(0, bodyBudget - process.uptime() * 1000);
  const inherited = Number(env.RUVNET_DECISION_DEADLINE);
  return Math.min(now + CAPTURE_WAIT_MS, processBudget,
    Number.isFinite(inherited) && inherited > 0 ? inherited : Infinity);
}
function captureWaitAdmit(brainHome, key, { allowed = () => true, env = process.env,
  deadlineAt = captureWaitDeadline(env) } = {}) {
  const started = Date.now(), owner = { pid: process.pid, start: captureOwnStart, token: randomUUID(), at: Date.now() };
  let file = null, attempts = 0, outcome = 'refused';
  const attempt = () => { attempts++; return captureAdmit(brainHome, key); };
  try {
    if (Date.now() + 300 >= deadlineAt) throw Error('capture admission wait expired');
    const initial = withCaptureGate(brainHome, () => {
      const { rows } = captureWaiters(brainHome);
      // Native coalescing is not proof of persistence; preserve its existing early return.
      if (!rows.length || recentlyCaptured(brainHome, key) || capturePendingFresh(brainHome, key)) {
        const admission = attempt();
        if (admission) return admission;
      }
      if (Date.now() + 300 >= deadlineAt) throw Error('capture admission wait expired');
      file = captureWaitClaim(brainHome, owner);
      return null;
    });
    if (initial) { outcome = initial.coalesced ? 'coalesced' : 'admitted'; return initial; }
    while (Date.now() + 300 < deadlineAt) {
      // Sleep outside the native metadata gate. No extra child, driver or user command.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(50, Math.max(1, deadlineAt - Date.now() - 300)));
      if (Date.now() + 300 >= deadlineAt) break;
      if (!allowed()) throw Error('capture admission consent changed');
      const admission = withCaptureGate(brainHome, () => {
        const { rows } = captureWaiters(brainHome);
        if (!rows.some(row => row.file === file && row.token === owner.token)) throw Error('capture waiter ownership unknown');
        if (rows[0]?.token !== owner.token && !recentlyCaptured(brainHome, key) && !capturePendingFresh(brainHome, key)) return null;
        const result = attempt();
        if (result) { fs.unlinkSync(file); file = null; }
        return result;
      });
      if (admission) { outcome = admission.coalesced ? 'coalesced' : 'admitted'; return admission; }
    }
    throw Error('capture admission wait expired');
  } finally {
    try { captureWaitRelease(brainHome, file, owner.token); }
    finally { captureTimingWait({ waitMs: Math.max(0, Date.now() - started), attempts, outcome, capacity: CAPTURE_WAITERS }); }
  }
}
`;
export const WAIT_EDITS = [
  ['read-only-duplicate-timing', "alreadyStored: result?.alreadyStored === true,\n      store:",
    "alreadyStored: result?.alreadyStored === true, readOnlyDuplicate: result?.readOnlyDuplicate === true,\n      store:"],
  ['wait-gate-observation-race', "        if (fs.existsSync(directory)) throw Error('capture admission owner unknown');",
    `        if (fs.existsSync(directory)) {
          // The observed directory may have been released and replaced before its owner read.
          // Re-observe within the SAME 100ms budget; never claim an unproved ownerless directory.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
          continue;
        }`],
  ['wait-policy-comment', '// no local queue, no replay — an observation that finds no slot is DROPPED and counted.',
    '// No payload queue or replay: bounded callers wait for the same two slots, then report overload explicitly.'],
  ['wait-atomic-publication', 'function captureWriteSlot(slot, record, create = false) {\n  const staged = slot + \'.record-\' + randomUUID();',
    'function captureWriteSlot(slot, record, create = false, stage = null) {\n  const staged = stage || slot + \'.record-\' + randomUUID();'],
  ['wait-publication-timing', '  captureWriteSlot = (file, owner, create) => {\n    const result = originalWriteSlot(file, owner, create);\n    if (active) try { note(create ? \'slot-acquired\' : \'slot-handoff\', slotFields(file, owner)); } catch {}',
    '  captureWriteSlot = (file, owner, create, stage) => {\n    const result = originalWriteSlot(file, owner, create, stage);\n    if (active) try { const fields = slotFields(file, owner);\n      if (Number.isInteger(fields.slot)) note(create ? \'slot-acquired\' : \'slot-handoff\', fields); } catch {}'],
  ['wait-admission', '      const admission = captureAdmit(brainHome, key);',
    `      const admission = captureWaitAdmit(brainHome, key, { env, allowed: () => {
        const current = learningContext();
        return current.enabled && current.scope === context.scope && current.projectDir === context.projectDir && current.home === context.home;
      } });`],
  ['wait-timing-seam', 'let captureTimingGateAcquired = () => {};', 'let captureTimingWait = () => {};\nlet captureTimingGateAcquired = () => {};'],
  ['wait-timing-result', "  captureTimingRefusal = error => note('refused', { reason: reason(error) });",
    "  captureTimingWait = fields => { try { if (active) active.admissionWait = fields; } catch {} };\n  captureTimingRefusal = error => note('refused', { reason: reason(error) });"],
  ['wait-reasons', "'capture admission cleanup unavailable', 'capture admission ownership lost'].includes(message)",
    "'capture admission cleanup unavailable', 'capture admission ownership lost', 'capture waiter ownership unknown',\n      'capture admission wait capacity exhausted', 'capture admission wait expired', 'capture admission consent changed'].includes(message)"],
  ['wait-helpers', '\nconst isMain = isDirectInvocation(import.meta.url);', '\n' + helper + '\nconst isMain = isDirectInvocation(import.meta.url);'],
];
const count = (source, text) => source.split(text).length - 1;
export const hasWait = source => source.includes(WAIT_MARKER);
export const isWaiting = source => count(source, WAIT_MARKER) === 1 && WAIT_EDITS.every(([, , to]) => count(source, to) === 1);
export const undoWait = source => !isWaiting(source) ? source : WAIT_EDITS.reduceRight((s, [, from, to]) => s.replace(to, () => from), source);
export function addWait(source) {
  if (isWaiting(source)) return source;
  if (hasWait(source) || !WAIT_EDITS.every(([, from]) => count(source, from) === 1)) return null;
  return WAIT_EDITS.reduce((s, [, from, to]) => s.replace(from, () => to), source);
}
