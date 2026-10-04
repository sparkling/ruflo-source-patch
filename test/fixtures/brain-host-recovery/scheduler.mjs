// Upstream 4.5.5 nightly-scheduler.mjs function.
export function describeFailedRefreshRun(receipt, { reasonLimit = 200 } = {}) {
  if (receipt?.status !== 'FAILED' || !Array.isArray(receipt.requiredPhaseOrder) || !Array.isArray(receipt.phases)) return null;
  const declared = receipt.requiredPhaseOrder;
  const ledger = receipt.phases.map((entry) => entry?.phase);
  if (ledger.length > declared.length || ledger.some((phase, index) => phase !== declared[index])) return null;
  if (ledger.length === 0) return `failed before its first phase (${receipt.terminalVerdict || 'unknown'})`;
  const failing = [...receipt.phases].reverse().find((entry) => entry?.status !== 'PASS') || receipt.phases[receipt.phases.length - 1];
  const reason = String(failing.evidence?.updateResult?.reason ?? failing.evidence?.reason ?? '').split('\n')[0].trim();
  return reason ? `failed at ${failing.phase}: ${reason.slice(0, reasonLimit)}` : `failed at ${failing.phase}`;
}
