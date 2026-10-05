// Ruflo #3229 residual: canonicalize nested evidence using the native number encoder.
import fs from 'node:fs';
import path from 'node:path';
import { existingPathRelative } from '../path-containment.mjs';
import { discover as discoverCli } from '../cwd/package-discovery.mjs';
export const NAME = 'ruflo-flywheel-evidence';
export const PATCH_MARKER = 'ruflo-source-patch (ruflo#3229 evidence)';
const anchor = `        evidence: input.evidence ?? {
            corpusRoles: {
                selectionTaskIds: [],
                promotionHoldoutTaskIds: [],
                guardTaskIds: [],
            },
            verification: {},
            canary: {},
        },`;
const replacement = `        // ${PATCH_MARKER}: normalize opaque evidence before identity and signing.
${anchor.replace('input.evidence ?? {', 'encodePolicyFractions(input.evidence ?? {').replace(/        },$/, '        }),')}`;
const count = (source, value) => source.split(value).length - 1;
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => count(source, PATCH_MARKER) === 1 && count(source, replacement) === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || count(source, anchor) !== 1
      || count(source, 'export function encodePolicyFractions(value) {') !== 1
      || count(source, 'export function verifyFlywheelReceipt(receipt, trustedPublicKeys) {') !== 1)
    return { next: source, applied: [], missing: ['exact-native-evidence-encoding-anchors'] };
  return { next: source.replace(anchor, replacement), applied: [NAME], missing: [] };
}
export const reverseSource = source => isPatched(source) ? source.replace(replacement, anchor) : source;
export const discover = () => discoverCli(['@claude-flow', 'cli', 'dist', 'src', 'services', 'flywheel-receipt.js']);
export function preflight() {
  const errors = [];
  for (const file of discover()) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
          || existingPathRelative(path.resolve(path.dirname(file), '../../..'), file) === null) throw new Error('unsafe native receipt module');
      if (patchSource(fs.readFileSync(file, 'utf8')).missing.length) throw new Error('unproved receipt evidence anchors');
    } catch (error) { errors.push(`${file}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}
export const applicability = () => discover().length ? { state: 'applicable' }
  : { state: 'not-applicable', reason: 'installed CLI copies have no receipt capability; watched for future installs' };
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, transactionOwner: true, applicability,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
