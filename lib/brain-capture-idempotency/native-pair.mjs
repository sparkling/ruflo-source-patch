// Brain #513/#520: reuse the installed canonical owner route in one bounded process.
// No database driver, persistent MCP session, write retry, or alternate authority.
function runNativeCapturePair({ ruflo, db, key, value, options, deadlineMs, reconcileOnly = false }) {
  if (/^(1|true|yes|on)$/i.test(String(options.env.RUFLO_MEMORY_SCAN_ON_WRITE || ''))) return null;
  const target = resolveBatchTarget(ruflo, { env: options.env, deadlineAt: deadlineMs });
  if (!target) return null; // Native CLI compatibility, before any operation.
  const end = Math.min(deadlineMs ?? Infinity, Date.now() + options.timeout);
  const result = spawnSync(target.node, [fileURLToPath(import.meta.url), '--native-capture-pair'], {
    ...options, timeout: Math.max(1, end - Date.now()),
    input: JSON.stringify({ ruflo, moduleUrl: target.moduleUrl, db, key, value, deadlineMs: end, reconcileOnly }),
  });
  if (result.error || result.signal || result.status !== 0) return { store: result, read: null };
  try {
    const pair = JSON.parse(result.stdout);
    if (pair.unsupported === true) return null;
    if (!pair.store || !Number.isInteger(pair.store.status)) throw Error('invalid native capture response');
    return pair;
  } catch { return { store: { status: 1, stderr: 'Native capture response unavailable; write outcome unknown' }, read: null }; }
}

async function nativeCapturePairWorker(job) {
  const output = process.stdout.write.bind(process.stdout);
  process.stdout.write = (...args) => process.stderr.write(...args);
  let owner, dispatched = false;
  const started = Date.now(), phases = {};
  const terminal = error => ({ status: 1, stderr: String(error?.message || error).slice(0, 2048) });
  const send = result => output(JSON.stringify({ ...result, phases: { ...phases, totalMs: Date.now() - started } }));
  try {
    if (!job || typeof job.ruflo !== 'string' || typeof job.moduleUrl !== 'string'
        || !path.isAbsolute(job.db || '') || typeof job.key !== 'string' || typeof job.value !== 'string'
        || !Number.isSafeInteger(job.deadlineMs) || job.deadlineMs <= Date.now()
        || job.deadlineMs > Date.now() + 60_000) throw Error('Invalid native capture request');
    const target = resolveBatchTarget(job.ruflo, { deadlineAt: job.deadlineMs });
    if (!target || target.moduleUrl !== job.moduleUrl) throw Error('Native capture module identity changed');
    const client = await import(new URL('../mcp-client.js', target.moduleUrl));
    owner = client.rspMemoryOwner;
    if (!owner || typeof owner.configured !== 'function' || typeof owner.binding !== 'function'
        || typeof owner.call !== 'function' || typeof owner.close !== 'function')
      throw Error('Installed native memory owner capability is unavailable');
    if (!owner.configured()) { send({ unsupported: true }); return; }
    await owner.binding(job.db); // Invalid configured authority never falls through to another driver.
    phases.initializationMs = Date.now() - started;
    const invoke = async (name, input) => {
      if (Date.now() >= job.deadlineMs) throw Error('Native capture deadline exhausted before dispatch');
      dispatched = true;
      if (name === 'memory_store') phases.storeAttempted = true;
      return owner.call(name, input, {}, true);
    };
    phases.storeAttempted = false;
    let store, read = null;
    const storeAt = Date.now();
    try {
      // Exact native CLI projection for the fixed turn recipe (no scanner flag).
      const result = job.reconcileOnly === true ? { success: true } : await invoke('memory_store', { key: job.key, value: job.value, namespace: TURN_NAMESPACE,
        generateEmbeddingFlag: true, requireNative: true, appendOnly: true, tags: [],
        upsert: false, provenanceType: 'agent_output', dbPath: job.db });
      if (result?.success === true) store = { status: 0 };
      else if (result?.success === false && typeof result.error === 'string') store = { status: 1, stderr: result.error };
      else store = { status: 1, stderr: 'Invalid native store response; write outcome unknown' };
    } catch (error) { store = terminal(error); }
    phases.storeMs = Date.now() - storeAt;
    // A failed/unknown write is never reissued. Only acknowledged writes or native
    // duplicate refusals enter the existing exact-readback contract.
    if (store.status === 0 || /already exists/i.test(store.stderr || '')) {
      const readAt = Date.now();
      try {
        const result = await invoke('memory_retrieve', { key: job.key, namespace: TURN_NAMESPACE, dbPath: job.db });
        read = result?.success === true && result.found === true && typeof result.entry?.content === 'string'
          ? { status: 0, stdout: result.entry.content }
          : { status: 1, stderr: typeof result?.error === 'string' ? result.error : 'Native exact turn readback unavailable' };
      } catch (error) { read = terminal(error); }
      phases.readbackMs = Date.now() - readAt;
    }
    send({ store, read, reconcileOnly: job.reconcileOnly === true });
  } catch (error) { send({ store: terminal(error), read: null, dispatched }); }
  finally { if (owner?.close) await owner.close().catch(() => {}); }
}

