// ADR-322A authority must survive the framework auto-apply described by Ruflo #2579.
// #2579 is source context, not a defect-specific report for this observed conflict.
import fs from 'node:fs';
import path from 'node:path';
import { existingPathRelative } from '../path-containment.mjs';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
export const NAME = 'ruflo-champion-authority';
export const PATCH_MARKER = 'ruflo-source-patch (ruflo#2579 ADR-322A authority)';
export const GUARD = `// ${PATCH_MARKER}: reuse the native promotion lock; never steal it.
function __rspWithChampionAuthority(cfDir, apply) {
    const dir = path.join(cfDir, 'flywheel-v1');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(dir).isSymbolicLink())
        return { applied: false, reason: 'unsafe flywheel authority directory' };
    const lock = path.join(dir, 'transaction-state.lock');
    let fd;
    try {
        fd = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    }
    catch (error) {
        if (error.code === 'EEXIST')
            return { applied: false, reason: 'flywheel authority busy; framework apply deferred' };
        throw error;
    }
    let owned;
    try {
        owned = fs.fstatSync(fd);
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }), 'utf8');
        const file = path.join(dir, 'transaction-state.json');
        let stat;
        try { stat = fs.lstatSync(file); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (stat) {
            if (!stat.isFile() || stat.isSymbolicLink())
                return { applied: false, reason: 'unsafe flywheel authority state' };
            const state = JSON.parse(fs.readFileSync(file, 'utf8'));
            // Only the native empty-owner shape permits a framework baseline.
            // A committed/pending owner, corrupt state or new schema is never absence.
            if (state?.version !== 1 || !Array.isArray(state.commits)
                || !state.receiptStates || typeof state.receiptStates !== 'object'
                || Array.isArray(state.receiptStates))
                return { applied: false, reason: 'unverified flywheel authority state' };
            if (state.activeChampionRef !== null || state.activePolicy !== null
                || state.activeGateVersion !== null || state.activePolicySchemaVersion !== null
                || state.activeSafetyEnvelopeRef !== null || state.ledgerHead !== 'sha256:' + '0'.repeat(64)
                || state.servingEpoch !== 0 || state.materializedServingEpoch !== 0
                || state.servedChampionRef !== null || state.commits.length !== 0)
                return { applied: false, reason: 'flywheel promotion owns the active policy' };
        }
        return apply();
    }
    finally {
        try { fs.closeSync(fd); }
        finally {
            // Remove only our inode; a replaced or foreign lock remains untouched.
            try {
                const current = fs.lstatSync(lock);
                if (owned && !current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino)
                    fs.unlinkSync(lock);
            }
            catch { /* absent or inaccessible lock is never removed speculatively */ }
        }
    }
}
`;
const comment = '/**\n * Apply the adopted champion to the active harness policy.';
const entry = `        if (!adopted?.championId)
            return { applied: false, reason: 'no adopted champion' };
        const cfDir = path.join(cwd, '.claude-flow');
        const activePath = path.join(cfDir, ACTIVE_POLICY_FILE);`;
const exit = `        return { applied: true, from: active.previous, to: active.championId };
    }
    catch (e) {
        return { applied: false, reason: \`error: \${e?.message ?? e}\` };
    }
}
/**
 * Apply a champion directly by its config payload`;
export const EDITS = [
  [comment, GUARD + comment],
  [entry, entry + '\n        return __rspWithChampionAuthority(cfDir, () => {'],
  [exit, exit.replace('    }\n    catch (e)', '        });\n    }\n    catch (e)')],
];
const count = (source, value) => source.split(value).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => count(source, PATCH_MARKER) === 1
  && EDITS.every(([, replacement]) => count(source, replacement) === 1);
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || !EDITS.every(([anchor]) => count(source, anchor) === 1))
    return { next: source, applied: [], missing: ['exact-native-champion-authority-anchors'] };
  return { next: EDITS.reduce((text, [a, b]) => text.replace(a, b), source), applied: [NAME], missing: [] };
}
export const reverseSource = source => isPatched(source)
  ? EDITS.reduceRight((text, [a, b]) => text.replace(b, a), source) : source;
export const discover = () => discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'config', 'harness-feedback-applier.js']);
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
          || existingPathRelative(path.resolve(path.dirname(file), '../../..'), file) === null)
        throw new Error('unsafe native champion applier');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length)
        throw new Error('unproved champion authority anchors');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
export const applicability = () => discover().length ? { state: 'applicable' }
  : { state: 'not-applicable', reason: 'installed CLI copies have no champion applier; watched for future installs' };
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, transactionOwner: true,
  applicability, discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
