// Capture-private adaptation of native populated-directory publication and fenced takeover.
// No updater imports, update paths, persistence driver, queue or observation replay.
export const OWNERSHIP_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#521 capture-ownership)';
export const OWNERSHIP = String.raw`
// ruflo-source-patch (stuinfla/ruvnet-brain#521 capture-ownership)
const captureGates = new Set();
const captureTokens = new Map();
const captureIdentity = stat => [stat.dev, stat.ino].join(':');
function captureProcessStart(pid) {
  if (process.platform !== 'linux') return null;
  try { const start = fs.readFileSync('/proc/' + pid + '/stat', 'utf8').split(') ').at(-1).split(' ')[19]; return /^\d+$/.test(start || '') ? start : null; }
  catch { return null; }
}
const captureOwnStart = captureProcessStart(process.pid);
function captureOwnerDead(owner) {
  if (!Number.isInteger(owner?.pid) || owner.pid < 1) throw Error('capture admission owner unknown');
  if (owner.start != null && (typeof owner.start !== 'string' || !/^\d+$/.test(owner.start)))
    throw Error('capture admission owner unknown');
  try { process.kill(owner.pid, 0); }
  catch (error) { return error.code === 'ESRCH'; }
  const start = owner.start && captureProcessStart(owner.pid);
  return Boolean(start && start !== owner.start);
}
function captureReadOwner(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('capture admission owner unknown');
  const raw = fs.readFileSync(file, 'utf8'), owner = JSON.parse(raw);
  if (!Number.isInteger(owner?.pid) || owner.pid < 1 || typeof owner.token !== 'string' || owner.token.length !== 36)
    throw Error('capture admission owner unknown');
  if (owner.start != null && (typeof owner.start !== 'string' || !/^\d+$/.test(owner.start)))
    throw Error('capture admission owner unknown');
  return { raw, owner };
}
function captureObserveGate(directory) {
  const stat = fs.lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('capture admission gate unknown');
  return { identity: captureIdentity(stat), ...captureReadOwner(path.join(directory, 'owner.json')) };
}
function captureGateClaims(directory) {
  const entries = fs.readdirSync(directory);
  if (entries.some(name => name !== 'owner.json' && !/^claim-\d+\.json$/.test(name)))
    throw Error('capture admission recovery contents unknown');
  const names = entries.filter(name => /^claim-\d+\.json$/.test(name));
  if (names.length > 32) throw Error('capture admission recovery exhausted');
  if (names.some(name => !Number.isSafeInteger(Number(name.slice(6, -5)))))
    throw Error('capture admission recovery contents unknown');
  for (const name of names) captureReadOwner(path.join(directory, name));
  return names;
}
function captureReclaimGate(directory, observed, owner, ownerFile) {
  // Immutable numbered claims fence competing reclaimers of this directory instance.
  // A paused live claimant is NEVER displaced by age. Dead claims remain until their directory is retired.
  const names = captureGateClaims(directory);
  const highest = names.reduce((n, name) => Math.max(n, Number(name.slice(6, -5))), -1);
  if (highest >= Number.MAX_SAFE_INTEGER) throw Error('capture admission recovery exhausted');
  let claim = null;
  for (const name of names) {
    const held = captureReadOwner(path.join(directory, name)).owner;
    if (typeof held.gate !== 'string' || typeof held.gateOwner !== 'string') throw Error('capture admission claim unknown');
    // A preempted observer may have linked its claim into a replacement directory. It owns no part of that instance.
    if (held.gate !== observed.identity || held.gateOwner !== observed.raw) continue;
    if (held.token === owner.token) claim = name;
    else if (!captureOwnerDead(held)) return false;
  }
  if (!claim) {
    claim = 'claim-' + (highest + 1) + '.json';
    const stagedClaim = ownerFile + '.claim-' + randomUUID();
    let fd = null, stagedOwned = false;
    // Publish a complete immutable, instance-bound claim with one exclusive link.
    try {
      fd = fs.openSync(stagedClaim, 'wx', 0o600); stagedOwned = true;
      fs.writeFileSync(fd, JSON.stringify({ ...owner, gate: observed.identity, gateOwner: observed.raw }));
      fs.closeSync(fd); fd = null;
      fs.linkSync(stagedClaim, path.join(directory, claim));
    } catch (error) { if (['EEXIST', 'ENOENT'].includes(error.code)) return false; throw error; }
    finally {
      if (fd !== null) try { fs.closeSync(fd); } catch { /* original operation remains failed */ }
      if (stagedOwned) try { fs.unlinkSync(stagedClaim); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  const current = captureObserveGate(directory);
  if (current.identity !== observed.identity || current.raw !== observed.raw
    || captureReadOwner(path.join(directory, claim)).owner.token !== owner.token) return false;
  // The old owner is dead and our live claim fences every other reclaimer. No live owner can replace this instance.
  const tomb = directory + '.retired-' + owner.token;
  fs.renameSync(directory, tomb);
  if (captureObserveGate(tomb).identity !== observed.identity
    || captureReadOwner(path.join(tomb, claim)).owner.token !== owner.token)
    throw Error('capture admission recovery identity changed');
  fs.rmSync(tomb, { recursive: true });
  return true;
}
function withCaptureGate(brainHome, fn) {
  const directory = path.join(learnDir(brainHome, ''), 'admission.lock');
  if (captureGates.has(directory)) return fn(); // synchronous nested metadata helpers only
  const owner = { pid: process.pid, start: captureOwnStart, token: randomUUID() };
  const staged = directory + '.staged-' + owner.token;
  const deadline = Date.now() + 100;
  let held = null, stagedOwned = false;
  try {
    fs.mkdirSync(staged, { mode: 0o700 });
    stagedOwned = true;
    fs.writeFileSync(path.join(staged, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
    for (;;) {
      if (Date.now() >= deadline) throw Error('capture admission contended');
      let observed = null;
      try {
        observed = captureObserveGate(directory);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (fs.existsSync(directory)) throw Error('capture admission owner unknown');
      }
      if (observed) {
        captureGateClaims(directory);
        try { if (captureOwnerDead(observed.owner) && captureReclaimGate(directory, observed, owner, path.join(staged, 'owner.json'))) continue; }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      } else {
        try { fs.renameSync(staged, directory); held = captureObserveGate(directory); break; }
        catch (error) { if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) throw error; }
      }
      if (Date.now() >= deadline) throw Error('capture admission contended');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
    captureGates.add(directory);
    return fn();
  } finally {
    captureGates.delete(directory);
    if (held) {
      const current = captureObserveGate(directory);
      if (current.identity !== held.identity || current.owner.token !== owner.token) throw Error('capture admission release identity changed');
      captureGateClaims(directory);
      const tomb = directory + '.released-' + owner.token;
      fs.renameSync(directory, tomb);
      if (captureObserveGate(tomb).identity !== held.identity) throw Error('capture admission release identity changed');
      fs.rmSync(tomb, { recursive: true });
    } else if (stagedOwned) {
      try { fs.rmSync(staged, { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
function captureSlotRecord(slot) {
  const stat = fs.lstatSync(slot);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('capture slot owner unknown');
  const owner = JSON.parse(fs.readFileSync(slot, 'utf8'));
  if (!Number.isInteger(owner?.pid) || owner.pid < 1
    || (owner.start != null && (typeof owner.start !== 'string' || !/^\d+$/.test(owner.start)))
    || (owner.token != null && (typeof owner.token !== 'string' || owner.token.length !== 36)))
    throw Error('capture slot owner unknown');
  return owner;
}
function captureWriteSlot(slot, record, create = false) {
  const staged = slot + '.record-' + randomUUID();
  let fd = null, owned = false;
  try {
    fd = fs.openSync(staged, 'wx', 0o600); owned = true;
    fs.writeFileSync(fd, JSON.stringify(record)); fs.closeSync(fd); fd = null;
    if (create) fs.linkSync(staged, slot);
    else fs.renameSync(staged, slot); // matching token already proved while holding the metadata gate
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* original operation remains failed */ }
    if (owned) try { fs.unlinkSync(staged); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function captureTokenActive(brainHome, token) {
  if (typeof token !== 'string' || token.length !== 36) return false;
  for (let i = 0; i < OBSERVE_SLOTS; i++) {
    try {
      const held = captureSlotRecord(path.join(learnDir(brainHome, 'slots'), 'slot-' + i));
      if (held.token === token && !captureOwnerDead(held)) return true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return false;
}
function capturePendingFresh(brainHome, key, now = Date.now()) {
  const file = inFlightMarker(brainHome, key);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('capture pending owner unknown');
    return now - stat.mtimeMs < SLOT_STALE_MS || captureTokenActive(brainHome, fs.readFileSync(file, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function captureAdmit(brainHome, key) {
  return withCaptureGate(brainHome, () => {
    if (recentlyCaptured(brainHome, key) || capturePendingFresh(brainHome, key)) return { coalesced: true };
    const slot = acquireObserveSlot(brainHome);
    if (!slot) return null;
    const token = captureTokens.get(slot);
    try { fs.writeFileSync(inFlightMarker(brainHome, key), token, { mode: 0o600 }); }
    catch (error) { releaseObserveSlot(slot, process.pid, token, brainHome); throw error; }
    return { slot, token };
  });
}
function captureValidSlot(brainHome, slot) {
  return typeof slot === 'string' && Array.from({ length: OBSERVE_SLOTS }, (_, i) => path.join(brainHome, 'learn-capture', 'slots', 'slot-' + i)).includes(slot);
}
function captureHandoff(brainHome, slot, token, pid, child = false) {
  if (!slot || typeof token !== 'string' || token.length !== 36 || !Number.isInteger(pid) || pid < 1) return false;
  if (!captureValidSlot(brainHome, slot)) throw Error('capture slot path refused');
  return withCaptureGate(brainHome, () => {
    let held; try { held = captureSlotRecord(slot); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if (held.token !== token || (!child && held.pid !== process.pid && held.pid !== pid)) return false;
    captureWriteSlot(slot, { ...held, pid, start: captureProcessStart(pid), at: Date.now() });
    captureTokens.set(slot, token); return true;
  });
}
`;
