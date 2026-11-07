// Brain #525: one consumer for native Codex hook stdin; no policy or updater changes.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HOME_BASE } from '../cwd/paths.mjs';
import { discover as discoverBrain, fullSurface } from '../brain-managed-memory-boundary/discovery.mjs';
import { existingPathRelative } from '../path-containment.mjs';

export const NAME = 'brain-codex-input';
export const MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#525)';
const relative = 'scripts/codex-hook-wrapper.mjs';
const anchor = "    process.stdin.on('data', onData);";
const replacement = `    // ${MARKER}: read() already emits data; consume each chunk only in onReadable.`;
const nativeReaderHash = '24e1535f32a74b3735e5bd0f1db95d7751aff3c6b497a68d5e30007ba0382431';
const sha = value => createHash('sha256').update(value).digest('hex');
export function readerSource(source) {
  const start = source.indexOf('function readHookInput(');
  const end = source.indexOf('\nconst input = await readHookInput();', start);
  if (start < 0 || end < 0 || source.indexOf('function readHookInput(', start + 1) >= 0)
    throw Error('ambiguous native stdin reader');
  return source.slice(start, end);
}
const knownReader = source => {
  try { return sha(readerSource(source)) === nativeReaderHash; } catch { return false; }
};
export const hasPatch = source => source.includes(MARKER);
export const reverseSource = source => source.replace(replacement, anchor);
export const isPatched = source => source.split(replacement).length === 2
  && !source.includes(anchor) && knownReader(reverseSource(source));
export function patchSource(source) {
  if (isPatched(source)) return { next: source, applied: [], missing: [] };
  if (hasPatch(source) || source.split(anchor).length !== 2 || !knownReader(source))
    return { next: source, applied: [], missing: ['qualified native single-consumer stdin boundary'] };
  return { next: source.replace(anchor, replacement), applied: [NAME], missing: [] };
}

function regular(file, base) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
      || (process.getuid && stat.uid !== process.getuid())
      || existingPathRelative(base, file) === null) throw Error('unsafe wrapper source: ' + file);
  return fs.readFileSync(file, 'utf8');
}
export function discover() {
  const home = path.resolve(process.env.RSP_RUVNET_BRAIN_HOME || path.join(HOME_BASE, '.cache/ruvnet-brain'));
  const surfaces = discoverBrain({ includeOwned: true, allowMissingActive: true,
    ownedMarkers: [MARKER], ownedRelatives: [relative], requiredRelatives: [] });
  if (!surfaces.length) return [];
  // The wrapper is optional on older/Claude-only surfaces. Its absence must not
  // prevent unrelated targets from discovering their own files in that generation.
  const files = surfaces.filter(s => s.kind === 'full').map(s => path.join(s.root, relative))
    .filter(file => fs.existsSync(file));
  const stable = path.join(home, 'codex-hook.mjs');
  if (!fs.existsSync(stable)) return files;
  const stableSource = reverseSource(regular(stable, home));
  // Native ownership recognizes an exact retained generation. Preserve the owner of the
  // running stable copy even when it still differs from the active generation's wrapper.
  const versions = path.join(home, 'versions');
  for (const entry of fs.readdirSync(versions, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const root = path.join(versions, entry.name);
    const surface = fullSurface(root, null, 'live wrapper owner', [relative]);
    if (!surface) continue;
    const file = path.join(root, relative);
    if (reverseSource(regular(file, versions)) === stableSource) files.push(file);
  }
  return [...new Set([...files, stable])];
}
export function preflight(files = discover()) {
  const errors = [];
  try {
    for (const file of files) {
      const source = regular(file, path.dirname(file));
      if (patchSource(source).missing.length) throw Error('unqualified wrapper: ' + file);
    }
    const stable = files.find(file => path.basename(file) === 'codex-hook.mjs');
    if (stable) {
      const versions = path.join(path.dirname(stable), 'versions') + path.sep;
      const source = reverseSource(fs.readFileSync(stable, 'utf8'));
      if (!files.some(file => file.startsWith(versions)
          && reverseSource(fs.readFileSync(file, 'utf8')) === source))
        throw Error('stable wrapper has no exact retained-generation owner; native update ownership must be preserved');
    }
  } catch (error) { errors.push(error.message); }
  return { ok: errors.length === 0, errors };
}
// Retire after native split-payload, bounded/open-pipe and ownership proofs plus live
// full-document search -> stamp -> original write-admission verification (issue #525).
export const descriptor = { name: NAME, atomic: true, missingIsIncomplete: true,
  discover, preflight, patchSource, hasPatch, isPatched, reverse: reverseSource };
