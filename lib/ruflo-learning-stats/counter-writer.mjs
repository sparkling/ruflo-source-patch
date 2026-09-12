// #2245 follow-up: process snapshots are not safe multi-process counter writes.
export const COUNTER_LOAD_OLD = `function loadPersistedStats() {
    try {
        const path = getStatsPath();
        if (existsSync(path)) {
            const data = JSON.parse(readFileSync(path, 'utf-8'));
            if (data && typeof data === 'object') {
                // #2245: previously only restored trajectoriesRecorded — patternsLearned
                // and signalsProcessed reset to zero on every restart, masking real
                // learning progress in the dashboards.
                globalStats.trajectoriesRecorded = data.trajectoriesRecorded ?? 0;
                globalStats.patternsLearned = data.patternsLearned ?? 0;
                globalStats.signalsProcessed = data.signalsProcessed ?? 0;
                globalStats.lastAdaptation = data.lastAdaptation ?? null;
            }
        }
    }
    catch {
        // Ignore load errors, start fresh
    }
}`;
export const COUNTER_SAVE_OLD = `function savePersistedStats() {
    try {
        ensureDataDir();
        const path = getStatsPath();
        writeFileSync(path, JSON.stringify(globalStats, null, 2), 'utf-8');
    }
    catch {
        // Ignore save errors
    }
}`;

// Kept as ordinary functions so the injected source has syntax and behaviour tests.
function counterSupport() {
  // ruflo-source-patch (ruvnet/ruflo#2245): commit deltas, never stale totals.
  let counterBaseline = { trajectoriesRecorded: 0, patternsLearned: 0, signalsProcessed: 0 };
  let counterPath = null;
  let counterPersistenceError = null;
  const counterFields = ['trajectoriesRecorded', 'patternsLearned', 'signalsProcessed'];
  function readCounterSnapshot(file) {
    const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {};
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid learning counter store');
    for (const key of counterFields) {
      if (data[key] === undefined) data[key] = 0;
      if (!Number.isSafeInteger(data[key]) || data[key] < 0) throw new Error('Invalid learning counter ' + key);
    }
    return data;
  }
  function loadPersistedStats() {
    try {
      const file = getStatsPath();
      const data = readCounterSnapshot(file);
      globalStats = { ...globalStats, ...data };
      counterBaseline = { ...globalStats };
      counterPath = file;
      counterPersistenceError = null;
    } catch (error) {
      // Never turn a corrupt store into an apparent empty one on the next save.
      counterPersistenceError = String(error?.message || error);
    }
  }
  function savePersistedStats() {
    let lockHeld = false;
    let lock;
    let temp;
    try {
      ensureDataDir();
      const file = getStatsPath();
      if (counterPath && counterPath !== file) throw new Error('Counter path changed; reload the intended project before saving');
      const delta = {};
      for (const key of counterFields) {
        delta[key] = globalStats[key] - counterBaseline[key];
        if (!Number.isSafeInteger(delta[key]) || delta[key] < 0) throw new Error('Invalid pending learning counter delta ' + key);
      }
      lock = file + '.rsp-counter-lock';
      const deadline = Date.now() + 1000;
      const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
      while (!lockHeld) {
        try { mkdirSync(lock); lockHeld = true; }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          if (Date.now() >= deadline) throw new Error('Learning counter writer lock busy; pending deltas retained in process');
          Atomics.wait(waitBuffer, 0, 0, 10);
        }
      }
      // Do not steal a stale lock or kill its owner. A failure is visible and bounded.
      const latest = readCounterSnapshot(file);
      const merged = { ...latest };
      for (const key of counterFields) {
        merged[key] = latest[key] + delta[key];
        if (!Number.isSafeInteger(merged[key])) throw new Error('Learning counter overflow');
      }
      merged.lastAdaptation = Math.max(Number(latest.lastAdaptation) || 0, Number(globalStats.lastAdaptation) || 0) || null;
      temp = file + '.rsp-' + process.pid + '-' + Math.random().toString(16).slice(2) + '.tmp';
      writeFileSync(temp, JSON.stringify(merged, null, 2), { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
      renameSync(temp, file);
      temp = null;
      globalStats = merged;
      counterBaseline = { ...merged };
      counterPath = file;
      counterPersistenceError = null;
      return true;
    } catch (error) {
      counterPersistenceError = String(error?.message || error);
      // Keep increments pending; the next normal flush can retry without duplication.
      return false;
    } finally {
      if (temp) { try { rmSync(temp); } catch {} }
      if (lockHeld) { try { rmdirSync(lock); } catch {} }
    }
  }
}
const body = counterSupport.toString();
export const COUNTER_SUPPORT_NEW = body.slice(body.indexOf('{') + 1, body.lastIndexOf('}')).trim();
export const COUNTER_SAVE_NEW = '// ruflo-source-patch: savePersistedStats is defined with the counter-delta support above.';
export const COUNTER_IMPORT_OLD = "import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';";
export const COUNTER_IMPORT_NEW = "import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, rmdirSync } from 'node:fs';";
