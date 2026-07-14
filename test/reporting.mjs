// The reporting suite: every path where a FAILURE could be mistaken for SUCCESS.
//
// sequence-fuzz covers "the library ends up in the right state"; plugin-notify covers the plugin
// patches and the notifier. Neither covered the three fixes that mattered most, and an untested
// notification path is precisely the thing that rots without anyone noticing:
//
//   S  the STABLE COPY — the hook and the monitor execute ~/.ruflo-source-patch/lib, not the
//      package. Nothing refreshed it, and nothing checked it, so a package upgrade changed
//      nothing about what either of them actually ran.
//   E  the ERROR path — a patch that THROWS (EACCES on a global npm root, a read-only fs). It was
//      logged, counted nowhere, matched by no notification regex, and summarised as `nothing to do`.
//   R  adr-reindex — it hard-deletes rows from memory.db, and its only post-condition was
//      `records != 0`, which cannot see the failure it exists to prevent.
//
// Every test here asserts that the tool SAYS SOMETHING. Passing means the failure was announced,
// not that it was avoided.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { REPO, findVendorRoot, pristineBytes } from './fixtures.mjs';

const SB = process.argv[2];
const HOME = path.join(SB, 'home');
const STATE = path.join(HOME, '.ruflo-source-patch');
const STABLE_LIB = path.join(STATE, 'lib');
const REAL = findVendorRoot();
// The REAL home — the sandbox HOME is where we PUT fixtures; the vendor originals live here.
const HOME_REAL = os.homedir();

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

const env = { ...process.env, RUFLO_SOURCE_PATCH_HOME: HOME, RUFLO_NPX_ROOT: path.join(SB, 'npx'),
  // Sandbox the GLOBAL npm root too. Without this, nodeModulesDirs() returns the sandbox PLUS the
  // developer's real global node_modules — so on any machine with a global @claude-flow/cli the suite
  // would patch, restore and re-baseline the REAL install (and R1a/R1c would poison its backups),
  // invisibly, because every assertion probes only sandbox paths.
  RUFLO_GLOBAL_ROOT: path.join(SB, 'global') };
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), ...args], { env, encoding: 'utf8' });
const notify = () => spawnSync(process.execPath, [path.join(REPO, 'lib', 'cwd', 'notify.mjs')], { env, encoding: 'utf8', input: '{}' }).stdout.trim();

const fail = (m) => { console.log(`\n✘ ${m}`); process.exit(1); };
const out = (r) => `${r.stdout || ''}${r.stderr || ''}`;

// ─── S: the stable copy ──────────────────────────────────────────────────────
// The hook and the monitor RUN this copy. If it is stale, the whole package is stale — while
// every one of its reporting surfaces (also stale) says everything is fine.

freshSandbox();
cli(['cwd', 'install']);

// S1 — install records WHERE the copy came from. Without provenance, "is it stale?" has no
// answer: diffing against the globally-installed package instead would heal a dev clone BACKWARD
// to the older release, the CLI and the monitor overwriting each other on a timer.
const manifest = path.join(STATE, 'lib-source.json');
if (!fs.existsSync(manifest)) fail('S1 install did not record lib-source.json — provenance unknown');
const recordedRoot = JSON.parse(fs.readFileSync(manifest, 'utf8')).root;
if (recordedRoot !== path.join(REPO, 'lib')) fail(`S1 lib-source.json root=${recordedRoot}, expected ${path.join(REPO, 'lib')}`);

// S2 — the copy is COMPLETE. syncStableCopy() used to enumerate three subtrees by name, so
// lib/dual never reached the stable copy at all — and any freshness check that walked the whole
// package would then have called that absence permanent, unfixable drift.
for (const rel of ['cwd/monitor.mjs', 'cwd/stable.mjs', 'plugin-registry.mjs', 'dual/commands.mjs']) {
  if (!fs.existsSync(path.join(STABLE_LIB, rel))) fail(`S2 stable copy is missing ${rel}`);
}

// S3 — a stale module is DETECTED, and fails `monitor check`. This is the bug that was live:
// nine modules behind, silently. Note `check` must NOT self-heal on its way to looking — a check
// that repairs the thing it is checking can only ever return clean.
const victim = path.join(STABLE_LIB, 'cwd', 'monitor.mjs');
fs.appendFileSync(victim, '\n// upstream moved on without us\n');
const chk = cli(['monitor', 'check']);
if (!/STALE-LIB/.test(out(chk))) fail(`S3 a stale stable copy was not reported:\n${out(chk)}`);
if (chk.status === 0) fail('S3 `monitor check` exited 0 with a stale stable copy — it is a gate, it must fail');

// S4 — and `monitor status` says so in plain words rather than printing a clean bill of health.
if (!/STALE LIB/.test(out(cli(['monitor', 'status'])))) fail('S4 `monitor status` did not report the stale copy');

// S5 — a MUTATING command heals it. Read-only commands observe; mutating commands repair.
cli(['cwd', 'install']);
if (fs.readFileSync(victim, 'utf8').includes('upstream moved on without us')) fail('S5 install did not refresh the stale stable copy');
if (cli(['monitor', 'check']).status !== 0) fail('S5 `monitor check` still fails after the copy was healed');

