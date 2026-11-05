// https://github.com/ruvnet/ruflo/issues/3164 — authenticate once, copy identical bytes.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
import { copyVerifiedAnchorHistory, readVerifiedAnchorSummary, publishVerifiedAnchorSummary } from './runtime.mjs';
export const NAME = 'ruflo-policy-anchor-copy';
export const PATCH_MARKER = 'ruflo-source-patch (ruflo#3164 authenticated-anchor-copy)';
export const RETIREMENT = 'Retire only on executable pristine-native proof of full initial authentication, whole-file digest/length-bound cross-transaction summary reuse, fresh context/head/mirror invalidation, single-use byte-bound publication, atomic failure cleanup, fallback grammar preservation and complete native receipt/anchor audits.';
// Exact released4.46.149 runtime retained only for migration/reversal.
const released149Copy = "function copyVerifiedAnchorHistory(fd, source, next, validate) {\n    if (!validate(next, source.count, source.lastHash))\n        throw new Error('policy-anchor-log-corrupt');\n    const input = openSync(source.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));\n    try {\n        if (!fstatSync(input).isFile())\n            throw new Error('policy-anchor-log-corrupt');\n        const digest = rspAnchorCreateHash('sha256');\n        const bytes = Buffer.allocUnsafe(CHUNK_BYTES);\n        let position = 0;\n        for (;;) {\n            const count = readSync(input, bytes, 0, Math.min(bytes.length, source.size + 1 - position), position);\n            if (!count) break;\n            if (position + count > source.size)\n                throw new Error('policy-anchor-log-source-changed');\n            digest.update(bytes.subarray(0, count));\n            const copy = Math.max(0, Math.min(count, source.size - 4 - position));\n            for (let written = 0; written < copy;) {\n                const step = writeSync(fd, bytes, written, copy - written);\n                if (!step) throw new Error('policy-anchor-log-short-write');\n                written += step;\n            }\n            position += count;\n        }\n        if (position !== source.size || digest.digest('hex') !== source.digest)\n            throw new Error('policy-anchor-log-source-changed');\n    } finally { closeSync(input); }\n    writeText(fd, (source.count ? ',\\n' : '') + JSON.stringify(next) + '\\n]}\\n');\n}";
const priorReaderEdits = [
  ["import { TextDecoder } from 'node:util';", `import { TextDecoder } from 'node:util';
// ${PATCH_MARKER}: identity-only, single-use evidence from this read.
import { createHash as rspAnchorCreateHash } from 'node:crypto';
const rspAssessedAnchorSources = new WeakMap();
${released149Copy}`],
  ['    ended = false;', `    ended = false;
    rspDigest = rspAnchorCreateHash('sha256');
    rspFirstBytes = null;
    rspLastBytes = Buffer.alloc(0);`],
  ['            this.position += count;', `            this.position += count;
            if (count) {
                const bytes = this.buffer.subarray(0, count);
                this.rspDigest.update(bytes);
                if (!this.rspFirstBytes) this.rspFirstBytes = Buffer.from(bytes.subarray(0, 25));
                this.rspLastBytes = Buffer.concat([this.rspLastBytes, bytes]).subarray(-4);
            }`],
  ['export function* anchorEntries(file) {', 'export function* anchorEntries(file) {\n    const rspProof = arguments[1];'],
  ['    let seenEntries = false;', '    let seenEntries = false;\n    let rspRootKeys = 0;\n    let rspCount = 0, rspLastHash = null;'],
  ['            const key = reader.value();', '            const key = reader.value();\n            rspRootKeys++;'],
  ['                        yield reader.value();', `                        const entry = reader.value();
                        yield entry;
                        rspCount++; rspLastHash = entry?.hash;`],
  ["        if (reader.peek() || !seenEntries || !seenVersion || version !== 1)\n            throw new Error('policy-anchor-log-corrupt');", `        if (reader.peek() || !seenEntries || !seenVersion || version !== 1)
            throw new Error('policy-anchor-log-corrupt');
        // The native caller has authenticated every yielded entry before resuming.
        // Other root layouts retain the unchanged parser/serializer fallback.
        if (rspProof && rspRootKeys === 2
            && reader.rspFirstBytes?.toString('utf8') === '{"version":1,"entries":[\\n'
            && reader.rspLastBytes.toString('utf8') === '\\n]}\\n')
            rspAssessedAnchorSources.set(rspProof, Object.freeze({ file, size: reader.position,
                digest: reader.rspDigest.digest('hex'), count: rspCount, lastHash: rspLastHash }));`],
  ['export function appendedAnchorLog(file, next, validate) {\n    return { [ATOMIC_JSON_WRITER](fd) {', `export function appendedAnchorLog(file, next, validate, rspProof) {
    const source = rspProof && rspAssessedAnchorSources.get(rspProof);
    if (rspProof) rspAssessedAnchorSources.delete(rspProof);
    return { [ATOMIC_JSON_WRITER](fd) {
            if (source && source.file === file) {
                copyVerifiedAnchorHistory(fd, source, next, validate);
                return;
            }`],
];
const priorLedgerEdits = [
  ['        const summary = { count: 0, mirrorIncluded: false };', `        // ${PATCH_MARKER}: handed off only after full native chain validation.
        const rspProof = {};
        const summary = { count: 0, mirrorIncluded: false, rspProof };`],
  ['for (const value of anchorEntries(file)) {', 'for (const value of anchorEntries(file, rspProof)) {'],
  ['tip, validEntry));', 'tip, validEntry, entries.rspProof));'],
];
const readerEdits = priorReaderEdits.map(([from, to], index) => [from, index === 0
  ? to.replace(released149Copy, `const rspPublicationProofs = new WeakMap();
let rspPublishedAnchorSummary;
${copyVerifiedAnchorHistory.toString()}
export ${readVerifiedAnchorSummary.toString()}
export ${publishVerifiedAnchorSummary.toString()}`)
  : index === priorReaderEdits.length - 1 ? `export function appendedAnchorLog(file, next, validate, rspProof) {
    const source = rspProof && rspAssessedAnchorSources.get(rspProof);
    if (rspProof) rspAssessedAnchorSources.delete(rspProof);
    const publication = { [ATOMIC_JSON_WRITER](fd) {
            rspPublicationProofs.delete(publication);
            if (source && source.file === file) {
                const produced = copyVerifiedAnchorHistory(fd, source, next, validate);
                if (produced) rspPublicationProofs.set(publication, produced);
                return;
            }` : to]);