export const NATIVE_PAIR_HELPER = `// ruflo-source-patch (brain#513 native-capture-pair)
${runNativeCapturePair.toString()}
${nativeCapturePairWorker.toString()}
`;
export const NATIVE_PAIR_EDITS = [
  ['native-pair-imports', "import { nativeTurnLines } from './native-turn-transcript.mjs';",
    "import { nativeTurnLines } from './native-turn-transcript.mjs';\nimport { resolveBatchTarget } from './agentdb-recall-process.mjs';\nimport { readStdinBounded } from './hook-input.mjs';"],
  ['native-pair-helper', 'const projectName = ', `${NATIVE_PAIR_HELPER}\nconst projectName = `],
  ['native-pair-state', '  let lastTurnReadback = null;', '  let lastTurnReadback = null, lastReadTerminal = null, nativePairPhases, activePair;'],
  ['native-pair-reset', '    lastTurnReadback = null; let committedTurn = null;', '    lastTurnReadback = null; lastReadTerminal = null; nativePairPhases = undefined; activePair = null; let committedTurn = null;'],
  ['native-pair-dispatch', '      const r = run(invocation.executable, invocation.args, options);',
    `      const reconcileOnly = kind === 'store' && queued.reconcileOnly === true;
      if (kind === 'store' && !reconcileOnly) {
        if (!receipts) throw Error('Turn attempt receipt unavailable; no dispatch');
        appendReceipt(receipts, { at: new Date().toISOString(), kind, db: redactText(db), storeIdentity: digest(db), key,
          status: 1, verified: false, pending: true, deadlineMs: deadlineMs ?? Date.now() + STEP_TIMEOUT_MS,
          owner: { pid: process.pid, start: turnWorkerProcessStart(process.pid) },
          error: 'turn attempt pending exact readback' });
      }
      const pair = kind === 'store' && suppliedRun === spawnSync && nativeRead === readBack
        ? runNativeCapturePair({ ruflo, db, key, value, options, deadlineMs, reconcileOnly }) : null;
      activePair = pair; nativePairPhases = pair?.phases;
      const r = pair ? pair.store : reconcileOnly ? { status: 0 } : run(invocation.executable, invocation.args, options);`],
  ['native-pair-read', '  const run = (binary, args, options) => {',
    `  const run = (binary, args, options) => {
    if (activePair && args.includes('retrieve')) return activePair.read || { status: 1, stderr: 'Native readback not dispatched' };`],
  ['native-pair-reconcile', "const duplicate = kind === 'store' && status !== 0 && /already exists/i.test(captureFailureReason(r, status));",
    "const duplicate = kind === 'store' && (reconcileOnly || status !== 0 && /already exists/i.test(captureFailureReason(r, status)));"],
  ['native-pair-receipt', '...(committedTurn || {}), ...(skipped ? { skipped } : {})',
    '...(committedTurn || {}), ...(nativePairPhases ? { phases: nativePairPhases } : {}), ...(skipped ? { skipped } : {})'],
  ['native-pair-terminal', '    lastTurnReadback = nativeRead !== readBack ? value',
    `    lastReadTerminal = result && (result.error || result.signal || result.status !== 0)
      ? captureFailureReason(result, result.status ?? 1) : null;
    lastTurnReadback = nativeRead !== readBack ? value`],
  ['native-pair-read-error', "    } catch (e) { status = 1; error = redactText(e.message).slice(0, 300); }",
    `      if (kind === 'store' && !verified && lastReadTerminal) {
        status = 1; error = 'exact turn readback failed: ' + lastReadTerminal;
      }
    } catch (e) { status = 1; error = redactText(e.message).slice(0, 300); }`],
  ['native-pair-entry', "if (isDirectInvocation(import.meta.url) && process.argv[2] === '--run-steps') {",
    `if (isDirectInvocation(import.meta.url) && process.argv[2] === '--native-capture-pair') {
  try { await nativeCapturePairWorker(JSON.parse((await readStdinBounded({ maxBytes: 1024 * 1024 })).toString('utf8'))); }
  catch { process.exitCode = 1; }
  process.exit(process.exitCode || 0);
}

if (isDirectInvocation(import.meta.url) && process.argv[2] === '--run-steps') {`],
];