// S6 — the MONITOR heals itself, with no CLI invocation at all. This is the case that actually
// bites: nobody re-runs install after `npm i -g`, because nothing tells them to.
fs.appendFileSync(victim, '\n// stale again\n');
spawnSync(process.execPath, [path.join(REPO, 'lib', 'cwd', 'monitor-run.mjs')], { env, encoding: 'utf8' });
if (fs.readFileSync(victim, 'utf8').includes('stale again')) fail('S6 the monitor tick did not self-heal the stable copy');

// S7 — modules the package does NOT ship are reaped: the legacy FLAT copy (lib/*.mjs, from before
// the tree was shape-preserving) and anything upstream later deleted. Both used to linger forever,
// importable and stale.
const legacyFlat = path.join(STABLE_LIB, 'monitor.mjs');    // the old flat layout's copy
const upstreamGone = path.join(STABLE_LIB, 'cwd', 'removed-upstream.mjs');
fs.writeFileSync(legacyFlat, '// legacy flat copy\n');
fs.writeFileSync(upstreamGone, '// deleted from the package\n');
cli(['cwd', 'install']);
if (fs.existsSync(legacyFlat)) fail('S7 the legacy flat-copy module was not reaped');
if (fs.existsSync(upstreamGone)) fail('S7 a module the package no longer ships was not reaped');

// S8 — a root module survives even when a file of the SAME BASENAME exists under lib/cwd/.
//
// This is the collision the old basename-heuristic prune would silently eat. S8 used to assert
// pristine.mjs / plugin-registry.mjs / cwd/state.mjs survive — but NO SUCH COLLISION EXISTS in the tree
// (there is no lib/cwd/pristine.mjs, no lib/cwd/plugin-registry.mjs), so reverting the prune to the old
// heuristic passed it. It pinned a regression that could not occur on the files it checked.
//
// So plant a real one: a root module whose basename collides with an existing lib/cwd/ module. The old
// prune deleted a root .mjs iff cwd/ held the same basename — exactly this shape.
const collide = path.join(STABLE_LIB, 'state.mjs');           // collides with cwd/state.mjs
fs.writeFileSync(collide, '// a module the package ships at lib/ root\n');
const pkgCollide = path.join(REPO, 'lib', 'state.mjs');
fs.writeFileSync(pkgCollide, '// a module the package ships at lib/ root\n');   // the package DOES ship it
try {
  cli(['cwd', 'install']);
  if (!fs.existsSync(collide)) {
    fail('S8 the prune ATE a shipped root module because lib/cwd/ has one of the same basename — the hook would fail to import it, invisibly');
  }
} finally {
  fs.rmSync(pkgCollide, { force: true });
  cli(['cwd', 'install']);   // reap it again now that the package no longer ships it
}
for (const rel of ['pristine.mjs', 'plugin-registry.mjs', 'cwd/state.mjs']) {
  if (!fs.existsSync(path.join(STABLE_LIB, rel))) fail(`S8 the prune ate a module the package ships: ${rel}`);
}

// S9 — NON-.mjs assets reach the stable copy too. The mirror used to copy only .mjs, and the
// adr-reindex patcher reads `SKILL.md` — a data file shipped next to its code. The monitor runs FROM
// the stable copy, so it threw ENOENT on every single tick. (Caught in the wild by the notifier, on
// the prompt right after I shipped it.) A mirror that drops every file type it didn't think of is
// not a mirror.
if (!fs.existsSync(path.join(STABLE_LIB, 'adr-reindex', 'SKILL.md'))) {
  fail('S9 SKILL.md never reached the stable copy — the monitor cannot install the /adr-reindex skill');
}
// And it is READABLE from there, which is the thing that actually broke.
const stableSkill = fs.readFileSync(path.join(STABLE_LIB, 'adr-reindex', 'SKILL.md'), 'utf8');
if (!stableSkill.includes('ruflo-source-patch')) fail('S9 the stable copy of SKILL.md is missing its ownership marker');

console.log('✔ stable copy (S1 provenance, S2 complete, S3 drift fails the gate, S4 named in status, S5 install heals, S6 the monitor self-heals, S7 stale modules reaped, S8 shipped modules survive)');

// ─── E: the error path ───────────────────────────────────────────────────────
// A patch that THROWS. Previously: logged, counted nowhere, matched by none of the three
// (divergent) problem regexes, and summarised as `nothing to do`.

freshSandbox();
cli(['cwd', 'install']);
cli(['cwd', 'uninstall']);

// Make the write fail. writeIfChanged() writes a temp file into the target's DIRECTORY and
// renames, so a read-only directory is what produces the EACCES.
//
// It must be a directory the `cwd` target actually WRITES — services/daemon-autostart.js. (Locking
// fs-secure.js instead proves nothing: that file belongs to the `memory` target, so a `cwd install`
// never touches it and never throws.)
const lockedDir = path.dirname(vendor('@claude-flow/cli/dist/src/services/daemon-autostart.js'));
fs.chmodSync(lockedDir, 0o555);
let r;
try {
  r = cli(['cwd', 'install']);
} finally {
  fs.chmodSync(lockedDir, 0o755); // always restore, or the sandbox cannot be cleaned up
}

