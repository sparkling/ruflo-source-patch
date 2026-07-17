// WHEN A TARGET IS NO LONGER NEEDED, IT SHOULD RETIRE ITSELF. This is that mechanism.
//
// The obvious design is a published list of "fixed" issues that the monitor reads and acts on. It is
// the wrong design, and the reason is the whole thesis of this package.
//
// A LIST OF FIXES IS A CLAIM ABOUT THE WORLD. WHAT WE NEED IS A CLAIM ABOUT THIS MACHINE.
//
// Those come apart constantly, and they came apart twice in one week:
//
//   #2666  CLOSED, and genuinely fixed — and still did not work. `ruflo-adr` 0.4.0 ships from the
//          MARKETPLACE the instant it lands; the `memory purge` its /adr-reindex calls shipped on NPM,
//          separately, in @claude-flow/cli 3.29.0. Between those two events the skill was installed and
//          the command it invokes did not exist. On a machine pinned to 3.28.0 that is STILL true.
//   #2621  CLOSED, and not fixed at all. Upstream's own commit says so in a comment.
//
// So: `closed` != `fixed`, and `fixed` != `runnable here`. A retirement list keyed on either would have
// uninstalled a working reconcile on someone still running 3.28.0, leaving them with an /adr-reindex that
// calls a non-existent subcommand, exits 0, and reports `adr-patterns: purged` having purged NOTHING.
// That is this tool manufacturing its own founding failure mode, unattended, on other people's machines.
//
// THEREFORE: PUBLISH A PREDICATE, NOT A VERDICT.
//
// Each entry below declares the condition under which its target is obsolete, as CODE that is evaluated
// LOCALLY against the software actually installed. Retirement is then a measurement, not an assertion —
// the same discipline as the anchors, which never trust a version number and only ever check that the
// literal string is really there.
//
// The predicate SHIPS WITH THE PACKAGE. It is not fetched at runtime, deliberately: a remote file that an
// unattended launchd job parses and acts on DESTRUCTIVELY is a live channel into every user's machine,
// where one typo is a mass uninstall with no review at the moment of action. Shipped in-repo, publishing
// a supersession means committing a predicate and cutting a release — exactly the trust boundary users
// already accepted, and no new one.
//
// THE FAILURE DIRECTION IS THE WHOLE BALLGAME. Every unknown biases toward KEEPING the patch:
//
//   cannot find the CLI            -> unknown -> keep
//   probe throws                   -> unknown -> keep
//   replacement not actually there -> live    -> keep
//
// The cost of wrongly keeping a patch is a redundant slash command and a banner. The cost of wrongly
// retiring one is an index that reports a successful reconcile and reconciles nothing. Those are not
// symmetric and this file must never pretend they are.
//
// And NEVER RETIRE INTO A HOLE: a predicate must confirm the replacement is PRESENT *and* RUNNABLE before
// we remove ours. "Upstream owns the file" is not the same claim as "upstream's version works", and this
// package already told me to uninstall a working patch on exactly that conflation.

import fs from 'node:fs';

import * as adrReindex from './adr-reindex/patcher.mjs';
import { upstreamPurgeAvailable, discover as discoverReindexSkills } from './adr-reindex/patcher.mjs';
import path from 'node:path';
import { discover as discoverVerifyInterface, MARKETPLACE as VI_MARKETPLACE, SCRIPT as VI_SCRIPT } from './verify-interface/patcher.mjs';
import { reconcile as reconcileComposed } from './plugin-compose.mjs';
import { retireTarget as retireTargetInState, readState } from './cwd/state.mjs';
import { HOME_BASE } from './cwd/paths.mjs';

const OURS = 'ruflo-source-patch';

// Functional, CODE-level anchors from ruvnet-brain's real fix (v3.2.9+, commit bfc2d36) — not prose
// comments, which can be reworded without the underlying behaviour changing:
//   #13 fixed: the payload is piped through a real JSON parser, not the old bash regex.
//   #12 fixed: the override is checked against $CMD (the command string), not the hook's own env
//              (which a PreToolUse hook's stdin-JSON caller could never reach) — the exact defect
//              this project's own patch's `override-on-command` edit existed to work around.
// Exported so test fixtures can tell "this is upstream's OWN independent fix" apart from "a genuinely
// unpatched, buggy vendor copy" — the same distinction this predicate's `check()` makes, reused rather
// than re-derived so the two can never silently drift out of agreement with each other.
export const VI_FIX_MARKERS = {
  JSON_PARSE: '"$NODE_BIN" -e \'',
  OVERRIDE_ON_CMD: 'RUVNET_SKIP_INTERFACE_CHECK=1([[:space:]]|$)',
};

