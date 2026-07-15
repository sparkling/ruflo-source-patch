// Patches the installed `ruvnet-brain` plugin's PreToolUse gate, `scripts/verify-interface.sh`
// (stuinfla/ruvnet-brain#12).
//
// THE GATE IS A GOOD IDEA. It blocks a Bash call naming a rUv CLI until you have read that command's
// --help, because someone once called `ruflo memory search "query"` positionally, got nothing back, and
// declared AgentDB broken three times over. Fine. Keep it.
//
// THE PROBLEM IS THAT IT CANNOT BE OPENED. Two defects, and they compound:
//
//   1. FALSE POSITIVES. The tool regex is `($TOOLS)[@a-z0-9.-]*` — the character class exists to absorb
//      `@latest`, and it also absorbs a hyphenated BINARY NAME. So `ruflo-source-patch adr-index status`
//      — an entirely different tool, with its own CLI — is read as the `ruflo` CLI, and the gate demands
//      you first run `ruflo adr-index status --help`. That command does not exist. `ruflo` has no
//      `adr-index` subcommand. The gate asks for something impossible and blocks until you provide it.
//
//      There is also no command-position anchor, so the regex is applied to the WHOLE command string,
//      quoted text included. A `git commit` whose message contained the sentence "...the installed
//      ruflo-adr-reindex.sh was the pre-71be214 copy" matched as `ruflo … was the`, and the gate
//      demanded the help output for a command called `was the`. Ordinary English prose that happens to
//      mention ruflo is enough to trigger it.
//
//      A tool name in PROSE sits after an English word. A tool name in a COMMAND sits at the start of
//      one. Anchoring to "after any whitespace" cannot tell those apart, and that was the residual false
//      positive left by the first version of this patch: the sentence "another ruflo process is writing"
//      still parsed as `ruflo process is`, so an `echo` or a heredoc that merely described the tool was
//      blocked. Command position is the real predicate: a boundary (line start, or a shell separator),
//      then any number of wrappers (`npx`, `sudo`) or VAR=VAL assignments, THEN the tool.
//
//   2. THE DOCUMENTED OVERRIDE CANNOT WORK. The block message ends: "Deliberate override, say why out
//      loud: RUVNET_SKIP_INTERFACE_CHECK=1". But the check reads that variable from the HOOK's own
//      environment — and a PreToolUse hook receives the proposed command as JSON on stdin and never
//      executes it. Setting the variable on the command, which is precisely what the message instructs,
//      cannot reach the hook. The one documented escape hatch is unreachable from the only side that is
//      told to use it.
//
// Together: a false-positive match with no working override. In one session this blocked five unrelated
// commands, including a git commit, in a repo whose NAME begins `ruflo-`. There is no way round it
// except to not name the tool.
//
// WHY PATCH RATHER THAN EDIT IN PLACE: a `/plugin update` re-fetches ruvnet-brain wholesale and reverts
// any hand-edit, silently. Same reason adr-template and adr-index are targets rather than one-off edits.
//
// WHEN UPSTREAM FIXES #12: the anchors stop matching and this reports `skip:no-anchor-matched` — loudly,
// not silently — at which point uninstall the target. It never guesses.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';

const MARKETPLACE = 'ruvnet-brain';
const SCRIPT = ['scripts', 'verify-interface.sh'];

// Exact strings, not regexes — the same literal find/replace discipline as the other patchers, so an
// anchor upstream has re-worded is SKIPPED rather than guessed at.
//
// The regex fix necessarily adds capture groups (bash ERE has no non-capturing `(?:…)`), so every
// BASH_REMATCH index downstream must move with it: tool 1->4, sub 2->6, sub-sub 4->8. Those consumers
// are separate edits with their own done() predicates — if any single one fails to apply, the file is
// reported INCOMPLETE rather than left with a regex whose groups no longer line up with its readers.
// UPSTREAM ADOPTED v1 OF THIS PATCH. ruvnet-brain 2.7.x ships the v1 regex, its comment block and the
// reachable override in the vendor file itself. So there are now TWO shapes in the wild and each edit
// needs BOTH anchors:
//
//   variant A — the ORIGINAL buggy line (still in older cached plugin versions).
//   variant B — v1's own output, which is what upstream now ships. v2 is applied ON TOP of it.
//
// Variant B's `find` is, quite literally, v1's `replace`. That is why it is written as a constant and
// not retyped: a copy that drifts by one character would report skip:anchor-not-found on the exact file
// it is meant to fix, and the target would go quiet while the bug stayed live.
const V1_MATCH_BLOCK = `# ruflo-source-patch (stuinfla/ruvnet-brain#12): two defects on one line.
#   1. \`[@a-z0-9.-]*\` was meant to absorb \`@latest\` — it also absorbs a hyphenated BINARY NAME, so
#      \`ruflo-source-patch adr-index status\` (a different tool) parsed as the \`ruflo\` CLI and the gate
#      demanded \`ruflo adr-index status --help\`: a command that does not exist. Unopenable.
#   2. No command-position anchor, so it matched inside PROSE — a commit message containing
#      "...ruflo-adr-reindex.sh was the pre-... copy" parsed as \`ruflo was the\`.
# Now: only a @version is absorbed, and the tool must START a command (line start, or after a
# separator). Groups shift, so the BASH_REMATCH indices below move too: 2=tool, 4=sub, 6=sub-sub.
MATCH_RE="(^|[[:space:]]|[;&|(])($TOOLS)(@[a-z0-9._-]+)?[[:space:]]+([a-z][a-z-]*)([[:space:]]+([a-z][a-z-]*))?"`;

