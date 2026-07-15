// The half sequence-fuzz.mjs never covered: the ruflo-adr PLUGIN patches, the notifier, and
// the monitor's own liveness checks.
//
// These were "verified by hand" for a while, which is another way of saying untested. Hand
// verification does not survive a refactor, and every bug this project has shipped was in the
// machinery that is supposed to notice bugs.
//
// Everything routes through HOME_BASE, so the plugin tree, the state dir, the hooks and the
// health files all sandbox cleanly. `monitor install` is deliberately NOT exercised — it would
// register a real launchd job on the developer's machine — so the health checks are driven by
// writing monitor.json directly, which is what installMonitor() does anyway.
//
//   P1  a plugin entry is applied  <=>  its target is in state.pluginTargets
//   P2  empty state  =>  files byte-identical to pristine, no .rsp-backup left
//   P3  the patched importer still parses as valid ESM
//   P4  no plugin file is ever truncated to zero bytes
//   P5  installing twice is a no-op the second time
//   R3  an in-place /plugin update is re-baselined, not reverted to a stale backup
//   R4  an empty backup never destroys the plugin file
//   R5  a broken anchor is reported as INCOMPLETE, never silently skipped
//   N1-N4  the notifier: silent when healthy, announces once, rate-limits, self-clears
//   H1-H4  monitor liveness: absent monitor is silent; stale/dead/missing is named

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { REPO, findPluginRoot, pristineBytes } from './fixtures.mjs';

const SB = process.argv[2];
const HOME = path.join(SB, 'home');
const STATE = path.join(HOME, '.ruflo-source-patch');

// Discovered, not pinned: `0.3.0` was written down here, so the suite broke the moment the
// plugin was upgraded — and broke by not finding its fixtures, which is a confusing way to fail.
const { dir: REAL_PLUGIN, version: PLUGIN_VER } = findPluginRoot();
const IMPORT_REL = ['scripts', 'import.mjs'];
const SKILL_REL = ['skills', 'adr-create', 'SKILL.md'];

const pluginFile = (rel) => path.join(HOME, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-adr', PLUGIN_VER, ...rel);
const PRISTINE = {};

// The VENDOR originals. pristineBytes() prefers the .rsp-backup and REFUSES a patched file that
// has none — the old fallback took the patched file as the baseline and tested the patch against
// itself.
const KIND = { 'scripts,import.mjs': 'adrIndex', 'skills,adr-create,SKILL.md': 'adrTemplate' };
function vendorBytes(rel) {
  return pristineBytes(path.join(REAL_PLUGIN, ...rel), KIND[rel.join(',')]);
}

function freshSandbox() {
  fs.rmSync(SB, { recursive: true, force: true });
  fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}');
  for (const rel of [IMPORT_REL, SKILL_REL]) {
    const dest = pluginFile(rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, vendorBytes(rel));
  }
}

const env = { ...process.env, RSP_NO_MONITOR_RECOVER: '1', RUFLO_SOURCE_PATCH_HOME: HOME, RUFLO_NPX_ROOT: path.join(SB, 'npx'),
  // Sandbox the GLOBAL npm root too. Without this, nodeModulesDirs() returns the sandbox PLUS the
  // developer's real global node_modules — so on any machine with a global @claude-flow/cli the suite
  // would patch, restore and re-baseline the REAL install (and R1a/R1c would poison its backups),
  // invisibly, because every assertion probes only sandbox paths.
  RUFLO_GLOBAL_ROOT: path.join(SB, 'global') };
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), ...args], { env, encoding: 'utf8' });
const notify = () => spawnSync(process.execPath, [path.join(REPO, 'lib', 'cwd', 'notify.mjs')], { env, encoding: 'utf8', input: '{}' }).stdout.trim();

const fail = (m) => { console.log(`\n✘ ${m}`); process.exit(1); };

function pluginTargets() {
  try { return JSON.parse(fs.readFileSync(path.join(STATE, 'state.json'), 'utf8')).pluginTargets || []; } catch { return []; }
}

// Applied <=> the fix is present. Probed independently of the patcher's own bookkeeping.
const PROBE = {
  'adr-index': { rel: IMPORT_REL, needle: "'--upsert'," },
  'adr-template': { rel: SKILL_REL, needle: '   **Status**: proposed' },
};

