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
import path from 'node:path';
import { resolvePristine, writeIfChanged, restoreFromBackup } from './pristine.mjs';
import { existingPathRelative } from './path-containment.mjs';
import { cliDescriptors, cliObservationDescriptors, cliSourceFiles, physicalFile } from './cwd/composition-adapter.mjs';
import { contribute, isKnownComposition, unprovedMarkedComposition, observeComposition } from './composition-proof.mjs';
import { readState, isEmpty } from './cwd/state.mjs';
import { STATE_PATH } from './cwd/paths.mjs';
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
import { descriptor as brainCodexCompletion } from './brain-codex-completion/patcher.mjs';
import { descriptor as brainGroundingEvidence } from './brain-grounding-evidence/patcher.mjs';
import { descriptor as brainGroundingCode } from './brain-grounding-code/patcher.mjs';
import { descriptor as brainGroundingMultifile } from './brain-grounding-code/multifile.mjs';
import { descriptor as brainTransitionNotice } from './brain-transition-notice/patcher.mjs';
import { descriptor as brainTransitionValidation } from './brain-transition-validation/patcher.mjs';
import { descriptor as brainManagedCliCapture } from './brain-managed-cli-capture/patcher.mjs';
import { descriptor as brainManagedMemoryBoundary } from './brain-managed-memory-boundary/composition.mjs';
import { descriptor as brainManagedCliGeneration } from './brain-managed-cli-generation/patcher.mjs';
import { descriptor as brainProgressionCollision } from './brain-progression-collision/patcher.mjs';
import { descriptor as brainRouterImports } from './brain-router-imports/patcher.mjs';
import { descriptor as metaharnessCodexHooks } from './metaharness-codex-hooks/patcher.mjs';
import { descriptor as rufloInstructionContract } from './ruflo-instruction-contract/patcher.mjs';
import { descriptor as rufloContextGuidance } from './ruflo-context-guidance/patcher.mjs';
import { descriptor as rufloWrapperGuard } from './ruflo-wrapper-guard/patcher.mjs';
import { descriptor as rufloPatternReceipt } from './ruflo-pattern-receipt/patcher.mjs';
import { descriptor as rufloLearningPersistence } from './ruflo-learning-persistence/patcher.mjs';
import { descriptor as rufloPatternSearchResult } from './ruflo-pattern-search-result/patcher.mjs';
import { descriptor as brainTurnStatus } from './brain-turn-status/patcher.mjs';
import { descriptor as rufloPiiPolicy } from './ruflo-pii-policy/patcher.mjs';
import { descriptor as rufloAidefenceConfig } from './ruflo-aidefence-config/patcher.mjs';
import { descriptor as rufloAidefenceSchema } from './ruflo-aidefence-schema/patcher.mjs';
import { descriptor as rufloHookIdSchema } from './ruflo-hook-id-schema/patcher.mjs';
import { descriptor as rufloTierValueSchema } from './ruflo-tier-value-schema/patcher.mjs';
import { descriptor as rufloAtomicWrite } from './ruflo-atomic-write/patcher.mjs';
import { descriptor as rufloSelectiveLearning } from './ruflo-selective-learning/patcher.mjs';
import { descriptor as rufloTierConsolidation, bundles as consolidationBundles } from './ruflo-tier-consolidation/patcher.mjs';
import { descriptor as rufloControllerInventory } from './ruflo-controller-inventory/patcher.mjs';
import { descriptor as rufloPatternWithdrawal } from './ruflo-pattern-withdrawal/patcher.mjs';
import { descriptor as rufloFlywheelEvidence } from './ruflo-flywheel-evidence/patcher.mjs';
import { descriptor as rufloChampionAuthority } from './ruflo-champion-authority/patcher.mjs';
import { descriptor as rufloPolicySerialization } from './ruflo-policy-serialization/patcher.mjs';
import { descriptor as rufloPolicyLedger } from './ruflo-policy-ledger/patcher.mjs';
import { descriptor as brainManagedCliDiagnostics } from './brain-managed-cli-diagnostics/patcher.mjs';
import { descriptor as rufloMemoryEntriesOnly } from './ruflo-memory-entries-only/patcher.mjs';
import { descriptor as rufloMemoryOwner } from './ruflo-memory-owner/patcher.mjs';
import { descriptor as rufloHttpSessions } from './ruflo-http-sessions/patcher.mjs';
import { descriptor as rufloMemoryListPagination } from './ruflo-memory-list-pagination/patcher.mjs';
import { descriptor as rufloPolicyAnchorCopy } from './ruflo-policy-anchor-copy/patcher.mjs';
import { descriptor as brainRecallRuntime } from './brain-recall-runtime/patcher.mjs';
import { descriptor as brainRecallOwnerReuse } from './brain-recall-owner-reuse/patcher.mjs';
import { descriptor as brainHookTimeouts } from './brain-hook-timeouts/patcher.mjs';
import { descriptor as brainAdrEnvelope } from './brain-adr-envelope/patcher.mjs';
import { descriptor as brainPolicyInput } from './brain-policy-input/patcher.mjs';
import { descriptor as brainCaptureBudget } from './brain-capture-budget/patcher.mjs';
import { descriptor as brainCaptureDiagnostics } from './brain-capture-diagnostics/patcher.mjs';
import { descriptor as brainRestoreDiagnostics } from './brain-restore-diagnostics/patcher.mjs';
import { descriptor as brainCaptureLaunch } from './brain-capture-launch/patcher.mjs';
import { descriptor as brainCaptureIdempotency } from './brain-capture-idempotency/patcher.mjs';
import { descriptor as brainLearningNativeOwner } from './brain-learning-native-owner/patcher.mjs';
import { descriptor as brainLearningReceipts } from './brain-learning-receipts/patcher.mjs';
import { descriptor as brainScratchPreservation } from './brain-scratch-preservation/patcher.mjs';
import { descriptor as brainUserLearningRoot } from './brain-user-learning-root/patcher.mjs';
import { descriptor as brainProgressionSuspension } from './brain-progression-suspension/patcher.mjs';
import { prepareNativeProgressionSuspensionApplication } from './brain-progression-suspension/probe.mjs';
import { descriptor as brainWrapperOwnership } from './brain-wrapper-ownership/patcher.mjs';
import { descriptor as brainCodexInput } from './brain-codex-input/patcher.mjs';
import { descriptor as brainHostRecovery } from './brain-host-recovery/patcher.mjs';
import { descriptor as brainContinuitySummary } from './brain-continuity-summary/patcher.mjs';
import { descriptor as brainOutboxStreaming } from './brain-outbox-streaming/patcher.mjs';
import { descriptor as hookFailureLog } from './hook-failure-log/patcher.mjs';
import { descriptor as rufloWorktreeMemory } from './ruflo-worktree-memory/patcher.mjs';

// Compose order: the surgical, specific-file targets first, then the broad substitution sweep. The
// targets edit DISJOINT text (a status bullet, an importer's args, tool-ref tokens, a bash gate), so the
// order is result-invariant in practice; fixing one keeps the composed output stable, which is what
// resolvePristine's recogniser depends on.
const ORDER = [
  rufloWorktreeMemory,
  rufloMemoryEntriesOnly,
  rufloMemoryOwner, rufloHttpSessions, rufloMemoryListPagination, rufloPolicyAnchorCopy,
  adrTemplate, adrIndex, adrIoSafety, verifyInterface, rufloHooksSchema, rufloSwarmCodexHooks, mcpPrefix, designWall, flywheelDaily,
  brainConsoleLifecycle, brainConsoleProviderKeys, brainReleaseLockstep, brainHostRecovery, brainWrapperOwnership, brainCodexInput, brainMemoryDoctorRoots,
  brainSearchSafety, brainRouterImports, brainDualHostReceipt, brainDualHostStdin, brainCodexCompletion, brainGroundingEvidence, brainGroundingCode, brainGroundingMultifile, brainTransitionNotice, brainTransitionValidation, brainManagedCliCapture, brainManagedCliDiagnostics, brainOutboxStreaming, brainContinuitySummary, brainProgressionSuspension, brainProgressionCollision, brainManagedMemoryBoundary, brainManagedCliGeneration,
  metaharnessCodexHooks,
  rufloInstructionContract,
  rufloContextGuidance,
  rufloWrapperGuard, rufloPatternReceipt, rufloLearningPersistence, rufloPatternSearchResult, rufloAidefenceConfig, rufloAidefenceSchema, rufloHookIdSchema, rufloTierValueSchema, rufloAtomicWrite, rufloPiiPolicy, rufloTierConsolidation, rufloSelectiveLearning, rufloPatternWithdrawal, rufloControllerInventory, rufloPolicySerialization, rufloPolicyLedger, rufloFlywheelEvidence, rufloChampionAuthority,
  brainUserLearningRoot, brainLearningReceipts, brainLearningNativeOwner, brainCaptureBudget, brainAdrEnvelope, brainPolicyInput, brainRecallRuntime, brainScratchPreservation, brainCaptureDiagnostics, brainRestoreDiagnostics, brainCaptureLaunch, brainCaptureIdempotency, brainTurnStatus, brainRecallOwnerReuse, hookFailureLog, brainHookTimeouts,
];
export const COMPOSE_TARGETS = ORDER.map((d) => d.name);

// SessionStart observes already-installed exact bytes without entering the
// writer. Uncomposed targets retain their existing mutating qualification.
export function installedCompositionHealthy(state) {
  if (state.pluginTargets.some(target => !COMPOSE_TARGETS.includes(target))
    || state.patchTargets.some(target => !cliSourceFiles([target]).length)) return false;
  const selected = ORDER.filter(d => state.pluginTargets.includes(d.name));
  const active = () => {
    const files = new Set([...fileMap(selected).keys(), ...cliSourceFiles()]);
    return [...cliObservationDescriptors(files, state.patchTargets), ...selected];
  };
  return observeComposition(active(), () => fileMap(active()));
}
// One fresh desired-state proof for SessionStart and the monitor. Additional
// monitor qualifications stay inside the same before/after state identity check.
export function installedStateHealthy(qualify = () => true) {
  const before = fs.statSync(STATE_PATH, { bigint: true });
  const identity = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
  const desired = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')), state = readState();
  if (isEmpty(state) || JSON.stringify(desired.patchTargets) !== JSON.stringify(state.patchTargets)
    || JSON.stringify(desired.pluginTargets) !== JSON.stringify(state.pluginTargets)) return false;
  return qualify(state) && installedCompositionHealthy(state)
    && identity(before) === identity(fs.statSync(STATE_PATH, { bigint: true }));
}
// Bind the mutating handoff in the composition owner, avoiding a patcher ->
// behavioral probe -> composer initialization cycle for pure source callers.
brainProgressionSuspension.prepare = prepareNativeProgressionSuspensionApplication;
rufloTierConsolidation.proveComposition = isKnownFileComposition;
// A withdrawn adapter's native health must recognize this exact sibling composition,
// without accepting its old markers or treating unknown edits as verified source.
const nativeRecallHealth = brainRecallRuntime.isPatched;
const withdrawRecall = brainRecallRuntime.patchSource;
const beforeTimeoutProfile = source => brainHookTimeouts.isPatched(source) ? brainHookTimeouts.reverse(source) : source;
const verifiedRecallSibling = source => {
  source = beforeTimeoutProfile(source);
  if (brainRecallRuntime.hasPatch(source) || !brainRecallOwnerReuse.isPatched(source)) return false;
  const native = brainRecallOwnerReuse.reverse(source);
  const proof = brainRecallOwnerReuse.patchSource(native);
  return nativeRecallHealth(native) && !proof.missing.length && proof.next === source;
};
brainRecallRuntime.isPatched = source => nativeRecallHealth(beforeTimeoutProfile(source)) || verifiedRecallSibling(source);
brainRecallRuntime.patchSource = source => verifiedRecallSibling(source)
  ? { next: source, applied: [], missing: [] } : withdrawRecall(source);

// Is this file output from one of the selected target descriptors? Scope matters: mcp-prefix's old
// replacement token is now native upstream content, so treating every historical descriptor's
// `isPatched` signal as global provenance makes a fresh current Ruflo install look locally patched.
// Exact compositions are still proved against the saved pristine, and reconcile supplies every
// target that should currently contribute to the file.
export const isOurs = (src, selected = COMPOSE_TARGETS) => ORDER
  .filter((descriptor) => selected.includes(descriptor.name))
  .some((descriptor) => (descriptor.hasPatch || descriptor.isPatched)(src));


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
    .reduce((current, descriptor) => contribute(descriptor, current, physicalFile || undefined).out, source);
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

// Native Console promotion copies this executable without its adjacent backup.
// Authenticate the same package/version/relative entrypoint; content equality
// alone must never borrow a pristine from another product or generation.
function brainInstallerIdentity(file) {
  if (path.basename(file) !== 'install.mjs' || path.basename(path.dirname(file)) !== 'bin') return null;
  const root = path.dirname(path.dirname(file)), manifest = path.join(root, 'package.json');
  try {
    if (existingPathRelative(root, file) !== path.join('bin', 'install.mjs')
      || existingPathRelative(root, manifest) !== 'package.json'
      || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()
      || !fs.lstatSync(manifest).isFile() || fs.lstatSync(manifest).isSymbolicLink()) return null;
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return pkg.name === 'ruvnet-brain' && typeof pkg.version === 'string'
      && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(pkg.version)
      ? JSON.stringify([pkg.name, pkg.version, 'bin/install.mjs']) : null;
  } catch { return null; }
}

function recoverFromConsolePeer(file, current, knownFiles) {
  const identity = brainInstallerIdentity(file);
  if (!identity) return null;
  const owners = knownFiles.get(file) || [], candidates = new Set();
  for (const [peer, peerOwners] of knownFiles) {
    if (peer === file || brainInstallerIdentity(peer) !== identity) continue;
    try {
      const backup = peer + '.rsp-backup', stat = fs.lstatSync(backup);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
        || existingPathRelative(path.dirname(path.dirname(peer)), backup) !== path.join('bin', 'install.mjs.rsp-backup')) continue;
      const pristine = fs.readFileSync(backup, 'utf8');
      if (!pristine.length || pristine.includes('ruflo-source-patch')
        || fs.readFileSync(peer, 'utf8') !== current
        || !isKnownComposition(pristine, current, peerOwners, peer)
        || !isKnownComposition(pristine, current, owners, file)
        || brainInstallerIdentity(peer) !== identity) continue;
      candidates.add(pristine);
    } catch { /* Missing/unreadable/foreign peers provide no recovery evidence. */ }
  }
  if (candidates.size !== 1 || brainInstallerIdentity(file) !== identity) return null;
  const [candidate] = candidates;
  return { candidate, verify: source => isKnownComposition(source, current, owners, file) ? current : source };
}