// verify-interface's own discover() walks EVERY cache/<version> dir that has ever existed on disk,
// which accumulates dead leftovers from past `/plugin update`s forever — checking the fix against
// every one of them would make this predicate practically inert. Measured on a real machine: 9 stale
// pre-fix ruvnet-brain cache dirs (2.6.0 through 3.1.1) sat alongside the active 3.3.0, and Claude Code
// can never load any of them again once a newer version is active. `installed_plugins.json` names the
// ACTUAL active version, so scope the check to what could really run: the marketplace checkout (always
// relevant — the patcher's own discover() comment notes Claude Code may load either) plus that ONE
// active cache copy. On ANY failure to resolve it — missing file, unexpected shape, no matching entry,
// a resolved path discover() itself doesn't recognise — fall back to checking EVERY discovered copy,
// the conservative default this whole file exists to enforce.
function activeVerifyInterfaceCopies() {
  const all = discoverVerifyInterface();
  try {
    const marketplaceFile = path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', VI_MARKETPLACE, 'plugin', ...VI_SCRIPT);
    const manifest = JSON.parse(fs.readFileSync(path.join(HOME_BASE, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    const entries = manifest?.plugins?.[`${VI_MARKETPLACE}@${VI_MARKETPLACE}`];
    const installPath = Array.isArray(entries) && entries[0]?.installPath;
    if (typeof installPath !== 'string' || !installPath) return all;
    const activeCache = path.join(installPath, ...VI_SCRIPT);
    const scoped = all.filter((f) => f === marketplaceFile || f === activeCache);
    return scoped.length ? scoped : all;
  } catch {
    return all;
  }
}

// A predicate returns one of:
//   { state: 'superseded', evidence }  the replacement is present AND runnable HERE. Retire.
//   { state: 'live',       evidence }  we are still doing something no one else is. Keep.
//   { state: 'unknown',    evidence }  we could not tell. Keep, and say why.
export const SUPERSEDED_BY = {
  'adr-reindex': {
    issue: 'https://github.com/ruvnet/ruflo/issues/2666',
    replacement: "ruflo-adr's own /adr-reindex, plus the `memory purge` hard-delete it calls",
    // How this target stands down. restore() only ever removes files carrying OUR marker; it refuses to
    // touch upstream's (skip:not-ours), so retiring cannot delete the replacement it is standing down for.
    retire: () => adrReindex.restore(),
    check() {
      // Both halves, because either alone is a hole.
      //
      //   the skill without the command  -> their reindex reports "purged" and purges nothing
      //   the command without the skill  -> there is no /adr-reindex to run at all
      const theirs = discoverReindexSkills().filter((f) => {
        try {
          return !fs.readFileSync(f, 'utf8').includes(OURS);
        } catch {
          return false;   // not on disk -> not a replacement
        }
      });

      if (!theirs.length) {
        return { state: 'live', evidence: 'ruflo-adr does not ship its own adr-reindex skill here' };
      }

      let purge;
      try {
        purge = upstreamPurgeAvailable();
      } catch (err) {
        return { state: 'unknown', evidence: `could not read the installed CLI: ${err.message}` };
      }

      if (!purge) {
        return {
          state: 'live',
          evidence: 'ruflo-adr ships its own adr-reindex, but the @claude-flow/cli installed here has no '
            + '`memory purge` (it shipped in 3.29.0). Theirs would exit 0 and report "purged" having purged nothing',
        };
      }

      return {
        state: 'superseded',
        evidence: 'ruflo-adr ships its own /adr-reindex AND the installed @claude-flow/cli registers '
          + '`memory purge`, so the replacement is present and runnable',
      };
    },
  },

  'verify-interface': {
    issue: 'https://github.com/stuinfla/ruvnet-brain/issues/12',
    replacement: "ruvnet-brain's own rewritten scripts/verify-interface.sh (v3.2.9+, commit bfc2d36) "
      + '— real JSON parsing (fixes #13\'s quote-truncation) and a command-position-anchored matcher '
      + 'with a reachable override (fixes #12)',
    // Only ever touches files carrying OUR marker (reconcile -> restoreFromBackup, guarded the same
    // way adr-reindex's restore() is), so it cannot destroy upstream's replacement.
    retire: () => {
      const remaining = readState().pluginTargets.filter((t) => t !== 'verify-interface');
      return reconcileComposed(remaining, ['verify-interface']);
    },
    check() {
      // Every copy this target could be patching: the marketplace checkout plus each cached version.
      // A leftover pre-fix cache dir Claude Code could still load must keep this LIVE, so ALL of them
      // must show the fix — not merely the currently-active one.
      const copies = activeVerifyInterfaceCopies();
      if (!copies.length) {
        return { state: 'unknown', evidence: 'no verify-interface.sh found under ruvnet-brain — cannot confirm the replacement is even present' };
      }

      // Functional, CODE-level anchors from the real fix — see VI_FIX_MARKERS below.

      const unfixed = [];
      for (const f of copies) {
        let src;
        try { src = fs.readFileSync(f, 'utf8'); } catch (err) { return { state: 'unknown', evidence: `could not read ${f}: ${err.message}` }; }
        if (!src.includes(VI_FIX_MARKERS.JSON_PARSE) || !src.includes(VI_FIX_MARKERS.OVERRIDE_ON_CMD)) unfixed.push(f);
      }

      if (unfixed.length) {
        return {
          state: 'live',
          evidence: `${unfixed.length}/${copies.length} installed copy(ies) still lack the fix (${unfixed.join(', ')}) `
            + '— our patch is still needed there',
        };
      }

      return {
        state: 'superseded',
        evidence: `all ${copies.length} installed copy(ies) carry the real fix: JSON-based payload parsing `
          + '(closes #13) and the override checked against the command string (closes #12)',
      };
    },
  },
};

/** Evaluate one target's supersession predicate. A target with no entry is never superseded. */
export function evaluate(target) {
  const entry = SUPERSEDED_BY[target];
  if (!entry) return { state: 'live', evidence: 'no supersession predicate' };
  try {
    return { ...entry.check(), issue: entry.issue, replacement: entry.replacement };
  } catch (err) {
    // A throwing predicate must never retire anything.
    return { state: 'unknown', evidence: `predicate threw: ${err.message}`, issue: entry.issue };
  }
}

/**
 * Which of the INSTALLED targets are superseded here, right now?
 * Pure: reads the world, mutates nothing. Both the read-only and the mutating paths call this — they
 * differ only in what they DO with the answer.
 */
export function supersededAmong(installed = []) {
  const out = [];
  for (const t of installed) {
    if (!SUPERSEDED_BY[t]) continue;
    const r = evaluate(t);
    if (r.state === 'superseded') out.push({ target: t, ...r });
  }
  return out;
}

/**
 * MUTATING. Retire every installed target whose replacement is present and runnable HERE.
 *
 * Called only from paths that already repair (`install`, `monitor run`, the SessionStart hook). The
 * read-only paths (`status`, `monitor check`) call supersededAmong() and merely SAY so — the standing
 * rule in this package is that read-only actions observe and mutating actions repair, and a `check`
 * that quietly uninstalls things would be the worst possible violation of it.
 *
 * Announces once. After this, the target is out of state.json and marked retired, so the SessionStart
 * hook stops re-applying it and the banner stops firing. That is the point: a warning that repeats every
 * session and never resolves is a warning people train themselves to scroll past, which is how the NEXT
 * real one gets missed.
 */
export function retireSuperseded(state) {
  const out = { retired: 0, log: [] };
  const installed = [...state.patchTargets, ...state.pluginTargets];

  for (const { target, evidence, issue, replacement } of supersededAmong(installed)) {
    try {
      const r = SUPERSEDED_BY[target].retire();
      for (const l of (r?.log ?? [])) out.log.push(`${target}: ${l}`);

      retireTargetInState(target, {
        reason: `superseded by ${replacement}`,
        evidence,
        issue,
      });

      out.retired++;
      out.log.push(
        `retired ${target} — ${evidence}. Removed ours and recorded it; the SessionStart hook will not `
        + `re-apply it. This is not a failure: upstream now does this job. (${issue})`,
      );
    } catch (err) {
      // A retirement that half-happened is worse than one that did not: the file could be gone while
      // state still lists the target, so the next tick would try to "repair" it. Say so, loudly, and
      // leave state alone — the target stays installed and the next tick re-applies it.
      out.log.push(`error retiring ${target}: ${err.message} — left it installed`);
    }
  }
  return out;
}
