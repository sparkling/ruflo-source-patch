// The last of the gaps.
//
//   MI  installMonitor/uninstallMonitor internals. The launchctl/crontab CALL is not testable without
//       registering a real job — but everything AROUND it is pure, and none of it was tested.
//   SC  ruflo-new-dual.sh / ruflo-add-codex.sh were only ever PARSE-checked (bash -n). 290 lines of
//       shell whose only proof was "it parses".
//   AR  adr-reindex's status() STALE branch, and whether its `skip:not-ours` refusal actually REACHES
//       the notifier. K5 proves the upstream file survives; it never proved anyone is told.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawnSync } from 'node:child_process';

// ⚠ DO NOT `import` ANY lib/ MODULE STATICALLY IN THIS FILE.
//
// paths.mjs reads RUFLO_SOURCE_PATCH_HOME at MODULE LOAD, and ESM modules are singletons: once it is
// loaded with the real homedir, every later import — including a dynamic one — reuses that instance.
// Static imports hoist ABOVE any assignment, so `import { REPO } from './fixtures.mjs'` (which pulls in
// paths.mjs) would pin the REAL home before this file's first statement ran.
//
// This is not hypothetical. The first version of this file did exactly that, and MI4 — which calls
// uninstallMonitor() — DELETED THE REAL ~/.ruflo-source-patch/monitor.json AND heartbeat, removed the
// launchd plist, and unloaded the running job. The test destroyed the very monitor it was testing.
//
// So: set the sandbox FIRST, derive REPO from this file's own location, and load every lib module with
// a dynamic import AFTERWARDS.
const SB = process.argv[2];
const HOME = path.join(SB, 'home');
const STATE = path.join(HOME, '.ruflo-source-patch');
process.env.RUFLO_SOURCE_PATCH_HOME = HOME;      // <- BEFORE any lib/ module is loaded
// This suite calls uninstallMonitor() (MI4) IN-PROCESS. The launchd label is a constant, not sandboxed by
// HOME, so without this it would `launchctl bootout` the developer's REAL monitor agent. Belt to
// run-tests.sh's suspenders, so a standalone `node test/monitor-internals.mjs` is safe too.
process.env.RSP_NO_LAUNCHCTL = '1';
// The CLI-root vars too, and for the same reason. paths.mjs freezes GLOBAL_ROOTS/NPX_ROOT at module
// load, so a lib/ module imported IN-PROCESS below (adr-reindex's patcher does, to find out whether the
// installed CLI has `memory purge`) would otherwise read the developer's REAL npx cache and global root.
// The test would then pass or fail on what happens to be installed on this machine.
process.env.RUFLO_NPX_ROOT = path.join(SB, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(SB, 'global');

const REPO = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{}');

const fail = (m) => { console.log(`\n✘ ${m}`); process.exit(1); };
const out = (r) => `${r.stdout || ''}${r.stderr || ''}`;

const env = {
  ...process.env,
  RUFLO_SOURCE_PATCH_HOME: HOME,
  RUFLO_NPX_ROOT: path.join(SB, 'npx'),
  RUFLO_GLOBAL_ROOT: path.join(SB, 'global'),
};

// ─── MI: the monitor's pure internals ────────────────────────────────────────
// paths.mjs now resolves INSIDE the sandbox — see the warning at the top of this file.
const mon = await import(`file://${path.join(REPO, 'lib', 'cwd', 'monitor.mjs')}`);

// MI1 — the launchd plist is well-formed XML and carries the interval we asked for. A malformed plist
// means launchctl silently refuses the job and the monitor never runs — the failure that looks exactly
// like a healthy system.
const plist = mon.plistBody(600);
if (!/^<\?xml/.test(plist.trim())) fail('MI1 the plist does not begin with an XML declaration — launchd would reject it');
if (!/<key>StartInterval<\/key><integer>600<\/integer>/.test(plist.replace(/\s+/g, ''))) {
  fail(`MI1 the plist does not carry the requested 600s interval:\n${plist}`);
}
if (!plist.includes('<key>RunAtLoad</key>')) fail('MI1 the plist has no RunAtLoad — the monitor would not start until the first interval elapsed');
// A watchdog must NOT advertise itself as throttleable. ProcessType=Background opts into App Nap / timer
// coalescing / deferral, the configurable factor the drop evidence pointed at (ADR-021). Must be Standard.
if (/<key>ProcessType<\/key><string>Background<\/string>/.test(plist) || /<key>LowPriorityIO<\/key>/.test(plist)) fail('MI1 the plist marks the monitor Background/LowPriorityIO — that invites the very throttling that drops it');
if (!/<key>ProcessType<\/key><string>Standard<\/string>/.test(plist)) fail('MI1 the plist ProcessType is not Standard — the monitor should be scheduled normally, not deprioritised');

// MI2 — RSP_MONITOR_INTERVAL is honoured, and CLAMPED. A 1-second monitor would hammer the machine;
// a garbage value must fall back rather than produce NaN in the plist.
const iv = (v) => {
  const old = process.env.RSP_MONITOR_INTERVAL;
  if (v === undefined) delete process.env.RSP_MONITOR_INTERVAL; else process.env.RSP_MONITOR_INTERVAL = v;
  const n = mon.interval();
  if (old === undefined) delete process.env.RSP_MONITOR_INTERVAL; else process.env.RSP_MONITOR_INTERVAL = old;
  return n;
};
if (iv(undefined) !== 300) fail(`MI2 default interval is ${iv(undefined)}, expected 300`);
if (iv('900') !== 900) fail('MI2 an explicit RSP_MONITOR_INTERVAL=900 was not honoured');
if (iv('1') !== 300) fail(`MI2 a 1-second interval was NOT clamped — got ${iv('1')}; that would hammer the machine`);
if (iv('banana') !== 300) fail(`MI2 a garbage interval produced ${iv('banana')} instead of falling back to the default`);

// MI3 — cronWithout() removes ONLY our line, and leaves the user's crontab alone. Getting this wrong
// deletes someone's backups.
const crontab = [
  '0 3 * * * /usr/bin/backup --nightly',
  `*/5 * * * * "/usr/bin/node" "/x/monitor-run.mjs" >/dev/null 2>&1 ${'# ruflo-source-patch monitor'}`,
  '@reboot /usr/local/bin/something-important',
].join('\n');
const stripped = mon.cronWithout(crontab);
if (/ruflo-source-patch monitor/.test(stripped)) fail('MI3 cronWithout did not remove our own cron line');
if (!/backup --nightly/.test(stripped)) fail("MI3 cronWithout DELETED THE USER'S backup job");
if (!/something-important/.test(stripped)) fail("MI3 cronWithout DELETED one of the user's other jobs");

// MI4 — uninstallMonitor drops monitor.json AND the heartbeat. If it leaves them, the notifier goes on
// nagging about a monitor you deliberately removed — a warning about a thing that is not wrong.
fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(path.join(STATE, 'monitor.json'), '{"intervalSec":300}');
fs.writeFileSync(path.join(STATE, 'heartbeat'), 'x');
mon.uninstallMonitor();
if (fs.existsSync(path.join(STATE, 'monitor.json'))) fail('MI4 uninstallMonitor left monitor.json behind — the notifier will nag about a monitor you removed');
if (fs.existsSync(path.join(STATE, 'heartbeat'))) fail('MI4 uninstallMonitor left the heartbeat behind');

// MI5 — the plist captures the job's stderr. A node that dies before monitor-run.mjs's try/catch (a
// vanished interpreter, a module load error) writes NOWHERE without this, and a dead watchdog stays
// invisible — the exact failure this package hunts (ADR-021).
if (!/<key>StandardErrorPath<\/key>/.test(plist)) fail('MI5 the plist has no StandardErrorPath — a crash-on-launch would vanish without a trace');

// ND — VERSION-STABLE node resolution (ADR-021). A version manager pins node at a per-version path that
// vanishes on upgrade; resolveStableNode() prefers the manager's stable shim when it exists AND runs.
const ndTmp = fs.mkdtempSync(path.join(HOME, 'nd-'));
const ndExec = path.join(ndTmp, 'mise', 'installs', 'node', '1.2.3', 'bin', 'node');
const ndShim = path.join(ndTmp, 'mise', 'shims', 'node');
fs.mkdirSync(path.dirname(ndExec), { recursive: true }); fs.writeFileSync(ndExec, '');
fs.mkdirSync(path.dirname(ndShim), { recursive: true }); fs.writeFileSync(ndShim, '');
if (mon.resolveStableNode(ndExec, () => true).node !== ndShim) fail('ND1 a present, working shim was NOT preferred over the version-pinned path');
if (mon.resolveStableNode(ndExec, () => false).node !== ndExec) fail('ND2 a shim that does not RUN must fall back to the exec path, not brick the monitor');
fs.rmSync(ndShim, { force: true });
if (mon.resolveStableNode(ndExec, () => true).node !== ndExec) fail('ND3 an ABSENT shim must fall back to the exec path');
if (mon.resolveStableNode('/usr/local/bin/node', () => true).node !== '/usr/local/bin/node') fail('ND4 a plain (non-manager) node path must be used as-is');

// RC — recoverMonitor refuses to resurrect a monitor the user never installed (no meta = no-op, no
// launchctl). MI4 above removed monitor.json, so nothing is installed here.
const rc = mon.recoverMonitor();
if (rc.attempted !== false || rc.reason !== 'not-installed') fail(`RC1 recoverMonitor touched launchd for an uninstalled monitor: ${JSON.stringify(rc)}`);

// MI6 — install/uninstall exercise the FILE flow but NEVER touch real launchd (RSP_NO_LAUNCHCTL, set at
// the top). The launchd label is a constant, NOT sandboxed by HOME, so without the gate this very suite
// bootout's the developer's (or a `npm test` user's) REAL monitor agent — proven: it did, repeatedly, and
// it was the actual cause of the drops. The plist must land in the SANDBOX, and install must succeed
// without a real launchctl. Guard it forever.
fs.mkdirSync(path.join(STATE, 'lib', 'cwd'), { recursive: true });
fs.writeFileSync(path.join(STATE, 'lib', 'cwd', 'monitor-run.mjs'), '// stub\n');
const mi6Install = mon.installMonitor();
if (!mi6Install.ok) fail(`MI6 installMonitor failed under the launchctl gate (would it have touched real launchd?): ${mi6Install.why}`);
const sandboxPlist = path.join(HOME, 'Library', 'LaunchAgents', 'com.sparkleideas.ruflo-source-patch.monitor.plist');
if (!fs.existsSync(sandboxPlist)) fail('MI6 the plist was not written under the SANDBOX HOME — install is not HOME-isolated');
mon.uninstallMonitor();
if (fs.existsSync(sandboxPlist)) fail('MI6 uninstallMonitor left the sandbox plist behind');

console.log('✔ monitor internals (MI1 valid plist, MI2 interval honoured + clamped, MI3 cron strips ONLY our line, MI4 uninstall drops meta + heartbeat, MI5 stderr captured, ND1-4 version-stable node, RC1 recover no-ops, MI6 install/uninstall never touch real launchd)');

// ─── SC: the two shell scripts nobody had ever run ───────────────────────────
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'cli.mjs'), ...args], { env, encoding: 'utf8' });
cli(['dual', 'install']);
const addCodex = path.join(STATE, 'dual', 'ruflo-add-codex.sh');
const newDual = path.join(STATE, 'dual', 'ruflo-new-dual.sh');

// SC1 — they refuse a nonexistent project rather than doing something unpredictable, and say so.
const bogus = spawnSync('bash', [addCodex, path.join(SB, 'does-not-exist')], { encoding: 'utf8', env: { ...process.env, HOME } });
if (bogus.status === 0) fail('SC1 ruflo-add-codex.sh accepted a project directory that does not exist');
if (!out(bogus).trim()) fail('SC1 it failed on a missing project but said NOTHING about why');

// SC2 — --help works and does not touch the filesystem. It is the only way to run these safely and see
// what they do; if it errors, nobody can inspect them before pointing them at a real project.
for (const [name, s] of [['ruflo-add-codex.sh', addCodex], ['ruflo-new-dual.sh', newDual]]) {
  const h = spawnSync('bash', [s, '--help'], { encoding: 'utf8', env: { ...process.env, HOME }, timeout: 15000 });
  if (!out(h).trim()) fail(`SC2 ${name} --help printed nothing — the script cannot be inspected before use`);
}

// SC3 — ruflo-add-codex.sh CONVERTS a real project: AGENTS.md becomes canonical and CLAUDE.md imports
// it. This is the actual contract of the `dual` target and it had never been executed.
const proj = path.join(SB, 'proj');
fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
spawnSync('git', ['init', '-q'], { cwd: proj });
fs.writeFileSync(path.join(proj, 'CLAUDE.md'), '# my project\n\nSome existing instructions.\n');

const conv = spawnSync('bash', [addCodex, proj, '--force', '--quiet'], {
  encoding: 'utf8', env: { ...process.env, HOME }, timeout: 90000,
});

const agents = path.join(proj, 'AGENTS.md');
const claude = path.join(proj, 'CLAUDE.md');
if (!fs.existsSync(agents)) {
  fail(`SC3 ruflo-add-codex.sh did not produce AGENTS.md — the whole point of the dual target:\n${out(conv)}`);
}
const claudeBody = fs.readFileSync(claude, 'utf8');
if (!/@AGENTS\.md/.test(claudeBody)) {
  fail(`SC3 CLAUDE.md does not import @AGENTS.md — the two files will diverge, which is the bug this fixes:\n${claudeBody.slice(0, 300)}`);
}
if (fs.readFileSync(agents, 'utf8').length < 50) fail('SC3 AGENTS.md is essentially empty');

console.log('✔ dual scripts (SC1 a missing project is refused loudly, SC2 --help works, SC3 add-codex really produces AGENTS.md + a CLAUDE.md that imports it)');

// ─── AR: adr-reindex's reporting branches ────────────────────────────────────
const { isProblem } = await import(`file://${path.join(REPO, 'lib', 'cwd', 'problems.mjs')}`);

// AR1 — the `skip:not-ours` refusal must reach the notifier. K5 proves we do not DELETE an
// upstream-owned skill; this proves somebody is TOLD we left it alone. A silent refusal is a mystery.
if (!isProblem('skip:not-ours /x/SKILL.md — no ruflo-source-patch marker; refusing to delete a skill we did not write')) {
  fail('AR1 `skip:not-ours` does not match the shared problem predicate — the refusal would never be announced');
}
// AR2 — and so must `skip:upstream-owns-it`, the install-side twin.
if (!isProblem('skip:upstream-owns-it /x/SKILL.md — ruflo-adr now ships its own adr-reindex skill')) {
  fail('AR2 `skip:upstream-owns-it` does not reach the notifier — you would never learn upstream had shipped it');
}

