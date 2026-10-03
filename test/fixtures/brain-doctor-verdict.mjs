// Verbatim native Brain 4.5.2 one-verdict reducer, no runtime imports.
export function doctorVerdict(confirmation, checks = []) {
  const lines = [...(confirmation?.lines || []), ...checks];
  const failing = lines.filter((l) => l.state === 'fail').map((l) => l.id);
  return { ...confirmation, kind: 'ruvnet-brain-doctor', lines, ok: failing.length === 0, failing,
    advisories: lines.filter((l) => l.state === 'warn').map((l) => l.id), exitCode: failing.length ? 1 : 0 };
}
