function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer`);
}

function omissionSummary(value) {
  return {
    count: Array.isArray(value) ? value.length : 1,
    sha256: digestCanonical(value),
  };
}

/**
 * Deterministically reduce a verified resume payload to fit the host context without pretending
 * omitted evidence is empty. The canonical snapshots remain in AgentDB; the projection retains the
 * merged goal/action values, head keys and per-omission digests so the omitted values stay addressable.
 * Returns null when the required resume identity and goal/action alone cannot fit.
 */
export function projectResumePayloadToBound(payload, maxOutputBytes) {
  requirePositiveInteger(maxOutputBytes, 'maxOutputBytes');
  const summary = structuredClone(payload);
  const omissions = [];
  summary.projection = { mode: 'bounded-summary', omitted: omissions };
  const recordOmission = (target, key, pathName) => {
    const value = target[key];
    if (value === undefined) return;
    const digest = omissionSummary(value);
    omissions.push({ path: pathName, ...digest });
    target[key] = { omitted: true, ...digest };
  };
  const size = () => Buffer.byteLength(JSON.stringify(summary), 'utf8');

  // Conflicts are important facts, but their full competing values can dominate the resume context.
  // Keep each conflicting field, its count, and a digest of the exact competing values; top-level
  // head keys remain, and canonical snapshots retain the source values. No winner is chosen.
  if (size() > maxOutputBytes && Array.isArray(summary.state?.resumeConflicts)) {
    const originals = summary.state.resumeConflicts;
    summary.state.resumeConflicts = originals.map((conflict) => ({
      field: conflict.field,
      valueCount: (conflict.values ?? []).length,
      valuesDigest: digestCanonical(conflict.values ?? []),
    }));
    omissions.push({
      path: 'state.resumeConflicts[].values',
      ...omissionSummary(originals.flatMap((conflict) => conflict.values ?? []).map((row) => row.value)),
    });
  }

  if (size() > maxOutputBytes && Array.isArray(summary.state?.resumeConflicts)) {
    const groups = new Map();
    for (const conflict of payload.state.resumeConflicts) {
      if (!groups.has(conflict.field)) groups.set(conflict.field, []);
      groups.get(conflict.field).push(conflict);
    }
    if (groups.size < payload.state.resumeConflicts.length) {
      summary.state.resumeConflicts = [...groups].map(([field, conflicts]) => ({
        field, conflictCount: conflicts.length,
        valueCount: conflicts.reduce((count, conflict) => count + (conflict.values ?? []).length, 0),
        conflictsDigest: digestCanonical(conflicts),
      }));
      omissions.push({ path: 'state.resumeConflicts', ...omissionSummary(payload.state.resumeConflicts) });
    }
  }

  if (size() > maxOutputBytes) recordOmission(summary.state, 'journalHeads', 'state.journalHeads');
  // Least central detail first. currentGoal and nextAction are deliberately absent from this list.
  const stateFields = [
    'observations', 'commands', 'proofArtifacts', 'changedFiles', 'completed', 'untested', 'decisions',
    'plan', 'inProgress', 'blockers', 'failures', 'acceptanceContract', 'provenance',
    'evidence', 'activeStep', 'activeProcess', 'sourceIdentity',
  ];
  for (const field of stateFields) {
    if (size() <= maxOutputBytes) break;
    recordOmission(summary.state, field, `state.${field}`);
  }
  if (size() > maxOutputBytes && summary.evidence) {
    recordOmission(summary, 'evidence', 'evidence');
  }

  // Never clip or replace the user goal or next action. If those plus the identity/omission ledger
  // do not fit, refuse to call this a restore and let SessionStart emit explicit UNKNOWN.
  if (size() > maxOutputBytes) return null;
  return { payload: summary, rendered: JSON.stringify(summary), projected: true };
}

function validatePage() {}
