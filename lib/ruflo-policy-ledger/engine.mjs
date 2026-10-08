// Exact native 3.0.1 security-engine anchors; independently derived for #3164.
// Authorization, receipt content, hashing and signature verification are unchanged.
export const ENGINE_EDITS = [
  ['        return engine;\n    }\n    exportState()',
    '        if (state.policyArchive !== undefined) engine.state.policyArchive = structuredClone(state.policyArchive);\n        return engine;\n    }\n    exportState()'],
  ['    verifyLedger() {\n        let previous = null;', `    verifyLedger() {
        // ruflo-source-patch (ruflo#3164 segmented engine)
        const offset = this.state.policyArchive?.length ?? 0;
        if (!Number.isSafeInteger(offset) || offset < 0
            || (offset > 0 && !/^sha256:[a-f0-9]{64}$/.test(this.state.policyArchive?.receiptHead)))
            return { valid: false, length: 0, error: 'policy-archive-invalid-boundary' };
        let previous = offset > 0 ? this.state.policyArchive.receiptHead : null;`],
  ['receipt.payload.sequence !== i ||', 'receipt.payload.sequence !== offset + i ||'],
  ["return { valid: false, length: i, error:", "return { valid: false, length: offset + i, error:", 5],
  ['        const length = this.state.receipts.length;', '        const length = offset + this.state.receipts.length;'],
  ['        const previous = this.state.receipts.at(-1)?.hash ?? null;',
    '        const offset = this.state.policyArchive?.length ?? 0;\n        const previous = this.state.receipts.at(-1)?.hash ?? this.state.policyArchive?.receiptHead ?? null;'],
  ['this.state.ledgerLength !== this.state.receipts.length', 'this.state.ledgerLength !== offset + this.state.receipts.length'],
  ['this.state.receipts.length < this.state.ledgerLength', 'offset + this.state.receipts.length < this.state.ledgerLength'],
  ['        const sequence = this.state.receipts.length;', '        const sequence = offset + this.state.receipts.length;'],
  ['        this.state.ledgerLength = this.state.receipts.length;', '        this.state.ledgerLength = offset + this.state.receipts.length;'],
];
