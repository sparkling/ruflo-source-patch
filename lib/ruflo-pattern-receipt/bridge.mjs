// #3691: the native pattern bridge must not turn a refused CRUD result into
// success before its MCP boundary sees it. Exact native reads use the same path.
export const BRIDGE_MARKER = 'ruflo-source-patch (ruflo#3691 bridge)';
export const BRIDGE_EDITS = [
  [`        if (!result)
            return null;
        // Add to HNSW index for fast semantic search (bridgeStoreEntry stores SQL only)`,
    `        if (!result)
            return null;
        // ${BRIDGE_MARKER}: preserve failure and prove the exact fallback value.
        const failure = error => ({ success: false, patternId, namespace: 'pattern',
            controller: 'bridge-fallback', reason: 'pattern-persistence-unconfirmed', error });
        if (result.success !== true)
            return failure(result.error || 'Pattern bridge store did not confirm success');
        if (result.persistWarning)
            return failure('Pattern bridge durability warning: ' + result.persistWarning);
        let readback;
        try {
            readback = await bridgeGetEntry({ key: patternId, namespace: 'pattern', dbPath: options.dbPath });
        }
        catch (error) {
            return failure('Pattern bridge exact readback refused: ' + (error instanceof Error ? error.message : String(error)));
        }
        if (readback?.success !== true || readback.found !== true || readback.entry?.key !== patternId
            || readback.entry.namespace !== 'pattern' || readback.entry.content !== patternValue)
            return failure('Pattern bridge exact readback failed: ' + (readback?.error || 'stored value not verified'));
        // Add to HNSW index for fast semantic search (bridgeStoreEntry stores SQL only)`],
  [`        return {
            success: true,
            patternId,
            controller: 'bridge-fallback',
            hasEmbedding: !!result.embedding,`,
    `        return {
            success: true,
            patternId,
            namespace: 'pattern',
            verified: true,
            controller: 'bridge-fallback',
            hasEmbedding: !!result.embedding,`],
];
export const LEGACY_BRIDGE_EDITS = [BRIDGE_EDITS[0],
  ["        return { success: true, patternId: result.id, controller: 'bridge-fallback' };", `        return {
            success: true,
            // Legacy fallback receipt retains the lookup key, not the SQL row id.
            patternId,
            namespace: 'pattern',
            verified: true,
            controller: 'bridge-fallback',
            hasEmbedding: !!result.embedding,
            ...(result.embeddingError ? { embeddingError: result.embeddingError } : {}),
        };`],
];
const variants = [BRIDGE_EDITS, LEGACY_BRIDGE_EDITS];
const count = (source, text) => source.split(text).length - 1;
const matching = (source, index) => variants.filter(edits => edits.every(pair => count(source, pair[index]) === 1));
export const isBridgeSource = source => source.includes('export async function bridgeStorePattern(options) {');
export const hasBridgePatch = source => source.includes(BRIDGE_MARKER);
export const isBridgePatched = source => count(source, BRIDGE_MARKER) === 1
  && matching(source, 1).length === 1;
export function patchBridgeSource(source) {
  if (isBridgePatched(source)) return { next: source, applied: [], missing: [] };
  const matches = matching(source, 0);
  if (!isBridgeSource(source) || hasBridgePatch(source) || matches.length !== 1) {
    return { next: source, applied: [], missing: ['native-bridge-pattern-receipt-anchors'] };
  }
  return { next: matches[0].reduce((text, [anchor, replacement]) => text.replace(anchor, replacement), source),
    applied: ['ruflo-pattern-receipt/bridge'], missing: [] };
}
export const reverseBridgeSource = source => isBridgePatched(source) ? matching(source, 1)[0].reduceRight(
  (text, [anchor, replacement]) => text.replace(replacement, anchor), source) : source;
