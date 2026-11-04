// Ruflo #2922 / #3004: use the existing native backend reporter for plain search.
// Reporting only; preserve native storage, ranking, filtering and fallback policy.
export const NAME = 'ruflo-memory-search-report';
export const NATIVE_HELPER = "async function describeBackend() {\n    try {\n        const { getHNSWStatus } = await import('../memory/memory-initializer.js');\n        const status = getHNSWStatus();\n        if (status.algorithm !== 'hnsw')\n            return 'sqlite (bridge, brute-force cosine)';\n        // #3228: with the native bridge gated off (the Windows default since\n        // 3.38.12), memory tools silently fall back to the sql.js store rather\n        // than the AgentDB corpus the bridge would have opened. A bare\n        // \"sql.js + HNSW\" hides that substitution \u2014 an upgrade can change which\n        // file receives writes while store/retrieve smoke tests still pass,\n        // because both operations use the same unintended file. Name the gate.\n        try {\n            const { shouldDisableNativeBridge, getBridgeFailureReason } = await import('../memory/memory-bridge.js');\n            if (shouldDisableNativeBridge()) {\n                const reason = getBridgeFailureReason();\n                return `sql.js + HNSW (native bridge disabled${reason ? `: ${reason}` : ''})`;\n            }\n        }\n        catch {\n            // bridge module unavailable \u2014 the plain sql.js label is already accurate\n        }\n        return 'sql.js + HNSW';\n    }\n    catch {\n        return 'sqlite';\n    }\n}\n";
export const SEARCH_REPORT = "                    searchTime: `${duration.toFixed(2)}ms`,\n                    backend: 'HNSW + sql.js',\n                    ...(smartFallbackReason ? { smartFallback: smartFallbackReason } : {}),";
export const FIXED_REPORT = SEARCH_REPORT.replace("backend: 'HNSW + sql.js'", 'backend: await describeBackend()');
export const PATCHED_REPORT = FIXED_REPORT.replace('backend: await describeBackend(),',
  'backend: await describeBackend(), // ruflo-source-patch (#2922)');
const count = (source, needle) => source.split(needle).length - 1;
export const nativeSearchReporting = source => count(source, NATIVE_HELPER) === 1
  && count(source, SEARCH_REPORT) === 0 && count(source, FIXED_REPORT) === 1;
export const SEARCH_REPORT_ENTRIES = [{
  id: NAME + '/native-backend-label', target: NAME,
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'memory-tools.js'],
  nativeSatisfied: nativeSearchReporting,
  edits: [
    // The exact helper is an applicability anchor; no local reporter is injected.
    { find: NATIVE_HELPER, replace: NATIVE_HELPER },
    { find: SEARCH_REPORT, replace: PATCHED_REPORT },
  ],
}];
