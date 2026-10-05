// Exact public v4.5.9/10 executable bytes; never infer behavior from a version.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existingPathRelative } from '../path-containment.mjs';

export const NATIVE_GUARD_HASH = '2e4498e0643f1e7d6ee2833ccb8150f57080ef701471616848c3da15365a77a7';
export const NATIVE_HELPER_HASH = 'dd0fcd3a2fcf544ffc79fa9f0859dc39fdd33f8c28e83dc7a1a906480fcf5ae8';
export const NATIVE_HELPER_ALIAS_HASH = '5f97aeb864027a2522a817cc16c5bde52bdd52e0166860095668fab91770d663';
export const NATIVE_HELPER_HASHES = [NATIVE_HELPER_HASH, NATIVE_HELPER_ALIAS_HASH];
export const HELPER_NAME = 'grounding-code-projection.mjs';
const digest = source => createHash('sha256').update(source).digest('hex');
export const nativeSatisfied = source => digest(source) === NATIVE_GUARD_HASH;

export function readNativeGroundingBundle(file) {
  if (!path.isAbsolute(file)) throw Error('native guard path must be absolute');
  const root = path.dirname(path.dirname(file));
  const read = candidate => {
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size
      || existingPathRelative(root, candidate) === null) throw Error('unsafe native grounding source');
    return fs.readFileSync(candidate, 'utf8');
  };
  const guard = read(file), helper = read(path.join(path.dirname(file), HELPER_NAME));
  if (!nativeSatisfied(guard) || !NATIVE_HELPER_HASHES.includes(digest(helper)))
    throw Error('native grounding guard/helper bytes are not reviewed');
  return { guard, helper };
}
