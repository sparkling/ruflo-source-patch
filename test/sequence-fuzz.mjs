// Property fuzz: ANY sequence of <target> <action> must leave the library in a state
// that is exactly "pristine + entries of the installed target set".
//
// Invariants checked after EVERY step (independently of apply()'s internals):
//   I1  every entry is applied  <=>  its target is in state.json
//   I2  every patched file still parses as valid ESM
//   I3  state empty  =>  every file byte-identical to pristine, no .rsp-backup left
//   I4  no stray temp files ever
//   I5  `monitor check` exit code == (drift present ? 1 : 0)
//   I6  idempotence: running the same install twice changes nothing

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = '/Users/henrik/source/ruflo-source-patch';
const SB = process.argv[2];
const REAL = '/Users/henrik/.npm/_npx/9806d7724c607a8d/node_modules';
const FILES = [
  '@claude-flow/cli/dist/src/fs-secure.js',
  '@claude-flow/cli/dist/src/memory/memory-initializer.js',
  '@claude-flow/cli/dist/src/commands/daemon.js',
  '@claude-flow/cli/dist/src/services/daemon-autostart.js',
  '@claude-flow/cli-core/dist/src/mcp-tools/types.js',
];

function freshSandbox() {
  fs.rmSync(SB, { recursive: true, force: true });
  fs.mkdirSync(path.join(SB, 'home', '.claude'), { recursive: true });
  fs.writeFileSync(path.join(SB, 'home', '.claude', 'settings.json'), '{}');
  for (const rel of FILES) {
    const dest = path.join(SB, 'npx', 'h', 'node_modules', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const src = fs.existsSync(`${REAL}/${rel}.rsp-backup`) ? `${REAL}/${rel}.rsp-backup` : `${REAL}/${rel}`;
    fs.copyFileSync(src, dest);
  }
}
const filePath = (rel) => path.join(SB, 'npx', 'h', 'node_modules', rel);
const PRISTINE = {};

const env = { ...process.env, RUFLO_SOURCE_PATCH_HOME: path.join(SB, 'home'), RUFLO_NPX_ROOT: path.join(SB, 'npx') };
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), ...args], { env, encoding: 'utf8' });

// Import the entry table so we can assert per-entry, independent of apply().
const lib = await import(`file://${REPO}/lib/cwd/patch-library.mjs`);

function stateRaw() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SB, 'home', '.ruflo-source-patch', 'state.json'), 'utf8'));
  } catch { return { patchTargets: [], paused: false }; }
}
function stateTargets() { return stateRaw().patchTargets || []; }

// Re-derive expectations from the ENTRIES table (not from apply()).
const ENTRY_PROBE = {
  'cwd/daemon-autostart': { rel: '@claude-flow/cli/dist/src/services/daemon-autostart.js', needle: 'projectRoot = __rufloResolveRoot(projectRoot);' },
  'cwd/memory-root': { rel: '@claude-flow/cli/dist/src/memory/memory-initializer.js', needle: "_memoryRootCache = path.resolve(__rufloResolveRoot(process.cwd()), '.swarm');" },
  'cwd/cli-core-getProjectCwd': { rel: '@claude-flow/cli-core/dist/src/mcp-tools/types.js', needle: 'return __rufloResolveRoot(process.cwd());' },
  'daemon/command-root': { rel: '@claude-flow/cli/dist/src/commands/daemon.js', needle: 'const daemon = getDaemon(__rufloResolveRoot(process.cwd()));' },
  'memory/wal-coherent-reads': { rel: '@claude-flow/cli/dist/src/fs-secure.js', needle: '__rufloCheckpointWal(path);' },
  'memory/write-lock': { rel: '@claude-flow/cli/dist/src/memory/memory-initializer.js', needle: 'storeEntry = __rufloGuard(storeEntry);' },
};
const OWNER = { 'cwd/daemon-autostart': 'cwd', 'cwd/memory-root': 'cwd', 'cwd/cli-core-getProjectCwd': 'cwd',
  'daemon/command-root': 'daemon', 'memory/wal-coherent-reads': 'memory', 'memory/write-lock': 'memory' };