// E1 — it is COUNTED and SUMMARISED. `nothing to do` over a total failure to patch was the
// actual output before this.
if (!/ERRORS/.test(out(r))) fail(`E1 a throwing patch was not reported in the summary:\n${out(r)}`);
// The error must be COUNTED, not merely logged — that is the whole fix. (The old assertion here checked
// for `nothing to do`, which is unreachable: two of the three cwd files patch fine, so report() always
// prints `patched 2, …` regardless of whether errors are counted. A dead assertion.)
if (!/ERRORS 1\b/.test(out(r))) fail(`E1 the error was not COUNTED — expected 'ERRORS 1' in the summary:\n${out(r)}`);

// E2 — and it FAILS. `make install` must not print "done" over this.
if (r.status === 0) fail('E2 `cwd install` exited 0 despite every file failing to patch');

// E3 — the line reaches the notifier. isProblem() is the single shared predicate now; it used to
// be three regex copies, none of which matched an `error ` line.
const { isProblem, isFailure } = await import(`file://${path.join(REPO, 'lib', 'cwd', 'problems.mjs')}`);
const errLine = 'error /some/vendor/file.js: EACCES: permission denied';
if (!isProblem(errLine)) fail('E3 isProblem() does not match an `error ` line — the notifier will never announce it');
if (!isFailure(errLine)) fail('E3 isFailure() does not match an `error ` line — the monitor will never log it');

console.log('✔ error path (E1 counted + summarised, E2 exits nonzero, E3 reaches the notifier)');

// ─── R: adr-reindex ──────────────────────────────────────────────────────────
// It hard-deletes rows from memory.db through raw sqlite3. It depends on the `memory` target for
// that to be safe, and its post-condition must be able to see a reconcile that did not happen.

const haveSqlite = spawnSync('sqlite3', ['-version']).status === 0;

if (!haveSqlite) {
  console.log('· adr-reindex (SKIPPED — sqlite3 not on PATH)');
} else {
  // R1 — `adr-reindex install` REFUSES without the `memory` target. A declared prerequisite that
  // is never checked is decoration; the dependency must be discovered at install time, not at the
  // moment someone finally needs a reconcile.
  freshSandbox();
  cli(['cwd', 'install']); // something installed, but NOT memory
  const noMem = cli(['adr-reindex', 'install']);
  if (noMem.status === 0) fail('R1 `adr-reindex install` succeeded without the memory target');
  if (!/requires the memory/.test(out(noMem))) fail(`R1 the missing prerequisite was not named:\n${out(noMem)}`);

  // R2 — and it installs once `memory` is there.
  cli(['memory', 'install']);
  if (cli(['adr-reindex', 'install']).status !== 0) fail('R2 `adr-reindex install` failed WITH the memory target installed');

  // ── the script itself, against a hermetic project ──
  // A fake plugin whose import.mjs writes a CONTROLLED number of rows. That is what lets us test
  // the post-condition against a rebuild that silently reconciled nothing — the real importer
  // shells out to the ruflo CLI, which we neither need nor want here.
  const SCRIPT = path.join(STATE, 'adr-reindex', 'ruflo-adr-reindex.sh');

  function project(nAdrs) {
    const P = path.join(SB, `proj-${nAdrs}-${Math.random().toString(36).slice(2, 7)}`);
    fs.mkdirSync(path.join(P, 'docs', 'adr'), { recursive: true });
    fs.mkdirSync(path.join(P, '.swarm'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: P });
    for (let i = 1; i <= nAdrs; i++) {
      fs.writeFileSync(path.join(P, 'docs', 'adr', `ADR-00${i}-x.md`), `# ADR-00${i}\n\n**Status**: accepted\n`);
    }
    const db = path.join(P, '.swarm', 'memory.db');
    execFileSync('sqlite3', [db, 'CREATE TABLE memory_entries (namespace TEXT, key TEXT, value TEXT);']);
    // Pre-existing rows, including an ORPHAN — the thing a rebuild exists to reap.
    execFileSync('sqlite3', [db,
      "INSERT INTO memory_entries VALUES ('adr-patterns','ADR-001::x','{}'),('adr-patterns','ADR-999::gone','{}');"]);
    return { P, db };
  }

  // A fake ruflo-adr plugin: import.mjs inserts exactly `rows` records, verify.mjs is a no-op.
  function fakePlugin(rows) {
    const dir = path.join(HOME, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-adr', '9.9.9', 'scripts');
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'import.mjs'), `
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const db = path.join(process.env.ADR_ROOT, '.swarm', 'memory.db');
const vals = Array.from({length: ${rows}}, (_, i) => \`('adr-patterns','ADR-\${i}::x','{}')\`).join(',');
if (${rows} > 0) execFileSync('sqlite3', [db, \`INSERT INTO memory_entries VALUES \${vals};\`]);
console.log('fake importer stored ${rows}');
`);
    fs.writeFileSync(path.join(dir, 'verify.mjs'), "console.log('fake verify ok');\n");
  }

  // The `memory` patch must LOOK installed to the script — it greps the vendor bytes for
  // __rufloLockAcquire, not our state.json, because state records what we were ASKED to install
  // and only the file says what is true.
  const memInit = path.join(HOME, '.npm', '_npx', 'x', 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js');
  const setMemoryPatch = (patched) => {
    fs.mkdirSync(path.dirname(memInit), { recursive: true });
    fs.writeFileSync(memInit, patched ? 'async function __rufloLockAcquire(p) {}\n' : 'export function storeEntry(){}\n');
  };

  const runScript = (P) => spawnSync('bash', [SCRIPT, P], { env: { ...env, HOME }, encoding: 'utf8' });
  const rows = (db) => execFileSync('sqlite3', [db, "SELECT count(*) FROM memory_entries WHERE namespace='adr-patterns';"], { encoding: 'utf8' }).trim();

  // R3 — the script REFUSES when nothing honours <db>.rsp-lock, and deletes NOTHING.
  // A lock is a convention: it works only because the other side takes it, and the other side
  // takes it only when memory/write-lock is in the CLI. Without that, the delete races a daemon
  // that can resurrect every row — so refusing beats gambling the index.
  setMemoryPatch(false);
  fakePlugin(2);
  const { P: p1, db: db1 } = project(2);
  const unpatched = runScript(p1);
  if (unpatched.status === 0) fail('R3 the script ran with the memory patch absent');
  if (!/memory. patch target is not installed/.test(out(unpatched))) fail(`R3 the reason was not given:\n${out(unpatched)}`);
  if (rows(db1) !== '2') fail(`R3 it deleted rows before refusing — the index must be untouched (found ${rows(db1)})`);

  // R4 — the happy path: with memory present, it reaps the orphan and reconciles.
  setMemoryPatch(true);
  const { P: p2, db: db2 } = project(2);
  const ok = runScript(p2);
  if (ok.status !== 0) fail(`R4 a valid rebuild failed:\n${out(ok)}`);
  if (rows(db2) !== '2') fail(`R4 expected 2 records for 2 ADR files, found ${rows(db2)} — the orphan was not reaped`);

  // R5 — a rebuild that RECONCILED NOTHING is caught. This is the whole point: if a concurrent
  // writer flushes a pre-delete image back, the re-import upserts cleanly on top of the
  // resurrected rows, every store reports ok, and `records != 0` — the OLD post-condition — is
  // perfectly satisfied while the orphans it was run to reap are still sitting there.
  fakePlugin(5); // importer writes 5 rows for 2 ADR files: the delete did not stick
  const { P: p3, db: db3 } = project(2);
  const tooMany = runScript(p3);
  if (tooMany.status === 0) fail('R5 a rebuild that reconciled NOTHING exited 0');
  if (!/NOT reconciled/.test(out(tooMany))) fail(`R5 the mismatch was not reported:\n${out(tooMany)}`);
  if (!/DELETE did not stick/.test(out(tooMany))) fail('R5 the likely cause (a clobbered delete) was not named');

  // R6 — and the other direction: stores silently failing.
  fakePlugin(1); // 1 row for 2 ADR files
  const { P: p4 } = project(2);
  const tooFew = runScript(p4);
  if (tooFew.status === 0) fail('R6 a rebuild that stored too few records exited 0');
  if (!/Fewer rows than files/.test(out(tooFew))) fail(`R6 the mismatch was not reported:\n${out(tooFew)}`);

  console.log('✔ adr-reindex (R1 prerequisite enforced, R2 installs with it, R3 refuses + deletes nothing, R4 reconciles, R5 catches a clobbered delete, R6 catches failed stores)');
}

