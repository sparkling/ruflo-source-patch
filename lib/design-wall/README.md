# `design-wall`

[← ruflo-source-patch](../../README.md)

A visual-design gate that gates everyone else's repos too.

> **Retired on current ruvnet-brain versions.** Upstream issue #17 is fixed with a stronger
> plugin-manifest identity gate. This target now verifies the active installed scripts and
> self-retires; it remains available only for older copies.

Patches the **`ruvnet-brain`** plugin's `scripts/design-wall.sh`, a `PreToolUse` hook that blocks
`git commit` on a staged `README.md`/`explainer/`/`console/` file until a fresh design-grade stamp
is on record. A genuinely good idea for ruvnet-brain's own visual surfaces, applied to every other
repository on the machine too, since the check never verifies which project it is actually running
in.

Upstream: [stuinfla/ruvnet-brain#17](https://github.com/stuinfla/ruvnet-brain/issues/17)

## The bug

```bash
if [[ $CMD == *"git commit"* ]]; then
  STAGED=$(git -C "${CLAUDE_PROJECT_DIR:-.}" diff --cached --name-only 2>/dev/null || true)
  [[ $STAGED == *"README.md"*  ]] && need+=("readme")
  ...
```

`${CLAUDE_PROJECT_DIR:-.}` names the project the commit is happening in. It is never checked for
identity before requiring a stamp. Committing a plain-markdown README change in an entirely
unrelated repository trips the identical wall as editing ruvnet-brain's own explainer page.

## The historical local fix

Read the project's git origin and require it to actually name `ruvnet-brain`/`stuinfla` before any
of the staged-surface checks run:

```bash
ORIGIN=$(git -C "${CLAUDE_PROJECT_DIR:-.}" remote get-url origin 2>/dev/null || true)
if [[ $ORIGIN == *"ruvnet-brain"* || $ORIGIN == *"stuinfla"* ]]; then
  STAGED=$(git -C "${CLAUDE_PROJECT_DIR:-.}" diff --cached --name-only 2>/dev/null || true)
  ...
fi
```

ruvnet-brain's own README/explainer/console commits are still gated exactly as before; every other
repository's commits are no longer touched by this check at all.

Current upstream releases do this without relying on the remote URL: they verify the repository's
own plugin manifest (with a structure fallback). The supersession predicate resolves physically
bounded active copies from the plugin manifest. If the legacy wrapper is still installed, it tests
the byte-proven upstream backup in a temporary script directory. Its fixtures deliberately give an
unrelated repo a misleading ruvnet-brain origin and the own repo a manifest but unrelated origin, so
the old heuristic cannot pass as the replacement. Retirement additionally requires safe
reconciliation, an unchanged live file at restoration, and the same proof afterward.

## Usage

```bash
npx github:sparkling/ruflo-source-patch design-wall install
npx github:sparkling/ruflo-source-patch design-wall status
npx github:sparkling/ruflo-source-patch design-wall uninstall
```

See [ADR-024](../../docs/adr/ADR-024-design-wall-scope-to-ruvnet-brains-own-repo.md).
