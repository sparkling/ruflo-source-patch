// Adapt the existing segmented ledger to Ruflo 3.56's native secondary anchors.
// The native anchor verifier still owns every decision. Its indexed receipt reads
// see the complete logical chain without expanding it under the transaction lock.
export function anchorReceiptView() {
    function rspAnchorState(root, state) {
        const offset = state.policyArchive?.length ?? 0;
        if (!offset) return state;
        const length = offset + state.receipts.length;
        const receipts = new Proxy([], { get(_target, property) {
            if (property === 'length') return length;
            if (typeof property !== 'string' || !/^(0|[1-9][0-9]*)$/.test(property))
                throw new Error('policy-anchor-unsupported-receipt-access');
            const index = Number(property);
            if (index >= offset) return state.receipts[index - offset];
            let head = state.policyArchive.head, end = offset;
            let receiptHead = state.policyArchive.receiptHead;
            while (head !== null) {
                const segment = rspReadSegment(root, head);
                if (segment.from + segment.receipts.length !== end
                    || segment.receipts.at(-1).hash !== receiptHead)
                    throw new Error('policy-archive-chain-mismatch');
                if (index >= segment.from) return segment.receipts[index - segment.from];
                head = segment.previous; end = segment.from;
                receiptHead = segment.previousReceiptHash;
            }
            throw new Error('policy-anchor-receipt-not-found');
        } });
        return { ...state, receipts };
    }
}
const view = anchorReceiptView.toString().replace(/^function anchorReceiptView\(\) \{\n/, '').replace(/\n\}$/, '');
export function anchoredRuntimeEdits(edits) {
    return edits.map(([a, b, n]) => {
        if (a === "const POLICY_DIR = join('.claude-flow', 'policy');")
            return [a, b.replace(a, view + '\n' + a), n];
        if (a === 'AgenticPolicyEngine.fromState(loadPolicyState(projectRoot),') return [a, b, 1];
        if (a.includes("if (result.anchor === 'established-now')")) {
            const original = `        if (outcome.persist) {
            const by = outcome.event === 'establish-anchor' ? userInfo().username : undefined;
            await writePolicyState(projectRoot, target.state, engine.exportState(), outcome.event, by);
        }
        return outcome.result;`;
            return [original, original.replace('        return outcome.result;',
                b.slice(b.indexOf('        // Immutable archived segments')).replaceAll('result', 'outcome.result')), n];
        }
        return [a, b, n];
    }).concat([
        ['        const loaded = loadPolicyState(projectRoot);',
            '        const loaded = loadPolicyState(projectRoot, { compact: true });'],
        ['    const length = state.receipts.length;',
            '    const length = (state.policyArchive?.length ?? 0) + state.receipts.length;'],
        ['assessAnchors(projectRoot, state, options.establishAnchor === true)',
            'assessAnchors(projectRoot, rspAnchorState(projectRoot, state), options.establishAnchor === true)'],
        ['recordAnchor(projectRoot, state, writeJsonAtomic, anchorEvent, by)',
            'recordAnchor(projectRoot, rspAnchorState(projectRoot, state), writeJsonAtomic, anchorEvent, by)'],
    ]);
}
export const anchoredEngineEdits = edits => edits.map(([a, b, n]) =>
    [a.replace('verifyLedger()', 'verifyLedger(options = {})'),
        b.replace('verifyLedger()', 'verifyLedger(options = {})'), n]);
