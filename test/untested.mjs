// The surfaces the other three suites never touched.
//
// Found by measuring, not guessing (NODE_V8_COVERAGE over the whole suite):
//
//   session-start.mjs   NEVER EXECUTED. It is the hook body that re-applies every patch at session
//                       start — the package's entire promise — and no test ran it. The other suites
//                       only ever referenced its PATH as a string.
//   cleanup.mjs         ZERO tests. It calls process.kill() and fs.rmSync(recursive). It DELETES
//                       THINGS, and nothing checked that it deletes the right things.
//   dual/commands.mjs   the script targets: install / uninstall / status, the STALE byte-compare,
//                       and the `requires` prerequisite gate.
//   the shell scripts   22KB of bash. ruflo-dedupe-bundle.sh removes files from a user's project.
//
// The two that DELETE were the two with no tests. That is the wrong way round.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { REPO, findVendorRoot, pristineBytes } from './fixtures.mjs';

const SB = process.argv[2];
const HOME = path.join(SB, 'home');
const STATE = path.join(HOME, '.ruflo-source-patch');
const REAL = findVendorRoot();

const FILES = [
  '@claude-flow/cli/dist/src/fs-secure.js',
  '@claude-flow/cli/dist/src/memory/memory-initializer.js',
  '@claude-flow/cli/dist/src/commands/daemon.js',
  '@claude-flow/cli/dist/src/services/daemon-autostart.js',
  '@claude-flow/cli-core/dist/src/mcp-tools/types.js',
];
const nm = path.join(SB, 'npx', 'h', 'node_modules');
const vendor = (rel) => path.join(nm, rel);

function freshSandbox() {
  fs.rmSync(SB, { recursive: true, force: true });
  fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}');
  for (const rel of FILES) {
    fs.mkdirSync(path.dirname(vendor(rel)), { recursive: true });
    fs.writeFileSync(vendor(rel), pristineBytes(path.join(REAL, rel)));
  }
}

const env = { ...process.env, RUFLO_SOURCE_PATCH_HOME: HOME, RUFLO_NPX_ROOT: path.join(SB, 'npx') };
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), ...args], { env, encoding: 'utf8' });
const fail = (m) => { console.log(`\n✘ ${m}`); process.exit(1); };
const out = (r) => `${r.stdout || ''}${r.stderr || ''}`;

const MARKER = '/* ruflo-source-patch:patched */';
const isPatched = (rel) => fs.readFileSync(vendor(rel), 'utf8').includes(MARKER);

// ─── SS: the SessionStart hook body ──────────────────────────────────────────
// This is what makes the patches SURVIVE. `npx` fetches a new cache dir the moment a version
// changes, and that copy is unpatched — the hook is what re-applies to it before you do any work.
// It had never been executed by a test.

freshSandbox();
cli(['cwd', 'install']);

// The hook runs from the STABLE COPY, exactly as Claude Code invokes it — not from the repo.
const hookScript = path.join(STATE, 'lib', 'cwd', 'session-start.mjs');
if (!fs.existsSync(hookScript)) fail('SS1 the SessionStart hook script is not in the stable copy — Claude Code would invoke nothing');

const runHook = () => spawnSync(process.execPath, [hookScript], { env, encoding: 'utf8', input: '{}' });

// SS1 — an unpatched vendor copy appears (npx fetched a new version mid-session). The hook must
// re-apply to it. This is the whole reason the hook exists.
fs.writeFileSync(vendor(FILES[3]), pristineBytes(path.join(REAL, FILES[3])));   // clobber, as npx does
if (isPatched(FILES[3])) fail('SS1 fixture: the file is still patched — the test would be vacuous');

const h1 = runHook();
if (!isPatched(FILES[3])) fail(`SS1 the SessionStart hook did NOT re-apply the patch — every patch dies on the next npx refetch:\n${out(h1)}`);

// SS2 — it is SILENT when there is nothing to say. A hook that chatters on every session start is a
// hook people disable.
const h2 = runHook();
if (out(h2).trim()) fail(`SS2 the hook spoke when everything was already healthy:\n${out(h2)}`);

