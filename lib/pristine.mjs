// Pristine-backup handling, shared by the plugin patchers.
//
// THE BUG THIS EXISTS TO PREVENT. The naive rule — "if a .rsp-backup exists, it IS the
// pristine file" — is wrong the moment upstream replaces the target in place. We then
// rebuild from a STALE pristine and write it over the new file, silently reverting the
// update. And because the monitor re-applies on a timer, it would do so every few minutes:
// a watchdog turned into a downgrade machine.
//
// It is not hypothetical. The plugin CACHE path is versioned
// (cache/ruflo/ruflo-adr/<version>/…), so an update lands in a fresh directory with no
// backup and re-baselines naturally. But the MARKETPLACE path is not:
//
//   ~/.claude/plugins/marketplaces/ruflo/plugins/ruflo-adr/scripts/import.mjs
//
// A `/plugin update` rewrites that file in place. Reproduced: injected an upstream change,
// ran one monitor tick, and the change was gone.
//
// THE RULE. A file on disk can only be in one of three states, and each has one answer:
//
//   1. current === patch(backup)   -> already ours, up to date. Nothing to do.
//   2. current === backup          -> pristine on disk. Apply.
//   3. neither                     -> UPSTREAM CHANGED IT. The backup is stale; re-baseline
//                                     from what is on disk now, then apply to that.
//
// Case 3 is the whole point. We never assume our backup outranks reality — reality wins,
// and our patches are re-derived on top of it. If the new upstream file no longer matches
// our anchors, the patcher reports INCOMPLETE rather than pretending, which is exactly the
// signal you want: upstream moved, come look.

import fs from 'node:fs';
import path from 'node:path';

export const backupOf = (file) => `${file}.rsp-backup`;

/**
 * Restore a file from its backup — refusing to restore an EMPTY one.
 *
 * The UNINSTALL path bypasses every guard in resolvePristine(), because it doesn't need a pristine:
 * it just copies the backup back. Which means a poisoned (empty) backup makes UNINSTALL the
 * most destructive command in the tool — `copyFileSync('', file)` truncates the very file it
 * is meant to be restoring. Measured: a 13337-byte plugin file reduced to 0 by `uninstall`.
 *
 * If the backup is empty we cannot restore anything, so we destroy nothing: drop the useless
 * backup and leave the file as it is. A patched file is a far better outcome than an empty one.
 */
export function restoreFromBackup(file) {
  const backup = backupOf(file);
  if (!fs.existsSync(backup)) return { restored: false };
  if (fs.statSync(backup).size === 0) {
    fs.rmSync(backup, { force: true });
    return { restored: false, poisoned: true };
  }
  fs.copyFileSync(backup, file);
  fs.rmSync(backup, { force: true });
  return { restored: true };
}

