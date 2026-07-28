// Ruflo's canonical lifecycle plugin currently carries two Codex-only
// incompatibilities:
//   1. hooks.json has unsupported top-level metadata (PR #2800); and
//   2. its PreToolUse shim emits Cursor's bare permission object (#2816).
//
// This target touches only Codex's marketplace snapshot and versioned plugin
// cache. It replaces the bounded JSON header and removes one exact stdout
// statement; the hook registrations, telemetry call, and every Claude/Cursor
// plugin copy remain unchanged. Native compatible files are excluded from
// discovery so ADR-014 can retire the target from local behavioral proof.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import { restoreFromBackup } from '../pristine.mjs';

export const MARKER = 'ruflo-source-patch (ruvnet/ruflo#2800)';
export const OUTPUT_MARKER = 'ruflo-source-patch (ruvnet/ruflo#2816)';
const MARKETPLACE = 'ruflo';
const PLUGIN = 'ruflo-core';
const HOOKS_SUFFIX = ['hooks', 'hooks.json'];
const SHIM_SUFFIX = ['scripts', 'ruflo-hook.cjs'];
const HOOK_ANCHOR = '  "hooks": {';
const OUTPUT_ANCHOR = '    process.stdout.write(\'{"permission":"allow"}\');';
const OUTPUT_REPLACEMENT = `    // ${OUTPUT_MARKER}: Codex treats exit 0 with empty stdout as allow.`;
const OUTPUT_BLOCK = [
  "  if (subcommand === 'modify-bash' || subcommand === 'modify-file') {",
  '    invokeCli(subcommand, [], stdinData);',
  OUTPUT_ANCHOR,
  '    done();',
  '  }',
].join('\n');
const PATCHED_OUTPUT_BLOCK = OUTPUT_BLOCK.replace(OUTPUT_ANCHOR, OUTPUT_REPLACEMENT);

const CODEX_HOME = process.env.RSP_CODEX_HOME
  || (process.env.RUFLO_SOURCE_PATCH_HOME
    ? path.join(HOME_BASE, '.codex')
    : process.env.CODEX_HOME || path.join(HOME_BASE, '.codex'));

function parsed(source) {
  try {
    const value = JSON.parse(source);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function handlerCount(source) {
  const value = parsed(source);
  if (!value?.hooks || typeof value.hooks !== 'object' || Array.isArray(value.hooks)) return -1;
  let count = 0;
  for (const groups of Object.values(value.hooks)) {
    if (!Array.isArray(groups)) return -1;
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) return -1;
      count += group.hooks.length;
    }
  }
  return count;
}

function strictSchema(source) {
  const value = parsed(source);
  if (!value) return false;
  const keys = Object.keys(value);
  return keys.every((key) => key === 'description' || key === 'hooks')
    && keys.includes('hooks')
    && (value.description === undefined || typeof value.description === 'string')
    && handlerCount(source) === 7;
}

export function isNativeSchema(source) {
  const value = parsed(source);
  return strictSchema(source)
    && !String(value?.description || '').startsWith(`${MARKER}:`);
}

function isPatched(source) {
  const value = parsed(source);
  return (strictSchema(source)
      && String(value?.description || '').startsWith(`${MARKER}:`))
    || source.includes(OUTPUT_REPLACEMENT);
}

function safeVersion(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
    ? value
    : null;
}

function marketplaceRoot() {
  return process.env.RSP_RUFLO_CODEX_MARKETPLACE
    || path.join(CODEX_HOME, '.tmp', 'marketplaces', MARKETPLACE);
}

export function discoverAll() {
  const found = [];
  const pluginRoot = path.join(marketplaceRoot(), 'plugins', PLUGIN);
  for (const suffix of [HOOKS_SUFFIX, SHIM_SUFFIX]) {
    const file = path.join(pluginRoot, ...suffix);
    if (fs.existsSync(file)) found.push(file);
  }

  let version = null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
    version = safeVersion(manifest?.version);
  } catch { /* marketplace may be mid-update */ }

  const cacheRoot = path.join(CODEX_HOME, 'plugins', 'cache', MARKETPLACE, PLUGIN);
  if (version) {
    for (const suffix of [HOOKS_SUFFIX, SHIM_SUFFIX]) {
      const file = path.join(cacheRoot, version, ...suffix);
      if (fs.existsSync(file)) found.push(file);
    }
  } else {
    try {
      for (const entry of fs.readdirSync(cacheRoot)) {
        for (const suffix of [HOOKS_SUFFIX, SHIM_SUFFIX]) {
          const file = path.join(cacheRoot, entry, ...suffix);
          if (fs.existsSync(file)) found.push(file);
        }
      }
    } catch { /* no Codex cache */ }
  }
  return [...new Set(found)];
}

