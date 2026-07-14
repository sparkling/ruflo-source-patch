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
// BASH_REMATCH index downstream must move with it: tool 1->2, sub 2->4, sub-sub 4->6. Those consumers
// are separate edits with their own done() predicates — if any single one fails to apply, the file is
// reported INCOMPLETE rather than left with a regex whose groups no longer line up with its readers.
const EDITS = [
  {
    id: 'match-re',
    done: (s) => s.includes('(^|[[:space:]]|[;&|(])($TOOLS)'),
    variants: [{
      find: 'MATCH_RE="($TOOLS)[@a-z0-9.-]*[[:space:]]+([a-z][a-z-]*)([[:space:]]+([a-z][a-z-]*))?"',
      replace: `# ruflo-source-patch (stuinfla/ruvnet-brain#12): two defects on one line.
#   1. \`[@a-z0-9.-]*\` was meant to absorb \`@latest\` — it also absorbs a hyphenated BINARY NAME, so
#      \`ruflo-source-patch adr-index status\` (a different tool) parsed as the \`ruflo\` CLI and the gate
#      demanded \`ruflo adr-index status --help\`: a command that does not exist. Unopenable.
#   2. No command-position anchor, so it matched inside PROSE — a commit message containing
#      "...ruflo-adr-reindex.sh was the pre-... copy" parsed as \`ruflo was the\`.
# Now: only a @version is absorbed, and the tool must START a command (line start, or after a
# separator). Groups shift, so the BASH_REMATCH indices below move too: 2=tool, 4=sub, 6=sub-sub.
MATCH_RE="(^|[[:space:]]|[;&|(])($TOOLS)(@[a-z0-9._-]+)?[[:space:]]+([a-z][a-z-]*)([[:space:]]+([a-z][a-z-]*))?"`,
    }],
  },

  // The help-recording path: KEY, and the parent stamp.
  {
    id: 'help-key',
    done: (s) => s.includes('    KEY="${BASH_REMATCH[2]}.${BASH_REMATCH[4]}'),
    variants: [{
      find: '    KEY="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}${BASH_REMATCH[4]:+.${BASH_REMATCH[4]}}"',
      replace: '    KEY="${BASH_REMATCH[2]}.${BASH_REMATCH[4]}${BASH_REMATCH[6]:+.${BASH_REMATCH[6]}}"',
    }],
  },
  {
    id: 'help-parent-stamp',
    done: (s) => s.includes('help-read/${BASH_REMATCH[2]}.${BASH_REMATCH[4]}"'),
    variants: [{
      find: '    : > "$HOME/.cache/ruvnet-brain/help-read/${BASH_REMATCH[1]}.${BASH_REMATCH[2]}" 2>/dev/null || true',
      replace: '    : > "$HOME/.cache/ruvnet-brain/help-read/${BASH_REMATCH[2]}.${BASH_REMATCH[4]}" 2>/dev/null || true',
    }],
  },

  // The blocking path: TOOL / SUB / KEY.
  {
    id: 'block-tool-sub-key',
    done: (s) => s.includes('TOOL="${BASH_REMATCH[2]}"'),
    variants: [{
      find: 'TOOL="${BASH_REMATCH[1]}"; SUB="${BASH_REMATCH[2]}${BASH_REMATCH[4]:+ ${BASH_REMATCH[4]}}"\nKEY="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}${BASH_REMATCH[4]:+.${BASH_REMATCH[4]}}"',
      replace: 'TOOL="${BASH_REMATCH[2]}"; SUB="${BASH_REMATCH[4]}${BASH_REMATCH[6]:+ ${BASH_REMATCH[6]}}"\nKEY="${BASH_REMATCH[2]}.${BASH_REMATCH[4]}${BASH_REMATCH[6]:+.${BASH_REMATCH[6]}}"',
    }],
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

import { writeIfChanged, resolvePristine, restoreFromBackup } from '../pristine.mjs';

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

function patchSource(pristine) {
  let next = pristine;
  const applied = [];
  const missing = [];
  for (const e of EDITS) {
    if (e.done(next)) continue;
    const v = e.variants.find((x) => next.includes(x.find));
    if (!v) { missing.push(e.id); continue; }
    next = next.split(v.find).join(v.replace);
    applied.push(e.id);
  }
  return { next, applied, missing };
}

const patchOnly = (src) => patchSource(src).next;

export function apply() {
  const result = {
    patched: 0, unchanged: 0, skipped: 0, incomplete: 0, rebaselined: 0, errors: 0, log: [],
  };
  for (const file of discover()) {
    try {
      const { pristine, rebaselined, empty, poisoned } = resolvePristine(file, patchOnly);
      if (poisoned) {
        result.skipped++;
        result.log.push(`skip:poisoned-backup ${file} — its .rsp-backup was empty and has been discarded; the file is patched but its pristine is unrecoverable. Reinstall the plugin to reset.`);
        continue;
      }
      if (empty) {
        result.skipped++;
        result.log.push(`skip:empty-file ${file} — zero bytes; refusing to patch or overwrite it`);
        continue;
      }
      if (rebaselined) {
        result.rebaselined++;
        result.log.push(`re-baselined ${file} — upstream replaced it; patching the NEW file, not restoring the old one`);
      }

      const { next, applied, missing } = patchSource(pristine);

      if (!applied.length && missing.length) {
        // Every anchor gone. The most likely reason is the happy one — upstream fixed #12 — so say that
        // rather than implying breakage.
        result.skipped++;
        result.log.push(`skip:no-anchor-matched ${file} — missing: ${missing.join(', ')} (upstream may have fixed #12; if so, uninstall this target)`);
        continue;
      }

      // ATOMIC. These five edits are INTERDEPENDENT and must land together or not at all.
      //
      // The regex edit adds capture groups (bash ERE has no non-capturing `(?:…)`), which SHIFTS every
      // index its readers use — tool 1->2, sub 2->4, sub-sub 4->6. Apply the regex without its readers
      // and the gate reads BASH_REMATCH[1], which is now the boundary character rather than the tool: it
      // blocks on garbage, on every command, and only `uninstall` gets you out.
      //
      // We used to WRITE that. It reported INCOMPLETE and exited nonzero — loud, but the file was already
      // corrupted. "Loud but broken" is not the bar. Upstream re-wording ONE anchored line is enough to
      // trigger it, which is precisely what happens when a plugin updates.
      //
      // So: on a partial match, write NOTHING and leave the vendor file exactly as upstream shipped it.
      // The gate keeps its old (annoying) behaviour instead of a broken one, and the notifier says so.
      // patch-library's rebuild() has always been atomic per entry; this brings the plugin patcher into
      // line with it.
      if (missing.length) {
        result.incomplete++;
        result.log.push(`INCOMPLETE ${file} — NOTHING WRITTEN (the file is untouched vendor code). `
          + `Anchors still matching: ${applied.join(', ') || 'none'}; NOT MATCHING: ${missing.join(', ')}. `
          + 'These edits are interdependent — the regex shifts the capture groups its readers use, so a '
          + 'partial apply would leave the gate blocking on garbage. Upstream changed shape: update the '
          + 'anchors, or `verify-interface uninstall`.');
        continue;
      }

      const changed = writeIfChanged(file, next);
      if (changed) {
        result.patched++;
        result.log.push(`patched ${file} (${applied.length}/${EDITS.length} edits)`);
      } else {
        result.unchanged++;
      }
    } catch (err) {
      result.errors++;
      result.log.push(`error ${file}: ${err.message}`);
    }
  }
  return result;
}

export function restore() {
  const result = { restored: 0, log: [] };
  for (const file of discover()) {
    const r = restoreFromBackup(file);
    if (r.poisoned) {
      result.log.push(`skip:poisoned-backup ${file} — its .rsp-backup was empty; discarded it rather than overwriting the file with nothing. The file stays patched; reinstall the plugin to reset.`);
      continue;
    }
    if (!r.restored) continue;
    result.restored++;
    result.log.push(`restored ${file}`);
  }
  return result;
}

export function status() {
  const out = { files: 0, patched: 0, log: [] };
  for (const file of discover()) {
    out.files++;
    try {
      const src = fs.readFileSync(file, 'utf8');
      if (isPatched(src)) {
        out.patched++;
        out.log.push(`patched ${file}`);
      } else {
        const missing = EDITS.filter((e) => !e.done(src)).map((e) => e.id);
        out.log.push(`not-patched ${file} — missing: ${missing.join(', ')}`);
      }
    } catch { /* unreadable */ }
  }
  return out;
}
