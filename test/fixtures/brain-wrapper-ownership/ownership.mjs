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
  try {
    if (fs.readFileSync(wrapperPath).equals(fs.readFileSync(source))) return { state: 'verified' };
  } catch { /* Missing proof is not ownership. */ }
  return { state: 'conflict', reason: 'existing bridge differs from the shipped Brain source' };
}