function check(step, seq) {
  const st = pluginTargets();
  const errs = [];

  for (const [t, { rel, needle }] of Object.entries(PROBE)) {          // P1
    const applied = fs.readFileSync(pluginFile(rel), 'utf8').includes(needle);
    if (applied !== st.includes(t)) errs.push(`P1 ${t}: applied=${applied} but installed=${st.includes(t)}`);
  }

  if (st.length === 0) {                                               // P2
    for (const rel of [IMPORT_REL, SKILL_REL]) {
      const k = rel.join('/');
      if (fs.readFileSync(pluginFile(rel), 'utf8') !== PRISTINE[k]) errs.push(`P2 ${k}: not restored to pristine`);
      if (fs.existsSync(`${pluginFile(rel)}.rsp-backup`)) errs.push(`P2 ${k}: backup left behind`);
    }
  }

  const r = spawnSync(process.execPath, ['--check', pluginFile(IMPORT_REL)], { encoding: 'utf8' });
  if (r.status !== 0) errs.push('P3 import.mjs: SYNTAX ERROR');       // P3

  for (const rel of [IMPORT_REL, SKILL_REL]) {                        // P4
    if (fs.statSync(pluginFile(rel)).size === 0) errs.push(`P4 ${rel.join('/')}: TRUNCATED to zero bytes`);
  }

  if (errs.length) {
    console.log(`\n✘ FAILED after step ${step}: ${JSON.stringify(seq)}`);
    for (const e of errs) console.log(`  ${e}`);
    process.exit(1);
  }
}

// ── plugin fuzz ─────────────────────────────────────────────────────────────────────────
const TARGETS = ['adr-template', 'adr-index'];
const ACTIONS = ['install', 'uninstall', 'status'];

freshSandbox();
for (const rel of [IMPORT_REL, SKILL_REL]) PRISTINE[rel.join('/')] = fs.readFileSync(pluginFile(rel), 'utf8');

let rng = 987654321;
const rand = (n) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };

const RUNS = 30, LEN = 6;
for (let run = 0; run < RUNS; run++) {
  freshSandbox();
  const seq = [];
  for (let i = 0; i < LEN; i++) {
    const t = TARGETS[rand(TARGETS.length)];
    const a = ACTIONS[rand(ACTIONS.length)];
    seq.push(`${t} ${a}`);
    cli([t, a]);
    cli(['monitor', 'run']);   // a tick after EVERY step — must never violate an invariant
    check(i, seq);
  }
  for (const t of TARGETS) cli([t, 'install']);                        // P5
  const snap = [IMPORT_REL, SKILL_REL].map((rel) => fs.readFileSync(pluginFile(rel), 'utf8'));
  for (const t of TARGETS) cli([t, 'install']);
  cli(['monitor', 'run']);
  [IMPORT_REL, SKILL_REL].forEach((rel, i) => {
    if (fs.readFileSync(pluginFile(rel), 'utf8') !== snap[i]) fail(`P5 idempotence broken on ${rel.join('/')} after ${JSON.stringify(seq)}`);
  });
}
console.log(`✔ ${RUNS} plugin sequences × ${LEN} steps (P1 applied⇔installed, P2 pristine restore, P3 parses, P4 never truncated, P5 idempotent)`);

// ── plugin regressions ──────────────────────────────────────────────────────────────────

// R3 — a /plugin update rewrites the file IN PLACE (the marketplace path is unversioned).
{
  freshSandbox();
  cli(['adr-index', 'install']);
  const NEW = `// PLUGIN-UPDATED-IN-PLACE\n${PRISTINE[IMPORT_REL.join('/')]}`;
  fs.writeFileSync(pluginFile(IMPORT_REL), NEW);
  cli(['monitor', 'run']);

  const after = fs.readFileSync(pluginFile(IMPORT_REL), 'utf8');
  if (!after.includes('PLUGIN-UPDATED-IN-PLACE')) fail('R3: CLOBBERED a /plugin update by restoring a stale backup');
  if (!after.includes("'--upsert',")) fail('R3: failed to re-apply the patch on top of the new plugin file');
  const backup = fs.readFileSync(`${pluginFile(IMPORT_REL)}.rsp-backup`, 'utf8');
  if (!backup.includes('PLUGIN-UPDATED-IN-PLACE')) fail('R3: backup not re-baselined to the new plugin file');
  if (backup.includes("'--upsert',")) fail('R3: baked our own patch into "pristine" — uninstall would no longer be clean');
}

// R4 — an empty backup must never destroy the file, on ANY path.
//
// UNINSTALL is the dangerous one: restore() doesn't need a pristine, it just copies the backup
// back — so it bypasses every guard in resolvePristine(), and a poisoned backup makes
// `uninstall` the most destructive command in the tool. copyFileSync('', file) truncates the
// very file it is meant to restore. Measured before the guard: 13337 bytes -> 0.
{
  for (const action of ['monitor-run', 'uninstall']) {
    freshSandbox();
    cli(['adr-index', 'install']);
    fs.writeFileSync(`${pluginFile(IMPORT_REL)}.rsp-backup`, '');
    const before = fs.statSync(pluginFile(IMPORT_REL)).size;

    if (action === 'uninstall') cli(['adr-index', 'uninstall']);
    else cli(['monitor', 'run']);

    if (fs.statSync(pluginFile(IMPORT_REL)).size === 0) {
      fail(`R4 (${action}): DESTROYED the plugin file (${before} bytes -> 0) from an empty backup`);
    }
  }
}

