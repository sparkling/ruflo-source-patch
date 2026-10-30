// Brain #335: a scratch name is not proof that its memory or other data is disposable.
import fs from 'node:fs';
import path from 'node:path';
import { discover as discoverBrain } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';

export const NAME = 'brain-scratch-preservation';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#335 scratch-preservation)';
const DISPOSITION = `
// ${PATCH_MARKER}: retain all content; only the kernel may prove an empty directory removable.
export function rufloScratchDisposition(dir, { apply = false } = {}) {
  const keep = (reason) => ({ removable: false, removed: false, reason: 'KEPT: ' + reason });
  try {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) return keep('scratch path is not absolute');
    const resolved = path.resolve(dir);
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(resolved) !== resolved) {
      return keep('scratch is a file, link, or has an aliased ancestor; no disposal proof');
    }
    if (fs.readdirSync(resolved).length) return keep('scratch contains unclassified memory or other data');
    if (apply) fs.rmdirSync(resolved); // Atomic empty-directory removal; never recurse or unlink files.
    return { removable: true, removed: apply, reason: apply ? 'removed empty scratch directory' : 'empty scratch directory' };
  } catch (error) {
    return keep('scratch was not removed (' + String(error?.code || 'unverified') + ')');
  }
}
`;

export const SPECS = [
  { relative: 'scripts/ruflo-bin.mjs', edits: [
    ['shared-empty-directory-owner', 'const STALE_RUN_MS = 3_600_000;', 'const STALE_RUN_MS = 3_600_000;\n' + DISPOSITION],
    ['preserve-before-call',
      '    if (RUFLO_CWD_ARTIFACTS.includes(name) || stale) fs.rmSync(entry, { recursive: true, force: true });',
      '    if (RUFLO_CWD_ARTIFACTS.includes(name) || stale) rufloScratchDisposition(entry, { apply: true });'],
  ] },
  { relative: 'scripts/ruflo-memory-hooks.mjs', edits: [
    ['share-post-call-owner',
      "import { resolveRuflo, rufloInvocationOrPlain, rufloRunDir, rufloScratchRoot } from './ruflo-bin.mjs';",
      `// ${PATCH_MARKER}: cleanup cannot discard a call's memory or unknown output.\nimport { resolveRuflo, rufloInvocationOrPlain, rufloRunDir, rufloScratchRoot, rufloScratchDisposition } from './ruflo-bin.mjs';`],
    ['preserve-after-call',
      "  return { cwd, env: { ...env, RUFLO_DAEMON_AUTOSTART: '0', CLAUDE_FLOW_AUTO_UPDATE: 'false' }, cleanup: () => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* swept later as a stale run- dir */ } } };",
      "  return { cwd, env: { ...env, RUFLO_DAEMON_AUTOSTART: '0', CLAUDE_FLOW_AUTO_UPDATE: 'false' }, cleanup: () => rufloScratchDisposition(cwd, { apply: true }) };"],
  ] },
  { relative: 'scripts/brain-footprint.mjs', edits: [
    ['share-footprint-owner',
      "import { RUFLO_CWD_ARTIFACTS } from './ruflo-bin.mjs';",
      `// ${PATCH_MARKER}: footprint accounting must preserve unclassified scratch contents.\nimport { RUFLO_CWD_ARTIFACTS, rufloScratchDisposition } from './ruflo-bin.mjs';`],
    ['classify-retained-scratch',
      `          if (!es || es.isSymbolicLink()) continue;
          const debris = RUFLO_DEBRIS.has(entry) || (entry.startsWith('run-') && es.isDirectory() && now - es.mtimeMs > policy.staleRufloRunMs);
          if (debris) add({ id: 'ruflo-scratch', path: ep, class: 'must-not-exist', kind: 'ruflo-scratch', action: 'remove', bytes: bytes(ep), reason: 'ruflo working-directory debris (never read back)' });`,
      `          if (!es) continue;
          const debris = RUFLO_DEBRIS.has(entry) || (entry.startsWith('run-') && es.isDirectory() && now - es.mtimeMs > policy.staleRufloRunMs);
          const disposition = debris ? rufloScratchDisposition(ep)
            : { removable: false, reason: 'KEPT: unclassified or current Ruflo scratch' };
          add({ id: 'ruflo-scratch', path: ep, class: disposition.removable ? 'must-not-exist' : 'may-exist',
            kind: 'ruflo-scratch', action: disposition.removable ? 'remove-empty' : 'report', bytes: bytes(ep), reason: disposition.reason });`],
    ['sweep-empty-scratch-only',
      "    if (!['remove', 'remove-if-proven', 'rotate', 'truncate'].includes(item.action) && !reArchive(item)) {",
      `    if (item.kind === 'ruflo-scratch') {
      if (item.action === 'remove-empty') {
        try {
          if (apply) beforeRemove?.(item);
          const disposition = rufloScratchDisposition(item.path, { apply });
          if (disposition.removable) record(item, 0, disposition.reason);
          else kept.push({ path: item.path, kind: item.kind, reason: disposition.reason });
        } catch { kept.push({ path: item.path, kind: item.kind, reason: 'KEPT: scratch cleanup could not be verified' }); }
      } else kept.push({ path: item.path, kind: item.kind, reason: item.reason });
      continue;
    }
    if (!['remove', 'remove-if-proven', 'rotate', 'truncate'].includes(item.action) && !reArchive(item)) {`],
  ] },
];

const count = (source, text) => source.split(text).length - 1;
const matches = (source, spec, patched) => spec.edits.every(([, from, next]) => count(source, patched ? next : from) === 1);
export const hasPatch = source => source.includes(PATCH_MARKER);
export const isPatched = source => count(source, PATCH_MARKER) === 1 && SPECS.filter(spec => matches(source, spec, true)).length === 1;
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  const specs = SPECS.filter(spec => matches(source, spec, false));
  if (hasPatch(source) || specs.length !== 1) return { next: source, applied: [], missing: ['unique-scratch-preservation-boundary'] };
  return { next: specs[0].edits.reduce((body, [, from, next]) => body.replace(from, () => next), source),
    applied: specs[0].edits.map(([id]) => id), missing: [] };
}
export const reverseSource = source => !isPatched(source) ? source
  : SPECS.flatMap(spec => spec.edits).reduceRight((body, [, from, next]) => body.replace(next, () => from), source);
export const surfaces = () => discoverBrain({ includeOwned: true, allowMissingActive: true,
  ownedMarkers: [PATCH_MARKER], ownedRelatives: SPECS.map(spec => spec.relative) }).filter(surface => surface.kind === 'full');
export const discover = () => surfaces().flatMap(surface => SPECS.map(spec => path.join(surface.root, spec.relative)));
export function preflight() {
  const errors = [];
  for (const surface of surfaces()) for (const spec of SPECS) {
    const file = path.join(surface.root, spec.relative);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || existingPathRelative(surface.root, file) !== spec.relative) throw Error('unsafe scratch preservation member');
      const source = fs.readFileSync(file, 'utf8');
      if (!matches(source, spec, hasPatch(source)) || patchSource(source).missing.length) throw Error('scratch preservation anchors do not match');
    } catch (error) { errors.push(file + ': ' + error.message); }
  }
  return { ok: errors.length === 0, errors };
}
// Retirement requires native pre-call, post-call and footprint preservation, including races and unknown content.
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true, transactionOwner: true,
  discover, patchSource, hasPatch, isPatched, reverse: reverseSource, preflight };
