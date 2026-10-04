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
import { cliDescriptors, physicalFile } from './cwd/composition-adapter.mjs';
import { readState } from './cwd/state.mjs';
import { descriptor as adrTemplate } from './adr-template/patcher.mjs';
import { descriptor as adrIndex } from './adr-index/patcher.mjs';
import { descriptor as adrIoSafety } from './adr-io-safety/patcher.mjs';
import { descriptor as verifyInterface } from './verify-interface/patcher.mjs';
import { descriptor as mcpPrefix } from './mcp-prefix/patcher.mjs';
import { descriptor as designWall } from './design-wall/patcher.mjs';
import { descriptor as flywheelDaily } from './flywheel-daily/patcher.mjs';
import { descriptor as rufloHooksSchema } from './ruflo-hooks-schema/patcher.mjs';
import { descriptor as rufloSwarmCodexHooks } from './ruflo-swarm-codex-hooks/patcher.mjs';
import { descriptor as brainReleaseLockstep } from './brain-release-lockstep/patcher.mjs';
import { descriptor as brainConsoleLifecycle } from './brain-console-lifecycle/patcher.mjs';
import { descriptor as brainConsoleProviderKeys } from './brain-console-provider-keys/patcher.mjs';
import { descriptor as brainMemoryDoctorRoots } from './brain-memory-doctor-roots/patcher.mjs';
import { descriptor as brainSearchSafety } from './brain-search-safety/patcher.mjs';
import { descriptor as brainDualHostReceipt } from './brain-dual-host-receipt/patcher.mjs';
import { descriptor as brainDualHostStdin } from './brain-dual-host-stdin/patcher.mjs';
import { descriptor as brainGroundingEvidence } from './brain-grounding-evidence/patcher.mjs';
import { descriptor as brainGroundingCode } from './brain-grounding-code/patcher.mjs';
import { descriptor as brainTransitionNotice } from './brain-transition-notice/patcher.mjs';
import { descriptor as brainTransitionValidation } from './brain-transition-validation/patcher.mjs';
import { descriptor as brainManagedCliCapture } from './brain-managed-cli-capture/patcher.mjs';
import { descriptor as brainManagedMemoryBoundary } from './brain-managed-memory-boundary/composition.mjs';
import { descriptor as brainManagedCliGeneration } from './brain-managed-cli-generation/patcher.mjs';
import { descriptor as brainProgressionCollision } from './brain-progression-collision/patcher.mjs';
import { descriptor as brainRouterImports } from './brain-router-imports/patcher.mjs';
import { descriptor as metaharnessCodexHooks } from './metaharness-codex-hooks/patcher.mjs';
import { descriptor as rufloInstructionContract } from './ruflo-instruction-contract/patcher.mjs';
import { descriptor as rufloWrapperGuard } from './ruflo-wrapper-guard/patcher.mjs';
import { descriptor as rufloPatternReceipt } from './ruflo-pattern-receipt/patcher.mjs';
import { descriptor as rufloPolicySerialization } from './ruflo-policy-serialization/patcher.mjs';
import { descriptor as brainManagedCliDiagnostics } from './brain-managed-cli-diagnostics/patcher.mjs';
import { descriptor as brainProgressionSuspension } from './brain-progression-suspension/patcher.mjs';
import { descriptor as brainHostRecovery } from './brain-host-recovery/patcher.mjs';
import { descriptor as brainContinuitySummary } from './brain-continuity-summary/patcher.mjs';
import { descriptor as brainOutboxStreaming } from './brain-outbox-streaming/patcher.mjs';

// Compose order: the surgical, specific-file targets first, then the broad substitution sweep. The
// targets edit DISJOINT text (a status bullet, an importer's args, tool-ref tokens, a bash gate), so the
// order is result-invariant in practice; fixing one keeps the composed output stable, which is what
// resolvePristine's recogniser depends on.
const ORDER = [
  adrTemplate, adrIndex, adrIoSafety, verifyInterface, rufloHooksSchema, rufloSwarmCodexHooks, mcpPrefix, designWall, flywheelDaily,
  brainConsoleLifecycle, brainConsoleProviderKeys, brainReleaseLockstep, brainHostRecovery, brainMemoryDoctorRoots,
  brainSearchSafety, brainRouterImports, brainDualHostReceipt, brainDualHostStdin, brainGroundingEvidence, brainGroundingCode, brainTransitionNotice, brainTransitionValidation, brainManagedCliCapture, brainManagedCliDiagnostics, brainOutboxStreaming, brainContinuitySummary, brainProgressionSuspension, brainProgressionCollision, brainManagedMemoryBoundary, brainManagedCliGeneration,
  metaharnessCodexHooks,
  rufloInstructionContract,
  rufloWrapperGuard, rufloPatternReceipt, rufloPolicySerialization,
];
export const COMPOSE_TARGETS = ORDER.map((d) => d.name);

// Is this file output from one of the selected target descriptors? Scope matters: mcp-prefix's old
// replacement token is now native upstream content, so treating every historical descriptor's
// `isPatched` signal as global provenance makes a fresh current Ruflo install look locally patched.
// Exact compositions are still proved against the saved pristine, and reconcile supplies every
// target that should currently contribute to the file.
export const isOurs = (src, selected = COMPOSE_TARGETS) => ORDER
  .filter((descriptor) => selected.includes(descriptor.name))
  .some((descriptor) => (descriptor.hasPatch || descriptor.isPatched)(src));

// One target's contribution to a file. Atomic targets contribute nothing on a partial match.
function contribute(d, src) {
  const { next, applied, missing } = d.patchSource(src);
  const out = (d.atomic && missing.length) ? src : next;
  return { out, applied, missing };
}

// Exact provenance from the actual physical-file claimants. Native replacement
// bytes and marker-preserving external edits are never inferred to be our output.
function isKnownComposition(pristine, current, claimants, file) {
  let candidates = new Set([pristine]);
  for (const descriptor of claimants) {
    const next = new Set(candidates);
    let historical;
    try { historical = typeof descriptor.recover === 'function' ? descriptor.recover(current, file) : null; } catch {}
    for (const source of candidates) {
      // Current complete composition remains provable when overlapping sibling edits
      // make historical per-entry marker detection incomplete. Both require exact bytes.
      next.add(contribute(descriptor, source).out);
      if (typeof descriptor.historicalPatchSource === 'function')
        next.add(descriptor.historicalPatchSource(source, current).next);
      // A supported prior revision is trusted only when its exact inverse is
      // already one of the known compositions and its own forward proof agrees.
      if (historical?.candidate === source && typeof historical.verify === 'function'
        && historical.verify(source) === current) next.add(current);
    }
    candidates = next;
  }
  candidates.delete(pristine);
  return candidates.has(current);
}

// Pure composition helper for retirement preflights. It lets a target prove that live bytes are
// exactly "current upstream + the installed target set" before rebasing a stale pristine backup.
export function composeSource(source, installed = [], { file } = {}) {
  if (file !== undefined && (typeof file !== 'string' || !file)) throw new TypeError('composition file must be a nonempty path');
  const physicalFile = file === undefined ? null : fs.realpathSync.native(file);
  const descriptors = ORDER.filter((descriptor) => installed.includes(descriptor.name));
  if (file !== undefined) descriptors.unshift(...cliDescriptors([file], readState().patchTargets));
  return descriptors
    .filter((descriptor) => physicalFile === null || descriptor.discover().some(candidate => {
      try { return fs.realpathSync.native(candidate) === physicalFile; }
      catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
    }))
    .reduce((current, descriptor) => contribute(descriptor, current).out, source);
}