// AR3 — status() reports a STALE copy of our own skill (the packaged one moved on; this install did not).
const rx = await import(`file://${path.join(REPO, 'lib', 'adr-reindex', 'patcher.mjs')}`);
const skillDir = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'ruflo', 'plugins', 'ruflo-adr');
fs.mkdirSync(path.join(skillDir, '.claude-plugin'), { recursive: true });
fs.writeFileSync(path.join(skillDir, '.claude-plugin', 'plugin.json'), '{"name":"ruflo-adr"}');
fs.mkdirSync(path.join(skillDir, 'skills', 'adr-reindex'), { recursive: true });
// ours (carries the marker) but NOT the current packaged bytes
fs.writeFileSync(path.join(skillDir, 'skills', 'adr-reindex', 'SKILL.md'),
  '---\nname: adr-reindex\n---\n\nan OLD copy installed by ruflo-source-patch\n');

const st = rx.status();
if (!st.log.some((l) => /STALE/.test(l))) {
  fail(`AR3 an out-of-date copy of our OWN skill was not reported STALE:\n${st.log.join('\n')}`);
}

// AR4/AR5 — WHAT THE `skip:upstream-owns-it` MESSAGE TELLS YOU TO DO.
//
// This is not cosmetic. The message used to say "(uninstall this target)" the moment ruflo-adr shipped
// ANY adr-reindex skill, and I followed it and uninstalled a working reconcile. Upstream's 0.4.0 skill
// shells out to `memory purge`, which no published @claude-flow/cli provides; the unknown subcommand
// exits 0, so their reindex reports "purged" having purged nothing.
//
// "Upstream owns the file" and "upstream's version works" are different claims. The message must not
// conflate them, so both branches are pinned here.
const upstreamSkill = path.join(skillDir, 'skills', 'adr-reindex', 'SKILL.md');
fs.writeFileSync(upstreamSkill, '---\nname: adr-reindex\n---\n\nupstream ships this now (no rsp marker)\n');

const cliMemoryJs = path.join(SB, 'npx', 'abc', 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'commands', 'memory.js');
fs.mkdirSync(path.dirname(cliMemoryJs), { recursive: true });

// AR4 — the CLI has NO `purge` subcommand, which is every published build to date.
fs.writeFileSync(cliMemoryJs, "const subs = ['store', 'delete', 'cleanup', 'distill'];\n");
const noPurge = rx.apply().log.find((l) => /skip:upstream-owns-it/.test(l)) ?? '';
if (!noPurge) fail('AR4 fixture: no skip:upstream-owns-it line at all');
if (/uninstall this target/i.test(noPurge) && !/Do NOT uninstall/i.test(noPurge)) {
  fail(`AR4 the advice says to UNINSTALL while upstream's reindex cannot run (no \`memory purge\` in the CLI). That is how a working reconcile got removed:\n  ${noPurge}`);
}
if (!/memory purge/.test(noPurge) || !/ruflo-adr-reindex\.sh/.test(noPurge)) {
  fail(`AR4 the advice does not name the missing command, or the script that still works:\n  ${noPurge}`);
}

// AR5 — and once `memory purge` DOES ship, the advice must flip. Otherwise this target nags forever.
fs.writeFileSync(cliMemoryJs, "const subs = ['store', 'delete', 'purge', 'cleanup'];\n");
const withPurge = rx.apply().log.find((l) => /skip:upstream-owns-it/.test(l)) ?? '';
if (!/Uninstall this target/i.test(withPurge) || /Do NOT uninstall/i.test(withPurge)) {
  fail(`AR5 \`memory purge\` is available, so upstream's reindex works and ours is redundant — the advice must say to uninstall:\n  ${withPurge}`);
}

console.log('✔ adr-reindex reporting (AR1 skip:not-ours reaches the notifier, AR2 skip:upstream-owns-it too, AR3 a stale skill copy is named, AR4 it does NOT say uninstall while upstream\'s reindex cannot run, AR5 it does once `memory purge` ships)');

// ─── SU: self-retirement ─────────────────────────────────────────────────────
//
// A target stands down when upstream genuinely takes over. The DANGEROUS way to build this is a
// published list of "fixed" issues that the monitor acts on — because `closed` != `fixed` (#2621 is
// closed and upstream's own commit says it is not fixed) and `fixed` != `runnable here` (#2666 is fixed,
// but `memory purge` shipped on npm separately from the plugin, so for a window the skill was installed
// and the command it calls did not exist). A list keyed on either would have uninstalled a WORKING
// reconcile on anyone still on an older CLI.
//
// So retirement is a LOCAL MEASUREMENT, and these tests pin the properties that make it safe.
const sup = await import(`file://${path.join(REPO, 'lib', 'supersede.mjs')}`);
const stateMod = await import(`file://${path.join(REPO, 'lib', 'cwd', 'state.mjs')}`);
const cmds = await import(`file://${path.join(REPO, 'lib', 'cwd', 'commands.mjs')}`);

