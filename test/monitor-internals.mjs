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

console.log('✔ monitor internals (MI1 valid plist, MI2 interval honoured + clamped, MI3 cron strips ONLY our line, MI4 uninstall drops meta + heartbeat)');

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
