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
  [`            patternId,
            controller: 'bridge-fallback',
            hasEmbedding: !!result.embedding,`,
    `            patternId,
            namespace: 'pattern',
            verified: true,
            controller: 'bridge-fallback',
            hasEmbedding: !!result.embedding,`],
];
const count = (source, text) => source.split(text).length - 1;
export const isBridgeSource = source => source.includes('export async function bridgeStorePattern(options) {');
export const hasBridgePatch = source => source.includes(BRIDGE_MARKER);
export const isBridgePatched = source => count(source, BRIDGE_MARKER) === 1
  && BRIDGE_EDITS.every(([, replacement]) => count(source, replacement) === 1);
export function patchBridgeSource(source) {
  if (isBridgePatched(source)) return { next: source, applied: [], missing: [] };
  if (!isBridgeSource(source) || hasBridgePatch(source)
      || BRIDGE_EDITS.some(([anchor]) => count(source, anchor) !== 1)) {
    return { next: source, applied: [], missing: ['native-bridge-pattern-receipt-anchors'] };
  }
  return { next: BRIDGE_EDITS.reduce((text, [anchor, replacement]) => text.replace(anchor, replacement), source),
    applied: ['ruflo-pattern-receipt/bridge'], missing: [] };
}
export const reverseBridgeSource = source => BRIDGE_EDITS.reduceRight(
  (text, [anchor, replacement]) => text.replace(replacement, anchor), source);
