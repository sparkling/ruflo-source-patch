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
function stateTargets() { const s = stateRaw(); return s.paused ? [] : s.patchTargets; }

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

const TARGETS = ['cwd', 'daemon', 'memory', 'all'];
const ACTIONS = ['install', 'uninstall', 'patch', 'revert', 'status'];

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
  // I6 — idempotence: `patch` applied twice must be a no-op the SECOND time.
  // (Comparing against a pre-patch snapshot would be wrong: if the state is paused,
  // `patch` legitimately un-pauses and re-applies.)
  cli(['all', 'patch']);
  const snap = FILES.map((rel) => fs.readFileSync(filePath(rel), 'utf8'));
  cli(['all', 'patch']);
  cli(['monitor', 'run']);
  FILES.forEach((rel, i) => {
    if (fs.readFileSync(filePath(rel), 'utf8') !== snap[i]) {
      console.log(`\n✘ I6 idempotence broken on ${rel} after ${JSON.stringify(seq)}`);
      process.exit(1);
    }
  });
}
console.log(`✔ ${RUNS} random sequences × ${LEN} steps — all invariants held (I1 entry⇔target, I2 parses, I3 pristine restore, I4 no temps, I5 check exit code, I6 idempotent)`);