readerEdits.push(['            flush();\n        } };\n}', '            flush();\n        } };\n    return publication;\n}']);
const ledgerEdits = [...priorLedgerEdits.slice(0, 2),
  ["import { anchorEntries, appendedAnchorLog } from './policy-anchor-log.js';",
    "import { anchorEntries, appendedAnchorLog, readVerifiedAnchorSummary, publishVerifiedAnchorSummary } from './policy-anchor-log.js';"],
  ['function readLog(projectRoot, mirrorHash) {', `function rspAnchorSummaryContext(projectRoot, state) {
    return JSON.stringify({ root: realpathSync(projectRoot), trust: policyTrustRoot(),
        length: state.ledgerLength, head: state.ledgerHead, retained: state.retainedFrom, pruned: state.prunedHead });
}
function readLog(projectRoot, mirrorHash, state) {`],
  ['    const file = anchorLogPath(projectRoot);\n    if (!existsSync(file))', `    const file = anchorLogPath(projectRoot);
    const reused = state && readVerifiedAnchorSummary(file, rspAnchorSummaryContext(projectRoot, state), mirrorHash);
    if (reused) return reused;
    if (!existsSync(file))`],
  ['let entries = readLog(projectRoot, mirror?.hash);', 'let entries = readLog(projectRoot, mirror?.hash, state);'],
  ["export async function recordAnchor(projectRoot, state, write, event = 'append', by, writeLog, assessedTip) {",
    "export async function recordAnchor(projectRoot, state, write, event = 'append', by, writeLog, assessedTip) {\n    let rspPublication;\n    publishVerifiedAnchorSummary();"],
  ['            await writeLog(anchorLogPath(projectRoot), appendedAnchorLog(loaded === \'corrupt\' || entries.count === 0 ? undefined : anchorLogPath(projectRoot), tip, validEntry));',
    "            rspPublication = appendedAnchorLog(loaded === 'corrupt' || entries.count === 0 ? undefined : anchorLogPath(projectRoot), tip, validEntry, entries.rspProof);\n            await writeLog(anchorLogPath(projectRoot), rspPublication);"],
  ['        await write(mirror, tip);', '        await write(mirror, tip);\n        publishVerifiedAnchorSummary(rspPublication, anchorLogPath(projectRoot), rspAnchorSummaryContext(projectRoot, state), tip.hash);'],
];
const count = (source, text) => source.split(text).length - 1;
const edits = source => source.includes('export function* anchorEntries(') ? readerEdits
  : source.includes('export async function recordAnchor(') ? ledgerEdits : null;