const reindexSkill = path.join(skillDir, 'skills', 'adr-reindex', 'SKILL.md');
const upstreamSkillBytes = '---\nname: adr-reindex\n---\n\nupstream ships this now (no rsp marker)\n';
const noPurgeCli = "const subs = ['store', 'delete', 'cleanup'];\n";
const purgeCli = "const subs = ['store', 'delete', 'purge', 'cleanup'];\n";

const installOurs = () => {
  stateMod.writeState({ patchTargets: ['memory'], pluginTargets: ['adr-reindex'], retired: {} });
};

// SU1 — THE REPLACEMENT IS THERE BUT CANNOT RUN. Keep ours. This is the case that actually happened,
// and the one a list-of-fixed-issues gets catastrophically wrong.
fs.writeFileSync(reindexSkill, upstreamSkillBytes);
fs.writeFileSync(cliMemoryJs, noPurgeCli);
installOurs();
cmds.applyInstalled();
if (!stateMod.readState().pluginTargets.includes('adr-reindex')) {
  fail('SU1 retired the target while upstream\'s replacement CANNOT RUN (no `memory purge`) — that removes a working reconcile and leaves an /adr-reindex that reports "purged" having purged nothing');
}

// SU2 — NEVER RETIRE INTO A HOLE. `memory purge` exists, but upstream ships no skill: there is no
// replacement to stand down FOR. Keep ours.
fs.rmSync(reindexSkill, { force: true });
fs.writeFileSync(cliMemoryJs, purgeCli);
installOurs();
cmds.applyInstalled();
if (!stateMod.readState().pluginTargets.includes('adr-reindex')) {
  fail('SU2 retired the target with NO replacement skill on disk — it retired into a hole');
}

// SU3 — both halves present and runnable => retire, and RECORD THE EVIDENCE. A retirement a user
// cannot audit later is indistinguishable from a bug that ate their patch.
fs.writeFileSync(reindexSkill, upstreamSkillBytes);
fs.writeFileSync(cliMemoryJs, purgeCli);
installOurs();
const retiredRun = cmds.applyInstalled();
const st3 = stateMod.readState();
if (st3.pluginTargets.includes('adr-reindex')) fail('SU3 the replacement is present AND runnable, but the target did not retire');
if (!st3.retired['adr-reindex']) fail('SU3 retired the target but recorded nothing — the next install would just put it back');
if (!/memory purge/.test(st3.retired['adr-reindex'].evidence || '')) {
  fail(`SU3 the retirement records no usable evidence: ${JSON.stringify(st3.retired['adr-reindex'])}`);
}
if (!retiredRun.log.some((l) => /^retired adr-reindex/.test(l))) {
  fail('SU3 the retirement was never announced — a patch that vanishes silently is exactly what this package refuses to do');
}
// and it must NOT be dressed up as a problem: the banner says "a patch may no longer be doing anything",
// which is the wrong thing to say about a patch that is no longer NEEDED.
if (cmds.problemsIn(retiredRun).some((l) => /^retired /.test(l))) {
  fail('SU3 a retirement was reported as a PROBLEM — crying wolf over good news is how the banner that matters gets ignored');
}
// upstream's own file must be untouched by our standing down
if (fs.readFileSync(reindexSkill, 'utf8') !== upstreamSkillBytes) {
  fail('SU3 retiring DELETED or REWROTE upstream\'s skill — we may only ever remove files carrying our own marker');
}

// SU4 — RETIREMENT IS TERMINAL. The SessionStart hook re-applies everything in state.json and
// `make install` installs every target, so a retirement with no memory of itself flip-flops forever.
cmds.applyInstalled();
if (stateMod.readState().pluginTargets.includes('adr-reindex')) {
  fail('SU4 a retired target was re-installed by the next apply — it will now flip-flop every session');
}