// ─── K: the /adr-reindex SKILL ───────────────────────────────────────────────
// It ADDS a file to someone else's plugin, which makes it the one target with no pristine to
// restore — and the one that can destroy work that isn't ours if it gets `uninstall` wrong.

const pluginRoot = (ver = '0.3.0') => path.join(HOME, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-adr', ver);
const skillFile = (ver) => path.join(pluginRoot(ver), 'skills', 'adr-reindex', 'SKILL.md');

function fakeAdrPlugin() {
  const p = pluginRoot();
  fs.mkdirSync(path.join(p, '.claude-plugin'), { recursive: true });
  // Discovery keys on the plugin MANIFEST, not on our skill — keying on the thing we are about to
  // create would find nothing on a fresh install and silently patch zero copies.
  fs.writeFileSync(path.join(p, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'ruflo-adr', version: '0.3.0' }));
}

freshSandbox();
fakeAdrPlugin();

// K1 — it REFUSES without the `memory` target. The rebuild hard-deletes rows; without the write lock
// a concurrent writer can resurrect every one of them.
cli(['cwd', 'install']);
const noMemK = cli(['adr-reindex', 'install']);
if (noMemK.status === 0) fail('K1 `adr-reindex install` succeeded without the memory target');
if (fs.existsSync(skillFile())) fail('K1 it installed the skill anyway, having just refused');

// K2 — with `memory`, both halves land: the skill (so `/adr-reindex` exists) AND the script it calls.
// A skill whose script is missing is a slash command that errors.
cli(['memory', 'install']);
const okK = cli(['adr-reindex', 'install']);
if (okK.status !== 0) fail(`K2 install failed with memory present:\n${out(okK)}`);
if (!fs.existsSync(skillFile())) fail('K2 the SKILL.md was not installed into the plugin');
if (!fs.existsSync(path.join(STATE, 'adr-reindex', 'ruflo-adr-reindex.sh'))) fail('K2 the script was not materialized — /adr-reindex would invoke nothing');