const nativeGuards = source => (edits(source) === ledgerEdits ? [
  "            if (!validEntry(value, summary.count, prev))\n                return 'corrupt';",
  '    assessedLogs.set(last, { file: anchorLogPath(projectRoot), summary: entries });',
  '    const cached = assessedTip && assessedLogs.get(assessedTip);',
  '        assessedLogs.delete(assessedTip);',
] : [
  "    decoder = new TextDecoder('utf-8', { fatal: true });",
  'const CHUNK_BYTES = 64 * 1024;',
  'const VALUE_LIMIT = 16 * 1024 * 1024;',
]).every(anchor => count(source, anchor) === 1);
export const hasPatch = source => source.includes(PATCH_MARKER);
export function reverse(source) {
  const selected = edits(source);
  if (selected && hasPatch(source)) for (const version of [selected, selected === readerEdits ? priorReaderEdits : priorLedgerEdits]) {
    if (!version.every(([, to]) => count(source, to) === 1)) continue;
    const clean = version.reduceRight((text, [from, to]) => text.replace(to, () => from), source);
    if (!hasPatch(clean) && version.reduce((text, [from, to]) => text.replace(from, () => to), clean) === source) return clean;
  }
  return source;
}
export function patchSource(source) {
  const selected = edits(source);
  if (!selected) return { next: source, applied: [], missing: ['native-anchor-copy-surface'] };
  if (!nativeGuards(source)) return { next: source, applied: [], missing: ['native-anchor-copy-authentication-contract'] };
  if (hasPatch(source)) {
    const clean = reverse(source);
    if (clean !== source && !hasPatch(clean)) {
      const rebuilt = patchSource(clean);
      if (!rebuilt.missing.length) return { next: rebuilt.next, applied: rebuilt.next === source ? [] : [NAME], missing: [] };
    }
    return { next: source, applied: [], missing: ['modified-authenticated-anchor-copy'] };
  }
  if (selected.some(([from]) => count(source, from) !== 1))
    return { next: source, applied: [], missing: ['exact-authenticated-anchor-copy-anchors'] };
  return { next: selected.reduce((text, [from, to]) => text.replace(from, () => to), source), applied: [NAME], missing: [] };
}
export const isPatched = source => { const result = patchSource(source); return hasPatch(source) && !result.missing.length && result.next === source; };
export function historicalPatchSource(source) {
  const current = edits(source), selected = current === readerEdits ? priorReaderEdits : priorLedgerEdits;
  if (!current || !nativeGuards(source) || selected.some(([from]) => count(source, from) !== 1))
    return { next: source, applied: [], missing: ['exact-released149-anchor-copy'] };
  return { next: selected.reduce((text, [from, to]) => text.replace(from, () => to), source), applied: [NAME], missing: [] };
}
export const reverseSource = reverse;
const files = ['policy-anchor-log.js', 'policy-ledger-anchor.js'];
export const discover = () => files.flatMap(file => discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'services', file]))
  .filter(file => {
    // Older dormant packages lack the qualified assessedLogs/streaming contract.
    // Future candidates remain visible and must prove the exact anchors.
    const metadata = JSON.parse(fs.readFileSync(path.resolve(path.dirname(file), '../../../package.json'), 'utf8'));
    const [major, minor] = String(metadata.version).split('.').map(Number);
    return major > 3 || (major === 3 && minor >= 71);
  });
export function preflight() {
  const roots = new Set(discover().map(file => path.dirname(file))), errors = [];
  for (const root of roots) for (const name of files) {
    const file = path.join(root, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
          || existingPathRelative(path.resolve(root, '../../..'), file) === null) throw new Error('unsafe native policy source');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw new Error('unproved authenticated anchor copy anchors');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: !errors.length, errors };
}
export const applicability = () => discover().length ? { state: 'applicable' }
  : { state: 'not-applicable', reason: 'native policy anchor surfaces absent; watched for future installs' };
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, transactionOwner: true,
  applicability, discover, preflight, patchSource, historicalPatchSource, hasPatch, isPatched, reverse };