/** Atomic write, and only when the bytes actually differ. */
export function writeIfChanged(file, next) {
  let current;
  try { current = fs.readFileSync(file, 'utf8'); } catch { current = null; }
  if (current === next) return false;
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.rsp-tmp-${process.pid}`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeFileSync(fd, next);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    if (fs.existsSync(tmp)) { try { fs.rmSync(tmp, { force: true }); } catch {} }
  }
  return true;
}

/**
 * Resolve the pristine source for `file`, re-baselining if upstream replaced it.
 *
 * @param file    target path
 * @param patchFn (src) => patchedSrc — must be pure and deterministic, since we use it to
 *                recognise our own output. Same input, same bytes, every time.
 * @returns { pristine, rebaselined }
 */
// `opts.isOurs(src)` — OPTIONAL. When several targets can patch one file (the plugin composition
// engine, ADR-020), "is this our output" is no longer a single equality: a file may carry the edits of a
// target that has since been UNINSTALLED, and the reduced active transform will not reproduce it. If we
// re-baselined on that, we would adopt the still-patched file as the new pristine and lose the vendor
// bytes — exactly the corruption composition exists to fix. So the caller supplies an `isOurs` that
// recognises the file as ours if ANY of our targets' edits are present (mirroring patch-library's
// `isOurs`), and re-baseline fires only when the file is neither the backup nor recognisably ours.
//
// `opts.recoverPoisoned(current)` — OPTIONAL, `(src) => { candidate, verify } | null`. A poisoned backup
// (missing or empty) used to be a dead end: the file is ours, but we have no way to know what it looked
// like before we touched it, so we refused rather than guess (see below). When a target's edit is a
// pure, invertible transform (mcp-prefix's literal substitution), the caller can supply a best-effort
// reconstruction here — but it is NEVER trusted on its own. We call `verify(candidate)` and require the
// result to reproduce `current` BYTE FOR BYTE before accepting `candidate` as pristine. That round-trip
// is the actual proof; `recoverPoisoned` only ever offers a candidate plus how to check it.
//
// `verify` is supplied BY THE CALLER, deliberately not simply `patchFn` — `patchFn` is the FULL transform
// of every currently-ACTIVE claimant, which can be broader than whatever actually produced `current`. A
// sibling target installed alongside an already-patched one has never touched this file yet, so `current`
// predates its edit; proving a reconstruction against the full composed transform would compare a
// not-yet-applied edit's output against a `current` that cannot possibly contain it, and even a perfectly
// correct candidate would fail to verify. The caller knows which transform(s) actually produced `current`
// (see plugin-compose.mjs) and scopes `verify` to exactly that.
export function resolvePristine(file, patchFn, { isOurs, recoverPoisoned } = {}) {
  const backup = backupOf(file);
  const current = fs.readFileSync(file, 'utf8');
  const recognised = (src) => (isOurs ? isOurs(src) : src === patchFn(fs.existsSync(backup) ? fs.readFileSync(backup, 'utf8') : src));

  // Try to reconstruct a pristine for an already-poisoned file, and PROVE it before trusting it:
  // verify(candidate) must reproduce `current` exactly. Anything else — no candidate offered, no
  // verify function, the round-trip fails — falls straight through to the ordinary poisoned refusal.
  const tryRecover = () => {
    if (!recoverPoisoned) return null;
    let result;
    try { result = recoverPoisoned(current); } catch { return null; }
    if (!result || typeof result.candidate !== 'string' || !result.candidate.length || typeof result.verify !== 'function') return null;
    let reproduced;
    try { reproduced = result.verify(result.candidate); } catch { return null; }
    return reproduced === current ? result.candidate : null;
  };

  // An empty target is never something to patch, and never a valid pristine. `npx` and
  // plugin installs create files before writing them, so a hook or monitor tick landing
  // mid-extraction can read '' — and adopting that as pristine leads to writing '' back
  // over the real file. That truncation happened for real (see patch-library.rebuild).
  // If we cannot tell what the file should contain, we leave it alone.
  if (current.length === 0) return { pristine: null, rebaselined: false, empty: true };

  if (!fs.existsSync(backup)) {
    // No backup. If the file already looks like OUR output there is no vendor pristine to recover, and
    // inventing one would bake the patch into the baseline. Refuse rather than guess — unless a PROVEN
    // reconstruction is available.
    if (isOurs && isOurs(current)) {
      const recovered = tryRecover();
      if (recovered !== null) { fs.writeFileSync(backup, recovered); return { pristine: recovered, rebaselined: false, recovered: true }; }
      return { pristine: null, rebaselined: false, poisoned: true };
    }
    fs.copyFileSync(file, backup);
    return { pristine: current, rebaselined: false };
  }

  const saved = fs.readFileSync(backup, 'utf8');

  // An EMPTY backup is not a pristine file — it is a poisoned one, and it is lethal.
  // Guarding only `current` (above) misses this: with an empty `saved`, a healthy file
  // yields pristine='', no anchor matches, and the caller writes that empty pristine back
  // over the real file. Measured on the CLI patcher: 3954 bytes -> 0 in one monitor tick.
  if (saved.length === 0) {
    fs.rmSync(backup, { force: true });
    if (isOurs ? isOurs(current) : patchFn(current) === current) {
      // The file is already ours and we have no usable pristine — no honest way to recover
      // the vendor original, unless a PROVEN reconstruction is available.
      const recovered = tryRecover();
      if (recovered !== null) { fs.writeFileSync(backup, recovered); return { pristine: recovered, rebaselined: false, recovered: true }; }
      return { pristine: null, rebaselined: false, poisoned: true };
    }
    fs.copyFileSync(file, backup); // current is clean vendor code — adopt it
    return { pristine: current, rebaselined: true };
  }

  if (current === saved) return { pristine: saved, rebaselined: false };      // case 2
  if (recognised(current)) return { pristine: saved, rebaselined: false };    // case 1: our output, any combination

  // Case 3: on disk is neither the backup nor our output — upstream (or a human) rewrote
  // it. Their bytes are the new truth. Adopt them as pristine and re-derive the patch.
  fs.writeFileSync(backup, current);
  return { pristine: current, rebaselined: true };
}
