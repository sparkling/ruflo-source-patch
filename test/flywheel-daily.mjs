// RuvNet Brain #53: the flywheel opt-in advisory is claimed by the hook once
// per local day/project. Exercise the composed patch, real POSIX shell runtime,
// concurrent claims, fail-silent behavior, CLI lifecycle, and byte restoration.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const input = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'flywheel-daily-'));
fs.mkdirSync(input, { recursive: true });
const SANDBOX = fs.realpathSync(input);
const BRAIN_HOME = path.join(SANDBOX, '.cache', 'ruvnet-brain');
process.env.RUFLO_SOURCE_PATCH_HOME = SANDBOX;
process.env.RSP_RUVNET_BRAIN_HOME = BRAIN_HOME;
process.env.RSP_NO_LAUNCHCTL = '1';
process.env.RSP_NO_SELF_UPDATE = '1';

const {
  FLYWHEEL_START,
  FLYWHEEL_CONDITION,
  PATCHED_CONDITION,
  PATCH_MARKER,
  patchSource,
} = await import('../lib/flywheel-daily/patcher.mjs');
const { applyComposed, reconcile, statusComposed } = await import('../lib/plugin-compose.mjs');

let fail = 0;
const check = (description, condition) => {
  console.log(`${condition ? '✓' : '✘'} ${description}`);
  if (!condition) fail = 1;
};

const FLYWHEEL_TEXT = '[fixture flywheel advisory]';
const GROUNDING_TEXT = '[fixture per-prompt grounding]';
const VENDOR = `#!/bin/sh
set +e
RUFLO_STATE=yes
# Self-learning flywheel
${FLYWHEEL_START}
if [ "$FLYWHEEL" = "off" ] && grep -qs 'RUFLO_HARNESS_LOOP' .claude/settings.json .claude/settings.local.json 2>/dev/null; then
  FLYWHEEL=on
fi
${FLYWHEEL_CONDITION}
  printf '%s\\n' '${FLYWHEEL_TEXT}'
fi
printf '%s\\n' '${GROUNDING_TEXT}'
`;

const copies = [
  path.join(SANDBOX, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain', 'plugin', 'scripts', 'ground-ruvnet.sh'),
  path.join(SANDBOX, '.claude', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain', '3.9.99-dev', 'scripts', 'ground-ruvnet.sh'),
  path.join(SANDBOX, '.codex', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain', '3.9.99-dev', 'scripts', 'ground-ruvnet.sh'),
  path.join(BRAIN_HOME, 'versions', '3.9.99-dev', 'scripts', 'ground-ruvnet.sh'),
];
for (const file of copies) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, VENDOR, { mode: 0o755 });
}

const first = applyComposed(['flywheel-daily']);
check('FD1 every Claude, Codex, marketplace, and immutable Brain copy is patched',
  first.patched === copies.length
    && copies.every((file) => fs.readFileSync(file, 'utf8').includes(PATCH_MARKER))
    && copies.every((file) => fs.readFileSync(file, 'utf8').includes(PATCHED_CONDITION)));
check('FD2 every vendor copy has exactly one pristine backup',
  copies.every((file) => fs.readFileSync(`${file}.rsp-backup`, 'utf8') === VENDOR));
const second = applyComposed(['flywheel-daily']);
check('FD3 re-apply is idempotent and status reports every copy',
  second.patched === 0
    && second.unchanged === copies.length
    && statusComposed()['flywheel-daily'].patched === copies.length);

const fakeBin = path.join(SANDBOX, 'bin');
fs.mkdirSync(fakeBin, { recursive: true });
const fakeDate = path.join(fakeBin, 'date');
fs.writeFileSync(fakeDate, `#!/bin/sh
if [ "\${1:-}" = "+%Y-%m-%d" ]; then
  printf '%s\\n' "\${RSP_FAKE_DAY:-1970-01-01}"
else
  /bin/date "$@"
fi
`, { mode: 0o755 });

function project(name) {
  const dir = path.join(SANDBOX, 'projects', name);
  fs.mkdirSync(path.join(dir, '.claude-flow'), { recursive: true });
  return dir;
}

const hookEnv = (cwd, day, extra = {}) => ({
  ...process.env,
  HOME: SANDBOX,
  PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
  RUVNET_BRAIN_HOME: BRAIN_HOME,
  RSP_FAKE_DAY: day,
  CLAUDE_PROJECT_DIR: cwd,
  RUFLO_HARNESS_LOOP: '',
  ...extra,
});
const runHook = (cwd, day, extra) => spawnSync('sh', [copies[0]], {
  cwd,
  env: hookEnv(cwd, day, extra),
  encoding: 'utf8',
});
const count = (text, marker) => text.split(marker).length - 1;

const alpha = project('alpha');
const alphaFirst = runHook(alpha, '2026-07-28');
const alphaSecond = runHook(alpha, '2026-07-28');
check('FD4 same project/day emits the advisory exactly once',
  alphaFirst.status === 0
    && count(alphaFirst.stdout, FLYWHEEL_TEXT) === 1
    && count(alphaSecond.stdout, FLYWHEEL_TEXT) === 0);
check('FD5 unrelated per-prompt output is not rate-limited',
  count(alphaFirst.stdout, GROUNDING_TEXT) === 1
    && count(alphaSecond.stdout, GROUNDING_TEXT) === 1);
check('FD6 the next local calendar day can emit again',
  count(runHook(alpha, '2026-07-29').stdout, FLYWHEEL_TEXT) === 1);

const beta = project('beta');
check('FD7 projects have independent claims',
  count(runHook(beta, '2026-07-28').stdout, FLYWHEEL_TEXT) === 1);
check('FD8 an enabled flywheel never emits the opt-in advisory',
  count(runHook(beta, '2026-07-30', { RUFLO_HARNESS_LOOP: '1' }).stdout, FLYWHEEL_TEXT) === 0);

const concurrentProject = project('concurrent');
const concurrent = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve) => {
  const child = spawn('sh', [copies[0]], {
    cwd: concurrentProject,
    env: hookEnv(concurrentProject, '2026-07-31'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.on('close', (status) => resolve({ status, stdout }));
})));
check('FD9 concurrent first prompts atomically produce one advisory total',
  concurrent.every((result) => result.status === 0)
    && concurrent.reduce((sum, result) => sum + count(result.stdout, FLYWHEEL_TEXT), 0) === 1);

