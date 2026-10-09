// Execute the installed Codex adapter -> native shim -> Stop gate in an isolated temporary repo.
// Does not reconnect clients, access project databases or change installed Brain source.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function probeInstalledCompletion(brainRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-codex-stop-'));
  const env = { ...process.env, HOME: root, CLAUDE_PROJECT_DIR: root,
    CLAUDE_PLUGIN_ROOT: brainRoot, PLUGIN_ROOT: brainRoot,
    RUVNET_WORK_LEDGER: path.join(root, 'ledger.json'), RUVNET_PROMISE_CAPTURE: 'off',
    RUVNET_CONTINUATION_COOLDOWN_MS: '0', RUVNET_HOOK_HOST: 'codex' };
  try {
    const init = spawnSync('git', ['init', '-q', root], { env, encoding: 'utf8' });
    if (init.status !== 0) throw Error('isolated fixture git init failed');
    const transcript = path.join(root, 'rollout.jsonl');
    const message = 'The targeted tests are passing.\nVerified: npm test.\nUnverified: browser behaviour.';
    const start = { type: 'event_msg', payload: { type: 'task_started', turn_id: 'probe-turn' } };
    const command = exit => ({ type: 'event_msg', payload: { type: 'item_completed', turn_id: 'probe-turn',
      started_at_ms: 30, completed_at_ms: 40, item: { id: 'check', type: 'CommandExecution',
        command: ['/bin/sh', '-c', 'npm test'], status: 'completed', exit_code: exit,
        aggregated_output: exit ? 'tests failed' : 'tests passed' } } });
    const edit = { type: 'event_msg', payload: { type: 'item_completed', turn_id: 'probe-turn',
      started_at_ms: 10, completed_at_ms: 20, item: { id: 'edit', type: 'FileChange' } } };
    const results = [];
    for (const [name, rows, text, block] of [
      ['scoped-success', [start, edit, command(0)], message, false],
      ['failed-check', [start, edit, command(1)], message, true],
      ['missing-boundary', [edit, command(0)], message, true],
      ['broad-completion', [start, edit, command(0)], 'Fixed.\nVerified: npm test.\nUnverified: browser.', true],
    ]) {
      fs.writeFileSync(transcript, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
      const run = spawnSync(process.execPath, [path.join(brainRoot, 'scripts/codex-hook-adapter.mjs'), 'continuation-gate'], {
        env, cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
        input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'rsp-probe-' + name,
          cwd: root, transcript_path: transcript, last_assistant_message: text, stop_hook_active: false }),
      });
      let output = null;
      try { output = JSON.parse(run.stdout || '{}'); } catch { /* fails below */ }
      const blocked = output?.decision === 'block' && typeof output.reason === 'string' && output.reason.length > 0;
      const ok = run.status === 0 && output !== null && blocked === block;
      results.push({ name, ok, status: run.status, blocked,
        ...(ok ? {} : { detail: String(run.stderr || run.stdout || run.error || '').slice(0, 1000) }) });
    }
    return { ok: results.every(r => r.ok), results };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
