import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
import { ENGINE_EDITS } from './engine.mjs';
import { RUNTIME } from './runtime.mjs';
import { anchoredRuntimeEdits, anchoredEngineEdits } from './anchored-runtime.mjs';
export const NAME = 'ruflo-policy-ledger';
export const MARKER = 'ruflo-source-patch (ruflo#3164 segmented';
export const RUNTIME_EDITS = [
  ["const POLICY_DIR = join('.claude-flow', 'policy');", `// ${MARKER} runtime)
import { fsyncSync as rspFsyncSync, linkSync as rspLinkSync } from 'node:fs';
${RUNTIME}
const POLICY_DIR = join('.claude-flow', 'policy');`],
  ['export function loadPolicyState(projectRoot = process.cwd()) {',
    'export function loadPolicyState(projectRoot = process.cwd(), options = {}) {'],
  ['    verifyStateAnchor(projectRoot, parsed);\n    return parsed;',
    '    verifyStateAnchor(projectRoot, parsed);\n    rspValidateArchive(projectRoot, parsed);\n    return options.compact === true ? parsed : rspExpandLedger(projectRoot, parsed);'],
  ['AgenticPolicyEngine.fromState(loadPolicyState(projectRoot),',
    'AgenticPolicyEngine.fromState(loadPolicyState(projectRoot, { compact: true }),', 2],
  ['        for (let attempt = 0;; attempt++) {',
    `        const durableFd = openSync(temporary, 'r');
        try { rspFsyncSync(durableFd); } finally { closeSync(durableFd); }
        for (let attempt = 0;; attempt++) {`],
  ['                renamed = true;\n                return;',
    '                renamed = true;\n                rspSyncDirectory(dirname(file));\n                return;'],
  ["            throw new Error('policy-ledger-verification-failed');",
    "            throw new Error('policy-ledger-verification-failed');\n        if (engine.state.policyArchive || engine.state.policyLedgerMode === 'segmented-v1' || options.compactLedger === true) rspCompactLedger(projectRoot, engine.state);"],
  ["        if (result.anchor === 'established-now') {\n            await writePolicyState(projectRoot, target.state, engine.exportState());\n        }\n        return result;",
    `        if (result.anchor === 'established-now') {
            await writePolicyState(projectRoot, target.state, engine.exportState());
        }
        // Immutable archived segments can be audited after releasing the writer lock.
        return Promise.resolve().then(() => {
            if (result.valid) {
                try { rspVerifyFullLedger(projectRoot, engine.state, {
                    signingKey: process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY,
                    keyId: process.env.CLAUDE_FLOW_POLICY_KEY_ID,
                }); }
                catch (error) { return { valid: false, length: result.length, error: error.message }; }
            }
            return result;
        });`],
  // No age-only eviction: an old lock can still belong to a live writer.
  ['if (lockOwnerIsDead(lockPath)\n                    || Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS)',
    'if (lockOwnerIsDead(lockPath))'],
  ['            closeSync(fd);\n            return () => {\n                try {\n                    unlinkSync(lockPath);\n                }\n                catch { /* already released */ }\n            };',
    `            const owned = fstatSync(fd);
            return () => {
                try {
                    const current = lstatSync(lockPath);
                    if (current.dev === owned.dev && current.ino === owned.ino) unlinkSync(lockPath);
                }
                catch { /* already released */ }
                finally { closeSync(fd); }
            };`],
];
const editsFor = source => source.includes('export class AgenticPolicyEngine')
  ? (source.includes('verifyLedger(options = {})') ? anchoredEngineEdits(ENGINE_EDITS) : ENGINE_EDITS)
  : (source.includes("from './policy-ledger-anchor.js'") ? anchoredRuntimeEdits(RUNTIME_EDITS) : RUNTIME_EDITS);
// Exact 4.46.41-hz.1 revision: adopt the durable enablement flag without
// rebaselining its already patched bytes as vendor source.
const priorRuntime = RUNTIME
  .replace("        state.policyLedgerMode = 'segmented-v1';\n", '')
  .replace('        const { policyArchive, policyLedgerMode, ...expanded } = state;\n        if (!state.policyArchive) return expanded;',
    '        if (!state.policyArchive) return state;')
  .replace('        return { ...expanded, receipts };',
    '        const { policyArchive, ...expanded } = state;\n        return { ...expanded, receipts };');
const priorEditsFor = source => editsFor(source).map(([a, b, n]) => [a,
  b.replace(RUNTIME, priorRuntime)
    .replace('        if (state.policyLedgerMode === "segmented-v1") engine.state.policyLedgerMode = state.policyLedgerMode;\n', '')
    .replace(" || engine.state.policyLedgerMode === 'segmented-v1'", ''), n]);
const count = (s, anchor) => s.split(anchor).length - 1;
const matches = (s, edits, side) => edits.every(pair => count(s, pair[side]) === (pair[2] ?? 1));
export const hasPatch = s => s.includes(MARKER);
export const isPatched = s => hasPatch(s) && matches(s, editsFor(s), 1);
export function recover(source) {
  const edits = priorEditsFor(source);
  if (!hasPatch(source) || isPatched(source) || !matches(source, edits, 1)) return null;
  return { candidate: edits.reduceRight((s, [a, b]) => s.split(b).join(a), source),
    verify: native => edits.reduce((s, [a, b]) => s.split(a).join(b), native) };
}
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const prior = recover(source);
  if (prior) return patchSource(prior.candidate);
  const edits = editsFor(source);
  if (hasPatch(source) || !matches(source, edits, 0))
    return { next: source, applied: [], missing: ['exact-policy-ledger-anchors'] };
  return { next: edits.reduce((s, [a, b]) => s.split(a).join(b), source), applied: [NAME], missing: [] };
}
export const reverseSource = source => isPatched(source)
  ? editsFor(source).reduceRight((s, [a, b]) => s.split(b).join(a), source) : source;
export function discover() {
  const runtimes = discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'services', 'policy-runtime.js']).filter(file => {
    // Older caches lack the native persistent receipt anchor. This target cannot
    // migrate their data safely; their existing patches remain separately owned.
    const manifest = path.resolve(path.dirname(file), '../../../package.json');
    if (!fs.existsSync(manifest)) return false;
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch { return false; }
    const parts = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(pkg.version);
    if (!parts || pkg.name !== '@claude-flow/cli') return false;
    return +parts[1] > 3 || (+parts[1] === 3 && (+parts[2] > 54 || (+parts[2] === 54 && +parts[3] >= 1)));
  });
  const engines = runtimes.flatMap(file => {
    try {
      const entry = createRequire(file).resolve('@claude-flow/security');
      const engine = path.join(path.dirname(entry), 'policy', 'engine.js');
      return fs.existsSync(engine) ? [engine] : [];
    } catch { return []; }
  });
  return [...new Set([...runtimes, ...engines])];
}
export function preflight() {
  const errors = [];
  try {
    for (const file of discover()) {
      try {
        if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('unsafe source');
        if (path.basename(file) === 'policy-runtime.js') {
          const entry = createRequire(file).resolve('@claude-flow/security');
          if (!fs.existsSync(path.join(path.dirname(entry), 'policy', 'engine.js')))
            throw new Error('native policy engine missing');
        }
        if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw new Error('unproved ledger anchors');
      } catch (error) { errors.push(`${file}: ${error.message}`); }
    }
  } catch (error) { errors.push(error.message); }
  return { ok: !errors.length, errors };
}
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, transactionOwner: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource, recover };
