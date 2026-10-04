import fs from 'node:fs';
import path from 'node:path';

// Compare existing physical paths, so account-home aliases are accepted while
// symlinks outside the selected owner and missing paths fail closed. Empty means
// the owner itself; callers requiring a descendant must also reject that value.
export function existingPathRelative(root, candidate) {
  if (typeof root !== 'string' || typeof candidate !== 'string'
      || !path.isAbsolute(root) || !path.isAbsolute(candidate)) return null;
  try {
    const owner = fs.realpathSync(root);
    if (!fs.statSync(owner).isDirectory()) return null;
    const relative = path.relative(owner, fs.realpathSync(candidate));
    return relative === '..' || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative) ? null : relative;
  } catch { return null; }
}