function knownBug(value) {
  if (!value || typeof value._note !== 'string' || typeof value._platform_note !== 'string') return false;
  const keys = Object.keys(value);
  const accepted = keys.join(',') === '_note,_platform_note,hooks'
    || keys.join(',') === '_note,_platform,_platform_note,hooks';
  return accepted
    && (value._platform === undefined || value._platform === 'posix')
    && value.hooks && typeof value.hooks === 'object' && !Array.isArray(value.hooks);
}

function patchManifest(pristine) {
  if (isNativeSchema(pristine) || isPatched(pristine)) {
    return { next: pristine, applied: [], missing: [] };
  }

  const value = parsed(pristine);
  if (!knownBug(value) || handlerCount(pristine) !== 7) {
    return { next: pristine, applied: [], missing: ['known-invalid-header-with-seven-handlers'] };
  }

  const first = pristine.indexOf(HOOK_ANCHOR);
  const last = pristine.lastIndexOf(HOOK_ANCHOR);
  if (first < 0 || first !== last || !pristine.startsWith('{\n')) {
    return { next: pristine, applied: [], missing: ['unique-hooks-boundary'] };
  }

  const notes = [value._note, value._platform_note];
  if (value._platform) notes.push(`platform: ${value._platform}`);
  const description = `${MARKER}: ${notes.join(' | ')}`;
  const next = `{\n  "description": ${JSON.stringify(description)},\n${pristine.slice(first)}`;
  if (!isPatched(next)) {
    return { next: pristine, applied: [], missing: ['strict-codex-schema'] };
  }
  return { next, applied: ['strict-codex-schema'], missing: [] };
}

function patchShim(pristine) {
  if (pristine.includes(OUTPUT_REPLACEMENT)) {
    return { next: pristine, applied: [], missing: [] };
  }
  const first = pristine.indexOf(OUTPUT_BLOCK);
  if (first < 0 || first !== pristine.lastIndexOf(OUTPUT_BLOCK)) {
    return { next: pristine, applied: [], missing: ['unique-cursor-pretooluse-block'] };
  }
  const next = pristine.replace(OUTPUT_BLOCK, PATCHED_OUTPUT_BLOCK);
  if (!next.includes(OUTPUT_REPLACEMENT) || next.includes(OUTPUT_ANCHOR)) {
    return { next: pristine, applied: [], missing: ['empty-codex-pretooluse-output'] };
  }
  return { next, applied: ['empty-codex-pretooluse-output'], missing: [] };
}

function patchSource(pristine) {
  return parsed(pristine) ? patchManifest(pristine) : patchShim(pristine);
}

function validCodexOutput(stdout, input) {
  if (!stdout.trim()) return true;
  try {
    const value = JSON.parse(stdout);
    const output = value?.hookSpecificOutput;
    return output?.hookEventName === 'PreToolUse'
      && output.permissionDecision === 'allow'
      && output.updatedInput?.command === input.tool_input.command;
  } catch {
    return false;
  }
}

