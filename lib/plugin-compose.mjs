// Composition engine for the plugin patch targets — the plugin-side equivalent of what
// patch-library.mjs already does for {cwd, daemon, memory} (ADR-020).
//
// THE BUG THIS FIXES. Each plugin patcher used to own its whole apply loop and call
// `resolvePristine(file, ITS_OWN_transform)`. That function assumes ONE transform per file. When two
// targets patch the same file (mcp-prefix's tool-ref sweep crossing adr-template's adr-create/SKILL.md),
// the SECOND target's single-transform check does not recognise the FIRST's output as "ours", concludes
// "upstream replaced it", and RE-BASELINES — overwriting the shared `.rsp-backup` (the vendor pristine)
// with the sibling's PATCHED bytes. The pristine is then lost and neither target can cleanly uninstall.
//
// THE MODEL. One `.rsp-backup` per file = the true vendor pristine. The file on disk is always
// `compose(pristine, [transform of each INSTALLED target that claims the file])`. The engine — not the
// individual target — owns each file: it groups files by their ordered claimants, resolves the ONE
// pristine (handing resolvePristine the COMPOSED transform, so it recognises the composed output and
// never false-re-baselines), applies each claimant in order, and writes once. Uninstall re-derives a
// shared file with only the remaining claimants, and restores a now-orphaned file to pristine. This is
// exactly ADR-001's "several may patch the same file and each can be removed independently".
//
// COST. The hot path (SessionStart hook + every monitor tick) only walks the descriptors that are
// INSTALLED — so a machine without mcp-prefix never pays for its ruflo-tree scan, exactly as before this
// engine existed. Only apply-installed and the deliberate uninstall of mcp-prefix trigger its walk.
//
// Each target is a DESCRIPTOR: { name, atomic, discover(), patchSource(src)->{next,applied,missing},
// isPatched(src) }. `atomic` targets (verify-interface) contribute all-or-nothing: a partial match
// contributes NOTHING, so the vendor file is left exactly as shipped rather than half-patched.

import fs from 'node:fs';
import { resolvePristine, writeIfChanged, restoreFromBackup } from './pristine.mjs';
import { descriptor as adrTemplate } from './adr-template/patcher.mjs';
import { descriptor as adrIndex } from './adr-index/patcher.mjs';
import { descriptor as verifyInterface } from './verify-interface/patcher.mjs';
import { descriptor as mcpPrefix } from './mcp-prefix/patcher.mjs';
import { descriptor as designWall } from './design-wall/patcher.mjs';
import { descriptor as memoryHealth } from './memory-health/patcher.mjs';

// Compose order: the surgical, specific-file targets first, then the broad substitution sweep. The
// targets edit DISJOINT text (a status bullet, an importer's args, tool-ref tokens, a bash gate, a
// spawn option), so the order is result-invariant in practice; fixing one keeps the composed output
// stable, which is what resolvePristine's recogniser depends on.
const ORDER = [adrTemplate, adrIndex, verifyInterface, mcpPrefix, designWall, memoryHealth];
const BY_NAME = Object.fromEntries(ORDER.map((d) => [d.name, d]));
export const COMPOSE_TARGETS = ORDER.map((d) => d.name);

// Is this file OUR output under ANY combination of targets? Used by resolvePristine to decide
// re-baseline: a file still carrying an UNINSTALLED target's edits is ours, not an upstream change, so we
// keep the vendor backup and re-derive with only the active targets (mirrors patch-library's isOurs).
// Each isPatched is a POSITIVE, file-shape-specific signal, so a descriptor that does not claim a file
// never reports it as patched.
// Exported so test fixtures can detect "is this file ours under ANY composing target" the SAME
// way the real engine does — a single-target check (adr-template's own signature alone) misses a
// file mcp-prefix ALSO composes on, which is exactly the gap that let a genuinely mcp-prefix-patched
// vendor fixture pass as "clean" and mask the poisoned-backup bug (plugin-notify.mjs's P1).
export const isOurs = (src) => ORDER.some((d) => d.isPatched(src));

// One target's contribution to a file. Atomic targets contribute nothing on a partial match.
function contribute(d, src) {
  const { next, applied, missing } = d.patchSource(src);
  const out = (d.atomic && missing.length) ? src : next;
  return { out, applied, missing };
}

// Every file the given descriptors claim, mapped to the ordered descriptors that claim it.
function fileMap(descriptors) {
  const byFile = new Map();
  for (const d of ORDER) {
    if (!descriptors.includes(d)) continue;
    for (const f of d.discover()) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(d);
    }
  }
  return byFile;
}

/**
 * Make every file the INSTALLED compose targets claim match `compose(pristine, their transforms)`.
 * Walks only installed descriptors, so a machine without mcp-prefix never pays for its tree scan.
 */