// SS3 — and it SPEAKS when a patch has stopped applying. Upstream rewrites the file, our anchors no
// longer match, and the patch is now doing nothing — while `status` still calls the target installed.
// Silence here is the failure the whole package exists to prevent.
fs.writeFileSync(vendor(FILES[3]), 'export function somethingElseEntirely() {}\n');
const h3 = runHook();
if (!out(h3).trim()) fail('SS3 a broken anchor left the SessionStart hook SILENT — nobody would ever be told');

// SS4 — with nothing installed, the hook does nothing and says nothing. (UNINSTALL, not delete: a
// wiped stable copy is a different state entirely, and would only prove the hook can't load.)
cli(['cwd', 'uninstall']);
const h4 = runHook();
if (out(h4).trim()) fail(`SS4 the hook spoke with no targets installed:\n${out(h4)}`);

console.log('✔ SessionStart hook (SS1 re-applies to a fresh npx copy, SS2 silent when healthy, SS3 speaks when an anchor breaks, SS4 silent when uninstalled)');

// ─── CL: cleanup — the command that KILLS and DELETES ────────────────────────
// Untested until now, which is the wrong way round: it is the only command that removes
// directories and signals processes.

freshSandbox();

// A project with stray state dirs in subdirectories — exactly what cwd-drift produces.
const proj = path.join(SB, 'proj');
fs.mkdirSync(path.join(proj, 'sub', 'deep'), { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: proj });
fs.mkdirSync(path.join(proj, '.claude-flow'), { recursive: true });          // the ROOT one — must survive
fs.mkdirSync(path.join(proj, '.swarm'), { recursive: true });                // the ROOT one — must survive
fs.mkdirSync(path.join(proj, 'sub', '.claude-flow'), { recursive: true });   // stray
fs.mkdirSync(path.join(proj, 'sub', 'deep', '.swarm'), { recursive: true });  // stray
fs.writeFileSync(path.join(proj, '.swarm', 'memory.db'), 'THE REAL MEMORY');

// CL1 — --dry-run removes NOTHING. If the preview deletes, nobody can trust it.
const dry = spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), 'cleanup', proj, '--dry-run'], { env, encoding: 'utf8' });
if (!fs.existsSync(path.join(proj, 'sub', '.claude-flow'))) fail('CL1 --dry-run DELETED a directory');
if (!/would remove/.test(out(dry))) fail(`CL1 --dry-run did not say what it would remove:\n${out(dry)}`);

// CL2 — the real run removes the STRAY dirs...
const real = spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), 'cleanup', proj], { env, encoding: 'utf8' });
if (fs.existsSync(path.join(proj, 'sub', '.claude-flow'))) fail('CL2 a stray subdir .claude-flow survived');
if (fs.existsSync(path.join(proj, 'sub', 'deep', '.swarm'))) fail('CL2 a stray subdir .swarm survived');

// CL3 — ...and NEVER the project's own. This is the one that would destroy real memory.
if (!fs.existsSync(path.join(proj, '.claude-flow'))) fail('CL3 cleanup DELETED THE PROJECT ROOT .claude-flow');
if (!fs.existsSync(path.join(proj, '.swarm'))) fail('CL3 cleanup DELETED THE PROJECT ROOT .swarm');
if (fs.readFileSync(path.join(proj, '.swarm', 'memory.db'), 'utf8') !== 'THE REAL MEMORY') {
  fail('CL3 cleanup destroyed the real memory.db');
}
if (real.status !== 0) fail(`CL3 a successful cleanup exited nonzero:\n${out(real)}`);

// CL4 — it REFUSES a too-broad root, and fails. Pointed at $HOME it would walk every project you own,
// deleting state dirs. The guard compares against process.env.HOME, so the CHILD's HOME is what decides
// — set it, or this proves nothing.
const refused = spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), 'cleanup', HOME],
  { env: { ...env, HOME }, encoding: 'utf8' });
if (!/refusing/.test(out(refused))) fail('CL4 cleanup did not refuse a too-broad root');
if (refused.status === 0) fail('CL4 cleanup EXITED 0 after refusing to do anything');

console.log('✔ cleanup (CL1 --dry-run deletes nothing, CL2 strays removed, CL3 the project root SURVIVES, CL4 refuses a too-broad root and fails)');

// ─── ST: the script targets ──────────────────────────────────────────────────

