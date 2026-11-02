// Brain #519/#521: reclaim failed launches and coalesce fresh same-key admission races.
// Keep native two-slot shedding, consent, exact-write acknowledgement and no replay.
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';

export const NAME = 'brain-capture-launch';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#519 capture-launch)';
const ADMISSION_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#521 capture-admission)';
const start = '  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), mode], { cwd: process.cwd(), detached: true, stdio: \'ignore\', windowsHide: true,';
const launch = `  // ${PATCH_MARKER}: a failed spawn is not an in-flight write.
  const admissionIdentity = file => {
    try {
      const s = fs.lstatSync(file, { bigint: true });
      return s.isFile() ? [s.dev, s.ino, s.mtimeNs, s.ctimeNs].join(':') : null;
    } catch { return null; }
  };
  const key = observation ? observationKey(observation) : null;
  const admissionToken = arguments[1]?.admissionToken;
  let pending = null;
  try { if (key && admissionToken) pending = inFlightMarker(brainHome, key); } catch { /* coalescing is best effort */ }
  const pendingIdentity = pending ? admissionIdentity(pending) : null;
  let slotIdentity = slot ? admissionIdentity(slot) : null;
  let slotPid = process.pid, started = false, failed = false;
  const launchFailure = error => {
    if (failed) return;
    failed = true;
    if (!started) {
      if (slotIdentity && admissionIdentity(slot) === slotIdentity) releaseObserveSlot(slot, slotPid);
      // Only exclusive creation proves ownership. A native refresh may represent another child.
      try {
        if (typeof admissionToken === 'string' && admissionToken.length === 36
          && pendingIdentity && admissionIdentity(pending) === pendingIdentity
          && fs.lstatSync(pending).size === 36 && fs.readFileSync(pending, 'utf8') === admissionToken)
          clearInFlight(brainHome, key);
      } catch { /* unknown pending ownership stays with native expiry */ }
    }
    const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(error.code) ? error.code : 'spawn';
    recordHookFailure({ hook: mode === '--distill' ? 'learn-distill' : 'learn-capture',
      event: mode === '--distill' ? 'SessionEnd' : 'PostToolUse',
      error: (started ? 'detached child error: ' : 'detach failed: ') + code,
      ...(typeof validFailureScope === 'function' && typeof diagnostics !== 'undefined' ? validFailureScope(diagnostics) : {}) }, { brainHome });
  };
  let child;
  try {
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), mode], { cwd: process.cwd(), detached: true, stdio: 'ignore', windowsHide: true,`;
// Exact released #519 composition remains recognized for upgrade and removal.
export const PREVIOUS_EDITS = [
  ['pending-token-import', "import fs from 'node:fs';", "import fs from 'node:fs';\nimport { randomUUID } from 'node:crypto';"],
  ['pending-creation-owner', `export function markInFlight(brainHome, key) {
  try { fs.writeFileSync(inFlightMarker(brainHome, key), '', { mode: 0o600 }); } catch { /* best effort: coalescing only */ }
}`, `export function markInFlight(brainHome, key) {
  let file;
  try {
    file = inFlightMarker(brainHome, key);
    const token = randomUUID();
    fs.writeFileSync(file, token, { flag: 'wx', mode: 0o600 }); return token;
  }
  catch (error) {
    if (error.code === 'EEXIST') {
      // Preserve native refresh/coalescing, without claiming another attempt's pending marker.
      try { fs.writeFileSync(file, '', { mode: 0o600 }); } catch { /* best effort: coalescing only */ }
    }
    return null;
  }
}`],
  ['pending-owner-result', '      markInFlight(brainHome, key); // NOT an acknowledgement:',
    '      const admissionToken = markInFlight(brainHome, key); // NOT an acknowledgement:'],
  ['pending-owner-handoff', "return detachLearning('--observe', { env: { ...env, RUFLO_BIN: binary },",
    "return detachLearning('--observe', { env: { ...env, RUFLO_BIN: binary }, admissionToken,"],
  ['guard-launch', start, launch],
  ['observe-launch', "...(slot ? { RUVNET_LEARN_SLOT: slot } : {}) } });\n  child.unref();",
    `...(slot ? { RUVNET_LEARN_SLOT: slot } : {}) } });
  } catch (error) { launchFailure(error); return false; }
  child.once('spawn', () => { started = true; });
  child.on('error', launchFailure);
  child.unref();`],
  ['owned-slot-handoff', "  if (slot) { try { fs.writeFileSync(slot, JSON.stringify({ pid: child.pid, at: Date.now() }), { mode: 0o600 }); } catch { /* reclaimed by age */ } }",
    `  if (slotIdentity && Number.isInteger(child.pid) && child.pid > 0) {
    try {
      if (admissionIdentity(slot) === slotIdentity) {
        fs.writeFileSync(slot, JSON.stringify({ pid: child.pid, at: Date.now() }), { mode: 0o600 });
        slotIdentity = admissionIdentity(slot); slotPid = child.pid;
      }
    } catch { /* native stale reclamation remains the fallback */ }
  }`],
];
export const EDITS = PREVIOUS_EDITS.map(([id, from, to]) => [id, from,
  id === 'pending-creation-owner' ? to.replace("if (error.code === 'EEXIST') {",
    `if (error.code === 'EEXIST') {
      // ${ADMISSION_MARKER}: another fresh admission owns this key, not a persisted receipt.
      if (captureInFlight(brainHome, key)) return false;`)
    : id === 'pending-owner-result' ? to.replace(' // NOT an acknowledgement:',
      '\n      if (admissionToken === false) { releaseObserveSlot(slot); return true; }\n      // NOT an acknowledgement:') : to]);
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => count(source, PATCH_MARKER) === 1 && EDITS.every(([, , to]) => count(source, to) === 1);
const isPrevious = source => count(source, PATCH_MARKER) === 1 && !source.includes(ADMISSION_MARKER)
  && PREVIOUS_EDITS.every(([, , to]) => count(source, to) === 1);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (isPrevious(source)) return {
    next: EDITS.reduce((text, [, , to], i) => text.replace(PREVIOUS_EDITS[i][2], () => to), source),
    applied: ['fresh-pending-coalescing'], missing: [],
  };
  if (hasPatch(source) || !source.includes('export function captureLearning(input,')
    || !source.includes('export function clearInFlight(brainHome, key)')
    || !EDITS.every(([, from]) => count(source, from) === 1))
    return { next: source, applied: [], missing: ['unique-native-detached-launch'] };
  return { next: EDITS.reduce((text, [, from, to]) => text.replace(from, () => to), source),
    applied: EDITS.map(([id]) => id), missing: [] };
}
export const reverseSource = source => !(isPatched(source) || isPrevious(source)) ? source
  : (isPrevious(source) ? PREVIOUS_EDITS : EDITS).reduceRight((text, [, from, to]) => text.replace(to, () => from), source);
export const discover = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: ['scripts/learn-capture.mjs'],
}).filter(surface => surface.kind === 'full').map(surface => path.join(surface.root, 'scripts/learn-capture.mjs'));
// Retire only on marker-free native proof of failed-launch cleanup, retained live-child admission,
// fresh same-key coalescing, unchanged two-slot shedding and exact acknowledgement; unknown bytes fail visibly.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource };
