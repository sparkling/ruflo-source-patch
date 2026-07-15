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
import { spawnSync, execFileSync, spawn } from 'node:child_process';
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

const env = { ...process.env, RUFLO_SOURCE_PATCH_HOME: HOME, RUFLO_NPX_ROOT: path.join(SB, 'npx'),
  // Sandbox the GLOBAL npm root too. Without this, nodeModulesDirs() returns the sandbox PLUS the
  // developer's real global node_modules — so on any machine with a global @claude-flow/cli the suite
  // would patch, restore and re-baseline the REAL install (and R1a/R1c would poison its backups),
  // invisibly, because every assertion probes only sandbox paths.
  RUFLO_GLOBAL_ROOT: path.join(SB, 'global') };
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

// SH3 — the `run` ACTION: one step instead of install + hunt-for-the-path + bash. `dedupe-bundle run
// <dir> --dry-run` must materialize the CURRENT script, exec it, and forward the args — so the dry-run
// still touches nothing, driven entirely through the CLI.
const p3 = path.join(SB, 'proj3');
fs.mkdirSync(path.join(p3, '.claude', 'skills', 'keep'), { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: p3 });
fs.writeFileSync(path.join(p3, '.claude', 'skills', 'keep', 'SKILL.md'), 'mine\n');
fs.writeFileSync(path.join(p3, '.claude', 'settings.json'), '{}');
// remove the materialized copy first, to prove `run` materializes on its own (no prior `install`).
fs.rmSync(path.join(STATE, 'dedupe-bundle'), { recursive: true, force: true });
const runRes = cli(['dedupe-bundle', 'run', p3, '--dry-run']);
if (!/removed|kept|DRY-RUN/i.test(out(runRes))) fail(`SH3 \`dedupe-bundle run --dry-run\` produced no script output:\n${out(runRes)}`);
if (!fs.existsSync(path.join(STATE, 'dedupe-bundle', 'ruflo-dedupe-bundle.sh'))) fail('SH3 `run` did not materialize the script on demand');
if (!fs.existsSync(path.join(p3, '.claude', 'skills', 'keep', 'SKILL.md'))) fail('SH3 `run … --dry-run` DELETED a project file — args not forwarded, or dry-run ignored');

// SH4 — MCP dedup. A project-local standalone ruflo/claude-flow .mcp.json server DUPLICATES the
// plugin-provided one (two writers on one .swarm/memory.db, #2621). dedupe removes ONLY that server,
// matched by COMMAND SIGNATURE, KEEPS the others, and deletes the file if it empties. A FAKE plugin dir
// via RUFLO_PLUGIN_DIR keeps this hermetic (not dependent on the developer's real plugin cache).
const fakePlug = path.join(SB, 'fakeplug', 'ruflo');
fs.mkdirSync(path.join(fakePlug, 'ruflo-core', 'skills', 'foo'), { recursive: true });
fs.writeFileSync(path.join(fakePlug, 'ruflo-core', 'skills', 'foo', 'SKILL.md'), 'x\n');
fs.writeFileSync(path.join(fakePlug, 'ruflo-core', '.mcp.json'),
  JSON.stringify({ mcpServers: { ruflo: { command: 'npx', args: ['-y', '@claude-flow/cli@latest', 'mcp', 'start'] } } }));
const mcpEnv = { ...process.env, HOME, RUFLO_PLUGIN_DIR: fakePlug };
const mkProj = (name, mcp) => {
  const d = path.join(SB, name);
  fs.mkdirSync(path.join(d, '.claude'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, '.claude', 'settings.json'), '{}');
  fs.writeFileSync(path.join(d, '.mcp.json'), JSON.stringify(mcp));
  return d;
};
const srv = (d) => Object.keys(JSON.parse(fs.readFileSync(path.join(d, '.mcp.json'), 'utf8')).mcpServers || {});

// SH4a — removes the standalone server, KEEPS ruv-swarm; and --dry-run is inert first.
const p4 = mkProj('proj4', { mcpServers: {
  'claude-flow': { command: 'npx', args: ['-y', 'ruflo@latest', 'mcp', 'start'], autoStart: false },
  'ruv-swarm':   { command: 'npx', args: ['-y', 'ruv-swarm', 'mcp', 'start'], optional: true },
} });
const p4before = fs.readFileSync(path.join(p4, '.mcp.json'), 'utf8');
spawnSync('bash', [dedupe, p4, '--dry-run'], { encoding: 'utf8', env: mcpEnv });
if (fs.readFileSync(path.join(p4, '.mcp.json'), 'utf8') !== p4before) fail('SH4a dedupe --dry-run MODIFIED .mcp.json');
spawnSync('bash', [dedupe, p4, '--no-backup'], { encoding: 'utf8', env: mcpEnv });
if (!fs.existsSync(path.join(p4, '.mcp.json'))) fail('SH4a .mcp.json was deleted — a non-ruflo server (ruv-swarm) must survive, so the file must not empty');
if (srv(p4).includes('claude-flow')) fail('SH4a the standalone claude-flow server was not removed');
if (!srv(p4).includes('ruv-swarm')) fail('SH4a dedupe removed ruv-swarm too — it must keep non-ruflo servers');

// SH4b — a .mcp.json whose ONLY server is the standalone ruflo one is DELETED (true plugin-only).
const p5 = mkProj('proj5', { mcpServers: { 'claude-flow': { command: 'npx', args: ['-y', 'ruflo@latest', 'mcp', 'start'] } } });
spawnSync('bash', [dedupe, p5, '--no-backup'], { encoding: 'utf8', env: mcpEnv });
if (fs.existsSync(path.join(p5, '.mcp.json'))) fail('SH4b a .mcp.json with only the standalone server should be deleted, but it survived');

// SH4c — the "provided?" gate. With NO plugin MCP server the project registration is a real choice, not a
// duplicate, and must be LEFT ALONE. This is the guard that stops the removal from being unconditional.
const barePlug = path.join(SB, 'bareplug', 'ruflo');
fs.mkdirSync(path.join(barePlug, 'ruflo-core', 'skills', 'foo'), { recursive: true });
fs.writeFileSync(path.join(barePlug, 'ruflo-core', 'skills', 'foo', 'SKILL.md'), 'x\n'); // a skill, but NO plugin .mcp.json
const p6 = mkProj('proj6', { mcpServers: { 'claude-flow': { command: 'npx', args: ['-y', 'ruflo@latest', 'mcp', 'start'] } } });
spawnSync('bash', [dedupe, p6, '--no-backup'], { encoding: 'utf8', env: { ...process.env, HOME, RUFLO_PLUGIN_DIR: barePlug } });
if (!fs.existsSync(path.join(p6, '.mcp.json')) || !srv(p6).includes('claude-flow'))
  fail('SH4c dedupe removed the standalone server though the plugin provides none — the prune is not gated on "plugin provides MCP"');

// SH5 — stopping the orphaned server is the DEFAULT (removing the registration otherwise leaves a second
// writer on memory.db until restart). It SIGTERMs the server, guarded so the plugin server (same command)
// is never touched, and --keep-server opts out. The env-less SKIP, dry-run, and opt-out paths are hermetic;
// the real kill needs a process whose env the OS exposes to another process, which macOS `ps e` does NOT do
// for a synthetic process (only real ones), so the live-kill assertions run on Linux via /proc and are
// announced-as-skipped on Darwin rather than silently dropped.
const stopEnv = { ...process.env, HOME, RUFLO_PLUGIN_DIR: fakePlug };

// SH5a — a removed entry with NO distinctive env yields no marker: its server can't be told apart from the
// plugin server, so nothing is killed and the report SAYS SO (never a silent no-op, never a guess). No flag:
// stopping is the default.
const s5a = mkProj('stop5a', { mcpServers: { 'claude-flow': { command: 'npx', args: ['-y', 'ruflo@latest', 'mcp', 'start'] } } });
const r5a = spawnSync('bash', [dedupe, s5a, '--no-backup'], { encoding: 'utf8', env: stopEnv });
if (!/NOT stopped|no distinctive/i.test(out(r5a))) fail(`SH5a an env-less entry must report the server can't be identified, not silently skip:\n${out(r5a)}`);

// SH5b — --dry-run signals NOTHING and still reports (stop is default). Any real ruflo server on the machine
// is spared by the containment guard (its cwd is not inside this sandbox project), which this exercises.
const s5b = mkProj('stop5b', { mcpServers: { 'claude-flow': { command: 'npx', args: ['-y', 'ruflo@latest', 'mcp', 'start'], env: { CLAUDE_FLOW_MODE: 'v3' } } } });
const b5before = fs.readFileSync(path.join(s5b, '.mcp.json'), 'utf8');
const r5b = spawnSync('bash', [dedupe, s5b, '--no-backup', '--dry-run'], { encoding: 'utf8', env: stopEnv });
if (fs.readFileSync(path.join(s5b, '.mcp.json'), 'utf8') !== b5before) fail('SH5b --dry-run MODIFIED .mcp.json');
if (!/server:/i.test(out(r5b))) fail(`SH5b --dry-run produced no server report:\n${out(r5b)}`);

// SH5d — --keep-server opts out: the registration is still removed, but no server line is emitted and the
// keep-server note is. Hermetic, all platforms.
const s5d = mkProj('stop5d', { mcpServers: { 'claude-flow': { command: 'npx', args: ['-y', 'ruflo@latest', 'mcp', 'start'], env: { CLAUDE_FLOW_MODE: 'v3' } } } });
const r5d = spawnSync('bash', [dedupe, s5d, '--no-backup', '--keep-server'], { encoding: 'utf8', env: stopEnv });
if (/^\s*server:/im.test(out(r5d))) fail(`SH5d --keep-server still ran the stop-server path (emitted a "server:" line):\n${out(r5d)}`);
if (!/keeps running until you restart/i.test(out(r5d))) fail(`SH5d --keep-server did not warn the server is left running:\n${out(r5d)}`);

// SH5c — the real kill + both guards + the --keep-server opt-out, on Linux (where /proc exposes env).
if (process.platform === 'linux') {
  const argv0 = 'ruflo mcp start';
  const spawnFake = (cwd, extraEnv) => spawn('sleep', ['60'], { cwd, argv0, detached: true, stdio: 'ignore', env: { ...process.env, ...extraEnv } });
  const alive = (p) => { try { process.kill(p.pid, 0); return true; } catch { return false; } };
  const wait = (ms) => spawnSync('sleep', [String(ms / 1000)]);
  const s5c = mkProj('stop5c', { mcpServers: { 'claude-flow': { command: 'npx', args: ['-y', 'ruflo@latest', 'mcp', 'start'], env: { CLAUDE_FLOW_MODE: 'v3' } } } });
  const outside = path.join(SB, 'stop5c-outside'); fs.mkdirSync(outside, { recursive: true });
  const target = spawnFake(s5c, { CLAUDE_FLOW_MODE: 'v3' });                 // in-project + marker -> KILL (default)
  const pluginish = spawnFake(s5c, { CLAUDE_FLOW_MCP_TRANSPORT: 'stdio' });  // in-project, plugin env -> SPARE
  const elsewhere = spawnFake(outside, { CLAUDE_FLOW_MODE: 'v3' });          // marker but out-of-tree -> SPARE
  wait(500);
  spawnSync('bash', [dedupe, s5c, '--no-backup'], { encoding: 'utf8', env: stopEnv });  // no flag: default stop
  wait(500);
  const tKilled = !alive(target), pAlive = alive(pluginish), eAlive = alive(elsewhere);
  for (const p of [target, pluginish, elsewhere]) { try { process.kill(p.pid); } catch {} }
  if (!tKilled) fail('SH5c the in-project standalone server (env marker) was NOT stopped by default');
  if (!pAlive) fail('SH5c the plugin server (same command, plugin env) was killed — the env guard failed');
  if (!eAlive) fail('SH5c a server in ANOTHER directory was killed — the containment guard failed');
  // --keep-server must leave a matching server alone
  const s5k = mkProj('stop5k', { mcpServers: { 'claude-flow': { command: 'npx', args: ['-y', 'ruflo@latest', 'mcp', 'start'], env: { CLAUDE_FLOW_MODE: 'v3' } } } });
  const keep = spawnFake(s5k, { CLAUDE_FLOW_MODE: 'v3' });
  wait(500);
  spawnSync('bash', [dedupe, s5k, '--no-backup', '--keep-server'], { encoding: 'utf8', env: stopEnv });
  wait(500);
  const keptAlive = alive(keep); try { process.kill(keep.pid); } catch {}
  if (!keptAlive) fail('SH5c --keep-server killed the server anyway');
  console.log('✔   SH5c (linux) default kill: in-project marked server stopped, plugin + out-of-tree spared, --keep-server leaves it running');
} else {
  console.log(`✔   SH5c SKIPPED on ${process.platform} (ps cannot expose a synthetic process’s env; live kill validated against the real server by hand)`);
}

console.log('✔ shell scripts (SH1 all parse, SH2 dry-run deletes nothing, SH3 `run` materializes+forwards, SH4 MCP dedup removes the standalone server/keeps others/deletes-when-empty/gated on the plugin, SH5 stop-server is default: reports when it cannot identify, dry-run inert, --keep-server opts out, guarded real kill)');

// ─── CW: the project-root resolver, EXECUTED (not grepped) ───────────────────
//
// This is the code we inject into 150+ vendor files. Every prior test only ever asserted that the
// STRING was present. A resolver that returns the wrong directory would have passed all of them, and
// the failure it produces is the silent kind: state written to a drifted directory and never read again.
//
// So: build the fragment and run it.
const { FRAGMENTS: FRAGS } = await import(`file://${path.join(REPO, 'lib', 'cwd', 'patch-library.mjs')}`);
const resolverSrc = `${FRAGS.req.src}\n${FRAGS.resolveRoot.src}\nexport { __rufloResolveRoot };`;
const resolverPath = path.join(SB, 'resolver.mjs');
fs.writeFileSync(resolverPath, resolverSrc);
const { __rufloResolveRoot } = await import(`file://${resolverPath}`);

const mk = (...segs) => { const d = path.join(SB, 'cw', ...segs); fs.mkdirSync(d, { recursive: true }); return d; };

// CW1 — a drifted cwd resolves back to the project root. THE WHOLE POINT.
const root1 = mk('p1');
fs.mkdirSync(path.join(root1, '.git'), { recursive: true });
const deep1 = mk('p1', 'src', 'deep', 'nested');
if (__rufloResolveRoot(deep1) !== root1) {
  fail(`CW1 a deep subdir did not resolve to the project root: ${__rufloResolveRoot(deep1)} != ${root1}`);
}

// CW2 — `.git` ALONE IS NOT ENOUGH, which is what this used to use. A package inside a monorepo has its
// own `.claude/` and no `.git`, so a bare .git walk sails past it and pools every package's state into
// one store at the outer repo.
const outer = mk('p2');
fs.mkdirSync(path.join(outer, '.git'), { recursive: true });
const pkg = mk('p2', 'packages', 'api');
fs.writeFileSync(path.join(pkg, 'CLAUDE.md'), '# api');
fs.mkdirSync(path.join(pkg, '.claude'), { recursive: true });
if (__rufloResolveRoot(path.join(pkg, 'src')) !== pkg) {
  fail(`CW2 a monorepo package with CLAUDE.md+.claude/ resolved to the OUTER repo — every package would share one store`);
}