// Custom atomic owners use the same exact subset provenance as this engine.
// This is read-only: a marker alone never proves a valid installed composition.
export function isKnownFileComposition(pristine, current, file, installed = COMPOSE_TARGETS) {
  const claimants = fileMap(ORDER).get(physicalFile(file)) || [];
  return isKnownComposition(pristine, current, [
    ...cliDescriptors([file], readState().patchTargets),
    ...claimants.filter(descriptor => installed.includes(descriptor.name)),
  ], file);
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
export function applyComposed(installed = [], { files, cliTargets = readState().patchTargets, removed = [] } = {}) {
  if (files) {
    files = new Set([...files].map(physicalFile)); installed = [...installed];
    // A narrow core command or plugin removal still withdraws complete released
    // bundles: context lineage, tier controller, and the selected-learning caller.
    for (const bundle of consolidationBundles()) {
      if (!bundle.files.some(file => files.has(physicalFile(file)))) continue;
      if (!bundle.files.some(file => fs.existsSync(file) && rufloTierConsolidation.hasPatch(fs.readFileSync(file, 'utf8')))) continue;
      for (const file of bundle.files) files.add(physicalFile(file));
      if (!installed.includes(rufloTierConsolidation.name)) installed.push(rufloTierConsolidation.name);
    }
    for (const bridge of rufloSelectiveLearning.discover().filter(file => file.endsWith('/memory/memory-bridge.js'))) {
      if (!files.has(physicalFile(bridge)) || !rufloSelectiveLearning.hasPatch(fs.readFileSync(bridge, 'utf8'))) continue;
      files.add(physicalFile(path.join(path.dirname(path.dirname(bridge)), 'mcp-tools/hooks-tools.js')));
      if (!installed.includes(rufloSelectiveLearning.name) && !removed.includes(rufloSelectiveLearning.name)) installed.push(rufloSelectiveLearning.name);
    }
  }
  const active = ORDER.filter((d) => installed.includes(d.name));
  const removedProvenance = fileMap(ORDER.filter(d => removed.includes(d.name)));
  const pluginFiles = fileMap(active);
  const wantedFiles = files && new Set([...files].map(physicalFile));
  const adapters = cliDescriptors(wantedFiles || pluginFiles.keys(), cliTargets);
  active.unshift(...adapters);
  const selectedFiles = new Map([...fileMap(active)]
    .filter(([file]) => !wantedFiles || wantedFiles.has(file)));
  const historicalPlugins = adapters.length || active.some(descriptor => descriptor.transactionOwner) ? fileMap(ORDER) : new Map();
  let recoveryFiles;
  const selectedDescriptors = new Set([...selectedFiles.values()].flat());
  const result = { patched: 0, unchanged: 0, skipped: 0, incomplete: 0, rebaselined: 0, restored: 0, errors: 0, log: [] };

  // Some targets own an interdependent bundle rather than one independent file. Their preflight
  // validates every expected member and every exact anchor before the engine writes any member.
  // If it fails, protect every file that target claims (including files shared with siblings):
  // applying only the readable half would manufacture the mixed runtime the bundle guard prevents.
  const blocked = new Map();
  for (const descriptor of active) {
    if (files && !selectedDescriptors.has(descriptor)) continue;
    if (typeof descriptor.preflight !== 'function' && typeof descriptor.prepare !== 'function') continue;
    try {
      // Explicit mutating preparation belongs only here, never in status or
      // pure composition. A failed handoff protects the whole claimed bundle.
      const prepared = descriptor.prepare?.();
      if (prepared?.log) result.log.push(...prepared.log);
      if (prepared?.errors?.length) throw Error(prepared.errors.join('; '));
      const proof = descriptor.preflight?.() || { ok: true };
      if (!proof?.ok) {
        const errors = Array.isArray(proof?.errors) && proof.errors.length
          ? proof.errors : ['bundle preflight returned no proof'];
        let scoped = null;
        if (proof.blockedFiles !== undefined) {
          const owned = new Set(descriptor.discover().map(physicalFile));
          if (!Array.isArray(proof.blockedFiles) || !proof.blockedFiles.length
            || proof.blockedFiles.some(file => typeof file !== 'string' || !path.isAbsolute(file) || !owned.has(physicalFile(file))))
            throw Error('Invalid package preflight file scope');
          scoped = new Set(proof.blockedFiles.map(physicalFile));
        }
        blocked.set(descriptor.name, scoped);
        result.incomplete += errors.length;
        for (const error of errors) result.log.push(`INCOMPLETE [${descriptor.name}] — bundle preflight: ${error}`);
      }
    } catch (error) {
      blocked.set(descriptor.name, null);
      result.incomplete++;
      result.log.push(`INCOMPLETE [${descriptor.name}] — bundle preflight threw: ${error.message}`);
    }
  }

  // These released overlays share the bridge: either caller/controller refusal
  // protects both bundles, otherwise a removed export or lineage method dangles.
  if (active.includes(rufloTierConsolidation) && active.includes(rufloSelectiveLearning)
    && [rufloTierConsolidation.name, rufloSelectiveLearning.name].some(name => blocked.has(name))) {
    blocked.set(rufloTierConsolidation.name, null);
    blocked.set(rufloSelectiveLearning.name, null);
  }

  for (const [file, claimants] of selectedFiles) {
    const blockers = claimants.filter(descriptor => blocked.has(descriptor.name)
      && (!blocked.get(descriptor.name) || blocked.get(descriptor.name).has(file)));
    if (blockers.length) {
      result.skipped++;
      result.log.push(`skip:bundle-preflight ${file} — protected because ${blockers.map((d) => d.name).join(', ')} did not pass its all-file preflight`);
      continue;
    }
    try {
      const composed = (src) => claimants.reduce((s, d) => contribute(d, s, file).out, src);

      // One applied owner's exact inverse remains independently provable even
      // when a newly selected sibling has not contributed yet. Multiple owners
      // require a healthy same-identity Console peer and exact shared provenance.
      // Uninstall must recognize removed owners without applying their transforms.
      // Otherwise a surviving target can mistake their bytes for a new upstream baseline.
      const provenance = [...new Set([...claimants, ...(removedProvenance.get(file) || []),
        ...(claimants.some(d => d.cliOwner || d.transactionOwner) ? historicalPlugins.get(file) || [] : [])])]
        .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
      const recoverPoisoned = (current) => {
        const actualOwners = brainInstallerIdentity(file)
          ? (recoveryFiles ||= fileMap(ORDER)).get(file) || provenance : provenance;
        const applied = actualOwners.filter((d) => (d.hasPatch || d.isPatched)(current));
        if (applied.length !== 1) return recoverFromConsolePeer(file, current, recoveryFiles ||= fileMap(ORDER));
        const d = applied[0];
        if (typeof d.recover === 'function') return d.recover(current, file);
        if (typeof d.reverse !== 'function') return null;
        return { candidate: d.fileContext ? d.reverse(current, file) : d.reverse(current), verify: (c) => contribute(d, c, file).out };
      };

      const selectedIsOurs = (src) => provenance.some(d => (d.hasPatch || d.isPatched)(src));
      const current = fs.readFileSync(file, 'utf8');
      const backup = file + '.rsp-backup';
      const consoleIdentity = brainInstallerIdentity(file);
      if ((consoleIdentity || removedProvenance.has(file) || claimants.some(d => d.cliOwner || d.transactionOwner)) && fs.existsSync(backup)) {
        const saved = fs.readFileSync(backup, 'utf8');
        const knownOwners = consoleIdentity ? (recoveryFiles ||= fileMap(ORDER)).get(file) || provenance : provenance;
        if (unprovedMarkedComposition(saved, current, knownOwners, file, provenance)) {
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
        result.incomplete++;
        result.log.push(`skip:poisoned-backup ${file} — pristine unrecoverable; preserved live source and refused an unproved baseline`);
        continue;
      }
      if (empty) { result.skipped++; result.log.push(`skip:empty-file ${file} — zero bytes; refusing to patch or overwrite it`); continue; }
      if (recovered) { result.log.push(`recovered-pristine ${file} — missing or poisoned backup; reconstructed and PROVEN by exact source composition`); }
      if (rebaselined) { result.rebaselined++; result.log.push(`re-baselined ${file} — upstream replaced it; patching the NEW file, not restoring the old one`); }

      let src = pristine;
      const contribs = [];
      for (const d of claimants) { const c = contribute(d, src, file); src = c.out; contribs.push({ name: d.name, descriptor: d, ...c }); }
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
  for (const descriptor of removedDescs.filter(d => d.preflightOnRemove)) {
    const proof = descriptor.preflight();
    if (!proof.ok) return { patched: 0, restored: 0, errors: 1, incomplete: 1, unresolved: 1,
      log: (proof.errors || ['withdrawal preflight failed']).map(error => `INCOMPLETE ${descriptor.name}: ${error}`) };
  }
  const removedFiles = fileMap(removedDescs);
  installedDescs.unshift(...cliDescriptors(removedFiles.keys(), readState().patchTargets).filter(d => d.active));
  // Reconcile only files affected by this removal. Surviving claimants of those
  // files still compose and preflight normally; unrelated failures remain the
  // responsibility of full apply/check and cannot deadlock native retirement.
  const result = applyComposed(installed, { files: new Set(removedFiles.keys()), removed });
  if (result.incomplete || result.errors) return { ...result, unresolved: 1 };
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
  const selectedFiles = fileMap(descriptors);
  const cliOwners = fileMap(cliDescriptors(selectedFiles.keys(), readState().patchTargets));
  let historicalFiles;
  const out = {};
  for (const d of descriptors) out[d.name] = { files: 0, patched: 0, ...(d.restorationOnly ? { restorationOnly: true } : {}) };
  for (const [file, claimants] of selectedFiles) {
    // A descriptor that expects a missing/unreadable file must report N-1/N, never N-1/N-1.
    for (const d of claimants) out[d.name].files++;
    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
      const owners = [...(cliOwners.get(file) || []), ...claimants];
      if ((brainInstallerIdentity(file) || owners.some(d => d.cliOwner || d.transactionOwner))
        && fs.existsSync(file + '.rsp-backup')) {
        const known = [...new Set([...owners, ...((historicalFiles ||= fileMap(ORDER)).get(file) || [])])];
        if (unprovedMarkedComposition(fs.readFileSync(file + '.rsp-backup', 'utf8'), src, known, file)) continue;
      }
    } catch { continue; }
    for (const d of claimants) {
      if (d.fileContext ? d.isPatched(src, file) : d.isPatched(src)) out[d.name].patched++;
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