function check(step, seq) {
  const st = stateTargets();
  const errs = [];

  // I1 — entry applied  <=>  target installed
  for (const [id, { rel, needle }] of Object.entries(ENTRY_PROBE)) {
    const src = fs.readFileSync(filePath(rel), 'utf8');
    const applied = src.includes(needle);
    const should = st.includes(OWNER[id]);
    if (applied !== should) errs.push(`I1 ${id}: applied=${applied} but target ${OWNER[id]} installed=${should}`);
  }

  // I2 — everything still parses
  for (const rel of FILES) {
    const r = spawnSync(process.execPath, ['--check', filePath(rel)], { encoding: 'utf8' });
    if (r.status !== 0) errs.push(`I2 ${rel}: SYNTAX ERROR`);
  }

  // I3 — empty state => byte-identical to pristine, no backups
  if (st.length === 0) {
    for (const rel of FILES) {
      if (fs.readFileSync(filePath(rel), 'utf8') !== PRISTINE[rel]) errs.push(`I3 ${rel}: not restored to pristine`);
      if (fs.existsSync(`${filePath(rel)}.rsp-backup`)) errs.push(`I3 ${rel}: backup left behind`);
    }
  }

  // I4 — no stray temps
  for (const rel of FILES) {
    const dir = path.dirname(filePath(rel));
    for (const f of fs.readdirSync(dir)) if (f.includes('.rsp-tmp-')) errs.push(`I4 stray temp ${f}`);
  }

  // I7 — NEVER destroy a vendor file. This one is a headstone, not a hypothetical: reading a
  // target mid-npx-extraction yielded '', which was taken as pristine, matched no anchors, and
  // got written straight back — truncating the real file to zero bytes and deleting its backup.
  // A patcher that eats the code it patches is worse than the bug it fixes.
  for (const rel of FILES) {
    if (fs.statSync(filePath(rel)).size === 0) errs.push(`I7 ${rel}: TRUNCATED to zero bytes`);
  }

  // I5 — monitor check exit code matches reality
  const drift = Object.entries(ENTRY_PROBE).some(([id, { rel, needle }]) =>
    st.includes(OWNER[id]) && !fs.readFileSync(filePath(rel), 'utf8').includes(needle));
  const rc = cli(['monitor', 'check']).status;
  if ((rc === 1) !== drift) errs.push(`I5 monitor check exit=${rc} but drift=${drift}`);

  if (errs.length) {
    console.log(`\n✘ FAILED after step ${step}: ${JSON.stringify(seq)}`);
    console.log(`  state=[${st}]`);
    for (const e of errs) console.log(`  ${e}`);
    process.exit(1);
  }
}

const TARGETS = ['cwd', 'daemon', 'memory'];
const ACTIONS = ['install', 'uninstall', 'status'];

freshSandbox();
for (const rel of FILES) PRISTINE[rel] = fs.readFileSync(filePath(rel), 'utf8');

let rng = 12345;
const rand = (n) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };

const RUNS = 60, LEN = 8;
for (let run = 0; run < RUNS; run++) {
  freshSandbox();
  const seq = [];
  for (let i = 0; i < LEN; i++) {
    const t = TARGETS[rand(TARGETS.length)];
    const a = ACTIONS[rand(ACTIONS.length)];
    seq.push(`${t} ${a}`);
    cli([t, a]);
    cli(['monitor', 'run']);   // a monitor tick after EVERY step — must never violate an invariant
    check(i, seq);
  }
  // I6 — idempotence: installing twice is a no-op the second time.
  for (const t of TARGETS) cli([t, 'install']);
  const snap = FILES.map((rel) => fs.readFileSync(filePath(rel), 'utf8'));
  for (const t of TARGETS) cli([t, 'install']);
  cli(['monitor', 'run']);
  FILES.forEach((rel, i) => {
    if (fs.readFileSync(filePath(rel), 'utf8') !== snap[i]) {
      console.log(`\n✘ I6 idempotence broken on ${rel} after ${JSON.stringify(seq)}`);
      process.exit(1);
    }
  });
}
console.log(`✔ ${RUNS} random sequences × ${LEN} steps — all invariants held (I1 entry⇔target, I2 parses, I3 pristine restore, I4 no temps, I5 check exit code, I6 idempotent, I7 never truncated)`);

