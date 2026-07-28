// Codex rejects Ruflo's hook manifest before loading any handler because its
// top-level `_note` / `_platform_note` metadata is not part of Codex's strict
// `{ description?, hooks }` schema (ruvnet/ruflo#2801, upstream PR #2800).
//
// This target is deliberately Codex-only. Claude Code accepts the metadata,
// while Codex loads its own marketplace snapshot and versioned plugin cache.
// The hook body is preserved byte-for-byte; only the bounded JSON header is
// replaced. A future upstream-valid header is excluded from discovery so the
// retirement predicate can distinguish it from our marked compatibility edit.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_BASE } from '../cwd/paths.mjs';
import { restoreFromBackup } from '../pristine.mjs';

export const MARKER = 'ruflo-source-patch (ruvnet/ruflo#2800)';
const MARKETPLACE = 'ruflo';
const PLUGIN = 'ruflo-core';
const HOOKS_SUFFIX = ['hooks', 'hooks.json'];
const HOOK_ANCHOR = '  "hooks": {';

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
  return strictSchema(source)
    && String(value?.description || '').startsWith(`${MARKER}:`);
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
  const marketplaceHooks = path.join(pluginRoot, ...HOOKS_SUFFIX);
  if (fs.existsSync(marketplaceHooks)) found.push(marketplaceHooks);

  let version = null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
    version = safeVersion(manifest?.version);
  } catch { /* marketplace may be mid-update */ }

  const cacheRoot = path.join(CODEX_HOME, 'plugins', 'cache', MARKETPLACE, PLUGIN);
  if (version) {
    const activeCache = path.join(cacheRoot, version, ...HOOKS_SUFFIX);
    if (fs.existsSync(activeCache)) found.push(activeCache);
  } else {
    try {
      for (const entry of fs.readdirSync(cacheRoot)) {
        const file = path.join(cacheRoot, entry, ...HOOKS_SUFFIX);
        if (fs.existsSync(file)) found.push(file);
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

function patchSource(pristine) {
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

// Native-valid files are not claimed. That makes an upstream replacement
// distinguishable from our marked output and lets ADR-014 retire this target.
export function discover() {
  return discoverAll().filter((file) => {
    try {
      const source = fs.readFileSync(file, 'utf8');
      return isPatched(source) || !isNativeSchema(source);
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
    if (!isNativeSchema(source)) {
      result.unresolved++;
      result.log.push(`error ${file} is not an upstream-native strict Codex hook manifest`);
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
  issue: 'https://github.com/ruvnet/ruflo/issues/2801',
  replacement: 'Ruflo hook manifests with Codex-supported top-level `description`/`hooks` fields (PR #2800)',
  retire: retireNativeBackups,
  check() {
    const copies = discoverAll();
    if (copies.length < 2) {
      return {
        state: 'unknown',
        evidence: `found ${copies.length}/2 active Codex Ruflo hook manifest(s); cannot prove marketplace and cache`,
      };
    }
    const invalid = [];
    for (const file of copies) {
      try {
        const source = fs.readFileSync(file, 'utf8');
        if (!isNativeSchema(source)) invalid.push(file);
      } catch (err) {
        return { state: 'unknown', evidence: `could not read ${file}: ${err.message}` };
      }
    }
    if (invalid.length) {
      return {
        state: 'live',
        evidence: `${invalid.length}/${copies.length} active Codex Ruflo hook manifest(s) still need schema normalization`,
      };
    }
    return {
      state: 'superseded',
      evidence: `all ${copies.length} active Codex Ruflo hook manifests use only supported top-level fields and retain seven handlers`,
    };
  },
};
