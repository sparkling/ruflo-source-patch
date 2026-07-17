# `design-wall`

[← ruflo-source-patch](../../README.md)

A visual-design gate that gates everyone else's repos too.

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

## The fix

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

## Usage

```bash
npx github:sparkling/ruflo-source-patch design-wall install
npx github:sparkling/ruflo-source-patch design-wall status
npx github:sparkling/ruflo-source-patch design-wall uninstall
```

See [ADR-024](../../docs/adr/ADR-024-design-wall-scope-to-ruvnet-brains-own-repo.md).