// SU5 — and `install` refuses it, rather than silently resurrecting it, and says why.
// (There is no `unretire` and no `pin`. A target retires only on proof that its replacement is present
// AND runnable HERE, so "I disagree" is not a state worth modelling — and every override is another
// surface to get wrong. If the predicate is right, the answer is right.)
const inst = cli(['adr-reindex', 'install']);
if (stateMod.readState().pluginTargets.includes('adr-reindex')) {
  fail(`SU5 \`install\` re-installed a RETIRED target — it will now flip-flop:\n${out(inst)}`);
}
if (!/RETIRED/.test(out(inst)) || !/evidence/.test(out(inst))) {
  fail(`SU5 install refused but did not say why, with evidence:\n${out(inst)}`);
}

console.log('✔ self-retirement (SU1 keeps ours when the replacement cannot RUN, SU2 never retires into a hole, SU3 retires on proof + records evidence + announces without crying wolf, SU4 terminal, SU5 install refuses and says why)');

// ─── UP: self-update from immutable tags ─────────────────────────────────────
//
// The monitor tick pulls a newer TAG of this package. It is the only thing that carries a new
// supersession predicate to a machine, and it must be on the TICK, not the SessionStart hook: sessions
// run for days, so a hook-gated update would leave a patch that upstream has since invalidated
// re-applying itself every 5 minutes for a week.
//
// It EXECUTES fetched code, so every rule below is load-bearing. None of these tests touch the network.
const up = await import(`file://${path.join(REPO, 'lib', 'cwd', 'update-check.mjs')}`);

// The suite runs with RSP_NO_SELF_UPDATE=1 set, so that no OTHER suite (which spawn `monitor run`, and
// would therefore reach the real network and really npx) can self-update the developer's machine mid-test.
// These tests are about that very code, so they lift it locally and put it back.
const KILL = process.env.RSP_NO_SELF_UPDATE;
delete process.env.RSP_NO_SELF_UPDATE;

// UP1 — numeric compare, not lexical. `4.10.0` > `4.9.9`; a string compare says the opposite and would
// strand every user on 4.9.x forever.
if (!up.isNewer('v4.10.0', '4.9.9')) fail('UP1 4.10.0 was not newer than 4.9.9 — lexical compare');
if (up.isNewer('4.9.9', '4.10.0')) fail('UP1 4.9.9 was considered newer than 4.10.0');
if (up.isNewer('4.14.0', '4.14.0')) fail('UP1 the same version was treated as an update');

// UP2 — IMMUTABLE SEMVER TAGS ONLY. A branch, or a moving `latest` tag, is the live wire that tags exist
// to avoid: pulling one would mean every commit goes live everywhere with no review and no rollback.
const tag = await up.latestTag({ fetchJson: async () => ([
  { name: 'main' }, { name: 'latest' }, { name: 'v4.9.9' }, { name: 'v4.14.0' }, { name: 'nightly' },
]) });
if (tag !== 'v4.14.0') fail(`UP2 picked ${JSON.stringify(tag)} — it must pick the highest SEMVER tag and ignore moving refs`);

const onlyBranches = await up.latestTag({ fetchJson: async () => ([{ name: 'main' }, { name: 'latest' }]) });
if (onlyBranches !== null) fail(`UP2 selected a non-semver ref: ${onlyBranches}`);

// UP3 — FORWARD ONLY. An API that offers an older tag must never downgrade us: a downgrade reinstates
// patches upstream already fixed, and un-retires what was retired on proof.
let ran = null;
const older = await up.selfUpdate({
  fetchJson: async () => ([{ name: 'v0.0.1' }]),
  run: (spec) => { ran = spec; },
});
if (older.updated || ran) fail(`UP3 it DOWNGRADED to an older tag (ran: ${ran})`);

