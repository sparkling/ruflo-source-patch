#!/usr/bin/env node
// ruflo-source-patch temporary Codex adapter for stuinfla/ruvnet-brain#52.
//
// Brain's hook bodies stay single-source. This file translates only host ABI
// differences that cannot be expressed in hooks.json: Codex session env,
// spawn_agent/apply_patch canonical payloads, UserPromptSubmit context JSON,
// "defer", SessionEnd's three-second budget, and Stop's continuation envelope.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const MARKER = 'ruflo-source-patch temporary Codex adapter for stuinfla/ruvnet-brain#52';
void MARKER;

const raw = process.stdin.isTTY ? '' : (() => {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
})();

let event = null;
try {
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) event = parsed;
} catch { /* the Brain hook decides how malformed input should fail open */ }

const brainHome = process.env.RUVNET_BRAIN_HOME
  || path.join(os.homedir(), '.cache', 'ruvnet-brain');

function hasShim(root) {
  return typeof root === 'string'
    && root.length > 0
    && fs.existsSync(path.join(root, 'scripts', 'hook-shim.mjs'));
}

function activePluginRoot() {
  try {
    const active = JSON.parse(fs.readFileSync(path.join(brainHome, 'active.json'), 'utf8'));
    if (typeof active?.codeRoot !== 'string' || !active.codeRoot) return null;
    const candidate = path.isAbsolute(active.codeRoot)
      ? active.codeRoot
      : path.join(brainHome, active.codeRoot);
    const real = fs.realpathSync(candidate);
    const versions = fs.realpathSync(path.join(brainHome, 'versions'));
    const rel = path.relative(versions, real);
    if (!rel || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
    return hasShim(real) ? real : null;
  } catch {
    return null;
  }
}

function resolvePluginRoot() {
  for (const candidate of [process.env.CLAUDE_PLUGIN_ROOT, process.env.PLUGIN_ROOT]) {
    if (hasShim(candidate)) return path.resolve(candidate);
  }
  const active = activePluginRoot();
  if (active) return active;
  const marketplace = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces', 'ruvnet-brain', 'plugin');
  return hasShim(marketplace) ? marketplace : null;
}

const pluginRoot = resolvePluginRoot();
if (!pluginRoot) {
  write(2, '[ruvnet-brain Codex adapter] no current Brain hook spine could be resolved\n');
  process.exit(1);
}
const shim = path.join(pluginRoot, 'scripts', 'hook-shim.mjs');

const childEnv = {
  ...process.env,
  CLAUDE_PLUGIN_ROOT: pluginRoot,
  ...(event?.session_id ? { CLAUDE_SESSION_ID: String(event.session_id) } : {}),
  ...(event?.cwd ? { CLAUDE_PROJECT_DIR: String(event.cwd) } : {}),
};

function write(fd, value) {
  if (!value?.length) return;
  try { fs.writeSync(fd, value); } catch { /* the hook host owns the pipe */ }
}

function run(file, args, payload) {
  return spawnSync(process.execPath, [file, ...args], {
    input: payload,
    env: childEnv,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
}

function finish(result, stdout = result.stdout, stderr = result.stderr) {
  write(1, stdout || '');
  write(2, stderr || '');
  if (result.error) {
    write(2, `[ruvnet-brain Codex adapter] ${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

function firstPatchPath(ev) {
  const command = ev?.tool_input?.command ?? ev?.tool_input?.patch ?? ev?.tool_input?.input;
  if (typeof command !== 'string') return null;
  const cwd = path.resolve(typeof ev.cwd === 'string' && ev.cwd ? ev.cwd : process.cwd());
  for (const match of command.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm)) {
    const rel = match[1].trim();
    const resolved = path.resolve(cwd, rel);
    if (resolved !== cwd && !resolved.startsWith(`${cwd}${path.sep}`)) continue;
    return resolved;
  }
  return null;
}

function payloadFor(hookId) {
  if (!event) return raw;
  const next = structuredClone(event);
  const input = next.tool_input && typeof next.tool_input === 'object'
    ? { ...next.tool_input }
    : {};

  if (hookId === 'route-dispatch' && next.tool_name === 'spawn_agent') {
    next.tool_name = 'Agent';
    if (!input.description) input.description = input.task_name || input.message || '';
    next.tool_input = input;
  }

  if (hookId === 'hijack-ruvnet' && next.tool_name === 'apply_patch') {
    if (!input.content && typeof input.command === 'string') input.content = input.command;
    next.tool_input = input;
  }

  if (hookId === 'learn-capture' && next.tool_name === 'apply_patch') {
    const first = firstPatchPath(next);
    next.tool_name = 'Edit';
    if (first) input.file_path = first;
    next.tool_input = input;
  }

  return JSON.stringify(next);
}

function translateHijack(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const specific = parsed?.hookSpecificOutput;
    if (specific?.hookEventName === 'PreToolUse' && specific.permissionDecision === 'defer') {
      delete specific.permissionDecision;
      delete specific.permissionDecisionReason;
      return JSON.stringify(parsed);
    }
  } catch { /* raw output is handled by Codex */ }
  return stdout;
}

function translateGrounding(stdout) {
  const context = stdout.trim();
  if (!context) return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  });
}

function runShim(hookId, extra) {
  const result = run(shim, [hookId, ...extra], payloadFor(hookId));
  let stdout = result.stdout;
  if (hookId === 'hijack-ruvnet') stdout = translateHijack(stdout || '');
  if (hookId === 'ground-ruvnet') stdout = translateGrounding(stdout || '');
  finish(result, stdout, result.stderr);
}

function detachFlush() {
  try {
    const child = spawn(process.execPath, [shim, 'learn-flush'], {
      detached: true,
      env: childEnv,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
  } catch { /* SessionEnd is best-effort; the queue remains for retry */ }
  process.exit(0);
}

function runStop() {
  const result = run(shim, ['continuation-gate'], raw);
  if (result.status === 2) finish(result);
  if (result.status !== 0 || result.error) process.exit(0);

  try {
    const parsed = JSON.parse(result.stdout || '');
    const context = parsed?.hookSpecificOutput?.additionalContext;
    if (typeof context === 'string' && context.trim()) {
      write(1, JSON.stringify({ decision: 'block', reason: context }));
    } else if (parsed?.decision === 'block' && typeof parsed.reason === 'string') {
      write(1, JSON.stringify({ decision: 'block', reason: parsed.reason }));
    }
  } catch { /* no continuation is the safe outcome */ }
  process.exit(0);
}

const mode = process.argv[2];
if (mode === 'shim') runShim(process.argv[3] || '', process.argv.slice(4));
if (mode === 'detach-flush') detachFlush();
if (mode === 'stop') runStop();

write(2, `[ruvnet-brain Codex adapter] unknown mode: ${JSON.stringify(mode)}\n`);
process.exit(1);
