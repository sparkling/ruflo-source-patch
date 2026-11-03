// Serialized beside the native anchor writer; all I/O uses its existing imports.
export function copyVerifiedAnchorHistory(fd, source, next, validate) {
    if (!validate(next, source.count, source.lastHash))
        throw new Error('policy-anchor-log-corrupt');
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
            position += count;
        }
        if (position !== source.size || digest.digest('hex') !== source.digest)
            throw new Error('policy-anchor-log-source-changed');
    } finally { closeSync(input); }
    writeText(fd, (source.count ? ',\n' : '') + JSON.stringify(next) + '\n]}\n');
}