// UP4 — a newer tag updates, and installs THAT EXACT PINNED TAG, never a branch.
ran = null;
const bump = await up.selfUpdate({
  fetchJson: async () => ([{ name: 'v999.0.0' }]),
  run: (spec) => { ran = spec; },
});
if (!bump.updated) fail('UP4 a newer tag did not trigger an update');
if (!/#v999\.0\.0$/.test(ran || '')) fail(`UP4 it did not install the pinned tag — it ran: ${ran}`);
if (/#(main|HEAD)\b/.test(ran || '')) fail(`UP4 it installed a BRANCH, which is a mutable ref: ${ran}`);

// UP5 — OFFLINE, or GitHub down. Keep the version we have, silently. A tool that breaks itself trying to
// upgrade is worse than a stale one.
ran = null;
const netdown = await up.selfUpdate({
  fetchJson: async () => { throw new Error('ENOTFOUND'); },
  run: (spec) => { ran = spec; },
});
if (netdown.updated || ran) fail('UP5 a failed fetch still tried to install something');

// UP6 — THE INSTALL ITSELF FAILS (bad tarball, npx exits nonzero). Stay on the working version, and SAY
// so: a half-upgraded silent tool is the exact failure this package exists to hunt.
const brokenInstall = await up.selfUpdate({
  fetchJson: async () => ([{ name: 'v999.0.0' }]),
  run: () => { throw new Error('npx exited 1'); },
});
if (brokenInstall.updated) fail('UP6 a FAILED install reported success');
if (!brokenInstall.error) fail('UP6 a failed install was swallowed — the user would never know they are stale');

// UP8 — ALL MODE adopts new targets. A machine that ran `all install` (state.all === true) must upgrade by
// re-running `all install`, NOT `monitor install`, so a target introduced in the newer tag records itself
// into state.json and applies — the framework's whole "just let it run" premise (ADR-019).
stateMod.setAllMode(true);
let ranSpec = null; let ranSub = null;
const adopt = await up.selfUpdate({
  fetchJson: async () => ([{ name: 'v999.0.0' }]),
  run: (spec, sub) => { ranSpec = spec; ranSub = sub; },
});
if (!adopt.updated) fail('UP8 all-mode: a newer tag did not update');
if (!/#v999\.0\.0$/.test(ranSpec || '')) fail(`UP8 all-mode did not pin the tag — ran: ${ranSpec}`);
if (!ranSub || ranSub.join(' ') !== 'all install') fail(`UP8 all-mode must run \`all install\` to adopt new targets — ran sub: ${JSON.stringify(ranSub)}`);

// UP9 — a CURATED install (state.all === false) upgrades by `monitor install`, exactly as before: its
// recorded set is left alone and nothing it did not ask for is installed. This is the guard that stops
// auto-adoption from ever installing a target onto a machine that cherry-picked.
stateMod.setAllMode(false);
ranSub = null;
const curated = await up.selfUpdate({
  fetchJson: async () => ([{ name: 'v999.0.0' }]),
  run: (spec, sub) => { ranSub = sub; },
});
if (!curated.updated) fail('UP9 curated: a newer tag did not update');
if (!ranSub || ranSub.join(' ') !== 'monitor install') fail(`UP9 a curated install must run \`monitor install\`, never adopt — ran sub: ${JSON.stringify(ranSub)}`);

// UP7 — the kill switch. The suite depends on it (no test may reach the network or run npx), and so does
// anyone who wants to pin their install.
process.env.RSP_NO_SELF_UPDATE = '1';
ran = null;
const off = await up.selfUpdate({ fetchJson: async () => ([{ name: 'v999.0.0' }]), run: (s) => { ran = s; } });
if (off.updated || ran) fail('UP7 RSP_NO_SELF_UPDATE=1 did not disable self-update');
if (KILL === undefined) delete process.env.RSP_NO_SELF_UPDATE; else process.env.RSP_NO_SELF_UPDATE = KILL;

console.log('✔ self-update (UP1 numeric compare, UP2 immutable SEMVER TAGS only — never a branch, UP3 forward only, UP4 installs the pinned tag, UP5 offline keeps the working version, UP6 a failed install is reported not swallowed, UP7 kill switch, UP8 all-mode adopts via `all install`, UP9 curated stays `monitor install`)');
