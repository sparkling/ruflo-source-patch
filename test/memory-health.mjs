// Behavioural tests for `memory-health` (ruvnet-brain's Onboarding Console scoring the WRONG
// project's memory store — see patcher.mjs / ADR-025). Drives the REAL vendor file (its
// `.rsp-backup` if the patch is installed on this machine, else the file itself), and SKIPS rather
// than fabricates a fixture if ruvnet-brain isn't installed here at all — same discipline as
// design-wall.mjs / verify-interface's reporting.mjs block.
//
// WHY NOT boot the real console and observe kickRefresh() at runtime, the way design-wall.mjs spawns
// its (small, dependency-free) bash gate and watches it block/allow: onboarding-console.mjs pulls in
// nine sibling modules (stack-sync.mjs, memory-doctor.mjs, console-engine.mjs, ...) and its
// `--refresh-cache` path can reach the npm registry via `gatherStack()`'s audit — slow, and
// network-dependent in a suite meant to run offline and fast. The fix itself is a single literal
// substitution, not new runtime logic, so the risk that actually matters is: does the anchor match
// production bytes UNIQUELY, does it touch ONLY the one intended spawn call and leave the file's
// other eight `REPO` references (CONSOLE_DIR, the SBOM path, gatherMemory's fallback, the script
// runner's own cwd:REPO, gatesSurvey) untouched, and does install/uninstall round-trip cleanly. All
// of that is provable at the byte level against the real file, with no subprocess needed.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SANDBOX = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'mhealth-'));
process.env.RUFLO_SOURCE_PATCH_HOME = SANDBOX;      // <- BEFORE any lib/ (or fixtures.mjs) import
process.env.RSP_NO_SELF_UPDATE = '1';

// Dynamic import, after the env var — a static top-of-file import would freeze paths.mjs's
// HOME_BASE to the REAL machine's home before the sandbox env var ever took effect (measured live
// in design-wall.mjs/mcp-prefix.mjs: a static import there silently patched the developer's actual
// ~/.claude/plugins/... instead of the sandbox).
const { pristineBytes } = await import('./fixtures.mjs');

let fail = 0;
const check = (desc, cond) => { console.log(`${cond ? '✓' : '✘'} ${desc}`); if (!cond) fail = 1; };

const REAL_CONSOLE = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces', 'ruvnet-brain', 'scripts', 'onboarding-console.mjs');
if (!fs.existsSync(REAL_CONSOLE) && !fs.existsSync(`${REAL_CONSOLE}.rsp-backup`)) {
  console.log('· memory-health (SKIPPED — the ruvnet-brain plugin is not installed)');
  process.exit(0);
}

const consoleDir = path.join(SANDBOX, '.claude', 'plugins', 'marketplaces', 'ruvnet-brain', 'scripts');
const consoleScript = path.join(consoleDir, 'onboarding-console.mjs');
fs.mkdirSync(consoleDir, { recursive: true });
const pristine = pristineBytes(REAL_CONSOLE, 'memoryHealth').toString('utf8');
fs.writeFileSync(consoleScript, pristine);

const BUGGY_LINE = `const child = spawn(process.execPath, [SELF, '--refresh-cache'], { detached: true, stdio: 'ignore', cwd: REPO });`;
const FIXED_MARKER = `cwd: process.cwd() });`;

// MH1 — BEFORE the patch, the exact buggy spawn line is present, and present exactly ONCE. If this
// fails, either the fixture is not the buggy version (rest of the suite would be vacuous) or
// upstream has restructured the file and the anchor is no longer unique — both must be caught here,
// not discovered by a patch silently applying to the wrong place.
const occurrences = (src, needle) => { let n = 0, i = 0; while ((i = src.indexOf(needle, i)) !== -1) { n++; i += needle.length; } return n; };
check('MH1 unpatched vendor file contains the buggy kickRefresh spawn line exactly once (fixture proven buggy)', occurrences(pristine, BUGGY_LINE) === 1);

// The other REPO usages in this same file MUST survive the patch untouched — this file uses REPO
// eight times (CONSOLE_DIR, gatherMemory's fallback twice, the SBOM path + its path.relative,
// gatesSurvey, the script-runner's own legitimate cwd:REPO). A patch that is not surgical — e.g. an
// anchor accidentally matching more broadly — would silently break the console's other features.
const OTHER_REPO_USES = [
  `const CONSOLE_DIR = path.join(REPO, 'console');`,
  `const project = fs.existsSync(path.join(cwd, '.swarm/memory.db')) ? cwd : REPO;`,
  `const SBOM_PATH = path.join(REPO, 'sbom', 'ruvnet-brain.cdx.json');`,
  `const rel = path.relative(REPO, SBOM_PATH);`,
  `try { gates = gatesSurvey({ repo: REPO }); } catch { gates = null; }`,
];
check('MH2 the file\'s other REPO usages are present before patching (baseline for the surgical-edit check below)',
  OTHER_REPO_USES.every((s) => pristine.includes(s)));

// Apply the patch.
const { applyComposed, reconcile } = await import('../lib/plugin-compose.mjs');
const a1 = applyComposed(['memory-health']);
check('MH3 apply patched the onboarding-console.mjs copy', a1.patched >= 1 && a1.incomplete === 0 && a1.errors === 0);

const patched = fs.readFileSync(consoleScript, 'utf8');

// MH4 — AFTER the patch, the spawn call reads the live process.cwd(), not the hardcoded REPO.
check('MH4 patched file\'s kickRefresh spawn call now uses cwd: process.cwd()', patched.includes(FIXED_MARKER));
check('MH5 the buggy exact line is gone', !patched.includes(BUGGY_LINE));

// MH6 — surgical edit: every OTHER REPO usage in the file is untouched, byte-for-byte.
check('MH6 the file\'s other REPO usages are UNCHANGED after patching (edit was surgical, not a blanket REPO->cwd swap)',
  OTHER_REPO_USES.every((s) => patched.includes(s)));

// MH7 — idempotent: re-applying against an already-patched file changes nothing.
const a2 = applyComposed(['memory-health']);
check('MH7 re-apply against an already-patched file is a no-op', a2.patched === 0 && a2.unchanged >= 1);

// MH8 — uninstall restores byte-identical vendor, no .rsp-backup left.
reconcile([], ['memory-health']);
check('MH8 uninstall restores byte-identical vendor, no .rsp-backup left',
  fs.readFileSync(consoleScript, 'utf8') === pristine && !fs.existsSync(`${consoleScript}.rsp-backup`));

if (fail) { console.log('\n✘ test/memory-health.mjs FAILED'); process.exit(1); }
console.log('\n✓ memory-health: all checks passed');
