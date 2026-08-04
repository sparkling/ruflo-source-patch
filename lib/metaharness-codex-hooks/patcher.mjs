// MetaHarness #168: its Codex renderers silently discard declared HarnessSpec hooks.
// Add the smallest host-native bridge: strict .codex/hooks.json plus a project-local
// command adapter. Hook-free harnesses stay byte-for-byte behaviorally unchanged.

import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_ROOTS, NPX_ROOT } from '../cwd/paths.mjs';

export const PATCH_MARKER = 'ruflo-source-patch (ruvnet/metaharness#168)';

const BOOTSTRAP_SOURCE = "const fs=require('fs'),p=require('path');let d=process.cwd();for(;;){const f=p.join(d,'.codex','hooks','metaharness-hook.cjs');if(fs.existsSync(f)){require(f);break}const q=p.dirname(d);if(q===d)throw new Error('MetaHarness Codex hook bridge not found from '+process.cwd());d=q}";

const BRIDGE_SOURCE = `'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function fail(message) {
  process.stderr.write('[metaharness hook] ' + message + '\\n');
  process.exitCode = 2;
}

function findProject(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    const candidate = path.join(dir, '.codex', 'hooks', 'metaharness-hook.cjs');
    try {
      if (fs.realpathSync(candidate) === fs.realpathSync(__filename)) return dir;
    } catch { /* keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('project root containing this hook bridge was not found');
    dir = parent;
  }
}

function glob(pattern, value) {
  let source = '^';
  const special = '^$.*+?()[]{}|';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else source += char.charCodeAt(0) === 92 || special.includes(char)
      ? String.fromCharCode(92) + char : char;
  }
  return new RegExp(source + '$', 's').test(value);
}

function innerSubject(spec, input) {
  const toolInput = input && typeof input.tool_input === 'object' ? input.tool_input : {};
  if (spec.tool === 'Bash') return toolInput.command;
  if (['Write', 'Edit', 'MultiEdit', 'apply_patch'].includes(spec.tool)) {
    return toolInput.file_path ?? toolInput.path ?? toolInput.patch;
  }
  return JSON.stringify(toolInput);
}

try {
  const token = process.argv.at(-1);
  const spec = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  const raw = fs.readFileSync(0, 'utf8');
  const input = raw.trim() ? JSON.parse(raw) : {};
  if (input.hook_event_name && input.hook_event_name !== spec.event) {
    throw new Error('event mismatch: expected ' + spec.event + ', received ' + input.hook_event_name);
  }
  if (spec.inner && spec.inner !== '*') {
    const subject = innerSubject(spec, input);
    if (typeof subject !== 'string') throw new Error('matcher needs a tool-input value that Codex did not provide');
    if (!glob(spec.inner, subject)) process.exit(0);
  }

  const root = findProject(input.cwd || process.cwd());
  const codexRoot = path.join(root, '.codex');
  const helperRoot = path.join(root, '.codex', 'helpers');
  for (const [label, dir] of [['.codex', codexRoot], ['.codex/helpers', helperRoot]]) {
    const dirStat = fs.lstatSync(dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
      throw new Error(label + ' must be a regular, non-symlink directory');
    }
  }
  const helper = path.join(helperRoot, spec.handler + '.cjs');
  const stat = fs.lstatSync(helper);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('handler must be a regular, non-symlink file: ' + helper);
  const realRoot = fs.realpathSync(helperRoot) + path.sep;
  const realHelper = fs.realpathSync(helper);
  if (!realHelper.startsWith(realRoot)) throw new Error('handler escaped .codex/helpers');

  const result = spawnSync(process.execPath, [realHelper], {
    cwd: root, env: process.env, input: raw, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = Number.isInteger(result.status) ? result.status : 2;
} catch (error) {
  fail(error && error.stack ? error.stack : String(error));
}
`;

