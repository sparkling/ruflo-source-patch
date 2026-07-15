// SELF-UPDATE: the monitor tick pulls a newer TAG of this package, on its own.
//
// WHY IT HAS TO BE THE TICK, AND NOT THE SessionStart HOOK.
//
// I put this on the hook first, which was the same mistake the monitor was BUILT to fix: the hook fires
// only when a session STARTS, and people leave Claude Code running for days. A predicate that retires a
// patch upstream has fixed would then sit unread for a week, while a patch that upstream's restructuring
// has turned from redundant into actively WRONG keeps being re-applied every 5 minutes. Bounded staleness
// is the whole point of having a scheduler, and the update is exactly the thing that must be bounded.
//
// WHY TAGS, AND NEVER THE BRANCH.
//
// `github:sparkling/ruflo-source-patch` is a git REF, not a version: no semver, nothing immutable, and a
// force-push retroactively changes what everyone already installed. Auto-pulling that would be standing
// remote code execution from a moving target. A TAG is immutable: `v4.14.0` is the same bytes forever, a
// bad commit on `main` reaches nobody until it is tagged, and the version that ran is the version you can
// go back and read. That is the difference between an auto-update and a live wire.
//
// SAFETY RULES, all of them load-bearing:
//   - semver tags only (`v1.2.3`). Anything else is ignored, so a branch or a moving tag cannot be pulled.
//   - FORWARD only. Never downgrade, whatever the API says.
//   - the update runs at the END of a tick, never mid-apply — the child rewrites ~/.ruflo-source-patch/lib
//     while THIS process has its modules already in memory, so it lands on the NEXT tick. Same rule
//     healStableLib() already follows.
//   - a failed fetch, a failed install, no network: keep the version we have. A tool that breaks itself
//     trying to upgrade is worse than a stale one.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { STABLE_DIR } from './paths.mjs';
import { syncedFrom } from './stable.mjs';
import { isAllMode } from './state.mjs';

const REPO = 'sparkling/ruflo-source-patch';
const TAGS_URL = `https://api.github.com/repos/${REPO}/tags`;
const TIMEOUT_MS = 4000;
const INSTALL_TIMEOUT_MS = 180_000;

// One place to turn it off: the test suite (which must never reach the network or npx), and anyone who
// wants to pin their install.
export const disabled = () => process.env.RSP_NO_SELF_UPDATE === '1';

/** Numeric compare. `4.10.0` is newer than `4.9.9`; a string compare says the opposite. */
export function isNewer(a, b) {
  if (!a || !b) return false;
  const p = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const x = p(a);
  const y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) > (y[i] || 0)) return true;
    if ((x[i] || 0) < (y[i] || 0)) return false;
  }
  return false;
}

/** The version of the package the stable copy was synced FROM — i.e. what is actually running. */
export function currentVersion() {
  const roots = [syncedFrom(), path.dirname(path.dirname(new URL('.', import.meta.url).pathname))];
  for (const root of roots) {
    if (!root) continue;
    try {
      const v = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
      if (typeof v === 'string') return v;
    } catch { /* try the next */ }
  }
  return null;
}

/**
 * The newest SEMVER TAG published on the repo, or null.
 *
 * Only `v1.2.3` shapes are considered. A tag that is not immutable-by-convention (a branch name, a
 * moving `latest`) is not a release, and pulling one would reintroduce exactly the moving target that
 * tags exist to avoid.
 */
export async function latestTag({ fetchJson } = {}) {
  try {
    const get = fetchJson || defaultFetchJson;
    const tags = await get(TAGS_URL);
    if (!Array.isArray(tags)) return null;
    const semver = tags
      .map((t) => t && typeof t.name === 'string' ? t.name : null)
      .filter((n) => n && /^v?\d+\.\d+\.\d+$/.test(n));
    if (!semver.length) return null;
    return semver.reduce((best, n) => (isNewer(n, best) ? n : best));
  } catch {
    return null;                       // offline, GitHub down, rate-limited: keep what we have
  }
}

async function defaultFetchJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * If a newer tag exists, install it. Returns { updated, from, to, error }.
 *
 * The install is delegated to the package itself (`npx github:REPO#TAG <sub> install`), because that is
 * the one code path that already knows how to lay itself down: it re-syncs the stable copy, re-registers
 * the hook and the schedule, and self-heals a moved path. Re-implementing that here would be a second
 * installer to keep in step with the first.
 *
 * The subcommand is the whole of the auto-adoption mechanism (ADR-019). A machine in ALL MODE
 * (`all install`) runs `all install`, so a target INTRODUCED in the newer tag is recorded into
 * state.json and applied on the spot — no manual step, which is the framework's whole premise. A machine
 * that cherry-picked targets runs `monitor install`, exactly as before: its recorded set is left alone
 * and nothing it didn't ask for is installed. The child runs the NEW tag's code, so it knows the new set.
 */
export async function selfUpdate({ fetchJson, run } = {}) {
  if (disabled()) return { updated: false };

  const current = currentVersion();
  if (!current) return { updated: false };

  const tag = await latestTag({ fetchJson });
  if (!tag) return { updated: false };
  if (!isNewer(tag, current)) return { updated: false };   // FORWARD only

  // ALL MODE adopts new targets by re-running `all install`; a curated install keeps its exact set.
  const sub = isAllMode() ? ['all', 'install'] : ['monitor', 'install'];
  try {
    const exec = run || defaultRun;
    exec(`github:${REPO}#${tag}`, sub);
    return { updated: true, from: current, to: tag, mode: sub[0] };
  } catch (err) {
    // Keep the version we have. A half-applied upgrade is the one outcome worse than a stale one.
    return { updated: false, from: current, to: tag, error: err.message };
  }
}

function defaultRun(spec, sub = ['monitor', 'install']) {
  execFileSync('npx', ['-y', spec, ...sub], {
    timeout: INSTALL_TIMEOUT_MS,
    stdio: 'ignore',
    // Do NOT let the child self-update too: it would recurse on a bad tag.
    env: { ...process.env, RSP_NO_SELF_UPDATE: '1' },
  });
}

export { STABLE_DIR };