export function probeNativeShim(file) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-ruflo-hook-proof-'));
  const telemetry = path.join(root, 'telemetry.log');
  const cli = path.join(root, 'probe-cli.cjs');
  fs.writeFileSync(cli, "require('node:fs').appendFileSync(process.env.RSP_HOOK_PROBE_LOG, process.argv.slice(2).join(' ') + '\\n');\n");
  try {
    for (const subcommand of ['modify-bash', 'modify-file']) {
      const event = {
        hook_event_name: 'PreToolUse',
        tool_name: subcommand === 'modify-bash' ? 'exec_command' : 'apply_patch',
        tool_input: subcommand === 'modify-bash'
          ? { command: 'true' }
          : { command: '*** Begin Patch\n*** End Patch\n' },
      };
      const run = spawnSync(process.execPath, [file, subcommand], {
        input: JSON.stringify(event),
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          RUFLO_HOOK_CLI_OVERRIDE: `node ${cli}`,
          RUFLO_HOOK_SKIP_NPX: '1',
          RSP_HOOK_PROBE_LOG: telemetry,
        },
      });
      let calls = [];
      try { calls = fs.readFileSync(telemetry, 'utf8').trim().split('\n'); } catch { /* no telemetry */ }
      const invoked = calls.includes(`hooks ${subcommand}`);
      if (run.error || run.status !== 0 || !invoked || !validCodexOutput(run.stdout || '', event)) {
        return {
          valid: false,
          evidence: `${subcommand} ${run.error?.message || `exited ${run.status}; telemetry=${invoked}; stdout=${JSON.stringify(run.stdout || '')}`}`,
        };
      }
    }
    return {
      valid: true,
      evidence: 'modify-bash and modify-file both invoked telemetry and completed with Codex-valid output',
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function isManifest(file) {
  return path.basename(file) === 'hooks.json';
}

// Native-compatible files are not claimed. That makes an upstream replacement
// distinguishable from our marked output and lets ADR-014 retire this target.
export function discover() {
  return discoverAll().filter((file) => {
    try {
      const source = fs.readFileSync(file, 'utf8');
      if (isManifest(file)) return isPatched(source) || !isNativeSchema(source);
      if (isPatched(source) || source.includes(OUTPUT_ANCHOR)) return true;
      return !probeNativeShim(file).valid;
    } catch {
      return true;
    }
  });
}

export const descriptor = {
  name: 'ruflo-hooks-schema',
  atomic: true,
  // discover() already excludes a valid upstream replacement. A discovered file with no known
  // header is therefore incompatible drift, not a possible "upstream fixed it" skip.
  missingIsIncomplete: true,
  editCount: 1,
  discover,
  patchSource,
  isPatched,
};

function retireNativeBackups() {
  const result = { restored: 0, errors: 0, unresolved: 0, log: [] };
  for (const file of discoverAll()) {
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch (err) {
      result.errors++;
      result.log.push(`error reading ${file}: ${err.message}`);
      continue;
    }
    const native = isManifest(file)
      ? isNativeSchema(source)
      : !isPatched(source) && probeNativeShim(file).valid;
    if (!native) {
      result.unresolved++;
      result.log.push(`error ${file} is not an upstream-native Codex-compatible hook file`);
      continue;
    }
    const cleaned = restoreFromBackup(file, {
      isKnownPatched: () => false,
      hasPatch: (current) => isPatched(current),
    });
    if (cleaned.unresolved) {
      result.unresolved++;
      result.log.push(`error cleaning ${file}.rsp-backup: ${cleaned.reason}`);
    } else if (cleaned.staleBackupRemoved || cleaned.alreadyClean) {
      result.log.push(`preserved upstream-native ${file}`);
    }
  }
  return result;
}

export const rufloHooksSchemaSupersession = {
  issue: 'https://github.com/ruvnet/ruflo/issues/2816',
  replacement: 'native strict hook manifests (PR #2800) and Codex-compatible PreToolUse output (#2816)',
  retire: retireNativeBackups,
  check() {
    const copies = discoverAll();
    const manifests = copies.filter(isManifest);
    const shims = copies.filter((file) => !isManifest(file));
    if (manifests.length < 2 || shims.length < 2) {
      return {
        state: 'unknown',
        evidence: `found ${manifests.length}/2 manifest(s) and ${shims.length}/2 shim(s); cannot prove Codex marketplace and cache`,
      };
    }
    const invalid = [];
    for (const file of copies) {
      try {
        const source = fs.readFileSync(file, 'utf8');
        if (isManifest(file)) {
          if (!isNativeSchema(source)) invalid.push(file);
        } else if (isPatched(source) || !probeNativeShim(file).valid) {
          invalid.push(file);
        }
      } catch (err) {
        return { state: 'unknown', evidence: `could not read ${file}: ${err.message}` };
      }
    }
    if (invalid.length) {
      return {
        state: 'live',
        evidence: `${invalid.length}/${copies.length} active Codex Ruflo hook file(s) still need compatibility edits`,
      };
    }
    return {
      state: 'superseded',
      evidence: `both active Codex manifests are strict and both shims pass modify-bash/modify-file output probes`,
    };
  },
};