const RUNTIME = `// ${PATCH_MARKER}
const rspMetaharnessCodexEvents = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
  'PostToolUse', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop',
]);
const rspMetaharnessToolEvents = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse']);
const rspMetaharnessBootstrapSource = ${JSON.stringify(BOOTSTRAP_SOURCE)};
const rspMetaharnessBridgeSource = ${JSON.stringify(BRIDGE_SOURCE)};

function rspMetaharnessEscapeRegex(value) {
  const special = '^$.*+?()[]{}|';
  return [...value].map((char) => char.charCodeAt(0) === 92 || special.includes(char)
    ? String.fromCharCode(92) + char : char).join('');
}

function rspMetaharnessMatcher(event, value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw === '*' || raw === '.*') return {};
  if (!rspMetaharnessToolEvents.has(event)) return { matcher: raw };
  const parsed = /^([A-Za-z][A-Za-z0-9_]*(?:\\|[A-Za-z][A-Za-z0-9_]*)*)(?:\\((.*)\\))?$/.exec(raw);
  if (!parsed) throw new Error('unsupported MetaHarness matcher for Codex: ' + raw);
  const outer = parsed[1].split('|');
  if (parsed[2] !== undefined && outer.length !== 1) {
    throw new Error('inner matcher requires exactly one tool: ' + raw);
  }
  const aliases = { Write: ['Write', 'Edit', 'apply_patch'], Edit: ['Write', 'Edit', 'apply_patch'], MultiEdit: ['Write', 'Edit', 'MultiEdit', 'apply_patch'] };
  const tools = [...new Set(outer.flatMap((tool) => aliases[tool] || [tool]))];
  return {
    matcher: tools.length === 1
      ? '^' + rspMetaharnessEscapeRegex(tools[0]) + '$'
      : '^(?:' + tools.map(rspMetaharnessEscapeRegex).join('|') + ')$',
    tool: outer[0], inner: parsed[2],
  };
}

function rspMetaharnessCodexHookFiles(hooks) {
  if (hooks == null || (Array.isArray(hooks) && hooks.length === 0)) return [];
  if (!Array.isArray(hooks)) throw new Error('MetaHarness hooks must be an array');
  const grouped = {};
  for (const hook of hooks) {
    if (!hook || typeof hook !== 'object') throw new Error('MetaHarness hook must be an object');
    if (!rspMetaharnessCodexEvents.has(hook.event)) throw new Error('unsupported Codex hook event: ' + hook.event);
    if (typeof hook.handler === 'string' && /^(?:https?:|mcp:|prompt:|agent:)/i.test(hook.handler)) {
      throw new Error('Codex currently supports command hook handlers only: ' + hook.handler);
    }
    if (typeof hook.handler !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(hook.handler)) {
      throw new Error('Codex command hooks require a plain .codex/helpers handler name');
    }
    const translated = rspMetaharnessMatcher(hook.event, hook.matcher);
    const token = Buffer.from(JSON.stringify({
      event: hook.event, handler: hook.handler, tool: translated.tool, inner: translated.inner,
    })).toString('base64url');
    const entry = {
      hooks: [{
        type: 'command',
        command: 'node -e ' + JSON.stringify(rspMetaharnessBootstrapSource) + ' ' + token,
      }],
    };
    if (translated.matcher) entry.matcher = translated.matcher;
    (grouped[hook.event] ||= []).push(entry);
  }
  const manifest = {
    description: 'Lifecycle hooks generated by MetaHarness. Review and approve them with /hooks.',
    hooks: grouped,
  };
  return [
    { path: '.codex/hooks.json', content: JSON.stringify(manifest, null, 2) + '\\n' },
    { path: '.codex/hooks/metaharness-hook.cjs', content: rspMetaharnessBridgeSource },
  ];
}

function rspMetaharnessCodexHookRecord(hooks) {
  return Object.fromEntries(rspMetaharnessCodexHookFiles(hooks).map((file) => [file.path, file.content]));
}`;

const HOST_RUNTIME_ANCHOR = `/**
 * Emit the config files for a single host. Returns [] for claude-code (handled`;
const HOST_RUNTIME_PATCHED = `${RUNTIME}\n\n${HOST_RUNTIME_ANCHOR}`;
const HOST_CALL = `            return [
                { path: '.codex/config.toml', content: toml },`;
const HOST_CALL_PATCHED = `            return [
                ...rspMetaharnessCodexHookFiles(cfg.hooks),
                { path: '.codex/config.toml', content: toml },`;

