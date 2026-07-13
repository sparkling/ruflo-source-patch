// Is the code we RUN the code we INSTALLED?
//
// ~/.ruflo-source-patch/lib is not a cache — it is the executable. The SessionStart hook and
// the launchd/cron job both invoke modules from THERE, never from the npm package, and that is
// deliberate (paths.mjs: the hook must not depend on the volatile npx cache). But it was only
// ever written by syncStableCopy(), which only runs from an `install` action. Nothing else
// refreshed it, and nothing checked it.
//
// So: `npm i -g @sparkleideas/ruflo-source-patch@NEXT`, where NEXT adds an entry for an anchor
// upstream re-worded — the 3.26.0 story patch-library.mjs tells at length. The user does not
// re-run `<target> install`, because nothing tells them to. The hook and the monitor keep
// executing the OLD lib forever, applying the OLD entry set. The new entry never lands. And
// every reporting surface is also the old code, so the whole thing is silent — the package
// upgraded, and nothing it does upgraded with it.
//
// That is the script-target staleness bug one level up, with the blast radius of the tool
// itself. Same fix as there: compare the bytes, and never infer health from mere existence.
//
// WHICH SOURCE IS THE TRUTH — the part that is easy to get wrong.
//
// The obvious answer, "diff against the globally-installed package", is WRONG, and wrong in a
// way that bites exactly the person maintaining this. Develop from a clone (`npm link`, or just
// `node bin/cli.mjs`), and the global package is OLDER than your working tree. The CLI would
// sync your clone into the stable copy; the monitor would then see it differ from the global
// package and dutifully "heal" it BACKWARD to the stale release — the two writers fighting each
// other on a timer, each certain it was repairing the other's damage. (The fuzz suite caught
// precisely this, one commit into believing otherwise.)
//
// So the invariant is provenance, not location: the stable copy must match THE SOURCE IT WAS
// SYNCED FROM. We record that source at sync time. A global upgrade rewrites the bytes at the
// same recorded path -> drift -> heal. A clone stays pinned to the clone. Both correct, one rule.

import fs from 'node:fs';
import path from 'node:path';
import { STABLE_DIR, STABLE_LIB } from './paths.mjs';

// Where the stable copy came from. Without this the question "is it stale?" has no answer —
// only "does it differ from some arbitrary other copy?", which is how you get the fight above.
const SOURCE_MANIFEST = path.join(STABLE_DIR, 'lib-source.json');

/**
 * EVERY file under a lib root, as root-relative paths. Not just the .mjs.
 *
 * It used to be .mjs only, and that was a bug with a very short fuse: the adr-reindex patcher reads
 * `skill.md` — a data file it ships next to its code — and the monitor RUNS FROM THE STABLE COPY, where
 * that file had never been placed. So the patcher threw ENOENT on every tick.
 *
 * It failed loudly, immediately, and told a human on the next prompt — which is the whole point of the
 * error-path work, and the first time it caught something I broke rather than something upstream did.
 * But the lesson is the rule: the stable copy is a MIRROR of lib/, and a mirror that silently drops
 * every file type it didn't think of is not a mirror. Copy everything; the tree is a few hundred KB.
 */
function filesUnder(root) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const child = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) walk(child);
      else out.push(child);
    }
  };
  walk('');
  return out;
}

/** The lib root the stable copy was last synced from, or null if we have never recorded one. */
export function syncedFrom() {
  try {
    const { root } = JSON.parse(fs.readFileSync(SOURCE_MANIFEST, 'utf8'));
    return root && fs.existsSync(root) ? root : null;
  } catch { return null; }
}

/**
 * Mirror every .mjs under `src` into the stable lib, preserving the tree shape, and record
 * where they came from.
 *
 * ONE definition of what the stable copy contains, used by both writers — syncStableCopy() (the
 * CLI, copying from the running package) and healStableLib() (the monitor, re-copying from the
 * recorded source). They used to disagree: syncStableCopy() copied three NAMED subtrees, so
 * lib/dual was simply absent from the stable copy, and a freshness check that walked the whole
 * package would have called that absence permanent drift. Two definitions of "the stable copy"
 * is how you get a check that can never come back clean.
 *
 * Shape-preserving, not flattened: the patchers import across directories (`../cwd/paths.mjs`),
 * and a flat copy breaks those specifiers inside the hook, where the failure is invisible.
 */
