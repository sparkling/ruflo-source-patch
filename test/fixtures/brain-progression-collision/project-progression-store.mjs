import { digestCanonical, validateProgressionSnapshot } from './project-progression-contract.mjs';
const PROGRESSION_NAMESPACE = 'project-progression';
function resultStatus(r) { return Number.isInteger(r?.status) ? r.status : 1; }
function resultText(r, field) { return String(r?.[field] ?? ''); }
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
  replay() {}
}