freshSandbox();

// ST1 — install materializes the scripts, executable.
const inst = cli(['dual', 'install']);
if (inst.status !== 0) fail(`ST1 dual install failed:\n${out(inst)}`);
const dualEntry = path.join(STATE, 'dual', 'ruflo-add-codex.sh');
if (!fs.existsSync(dualEntry)) fail('ST1 the dual scripts were not materialized');
if (!(fs.statSync(dualEntry).mode & 0o111)) fail('ST1 the materialized script is not executable');
if (!fs.existsSync(path.join(STATE, 'dual', 'templates', 'AGENTS.md'))) fail('ST1 the templates/ dir did not come with it');

// ST2 — status reports it current...
if (!/installed, current/.test(out(cli(['dual', 'status'])))) fail('ST2 status did not report a fresh install as current');

// ST3 — ...and STALE when the installed copy drifts from the packaged one. This is the bug that shipped:
// status reported `installed` on the entry file merely EXISTING, so a stale script looked healthy.
fs.appendFileSync(dualEntry, '\n# a package upgrade moved on without us\n');
const stale = cli(['dual', 'status']);
if (!/STALE/.test(out(stale))) fail(`ST3 a drifted script was reported as healthy:\n${out(stale)}`);

// ST4 — install repairs it (install is an overwrite).
cli(['dual', 'install']);
if (/STALE/.test(out(cli(['dual', 'status'])))) fail('ST4 install did not refresh the stale script');

// ST5 — uninstall removes the whole target dir.
cli(['dual', 'uninstall']);
if (fs.existsSync(path.join(STATE, 'dual'))) fail('ST5 uninstall left the scripts behind');
if (!/not installed/.test(out(cli(['dual', 'status'])))) fail('ST5 status still claims it is installed');

console.log('✔ script targets (ST1 materialized + executable, ST2 current, ST3 drift reported STALE, ST4 install repairs, ST5 uninstall removes)');

// ─── SH: the shell scripts actually run ──────────────────────────────────────
// 22KB of bash that nothing had ever executed. dedupe DELETES FILES FROM A PROJECT, so at minimum its
// preview must run and must not touch anything.

freshSandbox();
cli(['dedupe', 'install']);
const dedupe = path.join(STATE, 'dedupe-bundle', 'ruflo-dedupe-bundle.sh');

// SH1 — it parses. A script with a syntax error fails at the worst possible moment: mid-delete.
const syn = spawnSync('bash', ['-n', dedupe], { encoding: 'utf8' });
if (syn.status !== 0) fail(`SH1 ruflo-dedupe-bundle.sh has a SYNTAX ERROR:\n${out(syn)}`);
for (const s of ['ruflo-new-dual.sh', 'ruflo-add-codex.sh']) {
  cli(['dual', 'install']);
  const r = spawnSync('bash', ['-n', path.join(STATE, 'dual', s)], { encoding: 'utf8' });
  if (r.status !== 0) fail(`SH1 ${s} has a SYNTAX ERROR:\n${out(r)}`);
}

// SH2 — dedupe's --dry-run touches NOTHING. It is a delete tool; its preview must be inert.
const p2 = path.join(SB, 'proj2');
fs.mkdirSync(path.join(p2, '.claude', 'skills', 'some-skill'), { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: p2 });
fs.writeFileSync(path.join(p2, '.claude', 'skills', 'some-skill', 'SKILL.md'), 'mine\n');
fs.writeFileSync(path.join(p2, '.claude', 'settings.json'), '{}');

const before = fs.readdirSync(path.join(p2, '.claude', 'skills'));
spawnSync('bash', [dedupe, p2, '--dry-run'], { encoding: 'utf8', env: { ...process.env, HOME } });
const after = fs.readdirSync(path.join(p2, '.claude', 'skills'));
if (JSON.stringify(before) !== JSON.stringify(after)) fail('SH2 dedupe --dry-run DELETED FILES from the project');
if (!fs.existsSync(path.join(p2, '.claude', 'skills', 'some-skill', 'SKILL.md'))) fail('SH2 --dry-run destroyed a project-unique skill');

console.log('✔ shell scripts (SH1 all three parse, SH2 dedupe --dry-run deletes nothing)');
