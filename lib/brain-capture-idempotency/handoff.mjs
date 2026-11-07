import { OWNERSHIP } from '../brain-capture-launch/ownership.mjs';
import { WAIT_EDITS } from '../brain-capture-launch/backpressure.mjs';
import { waitingHandoff } from './admission.mjs';

// Reuse the reviewed capture metadata gate, complete-record publication and
// proven-dead recovery. Turn workers have independent capacity and no payload files.
const [, gateBefore, gateAfter] = WAIT_EDITS.find(([id]) => id === 'wait-gate-observation-race');
const correctedOwnership = OWNERSHIP.replace(gateBefore, () => gateAfter);
const lease = correctedOwnership.slice(correctedOwnership.indexOf('const captureGates'), correctedOwnership.indexOf('function captureTokenActive'))
  .replaceAll('capture', 'turnWorker').replaceAll('Capture', 'TurnWorker')
  .replaceAll('learnDir', 'turnWorkerDir').replaceAll('randomUUID()', 'crypto.randomUUID()');
function turnWorkerDir(brainHome, sub) {
  const dir = path.join(brainHome, 'turn-capture', 'workers', sub);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw Error('Unsafe turn worker directory');
  return dir;
}
function turnAttemptPending(receipt) {
  if (receipt?.pending !== true || !Number.isSafeInteger(receipt.deadlineMs) || Date.now() >= receipt.deadlineMs) return false;
  try { return !turnWorkerOwnerDead(receipt.owner); } catch { return false; } // Unknown means reconcile-only, never a new write.
}
function turnWorkerRelease(brainHome, slot, token, pid) {
  return withTurnWorkerGate(brainHome, () => {
    const held = turnWorkerSlotRecord(slot);
    if (held.token !== token || held.pid !== pid) throw Error('Turn worker ownership changed');
    fs.unlinkSync(slot);
  });
}
function launchFreshTurn(steps, { receipts, brainHome, projectDir, event, env, deadlineMs }) {
  const base = { steps, receipts, brainHome, projectDir, event, deadlineMs };
  if (Buffer.byteLength(JSON.stringify(base)) > 1024 * 1024 - 1024) throw Error('Fresh turn handoff exceeds native input bound');
  const admission = withTurnWorkerGate(brainHome, () => {
    const dir = turnWorkerDir(brainHome, 'slots');
    for (let i = 0; i < 2; i++) {
      const slot = path.join(dir, 'slot-' + i);
      try {
        if (!turnWorkerOwnerDead(turnWorkerSlotRecord(slot))) continue;
        fs.unlinkSync(slot);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const token = crypto.randomUUID();
      turnWorkerWriteSlot(slot, { pid: process.pid, start: turnWorkerOwnStart, token }, true);
      return { slot, token };
    }
    throw Error('Turn capture worker capacity exhausted before dispatch');
  });
  let child, transferred = false;
  const failed = error => {
    recordHookFailure({ hook: 'turn-capture', event, error: 'fresh turn handoff failed: ' + String(error?.code || 'spawn'),
      ...validFailureScope(steps[0]?.failureScope), ...failureScope({ expectedKey: flagValue(steps[0]?.args || [], '--key') }) }, { brainHome });
  };
  try {
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--run-fresh-turn', event,
      JSON.stringify({ ...validFailureScope(steps[0]?.failureScope), ...failureScope({ expectedKey: flagValue(steps[0]?.args || [], '--key') }) })], {
      cwd: os.tmpdir(), detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
      env: { ...env, ...RUFLO_ENV, RUVNET_BRAIN_HOME: brainHome, RUVNET_TURN_PROJECT_DIR: projectDir },
    });
    child.on('error', failed); child.stdin.on('error', failed);
    if (!Number.isInteger(child.pid) || child.pid < 1) throw Error('Turn worker did not launch');
    withTurnWorkerGate(brainHome, () => {
      const held = turnWorkerSlotRecord(admission.slot);
      if (held.pid !== process.pid || held.token !== admission.token) throw Error('Turn worker handoff identity changed');
      turnWorkerWriteSlot(admission.slot, { ...held, pid: child.pid, start: turnWorkerProcessStart(child.pid) });
    });
    transferred = true;
    const db = flagValue(steps[0].args, '--path');
    appendReceipt(receipts, { at: new Date().toISOString(), kind: 'store', db: redactText(db), storeIdentity: digest(db),
      key: flagValue(steps[0].args, '--key'), status: 1, verified: false, pending: true, deadlineMs, owner: { pid: child.pid, start: turnWorkerProcessStart(child.pid) },
      error: 'fresh turn capture pending exact readback' });
    child.stdin.end(JSON.stringify({ ...base, ...admission }));
    child.unref(); child.stdin.once('finish', () => child.stdin.unref?.());
    return { launched: true, pid: child.pid, pending: true, deadlineMs };
  } catch (error) {
    // A transferred child may have started; never steal its lease or retry its write.
    if (!transferred) turnWorkerRelease(brainHome, admission.slot, admission.token, process.pid);
    throw error;
  }
}
async function runFreshTurn() {
  const job = JSON.parse((await readStdinBounded({ maxBytes: 1024 * 1024 })).toString('utf8'));
  if (!job || !['Stop', 'PreCompact', 'SessionEnd'].includes(job.event)
      || !path.isAbsolute(job.brainHome || '') || !path.isAbsolute(job.projectDir || '')
      || !Array.isArray(job.steps) || job.steps.length !== 1 || job.steps[0].kind !== 'store'
      || !Number.isSafeInteger(job.deadlineMs) || job.deadlineMs <= Date.now() || job.deadlineMs > Date.now() + 30_000
      || ![0, 1].some(i => job.slot === path.join(job.brainHome, 'turn-capture', 'workers', 'slots', 'slot-' + i))
      || job.receipts !== path.join(job.brainHome, 'turn-capture', 'receipts.jsonl')) throw Error('Invalid fresh turn handoff');
  withTurnWorkerGate(job.brainHome, () => {
    const held = turnWorkerSlotRecord(job.slot);
    if (held.pid !== process.pid || held.token !== job.token) throw Error('Fresh turn worker has no matching lease');
  });
  try {
    runSteps(job, { projectDir: job.projectDir, brainHome: job.brainHome, deadlineMs: job.deadlineMs });
  } finally { turnWorkerRelease(job.brainHome, job.slot, job.token, process.pid); }
}

