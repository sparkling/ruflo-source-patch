function writeJsonAtomic(file, value) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
}
function trustPaths(projectRoot) {
    const trustRoot = join(userInfo().homedir, '.config', 'ruflo', 'policy-trust');
    const projectId = createHash('sha256').update(realpathSync(projectRoot)).digest('hex');
    const dir = join(trustRoot, projectId);
    return { key: join(dir, 'anchor.key'), anchor: join(dir, 'state.anchor.json') };
}
function trustKey(projectRoot, create) {
    const { key } = trustPaths(projectRoot);
    if (!existsSync(key)) {
        if (!create)
            return undefined;
        mkdirSync(dirname(key), { recursive: true, mode: 0o700 });
        writeFileSync(key, randomBytes(32), { mode: 0o600, flag: 'wx' });
    }
    const material = readFileSync(key);
    if (material.length !== 32)
        throw new Error('invalid-policy-trust-key');
    return material;
}
function stateAuthentication(state, key) {
    return createHmac('sha256', key).update(JSON.stringify(state)).digest('hex');
}
function verifyStateAnchor(projectRoot, state) {
    const { anchor } = trustPaths(projectRoot);
    if (!existsSync(anchor))
        return;
    if (!state)
        throw new Error('policy-state-missing-for-anchored-project');
    const key = trustKey(projectRoot, false);
    if (!key)
        throw new Error('policy-trust-key-missing');
    const record = JSON.parse(readFileSync(anchor, 'utf8'));
    const expected = stateAuthentication(state, key);
    const actual = record.authentication ?? '';
    if (!/^[a-f0-9]{64}$/.test(actual)
        || !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))) {
        throw new Error('policy-state-authentication-failed');
    }
}
function writePolicyState(projectRoot, statePath, state) {
    const anchorPath = trustPaths(projectRoot).anchor;
    if (state.mode === 'enforce' || existsSync(anchorPath)) {
        const key = trustKey(projectRoot, true);
        const anchor = {
            version: 1,
            projectRoot: realpathSync(projectRoot),
            mode: state.mode,
            authentication: stateAuthentication(state, key),
            updatedAt: Date.now(),
        };
        // On first enforcement, establish the external trust record first. A
        // crash then leaves either a valid pair or an anchored mismatch that
        // fails closed; it can never leave enforce state silently unanchored.
        if (!existsSync(anchorPath)) {
            writeJsonAtomic(anchorPath, anchor);
            writeJsonAtomic(statePath, state);
            return;
        }
        writeJsonAtomic(statePath, state);
        writeJsonAtomic(anchorPath, anchor);
        return;
    }
    writeJsonAtomic(statePath, state);
}
export async function withPolicyTransaction(projectRoot, operation, options = {}) {
    const target = paths(projectRoot);
    mkdirSync(target.dir, { recursive: true, mode: 0o700 });
    const release = await acquireLock(target.lock);
    try {
        const engine = AgenticPolicyEngine.fromState(loadPolicyState(projectRoot), {
            signingKey: process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY,
            keyId: process.env.CLAUDE_FLOW_POLICY_KEY_ID,
            evidenceVerifier: verifyPolicyEvidence,
            approvalIssuerVerifier: options.approvalIssuerVerifier,
        });
        const result = await operation(engine);
        const nextState = engine.exportState();
        if (!engine.verifyLedger().valid)
            throw new Error('policy-ledger-verification-failed');
        writePolicyState(projectRoot, target.state, nextState);
        return result;
    }
    finally {
        release();
    }
}