// Every file the given descriptors claim, mapped to the ordered descriptors that claim it.
function fileMap(descriptors) {
  const byFile = new Map();
  for (const d of descriptors) {
    for (const candidate of d.discover()) {
      const f = physicalFile(candidate);
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(d);
    }
  }
  return byFile;
}

// Custom atomic owners use the same exact subset provenance as this engine.
// This is read-only: a marker alone never proves a valid installed composition.
export function isKnownFileComposition(pristine, current, file, installed = COMPOSE_TARGETS) {
  const claimants = fileMap(ORDER).get(physicalFile(file)) || [];
  return isKnownComposition(pristine, current, claimants.filter(descriptor => installed.includes(descriptor.name)), file);
}

/**
 * Make every file the INSTALLED compose targets claim match `compose(pristine, their transforms)`.
 * Walks only installed descriptors, so a machine without mcp-prefix never pays for its tree scan.
 */
export function sharedCliFiles(files, installed = []) {
  const plugins = fileMap(ORDER);
  const selected = new Set();
  for (const candidate of files) {
    const file = physicalFile(candidate);
    const claimants = plugins.get(file) || [];
    if (claimants.some(d => installed.includes(d.name))
      || claimants.some(d => typeof d.hasPatch === 'function' && d.hasPatch(fs.readFileSync(file, 'utf8')))) selected.add(file);
  }
  return selected;
}
export function applySharedCliFiles(targets, files) {
  return applyComposed(readState().pluginTargets, { files, cliTargets: targets });
}
export function applyComposed(installed = [], { files, cliTargets = readState().patchTargets } = {}) {
  const active = ORDER.filter((d) => installed.includes(d.name));
  const pluginFiles = fileMap(active);
  const wantedFiles = files && new Set([...files].map(physicalFile));
  const adapters = cliDescriptors(wantedFiles || pluginFiles.keys(), cliTargets);
  active.unshift(...adapters);
  const selectedFiles = new Map([...fileMap(active)]
    .filter(([file]) => !wantedFiles || wantedFiles.has(file)));
  const historicalPlugins = adapters.length || active.some(descriptor => descriptor.transactionOwner) ? fileMap(ORDER) : new Map();
  const selectedDescriptors = new Set([...selectedFiles.values()].flat());
  const result = { patched: 0, unchanged: 0, skipped: 0, incomplete: 0, rebaselined: 0, restored: 0, errors: 0, log: [] };

  // Some targets own an interdependent bundle rather than one independent file. Their preflight
  // validates every expected member and every exact anchor before the engine writes any member.
  // If it fails, protect every file that target claims (including files shared with siblings):
  // applying only the readable half would manufacture the mixed runtime the bundle guard prevents.
  const blocked = new Map();
  for (const descriptor of active) {
    if (files && !selectedDescriptors.has(descriptor)) continue;
    if (typeof descriptor.preflight !== 'function') continue;
    try {
      const proof = descriptor.preflight();
      if (!proof?.ok) {
        const errors = Array.isArray(proof?.errors) && proof.errors.length
          ? proof.errors : ['bundle preflight returned no proof'];
        blocked.set(descriptor.name, errors);
        result.incomplete += errors.length;
        for (const error of errors) result.log.push(`INCOMPLETE [${descriptor.name}] — bundle preflight: ${error}`);
      }
    } catch (error) {
      blocked.set(descriptor.name, [error.message]);
      result.incomplete++;
      result.log.push(`INCOMPLETE [${descriptor.name}] — bundle preflight threw: ${error.message}`);
    }
  }

  for (const [file, claimants] of selectedFiles) {
    const blockers = claimants.filter((descriptor) => blocked.has(descriptor.name));
    if (blockers.length) {
      result.skipped++;
      result.log.push(`skip:bundle-preflight ${file} — protected because ${blockers.map((d) => d.name).join(', ')} did not pass its all-file preflight`);
      continue;
    }
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
      const provenance = claimants.some(d => d.cliOwner || d.transactionOwner)
        ? [...new Set([...claimants, ...(historicalPlugins.get(file) || [])])] : claimants;
      const recoverPoisoned = (current) => {
        const applied = provenance.filter((d) => (d.hasPatch || d.isPatched)(current));
        if (applied.length !== 1) return null;
        const d = applied[0];
        if (typeof d.recover === 'function') return d.recover(current, file);
        if (typeof d.reverse !== 'function') return null;
        return { candidate: d.reverse(current), verify: (c) => contribute(d, c).out };
      };

      const selectedIsOurs = (src) => provenance.some(d => (d.hasPatch || d.isPatched)(src));
      const current = fs.readFileSync(file, 'utf8');
      const backup = file + '.rsp-backup';
      if (claimants.some(d => d.cliOwner || d.transactionOwner) && fs.existsSync(backup)) {
        const saved = fs.readFileSync(backup, 'utf8');
        if (saved.length && !selectedIsOurs(saved) && current !== saved && selectedIsOurs(current)
          && !isKnownComposition(saved, current, provenance, file)) {
          result.incomplete++;
          result.log.push(`INCOMPLETE ${file} — local markers are not an exact known composition of the saved pristine; preserved both files`);
          continue;
        }
      }
      const { pristine, rebaselined, empty, poisoned, recovered } = resolvePristine(
        file,
        composed,
        { isOurs: selectedIsOurs, recoverPoisoned },
      );
      if (poisoned) {
        result.skipped++;
        if (claimants.some(d => d.cliOwner)) result.incomplete++;
        result.log.push(`skip:poisoned-backup ${file} — pristine unrecoverable; preserved live source and refused an unproved baseline`);
        continue;
      }
      if (empty) { result.skipped++; result.log.push(`skip:empty-file ${file} — zero bytes; refusing to patch or overwrite it`); continue; }
      if (recovered) { result.log.push(`recovered-pristine ${file} — backup was poisoned; reconstructed and PROVEN by round-trip (reverse then re-patch reproduced the file exactly)`); }
      if (rebaselined) { result.rebaselined++; result.log.push(`re-baselined ${file} — upstream replaced it; patching the NEW file, not restoring the old one`); }

      let src = pristine;
      const contribs = [];
      for (const d of claimants) { const c = contribute(d, src); src = c.out; contribs.push({ name: d.name, descriptor: d, ...c }); }
      const changed = writeIfChanged(file, src, { expectedCurrent: current });

      let anyIncomplete = false;
      for (const c of contribs) {
        if (c.missing.length && !c.applied.length && !c.descriptor.missingIsIncomplete) {
          result.log.push(`skip:no-anchor-matched ${file} [${c.name}] — missing: ${c.missing.join(', ')} (upstream may have fixed it; if so, uninstall that target)`);
        } else if (c.missing.length) {
          anyIncomplete = true;
          result.incomplete++;
          // An ATOMIC target contributed NOTHING (all-or-nothing), so its file is left untouched vendor
          // code — say so. A non-atomic target wrote the edits it could and names what it couldn't.
          result.log.push(c.descriptor.atomic
            ? `INCOMPLETE ${file} [${c.name}] — NOTHING WRITTEN (the file is left untouched vendor code). Anchors still matching: ${c.applied.join(', ') || 'none'}; NOT MATCHING: ${c.missing.join(', ')}. These edits are interdependent — a partial apply is refused.`
            : `INCOMPLETE ${file} [${c.name}] — applied: ${c.applied.join(', ') || 'none'}; NOT APPLIED: ${c.missing.join(', ')} (upstream shape changed?)`);
        }
      }
      const requiredModes = [...new Set(claimants
        .map((descriptor) => descriptor.mode)
        .filter((mode) => mode !== undefined))];
      if (requiredModes.length > 1) {
        throw new Error(`conflicting requested modes for ${file}: ${requiredModes.join(', ')}`);
      }
      let modeChanged = false;
      if (!anyIncomplete && requiredModes.length === 1) {
        const wanted = requiredModes[0];
        const currentMode = fs.statSync(file).mode & 0o7777;
        if (currentMode !== wanted) {
          fs.chmodSync(file, wanted);
          modeChanged = true;
        }
      }

      if (changed || modeChanged) {
        result.patched++;
        if (!anyIncomplete) {
          // Name each contributing target, with its applied/total edit count where it has one (the
          // surgical targets). This preserves the "N/5 edits" wording status/tests read.
          const parts = contribs.map((c) => {
            const ec = c.descriptor.editCount;
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
  const installedDescs = ORDER.filter((d) => installed.includes(d.name));
  const removedDescs = ORDER.filter((d) => removed.includes(d.name));
  const removedFiles = fileMap(removedDescs);
  installedDescs.unshift(...cliDescriptors(removedFiles.keys(), readState().patchTargets).filter(d => d.active));
  // Reconcile only files affected by this removal. Surviving claimants of those
  // files still compose and preflight normally; unrelated failures remain the
  // responsibility of full apply/check and cannot deadlock native retirement.
  const result = applyComposed(installed, { files: new Set(removedFiles.keys()) });
  const stillClaimed = new Set();
  for (const d of installedDescs) for (const f of d.discover()) stillClaimed.add(physicalFile(f));

  // Every orphaned file, with all removed descriptors that may have contributed to it. Restoration
  // is allowed only if the current bytes equal an exact composition of the saved pristine under one
  // or more of those descriptors. A marker alone is not provenance: an upstream update can preserve
  // a marker while changing everything around it.
  for (const [f, claimants] of removedFiles) {
    if (stillClaimed.has(f)) continue; // a surviving target owns it — applyComposed re-derived it

    const isKnownPatched = (pristine, current) => isKnownComposition(pristine, current, claimants, f);

    // `isPatched` can mean "the requirement is satisfied" for mixed/native rollouts. Prefer an
    // explicit `hasPatch` when a descriptor distinguishes our marker from native equivalent bytes;
    // otherwise retirement can mistake an upstream fix for an orphaned local edit and demand a
    // backup that correctly does not exist.
    const hasPatch = (current) => claimants.some((d) => (d.hasPatch || d.isPatched)(current));
    const r = restoreFromBackup(f, { isKnownPatched, hasPatch });

    if (r.unresolved) {
      result.errors++;
      result.unresolved = (result.unresolved || 0) + 1;
      result.log.push(`error restoring ${f} — ${r.reason}; preserved live bytes and refused to report reconciliation as complete`);
    } else if (r.staleBackupRemoved) {
      result.log.push(`preserved-upstream ${f} — live bytes are not one of our patch compositions; removed the stale backup instead of overwriting the external update`);
    } else if (r.poisoned) {
      result.log.push(`skip:poisoned-backup ${f} — empty .rsp-backup discarded; file left as-is`);
    } else if (r.restored) {
      result.restored++;
      result.log.push(`restored ${f}`);
    }
  }
  return result;
}

/** Per-target { files, patched } across every claimed file, for `status` / drift (walks all targets). */
export function statusComposed(selected = COMPOSE_TARGETS) {
  const descriptors = ORDER.filter((descriptor) => selected.includes(descriptor.name));
  const out = {};
  for (const d of descriptors) out[d.name] = { files: 0, patched: 0 };
  for (const [file, claimants] of fileMap(descriptors)) {
    // A descriptor that expects a missing/unreadable file must report N-1/N, never N-1/N-1.
    for (const d of claimants) out[d.name].files++;
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const d of claimants) {
      if (d.isPatched(src)) out[d.name].patched++;
    }
  }
  for (const descriptor of descriptors) {
    if (typeof descriptor.applicability !== 'function') continue;
    try { out[descriptor.name].applicability = descriptor.applicability(); }
    catch (error) {
      out[descriptor.name].applicability = { state: 'error', reason: error.message };
    }
  }
  return out;
}
