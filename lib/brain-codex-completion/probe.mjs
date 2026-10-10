// Isolated native adapter/gate proof. Does not reconnect clients or access project memory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPLACEMENT } from './patcher.mjs';
export function probeInstalledCompletion(brainRoot) {
  const gate = fs.readFileSync(path.join(brainRoot, 'scripts/continuation-gate.mjs'), 'utf8');
  const evidence = fs.readFileSync(path.join(brainRoot, 'scripts/completion-claim-evidence.mjs'), 'utf8');
  if (!gate.includes(REPLACEMENT) || evidence.includes('ruflo-source-patch (stuinfla/ruvnet-brain#423)'))
    return { ok: false, reason: 'completion not disabled or old evidence patch remains' };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-completion-disabled-'));
  const env = { ...process.env, HOME: root, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: brainRoot,
    PLUGIN_ROOT: brainRoot, RUVNET_WORK_LEDGER: path.join(root, 'ledger.json'), RUVNET_PROMISE_CAPTURE: 'off',
    RUVNET_CONTINUATION_COOLDOWN_MS: '0' };
  try {
    const init = spawnSync('git', ['init', '-q', root], { env, encoding: 'utf8' });
    if (init.status !== 0) throw Error('isolated fixture git init failed');
    const results = [];
    for (const host of ['codex', 'claude']) for (const [name, message, turn] of [
      ['unqualified-claim', 'Fixed.', 'one'], ['repeated-claim', 'All implemented.', 'one'],
      ['qualified-claim', 'Fixed.\nVerified: npm test.\nUnverified: browser.', 'two'],
      ['missing-identity', 'The tasks are complete.', undefined],
    ]) {
      const command = host === 'codex' ? ['scripts/codex-hook-adapter.mjs', 'continuation-gate']
        : ['scripts/continuation-gate.mjs'];
      const run = spawnSync(process.execPath, [path.join(brainRoot, command[0]), ...command.slice(1)], {
        env: { ...env, RUVNET_HOOK_HOST: host }, cwd: root, encoding: 'utf8', timeout: 15000,
        input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'probe-' + host, turn_id: turn,
          cwd: root, last_assistant_message: message, stop_hook_active: false }),
      });
      let output = null;
      try { output = JSON.parse(run.stdout || '{}'); } catch { /* fails below */ }
      results.push({ name: host + '-' + name, ok: run.status === 0 && output !== null
        && output.decision !== 'block' && !run.stderr.includes('completion-correction-advisory'),
        status: run.status, blocked: output?.decision === 'block' });
    }
    return { ok: results.every(r => r.ok), nativePolicy: 'completion-disabled', results };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
