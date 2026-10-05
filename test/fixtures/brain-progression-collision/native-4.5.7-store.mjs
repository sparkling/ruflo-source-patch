import {createProgressionSnapshot,digestCanonical,validateProgressionSnapshot} from './project-progression-contract.mjs';
function plainRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function sortRejected(rows) {
  return rows.sort((left, right) => String(left.eventKey).localeCompare(String(right.eventKey))
    || left.reasons.join('|').localeCompare(right.reasons.join('|')));
}
export class ProjectProgressionStore {
  appendExact(snapshot, { onPhase = () => {} } = {}) {
    this.validateSnapshot(snapshot);
    this.requireCaptureConsent(snapshot);
    const stored = this.run([
      'memory', 'store', '--key', snapshot.eventKey, '--value', JSON.stringify(snapshot),
      '--namespace', PROGRESSION_NAMESPACE, '--no-upsert', '--provenance', 'system_observation',
      '--path', this.resolution.canonicalAgentDbPath,
    ]);
    const alreadyStored = resultStatus(stored) !== 0;
    if (!alreadyStored) onPhase('stored');

    // THE READ-BACK, through the fast path when it is available.
    //
    // This is not a shortcut past the verification — it IS the verification, taken by an independent
    // route. Reading the row back with the same CLI process family that just wrote it proves the CLI
    // agrees with itself; reading the bytes off disk with node:sqlite proves the row is really there.
    // It also matters for the budget: a capture boundary gets 8s, and a cold `ruflo memory` call
    // measured ~3s in an isolated HOME (matching the 3.0-3.4s figure from the original report), so
    // replay + capture at two CLI calls each did not fit and left the new snapshot uncommitted in the
    // outbox. One CLI write plus a ~1ms read fits with room to spare. The CLI remains the fallback.
    let readbackText = null;
    const fast = this.readFast((reader) => reader.readContent(PROGRESSION_NAMESPACE, snapshot.eventKey));
    if (fast.ok && typeof fast.value === 'string') {
      this.lastReadPath = 'node:sqlite';
      readbackText = fast.value;
    } else {
      this.lastReadPath = `ruflo-cli (${fast.ok ? 'row absent' : fast.reason})`;
      const retrieved = this.run([
        'memory', 'retrieve', '--key', snapshot.eventKey, '--namespace', PROGRESSION_NAMESPACE,
        '--value-only', '--path', this.resolution.canonicalAgentDbPath,
      ]);
      if (resultStatus(retrieved) !== 0) {
        const storeFailure = alreadyStored
          ? `; store failed: ${resultText(stored, 'stderr').trim() || 'unknown error'}`
          : '';
        throw new Error(`progression readback failed: ${resultText(retrieved, 'stderr').trim() || 'unknown error'}${storeFailure}`);
      }
      readbackText = resultText(retrieved, 'stdout');
    }
    let readback;
    try { readback = JSON.parse(readbackText); } catch { throw new Error('progression readback is not JSON'); }
    if (readback.payloadDigest !== snapshot.payloadDigest || digestCanonical(readback) !== digestCanonical(snapshot)) {
      throw new Error('progression readback digest mismatch');
    }
    onPhase('readback-verified');
    return {
      eventKey: snapshot.eventKey,
      payloadDigest: snapshot.payloadDigest,
      readbackDigest: readback.payloadDigest,
      alreadyStored,
      committedAt: this.clock(),
    };
  }

  capture(snapshot, { onPhase = () => {} } = {}) {
    this.validateSnapshot(snapshot);
    this.requireCaptureConsent(snapshot);
    this.outbox.appendSnapshot(snapshot);
    onPhase('outbox-fsynced');
    const receipt = this.appendExact(snapshot, { onPhase });
    this.outbox.markCommitted(receipt);
    return receipt;
  }

