// Behavioural tests for `design-wall` (ruvnet-brain's design-grade commit gate, unscoped to any
// repo — ruvnet-brain#TBD). Real script, real subprocess, real JSON-on-stdin PreToolUse payload —
// exactly how Claude Code drives it — never a grep of the source.
//
// ADR-016 discipline mirrors verify-interface's own reporting.mjs block: drive the REAL vendor file
// (its `.rsp-backup` if the patch is installed on this machine, else the file itself), and SKIP
// rather than fabricate a fixture if ruvnet-brain isn't installed here at all.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const SANDBOX = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'dwall-'));
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
fs.writeFileSync(brainScript, pristineBytes(REAL_BRAIN, 'designWall'));
fs.chmodSync(brainScript, 0o755);

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

// Drive the gate exactly as Claude Code does: a PreToolUse payload naming the proposed Bash
// command, as JSON, on stdin. Exit 0 = allowed, 2 = blocked.
const gate = (projectDir, command) => {
  const payload = JSON.stringify({ tool_name: 'Bash', command, tool_input: { command } });
  const r = spawnSync('bash', [brainScript], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, HOME: path.join(SANDBOX, 'home-empty'), CLAUDE_PROJECT_DIR: projectDir, RUVNET_SKIP_DESIGN_WALL: '' },
  });
  return { blocked: r.status === 2, stderr: r.stderr || '' };
};

const commitCmd = 'git commit -m "docs: update README"';

// DW1 — BEFORE the patch, an UNRELATED repo's plain README.md commit is blocked. If this does not
// block, the fixture is not the buggy version and the rest of this suite is vacuous.
const before = gate(notRuflo, commitCmd);
check('DW1 unpatched gate blocks an unrelated repo\'s plain README.md commit (fixture proven buggy)', before.blocked);

// Apply the patch.
const { applyComposed, reconcile } = await import('../lib/plugin-compose.mjs');
const a1 = applyComposed(['design-wall']);
check('DW2 apply patched the design-wall.sh copy', a1.patched >= 1 && a1.incomplete === 0 && a1.errors === 0);

// DW3 — AFTER the patch, the SAME unrelated repo's README.md commit is now ALLOWED.
const after = gate(notRuflo, commitCmd);
check('DW3 patched gate ALLOWS an unrelated repo\'s plain README.md commit', !after.blocked);

// DW4 — the gate's REAL job is preserved: ruvnet-brain's OWN repo (origin actually names it) still
// gets the design-grade wall on its README commit. This is not "disable the gate" — it's "scope it".
const own = gate(isRuvnetBrain, commitCmd);
check('DW4 ruvnet-brain\'s OWN repo (real origin) is STILL gated on its README commit', own.blocked);

// DW5 — a non-commit command is never touched either way (the gate's other surfaces — vercel
// deploy, opening a page — are untouched by this patch; only the git-commit branch changed).
const notACommit = gate(notRuflo, 'echo hello');
check('DW5 a non-commit command is unaffected', !notACommit.blocked);

// DW6 — uninstall restores byte-identical vendor.
reconcile([], ['design-wall']);
check('DW6 uninstall restores byte-identical vendor, no .rsp-backup left', fs.readFileSync(brainScript, 'utf8') === pristineBytes(REAL_BRAIN, 'designWall').toString('utf8') && !fs.existsSync(`${brainScript}.rsp-backup`));

if (fail) { console.log('\n✘ test/design-wall.mjs FAILED'); process.exit(1); }
console.log('\n✓ design-wall: all checks passed');