const V2_MATCH_BLOCK = `# ruflo-source-patch (stuinfla/ruvnet-brain#12): three defects, fixed in two passes.
#   1. \`[@a-z0-9.-]*\` was meant to absorb \`@latest\` — it also absorbs a hyphenated BINARY NAME, so
#      \`ruflo-source-patch adr-index status\` (a different tool) parsed as the \`ruflo\` CLI and the gate
#      demanded \`ruflo adr-index status --help\`: a command that does not exist. Unopenable.
#   2. No command-position anchor, so it matched inside PROSE.
#   3. THE RESIDUAL FALSE POSITIVE, and the reason for this second pass. v1 anchored the tool to "after
#      any whitespace" — which EVERY English sentence satisfies. \`another ruflo process is writing\`
#      parsed as \`ruflo process is\`, and the gate demanded the help output for a command called
#      \`process is\`. An echo or a heredoc that merely DESCRIBED the tool was blocked.
#
# A tool name in PROSE sits after an English word. A tool name in a COMMAND sits at the start of one.
# That, not whitespace, is the predicate: a boundary (line start or a shell separator), then any number
# of wrappers (npx, sudo, VAR=VAL), THEN the tool.
# The added groups shift the BASH_REMATCH indices its readers use: 4=tool, 6=sub, 8=sub-sub.
WRAPPERS='npx|npm|pnpm|yarn|bunx|sudo|env|time|exec|command|nohup'
MATCH_RE="(^|[;&|(])[[:space:]]*((\$WRAPPERS|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*)[[:space:]]+)*(\$TOOLS)(@[a-z0-9._-]+)?[[:space:]]+([a-z][a-z-]*)([[:space:]]+([a-z][a-z-]*))?"`;