// CW3 — CLAUDE.md ALONE is NOT a project root. `docs/CLAUDE.md` is a document, not a project, and
// treating it as one would anchor state inside the docs folder. ADR-0100 requires BOTH markers.
const root3 = mk('p3');
fs.mkdirSync(path.join(root3, '.git'), { recursive: true });
const docs = mk('p3', 'docs');
fs.writeFileSync(path.join(docs, 'CLAUDE.md'), '# a doc, not a project');   // no sibling .claude/
if (__rufloResolveRoot(docs) !== root3) {
  fail(`CW3 a lone docs/CLAUDE.md was treated as a project root: ${__rufloResolveRoot(docs)}`);
}

// CW4 — the `.ruflo-project` sentinel wins over everything below it. An explicit contract is explicit.
const inner4 = mk('p4', 'sub');
fs.mkdirSync(path.join(SB, 'cw', 'p4', '.git'), { recursive: true });
fs.writeFileSync(path.join(inner4, '.ruflo-project'), '');
if (__rufloResolveRoot(inner4) !== inner4) fail('CW4 the .ruflo-project sentinel was ignored');

// CW5 — NO MARKER ANYWHERE => return the start dir, i.e. exactly the old behaviour. The fix can never be
// worse than the raw cwd it replaces.
const bare = mk('p5', 'nothing', 'here');
if (__rufloResolveRoot(bare) !== bare) fail(`CW5 with no marker it must fall back to the start dir, got ${__rufloResolveRoot(bare)}`);

// CW6 — memoised per START DIR, not once per process. A module-level cache is the one thing ADR-0100
// warns against: it goes stale exactly when the cwd drifts mid-session, which is the case this exists
// for. Two different start dirs must give two different answers.
if (__rufloResolveRoot(deep1) !== root1 || __rufloResolveRoot(path.join(pkg, 'src')) !== pkg) {
  fail('CW6 a cached root leaked across start dirs — a drifted cwd would get a stale answer');
}

console.log('✔ project-root resolver, EXECUTED (CW1 drift resolves to root, CW2 monorepo package keeps its own store, CW3 a lone docs/CLAUDE.md is not a root, CW4 sentinel wins, CW5 no marker = old behaviour, CW6 no stale cache across dirs)');

// ─── LK: the leak detector ───────────────────────────────────────────────────
//
// The `state` target cannot be complete — cwd-dependence hides in one-arg `resolve()` and in
// argument-passing, neither of which a search can enumerate. So the hook OBSERVES THE RESULT: a
// `.claude-flow`/`.swarm` in a subdirectory is an anchor that leaked, whatever form it took.
const { strayStateDirs: strays } = await import(`file://${path.join(REPO, 'lib', 'cwd', 'cleanup.mjs')}`);
const leakProj = path.join(SB, 'leak');
fs.mkdirSync(path.join(leakProj, '.claude-flow'), { recursive: true });          // the ROOT's own — legitimate
fs.mkdirSync(path.join(leakProj, '.swarm'), { recursive: true });                // ditto
fs.mkdirSync(path.join(leakProj, 'node_modules', 'x', '.claude-flow'), { recursive: true });  // not ours
fs.mkdirSync(path.join(leakProj, 'src', 'deep', '.claude-flow'), { recursive: true });        // A LEAK

const found = strays(leakProj);
// LK1 — the leak is found.
if (!found.some((d) => d.endsWith(path.join('src', 'deep', '.claude-flow')))) {
  fail(`LK1 a stray state dir in a subdirectory was NOT detected: ${JSON.stringify(found)}`);
}
// LK2 — the project's OWN root state dirs are not reported. Crying wolf on the correct layout would make
// the warning worthless, and it fires on every session.
if (found.some((d) => d === path.join(leakProj, '.claude-flow') || d === path.join(leakProj, '.swarm'))) {
  fail(`LK2 the project's own root state dirs were reported as strays: ${JSON.stringify(found)}`);
}
// LK3 — node_modules is not our business.
if (found.some((d) => d.includes('node_modules'))) fail('LK3 it reported a .claude-flow inside node_modules');

console.log('✔ leak detector (LK1 a stray subdir state dir is found, LK2 the root\'s own is not, LK3 node_modules ignored)');