  /** Frozen queue recovery never rewrites the conflicting row or marks its key committed. */
  captureFrozen(snapshot, { canCommit } = {}) {
    if (typeof canCommit !== 'function') throw new Error('frozen recovery requires replay fencing');
    const fenced = () => { if (!canCommit()) throw new Error('progression recovery lost replay fencing'); };
    fenced();
    try { return { snapshot, receipt: this.capture(snapshot, { onPhase: fenced }) }; } catch (error) {
      if (error.message !== 'progression readback digest mismatch') throw error;
    }
    // An independently retrieved exact canonical value must be valid for this project. A failed,
    // absent, malformed or foreign read is never evidence that the immutable key collided.
    const exact = this.retrieveSnapshots([snapshot.eventKey]);
    if (exact.rejected.length || exact.snapshots.length !== 1) throw new Error('immutable collision is not verified');
    const existing = exact.snapshots[0];
    this.validateSnapshot(existing);
    if (existing.eventKey !== snapshot.eventKey || existing.payloadDigest === snapshot.payloadDigest) {
      throw new Error('immutable collision is not verified');
    }
    const identity = { originalEventKey: snapshot.eventKey,
      frozenPayloadDigest: snapshot.payloadDigest, existingPayloadDigest: existing.payloadDigest };
    const created = createProgressionSnapshot({ ...snapshot,
      dedupId: `immutable-recovery:${digestCanonical(identity)}` });
    // Preserve the frozen state and source exactly; diagnostics carry no instruction authority.
    const { payloadDigest: _digest, ...body } = created;
    body.redactions = snapshot.redactions;
    body.recoveryDiagnostics = { kind: 'immutable-event-key-collision', authoritative: false, ...identity };
    const recovered = Object.freeze({ ...body, payloadDigest: digestCanonical(body) });
    this.validateSnapshot(recovered);
    this.requireCaptureConsent(recovered);
    fenced();
    const receipt = this.capture(recovered, { onPhase: fenced });
    fenced();
    this.outbox.markRecovered(snapshot, receipt);
    return { snapshot: recovered, receipt };
  }

  replay() {}
  retrieveSnapshots(keys) {
    // The whole batch through ONE read-only handle, or the whole batch through the CLI. Never a
    // mixture: a half-served batch would make "exactly these rows, read exactly this way" untrue.
    const fast = this.readFast((reader) => {
      const snapshots = [];
      const rejected = [];
      for (const key of keys) {
        const content = reader.readContent(PROGRESSION_NAMESPACE, key);
        if (content === null) throw new Error(`progression exact retrieval failed for ${key}: row not found`);
        let snapshot;
        try { snapshot = JSON.parse(content); } catch {
          rejected.push({ eventKey: key, reasons: ['readback is not JSON'] });
          continue;
        }
        if (!plainRecord(snapshot) || snapshot.eventKey !== key) {
          rejected.push({ eventKey: key, reasons: ['exact key/payload identity mismatch'] });
          continue;
        }
        snapshots.push(snapshot);
      }
      return { snapshots, rejected: sortRejected(rejected) };
    });
    if (fast.ok) {
      this.lastReadPath = 'node:sqlite';
      return fast.value;
    }
    this.lastReadPath = `ruflo-cli (${fast.reason})`;
    return this.retrieveSnapshotsViaCli(keys);
  }

  retrieveSnapshotsViaCli(keys) {
    const snapshots = [];
    const rejected = [];
    for (const key of keys) {
      const retrieved = this.run([
        'memory', 'retrieve', '--key', key, '--namespace', PROGRESSION_NAMESPACE,
        '--value-only', '--path', this.resolution.canonicalAgentDbPath,
      ]);
      if (resultStatus(retrieved) !== 0) {
        throw new Error(`progression exact retrieval failed for ${key}: ${resultText(retrieved, 'stderr').trim() || 'unknown error'}`);
      }
      let snapshot;
      try { snapshot = JSON.parse(resultText(retrieved, 'stdout')); } catch {
        rejected.push({ eventKey: key, reasons: ['readback is not JSON'] });
        continue;
      }
      if (!plainRecord(snapshot) || snapshot.eventKey !== key) {
        rejected.push({ eventKey: key, reasons: ['exact key/payload identity mismatch'] });
        continue;
      }
      snapshots.push(snapshot);
    }
    return { snapshots, rejected: sortRejected(rejected) };
  }

  /** How many durable snapshots — remaining methods are outside this fixture. */
}