const blockedHome = path.join(SANDBOX, 'not-a-directory');
fs.writeFileSync(blockedHome, 'file');
const silent = runHook(project('claim-failure'), '2026-08-01', { RUVNET_BRAIN_HOME: blockedHome });
check('FD10 claim-state failure is silent and never breaks the prompt',
  silent.status === 0
    && count(silent.stdout, FLYWHEEL_TEXT) === 0
    && count(silent.stdout, GROUNDING_TEXT) === 1
    && silent.stderr === '');

const partialFile = path.join(
  SANDBOX, '.claude', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain',
  'partial', 'scripts', 'ground-ruvnet.sh',
);
const PARTIAL = `#!/bin/sh
# Self-learning flywheel
${FLYWHEEL_START}
`;
fs.mkdirSync(path.dirname(partialFile), { recursive: true });
fs.writeFileSync(partialFile, PARTIAL);
const partialTransform = patchSource(PARTIAL);
const partialApply = applyComposed(['flywheel-daily']);
check('FD11 one missing anchor makes the target incomplete and writes no partial edit',
  partialTransform.applied.length === 1
    && partialTransform.missing.length === 1
    && partialApply.incomplete === 1
    && fs.readFileSync(partialFile, 'utf8') === PARTIAL);

const restored = reconcile([], ['flywheel-daily']);
check('FD12 uninstall restores every patched file byte-for-byte',
  restored.errors === 0
    && copies.every((file) => fs.readFileSync(file, 'utf8') === VENDOR)
    && copies.every((file) => !fs.existsSync(`${file}.rsp-backup`)));

// Remove the deliberately incompatible copy before exercising the public CLI.
fs.rmSync(path.dirname(path.dirname(partialFile)), { recursive: true, force: true });
fs.writeFileSync(path.join(SANDBOX, '.claude', 'settings.json'), '{}\n');
const cli = path.resolve('bin/cli.mjs');
const cliEnv = {
  ...process.env,
  RUFLO_SOURCE_PATCH_HOME: SANDBOX,
  RSP_RUVNET_BRAIN_HOME: BRAIN_HOME,
  RSP_NO_LAUNCHCTL: '1',
  RSP_NO_SELF_UPDATE: '1',
};
const install = spawnSync(process.execPath, [cli, 'flywheel-daily', 'install'], {
  env: cliEnv, encoding: 'utf8',
});
const status = spawnSync(process.execPath, [cli, 'flywheel-daily', 'status'], {
  env: cliEnv, encoding: 'utf8',
});
const uninstall = spawnSync(process.execPath, [cli, 'flywheel-daily', 'uninstall'], {
  env: cliEnv, encoding: 'utf8',
});
const cliLifecycleOk = install.status === 0
    && status.status === 0
    && status.stdout.includes(`${copies.length}/${copies.length} file(s) patched`)
    && status.stdout.includes('tracked')
    && uninstall.status === 0
    && copies.every((file) => fs.readFileSync(file, 'utf8') === VENDOR);
check('FD13 public install/status/uninstall lifecycle tracks and restores the target', cliLifecycleOk);
if (!cliLifecycleOk) {
  console.log(JSON.stringify({
    install: { status: install.status, stdout: install.stdout, stderr: install.stderr },
    status: { status: status.status, stdout: status.stdout, stderr: status.stderr },
    uninstall: { status: uninstall.status, stdout: uninstall.stdout, stderr: uninstall.stderr },
  }, null, 2));
}

