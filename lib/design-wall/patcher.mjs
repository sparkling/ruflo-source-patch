// Patches the installed `ruvnet-brain` plugin's `scripts/design-wall.sh` PreToolUse gate. Measured
// live (2026-07-17): committing to `ruflo-source-patch` — a repo with no connection whatsoever to
// ruvnet-brain — was blocked by a `git commit` gate demanding a full visual design-grade ritual
// (screenshot two widths, grade >=95) for staging a plain markdown README.md.
//
// THE BUG. design-wall.sh's "commits that stage visual surfaces" check:
//
//   if [[ $CMD == *"git commit"* ]]; then
//     STAGED=$(git -C "${CLAUDE_PROJECT_DIR:-.}" diff --cached --name-only ...)
//     [[ $STAGED == *"README.md"* ]] && need+=("readme")
//     ...
//
// never checks WHICH repository `${CLAUDE_PROJECT_DIR:-.}` actually is before requiring the ritual.
// The gate's own design intent (per its header comment) is clearly ruvnet-brain's OWN explainer/
// console surfaces plus its OWN README — a "readme" stamp path
// (`~/.cache/ruvnet-brain/design-stamp-readme.json`) that has no meaning for a project the plugin
// merely happens to be installed in. A plain-text README.md commit in ANY OTHER git repository on
// the machine trips the identical wall, demanding screenshots of a page that does not exist.
//
// THE FIX. Scope the whole check to ruvnet-brain's own repository: verify the project's git origin
// actually names `ruvnet-brain`/`stuinfla` before requiring any stamp. An unrelated repo's commit
// is no longer touched at all.
//
// WHY PATCH RATHER THAN EDIT IN PLACE: a `/plugin update` re-fetches ruvnet-brain wholesale and
// reverts any hand-edit, silently. Same reason adr-template, adr-index and verify-interface are
// targets rather than one-off edits.
//
// WHEN UPSTREAM FIXES THIS: the anchor stops matching and this reports `skip:no-anchor-matched`
// loudly, at which point uninstall the target. It never guesses.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';

const MARKETPLACE = 'ruvnet-brain';
const SCRIPT = ['scripts', 'design-wall.sh'];

// Exact string, not a regex — this toolkit's literal find/replace discipline, so an anchor upstream
// has reworded is SKIPPED rather than guessed at.
const BUGGY = `if [[ $CMD == *"git commit"* ]]; then
  STAGED=$(git -C "\${CLAUDE_PROJECT_DIR:-.}" diff --cached --name-only 2>/dev/null || true)
  [[ $STAGED == *"explainer/"* ]] && need+=("explainer")
  [[ $STAGED == *"console/"*   ]] && need+=("console")
  [[ $STAGED == *"README.md"*  ]] && need+=("readme")
fi`;

const FIXED = `if [[ $CMD == *"git commit"* ]]; then
  # ruflo-source-patch: scope to ruvnet-brain's OWN repo. Unscoped, this fired on ANY repo's
  # README.md commit anywhere the plugin is installed — measured blocking an unrelated CLI
  # tool's plain-markdown doc commit with a full visual design-grade ritual meant for actual
  # rendered surfaces (explainer/, console/), not GitHub-rendered text.
  ORIGIN=$(git -C "\${CLAUDE_PROJECT_DIR:-.}" remote get-url origin 2>/dev/null || true)
  if [[ $ORIGIN == *"ruvnet-brain"* || $ORIGIN == *"stuinfla"* ]]; then
    STAGED=$(git -C "\${CLAUDE_PROJECT_DIR:-.}" diff --cached --name-only 2>/dev/null || true)
    [[ $STAGED == *"explainer/"* ]] && need+=("explainer")
    [[ $STAGED == *"console/"*   ]] && need+=("console")
    [[ $STAGED == *"README.md"*  ]] && need+=("readme")
  fi
fi`;

const EDITS = [
  { id: 'scope-to-own-repo', find: BUGGY, replace: FIXED, done: (s) => s.includes('ORIGIN=$(git -C') && s.includes('*"ruvnet-brain"*') },
];

// Every installed copy: the marketplace checkout and each cached version — Claude Code may load
// either, so patch them all rather than guess which one it actually runs.
export function discover() {
  const found = [];

  const mp = path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', MARKETPLACE, 'plugin', ...SCRIPT);
  if (fs.existsSync(mp)) found.push(mp);

  const cacheRoot = path.join(HOME_BASE, '.claude', 'plugins', 'cache', MARKETPLACE, MARKETPLACE);
  try {
    for (const version of fs.readdirSync(cacheRoot)) {
      const f = path.join(cacheRoot, version, ...SCRIPT);
      if (fs.existsSync(f)) found.push(f);
    }
  } catch { /* not installed via the cache path */ }

  return [...new Set(found)];
}

const isPatched = (src) => EDITS.every((e) => e.done(src));

// How many times does this anchor occur? An anchor no longer unique would apply to every
// occurrence, silently, in a place never inspected. Today it is unique — a measurement, checked
// at apply time, not a promise trusted forever.
const occurrences = (src, needle) => {
  let n = 0;
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
};

function patchSource(pristine) {
  let next = pristine;
  const applied = [];
  const missing = [];
  for (const e of EDITS) {
    if (e.done(next)) continue;
    const n = occurrences(next, e.find);
    if (n === 1) { next = next.split(e.find).join(e.replace); applied.push(e.id); }
    else { missing.push(n > 1 ? `${e.id}(AMBIGUOUS: anchor occurs ${n}x)` : e.id); }
  }
  return { next, applied, missing };
}

// The composable descriptor. Single edit, so atomicity is moot, but declared explicitly rather
// than left implicit — a partial match on a single-edit target is just "not applied", never
// "half applied".
export const descriptor = {
  name: 'design-wall',
  atomic: false,
  editCount: EDITS.length,
  discover,
  patchSource,
  isPatched,
};
