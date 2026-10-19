// Execute the shipped writer against a controlled cooperating-lock contract.
// Real native helper/concurrency acceptance lives in the opt-in native test.
import path from 'node:path';
const cache = new Map();
export function nativeCounterSource(source) {
  if (!source.includes("import { withStatsFileLock } from './stats-file-lock.js';")) return null;
  const functions = ['bumpStat', 'readStatsFile', 'loadPersistedStats', 'maxTimestamp', 'readStatsForWrite', 'savePersistedStats'];
  const bodies = functions.map(name => source.match(new RegExp(`^function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'))?.[0]);
  if (bodies.some(body => !body) || !bodies.at(-1).includes('withStatsFileLock(statsPath, (path) => {')) return null;
  return bodies.join('\n');
}
export function nativeCounterWriterSatisfied(source) {
  const body = nativeCounterSource(source);
  if (!body) return false;
  if (cache.has(body)) return cache.get(body);
  let result = false;
  try {
    const file = '/fixture/stats.json', files = new Map();
    let held = false, saving = false, busy = false, releaseFailure = false;
    const assert = value => { if (!value) throw Error('Native counter contract failed'); };
    const parse = () => JSON.parse(files.get(file));
    const io = {
      existsSync: p => files.has(p),
      readFileSync: p => { assert(!saving || held); if (!files.has(p)) throw Object.assign(Error('absent'), { code: 'ENOENT' }); return files.get(p); },
      writeFileSync: (p, text) => { assert(held); files.set(p, text); },
      renameSync: (a, b) => { assert(held); files.set(b, files.get(a)); files.delete(a); },
    };
    const lock = (p, callback) => {
      assert(p === file); if (busy) throw Object.assign(Error('busy'), { code: 'ELOCKED' });
      assert(!held); held = true;
      try { return callback(p); } finally { held = false; if (releaseFailure) throw Error('release diagnostic'); }
    };
    const make = () => new Function(...Object.keys(io), 'getStatsPath', 'ensureDataDir', 'join', 'withStatsFileLock', 'console', 'process', `
let globalStats={trajectoriesRecorded:0,patternsLearned:0,signalsProcessed:0,lastAdaptation:null};
let pendingDelta={trajectoriesRecorded:0,patternsLearned:0,signalsProcessed:0};
let persistedStatsLoaded=false;
${body}
return {load:loadPersistedStats,save:savePersistedStats,bump:n=>bumpStat('signalsProcessed',n),pending:()=>pendingDelta.signalsProcessed};`)(
      ...Object.values(io), () => file, () => '/fixture', path.join, lock, { warn() {} }, { pid: 7 });
    const save = writer => { saving = true; try { writer.save(); } finally { saving = false; } };
    files.set(file, JSON.stringify({ trajectoriesRecorded: 10, patternsLearned: 20, signalsProcessed: 30, lastAdaptation: 99 }));
    const a = make(), b = make(); a.bump(2); a.load(); b.load(); b.bump(3);
    save(a); save(b); assert(parse().signalsProcessed === 35); save(a); assert(parse().signalsProcessed === 35);
    busy = true; b.bump(4); const prior = files.get(file); save(b); assert(files.get(file) === prior && b.pending() === 4);
    busy = false; save(b); assert(parse().signalsProcessed === 39 && b.pending() === 0);
    for (const invalid of ['malformed', '[]', '{"signalsProcessed":-1}', '{"signalsProcessed":"9"}']) {
      files.set(file, invalid); a.bump(1); save(a); assert(files.get(file) === invalid);
    }
    files.set(file, JSON.stringify({ trajectoriesRecorded: 10, patternsLearned: 20, signalsProcessed: 39, lastAdaptation: 99 }));
    save(a); assert(parse().signalsProcessed === 43 && a.pending() === 0);
    releaseFailure = true; b.bump(1); save(b); assert(parse().signalsProcessed === 44 && b.pending() === 0);
    releaseFailure = false; save(b); assert(parse().signalsProcessed === 44);
    files.set(file, JSON.stringify({ signalsProcessed: Number.MAX_SAFE_INTEGER }));
    a.bump(1); const overflow = files.get(file); save(a); assert(files.get(file) === overflow && a.pending() === 1);
    result = true;
  } catch { /* Unknown or weaker native behavior remains a visible incomplete patch. */ }
  cache.set(body, result); return result;
}
