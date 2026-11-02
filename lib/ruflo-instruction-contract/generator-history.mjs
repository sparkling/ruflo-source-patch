// Exact previous emitted policy, retained only for composition and restoration.
// Current instructions defer workspace and release choices to the caller.
const REVISIONS = [
  ['', '\n- Follow caller instructions for workspace isolation and release authorization,\n  including standing authorization.'],
  ['8. Publish only through a separately authorized release gate.',
    "8. Publish through the caller's established release process and authorization."],
  ['One writer per worktree; one integration owner.',
    'Assign non-overlapping file ownership and one integration owner; follow caller workspace rules.'],
  ['- Give every writer its own worktree and non-overlapping file ownership.',
    '- Give writers non-overlapping file ownership within the caller-authorized workspace.'],
  ['Use isolated worktrees for concurrent writers, one integration owner, and exact\nsource evidence.',
    'Follow caller workspace rules for concurrent writers, name one integration owner,\nand retain exact source evidence.'],
];
const literal = text => JSON.stringify(text).slice(1, -1);
export function historicalRuntime(runtime) {
  return REVISIONS.reduce((source, [previous, current]) => source.replaceAll(literal(current), literal(previous)), runtime);
}

export function recoverGenerator(source, runtime, reverse, patch) {
  const previous = historicalRuntime(runtime);
  const old = source.includes(previous);
  if (!old && !source.includes(runtime)) return null;
  const candidate = reverse(source);
  const verify = pristine => {
    const result = patch(pristine);
    if (result.missing.length) return pristine;
    return old ? result.next.replace(runtime, previous) : result.next;
  };
  return candidate !== source && verify(candidate) === source ? { candidate, verify } : null;
}
