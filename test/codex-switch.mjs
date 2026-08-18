// ADR-030. Everything external is fake: no test may touch the developer's real Codex sessions,
// Codex config, or launch a real Codex. CODEX_HOME, the switcher's state home, the PATH entry that
// resolves `codex`, and HOME all point into the sandbox.
//
// The two failures this suite exists to catch are the ones that look like success:
//   * a `copilot` switch that silently runs on the SUBSCRIPTION account (undefined profile), and
//   * a rewrite that loses visible conversation history while reporting a clean switch.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SB = fs.realpathSync(process.argv[2]);
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = path.join(SB, 'home');
const CODEX_HOME = path.join(HOME, '.codex');
const STATE_HOME = path.join(SB, 'switch-state');
const BIN = path.join(SB, 'bin');
const LOG = path.join(SB, 'codex-argv.jsonl');
const PROJECT = path.join(SB, 'project');
const CLI = path.join(REPO, 'bin', 'cli.mjs');

const UUID = '019fa12e-1917-7a52-a2a2-71b0cca0b178';

fs.mkdirSync(path.join(CODEX_HOME, 'sessions', '2026', '08', '18'), { recursive: true });
fs.mkdirSync(BIN, { recursive: true });
fs.mkdirSync(PROJECT, { recursive: true });

function fail(message) {
  console.error(`\n✘ ${message}\n`);
  process.exit(1);
}