export function applyComposed(installed = []) {
  const active = ORDER.filter((d) => installed.includes(d.name));
  const result = { patched: 0, unchanged: 0, skipped: 0, incomplete: 0, rebaselined: 0, restored: 0, errors: 0, log: [] };

  for (const [file, claimants] of fileMap(active)) {
    try {
      const composed = (src) => claimants.reduce((s, d) => contribute(d, s).out, src);

      // Best-effort poisoned-backup recovery (see pristine.mjs's `recoverPoisoned` contract). Only
      // attempted when EXACTLY ONE claimant's edit is actually present in `current` (isPatched, not
      // merely "discovers this file" — a target that hasn't touched it yet has nothing to reverse) AND
      // that one exposes a `reverse`. Two-or-more actually-applied claimants is genuinely ambiguous
      // (which order would they un-compose in?) and is refused, same as today — never guessed at.
      //
      // The round-trip proof MUST be scoped to just that one descriptor's own forward transform, not
      // the full `composed` pipeline of every currently-ACTIVE claimant. A newly-installed sibling
      // (adr-template just added alongside an already-patched mcp-prefix) is active but has never
      // touched this file — `current` predates its edit. Proving against the FULL composed transform
      // would compare a not-yet-applied edit's output against a `current` that cannot possibly contain
      // it, and a correct reconstruction would (uselessly) never verify. So `verify` here re-applies
      // ONLY the descriptor being reversed — the exact transform that produced `current` — and the
      // caller (resolvePristine) still re-proves this before trusting it; this only offers a candidate.
      const recoverPoisoned = (current) => {
        const applied = claimants.filter((d) => d.isPatched(current));
        if (applied.length !== 1 || typeof applied[0].reverse !== 'function') return null;
        const d = applied[0];
        return { candidate: d.reverse(current), verify: (c) => contribute(d, c).out };
      };

      const { pristine, rebaselined, empty, poisoned, recovered } = resolvePristine(file, composed, { isOurs, recoverPoisoned });
      if (poisoned) { result.skipped++; result.log.push(`skip:poisoned-backup ${file} — empty backup discarded; pristine unrecoverable, reinstall the plugin`); continue; }
      if (empty) { result.skipped++; result.log.push(`skip:empty-file ${file} — zero bytes; refusing to patch or overwrite it`); continue; }
      if (recovered) { result.log.push(`recovered-pristine ${file} — backup was poisoned; reconstructed and PROVEN by round-trip (reverse then re-patch reproduced the file exactly)`); }
      if (rebaselined) { result.rebaselined++; result.log.push(`re-baselined ${file} — upstream replaced it; patching the NEW file, not restoring the old one`); }

      let src = pristine;
      const contribs = [];
      for (const d of claimants) { const c = contribute(d, src); src = c.out; contribs.push({ name: d.name, ...c }); }
      const changed = writeIfChanged(file, src);

      let anyIncomplete = false;
      for (const c of contribs) {
        if (c.missing.length && !c.applied.length) {
          result.log.push(`skip:no-anchor-matched ${file} [${c.name}] — missing: ${c.missing.join(', ')} (upstream may have fixed it; if so, uninstall that target)`);
        } else if (c.missing.length) {
          anyIncomplete = true;
          result.incomplete++;
          // An ATOMIC target contributed NOTHING (all-or-nothing), so its file is left untouched vendor
          // code — say so. A non-atomic target wrote the edits it could and names what it couldn't.
          result.log.push(BY_NAME[c.name].atomic
            ? `INCOMPLETE ${file} [${c.name}] — NOTHING WRITTEN (the file is left untouched vendor code). Anchors still matching: ${c.applied.join(', ') || 'none'}; NOT MATCHING: ${c.missing.join(', ')}. These edits are interdependent — a partial apply is refused.`
            : `INCOMPLETE ${file} [${c.name}] — applied: ${c.applied.join(', ') || 'none'}; NOT APPLIED: ${c.missing.join(', ')} (upstream shape changed?)`);
        }
      }
      if (changed) {
        result.patched++;
        if (!anyIncomplete) {
          // Name each contributing target, with its applied/total edit count where it has one (the
          // surgical targets). This preserves the "N/5 edits" wording status/tests read.
          const parts = contribs.map((c) => {
            const ec = BY_NAME[c.name].editCount;
            return ec ? `${c.name} ${c.applied.length}/${ec} edits` : c.name;
          });
          result.log.push(`patched ${file} <- ${parts.join(', ')}`);
        }
      } else result.unchanged++;
    } catch (err) {
      result.errors++;
      result.log.push(`error ${file}: ${err.message}`);
    }
  }
  return result;
}

/**
 * Reconcile after an uninstall: re-derive the still-installed set, then restore any file the REMOVED
 * targets claimed that no installed target still claims. A file shared with a surviving target is
 * re-composed (the removed target's edits dropped) by applyComposed above; a file the removed target
 * owned alone is restored to pristine here.
 */
export function reconcile(installed = [], removed = []) {
  const result = applyComposed(installed);
  const installedDescs = ORDER.filter((d) => installed.includes(d.name));
  const stillClaimed = new Set();
  for (const d of installedDescs) for (const f of d.discover()) stillClaimed.add(f);

  for (const name of removed) {
    const d = BY_NAME[name];
    if (!d) continue;
    for (const f of d.discover()) {
      if (stillClaimed.has(f)) continue; // a surviving target owns it — applyComposed re-derived it
      const r = restoreFromBackup(f);
      if (r.poisoned) result.log.push(`skip:poisoned-backup ${f} — empty .rsp-backup discarded; file left as-is`);
      else if (r.restored) { result.restored++; result.log.push(`restored ${f}`); }
    }
  }
  return result;
}

/** Per-target { files, patched } across every claimed file, for `status` / drift (walks all targets). */
export function statusComposed() {
  const out = {};
  for (const d of ORDER) out[d.name] = { files: 0, patched: 0 };
  for (const [file, claimants] of fileMap(ORDER)) {
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const d of claimants) {
      out[d.name].files++;
      if (d.isPatched(src)) out[d.name].patched++;
    }
  }
  return out;
}
