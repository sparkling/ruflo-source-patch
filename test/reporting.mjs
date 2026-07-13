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
import { spawnSync, execFileSync } from 'node:child_process';
import { REPO, findVendorRoot, pristineBytes } from './fixtures.mjs';

const SB = process.argv[2];
const HOME = path.join(SB, 'home');
const STATE = path.join(HOME, '.ruflo-source-patch');
const STABLE_LIB = path.join(STATE, 'lib');
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

// S8 — and a module the package DOES ship at lib/ root survives, even though a file of the same
// basename exists under lib/cwd/. The old prune keyed on exactly that basename collision, so it
// would have deleted this one — silently, from the copy the hook imports.
for (const rel of ['pristine.mjs', 'plugin-registry.mjs', 'cwd/state.mjs']) {
  if (!fs.existsSync(path.join(STABLE_LIB, rel))) fail(`S8 the prune ate a module the package ships: ${rel}`);
}

// S9 — NON-.mjs assets reach the stable copy too. The mirror used to copy only .mjs, and the
// adr-reindex patcher reads `skill.md` — a data file shipped next to its code. The monitor runs FROM
// the stable copy, so it threw ENOENT on every single tick. (Caught in the wild by the notifier, on
// the prompt right after I shipped it.) A mirror that drops every file type it didn't think of is
// not a mirror.
if (!fs.existsSync(path.join(STABLE_LIB, 'adr-reindex', 'skill.md'))) {
  fail('S9 skill.md never reached the stable copy — the monitor cannot install the /adr-reindex skill');
}
// And it is READABLE from there, which is the thing that actually broke.
const stableSkill = fs.readFileSync(path.join(STABLE_LIB, 'adr-reindex', 'skill.md'), 'utf8');
if (!stableSkill.includes('ruflo-source-patch')) fail('S9 the stable copy of skill.md is missing its ownership marker');

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
if (/nothing to do/.test(out(r))) fail('E1 a run in which every file threw printed `nothing to do`');

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
