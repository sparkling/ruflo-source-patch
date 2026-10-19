function legacyBrainWrapperOwnership(wrapperPath, home) {
  const source = path.join(REPO_ROOT, 'plugin', 'scripts', 'codex-hook-wrapper.mjs');
  try {
    const canonicalHome = fs.realpathSync(home);
    if (path.resolve(wrapperPath) !== path.resolve(home, '.cache', 'ruvnet-brain', 'codex-hook.mjs')) {
      return { state: 'conflict', reason: 'bridge is outside the expected Brain namespace' };
    }
    for (const relative of ['.cache', path.join('.cache', 'ruvnet-brain')]) {
      const ancestor = path.join(home, relative);
      let parent;
      try { parent = fs.lstatSync(ancestor); } catch (error) {
        if (error.code === 'ENOENT') break;
        throw error;
      }
      if (!parent.isDirectory() || parent.isSymbolicLink()
        || fs.realpathSync(ancestor) !== path.join(canonicalHome, relative)
        || (typeof process.getuid === 'function' && parent.uid !== process.getuid())) {
        return { state: 'conflict', reason: 'bridge namespace is indirect or belongs to another owner' };
      }
    }
  } catch { return { state: 'conflict', reason: 'bridge namespace could not be verified' }; }
  let stat;
  try { stat = fs.lstatSync(wrapperPath); } catch (error) {
    if (error.code === 'ENOENT') return { state: 'absent' };
    return { state: 'conflict', reason: 'existing bridge could not be inspected' };
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    return { state: 'conflict', reason: 'existing bridge is not an unshared regular file' };
  }
  let installed;
  try {
    installed = fs.readFileSync(wrapperPath);
    if (installed.equals(fs.readFileSync(source))) return { state: 'verified' };
  } catch { /* Missing proof is not ownership. */ }
  // An UPGRADE: the bridge is still byte-identical to a wrapper an earlier Brain generation shipped.
  // Comparing only against the NEW source made every release that changed the wrapper bytes refuse
  // its own previous install (4.6.4 -> 4.7.0, hook-wrapper-ownership-conflict). The proof is a
  // generation the Stable Spine keeps under the already-verified namespace: versions/<v>/ (the
  // active one named by active.json, its previous, and any retained one). Every directory on that
  // path must be a real, owner-uid directory and the candidate a regular file; nothing is followed.
  if (installed && shippedByRetainedGeneration(installed, path.join(home, '.cache', 'ruvnet-brain', 'versions'))) {
    return { state: 'prior-generation' };
  }
  // A PRUNED generation's bridge (owner's machine, 2026-10-17): the bytes an EARLIER shipped release wrote,
  // whose versions/<v>/ copy is gone (pruned, or written by a release that predates the Spine). The proof
  // is the committed history of every wrapper each release tag carried, derived from git by
  // scripts/codex-hook-wrapper-history.mjs and checked against git in the unit suite. Bytes only: the
  // path, link, inode and uid checks above have already passed by the time this is consulted.
  const past = installed && shippedByPastRelease(installed);
  if (past) return { state: 'prior-release', release: past.tags[past.tags.length - 1] };
  return { state: 'conflict', reason: 'existing bridge differs from the shipped Brain source' };
}

// Test seam only: RUVNET_WRAPPER_HISTORY_FILE points the proof at another history file, so the unit suite
// can hand the installer a malformed or hostile history without touching the committed data file.
const WRAPPER_HISTORY_FILE = path.join(REPO_ROOT, 'data', 'codex-hook-wrapper-history.json');
function shippedByPastRelease(bytes, historyFile = process.env.RUVNET_WRAPPER_HISTORY_FILE || WRAPPER_HISTORY_FILE) {
  let history;
  try { history = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch { return null; }
  if (history?.schemaVersion !== 1 || history.kind !== 'ruvnet-brain-codex-hook-wrapper-history' || !Array.isArray(history.wrappers)) return null;
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const hit = history.wrappers.find((row) => row?.sha256 === sha256 && row.bytes === bytes.length
    && Array.isArray(row.tags) && row.tags.length > 0 && row.tags.every((tag) => /^v\d+\.\d+\.\d+$/.test(tag)));
  return hit || null;
}

function shippedByRetainedGeneration(bytes, versionsDir) {
  const ownedDir = (dir) => {
    try {
      const st = fs.lstatSync(dir);
      return st.isDirectory() && !st.isSymbolicLink()
        && (typeof process.getuid !== 'function' || st.uid === process.getuid());
    } catch { return false; }
  };
  if (!ownedDir(versionsDir)) return false;
  let names;
  try { names = fs.readdirSync(versionsDir); } catch { return false; }
  return names.some((name) => {
    // Staging remnants and hidden temporaries were never activated, so they prove nothing.
    if (name.startsWith('.') || name.includes('.staging-')) return false;
    const generation = path.join(versionsDir, name);
    const scripts = path.join(generation, 'scripts');
    const candidate = path.join(scripts, 'codex-hook-wrapper.mjs');
    if (!ownedDir(generation) || !ownedDir(scripts)) return false;
    try {
      const st = fs.lstatSync(candidate);
      if (!st.isFile() || st.isSymbolicLink() || st.size !== bytes.length) return false;
      return fs.readFileSync(candidate).equals(bytes);
    } catch { return false; }
  });
}
