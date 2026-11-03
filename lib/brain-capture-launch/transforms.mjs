import { OWNERSHIP } from './ownership.mjs';
import { EDITS as released } from './legacy.mjs';

const learnDir = "const learnDir = (brainHome, sub) => { const dir = path.join(brainHome, 'learn-capture', sub); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; };";
const flight = `export function captureInFlight(brainHome, key, now = Date.now()) {
  try { return now - fs.statSync(inFlightMarker(brainHome, key)).mtimeMs < SLOT_STALE_MS; } catch { return false; }
}`;
const clear = `export function clearInFlight(brainHome, key) {
  try { fs.unlinkSync(inFlightMarker(brainHome, key)); } catch { /* already gone */ }
}`;
const captured = `export function markCaptured(brainHome, key, now = Date.now()) {
  const dir = learnDir(brainHome, 'recent');
  try { fs.writeFileSync(path.join(dir, key), '', { mode: 0o600 }); } catch { return; }
  const names = fs.readdirSync(dir);
  if (names.length > 256) for (const name of names) { try { if (now - fs.statSync(path.join(dir, name)).mtimeMs >= COALESCE_MS) fs.unlinkSync(path.join(dir, name)); } catch { /* raced */ } }
}`;
const stale = `function slotStale(slot, now) {
  let held;
  try { held = JSON.parse(fs.readFileSync(slot, 'utf8')); } catch { try { return now - fs.statSync(slot).mtimeMs > SLOT_STALE_MS; } catch { return false; } }
  if (!Number.isInteger(held?.pid) || now - Number(held.at) > SLOT_STALE_MS) return true;
  try { process.kill(held.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
}`;
const acquire = `export function acquireObserveSlot(brainHome, now = Date.now()) {
  const dir = learnDir(brainHome, 'slots');
  for (let i = 0; i < OBSERVE_SLOTS; i += 1) {
    const slot = path.join(dir, \`slot-\${i}\`);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { fs.writeFileSync(slot, JSON.stringify({ pid: process.pid, at: now }), { flag: 'wx', mode: 0o600 }); return slot; } catch (error) { if (error.code !== 'EEXIST') break; }
      if (!slotStale(slot, now)) break;
      const claim = \`\${slot}.reclaim-\${process.pid}\`;
      try { fs.renameSync(slot, claim); fs.unlinkSync(claim); } catch { break; } // another claimant took it
    }
  }
  return null;
}`;
const release = `export function releaseObserveSlot(slot, pid = process.pid) {
  try { if (JSON.parse(fs.readFileSync(slot, 'utf8')).pid === pid) fs.unlinkSync(slot); } catch { /* reclaimed already */ }
}`;
const launch = `  // ruflo-source-patch (stuinfla/ruvnet-brain#519 capture-launch): release only proven failed launch ownership.
  const key = observation ? observationKey(observation) : null;
  const admissionToken = arguments[1]?.admissionToken;
  let slotPid = process.pid, started = false, failed = false;
  const reportLaunch = error => recordHookFailure({ hook: mode === '--distill' ? 'learn-distill' : 'learn-capture',
    event: mode === '--distill' ? 'SessionEnd' : 'PostToolUse', error,
    ...(typeof validFailureScope === 'function' && typeof diagnostics !== 'undefined' ? validFailureScope(diagnostics) : {}) }, { brainHome });
  const launchFailure = error => {
    if (failed) return; failed = true;
    const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(error.code) ? error.code : 'spawn';
    reportLaunch((started ? 'detached child error: ' : 'detach failed: ') + code);
    if (!started) {
      for (const cleanup of [() => { if (slot) releaseObserveSlot(slot, slotPid, admissionToken, brainHome); },
        () => { if (key) clearInFlight(brainHome, key, admissionToken); }]) {
        try { cleanup(); } catch { reportLaunch('capture admission cleanup unavailable'); }
      }
    }
  };
  let child;
  try {
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), mode], { cwd: process.cwd(), detached: true, stdio: 'ignore', windowsHide: true,`;