// K3 — it SURVIVES a `/plugin update`. This is the whole reason it is a plugin target and not a
// script one: an update re-fetches ruflo-adr wholesale and deletes the skill, silently, and the
// slash command would simply stop existing with nothing to read.
fs.rmSync(path.dirname(skillFile()), { recursive: true, force: true });
spawnSync(process.execPath, [path.join(REPO, 'lib', 'cwd', 'monitor-run.mjs')], { env, encoding: 'utf8' });
if (!fs.existsSync(skillFile())) fail('K3 a `/plugin update` wiped the skill and the monitor did not put it back');

// K4 — `uninstall` removes OUR skill...
cli(['adr-reindex', 'uninstall']);
if (fs.existsSync(skillFile())) fail('K4 uninstall left the skill behind');

// K5 — ...but NEVER deletes a skill we did not write. There is no backup here: the file is ours or it
// is upstream's, and getting that wrong destroys someone else's work outright. If ruflo-adr ever ships
// its own adr-reindex, theirs must survive both our install and our uninstall.
const theirs = '---\nname: adr-reindex\n---\n\n# upstream shipped their own\n';
fs.mkdirSync(path.dirname(skillFile()), { recursive: true });
fs.writeFileSync(skillFile(), theirs);

const overK = cli(['adr-reindex', 'install']);
if (fs.readFileSync(skillFile(), 'utf8') !== theirs) fail('K5 install OVERWROTE an upstream-owned skill');
if (!/upstream-owns-it/.test(out(overK))) fail(`K5 it did not say it was yielding to upstream:\n${out(overK)}`);

cli(['adr-reindex', 'uninstall']);
if (!fs.existsSync(skillFile())) fail('K5 uninstall DELETED an upstream-owned skill — destroyed work that was not ours');

console.log('✔ /adr-reindex skill (K1 memory required, K2 skill+script both land, K3 survives a /plugin update, K4 uninstall removes ours, K5 never touches upstream\'s)');

// ─── H: legacy hooks — the ones our own uninstall could not see ──────────────
// installHook() self-heals a MARKED hook. An UNMARKED hook of ours is invisible to every path here:
// install won't touch it, uninstall won't remove it. It outlives `uninstall` itself.

freshSandbox();
const settingsPath = path.join(HOME, '.claude', 'settings.json');
const readHooks = (ev) => (JSON.parse(fs.readFileSync(settingsPath, 'utf8')).hooks?.[ev] || [])
  .flatMap((g) => g.hooks || []);

// Two dead, UNMARKED SessionStart hooks pointing at the pre-flat-copy layout (no `cwd/` segment) —
// exactly what was found live: `node` fired at a path that had not existed for weeks, every session,
// and nothing could clean them up because they predate the marker.
const deadCmd = `node "${path.join(STATE, 'lib', 'session-start.mjs')}"`;
const foreign = 'node "/somewhere/else/not-ours.mjs"';
fs.writeFileSync(settingsPath, JSON.stringify({
  hooks: {
    SessionStart: [
      { hooks: [{ type: 'command', command: deadCmd, timeout: 5000 }] },
      { hooks: [{ type: 'command', command: deadCmd, timeout: 5000 }] },
      { hooks: [{ type: 'command', command: foreign, timeout: 5000 }] },
    ],
  },
}, null, 2));

cli(['cwd', 'install']);
const after = readHooks('SessionStart').map((h) => h.command);

// H5 — the dead unmarked copies of OURS are reaped.
if (after.includes(deadCmd)) fail(`H5 a dead legacy hook of ours survived install:\n  ${after.join('\n  ')}`);

// H6 — and somebody ELSE's hook on the same event is untouched. The ownership test is "does it point
// inside OUR stable dir", which is ours by construction; everything else is none of our business.
if (!after.includes(foreign)) fail('H6 install deleted a hook that was not ours');

// H7 — exactly ONE of ours is registered, not one-per-layout-change.
const ours = after.filter((c) => c.includes(path.join(STATE, 'lib')));
if (ours.length !== 1) fail(`H7 expected exactly 1 hook of ours, found ${ours.length}: ${ours.join(', ')}`);
if (!ours[0].includes(path.join('lib', 'cwd', 'session-start.mjs'))) fail(`H7 the surviving hook is not the current one: ${ours[0]}`);

// H8 — uninstall leaves none of ours behind, and still does not touch theirs.
cli(['cwd', 'uninstall']);
const post = readHooks('SessionStart').map((h) => h.command);
if (post.some((c) => c.includes(STATE))) fail(`H8 uninstall left our hooks behind: ${post.join(', ')}`);
if (!post.includes(foreign)) fail('H8 uninstall deleted a hook that was not ours');

console.log('✔ legacy hooks (H5 dead unmarked copies reaped, H6 foreign hooks untouched, H7 exactly one of ours, H8 uninstall leaves none)');

// ─── V: verify-interface — the gate that could not be opened ─────────────────
// Behavioural, not textual. Asserting "the regex string changed" would pass on a patch that broke the
// gate entirely; the only thing worth testing is what the SCRIPT DOES with a command.

const brainDir = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain', 'plugin', 'scripts');
const brainScript = path.join(brainDir, 'verify-interface.sh');