export function syncLibFrom(src) {
  let copied = 0;
  for (const rel of filesUnder(src)) {
    const from = path.join(src, rel);
    const to = path.join(STABLE_LIB, rel);
    try {
      if (fs.existsSync(to) && fs.readFileSync(from).equals(fs.readFileSync(to))) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied++;
    } catch { /* best-effort; the drift report still names what didn't land */ }
  }
  try {
    fs.mkdirSync(STABLE_DIR, { recursive: true });
    fs.writeFileSync(SOURCE_MANIFEST, `${JSON.stringify({ root: src, at: new Date().toISOString() }, null, 2)}\n`);
  } catch { /* the copy is what matters; a missing manifest degrades to "unknown", not to a lie */ }
  return copied;
}

/**
 * Which modules in the stable copy differ from the source they were synced from?
 *
 * Returns null when there is nothing authoritative to compare against — no manifest yet, or the
 * recorded source is gone (an uninstalled global, a deleted clone). The caller must treat null
 * as UNKNOWN and say so, not as healthy and say nothing. From the outside those look the same;
 * only one of them is honest.
 */
export function stableLibDrift() {
  const src = syncedFrom();
  if (!src) return null;
  if (!fs.existsSync(STABLE_LIB)) return null; // nothing installed yet — not drift

  const stale = [];
  for (const rel of filesUnder(src)) {
    const a = path.join(src, rel);
    const b = path.join(STABLE_LIB, rel);
    try {
      if (!fs.existsSync(b) || !fs.readFileSync(a).equals(fs.readFileSync(b))) stale.push(rel);
    } catch { stale.push(rel); } // unreadable is not the same as identical
  }
  return stale;
}

/**
 * Remove modules in the stable copy that the package does not ship.
 *
 * The stable copy is a MIRROR of the package's lib tree, so the rule is exactly that: anything not
 * in the package does not belong. Which subsumes, precisely and without heuristics, the two things
 * that used to be handled by guesswork or not at all:
 *
 *   - the legacy FLAT copy (~/.ruflo-source-patch/lib/*.mjs, from before the tree was
 *     shape-preserving). The old prune deleted a root module iff a file of the SAME BASENAME
 *     existed under cwd/ — indirect, and a trap: add a legitimate lib/state.mjs alongside the
 *     existing lib/cwd/state.mjs and the root one is silently deleted from the stable copy. The
 *     hook then fails to import it, inside the hook, where the failure is invisible.
 *   - a module upstream DELETES. Nothing reaped it, so it lingered in the stable copy forever,
 *     importable and stale.
 *
 * Never prunes from an empty source list — a source we failed to read must not be mistaken for a
 * package that ships nothing, which would empty the stable copy and take the hook down with it.
 */
export function pruneStaleModules(src) {
  const shipped = new Set(filesUnder(src));
  if (!shipped.size) return [];
  const removed = [];
  for (const rel of filesUnder(STABLE_LIB)) {
    if (shipped.has(rel)) continue;
    try { fs.rmSync(path.join(STABLE_LIB, rel), { force: true }); removed.push(rel); } catch { /* ignore */ }
  }
  return removed;
}

/**
 * Re-copy from the recorded source. That source is the truth by definition — it is what the user
 * installed from, whether that was a global package or a working tree.
 *
 * The CURRENT process keeps running the modules it already imported; this takes effect on the
 * next tick / next session. That one tick of latency is the whole cost of self-healing, and it
 * beats the alternative: waiting for a human to run a command nothing ever told them to run.
 */
export function healStableLib() {
  const src = syncedFrom();
  if (!src) return { healed: 0 };
  return { healed: syncLibFrom(src) };
}