export const OWNERSHIP_EDITS = [
  ['slot-policy-comment', 'export const SLOT_STALE_MS = 60_000;      // a slot older than this, or held by a dead pid, is reclaimed',
    'export const SLOT_STALE_MS = 60_000;      // pending expiry; live/unknown slot owners are never age-evicted'],
  ['slot-claim-comment', '/** O_EXCL slot files `learn-capture/slots/slot-N`; a stale one is reclaimed by rename, so only one claimant wins it. */',
    '/** Two slot records; the capture metadata gate serializes proven-dead recovery and exclusive complete-record publication. */'],
  ['ownership-helpers', learnDir, learnDir + '\n' + OWNERSHIP],
  ['flight-ownership', flight, `export function captureInFlight(brainHome, key, now = Date.now()) {
  return withCaptureGate(brainHome, () => capturePendingFresh(brainHome, key, now));
}`],
  ['pending-renewal', released.find(([id]) => id === 'pending-creation-owner')[2], `export function markInFlight(brainHome, key) {
  return withCaptureGate(brainHome, () => {
    if (capturePendingFresh(brainHome, key)) return false;
    const token = randomUUID();
    fs.writeFileSync(inFlightMarker(brainHome, key), token, { mode: 0o600 });
    return token;
  });
}`],
  ['pending-release', clear, `export function clearInFlight(brainHome, key, token) {
  if (typeof token !== 'string' || token.length !== 36) return false;
  return withCaptureGate(brainHome, () => {
    const file = inFlightMarker(brainHome, key);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 36 || fs.readFileSync(file, 'utf8') !== token) return false;
      fs.unlinkSync(file); return true;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  });
}`],
  ['acknowledgement-pruning', captured, `export function markCaptured(brainHome, key, now = Date.now()) {
  return withCaptureGate(brainHome, () => {
    const dir = learnDir(brainHome, 'recent');
    fs.writeFileSync(path.join(dir, key), '', { mode: 0o600 });
    const names = fs.readdirSync(dir);
    if (names.length > 256) for (const name of names) {
      const file = path.join(dir, name);
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || now - stat.mtimeMs < COALESCE_MS) continue;
        if (name.endsWith('.pending') && capturePendingFresh(brainHome, name.slice(0, -8), now)) continue;
        fs.unlinkSync(file);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  });
}`],
  ['live-slot-preservation', stale, `function slotStale(slot, now) {
  // Age alone never authorizes replacement of a live or uncertain owner.
  return captureOwnerDead(captureSlotRecord(slot));
}`],
  ['slot-claim', acquire, `export function acquireObserveSlot(brainHome, now = Date.now()) {
  return withCaptureGate(brainHome, () => {
    const dir = learnDir(brainHome, 'slots');
    for (let i = 0; i < OBSERVE_SLOTS; i++) {
      const slot = path.join(dir, 'slot-' + i);
      try { if (!slotStale(slot, now)) continue; fs.unlinkSync(slot); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const token = randomUUID();
      captureWriteSlot(slot, { pid: process.pid, start: captureOwnStart, at: now, token }, true);
      captureTokens.set(slot, token); return slot;
    }
    return null;
  });
}`],
  ['slot-release', release, `export function releaseObserveSlot(slot, pid = process.pid, token = captureTokens.get(slot), brainHome = defaultBrainHome(process.env)) {
  if (!captureValidSlot(brainHome, slot) || typeof token !== 'string' || token.length !== 36) return false;
  return withCaptureGate(brainHome, () => {
    let held; try { held = captureSlotRecord(slot); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if (held.token !== token || held.pid !== pid) return false;
    fs.unlinkSync(slot); captureTokens.delete(slot); return true;
  });
}`],
  ['atomic-admission', '      const slot = acquireObserveSlot(brainHome);', `      const admission = captureAdmit(brainHome, key);
      if (admission?.coalesced) return true;
      const slot = admission?.slot;`],
  ['admission-token', released.find(([id]) => id === 'pending-owner-result')[2], '      const admissionToken = admission.token; // NOT an acknowledgement:'],
  ['failed-launch-ownership', released.find(([id]) => id === 'guard-launch')[2], launch],
  ['child-token', '...(slot ? { RUVNET_LEARN_SLOT: slot } : {})', '...(slot ? { RUVNET_LEARN_SLOT: slot, RUVNET_LEARN_TOKEN: admissionToken } : {})'],
  ['parent-handoff', released.find(([id]) => id === 'owned-slot-handoff')[2], `  if (slot && Number.isInteger(child.pid) && child.pid > 0) {
    try { if (captureHandoff(brainHome, slot, admissionToken, child.pid)) slotPid = child.pid; }
    catch { reportLaunch('capture admission handoff unavailable'); }
  }`],
  ['child-adoption-state', 'function runDetached(mode) {', 'function runDetached(mode) {\n  let captureAdopted = false;'],
  ['child-adoption', '    const context = learningContext(); // consent is re-read: a withdrawn consent writes nothing', `    if (mode === '--observe') {
      captureAdopted = captureHandoff(brainHome, process.env.RUVNET_LEARN_SLOT, process.env.RUVNET_LEARN_TOKEN, process.pid, true);
      if (!captureAdopted) throw new Error('capture admission ownership lost');
    }
    const context = learningContext(); // consent is re-read: a withdrawn consent writes nothing`],
  ['child-cleanup', `    if (observation) clearInFlight(brainHome, observationKey(observation));
    if (process.env.RUVNET_LEARN_SLOT) releaseObserveSlot(process.env.RUVNET_LEARN_SLOT);`, `    if (mode === '--observe' && captureAdopted) {
    let pendingKey = observation ? observationKey(observation) : null;
    // Consent may be withdrawn before payload parsing; cleanup still requires this admission's token.
    if (!pendingKey) { try { const o = JSON.parse(process.env.RUVNET_LEARN_OBSERVATION || '{}');
      if (['Bash', 'Write', 'Edit', 'MultiEdit'].includes(o.tool) && typeof o.action === 'string')
        pendingKey = observationKey({ tool: o.tool, action: o.action, session: String(o.session || '') });
    } catch { /* malformed observation has no key to release */ } }
    for (const cleanup of [() => { if (pendingKey) clearInFlight(brainHome, pendingKey, process.env.RUVNET_LEARN_TOKEN); },
      () => { if (process.env.RUVNET_LEARN_SLOT) releaseObserveSlot(process.env.RUVNET_LEARN_SLOT, process.pid, process.env.RUVNET_LEARN_TOKEN, brainHome); }]) {
      try { cleanup(); } catch { fail(new Error('capture admission cleanup unavailable')); }
    }
    }`],
];
