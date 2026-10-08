// Embedded in the installed native policy owner; never runs in the patch installer.
// #3164: immutable, content-addressed segments before a compact state commit.
export function policyLedgerRuntime() {
    const rspLedgerWindow = 1024;
    const rspLedgerBatch = 512;
    const rspDigest = bytes => createHash('sha256').update(bytes).digest('hex');
    const rspArchiveDir = root => join(paths(root).dir, 'receipt-segments');
    const rspArchiveBody = archive => JSON.stringify([
        1, archive.head, archive.length, archive.receiptHead,
    ]);
    function rspArchiveMac(root, archive, create = false) {
        const key = trustKey(root, create);
        if (!key) throw new Error('policy-archive-trust-key-missing');
        return createHmac('sha256', key).update(rspArchiveBody(archive)).digest('hex');
    }
    function rspSyncDirectory(dir) {
        const fd = openSync(dir, 'r');
        try { rspFsyncSync(fd); } finally { closeSync(fd); }
    }
    function rspReadSegment(root, head) {
        if (!/^[a-f0-9]{64}$/.test(head)) throw new Error('policy-archive-invalid-reference');
        const file = join(rspArchiveDir(root), head + '.json');
        const fd = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
        let bytes;
        try {
            if (!fstatSync(fd).isFile()) throw new Error('policy-archive-not-regular');
            bytes = readFileSync(fd);
        } finally { closeSync(fd); }
        if (rspDigest(bytes) !== head) throw new Error('policy-archive-content-mismatch');
        const segment = JSON.parse(bytes);
        if (segment.version !== 1 || !Number.isSafeInteger(segment.from) || segment.from < 0
            || !Array.isArray(segment.receipts) || segment.receipts.length < 1
            || segment.receipts.length > rspLedgerBatch)
            throw new Error('policy-archive-invalid-segment');
        return segment;
    }
    function rspWriteSegment(root, segment) {
        const dir = rspArchiveDir(root);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink())
            throw new Error('policy-archive-unsafe-directory');
        const bytes = JSON.stringify(segment), head = rspDigest(bytes);
        const file = join(dir, head + '.json');
        if (existsSync(file)) {
            rspReadSegment(root, head);
            rspSyncDirectory(dir);
            rspSyncDirectory(dirname(dir));
            return head;
        }
        const temporary = join(dir, '.' + process.pid + '.' + randomUUID() + '.tmp');
        const fd = openSync(temporary, 'wx', 0o600);
        try {
            writeFileSync(fd, bytes);
            rspFsyncSync(fd);
        } finally { closeSync(fd); }
        try {
            // Link publishes without ever replacing another immutable receipt segment.
            try { rspLinkSync(temporary, file); }
            catch (error) { if (error.code !== 'EEXIST') throw error; rspReadSegment(root, head); }
            rspSyncDirectory(dir);
        } finally { unlinkSync(temporary); }
        rspSyncDirectory(dir);
        rspSyncDirectory(dirname(dir));
        return head;
    }
    function rspValidateArchive(root, state) {
        const archive = state.policyArchive;
        if (archive === undefined) return;
        if (!archive || archive.version !== 1 || !Number.isSafeInteger(archive.length)
            || archive.length <= 0 || !/^sha256:[a-f0-9]{64}$/.test(archive.receiptHead)
            || !/^[a-f0-9]{64}$/.test(archive.mac ?? ''))
            throw new Error('policy-archive-invalid-boundary');
        const expected = rspArchiveMac(root, archive);
        if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(archive.mac, 'hex')))
            throw new Error('policy-archive-authentication-failed');
        const segment = rspReadSegment(root, archive.head);
        if (segment.from + segment.receipts.length !== archive.length
            || segment.receipts.at(-1).hash !== archive.receiptHead)
            throw new Error('policy-archive-boundary-mismatch');
    }
    function rspCompactLedger(root, state) {
        if (state.receipts.length <= rspLedgerWindow + rspLedgerBatch) return;
        let archive = state.policyArchive;
        let removed = 0;
        // Preserve a complete batch as the amortization unit; never delete history.
        while (state.receipts.length - removed > rspLedgerWindow + rspLedgerBatch) {
            const receipts = state.receipts.slice(removed, removed + rspLedgerBatch);
            const segment = { version: 1, previous: archive?.head ?? null,
                from: archive?.length ?? 0, previousReceiptHash: archive?.receiptHead ?? null, receipts };
            const head = rspWriteSegment(root, segment);
            archive = { version: 1, head, length: segment.from + receipts.length,
                receiptHead: receipts.at(-1).hash };
            removed += receipts.length;
        }
        // Synchronize the native trust key before publishing a boundary that needs it.
        archive.mac = rspArchiveMac(root, archive, true);
        const keyFile = trustPaths(root).key, keyFd = openSync(keyFile, 'r');
        try { rspFsyncSync(keyFd); } finally { closeSync(keyFd); }
        rspSyncDirectory(dirname(keyFile));
        state.policyArchive = archive;
        state.receipts = state.receipts.slice(removed);
    }
    function rspVerifyFullLedger(root, state, options) {
        let archive = state.policyArchive;
        if (!archive) return;
        let head = archive.head, length = archive.length, receiptHead = archive.receiptHead;
        while (length > 0) {
            const segment = rspReadSegment(root, head);
            if (segment.from + segment.receipts.length !== length
                || segment.receipts.at(-1).hash !== receiptHead)
                throw new Error('policy-archive-chain-mismatch');
            const engine = AgenticPolicyEngine.fromState({ ...state,
                policyArchive: segment.from > 0 ? { length: segment.from,
                    receiptHead: segment.previousReceiptHash } : undefined,
                receipts: segment.receipts, ledgerLength: length, ledgerHead: receiptHead }, options);
            if (!engine.verifyLedger().valid) throw new Error('policy-archive-receipt-invalid');
            head = segment.previous;
            length = segment.from;
            receiptHead = segment.previousReceiptHash;
        }
        if (head !== null || receiptHead !== null) throw new Error('policy-archive-genesis-mismatch');
    }
    function rspExpandLedger(root, state) {
        if (!state.policyArchive) return state;
        rspVerifyFullLedger(root, state, { signingKey: process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY,
            keyId: process.env.CLAUDE_FLOW_POLICY_KEY_ID });
        const segments = [];
        let head = state.policyArchive.head;
        while (head !== null) {
            const segment = rspReadSegment(root, head);
            segments.push(segment.receipts);
            head = segment.previous;
        }
        const receipts = segments.reverse().flat();
        for (const receipt of state.receipts) receipts.push(receipt);
        const { policyArchive, ...expanded } = state;
        return { ...expanded, receipts };
    }
}

export const RUNTIME = policyLedgerRuntime.toString().replace(/^function policyLedgerRuntime\(\) \{\n/, '').replace(/\n\}$/, '');
