import { policyHash, signPolicyHash, verifyPolicySignature } from './canonical.js';
import { evaluatePolicy } from './evaluator.js';
import { POLICY_STATE_VERSION } from './types.js';
function wildcard(pattern, value) {
    if (!pattern)
        return true;
    if (!value)
        return false;
    return pattern === '*' || pattern === value || (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1)));
}
export class AgenticPolicyEngine {
    now;
    signingKey;
    keyId;
    evidenceVerifier;
    approvalIssuerVerifier;
    state;
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.signingKey = options.signingKey;
        this.keyId = options.keyId;
        this.evidenceVerifier = options.evidenceVerifier;
        this.approvalIssuerVerifier = options.approvalIssuerVerifier;
        this.state = {
            version: POLICY_STATE_VERSION,
            mode: options.mode ?? 'legacy',
            rules: [...(options.rules ?? [])],
            budgets: [...(options.budgets ?? [])],
            usage: [...(options.usage ?? [])],
            approvals: [...(options.approvals ?? [])],
            receipts: [...(options.receipts ?? [])],
        };
    }
    static fromState(state, options = {}) {
        const engine = new AgenticPolicyEngine({
            ...options,
            mode: state.mode,
            rules: state.rules,
            budgets: state.budgets,
            usage: state.usage,
            approvals: state.approvals,
            receipts: state.receipts,
        });
        engine.state.migratedAt = state.migratedAt;
        engine.state.migratedFrom = state.migratedFrom;
        engine.state.configuredMode = state.configuredMode;
        if (typeof state.ledgerLength === 'number') {
            engine.state.ledgerLength = state.ledgerLength;
            engine.state.ledgerHead = state.ledgerHead ?? null;
        }
        return engine;
    }
    exportState() {
        return structuredClone(this.state);
    }
    setMode(mode) {
        this.state.mode = mode;
    }
    setConfiguredMode(mode) {
        this.state.configuredMode = mode;
        const rank = { legacy: 0, observe: 1, enforce: 2 };
        if (rank[mode] > rank[this.state.mode])
            this.state.mode = mode;
    }
    upsertRule(rule) {
        if (!rule.id || !rule.actions.length)
            throw new Error('invalid-policy-rule');
        for (const value of [
            rule.constraints?.maxCostUsd,
            rule.constraints?.maxTokens,
            rule.constraints?.maxConcurrency,
        ]) {
            if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
                throw new Error('invalid-policy-rule-limit');
            }
        }
        const index = this.state.rules.findIndex((item) => item.id === rule.id);
        if (index >= 0)
            this.state.rules[index] = structuredClone(rule);
        else
            this.state.rules.push(structuredClone(rule));
    }
    setBudget(limit) {
        if (limit.periodMs <= 0)
            throw new Error('invalid-budget-period');
        if (!Number.isFinite(limit.periodMs)
            || [limit.maxCostUsd, limit.maxTokens].some((value) => (value !== undefined && (!Number.isFinite(value) || value < 0))))
            throw new Error('invalid-budget-limit');
        const index = this.state.budgets.findIndex((item) => item.id === limit.id);
        if (index >= 0)
            this.state.budgets[index] = structuredClone(limit);
        else
            this.state.budgets.push(structuredClone(limit));
    }
    issueApproval(approval) {
        if (approval.issuedBy === approval.principal)
            throw new Error('self-approval-forbidden');
        if (this.approvalIssuerVerifier?.(approval.issuedBy) !== true) {
            throw new Error('untrusted-approval-issuer');
        }
        const issuedAt = approval.issuedAt ?? this.now();
        const record = { ...approval, issuedAt, uses: approval.uses ?? 0 };
        if (this.state.approvals.some((item) => item.id === record.id))
            throw new Error('duplicate-approval-id');
        if (!record.id
            || record.expiresAt <= issuedAt
            || !Number.isInteger(record.maxUses)
            || record.maxUses <= 0
            || !Number.isInteger(record.uses)
            || record.uses < 0
            || record.uses > record.maxUses)
            throw new Error('invalid-approval');
        this.state.approvals.push(record);
        return structuredClone(record);
    }
    revokeApproval(id) {
        const approval = this.state.approvals.find((item) => item.id === id);
        if (!approval || approval.revokedAt)
            return false;
        approval.revokedAt = this.now();
        return true;
    }
    evaluate(request) {
        const normalized = {
            ...request,
            requestId: request.requestId ?? crypto.randomUUID(),
            // Caller time is evidence only; expiry, budgets, and receipts always use
            // the authority's clock.
            context: { ...request.context, now: this.now() },
        };
        this.validateRequest(normalized);
        const verifiedEvidenceIds = (normalized.context?.evidence ?? [])
            .filter((evidence) => evidence.id && this.evidenceVerifier?.(evidence, normalized) === true)
            .map((evidence) => evidence.id);
        let decision = evaluatePolicy(normalized, this.state.rules, this.state.mode, verifiedEvidenceIds);
        decision = this.applyBudget(normalized, decision);
        decision = this.applyApproval(normalized, decision);
        const receipt = this.appendReceipt(normalized, decision);
        this.consumeBudget(normalized, decision);
        return { ...decision, receiptId: receipt.payload.receiptId };
    }
    verifyLedger() {
        let previous = null;
        for (let i = 0; i < this.state.receipts.length; i++) {
            const receipt = this.state.receipts[i];
            if (receipt.payload.sequence !== i || receipt.payload.previousReceiptHash !== previous) {
                return { valid: false, length: i, error: 'receipt-chain-mismatch' };
            }
            const hash = policyHash(receipt.payload);
            const { receiptId, ...unsignedIdPayload } = receipt.payload;
            if (hash !== receipt.hash || receiptId !== policyHash(unsignedIdPayload)) {
                return { valid: false, length: i, error: 'receipt-hash-mismatch' };
            }
            if (this.signingKey && !receipt.signature) {
                return { valid: false, length: i, error: 'receipt-signature-missing' };
            }
            if (receipt.signature && !this.signingKey) {
                return { valid: false, length: i, error: 'receipt-signing-key-required' };
            }
            if (receipt.signature && this.signingKey && !verifyPolicySignature(hash, receipt.signature, this.signingKey)) {
                return { valid: false, length: i, error: 'receipt-signature-invalid' };
            }
            previous = receipt.hash;
        }
        const length = this.state.receipts.length;
        // #3568: a prefix of a valid chain is itself a valid chain, so the chain
        // alone cannot tell "the last receipts were deleted" from "they were never
        // written". The anchor records how long the chain is and where it ends.
        if (typeof this.state.ledgerLength === 'number') {
            if (this.state.ledgerLength !== length || (this.state.ledgerHead ?? null) !== previous) {
                return {
                    valid: false,
                    length,
                    error: length < this.state.ledgerLength ? 'policy-ledger-truncated' : 'policy-ledger-anchor-mismatch',
                };
            }
            return length === 0 ? { valid: true, length, state: 'empty' } : { valid: true, length };
        }
        if (length === 0)
            return { valid: true, length, state: 'empty' };
        // Receipts written before the anchor existed. Anchor the current chain;
        // a truncation that happened before this moment cannot be detected.
        this.state.ledgerHead = previous;
        this.state.ledgerLength = length;
        return { valid: true, length, anchor: 'established-now' };
    }
    applyBudget(request, decision) {
        if (decision.outcome === 'denied')
            return decision;
        const now = request.context?.now ?? this.now();
        for (const limit of this.state.budgets) {
            if (!wildcard(limit.principal, request.identity.id)
                || !wildcard(limit.action, request.action.type)
                || !wildcard(limit.resource, request.action.resource))
                continue;
            let usage = this.state.usage.find((item) => item.limitId === limit.id);
            if (!usage || now - usage.windowStartedAt >= limit.periodMs) {
                usage = { limitId: limit.id, windowStartedAt: now, costUsd: 0, tokens: 0 };
            }
            if (limit.maxCostUsd !== undefined && usage.costUsd + (request.action.costUsd ?? 0) > limit.maxCostUsd) {
                return { ...decision, outcome: 'denied', enforcedOutcome: this.state.mode === 'enforce' ? 'denied' : 'allowed', reason: `budget-exceeded:${limit.id}` };
            }
            if (limit.maxCostUsd !== undefined && request.action.costUsd === undefined) {
                return { ...decision, outcome: 'denied', enforcedOutcome: this.state.mode === 'enforce' ? 'denied' : 'allowed', reason: `budget-metering-required:${limit.id}:costUsd` };
            }
            if (limit.maxTokens !== undefined && request.action.tokens === undefined) {
                return { ...decision, outcome: 'denied', enforcedOutcome: this.state.mode === 'enforce' ? 'denied' : 'allowed', reason: `budget-metering-required:${limit.id}:tokens` };
            }
            if (limit.maxTokens !== undefined && usage.tokens + (request.action.tokens ?? 0) > limit.maxTokens) {
                return { ...decision, outcome: 'denied', enforcedOutcome: this.state.mode === 'enforce' ? 'denied' : 'allowed', reason: `budget-exceeded:${limit.id}` };
            }
        }
        return decision;
    }
    applyApproval(request, decision) {
        if (decision.outcome !== 'approval_required')
            return decision;
        const now = request.context?.now ?? this.now();
        const ids = new Set(request.context?.approvalIds ?? []);
        const approval = this.state.approvals.find((item) => (ids.has(item.id)
            && !item.revokedAt
            && item.expiresAt > now
            && item.uses < item.maxUses
            && wildcard(item.principal, request.identity.id)
            && item.actions.some((action) => wildcard(action, request.action.type))
            && (!item.resources?.length || item.resources.some((resource) => wildcard(resource, request.action.resource)))));
        if (!approval)
            return decision;
        approval.uses += 1;
        return {
            ...decision,
            outcome: 'allowed',
            enforcedOutcome: 'allowed',
            reason: `approved-by:${approval.id}`,
            approvalId: approval.id,
            obligations: [],
        };
    }
    consumeBudget(request, decision) {
        if (decision.enforcedOutcome !== 'allowed')
            return;
        const now = request.context?.now ?? this.now();
        for (const limit of this.state.budgets) {
            if (!wildcard(limit.principal, request.identity.id)
                || !wildcard(limit.action, request.action.type)
                || !wildcard(limit.resource, request.action.resource))
                continue;
            let usage = this.state.usage.find((item) => item.limitId === limit.id);
            if (!usage || now - usage.windowStartedAt >= limit.periodMs) {
                usage = { limitId: limit.id, windowStartedAt: now, costUsd: 0, tokens: 0 };
                this.state.usage = this.state.usage.filter((item) => item.limitId !== limit.id);
                this.state.usage.push(usage);
            }
            usage.costUsd += request.action.costUsd ?? 0;
            usage.tokens += request.action.tokens ?? 0;
        }
    }
    appendReceipt(request, decision) {
        const previous = this.state.receipts.at(-1)?.hash ?? null;
        // Never extend a chain that no longer matches its anchor: appending would
        // re-anchor onto the truncated chain and erase the evidence of truncation.
        if (typeof this.state.ledgerLength === 'number'
            && (this.state.ledgerLength !== this.state.receipts.length || (this.state.ledgerHead ?? null) !== previous)) {
            throw new Error(this.state.receipts.length < this.state.ledgerLength
                ? 'policy-ledger-truncated'
                : 'policy-ledger-anchor-mismatch');
        }
        const sequence = this.state.receipts.length;
        const payloadWithoutId = {
            previousReceiptHash: previous,
            sequence,
            issuedAt: request.context?.now ?? this.now(),
            request,
            decision,
            policyHash: policyHash({ mode: this.state.mode, rules: this.state.rules, budgets: this.state.budgets }),
        };
        const receiptId = policyHash(payloadWithoutId);
        const payload = { receiptId, ...payloadWithoutId };
        const hash = policyHash(payload);
        const receipt = {
            payload,
            hash,
            signature: this.signingKey ? signPolicyHash(hash, this.signingKey) : undefined,
            keyId: this.signingKey ? (this.keyId ?? 'local') : undefined,
        };
        this.state.receipts.push(receipt);
        this.state.ledgerHead = hash;
        this.state.ledgerLength = this.state.receipts.length;
        return receipt;
    }
    validateRequest(request) {
        if (!request.identity?.id || !request.identity.type || !request.action?.type) {
            throw new Error('invalid-policy-request');
        }
        for (const [name, value] of [
            ['costUsd', request.action.costUsd],
            ['tokens', request.action.tokens],
            ['concurrency', request.action.concurrency],
        ]) {
            if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
                throw new Error(`invalid-policy-action-${name}`);
            }
        }
    }
}
export function createLegacyCompatibleState(source = 'pre-ADR-324') {
    return {
        version: POLICY_STATE_VERSION,
        mode: 'legacy',
        migratedFrom: source,
        migratedAt: Date.now(),
        rules: [],
        budgets: [],
        usage: [],
        approvals: [],
        receipts: [],
    };
}
//# sourceMappingURL=engine.js.map