const EDITS = [
  {
    id: 'match-re',
    done: (s) => s.includes('MATCH_RE="(^|[;&|(])[[:space:]]*(($WRAPPERS'),
    variants: [
      {
        find: 'MATCH_RE="($TOOLS)[@a-z0-9.-]*[[:space:]]+([a-z][a-z-]*)([[:space:]]+([a-z][a-z-]*))?"',
        replace: V2_MATCH_BLOCK,
      },
      { find: V1_MATCH_BLOCK, replace: V2_MATCH_BLOCK },
    ],
  },

  // The help-recording path: KEY, and the parent stamp.
  {
    id: 'help-key',
    done: (s) => s.includes('    KEY="${BASH_REMATCH[4]}.${BASH_REMATCH[6]}'),
    variants: [
      {
        find: '    KEY="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}${BASH_REMATCH[4]:+.${BASH_REMATCH[4]}}"',
        replace: '    KEY="${BASH_REMATCH[4]}.${BASH_REMATCH[6]}${BASH_REMATCH[8]:+.${BASH_REMATCH[8]}}"',
      },
      {
        find: '    KEY="${BASH_REMATCH[2]}.${BASH_REMATCH[4]}${BASH_REMATCH[6]:+.${BASH_REMATCH[6]}}"',
        replace: '    KEY="${BASH_REMATCH[4]}.${BASH_REMATCH[6]}${BASH_REMATCH[8]:+.${BASH_REMATCH[8]}}"',
      },
    ],
  },
  {
    id: 'help-parent-stamp',
    done: (s) => s.includes('help-read/${BASH_REMATCH[4]}.${BASH_REMATCH[6]}"'),
    variants: [
      {
        find: '    : > "$HOME/.cache/ruvnet-brain/help-read/${BASH_REMATCH[1]}.${BASH_REMATCH[2]}" 2>/dev/null || true',
        replace: '    : > "$HOME/.cache/ruvnet-brain/help-read/${BASH_REMATCH[4]}.${BASH_REMATCH[6]}" 2>/dev/null || true',
      },
      {
        find: '    : > "$HOME/.cache/ruvnet-brain/help-read/${BASH_REMATCH[2]}.${BASH_REMATCH[4]}" 2>/dev/null || true',
        replace: '    : > "$HOME/.cache/ruvnet-brain/help-read/${BASH_REMATCH[4]}.${BASH_REMATCH[6]}" 2>/dev/null || true',
      },
    ],
  },

  // The blocking path: TOOL / SUB / KEY.
  {
    id: 'block-tool-sub-key',
    done: (s) => s.includes('TOOL="${BASH_REMATCH[4]}"'),
    variants: [
      {
        find: 'TOOL="${BASH_REMATCH[1]}"; SUB="${BASH_REMATCH[2]}${BASH_REMATCH[4]:+ ${BASH_REMATCH[4]}}"\nKEY="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}${BASH_REMATCH[4]:+.${BASH_REMATCH[4]}}"',
        replace: 'TOOL="${BASH_REMATCH[4]}"; SUB="${BASH_REMATCH[6]}${BASH_REMATCH[8]:+ ${BASH_REMATCH[8]}}"\nKEY="${BASH_REMATCH[4]}.${BASH_REMATCH[6]}${BASH_REMATCH[8]:+.${BASH_REMATCH[8]}}"',
      },
      {
        find: 'TOOL="${BASH_REMATCH[2]}"; SUB="${BASH_REMATCH[4]}${BASH_REMATCH[6]:+ ${BASH_REMATCH[6]}}"\nKEY="${BASH_REMATCH[2]}.${BASH_REMATCH[4]}${BASH_REMATCH[6]:+.${BASH_REMATCH[6]}}"',
        replace: 'TOOL="${BASH_REMATCH[4]}"; SUB="${BASH_REMATCH[6]}${BASH_REMATCH[8]:+ ${BASH_REMATCH[8]}}"\nKEY="${BASH_REMATCH[4]}.${BASH_REMATCH[6]}${BASH_REMATCH[8]:+.${BASH_REMATCH[8]}}"',
      },
    ],
  },

  // Make the DOCUMENTED override reachable — honour it where the message actually tells you to write it.
  {
    id: 'override-on-command',
    done: (s) => s.includes('[[ $CMD =~ RUVNET_SKIP_INTERFACE_CHECK=1 ]]'),
    variants: [{
      find: 'CMD=$(field command)\n[ -n "$CMD" ] || exit 0',
      replace: `CMD=$(field command)
[ -n "$CMD" ] || exit 0

# ruflo-source-patch (stuinfla/ruvnet-brain#12): the documented override, made reachable.
# The block message says: "Deliberate override, say why out loud: RUVNET_SKIP_INTERFACE_CHECK=1".
# But the check above reads that variable from THIS HOOK's environment — and a PreToolUse hook is
# handed the proposed command as JSON on stdin and never executes it, so setting the variable on the
# command cannot possibly reach us. The one documented escape hatch was unreachable from the only
# side that is told to use it. Honour it where the message says to write it: on the command.
[[ $CMD =~ RUVNET_SKIP_INTERFACE_CHECK=1 ]] && exit 0`,
    }],
  },
];

// Every installed copy: the marketplace checkout (plugin/scripts/…) and each cached version
// (cache/ruvnet-brain/ruvnet-brain/<ver>/scripts/…). The two have different shapes, and Claude Code may
// load either — patch them all, or the one it actually runs is the one we missed.
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

// How many times does this anchor occur? split().join() is replace-ALL, so an anchor that is no longer
// UNIQUE would be applied to every occurrence — silently, and in a place we never inspected.
//
// Anchor uniqueness is a property of UPSTREAM'S CODE, which we do not control and cannot guarantee for
// any future release. Today all of them are unique. That is a measurement, not a promise. So we check it
// at apply time and REFUSE when it no longer holds: an ambiguous anchor is not a licence to guess, it is
// a signal that upstream restructured and a human must look.
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
    const v = e.variants.find((x) => occurrences(next, x.find) === 1);
    if (!v) {
      // Not found at all, OR found more than once. Both mean the same thing to us: we cannot say
      // WHERE this edit belongs, so we do not apply it anywhere.
      const dup = e.variants.find((x) => occurrences(next, x.find) > 1);
      missing.push(dup ? `${e.id}(AMBIGUOUS: anchor occurs ${occurrences(next, dup.find)}x)` : e.id);
      continue;
    }
    next = next.split(v.find).join(v.replace);
    applied.push(e.id);
  }
  return { next, applied, missing };
}

// The composable descriptor. `atomic: true` — these five edits are INTERDEPENDENT (the regex fix shifts
// the BASH_REMATCH capture indices its readers use), so a PARTIAL match must contribute NOTHING and leave
// the vendor gate exactly as upstream shipped it rather than blocking on garbage. The engine
// (plugin-compose.mjs) honours `atomic` by taking this target's contribution as all-or-nothing (ADR-020).
// verify-interface patches a DIFFERENT marketplace (ruvnet-brain) than the ruflo targets, so it never
// actually shares a file — but the atomicity is preserved regardless.
export const descriptor = {
  name: 'verify-interface',
  atomic: true,
  editCount: EDITS.length,
  discover,
  patchSource,
  isPatched,
};
