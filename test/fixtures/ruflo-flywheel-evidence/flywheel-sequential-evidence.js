// Native @claude-flow/cli 3.52.0 fixture; comments/blank lines removed only.
export const SEQUENTIAL_EVIDENCE_VERSION = 'ruflo.sequential-evidence/v1';
export const DEFAULT_ALPHA_TOTAL = 0.05;
export const DEFAULT_LAMBDA = 0.5;
export const DEFAULT_SCORE_EPSILON = 1e-9;
export function alphaForTest(testIndex, alphaTotal = DEFAULT_ALPHA_TOTAL) {
    if (!Number.isInteger(testIndex) || testIndex < 1)
        throw new RangeError('testIndex must be a positive integer');
    if (!(alphaTotal > 0 && alphaTotal < 1))
        throw new RangeError('alphaTotal must be in (0, 1)');
    return (alphaTotal * 6) / (Math.PI * Math.PI * testIndex * testIndex);
}
export function sequentialEvidenceVerdict(outcomes, testIndex, config = {}) {
    const alphaTotal = config.alphaTotal ?? DEFAULT_ALPHA_TOTAL;
    const lambda = config.lambda ?? DEFAULT_LAMBDA;
    const epsilon = config.epsilon ?? DEFAULT_SCORE_EPSILON;
    if (!(lambda > 0 && lambda < 1))
        throw new RangeError('lambda must be in (0, 1)');
    const alphaAllocated = alphaForTest(testIndex, alphaTotal);
    const threshold = 1 / alphaAllocated;
    let eValue = 1;
    let informativePairs = 0;
    for (const o of outcomes) {
        const delta = o.candidateScore - o.baselineScore;
        if (Math.abs(delta) <= epsilon)
            continue; // concordant: no information
        informativePairs++;
        eValue *= delta > 0 ? 1 + lambda : 1 - lambda;
    }
    return {
        significant: eValue >= threshold,
        eValue,
        threshold,
        alphaAllocated,
        testIndex,
        informativePairs,
        totalPairs: outcomes.length,
        version: SEQUENTIAL_EVIDENCE_VERSION,
    };
}
export function minInformativePairsToClear(testIndex, config = {}) {
    const alphaTotal = config.alphaTotal ?? DEFAULT_ALPHA_TOTAL;
    const lambda = config.lambda ?? DEFAULT_LAMBDA;
    if (!(lambda > 0 && lambda < 1))
        throw new RangeError('lambda must be in (0, 1)');
    const threshold = 1 / alphaForTest(testIndex, alphaTotal);
    return Math.ceil(Math.log(threshold) / Math.log(1 + lambda));
}
export function remainingAlphaBudget(testsRun, alphaTotal = DEFAULT_ALPHA_TOTAL) {
    if (!Number.isInteger(testsRun) || testsRun < 0)
        throw new RangeError('testsRun must be a non-negative integer');
    let spent = 0;
    for (let k = 1; k <= testsRun; k++)
        spent += alphaForTest(k, alphaTotal);
    return Math.max(0, alphaTotal - spent);
}
export function checkPairedOutcomesConsistency(pairedOutcomes, heldOutDeltas, tolerance = 1e-9) {
    const reasons = [];
    if (pairedOutcomes.length === 0)
        reasons.push('pairedOutcomes is empty');
    if (pairedOutcomes.length !== heldOutDeltas.length) {
        reasons.push(`pairedOutcomes length ${pairedOutcomes.length} != heldOutDeltas length ${heldOutDeltas.length}`);
    }
    const ids = new Set();
    for (const [i, o] of pairedOutcomes.entries()) {
        if (!o.taskId || typeof o.taskId !== 'string')
            reasons.push(`pairedOutcomes[${i}] has an empty taskId`);
        else if (ids.has(o.taskId))
            reasons.push(`duplicate taskId '${o.taskId}'`);
        else
            ids.add(o.taskId);
        if (!Number.isFinite(o.baselineScore) || !Number.isFinite(o.candidateScore)) {
            reasons.push(`pairedOutcomes[${i}] has a non-finite score`);
            continue;
        }
        const delta = heldOutDeltas[i];
        if (delta !== undefined && Math.abs((o.candidateScore - o.baselineScore) - delta) > tolerance) {
            reasons.push(`pairedOutcomes[${i}] delta ${(o.candidateScore - o.baselineScore).toFixed(12)} != heldOutDeltas[${i}] ${delta}`);
        }
    }
    return { ok: reasons.length === 0, reasons };
}
