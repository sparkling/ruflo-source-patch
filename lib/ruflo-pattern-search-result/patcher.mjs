import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
export const NAME = 'ruflo-pattern-search-result';
const marker = 'ruflo-source-patch (#4714)';
export const TOOL_EDITS = [
  ["            const result = await bridge.bridgeSearchPatterns({ query, topK, minConfidence });\n", `            const result = await bridge.bridgeSearchPatterns({ query, topK, minConfidence });
            // ${marker}: absence is not a failed controller; preserve legacy reads.
            if (result?.error || result?.success === false)
                return { ...result, error: result.error || 'Native pattern read failed', degraded: true };
            const nativeEmpty = result?.controller === 'reasoningBank'
                && Array.isArray(result.results) && result.results.length === 0 && result.degraded !== true;
`],
  ["                    if (typeof raw !== 'string')\n                        return null;", "                    if (typeof raw !== 'string') throw new Error('Pattern reader returned no readable body');"],
  ["                        const parsed = JSON.parse(raw);\n                        const confidence =", "                        const parsed = JSON.parse(raw);\n                        if (!parsed || typeof parsed.pattern !== 'string') throw new Error('Invalid legacy pattern body');\n                        const confidence ="],
  ["                    catch {\n                        return null;\n                    }\n                };", "                    catch (error) { throw new Error('Legacy pattern body could not be decoded: ' + sanitizeError(error)); }\n                };"],
  ["                    results = (semantic?.results ?? [])\n                        .map(parseEntry)\n                        .filter((r) => r !== null);", `                    const semanticResults = [];
                    for (const candidate of (semantic?.results ?? [])) {
                        let parsed;
                        try { parsed = parseEntry(candidate); }
                        catch (previewError) {
                            // Native search may return a truncated preview. Read its
                            // exact original before deciding the body is malformed.
                            const key = candidate?.key ?? candidate?.id;
                            if (typeof key !== 'string' || !key) throw previewError;
                            const got = await getEntry({ key, namespace: 'pattern' });
                            if (!got || got.success === false || got.error || got.found !== true || !got.entry
                                || got.entry.key !== undefined && got.entry.key !== key
                                || got.entry.namespace !== undefined && got.entry.namespace !== 'pattern')
                                throw new Error(got?.error || 'Pattern preview exact read was not verified');
                            parsed = parseEntry({ ...got.entry, key, score: candidate.score });
                        }
                        if (parsed !== null) semanticResults.push(parsed);
                    }
                    results = semanticResults;`],
  ["                    if (semantic && semantic.success === false) {", "                    if (!semantic || semantic.success === false || semantic.error || !Array.isArray(semantic.results)) {"],
  ["                        semanticError = semantic.error ?? 'searchEntries returned success:false';", "                        semanticError = semantic?.error ?? 'Pattern semantic reader returned an invalid or refused result';"],
  ["                    const all = await listEntries({ namespace: 'pattern', limit: 200 });\n", `                    const all = await listEntries({ namespace: 'pattern', limit: 200 });
                    if (!all || all.success === false || all.error || !Array.isArray(all.entries))
                        throw new Error(all?.error || 'Pattern namespace listing failed');
`],
  ["                            if (!got?.found || !got.entry)\n                                continue;", `                            if (!got || got.success === false || got.error || got.found !== true || !got.entry)
                                throw new Error(got?.error || 'Listed pattern exact read was not verified');`],
  ["                            if (!key)\n                                continue;", "                            if (!key) throw new Error('Listed pattern has no exact record identity');"],
  ["                            entry = got.entry;", "                            if (got.entry.key !== undefined && got.entry.key !== key || got.entry.namespace !== undefined && got.entry.namespace !== 'pattern')\n                                throw new Error('Listed pattern exact read identity differs');\n                            entry = got.entry;"],
  ["                // #1889 — controller label must match pattern-store's so the smoke", `                if (nativeEmpty && results.length === 0 && !semanticError) return {
                    ...result, degraded: false, status: 'no-match',
                    legacyLookup: { namespace: 'pattern', tier, substringLimit: 200,
                        qualification: 'Existing bounded legacy lookup also returned no match; not a complete pattern inventory.' },
                };
                // #1889 — controller label must match pattern-store's so the smoke`],
  ["                return { results: [], controller: 'unavailable', fallbackError: sanitizeError(fallbackErr) };", "                return { results: [], controller: 'unavailable', degraded: true, error: sanitizeError(fallbackErr), fallbackError: sanitizeError(fallbackErr) };"],
];
export const BRIDGE_EDITS = [
  [" * search returns nothing. Returns [] when the table or handle is unavailable.", " * search returns nothing. Refuses unavailable/failed reads rather than claiming absence."],
  ["        if (!db || typeof db.prepare !== 'function')\n            return [];\n        const like =", "        if (!db || typeof db.prepare !== 'function')\n            throw new Error('Native pattern substring reader unavailable');\n        const like ="],
  ["    catch {\n        return [];\n    }\n}\n/**\n * Search patterns via ReasoningBank controller.", `    catch (error) {
        // An unsuccessful read must not become a healthy empty.
        throw error;
    }
}
/**
 * Search patterns via ReasoningBank controller.`],
  ["            let mapped = Array.isArray(results) ? results.map((r) => ({", "            if (!Array.isArray(results)) throw new Error('Invalid native ReasoningBank search result');\n            let mapped = Array.isArray(results) ? results.map((r) => ({"],
  ["        bridgeFailureReasons.set(canonicalDbPath(options.dbPath), err instanceof Error ? err.message : String(err));\n        return null;\n    }\n}\n// ===== Phase 3: Feedback recording =====", `        bridgeFailureReasons.set(canonicalDbPath(options.dbPath), err instanceof Error ? err.message : String(err));
        // ${marker}: preserve the failure instead of normalizing it to absence.
        return { results: [], success: false, controller: 'reasoningBank',
            error: 'Native pattern search failed: ' + (err instanceof Error ? err.message : String(err)).replace(/\\/[^\\s:]+\\//g, '<path>/').slice(0, 500) };
    }
}
// ===== Phase 3: Feedback recording =====`],
];
export const LEGACY_BRIDGE_EDITS = [
  ["            return {\n                results: Array.isArray(results) ? results.map((r) => ({", "            if (!Array.isArray(results)) throw new Error('Invalid native ReasoningBank search result');\n            return {\n                results: Array.isArray(results) ? results.map((r) => ({"],
  BRIDGE_EDITS.at(-1),
];
const edits = source => !source.includes('export async function bridgeSearchPatterns(options) {') ? TOOL_EDITS
  : source.includes('function substringSearchReasoningPatterns(') ? BRIDGE_EDITS : LEGACY_BRIDGE_EDITS;
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(marker);
export const isPatched = source => count(source, marker) === 1 && edits(source).every(([, next]) => count(source, next) === 1);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || !edits(source).every(([old]) => count(source, old) === 1))
    return { next: source, applied: [], missing: ['native-pattern-search-result-anchors'] };
  return { next: edits(source).reduce((s, [old, next]) => s.replace(old, () => next), source), applied: [NAME], missing: [] };
}
export const reverse = source => isPatched(source) ? edits(source).reduceRight((s, [old, next]) => s.replace(next, () => old), source) : source;
export const discover = () => [
  ...discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'agentdb-tools.js']),
  ...discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js']),
];
export function preflight() {
  const groups = new Map(), errors = [], blockedFiles = [];
  for (const file of discover()) {
    const root = path.resolve(path.dirname(file), '..');
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(file);
  }
  for (const [root, files] of groups) {
    const failed = files.length !== 2 || files.some(file => {
      const stat = fs.lstatSync(file);
      return !stat.isFile() || stat.isSymbolicLink() || patchSource(fs.readFileSync(file, 'utf8')).missing.length;
    });
    if (failed) { errors.push(root + ': both native pattern search surfaces must qualify'); blockedFiles.push(...files); }
  }
  return { ok: !errors.length, errors, ...(errors.length ? { blockedFiles } : {}) };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, discover, preflight, patchSource, hasPatch, isPatched, reverse };