const ADAPTER_RUNTIME_ANCHOR = `export const adapter = {`;
const ADAPTER_RUNTIME_PATCHED = `${RUNTIME}\n\n${ADAPTER_RUNTIME_ANCHOR}`;
const ADAPTER_CALL = `    // ADR-044: emit AGENTS.md (system prompt + agent roster).`;
const ADAPTER_CALL_PATCHED = `    Object.assign(out, rspMetaharnessCodexHookRecord(spec.hooks));
    // ADR-044: emit AGENTS.md (system prompt + agent roster).`;

const occurrences = (source, needle) => source.split(needle).length - 1;

function replaceUnique(source, original, patched, id, applied, missing) {
  if (occurrences(source, patched) === 1) return source;
  const count = occurrences(source, original);
  if (count !== 1) {
    missing.push(count > 1 ? `${id}(AMBIGUOUS: anchor occurs ${count}x)` : id);
    return source;
  }
  applied.push(id);
  return source.replace(original, () => patched);
}

export function patchSource(source) {
  const applied = [];
  const missing = [];
  let next = source;
  const hostSurface = source.includes(HOST_RUNTIME_ANCHOR) || source.includes(HOST_RUNTIME_PATCHED)
    || source.includes(HOST_CALL_PATCHED);
  const adapterSurface = source.includes(ADAPTER_RUNTIME_ANCHOR) || source.includes(ADAPTER_RUNTIME_PATCHED)
    || source.includes(ADAPTER_CALL_PATCHED);
  if (hostSurface && !adapterSurface) {
    next = replaceUnique(next, HOST_RUNTIME_ANCHOR, HOST_RUNTIME_PATCHED, 'host-runtime', applied, missing);
    next = replaceUnique(next, HOST_CALL, HOST_CALL_PATCHED, 'host-renderer', applied, missing);
  } else if (adapterSurface && !hostSurface) {
    next = replaceUnique(next, ADAPTER_RUNTIME_ANCHOR, ADAPTER_RUNTIME_PATCHED, 'adapter-runtime', applied, missing);
    next = replaceUnique(next, ADAPTER_CALL, ADAPTER_CALL_PATCHED, 'adapter-renderer', applied, missing);
  } else {
    missing.push(hostSurface && adapterSurface ? 'surface(AMBIGUOUS)' : 'surface');
  }
  return { next, applied, missing };
}

export function reverseSource(source) {
  return source
    .replace(HOST_CALL_PATCHED, HOST_CALL)
    .replace(HOST_RUNTIME_PATCHED, HOST_RUNTIME_ANCHOR)
    .replace(ADAPTER_CALL_PATCHED, ADAPTER_CALL)
    .replace(ADAPTER_RUNTIME_PATCHED, ADAPTER_RUNTIME_ANCHOR);
}

export const hasPatch = (source) => source.includes(PATCH_MARKER);
export const isPatched = (source) => hasPatch(source)
  && ((source.includes(HOST_RUNTIME_PATCHED) && source.includes(HOST_CALL_PATCHED))
    || (source.includes(ADAPTER_RUNTIME_PATCHED) && source.includes(ADAPTER_CALL_PATCHED)));

function addPackage(found, root, packageName, relativeFile) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (manifest.name !== packageName) return;
    const file = path.join(root, ...relativeFile);
    const stat = fs.lstatSync(file);
    if (stat.isFile() && !stat.isSymbolicLink()) found.add(file);
  } catch { /* absent or incomplete package */ }
}

function addNodeModules(found, nodeModules) {
  addPackage(found, path.join(nodeModules, 'metaharness'), 'metaharness', ['dist', 'host-config.js']);
  addPackage(found, path.join(nodeModules, '@metaharness', 'host-codex'), '@metaharness/host-codex', ['dist', 'index.js']);
}

export function discover() {
  const found = new Set();
  for (const root of GLOBAL_ROOTS) addNodeModules(found, root);
  try {
    for (const hash of fs.readdirSync(NPX_ROOT)) addNodeModules(found, path.join(NPX_ROOT, hash, 'node_modules'));
  } catch { /* no npx cache */ }
  return [...found];
}

export const descriptor = {
  name: 'metaharness-codex-hooks',
  atomic: true,
  editCount: 2,
  discover,
  patchSource,
  hasPatch,
  reverse: reverseSource,
  isPatched,
};
