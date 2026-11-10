const occurrences = (source, needle) => source.split(needle).length - 1;
// #2638 adds a second identical return in a distinct public API. Keep the
// ordinary policy in AGENTS.md; the dual Claude view imports it once.
const CLAUDE_DUAL_RETURN_PATCHED = "    return rspInstructionContract(`${header}\\n${body}\\n`, 'claude').replace(rspCommonPolicy + '\\n\\n', '');";
export function claudeRender(source, original, normal, reverse = false) {
  const names = ['generateClaudeMd', ...(source.includes('export function generateDualClaudeMd(') ? ['generateDualClaudeMd'] : [])];
  let next = source;
  for (const name of names) {
    const start = next.indexOf('export function ' + name + '(');
    const end = next.indexOf('\n}', start);
    if (start < 0 || end < 0 || next.indexOf('export function ' + name + '(', start + 1) !== -1) return null;
    const body = next.slice(start, end);
    const patched = name === 'generateClaudeMd' ? normal : CLAUDE_DUAL_RETURN_PATCHED;
    const from = reverse ? patched : original, to = reverse ? original : patched;
    if (!reverse && occurrences(body, patched) === 1) continue;
    if (occurrences(body, from) !== 1) return null;
    next = next.slice(0, start) + body.replace(from, () => to) + next.slice(end);
  }
  return next;
}