// R5 — a broken anchor is REPORTED, never silently skipped. An unpatched adr-index does not
// fail loudly; it goes back to reporting success while writing nothing. Silence here is the bug.
{
  freshSandbox();
  const mangled = PRISTINE[IMPORT_REL.join('/')].split('storedRecords++').join('recordsWritten++');
  fs.writeFileSync(pluginFile(IMPORT_REL), mangled);
  const out = cli(['adr-index', 'install']).stdout;
  if (!/INCOMPLETE/.test(out)) fail('R5: a broken anchor was NOT reported as INCOMPLETE');
  if (!/records-miscount/.test(out)) fail('R5: INCOMPLETE did not name the edit that failed to apply');
}
console.log('✔ plugin regressions (R3 re-baselines a /plugin update, R4 empty backup never destroys, R5 broken anchor reported)');

// ── notifier ────────────────────────────────────────────────────────────────────────────
{
  freshSandbox();
  cli(['adr-index', 'install']);
  cli(['monitor', 'run']);
  if (notify() !== '') fail('N1: notifier spoke when everything was healthy');            // N1

  // Break an anchor, let the monitor find it.
  fs.writeFileSync(pluginFile(IMPORT_REL), PRISTINE[IMPORT_REL.join('/')].split('storedEdges++').join('edgesWritten++'));
  cli(['monitor', 'run']);

  const first = notify();                                                                  // N2
  if (!/ATTENTION/.test(first) || !/edges-miscount/.test(first)) fail(`N2: notifier did not announce the broken patch — got: ${first || '(silence)'}`);
  if (notify() !== '') fail('N3: notifier repeated itself on the next prompt (not rate-limited)');  // N3

  // N4 — fix it, and the warning must stop ON ITS OWN. A stale warning is as bad as no warning.
  //
  // This used to call freshSandbox(), which rm -rf's the WHOLE sandbox — INCLUDING problems.json and
  // notify-state.json. So N4 started from "no problem record at all" and was simply a duplicate of N1.
  // Mutating recordProblems() to never clear the record — so a healthy install nags every 30 minutes,
  // forever, which is precisely the failure this test names — passed.
  //
  // Repair the plugin file IN PLACE, and leave the state dir alone, so the recorded problem has to be
  // cleared by the code rather than by the test's own cleanup.
  fs.writeFileSync(pluginFile(IMPORT_REL), PRISTINE[IMPORT_REL.join('/')]);
  cli(['adr-index', 'install']);
  cli(['monitor', 'run']);

  // Assert the RECORD IS GONE, not merely that the notifier is quiet.
  //
  // Quiet is not proof: N3 already consumed the announcement, so the 30-minute rate limit keeps it
  // silent for the rest of this test whether the record was cleared or not. A stale record would sit
  // there and re-announce on a perfectly healthy install half an hour later — the exact failure this
  // test names — and `notify() === ''` would never see it.
  const rec = path.join(STATE, 'problems.json');
  if (fs.existsSync(rec)) {
    fail(`N4: the problem record SURVIVED the fix — it will re-announce on a healthy install in 30 min:\n  ${fs.readFileSync(rec, 'utf8')}`);
  }
  if (notify() !== '') fail('N4: notifier still warning after the problem was fixed');     // N4
}
console.log('✔ notifier (N1 silent when healthy, N2 announces, N3 rate-limited, N4 self-clears)');

// ── monitor liveness ────────────────────────────────────────────────────────────────────
// `monitor install` is not called — it would schedule a real launchd job. monitor.json is
// written directly, which is exactly what installMonitor() does.
{
  const meta = (o) => {
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(path.join(STATE, 'monitor.json'), JSON.stringify({
      node: process.execPath,
      script: path.join(REPO, 'lib', 'cwd', 'monitor-run.mjs'),
      intervalSec: 300,
      ...o,
    }));
  };
  const beat = (ageMs) => fs.writeFileSync(path.join(STATE, 'heartbeat'), 'x') ||
    fs.utimesSync(path.join(STATE, 'heartbeat'), new Date(), new Date(Date.now() - ageMs));

  freshSandbox();
  cli(['adr-index', 'install']);
  cli(['monitor', 'run']);
  if (notify() !== '') fail('H1: warned about a monitor that was never installed');        // H1

  meta({}); beat(3 * 60 * 60 * 1000); fs.rmSync(path.join(STATE, 'notify-state.json'), { force: true });
  if (!/has not run/.test(notify())) fail('H2: a monitor that has not ticked for 3h was not reported');  // H2

  meta({ node: '/nonexistent/node/bin/node' }); fs.rmSync(path.join(STATE, 'notify-state.json'), { force: true });
  if (!/interpreter is GONE/.test(notify())) fail('H3: a vanished node interpreter was not reported');   // H3

  meta({ script: '/gone/monitor-run.mjs' }); fs.rmSync(path.join(STATE, 'notify-state.json'), { force: true });
  if (!/job script is missing/.test(notify())) fail('H4: a missing job script was not reported');        // H4
}
console.log('✔ monitor liveness (H1 silent when absent, H2 stale, H3 dead interpreter, H4 missing script)');
