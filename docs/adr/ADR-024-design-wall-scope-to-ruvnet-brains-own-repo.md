# ADR-024: design-wall: scope ruvnet-brain's commit gate to its own repo

**Status**: accepted
**Date**: 2026-07-17
**Deciders**: Henrik Pettersen
**Tags**: patch-target, plugin, ruvnet-brain

## Context

`ruvnet-brain` ships `scripts/design-wall.sh`, a `PreToolUse` gate that blocks `git commit` on any
staged `README.md`, `explainer/`, or `console/` file until a fresh visual design grade (screenshot at
two widths, graded 95+) is on record. The intent, per the script's own header, is real: stop a
carelessly-composed visual surface (ruvnet-brain's own explainer page, its console) from shipping
unreviewed.

Measured live: it blocked a plain-markdown `README.md` commit in `ruflo-source-patch`, a repository
with no connection to ruvnet-brain whatsoever, demanding a screenshot-and-grade ritual for a page that
does not exist. A GitHub-rendered text file is not a "visual surface" in the sense the gate means.

The check that decides this:

```bash
if [[ $CMD == *"git commit"* ]]; then
  STAGED=$(git -C "${CLAUDE_PROJECT_DIR:-.}" diff --cached --name-only 2>/dev/null || true)
  [[ $STAGED == *"README.md"* ]] && need+=("readme")
  ...
```

never checks WHICH repository `${CLAUDE_PROJECT_DIR:-.}` actually is. The gate's own stamp path
(`~/.cache/ruvnet-brain/design-stamp-readme.json`) and its sibling checks (`explainer/`, `console/`,
directories that exist only in ruvnet-brain's own checkout) make its intended scope obvious; the
implementation just never enforces it. Any repository with a `README.md` staged, anywhere the plugin
happens to be installed, trips the identical wall.

## Decision

Scope the whole "commits that stage visual surfaces" check to ruvnet-brain's own repository: read the
project's git origin and require it to actually name `ruvnet-brain`/`stuinfla` before requiring any
stamp. An unrelated repository's commit is no longer touched by this gate at all; its OWN commits
(README, explainer, console) are still gated exactly as before.

Single literal edit, applied to the marketplace checkout and every cached version (`design-wall.sh`
carries no version-drift risk the way `verify-interface.sh` did, one shape, one anchor).

## Consequences

### Positive

- An unrelated repository can `git commit` a plain markdown change without a fabricated visual-design
  ritual for a page that does not exist.
- ruvnet-brain's own README/explainer/console commits are still gated, verified live against a repo
  whose origin genuinely names it.

### Negative

- The origin check is a heuristic (`*ruvnet-brain*` / `*stuinfla*` substring match on the remote URL),
  not a byte-exact identity check. A repo whose origin happens to contain either substring for
  unrelated reasons would still be gated, which is the safe direction: it biases toward keeping the
  gate active, never toward silently disabling it for a repo that might actually be ruvnet-brain's own fork.

### Neutral

- The gate's other surfaces (a `vercel --prod` deploy, opening a known URL) are untouched; only the
  `git commit` branch changed.

## Links

- Upstream: [stuinfla/ruvnet-brain#17](https://github.com/stuinfla/ruvnet-brain/issues/17)
- `lib/design-wall/`