export const LEGACY_HANDOFF_HELPER = `// ruflo-source-patch (brain#513 fresh-turn-handoff)
${lease}
${turnWorkerDir.toString()}
${turnAttemptPending.toString()}
${turnWorkerRelease.toString()}
${launchFreshTurn.toString()}
${runFreshTurn.toString()}
`;
export const LEGACY_HANDOFF_EDITS = [
  ['fresh-turn-reconcile', "steps.push({ ...binding, kind: 'store', ruflo, turnRecord:",
    "steps.push({ ...binding, kind: 'store', ruflo, reconcileOnly: Boolean(storeReceipt(receipts, key)) || readTurnState(stateFile)[identity]?.key === key, turnRecord:"],
  ['fresh-turn-pending', '  return receipt ? verifiedReceipt(receipt) : Date.now() - previous.at < 2 * STEP_TIMEOUT_MS + 10_000;',
    '  return receipt ? verifiedReceipt(receipt) || turnAttemptPending(receipt) : Date.now() - previous.at < 2 * STEP_TIMEOUT_MS + 10_000;'],
  ['fresh-turn-helper', 'const projectName = ', `${LEGACY_HANDOFF_HELPER}\nconst projectName = `],
  ['fresh-turn-dispatch', '    if (store.length) {', `    if (store.length && run === undefined && write === runSteps
        && Number.isFinite(deadlineAt) && deadlineAt - Date.now() < 2_600
        && !storeReceipt(receipts, report.key)) {
      // First attempt only. Native runSteps rechecks consent, root identity and privacy in the child.
      report.turnLaunch = launchFreshTurn(store, { receipts, brainHome, projectDir: binding.projectDir,
        event, env, deadlineMs: Date.now() + 30_000 });
      report.pending = true;
      if (dedupe) markTurnQueued(dedupe.stateFile, dedupe.identity, dedupe.fingerprint, dedupe.key);
    } else if (store.length) {
      if (dedupe) markTurnQueued(dedupe.stateFile, dedupe.identity, dedupe.fingerprint, dedupe.key);`],
  ['fresh-turn-entry', "if (isDirectInvocation(import.meta.url) && process.argv[2] === '--native-capture-pair') {",
    `if (isDirectInvocation(import.meta.url) && process.argv[2] === '--run-fresh-turn') {
  try { await runFreshTurn(); } catch (error) {
    let diagnostics = {}; try { diagnostics = validFailureScope(JSON.parse(process.argv[4] || '{}')); } catch {}
    const event = ['Stop', 'PreCompact', 'SessionEnd'].includes(process.argv[3]) ? process.argv[3] : '';
    recordHookFailure({ hook: 'turn-capture', event, ...diagnostics, error: 'fresh turn worker failed: ' + redactText(String(error?.message || error)).slice(0, 160) },
      { brainHome: process.env.RUVNET_BRAIN_HOME });
    process.exitCode = 1;
  }
  process.exit(process.exitCode || 0);
}

if (isDirectInvocation(import.meta.url) && process.argv[2] === '--native-capture-pair') {`],
];
export const HANDOFF_HELPER = waitingHandoff(LEGACY_HANDOFF_HELPER);
export const HANDOFF_EDITS = LEGACY_HANDOFF_EDITS.map(([id, from, to]) => [id, from,
  id === 'fresh-turn-helper' ? to.replace(LEGACY_HANDOFF_HELPER, () => HANDOFF_HELPER)
    : id === 'fresh-turn-dispatch' ? to.replace('deadlineMs: Date.now() + 30_000', 'deadlineMs: Date.now() + 90_000') : to]);
