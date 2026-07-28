// Local retirement proof for the RuvNet Brain #53 flywheel advisory patch.
//
// A closed issue is not enough. The active hook bytes must independently:
//   - canonicalize the project root;
//   - claim one local-calendar-day slot with atomic mkdir;
//   - keep the opt-in disabled path consent-based; and
//   - behave correctly for repeats, concurrent calls, different days/projects,
//     and an already-enabled flywheel.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { descriptor, discoverAll, PATCH_MARKER } from './patcher.mjs';
import { reconcile as reconcileComposed } from '../plugin-compose.mjs';
import { readState } from '../cwd/state.mjs';
import { HOME_BASE } from '../cwd/paths.mjs';

const MARKETPLACE = 'ruvnet-brain';
const SCRIPT = ['scripts', 'ground-ruvnet.sh'];
const BANNER = '[RuvNet Brain — the self-learning flywheel is available here and switched OFF]';

// Functional code anchors from upstream commit d447802. Our own helper uses different names and
// paths, so it cannot satisfy these markers and masquerade as the replacement.
export const FLYWHEEL_FIX_MARKERS = [
  'claim_flywheel_day() {',
  '_fly_project=$(cd "$_fly_project" 2>/dev/null && pwd -P) || return 1',
  '_fly_day="${RUVNET_FLYWHEEL_DATE:-$(date +%Y-%m-%d 2>/dev/null)}"',
  'mkdir "$_fly_root/$1-$2-$_fly_day.claim" 2>/dev/null',
  '&& claim_flywheel_day; then',
];

function activeCopies() {
  const all = discoverAll();
  const discovered = new Map(all.map((file) => [path.resolve(file), file]));
  const selected = new Set();
  const marketplace = process.env.RSP_RUVNET_BRAIN_MARKETPLACE
    || path.join(HOME_BASE, '.claude', 'plugins', 'marketplaces', MARKETPLACE);
  const brainHome = process.env.RSP_RUVNET_BRAIN_HOME
    || path.join(HOME_BASE, '.cache', 'ruvnet-brain');

  const addExpected = (label, file) => {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) return null;
    const bounded = discovered.get(resolved);
    if (!bounded) return `${label} is outside the flywheel patcher's discovered Brain roots: ${resolved}`;
    selected.add(bounded);
    return null;
  };

  let error = addExpected('marketplace hook', path.join(marketplace, 'plugin', ...SCRIPT));
  if (error) return { copies: [], error };

  const installedManifest = path.join(HOME_BASE, '.claude', 'plugins', 'installed_plugins.json');
  if (fs.existsSync(installedManifest)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(installedManifest, 'utf8'));
      const entries = manifest?.plugins?.[`${MARKETPLACE}@${MARKETPLACE}`];
      if (entries !== undefined && (!Array.isArray(entries) || !entries.length)) {
        return { copies: [], error: 'installed_plugins.json has an invalid active ruvnet-brain entry' };
      }
      for (const entry of entries || []) {
        if (typeof entry?.installPath !== 'string' || !path.isAbsolute(entry.installPath)) {
          return { copies: [], error: 'installed_plugins.json does not name an absolute active ruvnet-brain installPath' };
        }
        error = addExpected('Claude active hook', path.join(entry.installPath, ...SCRIPT));
        if (error) return { copies: [], error };
      }
    } catch (err) {
      return { copies: [], error: `could not resolve Claude's active Brain hook: ${err.message}` };
    }
  }

  const activeFile = path.join(brainHome, 'active.json');
  let activeVersion = null;
  if (fs.existsSync(activeFile)) {
    try {
      const active = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
      if (typeof active?.codeRoot !== 'string' || !active.codeRoot
          || typeof active?.version !== 'string' || !active.version) {
        return { copies: [], error: 'Brain active.json does not name a codeRoot and version' };
      }
      const codeRoot = path.resolve(brainHome, active.codeRoot);
      const boundedRoot = `${path.resolve(brainHome)}${path.sep}`;
      if (!codeRoot.startsWith(boundedRoot)) {
        return { copies: [], error: `Brain active.json codeRoot escapes the Brain home: ${codeRoot}` };
      }
      activeVersion = active.version;
      error = addExpected('immutable active hook', path.join(codeRoot, ...SCRIPT));
      if (error) return { copies: [], error };
    } catch (err) {
      return { copies: [], error: `could not resolve Brain active.json: ${err.message}` };
    }
  }

  // Codex installs the same plugin generation into its own cache. active.json supplies the version
  // used by Brain's stable spine, avoiding a Codex CLI subprocess on every monitor predicate.
  if (activeVersion) {
    error = addExpected(
      'Codex active hook',
      path.join(HOME_BASE, '.codex', 'plugins', 'cache', MARKETPLACE, MARKETPLACE, activeVersion, ...SCRIPT),
    );
    if (error) return { copies: [], error };
  }

  if (!selected.size) {
    return { copies: [], error: 'no active ground-ruvnet.sh copy could be identified' };
  }
  return { copies: [...selected] };
}