// The real vendor file: its .rsp-backup if the patch is installed on this machine, else the file itself
// (pristineBytes refuses a patched file with no backup, so it can never fabricate a baseline).
const REAL_BRAIN = path.join(HOME_REAL, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain', 'plugin', 'scripts', 'verify-interface.sh');

if (!fs.existsSync(REAL_BRAIN) && !fs.existsSync(`${REAL_BRAIN}.rsp-backup`)) {
  console.log('· verify-interface (SKIPPED — the ruvnet-brain plugin is not installed)');
} else {
  freshSandbox();
  fs.mkdirSync(brainDir, { recursive: true });
  fs.writeFileSync(brainScript, pristineBytes(REAL_BRAIN, 'verifyInterface'));
  fs.chmodSync(brainScript, 0o755);

  // The gate exits 0 immediately when the model-router profile is absent — so without this file the
  // hook allows EVERYTHING, V1 passes for the wrong reason, and every assertion below is vacuous.
  // (V1 caught exactly that on the first run. A test that cannot fail is worth nothing.)
  const profileDir = path.join(HOME, '.claude', 'model-router');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'profile.json'), '{}');

  // Drive the gate the way Claude Code does: the proposed command, as JSON, on stdin. Exit 0 = allowed,
  // nonzero = blocked.
  const gate = (command) => {
    const payload = JSON.stringify({ tool_name: 'Bash', command, tool_input: { command } });
    return spawnSync('bash', [brainScript], { input: payload, encoding: 'utf8', env: { ...process.env, HOME } }).status === 0;
  };

  // V1 — BEFORE the patch, the gate blocks a command it has no business seeing. If this does not block,
  // the fixture is wrong and everything below would pass vacuously.
  if (gate('ruflo-source-patch adr-index status')) {
    fail('V1 the UNPATCHED gate allowed `ruflo-source-patch adr-index status` — fixture is not the buggy version, the rest of this suite would be vacuous');
  }

  const r = cli(['verify-interface', 'install']);
  if (r.status !== 0) fail(`V2 install failed:\n${out(r)}`);
  if (!/5\/5 edits/.test(out(r))) fail(`V2 not all edits applied:\n${out(r)}`);

  // V3 — the false positives are gone. Each of these actually blocked a real command in one session.
  const shouldPass = [
    ['a DIFFERENT binary', 'ruflo-source-patch adr-index status'],
    ['a grep over a source tree', 'grep -rn ruflo-source-patch lib/'],
    ['English prose in a commit message', 'git commit -m "ruflo-adr-reindex.sh was the old copy"'],
  ];
  for (const [why, cmd] of shouldPass) {
    if (!gate(cmd)) fail(`V3 still blocked (${why}): ${cmd}`);
  }

  // V4 — THE GATE STILL WORKS. This is the one that matters: a patch that merely disabled the check
  // would sail through V3. An unread interface must still block.
  if (gate('ruflo some-unread-command sub')) {
    fail('V4 the patched gate no longer blocks an unread interface — we broke it instead of fixing it');
  }

  // V5 — the documented override is reachable at last. The block message tells you to write it on the
  // command; the check read it from the hook's own environment, where a caller can never put it.
  if (!gate('RUVNET_SKIP_INTERFACE_CHECK=1 ruflo memory search -q x')) {
    fail('V5 the documented override still does not work');
  }

  // V6 — uninstall restores the vendor bytes exactly, and the gate goes back to its old behaviour.
  cli(['verify-interface', 'uninstall']);
  if (!fs.readFileSync(brainScript).equals(pristineBytes(REAL_BRAIN, 'verifyInterface'))) {
    fail('V6 uninstall did not restore the vendor file byte-for-byte');
  }
  if (fs.existsSync(`${brainScript}.rsp-backup`)) fail('V6 uninstall left a backup behind');

  // V7 — UPSTREAM RE-WORDS ONE ANCHORED LINE. This is not hypothetical: it is what every plugin update
  // does, and `resolvePristine` will adopt the new bytes as pristine and re-derive the patch against
  // them. Four of the five edits still match — INCLUDING the regex, which shifts the capture groups its
  // readers use (bash ERE has no non-capturing groups). The fifth, a reader, does not.
  //
  // We used to WRITE that: the gate then read BASH_REMATCH[1] — now the boundary character, not the tool
  // — and blocked on garbage, on every command. It reported INCOMPLETE and exited nonzero, so it was
  // loud. But the vendor file was already corrupted, and only `uninstall` got you out. Loud-but-broken
  // is not the bar.
  //
  // These edits are INTERDEPENDENT: all of them land, or none do.
  cli(['verify-interface', 'uninstall']);
  const pristineBrain = pristineBytes(REAL_BRAIN, 'verifyInterface').toString('utf8');
  const readerAnchor = 'TOOL="${BASH_REMATCH[1]}"; SUB=';
  if (!pristineBrain.includes(readerAnchor)) fail('V7 fixture: the reader anchor is missing — the test cannot mean anything');

  // upstream reformats that one line (an extra space). Every other anchor is untouched.
  fs.writeFileSync(brainScript, pristineBrain.replace(readerAnchor, 'TOOL="${BASH_REMATCH[1]}";  SUB='));
  const partial = cli(['verify-interface', 'install']);

  const onDisk = fs.readFileSync(brainScript, 'utf8');
  if (onDisk.includes('(^|[[:space:]]|[;&|(])($TOOLS)')) {
    fail('V7 a PARTIAL patch was written — the regex landed and shifted the capture groups, but its reader did not move. The gate now blocks on garbage.');
  }
  if (!/INCOMPLETE/.test(out(partial))) fail(`V7 the partial match was not reported:\n${out(partial)}`);
  if (!/NOTHING WRITTEN/.test(out(partial))) fail('V7 it did not say the file was left untouched');
  if (partial.status === 0) fail('V7 exited 0 on a partial match — it must fail');

  console.log('✔ verify-interface (V1 buggy fixture proven, V2 5/5 edits, V3 false positives gone, V4 the gate STILL blocks, V5 override reachable, V6 clean restore, V7 a partial match writes NOTHING)');
}

