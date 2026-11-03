// Brain #429: private observations only; no recall control-flow or backend policy.
// Injected into the existing native process module, using its fs/path imports.
function recallDiagnostics({ env, storePath, diagnostics }) {
  const startedAt = Date.now(), events = [];
  const digest = value => typeof value === 'string' && value.length > 0 && value.length <= 8192
    ? crypto.createHash('sha256').update(value).digest('hex').slice(0, 16) : null;
  const scope = { project: digest(diagnostics?.project), store: digest(storePath), session: digest(diagnostics?.session) };
  const receipt = { schemaVersion: 1, kind: 'brain-recall-owner-diagnostic',
    invocation: crypto.randomBytes(12).toString('hex'), parentPid: process.pid,
    observedAt: new Date(startedAt).toISOString(), ...scope, deadline: diagnostics?.deadline, events };
  let slot, retirementResult = null;
  const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(value) ? value : null;
  const note = (phase, fields = {}) => {
    if (phase === 'retirement-check') { receipt.retirementChecks = (receipt.retirementChecks || 0) + 1; receipt.lastRetirementCheck = { elapsedMs: Date.now() - startedAt, ...fields }; return; }
    if (phase === 'child-exit' || phase === 'child-close') receipt[phase] = { elapsedMs: Date.now() - startedAt, ...fields };
    if (events.length < 96) events.push({ phase, elapsedMs: Date.now() - startedAt, ...fields });
    else receipt.droppedEvents = (receipt.droppedEvents || 0) + 1;
  };
  const persist = () => {
    if (!retirementResult) return;
    let fd;
    try {
      const home = env?.RUFLO_SOURCE_PATCH_HOME || os.userInfo().homedir;
      let dir = home;
      for (const part of ['.ruflo-source-patch', 'hook-failures', 'recall']) {
        dir = path.join(dir, part);
        try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (part !== '.ruflo-source-patch' && (stat.mode & 0o077))
          || (process.getuid && stat.uid !== process.getuid())) return;
      }
      // A fixed 64-slot failure ring plus one success comparison: no directory scan,
      // locks, timers, unbounded files, raw prompts, values, keys or stderr.
      slot ??= retirementResult === 'confirmed' && !events.some(row => row.phase === 'operation-finish' && (row.state === 'timed out' || row.state === 'unavailable'))
        ? 'success.json' : 'failure-' + crypto.randomInt(64).toString().padStart(2, '0') + '.json';
      const bytes = JSON.stringify({ ...receipt, retirementResult, recordedAt: new Date().toISOString() }) + '\n';
      if (Buffer.byteLength(bytes) > 16384) return;
      const file = path.join(dir, slot);
      try { const s = fs.lstatSync(file); if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid())) return; }
      catch (error) { if (error.code !== 'ENOENT') return; }
      fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0), 0o600);
      fs.writeSync(fd, bytes);
    } catch { /* unavailable diagnostics must not affect recall or retirement */ }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  };
  return { note, safeCode,
    retired: result => { retirementResult = result; receipt.finishedElapsedMs = Date.now() - startedAt; note('retirement-result', { result }); persist(); },
    closed: (code, signal) => { note('child-close', { code, signal: safeCode(signal) }); if (retirementResult === 'unconfirmed') persist(); } };
}
export const diagnosticsSource = recallDiagnostics.toString();
