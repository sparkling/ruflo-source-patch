import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const input = process.argv[2];
if (!input) throw new Error('fixture root required');
process.env.RUFLO_SOURCE_PATCH_HOME = input;
process.env.RSP_RUVNET_BRAIN_HOME = path.join(input, '.cache', 'ruvnet-brain');

const patcher = await import('../lib/brain-dual-host-stdin/patcher.mjs');
const compose = await import('../lib/plugin-compose.mjs');

const fixture = `${patcher.SPAWN_ANCHOR.includes('spawn(') ? "import { spawn } from 'node:child_process';" : ''}
import { subscriptionOnlyEnv } from './subscription-hosts.mjs';

function promptFor(stage, payload) {
  return [
    'You are one half of a subscription-only Claude Code and Codex deliberation.',
    'Do not request or use API keys. Work read-only. Return JSON only.',
    \`Stage: \${stage}\`,
    JSON.stringify(payload),
  ].join('\\n');
}

function parseCodexJsonl(stdout) {
  const messages = String(stdout).trim().split('\\n').flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value.type === 'item.completed' && value.item?.type === 'agent_message'
        ? [value.item.text]
        : [];
    } catch { return []; }
  });
  return messages.at(-1) ?? stdout;
}

function parseHostValue(host, stdout) {
  const raw = host === 'claude-code'
    ? (() => {
        try {
          const envelope = JSON.parse(stdout);
          return envelope.result ?? envelope;
        } catch { return stdout; }
      })()
    : parseCodexJsonl(stdout);
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return { text: raw }; }
}

${patcher.SPAWN_ANCHOR}

export async function runSubscriptionHost(host, stage, payload, { cwd = process.cwd() } = {}) {
  const prompt = promptFor(stage, payload);
  const env = subscriptionOnlyEnv();
  const command = host === 'claude-code'
    ? {
        binary: 'claude',
        args: [
          '-p', '--output-format', 'json', '--permission-mode', 'plan',
${patcher.CLAUDE_ARG_ANCHOR}
        ],
      }
    : {
        binary: 'codex',
        args: [
          'exec', '--ephemeral', '--sandbox', 'read-only', '--color', 'never', '--json',
${patcher.CODEX_ARG_ANCHOR}
        ],
      };
${patcher.CALL_ANCHOR}
  if (result.status !== 0) return { ok: false, reason: 'host-failed' };
  return { ok: true, value: parseHostValue(host, result.stdout) };
}
`;

const transformed = patcher.patchSource(fixture);
assert.deepEqual(transformed.missing, []);
assert.equal(patcher.isPatched(transformed.next), true);
assert.equal(transformed.next.includes("'high', prompt"), false);
assert.equal(transformed.next.includes("'pipe', 'pipe', 'pipe'"), true);
assert.equal(patcher.reverseSource(transformed.next), fixture);

const runtime = path.join(input, 'runtime');
const bin = path.join(input, 'bin');
fs.mkdirSync(runtime, { recursive: true });
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(runtime, 'subscription-hosts.mjs'), `
export const subscriptionOnlyEnv = () => ({ ...process.env });
export const probeSubscriptionHosts = () => ({});
`);
fs.writeFileSync(path.join(runtime, 'dual-host-deliberation.mjs'), transformed.next);

const fakeHost = `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import path from 'node:path';
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const value = JSON.stringify({
  bytes: Buffer.byteLength(input),
  sha256: createHash('sha256').update(input).digest('hex'),
  args: process.argv.slice(2),
});
if (path.basename(process.argv[1]) === 'claude') {
  process.stdout.write(JSON.stringify({ result: value }));
} else {
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: value } }) + '\\n');
}
`;
for (const name of ['claude', 'codex']) {
  const file = path.join(bin, name);
  fs.writeFileSync(file, fakeHost, { mode: 0o755 });
}
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;

const mod = await import(`${pathToFileURL(path.join(runtime, 'dual-host-deliberation.mjs')).href}?proof=1`);
const proposal = 'P'.repeat(300 * 1024);
const stage = 'critique';
const payload = { task: 'large proposal proof', proposal };
const expected = [
  'You are one half of a subscription-only Claude Code and Codex deliberation.',
  'Do not request or use API keys. Work read-only. Return JSON only.',
  `Stage: ${stage}`,
  JSON.stringify(payload),
].join('\n');
const expectedHash = (await import('node:crypto')).createHash('sha256').update(expected).digest('hex');

for (const host of ['claude-code', 'codex']) {
  const result = await mod.runSubscriptionHost(host, stage, payload, { cwd: input });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.bytes, Buffer.byteLength(expected));
  assert.equal(result.value.sha256, expectedHash);
  assert.equal(result.value.args.some((arg) => arg.includes(proposal.slice(0, 1024))), false);
}

const source = path.join(input, '.cache', 'ruvnet-brain', 'kb', '.console-runtime', 'scripts');
const deployed = path.join(input, '.claude', 'model-router', 'bin');
fs.mkdirSync(source, { recursive: true });
fs.mkdirSync(deployed, { recursive: true });
for (const dir of [source, deployed]) fs.writeFileSync(path.join(dir, 'dual-host-deliberation.mjs'), fixture);
const applied = compose.applyComposed(['brain-dual-host-stdin']);
assert.equal(applied.errors, 0);
assert.equal(applied.incomplete, 0);
assert.equal(applied.patched, 2);
assert.deepEqual(compose.statusComposed()['brain-dual-host-stdin'], { files: 2, patched: 2 });

const cli = path.resolve('bin/cli.mjs');
const status = spawnSync(process.execPath, [cli, 'brain-dual-host-stdin', 'status'], {
  env: { ...process.env, RSP_NO_HOST_AUTO_UPDATE: '1', RSP_NO_LAUNCHCTL: '1' },
  encoding: 'utf8',
});
assert.equal(status.status, 0, status.stdout + status.stderr);
assert.match(status.stdout, /brain-dual-host-stdin.*2\/2/);

const restored = compose.reconcile([], ['brain-dual-host-stdin']);
assert.equal(restored.errors, 0);
for (const dir of [source, deployed]) {
  assert.equal(fs.readFileSync(path.join(dir, 'dual-host-deliberation.mjs'), 'utf8'), fixture);
}

console.log('✓ brain-dual-host-stdin: 300 KiB prompts are byte-exact on stdin, absent from argv, composed, and reversible');