// ─── A: an AMBIGUOUS anchor is refused, not guessed at ───────────────────────
// Every anchor is unique in today's vendor files. That is a MEASUREMENT, not a promise: anchor
// uniqueness is a property of UPSTREAM'S code, which we do not control and cannot guarantee for any
// future release.
//
// Duplicate one and the two apply mechanisms fail in opposite directions — `split().join()` patches
// EVERY occurrence; `.replace()` silently takes the FIRST, which may not be the one that matters. Both
// are guesses. Neither is acceptable in someone else's code.

freshSandbox();

// UPSTREAM RESTRUCTURES: our anchored line now appears twice (they extracted a helper, duplicated a
// guard, whatever). The patch is no longer able to say WHERE it belongs.
const amb = vendor('@claude-flow/cli/dist/src/services/daemon-autostart.js');
const ambSrc = fs.readFileSync(amb, 'utf8');
// A REAL anchor from the shipped entry table, not an invented string — a made-up needle would prove
// nothing about the anchors we actually rely on.
const anchor = 'export function ensureDaemonRunning(projectRoot, opts = {}) {\n    try {';
if (!ambSrc.includes(anchor)) fail(`A1 fixture: the vendor file no longer contains ${anchor} — this test cannot mean anything`);

// duplicate the whole function signature line
fs.writeFileSync(amb, ambSrc.replace(anchor, `${anchor}\n// upstream duplicated this below\n${anchor}`));

const ambRun = cli(['cwd', 'install']);

// A1 — it REFUSES, and says why. Silently patching both (or arbitrarily the first) is the failure mode.
if (!/ambiguous-anchor|anchor-not-found/.test(out(ambRun))) {
  fail(`A1 a duplicated anchor was not reported — it guessed:\n${out(ambRun)}`);
}

// A2 — and the notifier will actually say it, rather than it dying in a log nobody reads.
if (!isProblem('skip:ambiguous-anchor cwd/x (/f.js) — anchor occurs 2x')) {
  fail('A2 an ambiguous anchor does not match the shared problem predicate — the notifier will never announce it');
}

console.log('✔ ambiguous anchors (A1 a duplicated anchor is refused, not guessed at; A2 it reaches the notifier)');

// ─── M: `make install` covers every target that exists ───────────────────────
// This package OPENED with a commit fixing "make install never installed the ADR patches it claimed
// to". Then verify-interface was added in 4.2.0 and the Makefile was not touched — so `make install`
// silently stopped covering everything again, exactly as before. Twice is a pattern, and a pattern
// needs a test, not another apology.
//
// The Makefile is checked against the CODE's target list, never against a list typed here — a
// hardcoded expectation would need updating by the same person who forgot the Makefile.
{
  const makefile = fs.readFileSync(path.join(REPO, 'Makefile'), 'utf8');
  const installBlock = makefile.split(/^install: /m)[1]?.split(/^\w+:/m)[0] || '';
  const uninstallBlock = makefile.split(/^uninstall:/m)[1]?.split(/^\w+:/m)[0] || '';

  const { PATCH_TARGETS } = await import(`file://${path.join(REPO, 'lib', 'cwd', 'patch-library.mjs')}`);
  const { PLUGIN_TARGETS } = await import(`file://${path.join(REPO, 'lib', 'plugin-registry.mjs')}`);
  const mustInstall = [...PATCH_TARGETS, ...PLUGIN_TARGETS];

  // M1 — every patch and plugin target is installed by `make install`. Script targets are deliberately
  // opt-in (they change your PROJECTS, not the library), so they are not required here.
  const missingInstall = mustInstall.filter((t) => !new RegExp(`ruflo-source-patch ${t} install\\b`).test(installBlock));
  if (missingInstall.length) {
    fail(`M1 \`make install\` does not install: ${missingInstall.join(', ')}\n`
      + '   Every patch/plugin target must be in the Makefile, or `make install` is lying about what it does.');
  }

  // M2 — and `make uninstall` removes every one of them. An uninstall that leaves targets behind has
  // not uninstalled the package; it has just stopped admitting to them.
  const missingUninstall = mustInstall.filter((t) => !new RegExp(`ruflo-source-patch ${t} uninstall\\b`).test(uninstallBlock));
  if (missingUninstall.length) {
    fail(`M2 \`make uninstall\` does not remove: ${missingUninstall.join(', ')}`);
  }

  console.log(`✔ make install (M1 installs all ${mustInstall.length} patch/plugin targets, M2 uninstall removes them all)`);
}

