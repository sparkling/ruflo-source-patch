// Behavioural tests for `design-wall` (ruvnet-brain's design-grade commit gate, unscoped to any
// repo — ruvnet-brain#17). Real script, real subprocess, real JSON-on-stdin PreToolUse payload —
// exactly how Claude Code drives it — never a grep of the source.
//
// ADR-016 discipline mirrors verify-interface's own reporting.mjs block: drive the REAL vendor file
// (its `.rsp-backup` if the patch is installed on this machine, else the file itself), and SKIP
// rather than fabricate a fixture if ruvnet-brain isn't installed here at all.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const sandboxInput = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'dwall-'));
fs.mkdirSync(sandboxInput, { recursive: true });
// macOS spells its temp root as both /var/... and /private/var/.... Node resolves an imported
// module's URL to the latter while process.argv[1] retains the former; hook-input.mjs intentionally
// runs its CLI only when those paths match. Canonicalize once so this fixture exercises the CLI.
const SANDBOX = fs.realpathSync(sandboxInput);
process.env.RUFLO_SOURCE_PATCH_HOME = SANDBOX;      // <- BEFORE any lib/ (or fixtures.mjs) import
process.env.RSP_NO_SELF_UPDATE = '1';

// fixtures.mjs transitively imports plugin-compose.mjs, which freezes paths.mjs's HOME_BASE at
// IMPORT time — a static top-of-file import here would freeze it to the REAL machine's home,
// BEFORE the env var above ever took effect (measured live: applyComposed() then silently patched
// this developer's actual ~/.claude/plugins/... instead of the sandbox). Dynamic import, after the
// env var, is what makes this test's applyComposed()/reconcile() actually operate on SANDBOX.
const { REPO, findVendorRoot, pristineBytes } = await import('./fixtures.mjs');

let fail = 0;
const check = (desc, cond) => { console.log(`${cond ? '✓' : '✘'} ${desc}`); if (!cond) fail = 1; };

const REAL_BRAIN = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces', 'ruvnet-brain', 'plugin', 'scripts', 'design-wall.sh');
if (!fs.existsSync(REAL_BRAIN) && !fs.existsSync(`${REAL_BRAIN}.rsp-backup`)) {
  console.log('· design-wall (SKIPPED — the ruvnet-brain plugin is not installed)');
  process.exit(0);
}

const brainDir = path.join(SANDBOX, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain', 'plugin', 'scripts');
const brainScript = path.join(brainDir, 'design-wall.sh');
fs.mkdirSync(brainDir, { recursive: true });
const pristine = pristineBytes(REAL_BRAIN, 'designWall');
fs.writeFileSync(brainScript, pristine);
fs.chmodSync(brainScript, 0o755);
// Current ruvnet-brain versions share the real JSON parser with every shell hook. A fixture that
// copies design-wall.sh without this sibling silently fails open before reaching the behaviour under
// test, which used to make both the "buggy" and "still gated" assertions lie.
const realHookInput = path.join(path.dirname(REAL_BRAIN), 'hook-input.mjs');
if (pristine.includes('hook-input.mjs') && fs.existsSync(realHookInput)) {
  fs.copyFileSync(realHookInput, path.join(brainDir, 'hook-input.mjs'));
}

// A minimal repo the gate will run `git -C <dir> remote get-url origin` against. `notRuflo` has a
// origin naming an unrelated project (this project, in fact — the exact repo that measured the bug
// live); `isRuvnetBrain` has an origin naming ruvnet-brain's own, so the gate's REAL job (protecting
// its own explainer/console/readme surfaces) must still hold there.
function makeRepo(origin) {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'repo-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# hello\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  return dir;
}
const notRuflo = makeRepo('https://github.com/sparkling/ruflo-source-patch.git');
const isRuvnetBrain = makeRepo('git@github.com:stuinfla/ruvnet-brain.git');
fs.mkdirSync(path.join(isRuvnetBrain, 'plugin', '.claude-plugin'), { recursive: true });
fs.writeFileSync(
  path.join(isRuvnetBrain, 'plugin', '.claude-plugin', 'plugin.json'),
  '{"name":"ruvnet-brain"}\n',
);

// Drive the gate exactly as Claude Code does: a PreToolUse payload naming the proposed Bash
// command, as JSON, on stdin. Exit 0 = allowed, 2 = blocked.
const gate = (projectDir, command) => {
  const payload = JSON.stringify({ tool_name: 'Bash', command, tool_input: { command } });
  const r = spawnSync('bash', [brainScript], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, HOME: path.join(SANDBOX, 'home-empty'), CLAUDE_PROJECT_DIR: projectDir, RUVNET_SKIP_DESIGN_WALL: '' },
  });
  return { status: r.status, blocked: r.status === 2, stderr: r.stderr || '' };
};

