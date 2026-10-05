// Brain #387: preserve the complete native JSONL journal without one giant string.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';
export const NAME = 'brain-outbox-streaming';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#387)';
export const RELATIVE = 'scripts/project-progression-outbox.mjs';
export const HELPERS = `
// ${PATCH_MARKER}: bounded reads, every record retained, native final-tail semantics.
const OUTBOX_READ_CHUNK = 64 * 1024;
function readOutboxRecords(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, buffer = Buffer.alloc(OUTBOX_READ_CHUNK);
    const decoder = new StringDecoder('utf8'), records = [];
    let position = 0, carry = '', index = 0;
    while (position < size) {
      const bytes = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
      if (!bytes) throw new Error('outbox journal changed while reading');
      position += bytes;
      const text = carry + decoder.write(buffer.subarray(0, bytes));
      const delimiter = text.lastIndexOf('\\n');
      if (delimiter < 0) { carry = text; continue; }
      // Native filter(Boolean) ignores empty lines but retains CR and whitespace.
      // Match nonempty lines directly instead of allocating a blank-line array.
      for (const match of text.slice(0, delimiter).matchAll(/[^\\n]+/g)) {
        index += 1;
        try { records.push(JSON.parse(match[0])); }
        catch { throw new Error(\`malformed outbox record at line \${index}\`); }
      }
      carry = text.slice(delimiter + 1);
    }
    carry += decoder.end();
    // Native missing delimiter: keep valid JSON; ignore only an incomplete suffix.
    if (carry) { try { records.push(JSON.parse(carry)); } catch { /* torn final record */ } }
    return records;
  } finally { fs.closeSync(fd); }
}
function readOutboxFinalRecord(fd, size) {
  const parts = [];
  let position = size;
  while (position > 0) {
    const length = Math.min(OUTBOX_READ_CHUNK, position), buffer = Buffer.alloc(length);
    position -= length;
    let read = 0;
    while (read < length) {
      const bytes = fs.readSync(fd, buffer, read, length - read, position + read);
      if (!bytes) throw new Error('outbox final record changed while reading');
      read += bytes;
    }
    const delimiter = buffer.lastIndexOf(10);
    parts.push(delimiter < 0 ? buffer : buffer.subarray(delimiter + 1));
    if (delimiter >= 0) break;
  }
  return Buffer.concat(parts.reverse()).toString('utf8');
}
`;
export const RECORDS_ANCHOR = `    const content = fs.readFileSync(this.path, 'utf8');
    const lines = content.split('\\n');
    if (lines.at(-1) === '') lines.pop();
    else {
      // A missing delimiter is not a missing record; only a crash-torn JSON suffix is incomplete.
      try { JSON.parse(lines.at(-1)); } catch { lines.pop(); }
    }
    return lines.filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); } catch { throw new Error(\`malformed outbox record at line \${index + 1}\`); }
    });`;
export const EDITS = [
  ['native-decoder', "import path from 'node:path';", "import path from 'node:path';\nimport { StringDecoder } from 'node:string_decoder';"],
  ['bounded-native-journal-reader', "const OUTBOX_NAME = 'project-progression-outbox.jsonl';", "const OUTBOX_NAME = 'project-progression-outbox.jsonl';\n" + HELPERS],
  ['final-record-only-inspection', "          const content = fs.readFileSync(fd, 'utf8');\n          try { JSON.parse(content.slice(content.lastIndexOf('\\n') + 1)); }",
    '          try { JSON.parse(readOutboxFinalRecord(fd, size)); }'],
  ['stream-every-native-record', RECORDS_ANCHOR, '    return readOutboxRecords(this.path);'],
];
// Exact public tag bytes, backed by streaming/durability/mutation tests.
// #387 proves bounded input reads. Only 4.5.7 also contains #390's partial lazy-replay fix;
// accepting 4.5.6 here must never imply bounded retained history or completion of #390.
const NATIVE_CAPABILITIES = new Map([
  ['e4ad0d06f372f9b976beae27f23c3966beca6877630fa1229a40a08196a0f51f', Object.freeze({ streaming: true, lazyReplay: false })],
  ['f7ad6573d32cc11f3478a6909bfce0fb59bcb8920b91c9e1477b9d46c1c90b11', Object.freeze({ streaming: true, lazyReplay: true })],
]);
export const nativeCapabilities = source => hasPatch(source) ? null
  : NATIVE_CAPABILITIES.get(crypto.createHash('sha256').update(source).digest('hex')) ?? null;
export const nativeSatisfied = source => nativeCapabilities(source)?.streaming === true;
const count = (source, text) => source.split(text).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => nativeSatisfied(source) || count(source, PATCH_MARKER) === 1 && EDITS.every(([, , next]) => count(source, next) === 1);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || !EDITS.every(([, from]) => count(source, from) === 1)) return { next: source, applied: [], missing: ['unique-native-outbox-streaming-bundle'] };
  return { next: EDITS.reduce((body, [, from, next]) => body.replace(from, () => next), source), applied: EDITS.map(([id]) => id), missing: [] };
}
export const reverseSource = source => EDITS.reduceRight((body, [, from, next]) => body.replace(next, () => from), source);
export const surfaces = () => discoverBrain({ includeOwned: true, allowMissingActive: true, ownedMarkers: [PATCH_MARKER], ownedRelatives: [RELATIVE] });
export const discover = () => surfaces().map(surface => path.join(surface.root, RELATIVE));
export function preflight() {
  const errors = [];
  for (const surface of surfaces()) {
    const file = path.join(surface.root, RELATIVE);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(surface.root, file) === null) throw Error('unsafe native outbox module');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('native outbox streaming anchors do not match');
    } catch (error) { errors.push(file + ': ' + error.message); }
  }
  return { ok: errors.length === 0, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, transactionOwner: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource, preflight };