const UPSTREAM_CONDITION = 'if [ "$RUFLO_STATE" = "yes" ] && [ "$FLYWHEEL" = "off" ] && claim_flywheel_day; then';
const UPSTREAM = `#!/bin/sh
set +e
RUFLO_STATE=yes
# Self-learning flywheel
${FLYWHEEL_START}
claim_flywheel_day() {
  _fly_project="\${CLAUDE_PROJECT_DIR:-$PWD}"
  [ -d "$_fly_project" ] || return 1
  _fly_project=$(cd "$_fly_project" 2>/dev/null && pwd -P) || return 1
  _fly_sig=$(printf '%s' "$_fly_project" | cksum 2>/dev/null) || return 1
  set -- $_fly_sig
  [ -n "\${1:-}" ] && [ -n "\${2:-}" ] || return 1
  _fly_day="\${RUVNET_FLYWHEEL_DATE:-$(date +%Y-%m-%d 2>/dev/null)}"
  [ -n "$_fly_day" ] || return 1
  _fly_root="\${XDG_CACHE_HOME:-$HOME/.cache}/ruvnet-brain/advisories/flywheel"
  (
    umask 077
    mkdir -p "$_fly_root" 2>/dev/null &&
      mkdir "$_fly_root/$1-$2-$_fly_day.claim" 2>/dev/null
  )
}
${UPSTREAM_CONDITION}
  printf '%s\\n' '[RuvNet Brain — the self-learning flywheel is available here and switched OFF]'
fi
`;

fs.writeFileSync(copies[0], UPSTREAM, { mode: 0o755 });
const mixedRollout = applyComposed(['flywheel-daily']);
check('FD14 mixed rollout leaves upstream-fixed bytes untouched while patching old active copies',
  mixedRollout.incomplete === 0
    && mixedRollout.patched === copies.length - 1
    && fs.readFileSync(copies[0], 'utf8') === UPSTREAM);
reconcile([], ['flywheel-daily']);

// The replacement is tested through the same active-copy resolution as production: marketplace,
// Claude cache, Codex cache, and immutable Brain generation.
for (const file of copies) {
  fs.writeFileSync(file, UPSTREAM, { mode: 0o755 });
}
const claudeManifest = path.join(SANDBOX, '.claude', 'plugins', 'installed_plugins.json');
fs.mkdirSync(path.dirname(claudeManifest), { recursive: true });
fs.writeFileSync(claudeManifest, JSON.stringify({
  plugins: {
    'ruvnet-brain@ruvnet-brain': [{
      installPath: path.join(SANDBOX, '.claude', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain', '3.9.99-dev'),
    }],
  },
}));
fs.writeFileSync(path.join(BRAIN_HOME, 'active.json'), JSON.stringify({
  version: '3.9.99-dev',
  codeRoot: 'versions/3.9.99-dev',
}));

const {
  FLYWHEEL_FIX_MARKERS,
  probeFlywheelBehavior,
} = await import('../lib/flywheel-daily/supersede.mjs');
const { evaluate, retireSuperseded } = await import('../lib/supersede.mjs');
const nativeProbe = probeFlywheelBehavior(UPSTREAM);
const nativeVerdict = evaluate('flywheel-daily');
check('FD15 upstream #53 source independently passes the behavioral retirement proof',
  FLYWHEEL_FIX_MARKERS.every((marker) => UPSTREAM.includes(marker))
    && nativeProbe.state === 'proven'
    && nativeVerdict.state === 'superseded');
if (nativeProbe.state !== 'proven' || nativeVerdict.state !== 'superseded') {
  console.log(JSON.stringify({ nativeProbe, nativeVerdict }, null, 2));
}

// Keep every source marker in a comment while removing the executable claim. A marker-only
// predicate would retire; the real lifecycle probe must see the repeated advisory and refuse.
const markerPreservingRegression = UPSTREAM.replace(
  UPSTREAM_CONDITION,
  `# ${UPSTREAM_CONDITION}
${FLYWHEEL_CONDITION}`,
);
fs.writeFileSync(copies[0], markerPreservingRegression, { mode: 0o755 });
check('FD16 marker-preserving cadence regression is not accepted as superseded',
  FLYWHEEL_FIX_MARKERS.every((marker) => markerPreservingRegression.includes(marker))
    && evaluate('flywheel-daily').state !== 'superseded');
fs.writeFileSync(copies[0], UPSTREAM, { mode: 0o755 });

const { writeState, readState } = await import('../lib/cwd/state.mjs');
writeState({ patchTargets: [], pluginTargets: ['flywheel-daily'], retired: {} });
const retirement = retireSuperseded(readState());
const retiredState = readState();
check('FD17 proven upstream replacement retires the target terminally',
  retirement.retired === 1
    && !retiredState.pluginTargets.includes('flywheel-daily')
    && retiredState.retired['flywheel-daily']?.issue === 'https://github.com/stuinfla/ruvnet-brain/issues/53'
    && copies.every((file) => !fs.readFileSync(file, 'utf8').includes(PATCH_MARKER)));
check('FD18 retirement preserves and re-proves the upstream behavior',
  copies.every((file) => fs.readFileSync(file, 'utf8') === UPSTREAM)
    && evaluate('flywheel-daily').state === 'superseded');

process.exit(fail);
