// Bind the existing, race-tested directory ownership protocol to a private runner
// directory. OWNERSHIP is trusted repository source, not a downloaded/runtime input.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OWNERSHIP } from '../lib/brain-capture-launch/ownership.mjs';

const protocol = new Function('fs', 'path', 'randomUUID', 'process', OWNERSHIP + `
return { observe: captureObserveGate, dead: captureOwnerDead,
  reclaim: captureReclaimGate, start: captureOwnStart };
`)(fs, path, randomUUID, process);

export function acquireLock(state) {
  const directory = path.join(state, 'running.lock');
  const owner = { pid: process.pid, start: protocol.start, token: randomUUID(), started: new Date().toISOString() };
  const staged = directory + '.staged-' + owner.token;
  fs.mkdirSync(staged, { mode: 0o700 });
  let held;
  try {
    fs.writeFileSync(path.join(staged, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
    // Bound contention without expiring any live owner or stealing by age.
    for (let attempt = 0; attempt < 4; attempt++) {
      let observed;
      try { observed = protocol.observe(directory); }
      catch (error) {
        if (error.code !== 'ENOENT' || fs.existsSync(directory)) throw error;
      }
      if (observed) {
        if (!protocol.dead(observed.owner)) return null;
        if (!protocol.reclaim(directory, observed, owner, path.join(staged, 'owner.json'))) return null;
      }
      try { fs.renameSync(staged, directory); held = protocol.observe(directory); break; }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) throw error; }
    }
    if (!held) return null;
    return () => {
      const current = protocol.observe(directory);
      if (current.identity !== held.identity || current.raw !== held.raw)
        throw Error('hourly regression lock owner changed; release refused');
      const released = directory + '.released-' + owner.token;
      fs.renameSync(directory, released);
      if (protocol.observe(released).identity !== held.identity)
        throw Error('hourly regression release identity changed');
      fs.rmSync(released, { recursive: true });
    };
  } finally {
    if (!held) fs.rmSync(staged, { recursive: true, force: true });
  }
}
