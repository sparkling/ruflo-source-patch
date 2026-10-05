// Native @claude-flow/cli 3.52.0 fixture; comments/blank lines removed only.
import { createHash, randomBytes, sign as edSign, verify as edVerify, } from 'node:crypto';
import { checkPairedOutcomesConsistency } from './flywheel-sequential-evidence.js';
export const RECEIPT_SCHEMA = 'ruflo.flywheel-receipt/v1';
export const RECEIPT_DOMAIN = 'ruflo/flywheel-receipt/v1';
export const GENESIS_LEDGER_HEAD = `sha256:${'0'.repeat(64)}`;
const RECEIPT_FIELDS = {
    root: ['payload', 'signature'],
    payload: [
        'schemaVersion', 'receiptId', 'lineageId', 'candidateId', 'evaluationRunId',
        'baselineRef', 'expectedLedgerHead', 'candidatePolicy', 'gateVersion',
        'policySchemaVersion', 'safetyEnvelopeRef', 'anchorRef', 'requestedProposer',
        'effectiveProposer', 'proposerSubstitution', 'corpusVersion', 'corpusHash',
        'baselineScore', 'candidateScore', 'heldOutDeltas', 'pairedOutcomes',
        'statistics', 'gates', 'resourceEvidence', 'evidence', 'termVerification',
        'decision', 'issuedAt', 'expiresAt',
    ],
    signature: ['algorithm', 'domain', 'publicKeyPem', 'signatureBase64'],
    statistics: [
        'ruleVersion', 'relativeLift', 'pairedBootstrapProbability',
        'pairedBootstrapDeltaCILow95', 'frozenAnchorRegression', 'iterations',
        'seedHex', 'significant', 'accepted',
    ],
    resourceEvidence: [
        'p95LatencyMicros', 'costMicrosPerTask', 'tokensPerTask', 'failureRate',
        'evaluationCostMicros', 'energyMicrojoules', 'currency',
    ],
    evidence: ['corpusRoles', 'verification', 'canary'],
    corpusRoles: ['selectionTaskIds', 'promotionHoldoutTaskIds', 'guardTaskIds'],
    pairedOutcome: ['taskId', 'baselineScore', 'candidateScore'],
    termVerification: ['term', 'verification', 'evidenceRef', 'attestor'],
};
export function collectUnknownFields(value, allowed, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return [];
    return Object.keys(value)
        .filter((key) => !allowed.includes(key))
        .map((key) => `unknown field: ${path}.${key}`);
}
export function collectUnknownReceiptFields(receipt) {
    const errors = collectUnknownFields(receipt, RECEIPT_FIELDS.root, 'receipt');
    const payload = receipt.payload;
    if (!payload || typeof payload !== 'object')
        return errors;
    const evidence = payload.evidence;
    errors.push(...collectUnknownFields(payload, RECEIPT_FIELDS.payload, 'payload'), ...collectUnknownFields(receipt.signature, RECEIPT_FIELDS.signature, 'signature'), ...collectUnknownFields(payload.statistics, RECEIPT_FIELDS.statistics, 'payload.statistics'), ...collectUnknownFields(payload.resourceEvidence, RECEIPT_FIELDS.resourceEvidence, 'payload.resourceEvidence'), ...collectUnknownFields(evidence, RECEIPT_FIELDS.evidence, 'payload.evidence'), ...collectUnknownFields(evidence?.corpusRoles, RECEIPT_FIELDS.corpusRoles, 'payload.evidence.corpusRoles'));
    if (Array.isArray(payload.pairedOutcomes)) {
        payload.pairedOutcomes.forEach((outcome, i) => {
            errors.push(...collectUnknownFields(outcome, RECEIPT_FIELDS.pairedOutcome, `payload.pairedOutcomes[${i}]`));
        });
    }
    if (Array.isArray(payload.termVerification)) {
        payload.termVerification.forEach((term, i) => {
            errors.push(...collectUnknownFields(term, RECEIPT_FIELDS.termVerification, `payload.termVerification[${i}]`));
        });
    }
    return errors;
}
function assertJsonValue(value, path = '$') {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || Object.is(value, -0)) {
            throw new Error(`non-canonical number at ${path}`);
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((v, i) => {
            if (v === undefined)
                throw new Error(`undefined array member at ${path}[${i}]`);
            assertJsonValue(v, `${path}[${i}]`);
        });
        return;
    }
    if (typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            if (child === undefined)
                throw new Error(`undefined property at ${path}.${key}`);
            assertJsonValue(child, `${path}.${key}`);
        }
        return;
    }
    throw new Error(`unsupported JSON value at ${path}`);
}
export function canonicalizeJcs(value) {
    assertJsonValue(value);
    const encode = (v) => {
        if (v === null || typeof v !== 'object')
            return JSON.stringify(v);
        if (Array.isArray(v))
            return `[${v.map(encode).join(',')}]`;
        const obj = v;
        return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${encode(obj[k])}`).join(',')}}`;
    };
    return encode(value);
}
export function sha256Ref(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
export function assertReceiptNumberDomain(value, path = '$') {
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
            throw new Error(`fractional number at ${path} must be a scale-12 decimal string (ADR-322C rule 2)`);
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((v, i) => assertReceiptNumberDomain(v, `${path}[${i}]`));
        return;
    }
    if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            assertReceiptNumberDomain(v, `${path}.${k}`);
        }
    }
}
export function policyCandidateId(policy) {
    return sha256Ref(canonicalizeJcs(encodePolicyFractions(policy)));
}
export function uuidV7(now = Date.now()) {
    const bytes = randomBytes(16);
    const timestamp = BigInt(now);
    for (let i = 5; i >= 0; i--)
        bytes[5 - i] = Number((timestamp >> BigInt(i * 8)) & 0xffn);
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const decimal = (value, scale = 12) => {
    if (!Number.isFinite(value))
        throw new Error('metric must be finite');
    const normalized = value.toFixed(scale).replace(/\.?0+$/, '');
    return normalized === '-0' || normalized === '' ? '0' : normalized;
};
export function encodePolicyFractions(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error('policy value must be finite');
        return Number.isInteger(value) && !Object.is(value, -0) ? value : decimal(value);
    }
    if (Array.isArray(value))
        return value.map(encodePolicyFractions);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodePolicyFractions(v)]));
    }
    return value;
}
function seedFrom(parts) {
    const digest = createHash('sha256').update(parts.join('')).digest();
    return { seed: digest.readUInt32BE(0), hex: digest.toString('hex') };
}
function selectKth(values, k) {
    let left = 0;
    let right = values.length - 1;
    while (left <= right) {
        const pivot = values[(left + right) >>> 1];
        let lower = left;
        let scan = left;
        let upper = right;
        while (scan <= upper) {
            if (values[scan] < pivot) {
                [values[lower], values[scan]] = [values[scan], values[lower]];
                lower++;
                scan++;
            }
            else if (values[scan] > pivot) {
                [values[scan], values[upper]] = [values[upper], values[scan]];
                upper--;
            }
            else {
                scan++;
            }
        }
        if (k < lower)
            right = lower - 1;
        else if (k > upper)
            left = upper + 1;
        else
            return values[k];
    }
    return values[k] ?? 0;
}
export function computePromotionStatistics(input) {
    const iterations = input.iterations ?? 10_000;
    if (!Number.isInteger(iterations) || iterations < 100)
        throw new Error('bootstrap iterations must be >= 100');
    const n = input.heldOutDeltas.length;
    const metricEpsilon = input.metricEpsilon ?? 1e-12;
    const relativeLift = (input.candidateScore - input.baselineScore) / Math.max(Math.abs(input.baselineScore), metricEpsilon);
    const seeded = seedFrom([
        'ruflo/bootstrap/v1',
        input.corpusHash,
        input.candidateId,
        input.baselineRef,
        input.evaluationRunId,
    ]);
    let state = seeded.seed >>> 0;
    const rnd = () => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 4294967296;
    };
    const means = new Array(iterations);
    let positiveMeans = 0;
    if (n === 0) {
        means.fill(0);
    }
    else {
        for (let b = 0; b < iterations; b++) {
            let total = 0;
            for (let i = 0; i < n; i++)
                total += input.heldOutDeltas[Math.floor(rnd() * n)];
            const mean = total / n;
            means[b] = mean;
            if (mean > 0)
                positiveMeans++;
        }
    }
    const probability = positiveMeans / iterations;
    const ciLow = selectKth(means, Math.floor(0.025 * iterations));
    const significant = probability >= 0.95 && ciLow > 0;
    const accepted = relativeLift >= 0.02 && significant && input.frozenAnchorRegression <= 0;
    return {
        ruleVersion: 'ruflo.flywheel-gate/v1',
        relativeLift: decimal(relativeLift),
        pairedBootstrapProbability: decimal(probability),
        pairedBootstrapDeltaCILow95: decimal(ciLow),
        frozenAnchorRegression: decimal(input.frozenAnchorRegression),
        iterations,
        seedHex: seeded.hex,
        significant,
        accepted,
    };
}
function receiptIdentityPayload(payload) {
    return payload;
}
function signedBytes(payload) {
    assertReceiptNumberDomain(payload);
    return Buffer.concat([
        Buffer.from(RECEIPT_DOMAIN, 'utf8'),
        Buffer.from([0]),
        Buffer.from(canonicalizeJcs(payload), 'utf8'),
    ]);
}
export function createFlywheelReceipt(input) {
    const now = input.now ?? Date.now();
    const evaluationRunId = input.evaluationRunId ?? uuidV7(now);
    const lineageId = input.lineageId ?? uuidV7(now);
    const candidatePolicy = encodePolicyFractions(input.candidatePolicy);
    const candidateId = policyCandidateId(candidatePolicy);
    const encodedBaselineScore = decimal(input.baselineScore);
    const encodedCandidateScore = decimal(input.candidateScore);
    const encodedHeldOutDeltas = input.heldOutDeltas.map((v) => decimal(v));
    const statistics = computePromotionStatistics({
        baselineScore: Number(encodedBaselineScore),
        candidateScore: Number(encodedCandidateScore),
        heldOutDeltas: encodedHeldOutDeltas.map(Number),
        frozenAnchorRegression: Number(decimal(input.frozenAnchorRegression)),
        corpusHash: input.corpusHash,
        candidateId,
        baselineRef: input.baselineRef,
        evaluationRunId,
        iterations: input.bootstrapIterations,
    });
    const decision = statistics.accepted && Object.values(input.gates).every(Boolean) ? 'accepted' : 'rejected';
    const base = {
        schemaVersion: RECEIPT_SCHEMA,
        lineageId,
        candidateId,
        evaluationRunId,
        baselineRef: input.baselineRef,
        expectedLedgerHead: input.expectedLedgerHead ?? GENESIS_LEDGER_HEAD,
        candidatePolicy,
        gateVersion: input.gateVersion ?? statistics.ruleVersion,
        policySchemaVersion: input.policySchemaVersion ?? 'ruflo.retrieval-policy/v2',
        safetyEnvelopeRef: input.safetyEnvelopeRef,
        ...(input.anchorRef ? { anchorRef: input.anchorRef } : {}),
        requestedProposer: input.requestedProposer ?? 'local',
        effectiveProposer: input.effectiveProposer ?? 'local',
        ...(input.proposerSubstitution ? { proposerSubstitution: input.proposerSubstitution } : {}),
        corpusVersion: input.corpusVersion,
        corpusHash: input.corpusHash,
        baselineScore: encodedBaselineScore,
        candidateScore: encodedCandidateScore,
        heldOutDeltas: encodedHeldOutDeltas,
        ...(input.pairedOutcomes
            ? {
                pairedOutcomes: input.pairedOutcomes.map((o) => ({
                    taskId: o.taskId,
                    baselineScore: decimal(o.baselineScore),
                    candidateScore: decimal(o.candidateScore),
                })),
            }
            : {}),
        statistics,
        gates: input.gates,
        resourceEvidence: {
            p95LatencyMicros: input.resourceEvidence?.p95LatencyMicros ?? 0,
            costMicrosPerTask: input.resourceEvidence?.costMicrosPerTask ?? 0,
            tokensPerTask: input.resourceEvidence?.tokensPerTask ?? 0,
            failureRate: input.resourceEvidence?.failureRate ?? '0',
            evaluationCostMicros: input.resourceEvidence?.evaluationCostMicros ?? 0,
            ...(input.resourceEvidence?.energyMicrojoules === undefined
                ? {}
                : { energyMicrojoules: input.resourceEvidence.energyMicrojoules }),
            currency: input.resourceEvidence?.currency ?? 'USD',
        },
        evidence: input.evidence ?? {
            corpusRoles: {
                selectionTaskIds: [],
                promotionHoldoutTaskIds: [],
                guardTaskIds: [],
            },
            verification: {},
            canary: {},
        },
        termVerification: input.termVerification ?? [],
        decision,
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + (input.ttlMs ?? 24 * 60 * 60 * 1000)).toISOString(),
    };
    const receiptId = sha256Ref(canonicalizeJcs(receiptIdentityPayload(base)));
    const payload = { ...base, receiptId };
    const receipt = { payload };
    if (input.privateKeyPem || input.publicKeyPem) {
        if (!input.privateKeyPem || !input.publicKeyPem)
            throw new Error('both Ed25519 private and public PEM keys are required');
        receipt.signature = {
            algorithm: 'ed25519',
            domain: RECEIPT_DOMAIN,
            publicKeyPem: input.publicKeyPem,
            signatureBase64: edSign(null, signedBytes(payload), input.privateKeyPem).toString('base64'),
        };
    }
    return receipt;
}
export function verifyFlywheelReceipt(receipt, trustedPublicKeys) {
    try {
        assertReceiptNumberDomain(receipt.payload);
    }
    catch (err) {
        return { valid: false, signed: !!receipt.signature, errors: [err.message] };
    }
    const errors = [];
    try {
        if (receipt.payload.schemaVersion !== RECEIPT_SCHEMA)
            errors.push('unsupported receipt schema');
        errors.push(...collectUnknownReceiptFields(receipt));
        const { receiptId: _receiptId, ...base } = receipt.payload;
        const expectedId = sha256Ref(canonicalizeJcs(receiptIdentityPayload(base)));
        if (expectedId !== receipt.payload.receiptId)
            errors.push('receipt content ID mismatch');
        if (policyCandidateId(receipt.payload.candidatePolicy) !== receipt.payload.candidateId)
            errors.push('candidate content ID mismatch');
        const recomputedStatistics = computePromotionStatistics({
            baselineScore: Number(receipt.payload.baselineScore),
            candidateScore: Number(receipt.payload.candidateScore),
            heldOutDeltas: receipt.payload.heldOutDeltas.map(Number),
            frozenAnchorRegression: Number(receipt.payload.statistics.frozenAnchorRegression),
            corpusHash: receipt.payload.corpusHash,
            candidateId: receipt.payload.candidateId,
            baselineRef: receipt.payload.baselineRef,
            evaluationRunId: receipt.payload.evaluationRunId,
            iterations: receipt.payload.statistics.iterations,
        });
        if (canonicalizeJcs(recomputedStatistics) !== canonicalizeJcs(receipt.payload.statistics)) {
            errors.push('statistical decision does not recompute');
        }
        const recomputedDecision = recomputedStatistics.accepted && Object.values(receipt.payload.gates).every(Boolean)
            ? 'accepted'
            : 'rejected';
        if (receipt.payload.decision !== recomputedDecision)
            errors.push('receipt decision does not recompute');
        if (receipt.payload.pairedOutcomes) {
            const paired = receipt.payload.pairedOutcomes.map((o) => ({
                taskId: o.taskId,
                baselineScore: Number(o.baselineScore),
                candidateScore: Number(o.candidateScore),
            }));
            const check = checkPairedOutcomesConsistency(paired, receipt.payload.heldOutDeltas.map(Number), 1e-9);
            if (!check.ok)
                errors.push(`paired outcomes inconsistent: ${check.reasons.join('; ')}`);
        }
        if (!receipt.signature) {
            errors.push('receipt is unsigned');
        }
        else {
            if (receipt.signature.algorithm !== 'ed25519' || receipt.signature.domain !== RECEIPT_DOMAIN) {
                errors.push('unsupported signature metadata');
            }
            else if (trustedPublicKeys && !trustedPublicKeys.has(receipt.signature.publicKeyPem)) {
                errors.push('receipt signer is not trusted');
            }
            else if (!edVerify(null, signedBytes(receipt.payload), receipt.signature.publicKeyPem, Buffer.from(receipt.signature.signatureBase64, 'base64'))) {
                errors.push('receipt signature invalid');
            }
        }
    }
    catch (error) {
        errors.push(`verification error: ${error.message}`);
    }
    return { valid: errors.length === 0, signed: !!receipt.signature, errors };
}