function upstreamSource(file) {
  let live;
  try {
    live = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { error: `could not read ${file}: ${err.message}` };
  }
  if (!descriptor.isPatched(live)) return { source: live };

  const backup = `${file}.rsp-backup`;
  if (!fs.existsSync(backup)) {
    return { error: `${file} carries the #53 patch but has no pristine backup` };
  }
  try {
    const source = fs.readFileSync(backup, 'utf8');
    if (!source || source.includes(PATCH_MARKER) || descriptor.isPatched(source)) {
      return { error: `${backup} is not an independent upstream source` };
    }
    return { source };
  } catch (err) {
    return { error: `could not read ${backup}: ${err.message}` };
  }
}

const countBanner = (text) => text.split(BANNER).length - 1;

// Exported for mutation tests: markers and valid shell syntax are necessary, but executable cadence
// is the proof. This drives the real hook body through its stdin/stdout lifecycle interface.
export function probeFlywheelBehavior(source) {
  let root;
  try {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-flywheel-proof-')));
    const script = path.join(root, 'ground-ruvnet.sh');
    const projectA = path.join(root, 'project-a');
    const projectB = path.join(root, 'project-b');
    fs.mkdirSync(path.join(projectA, '.claude-flow'), { recursive: true });
    fs.mkdirSync(path.join(projectB, '.claude-flow'), { recursive: true });
    fs.mkdirSync(path.join(root, 'home'), { recursive: true });
    fs.writeFileSync(script, source, { mode: 0o755 });

    const syntax = spawnSync('bash', ['-n', script], { encoding: 'utf8', timeout: 5000 });
    if (syntax.error || syntax.status !== 0) {
      return { state: 'live', evidence: `upstream hook does not pass bash -n (${syntax.error?.message || `exit ${syntax.status}`})` };
    }

    const envFor = (project, day, extra = {}) => {
      const env = {};
      for (const key of ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'ComSpec', 'PATHEXT']) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
      }
      return {
        ...env,
        HOME: path.join(root, 'home'),
        XDG_CACHE_HOME: path.join(root, 'cache'),
        CLAUDE_PROJECT_DIR: project,
        CLAUDE_PLUGIN_ROOT: '',
        RUVNET_BRAIN_METER: '0',
        RUVNET_FLYWHEEL_DATE: day,
        RUFLO_HARNESS_LOOP: '',
        ...extra,
      };
    };
    const run = (project, day, extra) => spawnSync('bash', [script], {
      cwd: project,
      env: envFor(project, day, extra),
      input: '{"prompt":"hello"}\n',
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const first = run(projectA, '2026-07-28');
    const repeat = run(projectA, '2026-07-28');
    const nextDay = run(projectA, '2026-07-29');
    const otherProject = run(projectB, '2026-07-28');
    const enabled = run(projectB, '2026-07-29', { RUFLO_HARNESS_LOOP: '1' });
    const serial = [first, repeat, nextDay, otherProject, enabled];
    if (serial.some((result) => result.error || result.status !== 0)) {
      const failed = serial.find((result) => result.error || result.status !== 0);
      return { state: 'unknown', evidence: `could not execute the upstream hook (${failed.error?.message || `exit ${failed.status}`})` };
    }

    const concurrent = spawnSync('bash', [
      '-c',
      'for _i in 1 2 3 4 5 6 7 8; do printf \'%s\\n\' \'{"prompt":"hello"}\' | bash "$1" & done; wait',
      'flywheel-proof',
      script,
    ], {
      cwd: projectB,
      env: envFor(projectB, '2026-07-30'),
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (concurrent.error || concurrent.status !== 0) {
      return { state: 'unknown', evidence: `could not execute the concurrent hook proof (${concurrent.error?.message || `exit ${concurrent.status}`})` };
    }

    const proven = countBanner(first.stdout) === 1
      && countBanner(repeat.stdout) === 0
      && countBanner(nextDay.stdout) === 1
      && countBanner(otherProject.stdout) === 1
      && countBanner(enabled.stdout) === 0
      && countBanner(concurrent.stdout) === 1;
    return proven
      ? { state: 'proven' }
      : {
          state: 'live',
          evidence: 'behavior proof failed: expected same-day 1/0, next-day 1, other-project 1, enabled 0, concurrent-eight 1',
        };
  } catch (err) {
    return { state: 'unknown', evidence: `could not set up the flywheel behavior proof: ${err.message}` };
  } finally {
    if (root) {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort probe cleanup */ }
    }
  }
}

function check() {
  const selected = activeCopies();
  if (selected.error) return { state: 'unknown', evidence: selected.error };

  const uniqueSources = new Map();
  for (const file of selected.copies) {
    const candidate = upstreamSource(file);
    if (candidate.error) return { state: 'unknown', evidence: candidate.error };
    if (!FLYWHEEL_FIX_MARKERS.every((marker) => candidate.source.includes(marker))) {
      return { state: 'live', evidence: `${file} does not carry upstream's independent #53 cadence implementation` };
    }
    if (!uniqueSources.has(candidate.source)) uniqueSources.set(candidate.source, []);
    uniqueSources.get(candidate.source).push(file);
  }

  for (const source of uniqueSources.keys()) {
    const behavior = probeFlywheelBehavior(source);
    if (behavior.state === 'unknown') return behavior;
    if (behavior.state !== 'proven') return { state: 'live', evidence: behavior.evidence };
  }

  return {
    state: 'superseded',
    evidence: `all ${selected.copies.length} active Brain hook copy(ies) carry upstream's atomic per-project/day claim and pass the real repeat/day/project/enabled/concurrency proof`,
  };
}

function postRetireCheck() {
  const selected = activeCopies();
  if (selected.error) return { ok: false, evidence: selected.error };
  for (const file of selected.copies) {
    try {
      if (descriptor.isPatched(fs.readFileSync(file, 'utf8'))) {
        return { ok: false, evidence: `our #53 edit is still present in ${file}` };
      }
    } catch (err) {
      return { ok: false, evidence: `could not read ${file} after retirement: ${err.message}` };
    }
  }
  return { ok: true };
}

export const flywheelDailySupersession = {
  issue: 'https://github.com/stuinfla/ruvnet-brain/issues/53',
  replacement: "ruvnet-brain's own atomic per-project/local-day claim in scripts/ground-ruvnet.sh (commit d447802)",
  retire: () => {
    const remaining = readState().pluginTargets.filter((target) => target !== 'flywheel-daily');
    return reconcileComposed(remaining, ['flywheel-daily']);
  },
  check,
  postRetireCheck,
};
