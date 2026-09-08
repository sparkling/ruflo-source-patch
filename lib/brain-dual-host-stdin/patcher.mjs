// RuvNet Brain #273: cross-critique embeds a complete proposal, so passing the
// prompt as one argv element hits Linux MAX_ARG_STRLEN and spawn fails E2BIG.
// Both native subscription CLIs support stdin; keep prompt bytes off argv.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';

export const PATCH_MARKER = 'ruflo-source-patch (stuinfla/ruvnet-brain#273)';

export const SPAWN_ANCHOR = `function spawnHost(binary, args, options) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, options);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ status: null, stdout, stderr: error.message }));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}`;

export const SPAWN_REPLACEMENT = `function spawnHost(binary, args, options, input) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, options);
    let stdout = '';
    let stderr = '';
    let inputError = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ status: null, stdout, stderr: error.message }));
    child.on('close', (status) => resolve({
      status: inputError ? null : status,
      stdout,
      stderr: [stderr, inputError].filter(Boolean).join('\\n'),
    }));
    // ${PATCH_MARKER}: proposals may exceed Linux's per-argument ceiling.
    // Stream the complete prompt without truncation or a plaintext temp file.
    child.stdin.on('error', (error) => { inputError = error.message; });
    child.stdin.end(input, 'utf8');
  });
}`;

export const CLAUDE_ARG_ANCHOR = `          '--tools', 'Read,Grep,Glob', '--no-session-persistence', '--effort', 'high', prompt,`;
export const CLAUDE_ARG_REPLACEMENT = `          '--tools', 'Read,Grep,Glob', '--no-session-persistence', '--effort', 'high',`;

export const CODEX_ARG_ANCHOR = `          '-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="high"', prompt,`;
export const CODEX_ARG_REPLACEMENT = `          '-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="high"',`;

export const CALL_ANCHOR = `  const result = await spawnHost(command.binary, command.args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });`;
export const CALL_REPLACEMENT = `  const result = await spawnHost(
    command.binary,
    command.args,
    { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] },
    prompt,
  );`;

const EDITS = [
  ['stdin-capable-spawn', SPAWN_ANCHOR, SPAWN_REPLACEMENT],
  ['claude-prompt-off-argv', CLAUDE_ARG_ANCHOR, CLAUDE_ARG_REPLACEMENT],
  ['codex-prompt-off-argv', CODEX_ARG_ANCHOR, CODEX_ARG_REPLACEMENT],
  ['pipe-complete-prompt', CALL_ANCHOR, CALL_REPLACEMENT],
];

const occurrences = (source, needle) => source.split(needle).length - 1;

export function patchSource(pristine) {
  let next = pristine;
  const applied = [];
  const missing = [];
  for (const [id, find, replace] of EDITS) {
    if (!next.includes(find) && next.includes(replace)) continue;
    const count = occurrences(next, find);
    if (count !== 1) {
      missing.push(count > 1 ? `${id}(AMBIGUOUS: anchor occurs ${count}x)` : id);
      continue;
    }
    next = next.replace(find, replace);
    applied.push(id);
  }
  return { next, applied, missing };
}

export function reverseSource(source) {
  return EDITS.reduceRight((current, [, find, replace]) => current.replace(replace, find), source);
}

export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => EDITS.every(([, find, replace]) => (
  !source.includes(find) && source.includes(replace)
));

export function discover() {
  const brainHome = process.env.RSP_RUVNET_BRAIN_HOME
    ? path.resolve(process.env.RSP_RUVNET_BRAIN_HOME)
    : path.join(HOME_BASE, '.cache', 'ruvnet-brain');
  return [
    path.join(brainHome, 'kb', '.console-runtime', 'scripts', 'dual-host-deliberation.mjs'),
    path.join(HOME_BASE, '.claude', 'model-router', 'bin', 'dual-host-deliberation.mjs'),
  ].filter((file) => {
    try {
      const stat = fs.lstatSync(file);
      return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0;
    } catch { return false; }
  });
}

export const descriptor = {
  name: 'brain-dual-host-stdin',
  atomic: true,
  missingIsIncomplete: true,
  discover,
  patchSource,
  isPatched,
  hasPatch,
  reverse: reverseSource,
};
