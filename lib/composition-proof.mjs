import fs from 'node:fs';

// File context is opt-in; existing descriptors retain their original argument contracts.
// Atomic targets contribute nothing on a partial match.
export function contribute(d, src, file) {
  const { next, applied, missing } = d.fileContext ? d.patchSource(src, file) : d.patchSource(src);
  const out = (d.atomic && missing.length) ? src : next;
  return { out, applied, missing };
}

// Exact provenance from the actual physical-file claimants. Native replacement
// bytes and marker-preserving external edits are never inferred to be our output.
export function isKnownComposition(pristine, current, claimants, file) {
  // The current complete forward chain is already one member of the exhaustive
  // proof below. Try that exact byte equality first; historical/subset/unknown
  // compositions still take the original proof, without a cached health claim.
  let complete = pristine;
  for (const descriptor of claimants) complete = contribute(descriptor, complete, file).out;
  if (current !== pristine && complete === current) return true;
  let candidates = new Set([pristine]);
  for (const descriptor of claimants) {
    const next = new Set(candidates);
    let historical;
    try { historical = typeof descriptor.recover === 'function' ? descriptor.recover(current, file) : null; } catch {}
    for (const source of candidates) {
      // Current complete composition remains provable when overlapping sibling edits
      // make historical per-entry marker detection incomplete. Both require exact bytes.
      next.add(contribute(descriptor, source, file).out);
      if (typeof descriptor.historicalPatchSource === 'function') next.add((descriptor.fileContext
        ? descriptor.historicalPatchSource(source, current, file) : descriptor.historicalPatchSource(source, current)).next);
      // A supported prior revision is trusted only when its exact inverse is
      // already one of the known compositions and its own forward proof agrees.
      if (historical?.candidate === source && typeof historical.verify === 'function'
        && historical.verify(source) === current) next.add(current);
    }
    candidates = next;
  }
  candidates.delete(pristine);
  return candidates.has(current);
}
export function unprovedMarkedComposition(saved, current, owners, file, provenance = owners) {
  const marked = source => provenance.some(d => (d.hasPatch || d.isPatched)(source));
  return saved.length && !marked(saved) && current !== saved && marked(current)
    && !isKnownComposition(saved, current, owners, file);
}


// Fresh read-only proof, never a cached health verdict or permission to mutate.
// The caller supplies the same discovery map and descriptors as the writer.
export function observeComposition(descriptors, discoverFiles) {
  const observations = new Map();
  const stamp = file => {
    const s = fs.statSync(file, { bigint: true });
    if (!s.isFile()) throw Error('composition member is not a regular file');
    return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].map(String).join(':');
  };
  const read = file => {
    const before = stamp(file), source = fs.readFileSync(file, 'utf8');
    if (stamp(file) !== before) throw Error('composition member changed while reading');
    observations.set(file, before);
    return source;
  };
  try {
    const files = discoverFiles();
    for (const descriptor of descriptors) {
      if (![...files.values()].some(owners => owners.some(owner => owner.name === descriptor.name))
        && descriptor.applicability?.()?.state !== 'not-applicable') return false;
    }
    for (const [file, owners] of files) {
      const current = read(file), backup = file + '.rsp-backup';
      const hasBackup = fs.existsSync(backup);
      let composed = hasBackup ? read(backup) : current;
      // A missing/poisoned pristine needs the mutating owner's recovery proof.
      if (!composed.length || owners.some(d => d.hasPatch?.(composed))) return false;
      for (const descriptor of owners) {
        const result = contribute(descriptor, composed, file);
        if (result.missing.length) return false;
        composed = result.out;
      }
      if (composed !== current) return false;
      // An absent backup is also an observed fact; do not miss a concurrent install.
      if (!hasBackup) observations.set(backup, null);
    }
    // These are the descriptors' existing source/dependency checks, not prepare()
    // or retirement behavior probes. Any failure goes to the normal locked path.
    for (const descriptor of descriptors) {
      if (descriptor.preflight && descriptor.preflight()?.ok !== true) return false;
    }
    const again = discoverFiles();
    if (again.size !== files.size || [...files].some(([file, owners]) =>
      !again.has(file) || owners.length !== again.get(file).length
      || owners.some((owner, i) => owner.name !== again.get(file)[i].name))) return false;
    for (const [file, identity] of observations) {
      if (identity === null ? fs.existsSync(file) : stamp(file) !== identity) return false;
    }
    return true;
  } catch { return false; } // Unknown must use the existing exclusive writer.
}
