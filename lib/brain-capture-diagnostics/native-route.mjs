// Restore one identified downstream source deviation, never redefine Brain's capture route.
// Public Brain v4.7.28/main blob 3323c110540ca99330f8e35609dfa278357a9771 is the native proof.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeIfChanged } from '../pristine.mjs';

export const NATIVE_SNAPSHOT_SHA256 = '03cd6223c18f09cdc6a0ff41f07483578c556023dc24b712fa72de5c902d5a99';
export const INLINE_SNAPSHOT_SHA256 = '5c1bf235fc2a6daf9054828f373c4df03b52ef3d1075e32440a462e31c689d65';
export const NATIVE_LEARNING_CALL = 'captureLearning(payload, { env, detach: true })';
export const INLINE_LEARNING_CALL = 'captureLearning(payload, { env, detach: false })';
const digest = source => createHash('sha256').update(source).digest('hex');
const count = (source, text) => source.split(text).length - 1;
export const nativeLearningRoute = source => !source.includes('async function checkpointNow(')
  || count(source, NATIVE_LEARNING_CALL) === 1 && !source.includes(INLINE_LEARNING_CALL);

function readRegular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error(`${file}: unsafe recovery source`);
  return fs.readFileSync(file, 'utf8');
}
export const preservedRoutePath = (file, source) => `${file}.rsp-before-native-detach-${digest(source)}`;

// prepare runs only during explicit apply. Read-only preflight/status continue to refuse inline
// source. Check the whole dependent bundle before preserving or changing any source bytes.
export function prepareNativeLearningRoute(files, patchSource, { write = writeIfChanged } = {}) {
  const result = { log: [], errors: [] }, plans = [];
  try {
    for (const file of files) {
      const current = readRegular(file);
      if (path.basename(file) !== 'session-snapshot-hook.mjs' || nativeLearningRoute(current)) {
        if (patchSource(current).missing.length) throw Error(`${file}: unproved capture diagnostics member`);
        continue;
      }
      const backup = `${file}.rsp-backup`, saved = readRegular(backup);
      const savedHash = digest(saved);
      if (![INLINE_SNAPSHOT_SHA256, NATIVE_SNAPSHOT_SHA256].includes(savedHash))
        throw Error(`${backup}: unknown native-route baseline`);
      const native = savedHash === INLINE_SNAPSHOT_SHA256 ? saved.replace(INLINE_LEARNING_CALL, NATIVE_LEARNING_CALL) : saved;
      if (digest(native) !== NATIVE_SNAPSHOT_SHA256) throw Error(`${backup}: native-route digest mismatch`);
      const patched = patchSource(native);
      if (patched.missing.length) throw Error(`${file}: native diagnostics composition unavailable`);
      const bad = patched.next.replace(NATIVE_LEARNING_CALL, INLINE_LEARNING_CALL);
      if (current !== bad) throw Error(`${file}: unknown inline source composition`);
      // A native backup with the old live source is only our interrupted, preserved handoff.
      const badSaved = native.replace(NATIVE_LEARNING_CALL, INLINE_LEARNING_CALL);
      const archives = [[file, current], [backup, badSaved]].map(([owner, body]) => ({
        file: preservedRoutePath(owner, body), body,
      }));
      for (const archive of archives) {
        archive.existing = fs.existsSync(archive.file) ? readRegular(archive.file) : null;
        if (archive.existing !== null && archive.existing !== archive.body)
          throw Error(`${archive.file}: preservation collision`);
        if (savedHash === NATIVE_SNAPSHOT_SHA256 && archive.existing === null)
          throw Error(`${file}: unproved partial native-route handoff`);
      }
      plans.push({ file, current, backup, saved, native, next: patched.next, archives });
    }
    for (const plan of plans) {
      for (const archive of plan.archives) write(archive.file, archive.body, { expectedCurrent: archive.existing });
      for (const archive of plan.archives) if (readRegular(archive.file) !== archive.body)
        throw Error(`${archive.file}: preserved native-route evidence changed`);
      if (readRegular(plan.file) !== plan.current || readRegular(plan.backup) !== plan.saved)
        throw Error(`${plan.file}: concurrent native-route change; preserved recovery evidence`);
      // Correct the uninstall source first. An interrupted handoff must never restore inline capture.
      write(plan.backup, plan.native, { expectedCurrent: plan.saved });
      write(plan.file, plan.next, { expectedCurrent: plan.current });
      result.log.push(`restored exact native detached PostToolUse route; preserved altered source and baseline for ${plan.file}`);
    }
  } catch (error) { result.errors.push(error.message); }
  return result;
}