const commitCmd = 'git commit -m "docs: update README"';

// ruvnet-brain now ships its own, stronger issue #17 fix: repository identity comes from the plugin
// manifest (with a structure fallback), not a forge-specific origin string. Once that implementation
// is present, prove its behaviour and the local target's retirement predicate rather than fabricating
// an obsolete buggy fixture just to keep testing our redundant patch.
const upstreamFixed = pristine.includes('IS_RUVNET_BRAIN=0')
  && pristine.includes('plugin/.claude-plugin/plugin.json')
  && pristine.includes('[ "$IS_RUVNET_BRAIN" = "1" ] || exit 0');
if (upstreamFixed) {
  const pristineText = pristine.toString('utf8');
  // Anti-correlate the legacy origin heuristic and the upstream manifest identity.
  execFileSync('git', ['remote', 'set-url', 'origin', 'https://github.com/stuinfla/ruvnet-brain.git'], { cwd: notRuflo });
  execFileSync('git', ['remote', 'set-url', 'origin', 'https://github.com/example/unrelated.git'], { cwd: isRuvnetBrain });
  const unrelated = gate(notRuflo, commitCmd);
  check('DW-U1 upstream gate allows a manifest-negative repo despite a misleading origin', unrelated.status === 0);
  const ownUpstream = gate(isRuvnetBrain, commitCmd);
  check('DW-U2 upstream gate blocks a manifest-positive repo despite an unrelated origin', ownUpstream.status === 2);

  const { evaluate, retireSuperseded, DW_FIX_MARKERS } = await import('../lib/supersede.mjs');
  const installedManifest = path.join(SANDBOX, '.claude', 'plugins', 'installed_plugins.json');
  const validManifest = {
    plugins: {
      'ruvnet-brain@ruvnet-brain': [{
        installPath: path.join(SANDBOX, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain', 'plugin'),
      }],
    },
  };
  fs.mkdirSync(path.dirname(installedManifest), { recursive: true });
  fs.writeFileSync(installedManifest, JSON.stringify(validManifest));
  const supersession = evaluate('design-wall');
  check('DW-U3 local design-wall target recognizes the runnable upstream replacement', supersession.state === 'superseded');
  const { applyComposed, reconcile } = await import('../lib/plugin-compose.mjs');
  const layered = applyComposed(['design-wall']);
  check(
    'DW-U3b predicate proves upstream bytes without letting the installed legacy wrapper affect behavior',
    layered.patched === 1 && evaluate('design-wall').state === 'superseded',
  );

  // DW-U4 — markers plus `bash -n` are not proof. Keep every marker in a comment while disabling
  // the early exit: the script still parses, but an unrelated README commit reaches the wall again.
  // A predicate reduced back to four `includes()` calls passes this mutation and makes the test red.
  const exitMarker = '[ "$IS_RUVNET_BRAIN" = "1" ] || exit 0';
  const behaviorallyWrong = pristineText.replace(exitMarker, `# ${exitMarker}\n: # marker preserved, behavior removed`);
  check('DW-U4 fixture mutation changed executable behavior while preserving every fix marker',
    behaviorallyWrong !== pristineText && DW_FIX_MARKERS.every((marker) => behaviorallyWrong.includes(marker)));
  fs.writeFileSync(brainScript, behaviorallyWrong);
  fs.chmodSync(brainScript, 0o755);
  const wrongVerdict = evaluate('design-wall');
  check('DW-U4 marker-preserving but behaviorally wrong replacement is NOT accepted', wrongVerdict.state !== 'superseded');
  fs.writeFileSync(brainScript, pristineText);
  fs.chmodSync(brainScript, 0o755);

  // DW-U5 — a manifest that names an absent active copy is not permission to prove only the
  // marketplace file. Missing means unknown; terminal retirement must wait.
  fs.writeFileSync(installedManifest, JSON.stringify({
    plugins: {
      'ruvnet-brain@ruvnet-brain': [{
        installPath: path.join(SANDBOX, '.claude', 'plugins', 'cache', 'ruvnet-brain', 'ruvnet-brain', 'missing-active'),
      }],
    },
  }));
  check('DW-U5 absent active design-wall copy makes supersession UNKNOWN', evaluate('design-wall').state === 'unknown');
  fs.writeFileSync(installedManifest, JSON.stringify(validManifest));

  const { writeState, readState } = await import('../lib/cwd/state.mjs');

  // DW-U6 — reconciliation failure must not write terminal state. A locally patched fixed copy with
  // its pristine backup missing cannot be honestly restored, so preserve it and keep the target live.
  const localApply = applyComposed(['design-wall']);
  check('DW-U6 fixture has the legacy local edit over the fixed upstream copy', localApply.patched === 1);
  fs.rmSync(`${brainScript}.rsp-backup`, { force: true });
  writeState({ patchTargets: [], pluginTargets: ['design-wall'], retired: {} });
  const { runPluginCommand } = await import('../lib/plugin-command.mjs');
  const uninstallHandled = runPluginCommand('design-wall', 'uninstall');
  check(
    'DW-U6 unsafe explicit uninstall fails and keeps the target tracked',
    uninstallHandled === true
      && process.exitCode === 1
      && readState().pluginTargets.includes('design-wall'),
  );
  process.exitCode = 0;
  const refused = retireSuperseded(readState());
  const refusedState = readState();
  check(
    'DW-U6 failed reconciliation preserves live bytes and leaves retirement unrecorded',
    refused.retired === 0
      && refusedState.pluginTargets.includes('design-wall')
      && !refusedState.retired['design-wall']
      && fs.readFileSync(brainScript, 'utf8').includes('ORIGIN=$(git -C'),
  );

  // DW-U7 — the destructive ordering that motivated the fix. An older local install left an OLD
  // pristine backup; an in-place plugin update then put the fixed upstream bytes on disk. Retirement
  // sees the fixed CURRENT file before any re-baseline. It must preserve current, remove the stale
  // backup, re-prove behavior, and only then record terminal state.
  const staleVendor = `#!/usr/bin/env bash
CMD=''
need=()
if [[ $CMD == *"git commit"* ]]; then
  STAGED=$(git -C "\${CLAUDE_PROJECT_DIR:-.}" diff --cached --name-only 2>/dev/null || true)
  [[ $STAGED == *"explainer/"* ]] && need+=("explainer")
  [[ $STAGED == *"console/"*   ]] && need+=("console")
  [[ $STAGED == *"README.md"*  ]] && need+=("readme")
fi
`;
  fs.writeFileSync(brainScript, pristineText);
  fs.chmodSync(brainScript, 0o755);
  fs.writeFileSync(`${brainScript}.rsp-backup`, staleVendor);
  writeState({ patchTargets: [], pluginTargets: ['design-wall'], retired: {} });
  const retirement = retireSuperseded(readState());
  const retiredState = readState();
  check(
    'DW-U7 stale backup never overwrites fixed current; retirement records only after the postcondition',
    retirement.retired === 1
      && !retiredState.pluginTargets.includes('design-wall')
      && Boolean(retiredState.retired['design-wall'])
      && fs.readFileSync(brainScript, 'utf8') === pristineText
      && !fs.existsSync(`${brainScript}.rsp-backup`),
  );

  // DW-U8 — an empty current file can be an in-progress plugin extraction.
  // A valid backup is recoverability, not permission to overwrite that update.
  fs.writeFileSync(brainScript, '');
  fs.writeFileSync(`${brainScript}.rsp-backup`, pristineText);
  const emptyCurrent = reconcile([], ['design-wall']);
  check(
    'DW-U8 empty current is left untouched, valid backup kept, and reconciliation fails closed',
    emptyCurrent.errors > 0
      && emptyCurrent.unresolved > 0
      && fs.readFileSync(brainScript, 'utf8') === ''
      && fs.readFileSync(`${brainScript}.rsp-backup`, 'utf8') === pristineText,
  );

  const { restoreFromBackup, writeIfChanged } = await import('../lib/pristine.mjs');
  const transient = path.join(brainDir, 'transient-design-wall.sh');
  fs.writeFileSync(`${transient}.rsp-backup`, pristineText);
  const missingCurrent = restoreFromBackup(transient);
  check(
    'DW-U9 missing current fails closed and retains recovery bytes',
    missingCurrent.unresolved
      && fs.readFileSync(`${transient}.rsp-backup`, 'utf8') === pristineText,
  );

  fs.writeFileSync(transient, 'external update\n');
  let concurrentCode = '';
  try {
    writeIfChanged(transient, pristineText, { expectedCurrent: 'previous proven bytes\n' });
  } catch (err) {
    concurrentCode = err.code;
  }
  check(
    'DW-U10 expected-current guard refuses bytes changed after proof',
    concurrentCode === 'RSP_CONCURRENT_CHANGE'
      && fs.readFileSync(transient, 'utf8') === 'external update\n',
  );

  if (fail) { console.log('\n✘ test/design-wall.mjs FAILED'); process.exit(1); }
  console.log('\n✓ design-wall: upstream issue #17 behavior + fail-closed retirement verified');
  process.exit(0);
}

// DW1 — BEFORE the patch, an UNRELATED repo's plain README.md commit is blocked. If this does not
// block, the fixture is not the buggy version and the rest of this suite is vacuous.
const before = gate(notRuflo, commitCmd);
check('DW1 unpatched gate blocks an unrelated repo\'s plain README.md commit (fixture proven buggy)', before.status === 2);

// Apply the patch.
const { applyComposed, reconcile } = await import('../lib/plugin-compose.mjs');
const a1 = applyComposed(['design-wall']);
check('DW2 apply patched the design-wall.sh copy', a1.patched >= 1 && a1.incomplete === 0 && a1.errors === 0);

// DW3 — AFTER the patch, the SAME unrelated repo's README.md commit is now ALLOWED.
const after = gate(notRuflo, commitCmd);
check('DW3 patched gate ALLOWS an unrelated repo\'s plain README.md commit', after.status === 0);

// DW4 — the gate's REAL job is preserved: ruvnet-brain's OWN repo (origin actually names it) still
// gets the design-grade wall on its README commit. This is not "disable the gate" — it's "scope it".
const own = gate(isRuvnetBrain, commitCmd);
check('DW4 ruvnet-brain\'s OWN repo (real origin) is STILL gated on its README commit', own.status === 2);

// DW5 — a non-commit command is never touched either way (the gate's other surfaces — vercel
// deploy, opening a page — are untouched by this patch; only the git-commit branch changed).
const notACommit = gate(notRuflo, 'echo hello');
check('DW5 a non-commit command is unaffected', notACommit.status === 0);

// DW6 — uninstall restores byte-identical vendor.
reconcile([], ['design-wall']);
check('DW6 uninstall restores byte-identical vendor, no .rsp-backup left', fs.readFileSync(brainScript, 'utf8') === pristineBytes(REAL_BRAIN, 'designWall').toString('utf8') && !fs.existsSync(`${brainScript}.rsp-backup`));

if (fail) { console.log('\n✘ test/design-wall.mjs FAILED'); process.exit(1); }
console.log('\n✓ design-wall: all checks passed');
