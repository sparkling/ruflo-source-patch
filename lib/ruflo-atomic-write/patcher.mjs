// Ruflo #4888: reuse Node's write-all operation inside the native atomic writer.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';

export const NAME = 'ruflo-atomic-write';
export const MARKER = 'ruflo-source-patch (#4888)';
export const RETIREMENT = 'Retire on pristine native write-all behavior with short-write/failure preservation proof; retain native WAL, integrity, encryption and locking boundaries.';
export const IMPORT = "import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeSync, } from 'node:fs';";
export const CALL = '            writeSync(fd, data, 0, data.length, 0);';
export const NEXT = `            writeFileSync(fd, data); // ${MARKER}: native Node drains the buffer before publication.`;
const NEW_IMPORT = IMPORT.replace('writeSync,', 'writeFileSync,');
const count = (s, value) => s.split(value).length - 1;
const guards = '    __rufloRefuseWalSidecars(path);\n    __rufloIntegrityCheck(path);\n';
function qualified(source) {
  const start = 'export function writeFileAtomic(path, data, opts = {}) {';
  if (count(source, start) !== 1) return false;
  const i = source.indexOf(start), end = source.indexOf('\n/**', i);
  let body = source.slice(i, end < 0 ? undefined : end);
  body = body.replace(start + '\n' + guards, start + '\n').replace(NEXT, CALL);
  return createHash('sha256').update(body).digest('hex') === 'd727c44164e36db11fd7b3cd529a437d5db249829890b1e603468f258b83d361';
}
export const hasPatch = source => source.includes(MARKER);
export function nativeSatisfied(source) {
  const start = 'export function writeFileAtomic(path, data, opts = {}) {';
  if (hasPatch(source) || count(source, start) !== 1 || count(source, IMPORT) !== 1) return false;
  const i = source.indexOf(start), end = source.indexOf('\n/**', i);
  const body = source.slice(i, end < 0 ? undefined : end)
    .replace(start + '\n' + guards, start + '\n');
  return createHash('sha256').update(body).digest('hex') === '3330a5d69edc2b227214aff25a1cfbb62a9fc7975dcfc532367b806cdca92cf0';
}
export const isPatched = source => nativeSatisfied(source) || count(source, MARKER) === 1
  && count(source, NEW_IMPORT) === 1 && count(source, NEXT) === 1 && qualified(source);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || !qualified(source) || count(source, IMPORT) !== 1 || count(source, CALL) !== 1)
    return { next: source, applied: [], missing: ['native-atomic-writer'] };
  return { next: source.replace(IMPORT, NEW_IMPORT).replace(CALL, NEXT), applied: [NAME], missing: [] };
}
export const reverse = source => hasPatch(source) && isPatched(source)
  ? source.replace(NEW_IMPORT, IMPORT).replace(NEXT, CALL) : source;
export const discover = () => discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'fs-secure.js']);
export function preflight(files = discover()) {
  const errors = [], blockedFiles = [];
  for (const file of files) try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('unsafe source');
    if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw Error('unproved native atomic writer');
  } catch (error) { errors.push(`${file}: ${error.message}`); blockedFiles.push(file); }
  return { ok: !errors.length, errors, ...(errors.length ? { blockedFiles } : {}) };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse };
