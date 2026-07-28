// Rate-limit RuvNet Brain's flywheel opt-in advisory (upstream issue #53).
//
// `ground-ruvnet.sh` is a UserPromptSubmit hook, so its current unconditional
// Ruflo+flywheel-off branch emits on every prompt in both Claude Code and Codex.
// Telling the model to offer it "once per session" cannot suppress hook output;
// the hook itself must own the cadence.
//
// The claim is:
//   - once per LOCAL calendar day and canonical project root;
//   - shared by Claude and Codex through ~/.cache/ruvnet-brain;
//   - atomic under concurrent sessions (`mkdir` is the compare-and-set);
//   - fail-silent, because an optional advisory must never break a prompt.
//
// Only this advisory is gated. Prompt-dependent grounding, memory warnings, and
// the Brain footer still execute on every invocation.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';

const MARKETPLACE = 'ruvnet-brain';
const SCRIPT = ['scripts', 'ground-ruvnet.sh'];

export const FLYWHEEL_START = `FLYWHEEL=off
case "\${RUFLO_HARNESS_LOOP:-}" in 1|true|yes|on|TRUE|Yes|On) FLYWHEEL=on ;; esac`;

export const FLYWHEEL_CONDITION = 'if [ "$RUFLO_STATE" = "yes" ] && [ "$FLYWHEEL" = "off" ]; then';
export const PATCHED_CONDITION = 'if [ "$RUFLO_STATE" = "yes" ] && [ "$FLYWHEEL" = "off" ] && brain_daily_claim flywheel; then';
export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#53)';

const CLAIM_HELPER = `# ${PATCH_MARKER}: claim this optional advisory once per local day/project.
# A failed claim stays silent; lifecycle guidance must never make a prompt fail.
brain_daily_claim() (
  umask 077
  case "\${1:-}" in ''|*[!a-z0-9-]*) exit 1 ;; esac

  _brain_day=$(date +%Y-%m-%d 2>/dev/null) || exit 1
  case "$_brain_day" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
    *) exit 1 ;;
  esac

  _brain_project=\${CLAUDE_PROJECT_DIR:-.}
  _brain_project=$(cd "$_brain_project" 2>/dev/null && pwd -P) || exit 1
  _brain_project_key=$(printf '%s' "$_brain_project" | cksum 2>/dev/null | awk '{print $1 "-" $2}')
  case "$_brain_project_key" in
    ''|*[!0-9-]*|*-*-*) exit 1 ;;
  esac

  _brain_claim_root="\${RUVNET_BRAIN_HOME:-$HOME/.cache/ruvnet-brain}/daily-advisories/$1/$_brain_project_key"
  mkdir -p "$_brain_claim_root" 2>/dev/null || exit 1
  mkdir "$_brain_claim_root/$_brain_day" 2>/dev/null
)

${FLYWHEEL_START}`;

const EDITS = [
  {
    id: 'daily-claim-helper',
    find: FLYWHEEL_START,
    replace: CLAIM_HELPER,
    done: (src) => src.includes(PATCH_MARKER),
  },
  {
    id: 'claim-before-advisory',
    find: FLYWHEEL_CONDITION,
    replace: PATCHED_CONDITION,
    done: (src) => src.includes(PATCHED_CONDITION),
  },
];

function addVersions(found, root) {
  try {
    for (const version of fs.readdirSync(root)) {
      const file = path.join(root, version, ...SCRIPT);
      if (fs.existsSync(file)) found.push(file);
    }
  } catch { /* this installation surface is absent */ }
}

function relevant(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const src = fs.readFileSync(file, 'utf8');
    return src.includes(PATCH_MARKER)
      || (src.includes('Self-learning flywheel') && src.includes('RUFLO_HARNESS_LOOP'));
  } catch {
    return false;
  }
}

// Patch every load surface. Claude Code can run a versioned plugin cache,
// Codex runs its own versioned plugin cache, and Brain's immutable installer
// generations are the authoritative scripts used by its user-global adapter.
export function discoverAll() {
  const found = [];
  const marketplace = process.env.RSP_RUVNET_BRAIN_MARKETPLACE
    || path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', MARKETPLACE);
  const brainHome = process.env.RSP_RUVNET_BRAIN_HOME
    || path.join(HOME_BASE, '.cache', 'ruvnet-brain');

  found.push(path.join(marketplace, 'plugin', ...SCRIPT));
  addVersions(found, path.join(HOME_BASE, '.claude', 'plugins', 'cache', MARKETPLACE, MARKETPLACE));
  addVersions(found, path.join(HOME_BASE, '.codex', 'plugins', 'cache', MARKETPLACE, MARKETPLACE));
  addVersions(found, path.join(brainHome, 'versions'));

  return [...new Set(found.filter(relevant))];
}

// A mixed installation is expected during rollout: the marketplace may already carry upstream #53
// while the immutable/host caches still execute older bytes. Do not claim the fixed file as a local
// patch target (that would report an atomic "missing anchor" on every monitor tick); the retirement
// predicate still sees it through discoverAll() and waits for every active execution surface.
export function discover() {
  return discoverAll().filter((file) => {
    try {
      const source = fs.readFileSync(file, 'utf8');
      if (source.includes(PATCH_MARKER)) return true;
      const upstreamFixed = source.includes('claim_flywheel_day() {')
        && source.includes('&& claim_flywheel_day; then');
      return !upstreamFixed;
    } catch {
      return false;
    }
  });
}

const occurrences = (src, needle) => {
  let count = 0;
  let offset = 0;
  while ((offset = src.indexOf(needle, offset)) !== -1) {
    count++;
    offset += needle.length;
  }
  return count;
};

export function patchSource(pristine) {
  let next = pristine;
  const applied = [];
  const missing = [];
  for (const edit of EDITS) {
    if (edit.done(next)) continue;
    const count = occurrences(next, edit.find);
    if (count === 1) {
      next = next.replace(edit.find, edit.replace);
      applied.push(edit.id);
    } else {
      missing.push(count > 1 ? `${edit.id}(AMBIGUOUS: anchor occurs ${count}x)` : edit.id);
    }
  }
  return { next, applied, missing };
}

export const isPatched = (src) => EDITS.every((edit) => edit.done(src));

export const descriptor = {
  name: 'flywheel-daily',
  atomic: true,
  editCount: EDITS.length,
  discover,
  patchSource,
  isPatched,
};
