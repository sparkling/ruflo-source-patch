// Ruflo #3164: serialize the complete verified ledger once; retain its native owner.
import fs from 'node:fs';
import path from 'node:path';
import { existingPathRelative } from '../path-containment.mjs';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
export const NAME = 'ruflo-policy-serialization';
export const PATCH_MARKER = 'ruflo-source-patch (ruflo#3164 serialization)';
export const EDITS = [
  ['async function writeJsonAtomic(file, value) {', 'async function writeJsonAtomic(file, value, serialized) {', 1],
  ['writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\\n`, { mode: 0o600 });',
    'writeFileSync(temporary, `${serialized ?? JSON.stringify(value, null, 2)}\\n`, { mode: 0o600 });', 1],
  ['function stateAuthentication(state, key) {', 'function stateAuthentication(state, key, serialized) {', 1],
  ["return createHmac('sha256', key).update(JSON.stringify(state)).digest('hex');",
    "return createHmac('sha256', key).update(serialized ?? JSON.stringify(state)).digest('hex');", 1],
  ['async function writePolicyState(projectRoot, statePath, state) {',
    'async function writePolicyState(projectRoot, statePath, state, serialized) {', 1],
  ['await writePolicyStateFiles(projectRoot, statePath, state);',
    'await writePolicyStateFiles(projectRoot, statePath, state, serialized);', 1],
  ['async function writePolicyStateFiles(projectRoot, statePath, state) {',
    'async function writePolicyStateFiles(projectRoot, statePath, state, serialized) {', 1],
  ['authentication: stateAuthentication(state, key),',
    'authentication: stateAuthentication(state, key, serialized),', 1],
  ['await writeJsonAtomic(statePath, state);', 'await writeJsonAtomic(statePath, state, serialized);', 3],
  ['        const nextState = engine.exportState();\n        await writePolicyState(projectRoot, target.state, nextState);',
    `        // ${PATCH_MARKER}: no ledger clone or repeated formatting after verification.
        // Both snapshots are independent before the first asynchronous writer yield.
        const serialized = JSON.stringify(engine.state);
        const projectionState = structuredClone({ mode: engine.state.mode, rules: engine.state.rules });
        await writePolicyState(projectRoot, target.state, projectionState, serialized);`, 1],
];
// Genuine pre-projection async and synchronous writer shapes (3.45.0 / 3.38.x).
const verification = "        if (!engine.verifyLedger().valid)\n            throw new Error('policy-ledger-verification-failed');";
const immutable = `        // ${PATCH_MARKER}: serialize only after full ledger verification.
        const serialized = JSON.stringify(engine.state);
        const projectionState = structuredClone({ mode: engine.state.mode, rules: engine.state.rules });`;
export const ASYNC_LEGACY_EDITS = [
  ...EDITS.slice(0, 5), EDITS[7], EDITS[8],
  [`        const nextState = engine.exportState();\n${verification}\n        await writePolicyState(projectRoot, target.state, nextState);`,
    `${verification}\n${immutable}\n        await writePolicyState(projectRoot, target.state, projectionState, serialized);`, 1],
];
export const SYNC_LEGACY_EDITS = ASYNC_LEGACY_EDITS.map(([anchor, replacement, expected]) =>
  [anchor.replaceAll('async function', 'function').replaceAll('await write', 'write'),
    replacement.replaceAll('async function', 'function').replaceAll('await write', 'write'), expected]);
const variants = [EDITS, ASYNC_LEGACY_EDITS, SYNC_LEGACY_EDITS];
const count = (source, anchor) => source.split(anchor).length - 1;
const matches = (source, index) => variants.filter(edits => edits.every(pair => count(source, pair[index]) === pair[2]));
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => count(source, PATCH_MARKER) === 1 && matches(source, 1).length === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const selected = matches(source, 0);
  if (hasPatch(source) || selected.length !== 1)
    return { next: source, applied: [], missing: ['exact-native-policy-serialization-anchors'] };
  return { next: selected[0].reduce((text, [anchor, replacement]) => text.split(anchor).join(replacement), source),
    applied: [NAME], missing: [] };
}
export const reverseSource = source => isPatched(source)
  ? matches(source, 1)[0].reduceRight((text, [anchor, replacement]) => text.split(replacement).join(anchor), source) : source;
export const discover = () => discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'services', 'policy-runtime.js']);
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
          || existingPathRelative(path.resolve(path.dirname(file), '../../..'), file) === null) throw new Error('unsafe native policy runtime');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw new Error('unproved policy serialization anchors');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
export const applicability = () => discover().length ? { state: 'applicable' }
  : { state: 'not-applicable', reason: 'installed CLI copies have no native policy runtime capability; watched for future installs' };
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, transactionOwner: true, applicability,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