// ─── RB: a re-baseline tells you WHAT TO DO, not just what happened ──────────
// A re-baseline is the one failure mode with NO automated guard: the anchors still matched, uniquely,
// and the result parses — but a literal string can still match and no longer MEAN the same thing.
// Upstream may have moved our anchored line into a dead path. Nothing here can detect that.
//
// So the notifier must not merely report it. The reader of that text is usually an agent, and it can act
// on instructions — so it gets instructions.

freshSandbox();
cli(['cwd', 'install']);

// UPSTREAM SHIPS A NEW BUILD: the file is replaced with something that still carries our anchors (so the
// patch re-applies) but is otherwise different. This is a re-baseline, not a break.
const rbFile = vendor('@claude-flow/cli/dist/src/services/daemon-autostart.js');
const rbPristine = pristineBytes(path.join(REAL, '@claude-flow/cli/dist/src/services/daemon-autostart.js')).toString('utf8');
fs.writeFileSync(rbFile, `// upstream v9: a new header they added\n${rbPristine}`);

spawnSync(process.execPath, [path.join(REPO, 'lib', 'cwd', 'monitor-run.mjs')], { env, encoding: 'utf8' });

const rbSaid = notify();
if (!/re-baselined/.test(rbSaid)) fail(`RB a vendor file was replaced under us and the notifier never said so:\n${said || '(silence)'}`);

// RB1 — it says what CANNOT be verified. Without this, a clean-looking re-apply reads as "all fine".
if (!/does NOT prove it still DOES anything|no automated guard/i.test(rbSaid)) {
  fail(`RB1 the notifier reported the re-baseline but never said the patch's CORRECTNESS is unverified:\n${rbSaid}`);
}

// RB2 — it hands over the actual diff command, with the real paths. "Go look at it" is not an instruction.
if (!/diff .*\.rsp-backup/.test(rbSaid)) fail(`RB2 no diff command was given — the reader has nothing to act on:\n${rbSaid}`);
if (!rbSaid.includes(rbFile)) fail('RB2 the guidance does not name the file that actually changed');

// RB3 — it says what to LOOK for (a dead path / an early return), not merely "check it".
if (!/early return|dead path|no-op that LOOKS applied/i.test(rbSaid)) {
  fail(`RB3 the guidance does not say what to look for in the new code:\n${rbSaid}`);
}

// RB4 — and how to act on the answer, either way.
if (!/uninstall/.test(rbSaid)) fail('RB4 the guidance never says how to back the patch out if it is now wrong');

// RB5 — an ORDINARY problem does NOT get the essay. A warning that always prints a wall of text is a
// warning people learn to scroll past.
//
// Note the fixture has to be a problem that is NOT a re-baseline, and "rewrite the vendor file" is not
// one — replacing the bytes IS what triggers a re-baseline. So: make the write FAIL instead (a read-only
// directory), which produces an `error ` line and no re-baseline at all.
freshSandbox();
cli(['cwd', 'install']);
cli(['cwd', 'uninstall']);
const lockedDir2 = path.dirname(vendor('@claude-flow/cli/dist/src/services/daemon-autostart.js'));
fs.chmodSync(lockedDir2, 0o555);
try {
  spawnSync(process.execPath, [path.join(REPO, 'lib', 'cwd', 'monitor-run.mjs')], { env, encoding: 'utf8' });
  cli(['cwd', 'install']);
  spawnSync(process.execPath, [path.join(REPO, 'lib', 'cwd', 'monitor-run.mjs')], { env, encoding: 'utf8' });
} finally {
  fs.chmodSync(lockedDir2, 0o755);
}
const plain = notify();
if (!plain.trim()) fail('RB5 fixture: an unwritable vendor dir produced no warning at all — the test would be vacuous');
if (/A VENDOR FILE CHANGED UNDER US/.test(plain)) {
  fail(`RB5 the re-baseline guidance printed for an ordinary problem — it must be reserved for the case it describes:\n${plain}`);
}

console.log('✔ re-baseline guidance (RB names the unverifiable risk, RB2 gives the real diff command, RB3 says what to look for, RB4 how to act, RB5 stays quiet for ordinary problems)');

// ─── the notifier actually speaks ────────────────────────────────────────────
// The end of the chain. Everything above is worthless if the human is never told.

freshSandbox();
cli(['cwd', 'install']);
// A broken anchor, in a file the `cwd` target actually owns: upstream rewrites it, our edits no
// longer match, and the patch is now doing NOTHING to it — while `status` still calls the target
// installed. That silence is the failure; the tick must leave a note the next prompt reads.
fs.writeFileSync(vendor('@claude-flow/cli/dist/src/services/daemon-autostart.js'), 'export function nothing() {}\n');
spawnSync(process.execPath, [path.join(REPO, 'lib', 'cwd', 'monitor-run.mjs')], { env, encoding: 'utf8' });
const said = notify();
if (!said) fail('N a monitor tick that found a problem left the next prompt silent');

console.log('✔ notifier (a problem found by the monitor is announced on the next prompt)');
