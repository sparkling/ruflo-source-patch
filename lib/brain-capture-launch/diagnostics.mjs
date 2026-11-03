// Brain #521: measure the existing capture boundary, never change admission or replay.
export const TIMING_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#521 capture-timing)';
function installCaptureTiming() {
  let active = null;
  const clock = () => Number(process.hrtime.bigint()) / 1e6;
  const elapsed = start => Math.max(0, Math.round((clock() - start) * 1000) / 1000);
  const digest = value => typeof value === 'string' && value.length > 0 && value.length <= 8192
    ? captureTimingHash('sha256').update(value).digest('hex').slice(0, 16) : null;
  const reason = error => {
    const message = String(error?.message || '');
    if (['capture admission contended', 'capture admission claim unknown', 'capture admission gate unknown',
      'capture admission owner unknown', 'capture admission recovery contents unknown', 'capture admission recovery exhausted',
      'capture admission recovery identity changed', 'capture admission release identity changed',
      'capture pending owner unknown', 'capture slot owner unknown', 'capture slot path refused',
      'capture admission cleanup unavailable', 'capture admission ownership lost'].includes(message)) return message;
    return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(error.code) ? error.code : 'native-operation-error';
  };
  const note = (phase, fields = {}) => {
    try {
      if (!active) return;
      if (active.events.length < 32) active.events.push({ phase, elapsedMs: elapsed(active.started), ...fields });
      else active.droppedEvents++;
    } catch { /* Diagnostic failure cannot affect capture. */ }
  };
  const slotFields = (file, owner) => {
    const index = /(?:^|[\\/])slot-([01])$/.exec(String(file))?.[1];
    if (index === undefined) return {};
    return { slot: Number(index), ownerPid: Number.isSafeInteger(owner?.pid) ? owner.pid : null,
      ownerStart: /^\d{1,30}$/.test(owner?.start) ? owner.start : null,
      token: digest(owner?.token), ownerAt: Number.isSafeInteger(owner?.at) ? owner.at : null };
  };
  const persist = trace => {
    let fd;
    try {
      const home = process.env.RUFLO_SOURCE_PATCH_HOME || os.userInfo().homedir;
      if (!path.isAbsolute(home)) return;
      let dir = home;
      for (const part of ['.ruflo-source-patch', 'capture-diagnostics']) {
        dir = path.join(dir, part);
        try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') return; }
        const s = fs.lstatSync(dir);
        if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o022)
          || (part === 'capture-diagnostics' && (s.mode & 0o077))
          || (process.getuid && s.uid !== process.getuid())) return;
      }
      const { started, operation, gate, ...row } = trace;
      const bytes = JSON.stringify(row) + '\n';
      if (bytes.length > 16384) return;
      // Same fixed-slot snapshot design as policy diagnostics: no scan, worker or growing journal.
      // Concurrent slot collisions can overwrite samples; these are observations, never a loss counter.
      const file = path.join(dir, 'capture-' + (parseInt(trace.invocation.slice(0, 8), 16) % 128) + '.json');
      try { const s = fs.lstatSync(file);
        if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || (s.mode & 0o077)
          || (process.getuid && s.uid !== process.getuid())) return;
      } catch (error) { if (error.code !== 'ENOENT') return; }
      fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_WRONLY
        | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0), 0o600);
      const s = fs.fstatSync(fd);
      if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid())) return;
      fs.ftruncateSync(fd, 0);
      fs.writeSync(fd, bytes);
    } catch { /* Bounded, private, best-effort diagnostics never affect native outcomes. */ }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  };
  const run = (mode, input, fn) => {
    if (process.env.RSP_CAPTURE_DIAGNOSTICS === 'off') return fn();
    const previous = active;
    let trace = null;
    try {
      if (typeof captureTimingHash === 'function') {
        const scope = mode === 'parent' ? input : JSON.parse(process.env.RUVNET_LEARN_OBSERVATION || '{}');
        const key = mode === 'parent' ? null : observationKey(scope);
        let inherited = {};
        try { inherited = JSON.parse(process.env.RUVNET_LEARN_FAILURE_SCOPE || '{}'); } catch {}
        const scoped = (name, fallback) => mode === 'child' && typeof inherited?.[name] === 'string'
          && /^[a-f0-9]{16}$/.test(inherited[name]) ? inherited[name] : digest(fallback);
        trace = { schemaVersion: 1, kind: 'brain-capture-timing', invocation: randomUUID(), mode,
          pid: process.pid, processStart: captureOwnStart, observedAt: new Date().toISOString(),
          project: scoped('project', input?.cwd || process.cwd()), session: scoped('session', mode === 'parent' ? scope?.session_id : scope?.session),
          expectedKey: scoped('expectedKey', key), token: digest(process.env.RUVNET_LEARN_TOKEN),
          started: clock(), events: [], droppedEvents: 0 };
      }
    } catch { /* Capture still runs exactly once when tracing cannot start. */ }
    active = trace;
    try {
      const result = fn();
      if (trace) trace.returned = typeof result === 'boolean' ? result : null;
      return result;
    } catch (error) { note('threw', { reason: reason(error) }); throw error; }
    finally {
      try { if (trace) trace.elapsedMs = elapsed(trace.started); } catch {}
      active = previous;
      if (trace) persist(trace); // All native gate cleanup has completed before file I/O.
    }
  };
  const step = (name, fn) => {
    if (!active) return fn();
    const trace = active, previous = trace.operation, started = clock();
    trace.operation = name;
    try { return fn(); }
    catch (error) { note(name + '-failed', { reason: reason(error) }); throw error; }
    finally { note(name, { durationMs: elapsed(started) }); trace.operation = previous; }
  };
  const originalGate = withCaptureGate;
  withCaptureGate = (brainHome, fn) => {
    if (!active || captureGates.has(path.join(brainHome, 'learn-capture', 'admission.lock'))) return originalGate(brainHome, fn);
    const trace = active, previous = trace.gate, started = clock();
    const gate = { started, operation: trace.operation || 'metadata', acquired: null };
    trace.gate = gate;
    try { return originalGate(brainHome, fn); }
    catch (error) { gate.reason = reason(error); throw error; }
    finally {
      const finished = clock();
      note('gate', { operation: gate.operation, waitMs: Math.max(0, (gate.acquired ?? finished) - started),
        heldMs: gate.acquired === null ? null : Math.max(0, finished - gate.acquired), ...(gate.reason ? { reason: gate.reason } : {}) });
      trace.gate = previous;
    }
  };
  captureTimingGateAcquired = () => { try { if (active?.gate) active.gate.acquired = clock(); } catch {} };
  const originalReadSlot = captureSlotRecord;
  captureSlotRecord = file => {
    try {
      const owner = originalReadSlot(file);
      if (active) try { note('slot-read', slotFields(file, owner)); } catch {}
      return owner;
    } catch (error) {
      if (active) try { note('slot-read', { ...slotFields(file), state: error.code === 'ENOENT' ? 'absent' : 'unknown' }); } catch {}
      throw error;
    }
  };
  const originalWriteSlot = captureWriteSlot;
  captureWriteSlot = (file, owner, create) => {
    const result = originalWriteSlot(file, owner, create);
    if (active) try { note(create ? 'slot-acquired' : 'slot-handoff', slotFields(file, owner)); } catch {}
    return result;
  };
  const originalLearning = captureLearning;
  captureLearning = (input, options) => run('parent', input, () => originalLearning(input, options));
  const originalDetached = runDetached;
  runDetached = mode => mode === '--observe' ? run('child', null, () => originalDetached(mode)) : originalDetached(mode);
  const originalAdmit = captureAdmit;
  captureAdmit = (home, key) => {
    try { if (active) active.expectedKey = digest(key); } catch {}
    return step('admit', () => { const result = originalAdmit(home, key);
      note('admission', { outcome: result?.coalesced ? 'coalesced-pending-or-recent' : result ? 'admitted' : 'slots-full' }); return result; });
  };
  const originalRecent = recentlyCaptured;
  recentlyCaptured = (...args) => { const result = originalRecent(...args);
    if (result) { try { if (active) active.expectedKey = digest(args[1]); } catch {} note('coalesced-recent'); } return result; };
  const originalFlight = captureInFlight;
  captureInFlight = (...args) => step('pending-check', () => { const result = originalFlight(...args);
    if (result) { try { if (active) active.expectedKey = digest(args[1]); } catch {} note('coalesced-pending'); } return result; });
  const originalCaptured = markCaptured;
  markCaptured = (...args) => step('ack-prune', () => originalCaptured(...args));
  const originalHandoff = captureHandoff;
  captureHandoff = (...args) => step(args[4] ? 'adoption' : 'handoff', () => originalHandoff(...args));
  const originalRelease = releaseObserveSlot;
  releaseObserveSlot = (...args) => step('release', () => { const result = originalRelease(...args);
    try { note('slot-release', { token: digest(args[2]), released: result === true }); } catch {} return result; });
  captureTimingWrite = fn => step('native-store-readback', () => {
    const result = fn();
    try { note('native-result', { exactCli: result?.exactCli === true, alreadyStored: result?.alreadyStored === true,
      store: digest(result?.db), expectedKey: digest(result?.key) }); } catch {}
    return result;
  });
  captureTimingRefusal = error => note('refused', { reason: reason(error) });
}
const helpers = `// ${TIMING_MARKER}: snapshots only; no capture authority.
let captureTimingGateAcquired = () => {};
let captureTimingWrite = operation => operation();
let captureTimingRefusal = () => {};
${installCaptureTiming.toString()}
installCaptureTiming();
`;
export const TIMING_EDITS = [
  ['timing-import', "import { randomUUID } from 'node:crypto';", "import { randomUUID } from 'node:crypto';\nimport { createHash as captureTimingHash } from 'node:crypto';"],
  ['timing-gate-acquired', '    captureGates.add(directory);', '    captureGates.add(directory);\n    captureTimingGateAcquired();'],
  ['timing-inline-write', '    recordLearningObservation(binary, context, observation, { env, deadline:',
    '    captureTimingWrite(() => {\n    return recordLearningObservation(binary, context, observation, { env, deadline:'],
  ['timing-inline-complete', '\n    markCaptured(brainHome, key);', '\n    });\n    markCaptured(brainHome, key);'],
  ['timing-child-write', '    recordLearningObservation(binary, context, observation, { env: process.env, deadline:',
    '    captureTimingWrite(() => {\n    return recordLearningObservation(binary, context, observation, { env: process.env, deadline:'],
  ['timing-child-complete', '\n    markCaptured(brainHome, observationKey(observation));', '\n    });\n    markCaptured(brainHome, observationKey(observation));'],
  ['timing-parent-refusal', '    if (tool && action) recordHookFailure', '    captureTimingRefusal(error);\n    if (tool && action) recordHookFailure'],
  ['timing-child-refusal', '} catch (error) { fail(error); } finally {', '} catch (error) { captureTimingRefusal(error); fail(error); } finally {'],
  ['timing-spawn-refusal', '    if (failed) return; failed = true;', '    if (failed) return; failed = true;\n    captureTimingRefusal(error);'],
  ['timing-helpers', '\nconst isMain = isDirectInvocation(import.meta.url);', '\n' + helpers + '\nconst isMain = isDirectInvocation(import.meta.url);'],
];
const count = (source, text) => source.split(text).length - 1;
export const hasTiming = source => source.includes(TIMING_MARKER);
export const isTimed = source => count(source, TIMING_MARKER) === 1 && TIMING_EDITS.every(([, , to]) => count(source, to) === 1);
export const undoTiming = source => !isTimed(source) ? source : TIMING_EDITS.reduceRight((s, [, from, to]) => s.replace(to, () => from), source);
export function addTiming(source) {
  if (isTimed(source)) return source;
  if (hasTiming(source) || !TIMING_EDITS.every(([, from]) => count(source, from) === 1)) return null;
  return TIMING_EDITS.reduce((s, [, from, to]) => s.replace(from, () => to), source);
}