function output(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

// A fake `codex` on PATH: records the argv it was launched with, and exits 0 without doing anything.
fs.writeFileSync(path.join(BIN, 'codex'), `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(LOG)}
exit 0
`);
fs.chmodSync(path.join(BIN, 'codex'), 0o755);

const ROLLOUT = path.join(CODEX_HOME, 'sessions', '2026', '08', '18', `rollout-2026-08-18T09-00-00-${UUID}.jsonl`);

// One session_meta, two VISIBLE records, one provider-private encrypted replay item, and one
// protected assistant-message block. Only the replay item may ever be removed.
function writeRollout() {
  const records = [
    { type: 'session_meta', payload: { id: UUID, session_id: UUID, cwd: PROJECT, model_provider: 'openai' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } },
    { type: 'response_item', payload: { type: 'reasoning', id: 'rs_abc', encrypted_content: 'gAAAAABsecret' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}' } },
    { type: 'response_item', payload: { type: 'agent_message', content: [{ type: 'encrypted_content', encrypted_content: 'keepme' }] } },
  ];
  fs.writeFileSync(ROLLOUT, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

function readRecords(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

function switchTo(args, extraEnv = {}) {
  return spawnSync(process.execPath, [CLI, 'codex-switch', 'run', ...args], {
    cwd: PROJECT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME,
      PATH: `${BIN}:${process.env.PATH}`,
      CODEX_HOME,
      CODEX_SWITCH_STATE_HOME: STATE_HOME,
      // Force the in-process fallback lock so the suite behaves identically on macOS (no
      // /usr/bin/flock) and Linux (flock present, which would re-exec the whole switcher).
      CODEX_FLOCK_BIN: path.join(SB, 'no-such-flock'),
      ...extraEnv,
    },
  });
}

function defineProfileFile() {
  fs.writeFileSync(path.join(CODEX_HOME, 'copilot.config.toml'), 'model_provider = "copilot_api"\n');
}

function removeProfiles() {
  fs.rmSync(path.join(CODEX_HOME, 'copilot.config.toml'), { force: true });
  fs.rmSync(path.join(CODEX_HOME, 'config.toml'), { force: true });
}

// CS1 — an undefined `copilot` profile is REFUSED. Codex ignores an unknown --profile silently, so
// launching anyway would bill the subscription account while reporting a Copilot switch.
writeRollout();
removeProfiles();
const before = fs.readFileSync(ROLLOUT);
let result = switchTo(['copilot']);
if (result.status === 0) fail('CS1 an undefined copilot profile was accepted — the switch would run on the subscription account');
if (!/profile "copilot" is not defined/.test(output(result))) fail(`CS1 wrong refusal: ${output(result)}`);
if (!fs.readFileSync(ROLLOUT).equals(before)) fail('CS1 the rollout was modified by a refused switch');
if (fs.existsSync(LOG)) fail('CS1 codex was launched despite the refusal');

// CS2 — a profile defined as ~/.codex/<name>.config.toml satisfies the gate. That separate file, not
// a [profiles.copilot] table, is what the audited Codex build actually reads.
defineProfileFile();
result = switchTo(['copilot']);
if (result.status !== 0) fail(`CS2 a defined profile file was rejected: ${output(result)}`);

// CS3 — identity and visible history survive the switch; only the replay item is removed.
const after = readRecords(ROLLOUT);
if (after[0].payload.id !== UUID) fail('CS3 the session UUID changed');
if (after.some((r) => r.payload?.type === 'reasoning')) fail('CS3 provider-private replay state survived the switch');
const visible = after.filter((r) => ['message', 'function_call', 'agent_message'].includes(r.payload?.type));
if (visible.length !== 3) fail(`CS3 visible conversation/tool history changed: kept ${visible.length} of 3`);
if (!JSON.stringify(after).includes('keepme')) fail('CS3 a protected assistant-message block was stripped');

// CS4 — the original bytes are kept as a verified backup, not discarded.
const backups = fs.readdirSync(path.join(STATE_HOME, 'backups', UUID));
if (backups.length !== 1) fail(`CS4 expected exactly one backup, found ${backups.length}`);
if (!fs.readFileSync(path.join(STATE_HOME, 'backups', UUID, backups[0])).equals(before)) {
  fail('CS4 the backup does not match the original rollout byte for byte');
}

// CS5 — Codex is resolved from PATH (not a baked-in install prefix) and launched with the profile.
const argv = fs.readFileSync(LOG, 'utf8').trim();
if (!/--profile copilot resume 019fa12e-1917-7a52-a2a2-71b0cca0b178/.test(argv)) fail(`CS5 wrong codex argv: ${argv}`);

// CS6 — switching back selects the subscription account explicitly, never the profile.
fs.rmSync(LOG);
result = switchTo(['openai']);
if (result.status !== 0) fail(`CS6 the switch back to the subscription account failed: ${output(result)}`);
const backArgv = fs.readFileSync(LOG, 'utf8').trim();
if (!/model_provider="openai"/.test(backArgv)) fail(`CS6 the subscription launch did not pin the provider: ${backArgv}`);
if (/--profile/.test(backArgv)) fail(`CS6 the subscription launch used a profile: ${backArgv}`);

// CS7 — a [profiles.<name>] table in config.toml also satisfies the gate, so a host configured the
// other supported way is not locked out.
fs.rmSync(LOG);
fs.rmSync(path.join(CODEX_HOME, 'copilot.config.toml'));
fs.writeFileSync(path.join(CODEX_HOME, 'config.toml'), '[profiles.copilot]\nmodel = "gpt-5.6-sol"\n');
result = switchTo(['copilot']);
if (result.status !== 0) fail(`CS7 a [profiles.copilot] table was rejected: ${output(result)}`);

// CS8 — an ACTIVE session is never rewritten: a held writer lock refuses and changes nothing.
writeRollout();
defineProfileFile();
const locks = path.join(CODEX_HOME, 'thread-writer-locks');
fs.mkdirSync(locks, { recursive: true });
fs.writeFileSync(path.join(locks, `${UUID}.lock`), '');
const beforeLocked = fs.readFileSync(ROLLOUT);
result = switchTo(['openai']);
if (result.status === 0) fail('CS8 a switch proceeded while another writer held the session lock');
if (!/active writer lock/.test(output(result))) fail(`CS8 wrong refusal: ${output(result)}`);
if (!fs.readFileSync(ROLLOUT).equals(beforeLocked)) fail('CS8 a locked session was rewritten');
fs.rmSync(path.join(locks, `${UUID}.lock`));

// CS9 — --dry-run reports without touching the rollout or the launcher.
fs.rmSync(LOG, { force: true });
result = switchTo(['copilot', '--dry-run']);
if (result.status !== 0) fail(`CS9 --dry-run failed: ${output(result)}`);
if (!fs.readFileSync(ROLLOUT).equals(beforeLocked)) fail('CS9 --dry-run modified the rollout');
if (fs.existsSync(LOG)) fail('CS9 --dry-run launched codex');

// CS10 — the provider is chosen by the subcommand, never smuggled in as a passthrough --profile.
result = switchTo(['copilot', '--', '--profile', 'something-else']);
if (result.status === 0) fail('CS10 a passthrough --profile override was accepted');
if (!/Do not override --profile/.test(output(result))) fail(`CS10 wrong refusal: ${output(result)}`);

console.log('codex-switch: 10/10 behaviours hold');
