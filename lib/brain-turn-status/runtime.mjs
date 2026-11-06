// Only native diagnostic receipts are read. No store, replay, lease or failure-ledger mutation.
export function turnRecordingStatus({ projectDir = process.cwd(), env = process.env, home = os.homedir(), now = Date.now(), noticeOnFirstUse = false } = {}) {
  const brainHome = env.RUVNET_BRAIN_HOME || path.join(home, '.cache', 'ruvnet-brain');
  let target;
  try { target = resolveTurnDb({ projectDir, brainHome }); } catch { return { state: 'unknown', line: 'turn recording unavailable: canonical store resolution failed' }; }
  if (String(env.RUVNET_TURN_CAPTURE || '').toLowerCase() === 'off' || target.skipped) return { state: 'unknown', line: `turn recording n/a — ${target.skipped || 'RUVNET_TURN_CAPTURE=off'}` };
  if (storeEncryptedAtRest(target.db)) return { state: 'warn', line: `turn recording off for this store — ${ENCRYPTED_STORE_REASON}. Keep this project's store unencrypted, or set RUVNET_TURN_CAPTURE=off to stop trying` };
  const notice = noticeOnFirstUse ? firstTurnCaptureNotice({ target, brainHome, policyFile: turnCapturePolicyFile(brainHome), env }) : null;
  const status = value => ({ ...value, scope: 'canonical-project', receiptCoverage: 'bounded-current-and-rotated-tails', ...(notice ? { notice } : {}) });
  const receipts = path.join(brainHome, 'turn-capture', 'receipts.jsonl');
  const coverageErrors = [];
  const readRows = (file, bytes) => {
    try { return readTail(file, bytes).flatMap(line => {
      if (!line.trim()) return [];
      try {
        const row = JSON.parse(line);
        if (!row || typeof row !== 'object' || Array.isArray(row) || !Number.isFinite(Date.parse(row.at))) throw Error('invalid receipt');
        return [row];
      } catch { coverageErrors.push(`${path.basename(file)}: malformed receipt`); return []; }
    }); } catch (error) {
      if (error.code !== 'ENOENT') coverageErrors.push(`${path.basename(file)}: unreadable receipt evidence`);
      return [];
    }
  };
  const ordered = [receipts + '.1', receipts].flatMap(file => readRows(file, 128 * 1024))
    .filter(r => r.kind === 'store' && (r.storeIdentity === digest(target.db) || r.db === target.db) && now - Date.parse(r.at) < 7 * 86_400_000)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const latest = [...new Map(ordered.map(row => [row.key || row.at, row])).values()]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const rows = latest.slice(-20);
  const verified = r => r.status === 0 && r.verified === true;
  const pending = rows.filter(r => r.pending === true && typeof turnAttemptPending === 'function' && turnAttemptPending(r));
  const failed = rows.filter(r => (r.status !== 0 || r.verified === false) && !pending.includes(r));
  const historical = rows.filter(r => r.status === 0 && r.verified === undefined);
  const id = digest(target.db).slice(0, 16);
  const failures = readRows(path.join(brainHome, 'hook-failures.jsonl'), 64 * 1024)
    .filter(r => r.hook === 'turn-capture' && (!r.store || r.store === id))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const unresolved = failures.filter(failure => failure.store !== id || !failure.expectedKey || !latest.some(row => verified(row)
    && typeof row.key === 'string' && digest(row.key).slice(0, 16) === failure.expectedKey && Date.parse(row.at) >= Date.parse(failure.at)));
  const lastFailure = unresolved.at(-1);
  const history = lastFailure ? `${lastFailure.store ? 'Project historical recording failure' : 'Unscoped historical recording failure (project applicability unknown)'}: ${redactText(String(lastFailure.error || 'capture skipped')).slice(0, 200)} (at ${lastFailure.at}; session ${lastFailure.session || 'unattributed'}; expected key ${lastFailure.expectedKey || 'unknown'}). Current-session attribution is not established; bounded receipts do not prove recovery of that key.` : '';
  const parts = [];
  if (coverageErrors.length) parts.push(`Turn recording evidence coverage incomplete — ${[...new Set(coverageErrors)].join('; ')}; persistence is not proven by unreadable or malformed receipts`);
  if (failed.length) parts.push(`Project turn recording failed or unconfirmed ${failed.length}/${rows.length} — ${redactText(failed.at(-1).error || 'write has no exact readback evidence').slice(0, 300)} (key ${failed.at(-1).key || 'unknown'}); dead, expired or unavailable ownership is not proof of persistence`);
  if (pending.length) parts.push(`Project turn recording pending exact readback (${pending.length}/${rows.length} active attempts); persistence is not yet proven`);
  if (history) parts.push(history);
  // Keep native SessionStart's warn emission contract: pending is visible, but never called failure.
  if (parts.length) return status({ state: 'warn', line: parts.join(' '), pendingKeys: pending.map(r => r.key), historicalFailure: lastFailure || null });
  if (historical.length) return status({ state: 'unknown', line: `Project turn recording unverified historical (${historical.length} receipts without exact readback evidence)` });
  const newest = rows.at(-1);
  if (newest && now - Date.parse(newest.at) >= TURN_STATUS_FRESH_MS) return status({ state: 'unknown', line: `Project turn recording not proven recently — newest exact readback ${newest.at}` });
  return status(rows.length ? { state: 'ok', line: `Project turn recording ✓ (${rows.length}/${rows.length} exact readbacks; bounded receipt coverage)` }
    : { state: 'unknown', line: 'Project turn recording not yet proven — no exact readback receipt in bounded coverage' });
}
