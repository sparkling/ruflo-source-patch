// Serialized beside the native anchor writer; all I/O uses its existing imports.
export function copyVerifiedAnchorHistory(fd, source, next, validate) {
    if (!validate(next, source.count, source.lastHash))
        throw new Error('policy-anchor-log-corrupt');
    const outputDigest = rspAnchorCreateHash('sha256');
    const input = openSync(source.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        if (!fstatSync(input).isFile())
            throw new Error('policy-anchor-log-corrupt');
        const digest = rspAnchorCreateHash('sha256');
        const bytes = Buffer.allocUnsafe(CHUNK_BYTES);
        let position = 0;
        for (;;) {
            const count = readSync(input, bytes, 0, Math.min(bytes.length, source.size + 1 - position), position);
            if (!count) break;
            if (position + count > source.size)
                throw new Error('policy-anchor-log-source-changed');
            digest.update(bytes.subarray(0, count));
            const copy = Math.max(0, Math.min(count, source.size - 4 - position));
            for (let written = 0; written < copy;) {
                const step = writeSync(fd, bytes, written, copy - written);
                if (!step) throw new Error('policy-anchor-log-short-write');
                written += step;
            }
            outputDigest.update(bytes.subarray(0, copy));
            position += count;
        }
        if (position !== source.size || digest.digest('hex') !== source.digest)
            throw new Error('policy-anchor-log-source-changed');
    } finally { closeSync(input); }
    const lastText = JSON.stringify(next);
    const ending = (source.count ? ',\n' : '') + lastText + '\n]}\n';
    writeText(fd, ending);
    // Authenticate the actual serialized entry, not a potentially different
    // object/toJSON result. Failure only declines reuse; native publication stays unchanged.
    if (typeof lastText === 'string' && Buffer.byteLength(lastText) <= VALUE_LIMIT) try {
        const last = JSON.parse(lastText);
        if (validate(last, source.count, source.lastHash)) return Object.freeze({ file: source.file,
            size: source.size - 4 + Buffer.byteLength(ending), digest: outputDigest.update(ending).digest('hex'),
            count: source.count + 1, lastText, lastHash: last.hash });
    } catch { /* Original next-entry semantics remain the writer's contract. */ }
}

// One bounded, process-local publication summary, never a policy decision.
// Its bytes are reread in full on every hit; metadata never grants reuse.
export function readVerifiedAnchorSummary(file, context, mirrorHash) {
    const cached = rspPublishedAnchorSummary;
    rspPublishedAnchorSummary = undefined;
    if (!cached || cached.file !== file || cached.context !== context || cached.lastHash !== mirrorHash) return;
    let input;
    try {
        input = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        if (!fstatSync(input).isFile()) return;
        const digest = rspAnchorCreateHash('sha256'), bytes = Buffer.allocUnsafe(CHUNK_BYTES);
        let position = 0;
        for (;;) {
            const count = readSync(input, bytes, 0, Math.min(bytes.length, cached.size + 1 - position), position);
            if (!count) break;
            position += count;
            if (position > cached.size) return;
            digest.update(bytes.subarray(0, count));
        }
        if (position !== cached.size || digest.digest('hex') !== cached.digest) return;
        const rspProof = {};
        rspAssessedAnchorSources.set(rspProof, Object.freeze({ file, size: cached.size, digest: cached.digest,
            count: cached.count, lastHash: cached.lastHash }));
        return { count: cached.count, last: JSON.parse(cached.lastText), mirrorIncluded: true, rspProof };
    } catch { /* The unchanged native parser diagnoses every miss or I/O failure. */ }
    finally { if (input !== undefined) try { closeSync(input); } catch { return undefined; } }
}

export function publishVerifiedAnchorSummary(publication, file, context, mirrorHash) {
    rspPublishedAnchorSummary = undefined;
    const source = publication && rspPublicationProofs.get(publication);
    if (publication) rspPublicationProofs.delete(publication);
    if (source && source.file === file && source.lastHash === mirrorHash)
        rspPublishedAnchorSummary = Object.freeze({ ...source, context });
}