// ── Deterministic regressions ───────────────────────────────────────────────────────────
// Two bugs that shipped. Random sequences never generated either, because both need the
// VENDOR file to change underneath us — something no sequence of our own commands can do.
// Pinned here so they cannot come back.

const REL = '@claude-flow/cli/dist/src/services/daemon-autostart.js';
const fail = (m) => { console.log(`\n✘ ${m}`); process.exit(1); };

// R1a — an EMPTY BACKUP must never be used as pristine. This is the lethal one: with an
// empty `saved`, a perfectly healthy vendor file yields pristine='', no anchor matches,
// and the rebuild writes that empty pristine straight back over the real file. Measured
// before the guard: 3954 bytes -> 0 in ONE monitor tick.
{
  freshSandbox();
  for (const t of TARGETS) cli([t, 'install']);
  fs.writeFileSync(`${filePath(REL)}.rsp-backup`, '');   // poisoned pristine (a torn read)
  const before = fs.statSync(filePath(REL)).size;
  cli(['monitor', 'run']);
  if (fs.statSync(filePath(REL)).size === 0) fail(`R1a: DESTROYED the vendor file (${before} bytes -> 0) from an empty backup`);
}

// R1c — the same poison, via UNINSTALL. restore() bypasses readPristine() entirely: it just
// copies the backup back, so an empty backup makes `uninstall` truncate the file it is meant
// to be restoring. The most destructive command in the tool was the one that undoes things.
{
  freshSandbox();
  for (const t of TARGETS) cli([t, 'install']);
  fs.writeFileSync(`${filePath(REL)}.rsp-backup`, '');
  const before = fs.statSync(filePath(REL)).size;
  for (const t of TARGETS) cli([t, 'uninstall']);
  if (fs.statSync(filePath(REL)).size === 0) fail(`R1c: UNINSTALL destroyed the vendor file (${before} bytes -> 0) from an empty backup`);
}

// R1b — an empty vendor file is never patched, and never adopted as pristine.
{
  freshSandbox();
  for (const t of TARGETS) cli([t, 'install']);
  fs.writeFileSync(filePath(REL), '');           // mid-extraction: npx made the file, hasn't filled it
  cli(['monitor', 'run']);
  if (fs.statSync(filePath(REL)).size !== 0) fail('R1b: wrote to a zero-byte vendor file instead of leaving it alone');
  if (fs.existsSync(`${filePath(REL)}.rsp-backup`) && fs.statSync(`${filePath(REL)}.rsp-backup`).size === 0) {
    fail('R1b: adopted an EMPTY file as pristine');
  }
}

// R2 — an in-place vendor update is preserved, not reverted to our stale backup.
{
  freshSandbox();
  for (const t of TARGETS) cli([t, 'install']);
  const NEW = `// VENDOR-UPDATED-IN-PLACE\n${PRISTINE[REL]}`;
  fs.writeFileSync(filePath(REL), NEW);          // /plugin update, or npm update -g: same path, new bytes
  cli(['monitor', 'run']);

  const after = fs.readFileSync(filePath(REL), 'utf8');
  if (!after.includes('VENDOR-UPDATED-IN-PLACE')) fail('R2: CLOBBERED an upstream update by restoring a stale backup');
  if (!after.includes('__rufloResolveRoot')) fail('R2: failed to re-apply the patch on top of the new vendor file');

  const backup = fs.readFileSync(`${filePath(REL)}.rsp-backup`, 'utf8');
  if (!backup.includes('VENDOR-UPDATED-IN-PLACE')) fail('R2: backup not re-baselined to the new vendor file');
  if (backup.includes('__rufloResolveRoot')) fail('R2: baked our own patch into "pristine" — uninstall would no longer be clean');
}

console.log('✔ regressions pinned (R1a empty backup never destroys, R1b never truncates, R1c uninstall never destroys, R2 re-baselines instead of reverting an update)');
