import { COUNTER_SUPPORT_NEW } from './counter-writer.mjs';
// Ruflo 3.56.10: native deltas still require serialization across writers (#2245).
export const COUNTER_IMPORT_NATIVE = "import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';";
export const COUNTER_LOAD_NATIVE = "function loadPersistedStats() {\n    persistedStatsLoaded = true;\n    const data = readStatsFile();\n    if (!data)\n        return;\n    // #2245: previously only restored trajectoriesRecorded \u2014 patternsLearned\n    // and signalsProcessed reset to zero on every restart, masking real\n    // learning progress in the dashboards. Unsaved local increments are\n    // re-applied on top so a late load never drops them.\n    globalStats.trajectoriesRecorded = (data.trajectoriesRecorded ?? 0) + pendingDelta.trajectoriesRecorded;\n    globalStats.patternsLearned = (data.patternsLearned ?? 0) + pendingDelta.patternsLearned;\n    globalStats.signalsProcessed = (data.signalsProcessed ?? 0) + pendingDelta.signalsProcessed;\n    globalStats.lastAdaptation = maxTimestamp(data.lastAdaptation ?? null, globalStats.lastAdaptation);\n}";
export const COUNTER_SAVE_NATIVE = "function savePersistedStats() {\n    try {\n        ensureDataDir();\n        const path = getStatsPath();\n        const disk = readStatsFile();\n        const merged = disk\n            ? {\n                trajectoriesRecorded: (disk.trajectoriesRecorded ?? 0) + pendingDelta.trajectoriesRecorded,\n                patternsLearned: (disk.patternsLearned ?? 0) + pendingDelta.patternsLearned,\n                signalsProcessed: (disk.signalsProcessed ?? 0) + pendingDelta.signalsProcessed,\n                lastAdaptation: maxTimestamp(disk.lastAdaptation ?? null, globalStats.lastAdaptation),\n            }\n            : { ...globalStats };\n        const tmp = `${path}.${process.pid}.tmp`;\n        writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');\n        renameSync(tmp, path);\n        globalStats = merged;\n        pendingDelta = { trajectoriesRecorded: 0, patternsLearned: 0, signalsProcessed: 0 };\n        persistedStatsLoaded = true;\n    }\n    catch {\n        // Ignore save errors (deltas are retained for the next save)\n    }\n}";

// Reuse the existing serializer while retaining native pending increments on late load/retry.
export const COUNTER_SUPPORT_NATIVE = COUNTER_SUPPORT_NEW
  .replace('      globalStats = { ...globalStats, ...data };',
    `      globalStats = { ...globalStats, ...data };
      for (const key of counterFields) globalStats[key] += pendingDelta[key];
      persistedStatsLoaded = true;`)
  .replace('globalStats[key] - counterBaseline[key]', 'pendingDelta[key]')
  .replace('      return true;',
    `      pendingDelta = { trajectoriesRecorded: 0, patternsLearned: 0, signalsProcessed: 0 };
      persistedStatsLoaded = true;
      return true;`);
export const COUNTER_SUPPORT_NATIVE_PREVIOUS = COUNTER_SUPPORT_NATIVE.replace(
  "lock = __rspCounterJoin(realpathSync(__rspCounterDir(file)), __rspCounterBase(file)) + '.lock';", "lock = file + '.rsp-counter-lock';");
